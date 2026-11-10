/**
 * `mover` 命令（ADR-0008）：导出/导入的 Host 入口。
 *
 * 纯 JS，不使用 Typert `@Remote`；通过 `ctx.commands.register` 暴露，
 * Client 用已有的 `ctx.remote.commands.execute()` 调用。
 *
 * 用法：
 *   mover export <目标文件>
 *   mover import <迁移包> <目标目录>
 */

import { readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import {
  buildManifest,
  buildPackToFile,
  importSessionsToDisk,
  parseManifest,
  planExport,
  readZip,
  restoreWorkspaceFiles,
  safeDirName,
} from '../core/index.js'
import { loadCatalog } from './catalog.js'
import { registerWorkspaces } from './register.js'

const USAGE = '用法：mover export <目标文件> | mover import <迁移包> <目标目录>'

/**
 * @param {string} text
 * @returns {{ kind: 'error', text: string }}
 */
function errorResult(text) {
  return { kind: 'error', text }
}

/**
 * 解析命令行参数（支持双/单引号包裹的路径）。
 * @param {string} rawInput
 * @returns {string[]}
 */
export function tokenizeMoverInput(rawInput) {
  const tokens = []
  let current = ''
  let quote = null
  for (const ch of String(rawInput ?? '')) {
    if (quote !== null) {
      if (ch === quote) quote = null
      else current += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (/\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current)
        current = ''
      }
    } else {
      current += ch
    }
  }
  if (current.length > 0) tokens.push(current)
  return tokens
}

/**
 * 解析命令参数（兼容 `/mover export ...` 与 `export ...`）。
 * @param {string} rawInput
 * @returns {string[]}
 */
export function parseMoverArgs(rawInput) {
  const tokens = tokenizeMoverInput(rawInput)
  if (tokens[0] === 'mover' || tokens[0] === '/mover') tokens.shift()
  return tokens
}

/**
 * 导出对话到一个 `.dshpack`。
 * @param {object} deps
 * @param {string} targetPath
 * @param {string[]} [sessionIds] 为空时导出全部
 * @returns {Promise<{ kind: 'success'|'error', text: string }>}
 */
export async function exportAllSessions(deps, targetPath, sessionIds = []) {
  if (!targetPath) return errorResult(`缺少目标文件。${USAGE}`)
  try {
    const catalog = await loadCatalog({
      workspaceRegistry: deps.workspaceRegistry,
      sessionPersistence: deps.sessionPersistence,
      sessionQuery: deps.sessionQuery,
      platform: deps.platform ?? process.platform,
      logger: deps.logger,
    })
    const wanted = new Set(sessionIds)
    const sessions = [
      ...catalog.workspaces.flatMap((workspace) => workspace.sessions),
      ...catalog.ungrouped,
    ].filter(
      (session) =>
        typeof session.locationPath === 'string' &&
        (wanted.size === 0 || wanted.has(session.id)),
    )

    if (sessions.length === 0) {
      return errorResult('没有可导出的对话。')
    }

    const planSessions = sessions.map((session) => ({
      packPath: `sessions/${session.id}/session.v4.jsonl.zstd`,
      sizeBytes: session.sizeBytes,
    }))
    const plan = planExport({ sessions: planSessions, includeFiles: false })
    const manifest = buildManifest({
      platform: deps.platform ?? process.platform,
      dshVersion: deps.dshVersion ?? 'unknown',
      mode: 'sessions',
      sessions: sessions.map((session) => ({
        id: session.id,
        title: session.title,
        cwd: session.cwd,
        messageCount: session.eventCount ?? 0,
        sizeBytes: session.sizeBytes,
        path: `sessions/${session.id}/session.v4.jsonl.zstd`,
      })),
    })
    const sourcePaths = {}
    for (const session of sessions) {
      sourcePaths[`sessions/${session.id}/session.v4.jsonl.zstd`] = session.locationPath
    }
    const written = await buildPackToFile({
      plan,
      sourcePaths,
      manifest,
      outputPath: targetPath,
    })
    return {
      kind: 'success',
      text: `已导出 ${sessions.length} 个对话到 ${targetPath}（${written.bytes} 字节）`,
    }
  } catch (error) {
    return errorResult(
      `导出失败：${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * 导入一个 `.dshpack`。
 * @param {object} deps
 * @param {string} packPath
 * @param {string} [targetRoot] 省略时使用 `~/dsh-mover-import`
 * @returns {Promise<{ kind: 'success'|'error', text: string }>}
 */
export async function importPack(deps, packPath, targetRoot) {
  if (!packPath) return errorResult(`缺少迁移包路径。${USAGE}`)
  const root = typeof targetRoot === 'string' && targetRoot.length > 0
    ? targetRoot
    : join(homedir(), 'dsh-mover-import')
  try {
    const buffer = await readFile(packPath)
    const { entries } = readZip(buffer)
    const manifest = parseManifest(
      entries.find((entry) => entry.name === 'manifest.json').data.toString('utf8'),
    )

    const platform = deps.platform ?? process.platform
    const pathMap = { byKey: {} }
    for (const workspace of manifest.workspaces) {
      pathMap.byKey[workspace.key] = join(targetRoot, safeDirName(workspace.title, platform))
    }

    const sessionRoot = join(deps.dshHome, 'sessions')
    const sessions = await importSessionsToDisk({ buffer, sessionRoot, pathMap })
    const workspaceEntries = entries
      .filter((entry) => entry.name.startsWith('workspaces/'))
      .map((entry) => ({ packPath: entry.name, data: entry.data }))
    const files = await restoreWorkspaceFiles({
      entries: workspaceEntries,
      pathMap,
      targetPlatform: platform,
    })

    const registered = await registerWorkspaces({
      workspaceRegistry: deps.workspaceRegistry,
      workspaces: manifest.workspaces.map((workspace) => ({
        key: workspace.key,
        title: workspace.title,
        targetPath: pathMap.byKey[workspace.key],
      })),
    })

    const entityByKey = new Map(
      registered.registered.map((item) => [item.key, item.entity]),
    )
    let attached = 0
    for (const written of sessions.written) {
      const source = manifest.sessions.find((item) => item.id === written.id)
      const entity =
        source?.workspaceKey !== undefined
          ? entityByKey.get(source.workspaceKey)
          : undefined
      if (entity && typeof entity.attachSession === 'function') {
        try {
          await entity.attachSession(written.targetId)
          attached += 1
        } catch {
          // 归组失败不阻断导入，摘要中体现数量差异即可
        }
      }
    }

    return {
      kind: 'success',
      text: `已导入 ${sessions.written.length} 个对话、${files.written.length} 个工作区文件，登记 ${registered.registered.length} 个工作区，归组 ${attached} 个对话。`,
    }
  } catch (error) {
    return errorResult(
      `导入失败：${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * 处理一次 `mover` 命令调用。
 * @param {object} deps
 * @param {{ rawInput?: string }} invocation
 * @returns {Promise<{ kind: 'success'|'error', text: string }>}
 */
export async function handleMover(deps, invocation) {
  const args = parseMoverArgs(invocation?.rawInput)
  const sub = args.shift()
  if (sub === 'export') return exportAllSessions(deps, args[0], args.slice(1))
  if (sub === 'import') return importPack(deps, args[0], args[1])
  return errorResult(USAGE)
}

/**
 * 构造 Cordis 命令定义。
 * @param {object} deps
 * @returns {object}
 */
export function createMoverCommand(deps) {
  return {
    name: 'mover',
    description: '导出或导入 DSH 对话与工作区（export/import）',
    input: { hint: 'export <目标文件> | import <迁移包> <目标目录>' },
    handler: (invocation) => handleMover(deps, invocation),
  }
}
