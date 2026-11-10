import test from 'node:test'
import assert from 'node:assert/strict'

import { createZip } from '../../src/core/zip-writer.js'
import { readZip, listZip, assertSafeEntryName } from '../../src/core/zip-reader.js'
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
