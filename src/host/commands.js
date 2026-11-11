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

import { randomUUID } from 'node:crypto'
import { access, mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises'
import { appendFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join } from 'node:path'
import zlib from 'node:zlib'

import {
  buildManifest,
  buildPackToFile,
  decodeSessionEvents,
  DEFAULT_EXCLUDED_DIRS,
  extractAttachmentRefs,
  fileObjectPath,
  fileReferencePath,
  imageObjectPath,
  importSessionsToDisk,
  packAttachmentPath,
  parseManifest,
  planExport,
  preflightWorkspace,
  readZip,
  restoreAttachments,
  restoreWorkspaceFiles,
  safeDirName,
  scanFrames,
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
 * 归一化路径（斜杠/大小写/尾斜杠），用于 cwd 与工作区 path 比较。
 * @param {string} value
 * @returns {string}
 */
function normalizePathKey(value) {
  return String(value ?? '')
    .replace(/\\/g, '/')
    .toLowerCase()
    .replace(/\/+$/, '')
}

/**
 * 清理包名：去掉路径分隔符与 Windows 非法字符、去 .dshpack 后缀。
 * @param {string} name
 * @returns {string}
 */
function sanitizePackageName(name) {
  const cleaned = String(name ?? '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\.dshpack$/i, '')
    .trim()
  return cleaned.length > 0 ? cleaned : `dsh-mover-${timestamp()}`
}

/**
 * 解析导出目标：目录 → 自动生成文件名（可用包名）；文件 → 原样；父目录不存在 → 报错。
 * @param {string} targetPath
 * @param {string} [name] 可选包名（目录目标时使用）
 * @returns {Promise<string>}
 */
export async function resolveExportTarget(targetPath, name) {
  try {
    const info = await stat(targetPath)
    if (info.isDirectory()) {
      return uniquePath(join(targetPath, `${sanitizePackageName(name)}.dshpack`))
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
 * 导出对话（可选含工作区文件与 fork 链）到一个 `.dshpack`。
 * @param {object} deps
 * @param {string} targetPath
 * @param {string[]} [sessionIds] 为空时导出全部
 * @param {boolean} [includeFiles] 是否把所属工作区文件一并打包
 * @param {{ includeFork?: boolean }} [options] 默认连带 fork 祖先与子代理会话
 * @returns {Promise<{ kind: 'success'|'error', text: string }>}
 */
export async function exportAllSessions(
  deps,
  targetPath,
  sessionIds = [],
  includeFiles = false,
  options = {},
) {
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
    const allSessions = [
      ...catalog.workspaces.flatMap((workspace) => workspace.sessions),
      ...catalog.ungrouped,
    ]
    const sessions = allSessions.filter(
      (session) =>
        typeof session.locationPath === 'string' &&
        (wanted.size === 0 || wanted.has(session.id)),
    )

    if (sessions.length === 0) {
      return errorResult('没有可导出的对话。')
    }

    // FORK 连带（SPEC FR-14）：默认带上 fork 祖先与子代理后代，可用 --no-fork 关闭。
    if (options.includeFork !== false) {
      const byId = new Map(allSessions.map((session) => [session.id, session]))
      const selected = new Set(sessions.map((session) => session.id))
      const queue = [...sessions]
      let added = 0
      while (queue.length > 0) {
        const current = queue.pop()
        const parentId = current.parentSessionId
        if (typeof parentId === 'string' && !selected.has(parentId)) {
          const parent = byId.get(parentId)
          if (parent && typeof parent.locationPath === 'string') {
            selected.add(parentId)
            sessions.push(parent)
            queue.push(parent)
            added += 1
          }
        }
        for (const candidate of allSessions) {
          if (
            candidate.parentSessionId === current.id &&
            candidate.origin === 'subagent' &&
            !selected.has(candidate.id) &&
            typeof candidate.locationPath === 'string'
          ) {
            selected.add(candidate.id)
            sessions.push(candidate)
            queue.push(candidate)
            added += 1
          }
        }
      }
      if (added > 0) {
        console.log('[dsh-mover] fork chain added', added, 'sessions')
      }
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
    const scannedCwds = []
    if (includeFiles) {
      const seenCwds = new Set()
      const scanOptions = {}
      if (options.full === true) scanOptions.full = true
      if (Array.isArray(options.excludedDirs) && options.excludedDirs.length > 0) {
        scanOptions.excludedDirs = [...DEFAULT_EXCLUDED_DIRS, ...options.excludedDirs]
      }
      for (const session of sessions) {
        const cwd = session.cwd
        if (typeof cwd !== 'string' || cwd.length === 0 || seenCwds.has(cwd)) continue
        seenCwds.add(cwd)
        scannedCwds.push(cwd)
        try {
          const scan = await scanWorkspace(cwd, scanOptions)
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

    const attachments = []
    if (options.attachments === true) {
      const attachmentsRoot = join(deps.dshHome, 'attachments', 'v1')
      const seenAttachments = new Set()
      for (const session of sessions) {
        try {
          const data = await readFile(session.locationPath)
          for (const ref of extractAttachmentRefs(data)) {
            if (seenAttachments.has(ref.attachmentId)) continue
            seenAttachments.add(ref.attachmentId)
            try {
              if (ref.kind === 'image') {
                const packPath = packAttachmentPath('image', ref.attachmentId)
                const source = imageObjectPath(attachmentsRoot, ref.attachmentId)
                await stat(source)
                sourcePaths[packPath] = source
                attachments.push({ id: ref.attachmentId, kind: 'image', path: packPath })
              } else {
                const packPath = packAttachmentPath('file-object', ref.attachmentId)
                const source = fileObjectPath(attachmentsRoot, ref.attachmentId)
                await stat(source)
                sourcePaths[packPath] = source
                attachments.push({ id: ref.attachmentId, kind: 'file', path: packPath })
                if (typeof ref.name === 'string' && ref.name.length > 0) {
                  const refPath = packAttachmentPath(
                    'file-reference',
                    ref.attachmentId,
                    ref.name,
                  )
                  const refSource = fileReferencePath(
                    attachmentsRoot,
                    ref.attachmentId,
                    ref.name,
                  )
                  await stat(refSource)
                  sourcePaths[refPath] = refSource
                }
              }
            } catch {
              console.log('[dsh-mover] attachment missing', ref.attachmentId)
            }
          }
        } catch {
          // 会话不可读时跳过附件
        }
      }
    }

    const plan = planExport({
      sessions: planSessions,
      workspaces,
      attachments: attachments.map((item) => ({ packPath: item.path, sizeBytes: 0 })),
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
        ...(typeof session.parentSessionId === 'string'
          ? { parentSessionId: session.parentSessionId }
          : {}),
        ...(typeof session.origin === 'string' ? { origin: session.origin } : {}),
        ...(typeof session.delegationDepth === 'number'
          ? { delegationDepth: session.delegationDepth }
          : {}),
        ...(includeFiles && workspaceKeyByCwd.has(session.cwd)
          ? { workspaceKey: workspaceKeyByCwd.get(session.cwd) }
          : {}),
      })),
      workspaces: manifestWorkspaces,
      attachments: attachments.map((item) => ({
        id: item.id,
        kind: item.kind,
        sizeBytes: 0,
        path: item.path,
      })),
    })

    const resolvedTarget = await resolveExportTarget(targetPath, options.name)
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
      compress: options.compress !== false,
    })
    console.log('[dsh-mover] export written', written.bytes, 'to', resolvedTarget)
    const fileNote = includeFiles
      ? `，含 ${workspaces.length} 个工作区（${plan.counts.files} 个文件）`
      : ''
    let preflightNote = ''
    if (options.preflight === true) {
      let riskCount = 0
      for (const cwd of scannedCwds) {
        try {
          const report = await preflightWorkspace(cwd)
          riskCount += Array.isArray(report.risks) ? report.risks.length : 0
        } catch {
          // 预检失败不影响已完成的导出
        }
      }
      preflightNote = `；预检 ${riskCount} 项`
    }
    return {
      kind: 'success',
      text: `已导出 ${sessions.length} 个对话${fileNote}到 ${resolvedTarget}（${written.bytes} 字节）${preflightNote}`,
    }
  } catch (error) {
    return errorResult(
      `导出失败：${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * 测量若干工作区目录的总字节数（供导出页大小估算）。
 * @param {string[]} directories
 * @returns {Promise<{ kind: 'success'|'error', text: string }>}
 */
export async function measureWorkspaces(directories) {
  if (!Array.isArray(directories) || directories.length === 0) {
    return errorResult('缺少目录路径。')
  }
  try {
    const items = []
    for (const directory of directories) {
      if (typeof directory !== 'string' || directory.length === 0) continue
      try {
        const scan = await scanWorkspace(directory)
        const fileCount =
          typeof scan.files === 'number'
            ? scan.files
            : scan.entries.filter((entry) => !entry.isDir).length
        items.push({
          path: directory,
          bytes:
            typeof scan.totalBytes === 'number'
              ? scan.totalBytes
              : scan.entries.reduce((sum, entry) => sum + (entry.size ?? 0), 0),
          files: fileCount,
        })
      } catch (error) {
        items.push({
          path: directory,
          bytes: 0,
          files: 0,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    return { kind: 'success', text: JSON.stringify({ items }) }
  } catch (error) {
    return errorResult(
      `测量失败：${error instanceof Error ? error.message : String(error)}`,
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
    console.error('[dsh-mover] list failed', error)
    return errorResult(
      `读取目录失败：${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * 预览一个迁移包（来源信息、数量、与目标 home 的冲突）。
 * @param {object} deps
 * @param {string} packPath
 * @returns {Promise<{ kind: 'success'|'error', text: string }>}
 */
export async function inspectPack(deps, packPath, targetRoot) {
  if (typeof packPath !== 'string' || packPath.length === 0) {
    return errorResult('缺少迁移包路径。')
  }
  try {
    const buffer = await readFile(packPath)
    const { entries } = readZip(buffer)
    const manifestEntry = entries.find((entry) => entry.name === 'manifest.json')
    if (!manifestEntry) return errorResult('迁移包缺少 manifest.json')
    const manifest = parseManifest(manifestEntry.data.toString('utf8'))
    const platform = deps.platform ?? process.platform

    const existingCwdById = new Map()
    try {
      const snapshots = await deps.sessionPersistence.list()
      for (const snapshot of snapshots) {
        if (typeof snapshot.header.cwd === 'string') {
          existingCwdById.set(snapshot.header.id, snapshot.header.cwd)
        }
      }
    } catch {
      // 目标 home 不可读时冲突视为空
    }
    let workspacePaths = new Set()
    try {
      workspacePaths = new Set(
        deps.workspaceRegistry.list().map((workspace) => normalizePathKey(workspace.path)),
      )
    } catch {
      // 同上
    }

    // 给定目标目录时可预判「迁移覆盖」。
    const target =
      typeof targetRoot === 'string' && targetRoot.trim().length > 0
        ? targetRoot.trim()
        : undefined
    const previewTargetByKey = {}
    if (target) {
      for (const workspace of manifest.workspaces) {
        previewTargetByKey[workspace.key] = join(
          target,
          safeDirName(workspace.title, platform),
        )
      }
    }

    const sessionConflicts = []
    for (const session of manifest.sessions) {
      const currentCwd = existingCwdById.get(session.id)
      if (currentCwd === undefined) continue
      const targetCwd =
        session.workspaceKey !== undefined ? previewTargetByKey[session.workspaceKey] : undefined
      const migrate =
        typeof targetCwd === 'string' &&
        normalizePathKey(targetCwd) !== normalizePathKey(currentCwd)
      sessionConflicts.push({
        id: session.id,
        title: typeof session.title === 'string' ? session.title : null,
        currentCwd,
        targetCwd: targetCwd ?? null,
        kind: migrate ? 'migrate-overwrite' : 'overwrite-in-place',
      })
    }
    const workspaceConflicts = manifest.workspaces
      .filter((workspace) => workspacePaths.has(normalizePathKey(workspace.sourcePath)))
      .map((workspace) => ({
        key: workspace.key,
        title: workspace.title,
        sourcePath: workspace.sourcePath,
        kind: 'same-path-reuse',
      }))
    // 附件是内容寻址：同 id 即同内容，覆盖无副作用，不计为冲突。
    const attachmentConflicts = []

    return {
      kind: 'success',
      text: JSON.stringify({
        packBytes: buffer.length,
        createdAt: manifest.createdAt,
        source: manifest.source,
        mode: manifest.mode,
        sessions: manifest.sessions.length,
        workspaces: manifest.workspaces.length,
        attachments: manifest.attachments.length,
        conflicts: {
          sessions: sessionConflicts.length,
          workspaces: workspaceConflicts.length,
          attachments: attachmentConflicts.length,
        },
        conflictDetails: {
          sessions: sessionConflicts,
          workspaces: workspaceConflicts,
          attachments: attachmentConflicts,
        },
      }),
    }
  } catch (error) {
    return errorResult(
      `预检失败：${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * 从会话日志 Buffer 读首帧 header。
 * @param {Buffer} buffer
 * @returns {object | undefined}
 */
function readSessionHeaderFromBuffer(buffer) {
  const frames = scanFrames(buffer)
  if (frames.length === 0) return undefined
  const first = frames[0]
  const decoded = zlib.zstdDecompressSync(buffer.subarray(first.start, first.end))
  return JSON.parse(decoded.toString('utf8').slice(0, -1))
}

/**
 * 扫描 sessionRoot 下所有会话文件，返回已存在的会话 id 集合。
 * 用于冲突检测（`sessionPersistence.list()` 在重复 id 时也会抛错）。
 * @param {string} sessionRoot
 * @returns {Promise<Set<string>>}
 */
export async function scanExistingSessionIds(sessionRoot) {
  const ids = new Map()
  let projects
  try {
    projects = await readdir(sessionRoot, { withFileTypes: true })
  } catch {
    return ids
  }
  for (const project of projects.filter((entry) => entry.isDirectory())) {
    const projectPath = join(sessionRoot, project.name)
    let dirs
    try {
      dirs = await readdir(projectPath, { withFileTypes: true })
    } catch {
      continue
    }
    for (const dir of dirs.filter((entry) => entry.isDirectory())) {
      const sessionDir = join(projectPath, dir.name)
      let files
      try {
        files = await readdir(sessionDir)
      } catch {
        continue
      }
      const log = files.find((name) => /^session\.v\d+\.jsonl\.zstd$/.test(name))
      if (!log) continue
      try {
        const data = await readFile(join(sessionDir, log))
        const header = readSessionHeaderFromBuffer(data)
        if (header && typeof header.id === 'string') {
          ids.set(header.id, typeof header.cwd === 'string' ? header.cwd : undefined)
        }
      } catch {
        // 损坏会话跳过
      }
    }
  }
  return ids
}

/**
 * 导入一个 `.dshpack`。
 * @param {object} deps
 * @param {string} packPath
 * @param {string} targetRoot 目标目录（必填；不会回退到默认目录）
 * @param {{ sessionPolicy?: 'skip'|'overwrite' }} [options] 同 id 会话冲突策略（默认 skip）
 * @returns {Promise<{ kind: 'success'|'error', text: string }>}
 */
export async function importPack(deps, packPath, targetRoot, options = {}) {
  if (!packPath) return errorResult(`缺少迁移包路径。${USAGE}`)
  if (typeof targetRoot !== 'string' || targetRoot.trim().length === 0) {
    return errorResult('请先选择目标目录：导入必须指定目录，不会自动回退到默认位置。')
  }
  if (options.sessionPolicy === 'new-id') {
    return errorResult('「另存为新对话」已移除；请选择「跳过」或「覆盖」。')
  }
  const sessionPolicy = options.sessionPolicy === 'overwrite' ? 'overwrite' : 'skip'
  const root = targetRoot.trim()
  try {
    const buffer = await readFile(packPath)
    const { entries } = readZip(buffer)
    const manifest = parseManifest(
      entries.find((entry) => entry.name === 'manifest.json').data.toString('utf8'),
    )
    const byName = new Map(entries.map((entry) => [entry.name, entry.data]))

    const platform = deps.platform ?? process.platform
    const pathMap = { byKey: {} }
    const mappings = []
    // 已登记工作区路径：同路径复用；已存在但未登记的目录（用户目录）→ 新建「标题 (1)」。
    const registeredPaths = new Set(
      (typeof deps.workspaceRegistry.list === 'function'
        ? deps.workspaceRegistry.list()
        : []
      ).map((workspace) => normalizePathKey(workspace.path)),
    )
    for (const workspace of manifest.workspaces) {
      let target = join(root, safeDirName(workspace.title, platform))
      if (!registeredPaths.has(normalizePathKey(target))) {
        try {
          await stat(target)
          // D3 兜底：空目录视为本插件遗留目录，直接复用；非空未登记才加序号。
          let isEmpty = false
          try {
            isEmpty = (await readdir(target)).length === 0
          } catch {
            // 读不了按非空处理
          }
          if (!isEmpty) {
            let suffix = 1
            for (;;) {
              const candidate = `${target} (${suffix})`
              try {
                await stat(candidate)
                suffix += 1
              } catch {
                target = candidate
                break
              }
            }
          }
        } catch {
          // 目录不存在，直接使用
        }
      }
      await mkdir(target, { recursive: true })
      let canonical = target
      try {
        canonical = await realpath(target)
      } catch {
        // 无法 realpath 时保留原路径
      }
      pathMap.byKey[workspace.key] = canonical
      mappings.push(`${workspace.sourcePath} → ${canonical}`)
    }

    const sessionRoot = join(deps.dshHome, 'sessions')
    let existingSessionIds = []
    const existingCwdById = new Map()
    try {
      const snapshots = await deps.sessionPersistence.list()
      for (const snapshot of snapshots) {
        existingSessionIds.push(snapshot.header.id)
        if (typeof snapshot.header.cwd === 'string') {
          existingCwdById.set(snapshot.header.id, snapshot.header.cwd)
        }
      }
    } catch {
      // 重复 id 等异常时退回文件扫描，避免把冲突写进磁盘
      const scanned = await scanExistingSessionIds(sessionRoot)
      existingSessionIds = [...scanned.keys()]
      for (const [id, cwd] of scanned) existingCwdById.set(id, cwd)
    }
    const sessions = await importSessionsToDisk({
      buffer,
      sessionRoot,
      pathMap,
      existingSessionIds,
      existingCwdById,
      policy: { session: sessionPolicy },
      // 覆盖/迁移覆盖前备份旧文件（迁移时旧目录移到该备份根下）。
      backupRoot: join(deps.dshHome, 'dsh-mover-backup'),
    })
    if (sessionPolicy === 'overwrite') {
      const unknown = sessions.written.filter(
        (written) => written.action === 'overwrite' && !existingCwdById.has(written.id),
      )
      if (unknown.length > 0) {
        return errorResult(
          `无法覆盖：${unknown.length} 个对话找不到现有位置（请改用「跳过」，或重启 DSH 后重试）。`,
        )
      }
    }
    // 附件只恢复「实际写入会话」引用的部分（跳过的会话不写附件）。
    const referencedAttachments = new Set()
    for (const written of sessions.written) {
      const source = manifest.sessions.find((item) => item.id === written.id)
      const packed = source ? byName.get(source.path) : undefined
      if (!packed) continue
      for (const ref of extractAttachmentRefs(packed)) referencedAttachments.add(ref.attachmentId)
    }
    const attachmentEntries = entries
      .filter((entry) => entry.name.startsWith('attachments/'))
      .filter((entry) => {
        const match = /attachments\/v1\/(?:file-objects|objects)\/[0-9a-f]{2}\/([0-9a-f]{64})/.exec(
          entry.name,
        )
        if (match) return referencedAttachments.has(`sha256:${match[1]}`)
        const fileMatch = /attachments\/v1\/files\/[0-9a-f]{2}\/([0-9a-f]{64})\//.exec(entry.name)
        return fileMatch
          ? referencedAttachments.has(`sha256:${fileMatch[1]}`)
          : true
      })
      .map((entry) => ({ packPath: entry.name, data: entry.data }))
    const attachments =
      attachmentEntries.length > 0
        ? await restoreAttachments({
            entries: attachmentEntries,
            attachmentsRoot: join(deps.dshHome, 'attachments', 'v1'),
          })
        : { restored: 0, warnings: [] }
    // 决策 9（E 版）：空工作区也登记并还原文件（用户可能先建工作区、后建对话）。
    const writtenByKey = new Map()
    for (const written of sessions.written) {
      const source = manifest.sessions.find((item) => item.id === written.id)
      const key = source?.workspaceKey
      if (typeof key === 'string') {
        writtenByKey.set(key, (writtenByKey.get(key) ?? 0) + 1)
      }
    }
    const workspaceEntries = entries
      .filter((entry) => entry.name.startsWith('workspaces/'))
      .map((entry) => ({ packPath: entry.name, data: entry.data }))
    const files = await restoreWorkspaceFiles({
      entries: workspaceEntries,
      pathMap,
      targetPlatform: platform,
    })

    const activeWorkspaces = manifest.workspaces
    const registered = await registerWorkspaces({
      workspaceRegistry: deps.workspaceRegistry,
      workspaces: activeWorkspaces.map((workspace) => ({
        key: workspace.key,
        title: workspace.title,
        targetPath: pathMap.byKey[workspace.key],
      })),
    })

    const entityByKey = new Map(
      registered.registered.map((item) => [item.key, item.entity]),
    )
    // 包内未登记工作区时，按会话 cwd 匹配已有工作区，让 DSH 侧边栏能归组。
    const workspaceByPath = new Map()
    try {
      const allWorkspaces =
        typeof deps.workspaceRegistry.list === 'function' ? deps.workspaceRegistry.list() : []
      for (const workspace of allWorkspaces) {
        workspaceByPath.set(normalizePathKey(workspace.path), workspace)
      }
    } catch {
      // 列表不可用时只依赖包内 workspaceKey
    }
    let attached = 0
    for (const written of sessions.written) {
      const source = manifest.sessions.find((item) => item.id === written.id)
      let entity =
        source?.workspaceKey !== undefined
          ? entityByKey.get(source.workspaceKey)
          : undefined
      if (!entity) {
        let canonicalCwd = written.cwd ?? source?.cwd
        if (typeof canonicalCwd === 'string' && canonicalCwd.length > 0) {
          try {
            canonicalCwd = await realpath(canonicalCwd)
          } catch {
            // 无法 realpath 时保留原值
          }
          entity = workspaceByPath.get(normalizePathKey(canonicalCwd))
        }
      }
      if (entity && typeof entity.attachSession === 'function') {
        try {
          await entity.attachSession(written.targetId)
          attached += 1
        } catch (attachError) {
          console.error('[dsh-mover] attach failed', written.targetId, attachError)
        }
      }
    }

    const overwrittenCount = sessions.written.filter(
      (item) => item.action === 'overwrite',
    ).length

    // 导入前已打开的会话：DSH 内存缓存不会因覆盖而刷新，需要重启 DSH 才能看到回滚结果。
    const sessionsService = deps.sessions
    const preOpenIds = new Set(
      sessionsService && typeof sessionsService.list === 'function'
        ? sessionsService.list().map((session) => session.id)
        : [],
    )
    const preOpenWritten = sessions.written.filter((written) =>
      preOpenIds.has(written.targetId),
    )

    // 激活会话：让 DSH 的 live 索引感知新会话，左侧列表即可热更新（失败不阻断）。
    const sessionController = deps.sessionController
    if (sessionController && typeof sessionController.resolveAgent === 'function') {
      for (const written of sessions.written) {
        try {
          await sessionController.resolveAgent(written.targetId)
        } catch (error) {
          console.error('[dsh-mover] activate failed', written.targetId, error)
        }
      }
    }

    // 热重载：通过 workspaceController 的公开方法触发 follow 广播。
    // 直接改实体不会广播增量帧，侧边栏不会刷新。
    const workspaceController = deps.workspaceController
    if (
      workspaceController &&
      typeof workspaceController.insertSessionBefore === 'function'
    ) {
      for (const [workspaceKey, entity] of entityByKey) {
        const importedIds = sessions.written
          .filter((written) => {
            const source = manifest.sessions.find((item) => item.id === written.id)
            return source?.workspaceKey === workspaceKey
          })
          .map((written) => written.targetId)
        if (importedIds.length === 0 || !entity || typeof entity.id !== 'string') continue
        try {
          await workspaceController.insertSessionBefore({
            workspaceId: entity.id,
            sessionId: importedIds[0],
          })
        } catch (reindexError) {
          console.error('[dsh-mover] controller reindex failed', workspaceKey, reindexError)
        }
      }
    }

    const migrated = sessions.written.filter(
      (written) => typeof written.migrateFrom === 'string',
    )
    const emptyWorkspaceCount = manifest.workspaces.filter(
      (workspace) => (writtenByKey.get(workspace.key) ?? 0) === 0,
    ).length
    const migratedLines = migrated.map((written) => {
      const source = manifest.sessions.find((item) => item.id === written.id)
      const workspaceTitle = source?.workspaceKey
        ? (registered.registered.find((item) => item.key === source.workspaceKey)?.title ??
          manifest.workspaces.find((item) => item.key === source.workspaceKey)?.title ??
          '未分组')
        : '未分组'
      const sessionTitle = typeof source?.title === 'string' ? source.title : written.id
      return `${workspaceTitle}/${sessionTitle}（原 ${written.migrateFrom} → 新 ${written.cwd}）`
    })
    const ungroupedCount = sessions.written.filter((written) => {
      const source = manifest.sessions.find((item) => item.id === written.id)
      return source?.workspaceKey === undefined
    }).length
    const legacyNote =
      typeof manifest.source.sessionFormat === 'number' && manifest.source.sessionFormat < 4
        ? '（旧格式包，打开时由 DSH 自动迁移）'
        : ''
    const overwrittenFiles = Array.isArray(files.overwritten) ? files.overwritten.length : 0
    return {
      kind: 'success',
      text: `已导入 ${
        sessions.written.filter((item) => item.action === 'import').length
      } 个对话（覆盖 ${overwrittenCount} 个${
        migrated.length > 0 ? `，其中 ${migrated.length} 个迁移覆盖` : ''
      }）、跳过 ${sessions.skipped.length} 个已存在${legacyNote}；工作区文件 ${files.written.length} 个${
        overwrittenFiles > 0 ? `（覆盖 ${overwrittenFiles} 个）` : ''
      }，附件 ${attachments.restored} 个${
        attachments.warnings.length > 0 ? `（警告 ${attachments.warnings.length}）` : ''
      }，登记 ${registered.registered.length} 个工作区${
        emptyWorkspaceCount > 0 ? `（其中 ${emptyWorkspaceCount} 个暂无对话）` : ''
      }，归组 ${attached} 个对话${
        ungroupedCount > 0 ? `（其中 ${ungroupedCount} 个未归组）` : ''
      }。${
        mappings.length > 0 ? `工作区映射：\n${mappings.join('\n')}\n` : ''
      }${
        migratedLines.length > 0
          ? `迁移覆盖：\n${migratedLines.join('\n')}\n`
          : ''
      }${
        preOpenWritten.length > 0
          ? `注意：${preOpenWritten.length} 个对话在导入前已打开，DSH 进程需重启后才会显示回滚结果。\n`
          : ''
      }若左侧列表未出现，请刷新页面或重启 DSH。`,
    }
  } catch (error) {
    console.error('[dsh-mover] import failed', error)
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
      meta: {
        platform: deps.platform ?? process.platform,
        dshHome: deps.dshHome,
        dshVersion: deps.dshVersion,
        defaultImportDir: join(homedir(), 'dsh-mover-import'),
      },
      workspaces: catalog.workspaces.map((workspace) => ({
        path: workspace.path,
        title: workspace.title,
        sessions: workspace.sessions.map((session) => ({
          id: session.id,
          title: session.title,
          cwd: session.cwd,
          sizeBytes: session.sizeBytes,
        })),
      })),
      ungrouped: catalog.ungrouped.map((session) => ({
        id: session.id,
        title: session.title,
        cwd: session.cwd,
        sizeBytes: session.sizeBytes,
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
    const noFork = args.includes('--no-fork')
    const full = args.includes('--full')
    const noCompress = args.includes('--no-compress')
    const preflight = args.includes('--preflight')
    const attachmentMode = args.includes('--attachments')
    const excludeAt = args.indexOf('--exclude')
    const excludedDirs =
      excludeAt >= 0
        ? String(args[excludeAt + 1] ?? '')
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)
        : []
    const nameAt = args.indexOf('--name')
    const exportName = nameAt >= 0 ? String(args[nameAt + 1] ?? '') : ''
    const flags = new Set([
      '--files',
      '--no-fork',
      '--full',
      '--no-compress',
      '--preflight',
      '--exclude',
      '--attachments',
      '--name',
    ])
    const rest = args.filter(
      (arg, index) =>
        !flags.has(arg) &&
        !(excludeAt >= 0 && index === excludeAt + 1) &&
        !(nameAt >= 0 && index === nameAt + 1),
    )
    return exportAllSessions(deps, rest[0], rest.slice(1), includeFiles, {
      includeFork: !noFork,
      full,
      compress: !noCompress,
      preflight,
      excludedDirs,
      attachments: attachmentMode,
      name: exportName,
    })
  }
  if (sub === 'import') {
    const rest = args.filter((arg) => arg !== '--original' && arg !== '--new-id')
    return importPack(deps, rest[0], rest[1], {
      sessionPolicy: args.includes('--overwrite') ? 'overwrite' : 'skip',
    })
  }
  if (sub === 'list') return listCatalog(deps)
  if (sub === 'find') return findPacks(args[0])
  if (sub === 'size') return measureWorkspaces(args)
  if (sub === 'inspect') return inspectPack(deps, args[0])
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
