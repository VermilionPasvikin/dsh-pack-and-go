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

function makeSessionBytes({ cwd = 'F:\\proj', version = 4, id = 's1', parentSession } = {}) {
  const header = {
    type: 'session',
    version,
    id,
    createdAt: 1700000000000,
    isSeeded: false,
    delegationDepth: 0,
    cwd,
    ...(parentSession !== undefined ? { parentSession } : {}),
  }
  return Buffer.concat([
    zlib.zstdCompressSync(Buffer.from(`${JSON.stringify(header)}\n`)),
    zlib.zstdCompressSync(Buffer.from('{"type":"turn/start","seq":0}\n')),
    zlib.zstdCompressSync(Buffer.from('{"type":"turn/end","seq":1}\n')),
  ])
}

function makeForkPack(parentBytes, childBytes) {
  const manifest = {
    schemaVersion: 2,
    createdAt: '2026-11-10T15:30:00+08:00',
    source: { platform: 'win32', dshVersion: 'test', sessionFormat: 4 },
    mode: 'sessions',
    sessions: [
      {
        id: 'parent-1',
        title: '父会话',
        cwd: 'F:\\proj',
        messageCount: 1,
        sizeBytes: parentBytes.length,
        path: 'sessions/parent-1/session.v4.jsonl.zstd',
      },
      {
        id: 'child-1',
        title: '子会话',
        parentSessionId: 'parent-1',
        cwd: 'F:\\proj',
        messageCount: 1,
        sizeBytes: childBytes.length,
        path: 'sessions/child-1/session.v4.jsonl.zstd',
      },
    ],
    attachments: [],
    workspaces: [],
  }
  return createZip([
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest), 'utf8') },
    { name: 'sessions/parent-1/session.v4.jsonl.zstd', data: parentBytes },
    { name: 'sessions/child-1/session.v4.jsonl.zstd', data: childBytes },
  ])
}

function makeLegacyPack() {
  const bytes = makeSessionBytes({ version: 3 })
  const manifest = {
    schemaVersion: 2,
    createdAt: '2026-11-10T15:30:00+08:00',
    source: { platform: 'win32', dshVersion: 'test', sessionFormat: 3 },
    mode: 'sessions',
    sessions: [
      {
        id: 's1',
        title: '旧格式',
        cwd: 'F:\\proj',
        messageCount: 1,
        sizeBytes: bytes.length,
        path: 'sessions/s1/session.v3.jsonl.zstd',
      },
    ],
    attachments: [],
    workspaces: [],
  }
  return createZip([
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest), 'utf8') },
    { name: 'sessions/s1/session.v3.jsonl.zstd', data: bytes },
  ])
}

test('旧格式包（sessionFormat 3）直接写入 v3 会话文件', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-import-'))
  try {
    const sessionRoot = join(dir, 'sessions')
    await mkdir(sessionRoot, { recursive: true })
    const result = await importSessionsToDisk({
      buffer: makeLegacyPack(),
      sessionRoot,
      pathMap: { byKey: {} },
      existingSessionIds: [],
    })
    assert.equal(result.written.length, 1)
    assert.ok(result.written[0].path.endsWith('session.v3.jsonl.zstd'))
    const data = await readFile(result.written[0].path)
    const frames = scanFrames(data)
    const header = JSON.parse(
      zlib
        .zstdDecompressSync(data.subarray(frames[0].start, frames[0].end))
        .toString('utf8')
        .slice(0, -1),
    )
    assert.equal(header.version, 3)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('fork 链：new-id 导入时子会话 parentSession 映射到新父 id', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-import-'))
  try {
    const sessionRoot = join(dir, 'sessions')
    await mkdir(sessionRoot, { recursive: true })
    const parentBytes = makeSessionBytes({ id: 'parent-1' })
    const childBytes = makeSessionBytes({ id: 'child-1', parentSession: 'parent-1' })
    const result = await importSessionsToDisk({
      buffer: makeForkPack(parentBytes, childBytes),
      sessionRoot,
      pathMap: { byKey: {} },
      existingSessionIds: ['parent-1', 'child-1'],
      policy: { session: 'new-id' },
    })
    assert.equal(result.written.length, 2)
    const parent = result.written.find((item) => item.id === 'parent-1')
    const child = result.written.find((item) => item.id === 'child-1')
    assert.ok(parent && child)
    assert.notEqual(parent.targetId, 'parent-1')
    const childData = await readFile(child.path)
    const childFrames = scanFrames(childData)
    const childHeader = JSON.parse(
      zlib
        .zstdDecompressSync(childData.subarray(childFrames[0].start, childFrames[0].end))
        .toString('utf8')
        .slice(0, -1),
    )
    assert.equal(childHeader.parentSession, parent.targetId)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

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
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-import-'))
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
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-import-'))
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
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-import-'))
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
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-import-'))
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

test('overwrite 覆盖写入并保持原 id（cwd 对齐目标）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-import-'))
  try {
    const sessionRoot = join(dir, 'sessions')
    const result = await importSessionsToDisk({
      buffer: makePack(makeSessionBytes()),
      sessionRoot,
      pathMap: { byKey: { w1: '/target/proj' } },
      existingSessionIds: ['s1'],
      existingCwdById: new Map([['s1', '/target/proj']]),
      policy: { session: 'overwrite' },
    })
    assert.equal(result.written.length, 1)
    const written = result.written[0]
    assert.equal(written.targetId, 's1')
    assert.equal(written.action, 'overwrite')

    const data = await readFile(written.path)
    const frames = scanFrames(data)
    const header = JSON.parse(
      zlib
        .zstdDecompressSync(data.subarray(frames[0].start, frames[0].end))
        .toString('utf8')
        .slice(0, -1),
    )
    assert.equal(header.id, 's1')
    assert.equal(header.cwd, '/target/proj')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('缺少 manifest 或会话文件时报错', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-import-'))
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

// ---- 跨平台导入改写 working-directory/change（ADR-0017） ----

function makeEventSessionBytes({ cwd = 'F:\\proj', events = [] } = {}) {
  const header = {
    type: 'session',
    version: 4,
    id: 's1',
    createdAt: 1700000000000,
    isSeeded: false,
    delegationDepth: 0,
    cwd,
  }
  return Buffer.concat([
    zlib.zstdCompressSync(Buffer.from(`${JSON.stringify(header)}\n`)),
    ...events.map((event) => zlib.zstdCompressSync(Buffer.from(`${JSON.stringify(event)}\n`))),
  ])
}

function decodeEvents(buffer) {
  return Buffer.concat(
    scanFrames(buffer).map((frame) => zlib.zstdDecompressSync(buffer.subarray(frame.start, frame.end))),
  )
    .toString('utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line))
}

test('跨平台导入改写 working-directory/change 事件 cwd（ADR-0017）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-import-'))
  try {
    const sessionRoot = join(dir, 'sessions')
    await mkdir(sessionRoot, { recursive: true })
    const bytes = makeEventSessionBytes({
      events: [
        { type: 'working-directory/change', seq: 2, data: { cwd: 'F:\\proj\\src' } },
        { type: 'turn/end', seq: 3 },
      ],
    })
    const result = await importSessionsToDisk({
      buffer: makePack(bytes),
      sessionRoot,
      pathMap: { byKey: { w1: '/target/proj' } },
      targetPlatform: 'linux',
    })
    const written = result.written[0]
    assert.equal(written.cwdEventsRewritten, 1)

    const events = decodeEvents(await readFile(written.path))
    const header = events[0]
    assert.equal(header.cwd, '/target/proj')
    const change = events.find((event) => event.type === 'working-directory/change')
    assert.equal(change.data.cwd, '/target/proj/src')
    assert.deepEqual(events.find((event) => event.type === 'turn/end'), { type: 'turn/end', seq: 3 })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('跨平台导入改写 deliverables/presented 路径与 tool meta.cwd（ADR-0017 补充）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-import-'))
  try {
    const sessionRoot = join(dir, 'sessions')
    await mkdir(sessionRoot, { recursive: true })
    const bytes = makeEventSessionBytes({
      events: [
        {
          type: 'deliverables/presented',
          seq: 2,
          data: {
            files: [{ path: 'F:\\proj\\docs\\a.md' }, { path: 'F:\\proj\\AGENTS.md' }],
          },
        },
        { type: 'tool/result', seq: 3, data: { meta: { cwd: 'F:\\proj' } } },
        { type: 'turn/end', seq: 4 },
      ],
    })
    const result = await importSessionsToDisk({
      buffer: makePack(bytes),
      sessionRoot,
      pathMap: { byKey: { w1: '/target/proj' } },
      targetPlatform: 'linux',
    })
    const written = result.written[0]
    assert.equal(written.fileRefsRewritten, 2)

    const events = decodeEvents(await readFile(written.path))
    assert.equal(events[0].cwd, '/target/proj')
    const presented = events.find((event) => event.type === 'deliverables/presented')
    assert.deepEqual(
      presented.data.files.map((file) => file.path),
      ['docs/a.md', 'AGENTS.md'],
    )
    assert.equal(events.find((event) => event.type === 'tool/result').data.meta.cwd, '/target/proj')
    assert.deepEqual(events.find((event) => event.type === 'turn/end'), { type: 'turn/end', seq: 4 })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('跨平台导入归一化 auto 权限预设（ADR-0017 补充二）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-import-'))
  try {
    const sessionRoot = join(dir, 'sessions')
    await mkdir(sessionRoot, { recursive: true })
    const bytes = makeEventSessionBytes({
      events: [
        { type: 'permission/preset', seq: 2, data: { preset: 'auto' } },
        { type: 'sandbox/mode', seq: 3, data: { mode: 'danger-full-access' } },
        { type: 'approval/policy', seq: 4, data: { policy: 'never' } },
        { type: 'turn/end', seq: 5 },
      ],
    })
    const result = await importSessionsToDisk({
      buffer: makePack(bytes),
      sessionRoot,
      pathMap: { byKey: { w1: '/target/proj' } },
      targetPlatform: 'linux',
    })
    const written = result.written[0]
    assert.equal(written.agentStateRewritten, 3)
    const events = decodeEvents(await readFile(written.path))
    assert.equal(events.find((event) => event.type === 'permission/preset').data.preset, 'workspace-write')
    assert.equal(events.find((event) => event.type === 'sandbox/mode').data.mode, 'workspace-write')
    assert.equal(events.find((event) => event.type === 'approval/policy').data.policy, 'ask')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('同平台导入不改写事件字节（ADR-0007 保真）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-import-'))
  try {
    const sessionRoot = join(dir, 'sessions')
    await mkdir(sessionRoot, { recursive: true })
    const bytes = makeEventSessionBytes({
      events: [{ type: 'working-directory/change', seq: 2, data: { cwd: 'F:\\proj\\src' } }],
    })
    const result = await importSessionsToDisk({
      buffer: makePack(bytes),
      sessionRoot,
      pathMap: { byKey: { w1: 'C:\\target\\proj' } },
      targetPlatform: 'win32',
    })
    const written = result.written[0]
    assert.equal(written.cwdEventsRewritten, undefined)

    const events = decodeEvents(await readFile(written.path))
    assert.equal(events[0].cwd, 'C:\\target\\proj')
    assert.equal(
      events.find((event) => event.type === 'working-directory/change').data.cwd,
      'F:\\proj\\src',
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('无 targetCwd 的会话不改写事件（保持旧行为）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-import-'))
  try {
    const sessionRoot = join(dir, 'sessions')
    const bytes = makeEventSessionBytes({
      events: [{ type: 'working-directory/change', seq: 2, data: { cwd: 'F:\\proj\\src' } }],
    })
    const result = await importSessionsToDisk({
      buffer: makePackNoWorkspace(bytes),
      sessionRoot,
      pathMap: { byKey: {} },
      targetPlatform: 'linux',
    })
    const written = result.written[0]
    assert.equal(written.cwdEventsRewritten, undefined)
    assert.equal(written.cwd, 'F:\\proj')
    const events = decodeEvents(await readFile(written.path))
    assert.equal(
      events.find((event) => event.type === 'working-directory/change').data.cwd,
      'F:\\proj\\src',
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
