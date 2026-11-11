#!/usr/bin/env node
/**
 * `dsh-mover` CLI（ADR-0009）。
 *
 * 不依赖 DSH 进程，直接访问 `DSH_HOME`：
 *   dsh-mover export --home <DSH_HOME> --out <文件> [--sessions id1,id2]
 *   dsh-mover import --home <DSH_HOME> --pack <文件> --target <目录>
 *
 * 导入会写会话/附件/工作区文件，并更新 `workspace.json`（写前备份）；
 * 需要重启 DSH 才能看到新会话。
 */

import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import zlib from 'node:zlib'

import {
  buildManifest,
  buildPackToFile,
  importSessionsToDisk,
  parseManifest,
  planExport,
  readZip,
  restoreAttachments,
  restoreWorkspaceFiles,
  safeDirName,
  scanFrames,
} from '../core/index.js'
import { scanExistingSessionIds } from '../host/commands.js'

const USAGE = `dsh-mover <命令> [选项]

命令:
  export   导出对话
  import   导入迁移包

选项:
  --home <目录>      DSH_HOME（必填）
  --out <文件>       export 的目标文件（必填）
  --pack <文件>      import 的迁移包（必填）
  --target <目录>    import 的目标目录（必填，不会回退默认目录）
  --sessions <ids>   export 只导出指定会话（逗号分隔）
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
  const { entries } = readZip(buffer)
  const manifestEntry = entries.find((entry) => entry.name === 'manifest.json')
  if (!manifestEntry) fail('迁移包缺少 manifest.json')
  const manifest = parseManifest(manifestEntry.data.toString('utf8'))

  const root = options.target
  const pathMap = { byKey: {} }
  for (const workspace of manifest.workspaces) {
    const dir = join(root, safeDirName(workspace.title, process.platform))
    await mkdir(dir, { recursive: true })
    pathMap.byKey[workspace.key] = await realpath(dir)
  }

  const sessionRoot = join(options.home, 'sessions')
  const existingCwdById = await scanExistingSessionIds(sessionRoot)
  const sessions = await importSessionsToDisk({
    buffer,
    sessionRoot,
    pathMap,
    existingSessionIds: [...existingCwdById.keys()],
    existingCwdById,
    policy: { session: options.overwrite === true ? 'overwrite' : 'skip' },
  })
  const workspaceEntries = entries
    .filter((entry) => entry.name.startsWith('workspaces/'))
    .map((entry) => ({ packPath: entry.name, data: entry.data }))
  const files = await restoreWorkspaceFiles({
    entries: workspaceEntries,
    pathMap,
    targetPlatform: process.platform,
  })
  const attachmentEntries = entries
    .filter((entry) => entry.name.startsWith('attachments/'))
    .map((entry) => ({ packPath: entry.name, data: entry.data }))
  const attachments =
    attachmentEntries.length > 0
      ? await restoreAttachments({
          entries: attachmentEntries,
          attachmentsRoot: join(options.home, 'attachments', 'v1'),
        })
      : { restored: 0, warnings: [] }
  const updated = await updateWorkspaceRegistry(options.home, manifest, pathMap, sessions.written)

  const migrated = sessions.written.filter(
    (written) => typeof written.migrateFrom === 'string',
  )
  console.log(
    `已导入 ${sessions.written.length} 个对话、跳过 ${sessions.skipped.length} 个已存在${
      migrated.length > 0 ? `（其中 ${migrated.length} 个迁移覆盖）` : ''
    }、${files.written.length} 个工作区文件、${attachments.restored} 个附件；workspace.json ${
      updated ? '已更新' : '未更新（不存在或不兼容）'
    }。重启 DSH 后可见。${
      migrated.length > 0
        ? `\n迁移覆盖：\n${migrated.map((item) => `${item.migrateFrom} → ${item.cwd}`).join('\n')}`
        : ''
    }`,
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
  fail(`未知命令：${command}`)
}

main().catch((error) => {
  console.error(`错误：${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
