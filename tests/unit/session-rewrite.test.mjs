import test from 'node:test'
import assert from 'node:assert/strict'
import zlib from 'node:zlib'
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  mapSessionCwd,
  rewriteSessionCwd,
  rewriteSessionCwdFile,
  rewriteSessionWorkingDirectories,
  rewriteSessionFileReferences,
  repairSessionFileReferences,
  normalizeSessionAgentState,
  readSessionHeaderFromBuffer,
} from '../../src/core/session-rewrite.js'
import { scanFrames } from '../../src/core/zstd-frames.js'
import { ERROR_CODES, MoverError } from '../../src/core/errors.js'

function zstd(text, options) {
  return zlib.zstdCompressSync(Buffer.from(text, 'utf8'), options)
}

function makeSession({ cwd = 'C:\\old\\project', version = 4, checksum = false } = {}) {
  const header = {
    type: 'session',
    version,
    id: 'session-1',
    createdAt: 1700000000000,
    isSeeded: false,
    delegationDepth: 0,
  }
  if (cwd !== undefined) header.cwd = cwd
  const options = checksum
    ? { params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 } }
    : undefined
  const parts = [
    zstd(`${JSON.stringify(header)}\n`, options),
    zstd('{"type":"turn/start","seq":0}\n'),
    zstd('{"type":"assistant/message","seq":1}\n'),
    zstd('{"type":"turn/end","seq":2}\n'),
  ]
  return { header, buffer: Buffer.concat(parts), parts }
}

function decodeLines(buffer) {
  return Buffer.concat(
    scanFrames(buffer).map((frame) => zlib.zstdDecompressSync(buffer.subarray(frame.start, frame.end))),
  )
    .toString('utf8')
    .split('\n')
    .filter((line) => line.length > 0)
}

test('改写后帧数不变', () => {
  const { buffer } = makeSession()
  const out = rewriteSessionCwd(buffer, '/home/me/project')
  assert.equal(scanFrames(out).length, scanFrames(buffer).length)
})

test('header 的 cwd 被改写且其余字段保留', () => {
  const { buffer, header } = makeSession()
  const out = rewriteSessionCwd(buffer, '/home/me/project')
  const first = scanFrames(out)[0]
  const decoded = zlib.zstdDecompressSync(out.subarray(first.start, first.end)).toString('utf8')
  const rewritten = JSON.parse(decoded.slice(0, -1))
  assert.equal(rewritten.cwd, '/home/me/project')
  assert.equal(rewritten.id, header.id)
  assert.equal(rewritten.version, 4)
  assert.equal(rewritten.createdAt, header.createdAt)
})

test('其余帧字节完全一致', () => {
  const { buffer } = makeSession()
  const beforeFirstEnd = scanFrames(buffer)[0].end
  const out = rewriteSessionCwd(buffer, '/home/me/project')
  const afterFirstEnd = scanFrames(out)[0].end
  const before = buffer.subarray(beforeFirstEnd)
  const after = out.subarray(afterFirstEnd)
  assert.equal(Buffer.compare(before, after), 0)
})

test('事件行数不变', () => {
  const { buffer } = makeSession()
  const out = rewriteSessionCwd(buffer, '/home/me/project')
  assert.equal(decodeLines(out).length, decodeLines(buffer).length)
})

test('无 cwd 的会话可以补上 cwd', () => {
  const { buffer } = makeSession({ cwd: undefined })
  const out = rewriteSessionCwd(buffer, '/home/me/project')
  const first = scanFrames(out)[0]
  const decoded = JSON.parse(
    zlib.zstdDecompressSync(out.subarray(first.start, first.end)).toString('utf8').slice(0, -1),
  )
  assert.equal(decoded.cwd, '/home/me/project')
})

test('跨版本会话拒绝改写（应走方案 C）', () => {
  const { buffer } = makeSession({ version: 3 })
  assert.throws(
    () => rewriteSessionCwd(buffer, '/home/me/project'),
    (error) =>
      error instanceof MoverError && error.code === ERROR_CODES.SESSION_VERSION_UNSUPPORTED,
  )
})

test('非 session 首行报 E_SESSION_HEADER_INVALID', () => {
  const buffer = zstd('{"type":"turn/start","seq":0}\n')
  assert.throws(
    () => rewriteSessionCwd(buffer, '/x'),
    (error) => error instanceof MoverError && error.code === ERROR_CODES.SESSION_HEADER_INVALID,
  )
})

test('空输入与非法 cwd 报错', () => {
  assert.throws(
    () => rewriteSessionCwd(Buffer.alloc(0), '/x'),
    (error) => error instanceof MoverError && error.code === ERROR_CODES.SESSION_HEADER_INVALID,
  )
  const { buffer } = makeSession()
  assert.throws(
    () => rewriteSessionCwd(buffer, ''),
    (error) => error instanceof MoverError && error.code === ERROR_CODES.SESSION_HEADER_INVALID,
  )
})

test('带 checksum 的首帧改写后仍保留 checksum', () => {
  const { buffer } = makeSession({ checksum: true })
  const before = scanFrames(buffer)[0]
  assert.equal(before.checksum, true)
  const out = rewriteSessionCwd(buffer, '/home/me/project')
  assert.equal(scanFrames(out)[0].checksum, true)
})

test('文件版：读取、改写、写入并可再扫描', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-session-'))
  try {
    const src = join(dir, 'session.v4.jsonl.zstd')
    const dst = join(dir, 'session.out.v4.jsonl.zstd')
    const { buffer } = makeSession()
    await writeFile(src, buffer)
    const result = await rewriteSessionCwdFile(src, dst, '/home/me/project')
    assert.ok(result.bytesWritten > 0)
    assert.equal(result.frames, scanFrames(buffer).length)
    const out = await readFile(dst)
    const first = scanFrames(out)[0]
    const decoded = JSON.parse(
      zlib.zstdDecompressSync(out.subarray(first.start, first.end)).toString('utf8').slice(0, -1),
    )
    assert.equal(decoded.cwd, '/home/me/project')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// ---- working-directory/change 跨平台改写（ADR-0017） ----

function zstdEvent(event, checksum = false) {
  const options = checksum ? { params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 } } : undefined
  return zstd(`${JSON.stringify(event)}\n`, options)
}

function makeEventSession({ cwd = 'F:\\old\\project', events = [], checksum = false } = {}) {
  const parts = [makeSession({ cwd, checksum }).parts[0]]
  for (const event of events) parts.push(zstdEvent(event, checksum))
  return Buffer.concat(parts)
}

function decodeEventLines(buffer) {
  return decodeLines(buffer).slice(1).map((line) => JSON.parse(line))
}

const WIN_TO_POSIX = Object.freeze({
  fromCwd: 'F:\\old\\project',
  toCwd: '/home/me/project',
  sourcePlatform: 'win32',
  targetPlatform: 'linux',
})

test('mapSessionCwd：Windows 根与子路径映射到 POSIX 目标', () => {
  assert.equal(mapSessionCwd('F:\\old\\project', WIN_TO_POSIX), '/home/me/project')
  assert.equal(
    mapSessionCwd('F:\\old\\project\\src\\a.js', WIN_TO_POSIX),
    '/home/me/project/src/a.js',
  )
  assert.equal(mapSessionCwd('f:\\OLD\\PROJECT\\Sub', WIN_TO_POSIX), '/home/me/project/Sub')
  assert.equal(mapSessionCwd('F:\\old\\project\\\\', WIN_TO_POSIX), '/home/me/project')
  assert.equal(mapSessionCwd('D:\\other', WIN_TO_POSIX), '/home/me/project')
})

test('mapSessionCwd：POSIX → Windows 转换分隔符', () => {
  const input = {
    fromCwd: '/home/me/project',
    toCwd: 'C:\\work\\proj',
    sourcePlatform: 'linux',
    targetPlatform: 'win32',
  }
  assert.equal(mapSessionCwd('/home/me/project/src/a.js', input), 'C:\\work\\proj\\src\\a.js')
  assert.equal(mapSessionCwd('/home/me/project', input), 'C:\\work\\proj')
  assert.equal(mapSessionCwd('/elsewhere', input), 'C:\\work\\proj')
})

test('mapSessionCwd：已迁移到目标根的路径保持不变（幂等）', () => {
  assert.equal(
    mapSessionCwd('/home/me/project/src/a.js', WIN_TO_POSIX),
    '/home/me/project/src/a.js',
  )
})

test('rewriteSessionWorkingDirectories 只改写 working-directory/change', () => {
  const buffer = makeEventSession({
    events: [
      { type: 'turn/start', seq: 0 },
      { type: 'working-directory/change', seq: 1, data: { cwd: 'F:\\old\\project\\src' } },
      { type: 'command/run', seq: 2, data: { cwd: 'F:\\old\\project' } },
      { type: 'working-directory/change', seq: 3, data: { cwd: 'D:\\elsewhere' } },
      { type: 'turn/end', seq: 4 },
    ],
  })
  const result = rewriteSessionWorkingDirectories(buffer, WIN_TO_POSIX)
  assert.equal(result.rewritten, 2)

  const events = decodeEventLines(result.buffer)
  assert.equal(events.length, 5)
  assert.deepEqual(events[0], { type: 'turn/start', seq: 0 })
  assert.equal(events[1].data.cwd, '/home/me/project/src')
  assert.deepEqual(events[2], {
    type: 'command/run',
    seq: 2,
    data: { cwd: 'F:\\old\\project' },
  })
  assert.equal(events[3].data.cwd, '/home/me/project')
  assert.deepEqual(events[4], { type: 'turn/end', seq: 4 })

  // header 帧字节完全不变
  const before = scanFrames(buffer)[0]
  const after = scanFrames(result.buffer)[0]
  assert.equal(
    Buffer.compare(
      buffer.subarray(before.start, before.end),
      result.buffer.subarray(after.start, after.end),
    ),
    0,
  )
})

test('没有目标事件或值未变化时返回原 Buffer', () => {
  const plain = makeEventSession({ events: [{ type: 'turn/start', seq: 0 }] })
  const first = rewriteSessionWorkingDirectories(plain, WIN_TO_POSIX)
  assert.equal(first.rewritten, 0)
  assert.equal(first.buffer, plain)

  const already = makeEventSession({
    events: [{ type: 'working-directory/change', seq: 1, data: { cwd: '/home/me/project/sub' } }],
  })
  const second = rewriteSessionWorkingDirectories(already, WIN_TO_POSIX)
  assert.equal(second.rewritten, 0)
  assert.equal(second.buffer, already)
})

test('只有 header 帧的会话原样返回', () => {
  const headerOnly = makeSession().parts[0]
  const result = rewriteSessionWorkingDirectories(headerOnly, WIN_TO_POSIX)
  assert.equal(result.rewritten, 0)
  assert.equal(result.buffer, headerOnly)
})

test('事件帧 checksum 标志在重压后保留', () => {
  const buffer = makeEventSession({
    checksum: true,
    events: [{ type: 'working-directory/change', seq: 1, data: { cwd: 'F:\\old\\project\\x' } }],
  })
  const result = rewriteSessionWorkingDirectories(buffer, WIN_TO_POSIX)
  assert.equal(result.rewritten, 1)
  for (const frame of scanFrames(result.buffer)) assert.equal(frame.checksum, true)
})

test('chunkBytes 控制事件帧分块且按行边界', () => {
  const long = 'x'.repeat(400)
  const buffer = makeEventSession({
    events: [
      { type: 'working-directory/change', seq: 1, data: { cwd: `F:\\old\\project\\${long}` } },
      { type: 'turn/start', seq: 2 },
    ],
  })
  const result = rewriteSessionWorkingDirectories(buffer, { ...WIN_TO_POSIX, chunkBytes: 200 })
  assert.ok(scanFrames(result.buffer).length > 2)
  const events = decodeEventLines(result.buffer)
  assert.equal(events.length, 2)
  assert.equal(events[0].data.cwd, `/home/me/project/${long}`)
})

test('rewriteSessionWorkingDirectories 参数与版本校验', () => {
  const buffer = makeEventSession({ events: [{ type: 'turn/start', seq: 0 }] })
  assert.throws(
    () => rewriteSessionWorkingDirectories(buffer, { ...WIN_TO_POSIX, toCwd: '' }),
    (error) => error instanceof MoverError && error.code === ERROR_CODES.SESSION_HEADER_INVALID,
  )
  assert.throws(
    () => rewriteSessionWorkingDirectories(buffer, { ...WIN_TO_POSIX, targetPlatform: 'plan9' }),
    (error) => error instanceof MoverError && error.code === ERROR_CODES.SESSION_HEADER_INVALID,
  )
  assert.throws(
    () => rewriteSessionWorkingDirectories(buffer, { ...WIN_TO_POSIX, chunkBytes: 0 }),
    (error) => error instanceof MoverError && error.code === ERROR_CODES.SESSION_HEADER_INVALID,
  )
  const v3 = makeSession({ version: 3 }).parts[0]
  assert.throws(
    () => rewriteSessionWorkingDirectories(v3, WIN_TO_POSIX),
    (error) => error instanceof MoverError && error.code === ERROR_CODES.SESSION_VERSION_UNSUPPORTED,
  )
  assert.throws(
    () => rewriteSessionWorkingDirectories('not a buffer', WIN_TO_POSIX),
    (error) => error instanceof MoverError && error.code === ERROR_CODES.SESSION_HEADER_INVALID,
  )
})

function makeEventsSession(events, { cwd = 'F:\\proj', checksum = false } = {}) {
  const header = {
    type: 'session',
    version: 4,
    id: 'session-1',
    createdAt: 1700000000000,
    isSeeded: false,
    delegationDepth: 0,
    cwd,
  }
  const options = checksum
    ? { params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 } }
    : undefined
  return Buffer.concat([
    zstd(`${JSON.stringify(header)}\n`, options),
    ...events.map((event) => zstd(`${JSON.stringify(event)}\n`, options)),
  ])
}

test('改写 deliverables/presented 路径与 tool meta.cwd（ADR-0017 补充）', () => {
  const buffer = makeEventsSession([
    {
      type: 'deliverables/presented',
      seq: 2,
      data: {
        files: [
          { path: 'F:\\proj\\docs\\a.md' },
          { path: 'F:\\proj\\AGENTS.md' },
          { path: 'docs/relative.md' },
        ],
      },
    },
    { type: 'tool/result', seq: 3, data: { meta: { cwd: 'F:\\proj' } } },
    { type: 'user/message', seq: 4, data: { text: 'F:\\proj\\docs\\a.md' } },
  ])
  const result = rewriteSessionFileReferences(buffer, {
    fromCwd: 'F:\\proj',
    toCwd: '/home/u/proj',
    sourcePlatform: 'win32',
    targetPlatform: 'linux',
  })
  assert.equal(result.rewritten, 2)
  const events = decodeLines(result.buffer).map((line) => JSON.parse(line))
  const presented = events.find((event) => event.type === 'deliverables/presented')
  assert.deepEqual(
    presented.data.files.map((file) => file.path),
    ['docs/a.md', 'AGENTS.md', 'docs/relative.md'],
  )
  assert.equal(events.find((event) => event.type === 'tool/result').data.meta.cwd, '/home/u/proj')
  assert.equal(
    events.find((event) => event.type === 'user/message').data.text,
    'F:\\proj\\docs\\a.md',
  )
  const headerBefore = scanFrames(buffer)[0]
  const headerAfter = scanFrames(result.buffer)[0]
  assert.deepEqual(
    buffer.subarray(headerBefore.start, headerBefore.end),
    result.buffer.subarray(headerAfter.start, headerAfter.end),
  )
  const again = rewriteSessionFileReferences(result.buffer, {
    fromCwd: 'F:\\proj',
    toCwd: '/home/u/proj',
    sourcePlatform: 'win32',
    targetPlatform: 'linux',
  })
  assert.equal(again.rewritten, 0)
})

test('repairSessionFileReferences 按最长后缀修复绝对路径', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-repair-'))
  try {
    await mkdir(join(dir, 'docs'), { recursive: true })
    await writeFile(join(dir, 'docs', 'a.md'), 'x')
    await writeFile(join(dir, 'AGENTS.md'), 'y')
    const buffer = makeEventsSession([
      {
        type: 'deliverables/presented',
        seq: 2,
        data: {
          files: [
            { path: 'F:\\PersonalProjects\\proj\\docs\\a.md' },
            { path: 'F:\\PersonalProjects\\proj\\AGENTS.md' },
          ],
        },
      },
      { type: 'tool/result', seq: 3, data: { meta: { cwd: 'F:\\PersonalProjects\\proj' } } },
    ])
    const exists = (relative) => existsSync(join(dir, relative))
    const result = repairSessionFileReferences(buffer, { sessionCwd: dir, exists })
    assert.equal(result.rewritten, 2)
    const events = decodeLines(result.buffer).map((line) => JSON.parse(line))
    const presented = events.find((event) => event.type === 'deliverables/presented')
    assert.deepEqual(
      presented.data.files.map((file) => file.path),
      ['docs/a.md', 'AGENTS.md'],
    )
    assert.equal(events.find((event) => event.type === 'tool/result').data.meta.cwd, dir)
    assert.equal(readSessionHeaderFromBuffer(result.buffer).cwd, 'F:\\proj')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('normalizeSessionAgentState 归一化 auto 权限预设', () => {
  const buffer = makeEventsSession([
    { type: 'permission/preset', seq: 2, data: { preset: 'workspace-write' } },
    { type: 'sandbox/mode', seq: 3, data: { mode: 'workspace-write' } },
    { type: 'permission/preset', seq: 4, data: { preset: 'auto' } },
    { type: 'sandbox/mode', seq: 5, data: { mode: 'danger-full-access' } },
    { type: 'approval/policy', seq: 6, data: { policy: 'never' } },
    { type: 'turn/end', seq: 7 },
  ])
  const result = normalizeSessionAgentState(buffer)
  assert.equal(result.rewritten, 3)
  const events = decodeLines(result.buffer).map((line) => JSON.parse(line))
  assert.deepEqual(
    events.filter((event) => event.type === 'permission/preset').map((event) => event.data.preset),
    ['workspace-write', 'workspace-write'],
  )
  assert.deepEqual(
    events.filter((event) => event.type === 'sandbox/mode').map((event) => event.data.mode),
    ['workspace-write', 'workspace-write'],
  )
  assert.equal(events.find((event) => event.type === 'approval/policy').data.policy, 'ask')
  assert.equal(events.find((event) => event.type === 'turn/end').seq, 7)

  const plain = makeEventsSession([{ type: 'turn/end', seq: 2 }])
  const plainResult = normalizeSessionAgentState(plain)
  assert.equal(plainResult.rewritten, 0)
  assert.deepEqual(plainResult.buffer, plain)
})
