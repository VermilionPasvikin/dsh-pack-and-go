#!/usr/bin/env node
/**
 * `dsh-pack-and-go` CLI（ADR-0009）。
 *
 * 不依赖 DSH 进程，直接访问 `DSH_HOME`：
 *   dsh-pack-and-go export --home <DSH_HOME> --out <文件> [--sessions id1,id2]
 *   dsh-pack-and-go import --home <DSH_HOME> --pack <文件> --target <目录>
 *
 * 导入会写会话/附件/工作区文件，并更新 `workspace.json`（写前备份）；
 * 需要重启 DSH 才能看到新会话。
 */

import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { access, copyFile, mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import zlib from 'node:zlib'

import {
  buildManifest,
  buildPackToFile,
  applyImport,
  extractAttachmentRefs,
  listZip,
  parseManifest,
  planExport,
  normalizeSessionAgentState,
  readSessionHeaderFromBuffer,
  repairSessionFileReferences,
  readZipEntry,
  restoreAttachments,
  safeDirName,
  scanFrames,
} from '../core/index.js'
import { scanExistingSessionIds } from '../host/commands.js'

const USAGE = `dsh-pack-and-go <命令> [选项]

命令:
  export   导出对话
  import   导入迁移包
  repair   修复已导入会话中失效的绝对文件路径

选项:
  --home <目录>      DSH_HOME（必填）
  --out <文件>       export 的目标文件（必填）
  --pack <文件>      import 的迁移包（必填）
  --target <目录>    import 的目标目录（必填，不会回退默认目录）
  --sessions <ids>   export 只导出指定会话（逗号分隔）
  --workspace <目录> export 只导出工作区（可重复）
  --strict           export 时任一工作区无法读取即中止
  --session <id>     repair 只修复指定会话（可选）
  --dry-run          repair 只报告不写入
  -h, --help         显示帮助
`

/**
 * @param {string} message
 * @returns {never}
 */
function fail(message) {
  console.error(`错误：${message}`)
  process.exit(1)
}

/**
 * 读取一个会话日志的 header 行。
 * @param {string} file
 * @returns {Promise<object>}
 */
async function readSessionHeader(file) {
  const buffer = await readFile(file)
  const frames = scanFrames(buffer)
  if (frames.length === 0) throw new Error('empty session log')
  const first = frames[0]
  const decoded = zlib.zstdDecompressSync(buffer.subarray(first.start, first.end))
  return JSON.parse(decoded.toString('utf8').slice(0, -1))
}

/**
 * 扫描 `DSH_HOME/sessions` 下的会话。
 * @param {string} home
 * @returns {Promise<Array<{ id: string, cwd?: string, createdAt: number, sizeBytes: number, locationPath: string }>>}
 */
async function listSessions(home) {
  const sessionsRoot = join(home, 'sessions')
  let projects
  try {
    projects = await readdir(sessionsRoot, { withFileTypes: true })
  } catch {
    return []
  }
  const sessions = []
  for (const project of projects.filter((entry) => entry.isDirectory())) {
    const projectPath = join(sessionsRoot, project.name)
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
      const logs = files
        .filter((name) => /^session\.v(\d+)\.jsonl\.zstd$/.test(name))
        .map((name) => ({ name, version: Number(/^session\.v(\d+)/.exec(name)[1]) }))
        .sort((left, right) => right.version - left.version)
      if (logs.length === 0) continue
      const file = join(sessionDir, logs[0].name)
      try {
        const info = await stat(file)
        const header = await readSessionHeader(file)
        sessions.push({
          id: header.id,
          cwd: header.cwd,
          createdAt: header.createdAt ?? 0,
          sizeBytes: info.size,
          locationPath: file,
        })
      } catch {
        // 损坏或正在写入的会话跳过
      }
    }
  }
  return sessions
}

/**
 * @param {{ home: string, out: string, sessions?: string }} options
 */
async function cmdExport(options) {
  if (!options.home) fail('缺少 --home')
  if (!options.out) fail('缺少 --out')
  if (Array.isArray(options.workspace) && options.workspace.length > 0) {
    const { exportWorkspacesOnly } = await import('../host/commands.js')
    const result = await exportWorkspacesOnly(
      { platform: process.platform, dshVersion: 'cli' },
      options.out,
      options.workspace,
      { strict: options.strict === true },
    )
    if (result.kind !== 'success') fail(result.text)
    console.log(result.text)
    return
  }
  const sessions = await listSessions(options.home)
  const wanted = new Set(
    typeof options.sessions === 'string'
      ? options.sessions.split(',').map((id) => id.trim()).filter(Boolean)
      : [],
  )
  const picked = sessions.filter((session) => wanted.size === 0 || wanted.has(session.id))
  if (picked.length === 0) fail('没有可导出的对话')

  const planSessions = picked.map((session) => ({
    packPath: `sessions/${session.id}/session.v4.jsonl.zstd`,
    sizeBytes: session.sizeBytes,
  }))
  const plan = planExport({ sessions: planSessions, includeFiles: false })
  const manifest = buildManifest({
    platform: process.platform,
    dshVersion: 'cli',
    mode: 'sessions',
    sessions: picked.map((session) => ({
      id: session.id,
      cwd: session.cwd,
      messageCount: 0,
      sizeBytes: session.sizeBytes,
      path: `sessions/${session.id}/session.v4.jsonl.zstd`,
    })),
  })
  const sourcePaths = {}
  for (const session of picked) {
    sourcePaths[`sessions/${session.id}/session.v4.jsonl.zstd`] = session.locationPath
  }
  const written = await buildPackToFile({
    plan,
    sourcePaths,
    manifest,
    outputPath: options.out,
  })
  console.log(`已导出 ${picked.length} 个对话到 ${options.out}（${written.bytes} 字节）`)
}

/**
 * 更新 `workspace.json`（写前备份）。
 * @param {string} home
 * @param {object} manifest
 * @param {{ byKey: Record<string, string> }} pathMap
 * @param {Array<{ id: string, targetId: string }>} writtenSessions
 * @returns {Promise<boolean>}
 */
async function updateWorkspaceRegistry(home, manifest, pathMap, writtenSessions) {
  const file = join(home, 'storages', 'workspace.json')
  let data
  try {
    data = JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return false
  }
  if (!data || typeof data !== 'object' || !data.tables || !data.tables.workspaces) {
    return false
  }

  await copyFile(file, `${file}.bak-${Date.now()}`)
  const tables = data.tables.workspaces
  const global = data.global ?? (data.global = {})
  const ids = Array.isArray(global.workspaceIds) ? global.workspaceIds : (global.workspaceIds = [])

  for (const workspace of manifest.workspaces) {
    const targetPath = pathMap.byKey[workspace.key]
    let id = Object.keys(tables).find((key) => tables[key].path === targetPath)
    if (!id) {
      id = randomUUID()
      const now = new Date().toISOString()
      tables[id] = {
        path: targetPath,
        title: workspace.title,
        sessionIds: [],
        createdAt: now,
        updatedAt: now,
      }
      ids.push(id)
    }
    const imported = writtenSessions
      .filter((session) => {
        const source = manifest.sessions.find((item) => item.id === session.id)
        return source?.workspaceKey === workspace.key
      })
      .map((session) => session.targetId)
    for (const sessionId of imported) {
      if (!tables[id].sessionIds.includes(sessionId)) tables[id].sessionIds.push(sessionId)
    }
  }

  await writeFile(file, JSON.stringify(data, null, 2))
  return true
}

/**
 * @param {{ home: string, pack: string, target?: string }} options
 */
async function cmdImport(options) {
  if (!options.home) fail('缺少 --home')
  if (!options.pack) fail('缺少 --pack')
  if (!options.target) fail('缺少 --target（导入必须指定目标目录）')

  const buffer = await readFile(options.pack)
  // 只读中央目录拿条目元数据，manifest 按需解压（NFR-6.5）。
  const metas = listZip(buffer)
  if (!metas.some((meta) => meta.name === 'manifest.json')) fail('迁移包缺少 manifest.json')
  const manifest = parseManifest(readZipEntry(buffer, 'manifest.json').data.toString('utf8'))

  const sessionRoot = join(options.home, 'sessions')
  const existingCwdById = await scanExistingSessionIds(sessionRoot)
  // 与 host 共用同一导入流水线（ADR-0019）：四步判据 → 预检 → 原子写盘。
  const applied = await applyImport({
    buffer,
    sessionRoot,
    targetRoot: options.target,
    platform: process.platform,
    existingSessionIds: [...existingCwdById.keys()],
    existingCwdById,
    policy: { session: options.overwrite === true ? 'overwrite' : 'skip' },
    backupRoot: join(options.home, 'dsh-pack-and-go-backup'),
  })
  const sessions = { written: applied.written, skipped: applied.skipped }
  const files = applied.workspaces
  const pathMap = { byKey: {} }
  for (const target of applied.targets) pathMap.byKey[target.workspaceKey] = target.path
  // 附件只恢复「实际写入会话」引用的部分（决策 7）；只解压被引用的条目。
  const referencedAttachments = new Set()
  for (const written of sessions.written) {
    const source = manifest.sessions.find((item) => item.id === written.id)
    if (!source) continue
    const packed = readZipEntry(buffer, source.path).data
    for (const ref of extractAttachmentRefs(packed)) referencedAttachments.add(ref.attachmentId)
  }
  const attachmentEntries = []
  for (const meta of metas) {
    if (!meta.name.startsWith('attachments/')) continue
    const objectMatch =
      /attachments\/v1\/(?:file-objects|objects)\/[0-9a-f]{2}\/([0-9a-f]{64})/.exec(meta.name)
    if (objectMatch && !referencedAttachments.has(`sha256:${objectMatch[1]}`)) continue
    const fileMatch = /attachments\/v1\/files\/[0-9a-f]{2}\/([0-9a-f]{64})\//.exec(meta.name)
    if (fileMatch && !referencedAttachments.has(`sha256:${fileMatch[1]}`)) continue
    const entry = readZipEntry(buffer, meta.name)
    attachmentEntries.push({ packPath: entry.name, data: entry.data })
  }
  const attachments =
    attachmentEntries.length > 0
      ? await restoreAttachments({
          entries: attachmentEntries,
          attachmentsRoot: join(options.home, 'attachments', 'v1'),
        })
      : { restored: 0, warnings: [] }
  // 只还原有会话写入的工作区文件（决策 9）。
  const writtenByKey = new Map()
  for (const written of sessions.written) {
    const source = manifest.sessions.find((item) => item.id === written.id)
    const key = source?.workspaceKey
    if (typeof key === 'string') {
      writtenByKey.set(key, (writtenByKey.get(key) ?? 0) + 1)
    }
  }
  // 决策 9（E 版）：全部工作区文件都还原（空工作区也保留）。
  const updated = await updateWorkspaceRegistry(options.home, manifest, pathMap, sessions.written)

  const migrated = sessions.written.filter(
    (written) => typeof written.migrateFrom === 'string',
  )
  console.log(
    `已导入 ${sessions.written.length} 个对话、跳过 ${sessions.skipped.length} 个已存在${
      migrated.length > 0 ? `（其中 ${migrated.length} 个迁移覆盖）` : ''
    }、${files.written.length} 个工作区文件${
      files.modes.applied > 0 || files.modes.dirsApplied > 0
        ? `（恢复权限 ${files.modes.applied} 个文件${files.modes.dirsApplied > 0 ? ` / ${files.modes.dirsApplied} 个目录` : ''}）`
        : ''
    }、${attachments.restored} 个附件；workspace.json ${
      updated ? '已更新' : '未更新（不存在或不兼容）'
    }。重启 DSH 后可见。${
      migrated.length > 0
        ? `\n迁移覆盖：\n${migrated.map((item) => `${item.migrateFrom} → ${item.cwd}`).join('\n')}`
        : ''
    }`,
  )
}

/**
 * 修复已导入会话中失效的绝对路径（ADR-0017 补充）。
 * @param {{ home?: string, session?: string, dryRun?: boolean }} options
 */
async function cmdRepair(options) {
  if (!options.home) fail('缺少 --home')
  const sessionsRoot = join(options.home, 'sessions')
  const projects = await readdir(sessionsRoot, { withFileTypes: true }).catch(() => [])
  const wanted = typeof options.session === 'string' ? options.session.trim() : ''
  let scanned = 0
  let changedSessions = 0
  let repaired = 0
  let failed = 0

  for (const project of projects.filter((entry) => entry.isDirectory())) {
    const projectDir = join(sessionsRoot, project.name)
    const dirs = await readdir(projectDir, { withFileTypes: true }).catch(() => [])
    for (const dir of dirs.filter((entry) => entry.isDirectory())) {
      const sessionDir = join(projectDir, dir.name)
      const files = await readdir(sessionDir).catch(() => [])
      const log = files.find((name) => /^session\.v\d+\.jsonl\.zstd$/.test(name))
      if (!log) continue
      const file = join(sessionDir, log)
      let buffer
      try {
        buffer = await readFile(file)
      } catch {
        failed += 1
        continue
      }
      let header
      try {
        header = readSessionHeaderFromBuffer(buffer)
      } catch {
        failed += 1
        continue
      }
      const id = typeof header.id === 'string' ? header.id : dir.name
      if (wanted && !dir.name.includes(wanted) && id !== wanted) continue
      scanned += 1
      const cwd = typeof header.cwd === 'string' ? header.cwd : ''
      if (cwd.length === 0) continue
      const exists = (relative) => existsSync(join(cwd, relative))
      let result
      try {
        result = repairSessionFileReferences(buffer, { sessionCwd: cwd, exists })
      } catch {
        failed += 1
        continue
      }
      let normalized
      try {
        normalized = normalizeSessionAgentState(result.buffer)
      } catch {
        failed += 1
        continue
      }
      const rewritten = result.rewritten + normalized.rewritten
      if (rewritten === 0) continue
      changedSessions += 1
      repaired += rewritten
      result = { buffer: normalized.buffer, rewritten }
      if (options['dry-run'] === true) {
        console.log(`[dry-run] ${id}: 将改写 ${result.rewritten} 处（${file}）`)
        continue
      }
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const backup = `${file}.bak-${stamp}`
      await copyFile(file, backup)
      await writeFile(file, result.buffer)
      console.log(`修复 ${id}: 改写 ${result.rewritten} 处，备份 ${backup}`)
    }
  }
  console.log(
    `完成：扫描 ${scanned} 个会话，修复 ${changedSessions} 个（${repaired} 处）${
      failed > 0 ? `，失败 ${failed} 个` : ''
    }。`,
  )
}

async function main() {
  let parsed
  try {
    parsed = parseArgs({
      args: process.argv.slice(2),
      allowPositionals: true,
      options: {
        home: { type: 'string' },
        out: { type: 'string' },
        pack: { type: 'string' },
        target: { type: 'string' },
        sessions: { type: 'string' },
        session: { type: 'string' },
        'dry-run': { type: 'boolean' },
        strict: { type: 'boolean' },
        workspace: { type: 'string', multiple: true },
        overwrite: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
    })
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
  }

  const command = parsed.positionals[0]
  if (!command || parsed.values.help) {
    console.log(USAGE)
    return
  }
  if (command === 'export') return cmdExport(parsed.values)
  if (command === 'import') return cmdImport(parsed.values)
  if (command === 'repair') return cmdRepair(parsed.values)
  fail(`未知命令：${command}`)
}

main().catch((error) => {
  console.error(`错误：${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
