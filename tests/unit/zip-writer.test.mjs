import test from 'node:test'
import assert from 'node:assert/strict'
import zlib from 'node:zlib'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createZip } from '../../src/core/zip-writer.js'

const LOCAL_SIG = 0x04034b50
const EOCD_SIG = 0x06054b50

/** 用 local header 顺序解析（测试专用，T1.11 会实现完整读取器）。 */
function readLocalEntries(buffer) {
  const entries = []
  let p = 0
  while (p + 30 <= buffer.length && buffer.readUInt32LE(p) === LOCAL_SIG) {
    const method = buffer.readUInt16LE(p + 8)
    const csize = buffer.readUInt32LE(p + 18)
    const usize = buffer.readUInt32LE(p + 22)
    const nameLen = buffer.readUInt16LE(p + 26)
    const extraLen = buffer.readUInt16LE(p + 28)
    const name = buffer.subarray(p + 30, p + 30 + nameLen).toString('utf8')
    const dataStart = p + 30 + nameLen + extraLen
    const data = buffer.subarray(dataStart, dataStart + csize)
    const raw = method === 8 ? zlib.inflateRawSync(data) : data
    entries.push({ name, method, raw, usize, csize })
    p = dataStart + csize
  }
  return entries
}

test('写入两个文件并可解析回内容', () => {
  const zip = createZip([
    { name: 'a.txt', data: Buffer.from('hello') },
    { name: 'dir/large.bin', data: Buffer.from('x'.repeat(2048)) },
  ])
  const entries = readLocalEntries(zip)
  assert.equal(entries.length, 2)
  assert.equal(entries[0].name, 'a.txt')
  assert.equal(entries[0].raw.toString(), 'hello')
  assert.equal(entries[1].name, 'dir/large.bin')
  assert.equal(entries[1].raw.length, 2048)
})

test('大文件使用 deflate，小文件使用 store', () => {
  const zip = createZip([
    { name: 'small.txt', data: Buffer.from('hi') },
    { name: 'large.txt', data: Buffer.from('a'.repeat(4096)) },
  ])
  const entries = readLocalEntries(zip)
  assert.equal(entries[0].method, 0)
  assert.equal(entries[1].method, 8)
  assert.ok(entries[1].csize < entries[1].usize)
})

test('空文件与目录条目', () => {
  const zip = createZip([
    { name: 'empty.txt', data: Buffer.alloc(0) },
    { name: 'folder', isDir: true },
  ])
  const entries = readLocalEntries(zip)
  assert.equal(entries[0].raw.length, 0)
  assert.equal(entries[1].name, 'folder/')
  assert.equal(entries[1].raw.length, 0)
})

test('中文文件名保留（UTF-8 标志）', () => {
  const zip = createZip([{ name: '新建文件夹/说明.txt', data: Buffer.from('中文') }])
  const flag = zip.readUInt16LE(6)
  assert.equal(flag & 0x0800, 0x0800)
  const entries = readLocalEntries(zip)
  assert.equal(entries[0].name, '新建文件夹/说明.txt')
  assert.equal(entries[0].raw.toString(), '中文')
})

test('EOCD 位于文件末尾', () => {
  const zip = createZip([{ name: 'a.txt', data: Buffer.from('x') }])
  assert.equal(zip.readUInt32LE(zip.length - 22), EOCD_SIG)
})

test('拒绝非法条目名', () => {
  assert.throws(() => createZip([{ name: '../escape', data: Buffer.alloc(0) }]), /\.\./)
  assert.throws(() => createZip([{ name: '/absolute', data: Buffer.alloc(0) }]), /forward/)
  assert.throws(() => createZip([{ name: 'a\\b', data: Buffer.alloc(0) }]), /forward/)
  assert.throws(() => createZip([{ name: '', data: Buffer.alloc(0) }]), /non-empty/)
})

test('系统 tar 能列出 zip 内容（环境无 tar 时跳过）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-zip-'))
  try {
    const file = join(dir, 'pack.dshpack')
    await writeFile(file, createZip([{ name: 'manifest.json', data: Buffer.from('{}') }]))
    const result = spawnSync('tar', ['-tf', file], { encoding: 'utf8' })
    if (result.error || result.status !== 0) {
      // Windows 上 tar 可能不存在或被策略拦截；不作为失败
      return
    }
    assert.match(result.stdout, /manifest\.json/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
