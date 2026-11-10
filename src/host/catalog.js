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

import { ERROR_CODES, MoverError } from '../core/errors.js'

/**
 * @param {string} message
 * @param {Record<string, unknown>} [details]
 * @returns {MoverError}
 */
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
      logger?.warn?.('[dsh-mover] 读取会话标题失败，使用兜底标题', error)
    }
  }

  return assembleCatalog({ workspaces, snapshots, titles, platform })
}
