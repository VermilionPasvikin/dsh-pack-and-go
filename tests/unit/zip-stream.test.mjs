import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, readFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

import { writeZipStream, crc32Init, crc32Update, crc32Final } from '../../src/core/zip-stream.js'
import { readZip } from '../../src/core/zip-reader.js'

test('增量 CRC 与整块 CRC 一致', () => {
  const chunk1 = Buffer.from('hello ')
  const chunk2 = Buffer.from('world')
  const state = crc32Update(crc32Update(crc32Init(), chunk1), chunk2)
  const combined = crc32Final(crc32Update(crc32Init(), Buffer.concat([chunk1, chunk2])))
  assert.equal(crc32Final(state), combined)
})

test('流式包（data descriptor）可被 readZip 读取', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-zipstream-'))
  try {
    const small = join(dir, 'a.txt')
    await writeFile(small, 'hello')
    const big = join(dir, 'big.bin')
    await writeFile(big, Buffer.alloc(100000, 0x62))
    const out = join(dir, 'pack.dshpack')

    const result = await writeZipStream({
      entries: [
        { name: 'a.txt', sourcePath: small },
        { name: 'big.bin', sourcePath: big },
        { name: 'folder/', isDir: true },
        { name: 'inline.txt', data: Buffer.from('inline') },
      ],
      outputPath: out,
    })
    assert.equal(result.entries, 4)
    assert.ok(result.bytes > 0)

    const { entries } = readZip(await readFile(out))
    const names = entries.map((entry) => entry.name)
    assert.deepEqual(names, ['a.txt', 'big.bin', 'folder/', 'inline.txt'])
    assert.equal(entries.find((entry) => entry.name === 'a.txt').data.toString(), 'hello')
    assert.equal(entries.find((entry) => entry.name === 'big.bin').data.length, 100000)
    assert.equal(entries.find((entry) => entry.name === 'inline.txt').data.toString(), 'inline')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('拒绝非法条目名', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-zipstream-'))
  try {
    const out = join(dir, 'bad.dshpack')
    await assert.rejects(
      () => writeZipStream({ entries: [{ name: '../evil', data: Buffer.from('x') }], outputPath: out }),
      /\.\./,
    )
    await assert.rejects(
      () => writeZipStream({ entries: [{ name: '/abs', data: Buffer.from('x') }], outputPath: out }),
      /forward/,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('混合条目 + 不可压缩数据，连续多轮不报 write after end', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-zipstream-'))
  try {
    const sources = []
    for (let index = 0; index < 4; index += 1) {
      const file = join(dir, `random-${index}.bin`)
      await writeFile(file, randomBytes(90000))
      sources.push({ file })
    }
    const entries = [
      { name: 'manifest.json', data: Buffer.from('{"schemaVersion":2}') },
      { name: 'README.txt', data: Buffer.from('readme') },
      ...sources.map((source, index) => ({
        name: `sessions/s${index}.bin`,
        sourcePath: source.file,
      })),
    ]
    for (let round = 0; round < 3; round += 1) {
      const out = join(dir, `pack-${round}.dshpack`)
      const result = await writeZipStream({ entries, outputPath: out })
      assert.ok(result.bytes > 0)
      const { entries: readBack } = readZip(await readFile(out))
      assert.equal(readBack.length, entries.length)
      assert.equal(readBack.find((entry) => entry.name === 'sessions/s0.bin').data.length, 90000)
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('失败时清理半成品输出文件', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-zipstream-'))
  try {
    const out = join(dir, 'broken.dshpack')
    await assert.rejects(
      () =>
        writeZipStream({
          entries: [
            { name: 'ok.txt', data: Buffer.from('ok') },
            { name: 'missing.txt', sourcePath: join(dir, 'does-not-exist.txt') },
          ],
          outputPath: out,
        }),
    )
    await assert.rejects(() => access(out), /ENOENT/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
