import test from 'node:test'
import assert from 'node:assert/strict'
import zlib from 'node:zlib'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { rewriteSessionCwd, rewriteSessionCwdFile } from '../../src/core/session-rewrite.js'
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
  const dir = await mkdtemp(join(tmpdir(), 'dsh-mover-session-'))
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
