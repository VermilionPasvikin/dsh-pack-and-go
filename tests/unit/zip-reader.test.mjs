import test from 'node:test'
import assert from 'node:assert/strict'

import { createZip } from '../../src/core/zip-writer.js'
import { readZip, listZip, readCentralDirectory, readZipEntry, assertSafeEntryName } from '../../src/core/zip-reader.js'
import { ERROR_CODES, MoverError } from '../../src/core/errors.js'

function expectPackError(fn) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof MoverError, `expected MoverError, got ${error?.constructor?.name}`)
    assert.equal(error.code, ERROR_CODES.PACK_INVALID)
    return true
  })
}

/** 在 zip 中把所有出现的 from 换成同字节长度的 to（用于构造恶意/损坏样本）。 */
function replaceAll(buffer, from, to) {
  assert.equal(Buffer.byteLength(from), Buffer.byteLength(to))
  const copy = Buffer.from(buffer)
  let index = 0
  while ((index = copy.indexOf(from, index)) !== -1) {
    copy.write(to, index, 'utf8')
    index += Buffer.byteLength(to)
  }
  return copy
}

test('正常 zip 可读回全部条目', () => {
  const zip = createZip([
    { name: 'manifest.json', data: Buffer.from('{"a":1}') },
    { name: 'sessions/s1/log.zstd', data: Buffer.from('x'.repeat(1024)) },
  ])
  const { entries } = readZip(zip)
  assert.equal(entries.length, 2)
  assert.equal(entries[0].name, 'manifest.json')
  assert.equal(entries[0].data.toString(), '{"a":1}')
  assert.equal(entries[1].data.length, 1024)
})

test('目录条目与 listZip', () => {
  const zip = createZip([
    { name: 'dir', isDir: true },
    { name: 'dir/a.txt', data: Buffer.from('a') },
  ])
  const { entries } = readZip(zip)
  assert.equal(entries[0].name, 'dir/')
  assert.equal(entries[0].size, 0)
  assert.equal(listZip(zip).length, 2)
})

test('截断的 zip 被拒绝', () => {
  const zip = createZip([{ name: 'a.txt', data: Buffer.from('hi') }])
  expectPackError(() => readZip(zip.subarray(0, zip.length - 10)))
  expectPackError(() => readZip(zip.subarray(0, 30)))
})

test('路径穿越条目被拒绝', () => {
  const zip = createZip([{ name: '__/evil.txt', data: Buffer.from('x') }])
  const evil = replaceAll(zip, '__/evil.txt', '../evil.txt')
  expectPackError(() => readZip(evil))
  assert.throws(() => assertSafeEntryName('../evil.txt'), /\.\./)
})

test('反斜杠与绝对路径条目被拒绝', () => {
  const zip = createZip([{ name: '__/evil.txt', data: Buffer.from('x') }])
  expectPackError(() => readZip(replaceAll(zip, '__/evil.txt', '__\\evil.txt')))
  assert.throws(() => assertSafeEntryName('/abs.txt'), /绝对路径/)
  assert.throws(() => assertSafeEntryName('C:/abs.txt'), /盘符/)
  assert.throws(() => assertSafeEntryName(''), /为空/)
})

test('CRC 不符被拒绝', () => {
  const zip = createZip([{ name: 'a.txt', data: Buffer.from('hi') }])
  const corrupt = Buffer.from(zip)
  corrupt[30 + 5] ^= 0xff // local header(30) + name(5) 后的数据首字节
  expectPackError(() => readZip(corrupt))
})

test('损坏的 deflate 数据被拒绝', () => {
  const zip = createZip([{ name: 'big.txt', data: Buffer.from('a'.repeat(4096)) }])
  const corrupt = Buffer.from(zip)
  corrupt[30 + 7 + 2] ^= 0xff // local header(30) + name(7) + deflate 数据第 3 字节
  expectPackError(() => readZip(corrupt))
})

test('可关闭校验和', () => {
  const zip = createZip([{ name: 'a.txt', data: Buffer.from('hi') }])
  const corrupt = Buffer.from(zip)
  corrupt[30 + 5] ^= 0xff
  assert.doesNotThrow(() => readZip(corrupt, { verifyChecksums: false }))
})

test('非 zip 输入被拒绝', () => {
  expectPackError(() => readZip(Buffer.from('not a zip')))
  expectPackError(() => readZip('string'))
})

function expectTooLarge(fn) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof MoverError, `expected MoverError, got ${error?.constructor?.name}`)
    assert.equal(error.code, ERROR_CODES.PACK_TOO_LARGE)
    return true
  })
}

test('listZip 只读中央目录，不解压内容', () => {
  const zip = createZip([{ name: 'big.txt', data: Buffer.from('a'.repeat(4096)) }])
  const corrupt = Buffer.from(zip)
  corrupt[30 + 7 + 2] ^= 0xff // local header(30) + name(7) + deflate 数据第 3 字节

  // 内容已损坏，但清单仍可读：证明 listZip 不解压。
  const listing = listZip(corrupt)
  assert.equal(listing.length, 1)
  assert.equal(listing[0].name, 'big.txt')
  assert.equal(listing[0].size, 4096)
  assert.equal(listing[0].method, 8)
  assert.ok(listing[0].compressedSize < listing[0].size, 'compressedSize 应是压缩后大小')
  expectPackError(() => readZip(corrupt))
})

test('readCentralDirectory 返回条目元数据', () => {
  const zip = createZip([
    { name: 'manifest.json', data: Buffer.from('{"a":1}') },
    { name: 'dir', isDir: true },
  ])
  const { entries } = readCentralDirectory(zip)
  assert.equal(entries.length, 2)
  const [manifest, dir] = entries
  assert.equal(manifest.name, 'manifest.json')
  assert.equal(manifest.uncompressedSize, 7)
  assert.equal(manifest.compressedSize, 7)
  assert.equal(manifest.mode & 0o170000, 0o100000) // 普通文件
  assert.equal(dir.name, 'dir/')
  assert.equal(dir.uncompressedSize, 0)
  assert.ok(Number.isInteger(manifest.localOffset))
})

test('readZipEntry 只解压指定条目', () => {
  const zip = createZip([
    { name: 'keep.txt', data: Buffer.from('keep') },
    { name: 'big.txt', data: Buffer.from('a'.repeat(4096)) },
  ])
  const { entries } = readCentralDirectory(zip)
  const big = entries.find((entry) => entry.name === 'big.txt')
  assert.ok(big)
  const corrupt = Buffer.from(zip)
  corrupt[big.localOffset + 30 + Buffer.byteLength('big.txt') + 2] ^= 0xff

  // 只解压 keep.txt：big.txt 已损坏也不受影响。
  assert.equal(readZipEntry(corrupt, 'keep.txt').data.toString(), 'keep')
  expectPackError(() => readZipEntry(corrupt, 'big.txt'))
  expectPackError(() => readZipEntry(zip, 'missing.txt'))
})

test('解压总量超过上限被拒绝', () => {
  const zip = createZip([
    { name: 'a.txt', data: Buffer.from('a'.repeat(1000)) },
    { name: 'b.txt', data: Buffer.from('b'.repeat(1000)) },
  ])
  expectTooLarge(() => readCentralDirectory(zip, { maxTotalBytes: 1500 }))
  expectTooLarge(() => listZip(zip, { maxTotalBytes: 1500 }))
  expectTooLarge(() => readZip(zip, { maxTotalBytes: 1500 }))
  // 不超限时可正常读取。
  assert.doesNotThrow(() => readZip(zip, { maxTotalBytes: 4096 }))
})

test('单条解压上限被拒绝', () => {
  const zip = createZip([{ name: 'a.txt', data: Buffer.from('a'.repeat(1000)) }])
  expectPackError(() => readCentralDirectory(zip, { maxEntryBytes: 10 }))
})
