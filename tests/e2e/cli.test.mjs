import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import zlib from 'node:zlib'
import { mkdtemp, rm, mkdir, writeFile, readFile, stat, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildManifest, buildPackToFile } from '../../src/core/export-pack.js'
import { planExport } from '../../src/core/plan-export.js'
import { readZip } from '../../src/core/zip-reader.js'
import { projectKey } from '../../src/core/paths.js'

const CLI = fileURLToPath(new URL('../../src/cli/index.js', import.meta.url))

function sessionBytes(id, cwd) {
  const header = {
    type: 'session',
    version: 4,
    id,
    createdAt: 1700000000000,
    isSeeded: false,
    delegationDepth: 0,
    cwd,
  }
  return Buffer.concat([
    zlib.zstdCompressSync(Buffer.from(`${JSON.stringify(header)}\n`)),
    zlib.zstdCompressSync(Buffer.from('{"type":"turn/start","seq":0}\n')),
    zlib.zstdCompressSync(Buffer.from('{"type":"turn/end","seq":1}\n')),
  ])
}

function runCli(args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' })
}

async function makeHome(dir, { sessions = [], workspaceRegistry = false } = {}) {
  const home = join(dir, 'home')
  await mkdir(home, { recursive: true })
  if (workspaceRegistry) {
    await mkdir(join(home, 'storages'), { recursive: true })
    await writeFile(
      join(home, 'storages', 'workspace.json'),
      JSON.stringify(
        {
          unit: { name: 'workspace', version: 2 },
          global: {
            initialized: true,
            workspaceIds: [],
            archivedSessionIds: [],
            pinnedSessionIds: [],
          },
          tables: { workspaces: {} },
        },
        null,
        2,
      ),
    )
  }
  for (const session of sessions) {
    const dirPath = join(home, 'sessions', `--${projectKey(session.cwd).slice(2, -2)}--`, session.id)
    await mkdir(dirPath, { recursive: true })
    await writeFile(join(dirPath, 'session.v4.jsonl.zstd'), sessionBytes(session.id, session.cwd))
  }
  return home
}

test('CLI export 从 DSH_HOME 生成可读包', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-cli-'))
  try {
    const home = await makeHome(dir, { sessions: [{ id: 'session-cli-1', cwd: '/p' }] })
    const out = join(dir, 'pack.dshpack')
    const result = runCli(['export', '--home', home, '--out', out])
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /已导出 1 个对话/)

    const { entries } = readZip(await readFile(out))
    const names = entries.map((entry) => entry.name)
    assert.ok(names.includes('manifest.json'))
    assert.ok(names.some((name) => name.startsWith('sessions/session-cli-1/')))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CLI import 写回会话并更新 workspace.json', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-cli-'))
  try {
    const targetRoot = join(dir, 'imported')
    const sessionId = 'session-cli-2'
    const sourceSession = join(dir, 'src-session.zstd')
    const bytes = sessionBytes(sessionId, 'F:\\Proj')
    await writeFile(sourceSession, bytes)
    const sourceFile = join(dir, 'a.txt')
    await writeFile(sourceFile, 'hello')

    const plan = planExport({
      sessions: [{ packPath: `sessions/${sessionId}/session.v4.jsonl.zstd`, sizeBytes: bytes.length }],
      workspaces: [{ key: 'ws-1', files: [{ relPath: 'a.txt', size: 5 }] }],
      includeFiles: true,
    })
    const manifest = buildManifest({
      platform: 'win32',
      dshVersion: 'cli',
      mode: 'sessions+workspaces',
      sessions: [
        {
          id: sessionId,
          workspaceKey: 'ws-1',
          cwd: 'F:\\Proj',
          messageCount: 2,
          sizeBytes: bytes.length,
          path: `sessions/${sessionId}/session.v4.jsonl.zstd`,
        },
      ],
      workspaces: [
        {
          key: 'ws-1',
          title: 'Proj',
          sourcePath: 'F:\\Proj',
          sourcePlatform: 'win32',
          fileCount: 1,
          sizeBytes: 5,
          root: 'workspaces/ws-1/files',
        },
      ],
    })
    const pack = join(dir, 'in.dshpack')
    await buildPackToFile({
      plan,
      sourcePaths: {
        [`sessions/${sessionId}/session.v4.jsonl.zstd`]: sourceSession,
        'workspaces/ws-1/files/a.txt': sourceFile,
      },
      manifest,
      outputPath: pack,
    })

    const home = await makeHome(dir, { workspaceRegistry: true })
    const result = runCli([
      'import',
      '--home',
      home,
      '--pack',
      pack,
      '--target',
      targetRoot,
    ])
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /已导入 1 个对话/)
    assert.match(result.stdout, /workspace.json 已更新/)

    const importedWorkspaceFile = join(targetRoot, 'Proj', 'a.txt')
    assert.equal(await readFile(importedWorkspaceFile, 'utf8'), 'hello')

    const registry = JSON.parse(await readFile(join(home, 'storages', 'workspace.json'), 'utf8'))
    const ids = registry.global.workspaceIds
    assert.equal(ids.length, 1)
    const workspace = registry.tables.workspaces[ids[0]]
    assert.equal(workspace.title, 'Proj')
    assert.ok(workspace.sessionIds.includes(sessionId))

    const sessionsRoot = join(home, 'sessions')
    const dirs = await readdirRecursive(sessionsRoot)
    assert.ok(dirs.some((entry) => entry.endsWith('session.v4.jsonl.zstd')))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

async function readdirRecursive(root) {
  const out = []
  const entries = await (await import('node:fs/promises')).readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    const full = join(root, entry.name)
    if (entry.isDirectory()) out.push(...(await readdirRecursive(full)))
    else out.push(full)
  }
  return out
}

test('CLI 缺少参数时返回非零并给出提示', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-cli-'))
  try {
    const result = runCli(['export', '--out', join(dir, 'x.dshpack')])
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /--home/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CLI 工作区导出/导入按包内 mode 恢复文件权限（ADR-0016 B1）', { skip: process.platform === 'win32' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-cli-'))
  try {
    const ws = join(dir, 'ws-modes')
    await mkdir(ws, { recursive: true })
    await writeFile(join(ws, 'private.txt'), 's')
    await chmod(join(ws, 'private.txt'), 0o600)
    await writeFile(join(ws, 'plain.txt'), 'p')
    await chmod(join(ws, 'plain.txt'), 0o644)
    await writeFile(join(ws, 'run.sh'), '#!/bin/sh\n')
    await chmod(join(ws, 'run.sh'), 0o755)

    const home = await makeHome(dir)
    const pack = join(dir, 'ws.dshpack')
    const exported = runCli(['export', '--home', home, '--out', pack, '--workspace', ws])
    assert.equal(exported.status, 0, exported.stderr)

    const target = join(dir, 'target')
    const imported = runCli(['import', '--home', home, '--pack', pack, '--target', target])
    assert.equal(imported.status, 0, imported.stderr)
    assert.match(imported.stdout, /恢复权限 3 个/)

    const perms = async (name) => (await stat(join(target, 'ws-modes', name))).mode & 0o777
    assert.equal(await perms('private.txt'), 0o600)
    assert.equal(await perms('plain.txt'), 0o644)
    assert.equal(await perms('run.sh'), 0o755)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
