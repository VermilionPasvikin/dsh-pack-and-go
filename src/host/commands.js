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

import { access, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { appendFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'

import {
  buildManifest,
  buildPackToFile,
  importSessionsToDisk,
  parseManifest,
  planExport,
  readZip,
  restoreWorkspaceFiles,
  safeDirName,
  scanWorkspace,
} from '../core/index.js'
import { loadCatalog } from './catalog.js'
import { registerWorkspaces } from './register.js'

const USAGE = '用法：mover export <目标> | mover import <迁移包> <目标目录> | mover list'

function timestamp() {
  const now = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

/**
 * 生成不冲突的文件名（同秒重复导出时追加 -2、-3…）。
 * @param {string} base
 * @returns {Promise<string>}
 */
async function uniquePath(base) {
  let candidate = base
  let index = 2
  for (;;) {
    try {
      await access(candidate)
    } catch {
      return candidate
    }
    candidate = base.replace(/\.dshpack$/i, `-${index}.dshpack`)
    index += 1
  }
}

/**
 * 解析导出目标：目录 → 自动生成文件名；文件 → 原样；父目录不存在 → 报错。
 * @param {string} targetPath
 * @returns {Promise<string>}
 */
export async function resolveExportTarget(targetPath) {
  try {
    const info = await stat(targetPath)
    if (info.isDirectory()) {
      return uniquePath(join(targetPath, `dsh-mover-${timestamp()}.dshpack`))
    }
    return targetPath
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    const parent = dirname(targetPath)
    try {
      await access(parent)
    } catch {
      throw new Error(`目标目录不存在：${parent}`)
    }
    return targetPath
  }
}

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
 * 导出对话（可选含工作区文件）到一个 `.dshpack`。
 * @param {object} deps
 * @param {string} targetPath
 * @param {string[]} [sessionIds] 为空时导出全部
 * @param {boolean} [includeFiles] 是否把所属工作区文件一并打包
 * @returns {Promise<{ kind: 'success'|'error', text: string }>}
 */
export async function exportAllSessions(deps, targetPath, sessionIds = [], includeFiles = false) {
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
    const sourcePaths = {}
    for (const session of sessions) {
      sourcePaths[`sessions/${session.id}/session.v4.jsonl.zstd`] = session.locationPath
    }

    const platform = deps.platform ?? process.platform
    const workspaces = []
    const workspaceKeyByCwd = new Map()
    if (includeFiles) {
      const seenCwds = new Set()
      for (const session of sessions) {
        const cwd = session.cwd
        if (typeof cwd !== 'string' || cwd.length === 0 || seenCwds.has(cwd)) continue
        seenCwds.add(cwd)
        try {
          const scan = await scanWorkspace(cwd)
          const files = scan.entries
            .filter((entry) => !entry.isDir)
            .map((entry) => ({ relPath: entry.relPath, size: entry.size }))
          const key = `ws-${workspaces.length + 1}`
          workspaceKeyByCwd.set(cwd, key)
          workspaces.push({
            key,
            title: basename(cwd) || cwd,
            sourcePath: cwd,
            sourcePlatform: platform,
            fileCount: files.length,
            sizeBytes:
              typeof scan.totalBytes === 'number'
                ? scan.totalBytes
                : files.reduce((sum, file) => sum + (file.size ?? 0), 0),
            root: `workspaces/${key}/files`,
            files,
          })
          for (const file of files) {
            sourcePaths[`workspaces/${key}/files/${file.relPath}`] = join(cwd, file.relPath)
          }
        } catch (scanError) {
          console.log(
            '[dsh-mover] workspace scan skipped',
            cwd,
            scanError instanceof Error ? scanError.message : String(scanError),
          )
        }
      }
    }

    const plan = planExport({
      sessions: planSessions,
      workspaces,
      includeFiles,
    })
    const manifestWorkspaces = workspaces.map(({ files, ...rest }) => rest)
    const manifest = buildManifest({
      platform,
      dshVersion: deps.dshVersion ?? 'unknown',
      mode: includeFiles ? 'sessions+workspaces' : 'sessions',
      sessions: sessions.map((session) => ({
        id: session.id,
        title: session.title,
        cwd: session.cwd,
        messageCount: session.eventCount ?? 0,
        sizeBytes: session.sizeBytes,
        path: `sessions/${session.id}/session.v4.jsonl.zstd`,
        ...(includeFiles && workspaceKeyByCwd.has(session.cwd)
          ? { workspaceKey: workspaceKeyByCwd.get(session.cwd) }
          : {}),
      })),
      workspaces: manifestWorkspaces,
    })

    const resolvedTarget = await resolveExportTarget(targetPath)
    console.log(
      '[dsh-mover] export target',
      resolvedTarget,
      'sessions',
      sessions.length,
      'workspaces',
      workspaces.length,
      'files',
      plan.counts.files,
    )
    const written = await buildPackToFile({
      plan,
      sourcePaths,
      manifest,
      outputPath: resolvedTarget,
    })
    console.log('[dsh-mover] export written', written.bytes, 'to', resolvedTarget)
    const fileNote = includeFiles
      ? `，含 ${workspaces.length} 个工作区（${plan.counts.files} 个文件）`
      : ''
    return {
      kind: 'success',
      text: `已导出 ${sessions.length} 个对话${fileNote}到 ${resolvedTarget}（${written.bytes} 字节）`,
    }
  } catch (error) {
    return errorResult(
      `导出失败：${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * 列出目录下的 `.dshpack` 文件（供导入页“选择文件”）。
 * @param {string} directory
 * @returns {Promise<{ kind: 'success'|'error', text: string }>}
 */
export async function findPacks(directory) {
  if (typeof directory !== 'string' || directory.length === 0) {
    return errorResult('缺少目录路径。')
  }
  try {
    const entries = await readdir(directory, { withFileTypes: true })
    const packs = entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.dshpack'))
      .map((entry) => ({ name: entry.name, path: join(directory, entry.name) }))
      .sort((left, right) => left.name.localeCompare(right.name))
    return { kind: 'success', text: JSON.stringify({ directory, packs }) }
  } catch (error) {
    return errorResult(
      `读取目录失败：${error instanceof Error ? error.message : String(error)}`,
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
 * 返回工作区与会话目录（JSON 文本），供 Client 获取真实标题。
 * @param {object} deps
 * @returns {Promise<{ kind: 'success'|'error', text: string }>}
 */
export async function listCatalog(deps) {
  try {
    const catalog = await loadCatalog({
      workspaceRegistry: deps.workspaceRegistry,
      sessionPersistence: deps.sessionPersistence,
      sessionQuery: deps.sessionQuery,
      platform: deps.platform ?? process.platform,
      logger: deps.logger,
    })
    const payload = {
      workspaces: catalog.workspaces.map((workspace) => ({
        path: workspace.path,
        title: workspace.title,
        sessions: workspace.sessions.map((session) => ({
          id: session.id,
          title: session.title,
          cwd: session.cwd,
        })),
      })),
      ungrouped: catalog.ungrouped.map((session) => ({
        id: session.id,
        title: session.title,
        cwd: session.cwd,
      })),
    }
    const count = payload.workspaces.reduce((sum, workspace) => sum + workspace.sessions.length, 0) + payload.ungrouped.length
    console.log('[dsh-mover] list', 'workspaces', payload.workspaces.length, 'sessions', count)
    return { kind: 'success', text: JSON.stringify(payload) }
  } catch (error) {
    return errorResult(
      `读取目录失败：${error instanceof Error ? error.message : String(error)}`,
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
  console.log('[dsh-mover] command', JSON.stringify(args))
  try {
    appendFileSync(
      join(process.env.DSH_HOME ?? '.', 'mover-debug.log'),
      `${new Date().toISOString()} args=${JSON.stringify(args)} agent=${invocation?.agent?.id ?? '?'}\n`,
    )
  } catch {
    // 诊断日志失败不影响命令
  }
  const sub = args.shift()
  if (sub === 'export') {
    const includeFiles = args.includes('--files')
    const rest = args.filter((arg) => arg !== '--files')
    return exportAllSessions(deps, rest[0], rest.slice(1), includeFiles)
  }
  if (sub === 'import') return importPack(deps, args[0], args[1])
  if (sub === 'list') return listCatalog(deps)
  if (sub === 'find') return findPacks(args[0])
  console.error('[dsh-mover] unknown subcommand', sub)
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
    description: '导出或导入 DSH 对话与工作区（export/import/list）',
    input: { hint: 'export <目标> | import <迁移包> <目标目录> | list' },
    handler: (invocation) => handleMover(deps, invocation),
  }
}
