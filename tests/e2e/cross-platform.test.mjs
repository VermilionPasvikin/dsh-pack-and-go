import test from 'node:test'
import assert from 'node:assert/strict'
import zlib from 'node:zlib'
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'

import { createZip } from '../../src/core/zip-writer.js'
import { importSessionsToDisk } from '../../src/core/import-pack.js'
import { safeDirName } from '../../src/core/path-map.js'
import { restoreWorkspaceFiles } from '../../src/core/workspaces.js'
import { preflightWorkspace } from '../../src/core/preflight.js'
import { scanFrames } from '../../src/core/zstd-frames.js'

function makeSession(id, cwd) {
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

function makePack({ sessionId, cwd, files = [] }) {
  const sessionBytes = makeSession(sessionId, cwd)
  const manifest = {
    schemaVersion: 2,
    createdAt: '2026-11-10T15:30:00+08:00',
    source: { platform: 'win32', dshVersion: 'test', sessionFormat: 4 },
    mode: 'sessions+workspaces',
    sessions: [
      {
        id: sessionId,
        title: '示例',
        workspaceKey: 'ws-1',
        cwd,
        messageCount: 2,
        sizeBytes: sessionBytes.length,
        path: `sessions/${sessionId}/session.v4.jsonl.zstd`,
      },
    ],
    attachments: [],
    workspaces: [
      {
        key: 'ws-1',
        title: 'Proj',
        sourcePath: cwd,
        sourcePlatform: 'win32',
        fileCount: files.length,
        sizeBytes: files.reduce((sum, file) => sum + file.data.length, 0),
        root: 'workspaces/ws-1/files',
      },
    ],
  }
  const entries = [
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest), 'utf8') },
    { name: `sessions/${sessionId}/session.v4.jsonl.zstd`, data: sessionBytes },
    ...files.map((file) => ({
      name: `workspaces/ws-1/files/${file.name}`,
      data: Buffer.from(file.data),
    })),
  ]
  return createZip(entries)
}

function readHeader(buffer) {
  const frames = scanFrames(buffer)
  return JSON.parse(
    zlib
      .zstdDecompressSync(buffer.subarray(frames[0].start, frames[0].end))
      .toString('utf8')
      .slice(0, -1),
  )
}

test('Windows 源 → POSIX 目标：cwd 改写为合法绝对路径且目录一致', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-xplat-'))
  try {
    const targetRoot = join(dir, 'target')
    const sessionRoot = join(dir, 'sessions')
    // 目标路径由 planImportTargets（safeDirName）决定；这里直接构造等价映射。
    const pathMap = { byKey: { 'ws-1': join(targetRoot, safeDirName('Proj', 'linux')) } }
    const pack = makePack({
      sessionId: 'session-xplat',
      cwd: 'F:\\Proj',
      files: [{ name: 'a.txt', data: 'hello' }],
    })
    const sessions = await importSessionsToDisk({
      buffer: pack,
      sessionRoot,
      pathMap,
    })
    assert.equal(sessions.written.length, 1)
    const imported = await readFile(sessions.written[0].path)
    const header = readHeader(imported)
    assert.equal(header.cwd, pathMap.byKey['ws-1'])
    assert.ok(isAbsolute(header.cwd), `cwd should be absolute: ${header.cwd}`)
    assert.ok(sessions.written[0].path.includes('--'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('POSIX 源 → Windows 目标：非法文件名被重命名并记录', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-xplat-'))
  try {
    const targetRoot = join(dir, 'target')
    const pathMap = { byKey: { 'ws-1': targetRoot } }
    const pack = makePack({
      sessionId: 'session-win',
      cwd: '/home/me/Proj',
      files: [{ name: 'a?b.txt', data: 'data' }],
    })
    const workspaceEntries = [
      { packPath: 'workspaces/ws-1/files/a?b.txt', data: Buffer.from('data') },
    ]
    const restored = await restoreWorkspaceFiles({
      entries: workspaceEntries,
      pathMap,
      targetPlatform: 'win32',
    })
    assert.equal(restored.written.length, 1)
    assert.equal(restored.conversions.length, 1)
    assert.equal(restored.conversions[0].to, 'a_b.txt')
    assert.equal(await readFile(join(targetRoot, 'a_b.txt'), 'utf8'), 'data')
    // 包本身可被读取
    assert.ok(pack.length > 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('预检报告可序列化并包含汇总', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-xplat-'))
  try {
    await mkdir(join(dir, 'src'))
    await writeFile(join(dir, 'src', 'ok.txt'), 'y')
    const report = await preflightWorkspace(dir, 'win32')
    assert.ok(report.summary)
    assert.equal(typeof report.summary.invalidName, 'number')
    assert.ok(JSON.stringify(report).includes('summary'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
