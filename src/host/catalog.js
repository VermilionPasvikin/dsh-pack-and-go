/**
 * 工作区与会话目录（T2.4）。
 *
 * 数据来源（已核实签名，见 DESIGN §4）：
 * - `workspaceRegistry.list()` → Workspace[]（含 canonical path、title、sessionIds）
 * - `sessionPersistence.list()` → Snapshot[]（含 header、sizeBytes、eventCount）
 * - `sessionQuery.readTitleSnapshots(ids)` → 标题（尽力而为，失败不影响目录）
 *
 * `assembleCatalog` 是纯函数，可在任意平台单测。
 */

import { open } from 'node:fs/promises'

import { decodeSessionEvents } from '../core/attachments.js'
import { scanFramesPartial } from '../core/zstd-frames.js'
import { ERROR_CODES, MoverError } from '../core/errors.js'

/**
 * 从会话事件提取标题（rename 事件优先，其次首条用户消息）。
 *
 * 语义（对齐 DSH 侧栏）：标题最终跟随最后一次 rename；没有 rename 时用首条用户
 * 消息前 24 字。这里遍历全部事件（不提前 break），否则「先有用户消息、后有
 * rename」的会话会一直显示旧标题。
 * @param {object[]} events
 * @returns {string | undefined}
 */
export function titleFromEvents(events) {
  let renameTitle
  let firstUserTitle
  for (const event of events) {
    if (event?.type === 'session/rename' && typeof event.data?.title === 'string') {
      const title = event.data.title.trim()
      if (title.length > 0) renameTitle = title
      continue
    }
    if (firstUserTitle === undefined && event?.type === 'user/message') {
      const content = event.data?.content
      const text = Array.isArray(content)
        ? content.find((part) => part?.type === 'text')?.text
        : undefined
      if (typeof text === 'string' && text.trim().length > 0) {
        firstUserTitle = text.trim().slice(0, 24)
      }
    }
  }
  return renameTitle ?? firstUserTitle
}

/**
 * @param {string} message
 * @param {Record<string, unknown>} [details]
 * @returns {MoverError}
 */
/** 标题兜底读取的头部字节上限（P2-9：不整文件解压）。 */
export const TITLE_READ_BYTES = 256 * 1024

/**
 * 只读会话文件头部，提取标题（P2-9）。
 *
 * 语义是「尽力而为的兜底」：头部内出现过的 rename 取最后一次；没有 rename 时取首条
 * 用户消息前 24 字；头部内没有可用信息时返回 undefined（调用方保留 fallbackTitle）。
 * @param {string} logPath
 * @param {{ maxBytes?: number }} [options]
 * @returns {Promise<string | undefined>}
 */
export async function readTitleFromFile(logPath, options = {}) {
  const maxBytes = options.maxBytes ?? TITLE_READ_BYTES
  const handle = await open(logPath, 'r')
  try {
    const buffer = Buffer.alloc(Math.max(1, maxBytes))
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    if (bytesRead === 0) return undefined
    const head = buffer.subarray(0, bytesRead)
    const { frames, completeBytes } = scanFramesPartial(head)
    if (frames.length === 0) return undefined
    const events = []
    for (const frame of frames) {
      try {
        const decoded = decodeSessionEvents(head.subarray(frame.start, frame.end))
        for (const event of decoded) events.push(event)
      } catch {
        // 截断帧 / 非 JSONL 内容：头部读取到此为止（尽力而为）
        break
      }
    }
    void completeBytes
    return titleFromEvents(events)
  } finally {
    await handle.close()
  }
}

function catalogError(message, details = {}) {
  return new MoverError(ERROR_CODES.CATALOG_INVALID, message, details)
}

/**
 * 由 cwd 末段生成兜底标题。
 * @param {{ cwd?: string, id: string }} header
 * @returns {string}
 */
export function fallbackTitle(header) {
  if (typeof header.cwd === 'string' && header.cwd.length > 0) {
    const segments = header.cwd.split(/[\\/]/).filter((segment) => segment.length > 0)
    return segments.at(-1) ?? header.cwd
  }
  return header.id
}

/**
 * 组装目录（纯函数）。
 * @param {{
 *   workspaces: Array<{ id: string, path: string, title: string, sessionIds?: readonly string[] }>,
 *   snapshots: Array<{ header: { id: string, cwd?: string, createdAt: number }, sizeBytes?: number, eventCount?: number, formatStatus?: string }>,
 *   titles?: Map<string, string>,
 *   platform?: string
 * }} input
 * @returns {{
 *   platform: string,
 *   workspaces: Array<{ key: string, title: string, path: string, sessions: Array<object> }>,
 *   ungrouped: Array<object>,
 *   totals: { workspaces: number, sessions: number, bytes: number }
 * }}
 */
export function assembleCatalog(input) {
  const { workspaces, snapshots, titles = new Map(), platform = 'linux' } = input
  if (!Array.isArray(workspaces) || !Array.isArray(snapshots)) {
    throw catalogError('workspaces 与 snapshots 必须是数组')
  }

  const byId = new Map()
  for (const snapshot of snapshots) {
    const header = snapshot.header
    if (header === null || typeof header !== 'object' || typeof header.id !== 'string') {
      throw catalogError('会话快照缺少 header.id')
    }
    byId.set(header.id, {
      id: header.id,
      title: titles.get(header.id) ?? fallbackTitle(header),
      cwd: header.cwd,
      createdAt: header.createdAt,
      sizeBytes: snapshot.sizeBytes ?? 0,
      eventCount: snapshot.eventCount,
      formatStatus: snapshot.formatStatus,
      locationPath: snapshot.location?.path,
      parentSessionId: header.parentSession,
      origin: header.origin,
      delegationDepth: header.delegationDepth,
    })
  }

  const assigned = new Set()
  const groups = []
  for (const workspace of workspaces) {
    const sessions = []
    for (const id of workspace.sessionIds ?? []) {
      const session = byId.get(id)
      if (session) {
        sessions.push(session)
        assigned.add(id)
      }
    }
    sessions.sort((left, right) => right.createdAt - left.createdAt)
    groups.push({
      key: workspace.id,
      title: workspace.title,
      path: workspace.path,
      sessions,
    })
  }

  const ungrouped = [...byId.values()]
    .filter((session) => !assigned.has(session.id))
    .sort((left, right) => right.createdAt - left.createdAt)

  const bytes = [...byId.values()].reduce((sum, session) => sum + session.sizeBytes, 0)
  return {
    platform,
    workspaces: groups,
    ungrouped,
    totals: { workspaces: groups.length, sessions: byId.size, bytes },
  }
}

/**
 * 从 DSH 服务读取并组装目录（Host 内使用）。
 * @param {{
 *   workspaceRegistry: { list(): Array<object> },
 *   sessionPersistence: { list(options?: object): Promise<Array<object>> },
 *   sessionQuery?: { readTitleSnapshots(ids: string[], signal?: AbortSignal): Promise<Array<object>> },
 *   platform?: string,
 *   logger?: { warn?: (...args: unknown[]) => void }
 * }} services
 * @returns {Promise<object>}
 */
export async function loadCatalog(services) {
  const { workspaceRegistry, sessionPersistence, sessionQuery, platform = process.platform, logger } = services
  if (!workspaceRegistry || typeof workspaceRegistry.list !== 'function') {
    throw catalogError('缺少 workspaceRegistry.list')
  }
  if (!sessionPersistence || typeof sessionPersistence.list !== 'function') {
    throw catalogError('缺少 sessionPersistence.list')
  }

  const workspaces = workspaceRegistry.list()
  const snapshots = await sessionPersistence.list()
  const ids = snapshots.map((snapshot) => snapshot.header.id)

  const titles = new Map()
  if (sessionQuery && typeof sessionQuery.readTitleSnapshots === 'function' && ids.length > 0) {
    try {
      const results = await sessionQuery.readTitleSnapshots(ids)
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value?.title?.title) {
          titles.set(result.sessionId, result.value.title.title)
        }
      }
    } catch (error) {
      logger?.warn?.('[dsh-pack-and-go] 读取会话标题失败，使用兜底标题', error)
    }
  }

  // 标题兜底：服务拿不到（迁移会话/投影缺失）时，从会话日志事件提取。
  for (const snapshot of snapshots) {
    const id = snapshot.header.id
    if (titles.has(id)) continue
    const logPath = snapshot.location?.path
    if (typeof logPath !== 'string') continue
    try {
      const title = await readTitleFromFile(logPath)
      if (typeof title === 'string' && title.length > 0) titles.set(id, title)
    } catch {
      // 会话不可读时保留 fallbackTitle
    }
  }

  return assembleCatalog({ workspaces, snapshots, titles, platform })
}
