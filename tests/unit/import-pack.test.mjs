import test from 'node:test'
import assert from 'node:assert/strict'
import zlib from 'node:zlib'
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { importSessionsToDisk } from '../../src/core/import-pack.js'
import { createZip } from '../../src/core/zip-writer.js'
import { sessionDir } from '../../src/core/paths.js'
import { scanFrames } from '../../src/core/zstd-frames.js'
import { ERROR_CODES, MoverError } from '../../src/core/errors.js'

function makeSessionBytes({ cwd = 'F:\\proj', version = 4 } = {}) {
  const header = {
    type: 'session',
    version,
    id: 's1',
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

function makePack(sessionBytes) {
  const manifest = {
    schemaVersion: 2,
    createdAt: '2026-11-10T15:30:00+08:00',
    source: { platform: 'win32', dshVersion: 'test', sessionFormat: 4 },
    mode: 'sessions+workspaces',
    sessions: [
      {
        id: 's1',
        title: '示例',
        workspaceKey: 'w1',
        cwd: 'F:\\proj',
        messageCount: 2,
        sizeBytes: sessionBytes.length,
        path: 'sessions/s1/session.v4.jsonl.zstd',
      },
    ],
    attachments: [],
    workspaces: [
      {
        key: 'w1',
        title: 'proj',
        sourcePath: 'F:\\proj',
        sourcePlatform: 'win32',
        fileCount: 0,
        sizeBytes: 0,
        root: 'workspaces/w1/files',
      },
    ],
  }
  return createZip([
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest), 'utf8') },
    { name: 'sessions/s1/session.v4.jsonl.zstd', data: sessionBytes },
  ])
}

test('导入会话到目标磁盘并改写 cwd', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-mover-import-'))
  try {
    const sessionRoot = join(dir, 'sessions')
    await mkdir(sessionRoot, { recursive: true })
    const result = await importSessionsToDisk({
      buffer: makePack(makeSessionBytes()),
      sessionRoot,
      pathMap: { byKey: { w1: '/target/proj' } },
    })
    assert.equal(result.written.length, 1)
    assert.deepEqual(result.skipped, [])
    const expected = join(sessionDir(sessionRoot, '/target/proj', 's1'), 'session.v4.jsonl.zstd')
    assert.equal(result.written[0].path, expected)

    const data = await readFile(expected)
    const frames = scanFrames(data)
    const header = JSON.parse(
      zlib.zstdDecompressSync(data.subarray(frames[0].start, frames[0].end))
        .toString('utf8')
        .slice(0, -1),
    )
    assert.equal(header.cwd, '/target/proj')
    assert.equal(frames.length, 3)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

function makePackNoWorkspace(sessionBytes) {
  const manifest = {
    schemaVersion: 2,
    createdAt: '2026-11-10T15:30:00+08:00',
    source: { platform: 'win32', dshVersion: 'test', sessionFormat: 4 },
    mode: 'sessions',
    sessions: [
      {
        id: 's1',
        title: '示例',
        cwd: 'F:\\proj',
        messageCount: 2,
        sizeBytes: sessionBytes.length,
        path: 'sessions/s1/session.v4.jsonl.zstd',
      },
    ],
    attachments: [],
    workspaces: [],
  }
  return createZip([
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest), 'utf8') },
    { name: 'sessions/s1/session.v4.jsonl.zstd', data: sessionBytes },
  ])
}

test('未指定目标 cwd 时按源 cwd 计算目录（避免 _no-cwd 身份不一致）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-mover-import-'))
  try {
    const sessionRoot = join(dir, 'sessions')
    const result = await importSessionsToDisk({
      buffer: makePackNoWorkspace(makeSessionBytes()),
      sessionRoot,
      pathMap: { byKey: {} },
    })
    const written = result.written[0]
    assert.ok(written.path.includes('--F-proj--'), written.path)
    assert.ok(!written.path.includes('_no-cwd'), written.path)
    assert.equal(written.cwd, 'F:\\proj')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('已存在会话按默认策略跳过', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-mover-import-'))
  try {
    const sessionRoot = join(dir, 'sessions')
    const result = await importSessionsToDisk({
      buffer: makePack(makeSessionBytes()),
      sessionRoot,
      pathMap: { byKey: { w1: '/target/proj' } },
      existingSessionIds: ['s1'],
    })
    assert.equal(result.written.length, 0)
    assert.deepEqual(result.skipped, ['s1'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('overwrite 策略先备份旧文件', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-mover-import-'))
  try {
    const sessionRoot = join(dir, 'sessions')
    const backupRoot = join(dir, 'backups')
    const target = join(sessionDir(sessionRoot, '/target/proj', 's1'), 'session.v4.jsonl.zstd')
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, Buffer.from('old-content'))

    const result = await importSessionsToDisk({
      buffer: makePack(makeSessionBytes()),
      sessionRoot,
      pathMap: { byKey: { w1: '/target/proj' } },
      existingSessionIds: ['s1'],
      policy: { session: 'overwrite' },
      backupRoot,
      now: new Date('2026-11-10T00:00:00Z'),
    })
    assert.equal(result.written[0].action, 'overwrite')
    assert.ok(result.written[0].backupPath)
    const backup = await readFile(result.written[0].backupPath)
    assert.equal(backup.toString(), 'old-content')
    const fresh = await readFile(target)
    assert.notEqual(fresh.toString(), 'old-content')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('new-id 策略生成新会话 id 并改写 header', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-mover-import-'))
  try {
    const sessionRoot = join(dir, 'sessions')
    const result = await importSessionsToDisk({
      buffer: makePack(makeSessionBytes()),
      sessionRoot,
      pathMap: { byKey: { w1: '/target/proj' } },
      existingSessionIds: ['s1'],
      policy: { session: 'new-id' },
    })
    assert.equal(result.written.length, 1)
    const written = result.written[0]
    assert.notEqual(written.targetId, 's1')
    assert.match(written.targetId, /^session-/)

    const data = await readFile(written.path)
    const frames = scanFrames(data)
    const header = JSON.parse(
      zlib
        .zstdDecompressSync(data.subarray(frames[0].start, frames[0].end))
        .toString('utf8')
        .slice(0, -1),
    )
    assert.equal(header.id, written.targetId)
    assert.equal(header.cwd, '/target/proj')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('缺少 manifest 或会话文件时报错', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-mover-import-'))
  try {
    const sessionRoot = join(dir, 'sessions')
    const emptyZip = createZip([{ name: 'README.txt', data: Buffer.from('x') }])
    await assert.rejects(
      () => importSessionsToDisk({ buffer: emptyZip, sessionRoot, pathMap: { byKey: {} } }),
      (error) => error instanceof MoverError && error.code === ERROR_CODES.PACK_INVALID,
    )

    const noSession = createZip([
      {
        name: 'manifest.json',
        data: Buffer.from(
          JSON.stringify({
            schemaVersion: 2,
            createdAt: '2026-11-10T15:30:00+08:00',
            source: { platform: 'win32', dshVersion: 'test', sessionFormat: 4 },
            mode: 'sessions',
            sessions: [
              {
                id: 's1',
                messageCount: 0,
                sizeBytes: 0,
                path: 'sessions/s1/session.v4.jsonl.zstd',
              },
            ],
            attachments: [],
            workspaces: [],
          }),
        ),
      },
    ])
    await assert.rejects(
      () => importSessionsToDisk({ buffer: noSession, sessionRoot, pathMap: { byKey: {} } }),
      (error) => error instanceof MoverError && error.code === ERROR_CODES.PACK_INVALID,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
