/**
 * tar.mjs 纯函数单测：ustar 解析（普通/pax/GNU longname/prefix/截断/gzip）。
 * 运行：node --test tests/compat/tar.test.mjs
 * 沙箱提示：node --test 需要 spawn 隔离进程；受限环境加
 *   --experimental-test-isolation=none 参数。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import zlib from 'node:zlib'

import { parseTarEntries, parseTarGz } from '../../scripts/compat/lib/tar.mjs'

const BLOCK = 512

/** 构造一个 512 字节 ustar 头。 */
function tarHeader({ name = '', typeflag = '0', size = 0, prefix = '' } = {}) {
  const buf = Buffer.alloc(BLOCK)
  buf.write(name, 0, 100, 'utf8')
  const octal = size.toString(8).padStart(11, '0')
  buf.write(`${octal}\0`, 124, 12, 'ascii')
  buf.write(typeflag, 156, 1, 'ascii')
  buf.write(prefix, 345, 155, 'utf8')
  return buf
}

/** pax 记录：自动计算长度前缀（"len key=value\n"）。 */
function paxRecord(key, value) {
  const body = ` ${key}=${value}\n`
  let len = body.length + 2
  for (;;) {
    const full = `${len}${body}`
    const digits = String(full.length).length
    if (digits === String(len).length) return Buffer.from(full, 'utf8')
    len = full.length
  }
}

/** 把若干 512 块拼成 tar：非 512 整倍的数据块自动填充，末尾补双零块。 */
function buildTar(blocks) {
  const parts = []
  for (const block of blocks) {
    parts.push(block)
    const rem = block.length % BLOCK
    if (rem !== 0) parts.push(Buffer.alloc(BLOCK - rem))
  }
  parts.push(Buffer.alloc(BLOCK * 2))
  return Buffer.concat(parts)
}

test('解析普通文件与目录条目', () => {
  const content = Buffer.from('hello world', 'utf8')
  const tar = buildTar([
    tarHeader({ name: 'package/lib/a.js', size: content.length }),
    content,
    tarHeader({ name: 'package/lib/sub/', typeflag: '5' }),
  ])
  const entries = parseTarEntries(tar)
  assert.equal(entries.length, 2)
  assert.deepEqual(
    entries.map((entry) => entry.name),
    ['package/lib/a.js', 'package/lib/sub/'],
  )
  assert.equal(entries[0].typeflag, '0')
  assert.equal(entries[1].typeflag, '5')
  assert.equal(tar.toString('utf8', entries[0].start, entries[0].end), 'hello world')
})

test('pax path 扩展头覆盖条目名', () => {
  const content = Buffer.from('x', 'utf8')
  const pax = paxRecord('path', 'package/lib/types/long-name-that-exceeds-100-chars/a.d.ts')
  const tar = buildTar([
    tarHeader({ typeflag: 'x', size: pax.length }),
    pax,
    tarHeader({ name: 'shortname', size: content.length }),
    content,
  ])
  const entries = parseTarEntries(tar)
  assert.equal(entries.length, 1)
  assert.equal(entries[0].name, 'package/lib/types/long-name-that-exceeds-100-chars/a.d.ts')
})

test('GNU longname（L）覆盖条目名', () => {
  const long = 'package/lib/very/long/path/to/file.js'
  const content = Buffer.from('y', 'utf8')
  const tar = buildTar([
    tarHeader({ typeflag: 'L', size: long.length }),
    Buffer.from(long, 'utf8'),
    tarHeader({ name: 'truncat', size: content.length }),
    content,
  ])
  const entries = parseTarEntries(tar)
  assert.equal(entries.length, 1)
  assert.equal(entries[0].name, long)
})

test('prefix 字段与 name 拼接', () => {
  const content = Buffer.from('z', 'utf8')
  const tar = buildTar([
    tarHeader({ name: 'file.js', prefix: 'package/lib', size: content.length }),
    content,
  ])
  const entries = parseTarEntries(tar)
  assert.equal(entries[0].name, 'package/lib/file.js')
})

test('数据超出缓冲区时抛错', () => {
  const tar = Buffer.concat([
    tarHeader({ name: 'package/lib/a.js', size: 99999 }),
    Buffer.alloc(10),
  ])
  assert.throws(() => parseTarEntries(tar), /数据超出缓冲区/)
})

test('parseTarGz 解压 gzip 包装的 tar', () => {
  const content = Buffer.from('{"a":1}', 'utf8')
  const tar = buildTar([
    tarHeader({ name: 'package/package.json', size: content.length }),
    content,
  ])
  const entries = parseTarGz(zlib.gzipSync(tar))
  assert.equal(entries.length, 1)
  assert.equal(entries[0].name, 'package/package.json')
  assert.equal(tar.toString('utf8', entries[0].start, entries[0].end), '{"a":1}')
})

test('空缓冲区返回空条目列表', () => {
  assert.deepEqual(parseTarEntries(Buffer.alloc(0)), [])
  assert.deepEqual(parseTarEntries(Buffer.alloc(BLOCK * 2)), [])
})

test('多个连续 pax 头只作用于下一个条目', () => {
  const pax = paxRecord('path', 'package/lib/first.js')
  const content = Buffer.from('1', 'utf8')
  const tar = buildTar([
    tarHeader({ typeflag: 'x', size: pax.length }),
    pax,
    tarHeader({ name: 'a', size: content.length }),
    content,
    tarHeader({ name: 'package/lib/second.js', size: content.length }),
    content,
  ])
  const entries = parseTarEntries(tar)
  assert.deepEqual(
    entries.map((entry) => entry.name),
    ['package/lib/first.js', 'package/lib/second.js'],
  )
})
