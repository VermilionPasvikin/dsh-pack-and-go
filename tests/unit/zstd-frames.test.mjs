import test from 'node:test'
import assert from 'node:assert/strict'
import zlib from 'node:zlib'

import {
  scanFrames,
  frameChecksumFlag,
  ZSTD_FRAME_MAGIC,
} from '../../src/core/zstd-frames.js'
import { ERROR_CODES, MoverError } from '../../src/core/errors.js'

function zstd(text) {
  return zlib.zstdCompressSync(Buffer.from(text, 'utf8'))
}

function expectFrameError(fn) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof MoverError, `expected MoverError, got ${error?.constructor?.name}`)
    assert.equal(error.code, ERROR_CODES.SESSION_FRAME_INVALID)
    return true
  })
}

test('单帧：起止偏移覆盖整个 buffer', () => {
  const buffer = zstd('hello')
  const frames = scanFrames(buffer)
  assert.equal(frames.length, 1)
  assert.equal(frames[0].start, 0)
  assert.equal(frames[0].end, buffer.length)
  assert.equal(frames[0].length, buffer.length)
})

test('多帧拼接：header 帧 + 事件帧 + 尾帧', () => {
  const parts = [zstd('{"type":"session"}\n'), zstd('{"type":"turn/start"}\n'), zstd('{"type":"turn/end"}\n')]
  const buffer = Buffer.concat(parts)
  const frames = scanFrames(buffer)
  assert.equal(frames.length, 3)
  assert.equal(frames[0].start, 0)
  assert.equal(frames[0].end, parts[0].length)
  assert.equal(frames[1].start, parts[0].length)
  assert.equal(frames[1].end, parts[0].length + parts[1].length)
  assert.equal(frames[2].start, parts[0].length + parts[1].length)
  assert.equal(frames[2].end, buffer.length)
})

test('带内容校验和的帧被正确识别', () => {
  const buffer = zlib.zstdCompressSync(Buffer.from('x'), {
    params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 },
  })
  const frames = scanFrames(buffer)
  assert.equal(frames.length, 1)
  assert.equal(frames[0].checksum, true)
  assert.equal(frames[0].end, buffer.length)
})

test('无校验和的帧 checksum=false', () => {
  const frames = scanFrames(zstd('x'))
  assert.equal(frames[0].checksum, false)
})

test('截断帧报 E_SESSION_FRAME_INVALID', () => {
  const buffer = zstd('hello world')
  expectFrameError(() => scanFrames(buffer.subarray(0, buffer.length - 3)))
})

test('损坏 magic 报 E_SESSION_FRAME_INVALID', () => {
  const buffer = zstd('hello')
  buffer[0] ^= 0xff
  expectFrameError(() => scanFrames(buffer))
})

test('空 buffer 返回空数组', () => {
  assert.deepEqual(scanFrames(Buffer.alloc(0)), [])
})

test('手工构造 raw 块帧也能被扫描', () => {
  // magic(4) + FHD=0x00 + window(1) + block header(last=1,type=0,size=3) + 'abc'
  const raw = Buffer.from([
    0x28, 0xb5, 0x2f, 0xfd,
    0x00,
    0x00,
    0x19, 0x00, 0x00,
    0x61, 0x62, 0x63,
  ])
  const frames = scanFrames(raw)
  assert.equal(frames.length, 1)
  assert.equal(frames[0].length, raw.length)
})

test('保留块类型报错', () => {
  // block header: last=1, type=3(reserved), size=0 -> bh = 1 | (3<<1) = 7
  const raw = Buffer.from([
    0x28, 0xb5, 0x2f, 0xfd,
    0x00,
    0x00,
    0x07, 0x00, 0x00,
  ])
  expectFrameError(() => scanFrames(raw))
})

test('frameChecksumFlag 读取单帧标志', () => {
  const plain = zstd('x')
  const withChecksum = zlib.zstdCompressSync(Buffer.from('x'), {
    params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 },
  })
  assert.equal(frameChecksumFlag(plain, scanFrames(plain)[0]), false)
  assert.equal(frameChecksumFlag(withChecksum, scanFrames(withChecksum)[0]), true)
})

test('magic 常量与文件头一致', () => {
  assert.equal(ZSTD_FRAME_MAGIC, 0xfd2fb528)
  assert.equal(zstd('x').readUInt32LE(0), ZSTD_FRAME_MAGIC)
})
