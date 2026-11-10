import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildManifest, buildPack } from '../../src/core/export-pack.js'
import { planExport } from '../../src/core/plan-export.js'
import { readZip } from '../../src/core/zip-reader.js'
import { ERROR_CODES, MoverError } from '../../src/core/errors.js'

function expectPackError(fn) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof MoverError)
    assert.equal(error.code, ERROR_CODES.PACK_INVALID)
    return true
  })
}

async function makeSources(dir) {
  const sessionPath = join(dir, 'session.v4.jsonl.zstd')
  const filePath = join(dir, 'a.txt')
  await writeFile(sessionPath, Buffer.from('session-bytes'))
  await writeFile(filePath, Buffer.from('hello'))
  return { sessionPath, filePath }
}

test('buildManifest 生成合法清单', () => {
  const manifest = buildManifest({
    platform: 'linux',
    dshVersion: '0.2.2-rc.1',
    mode: 'sessions',
    sessions: [
      {
        id: 's1',
        messageCount: 1,
        sizeBytes: 5,
        path: 'sessions/s1/session.v4.jsonl.zstd',
      },
    ],
  })
  assert.equal(manifest.schemaVersion, 2)
  assert.equal(manifest.source.platform, 'linux')
  assert.equal(manifest.mode, 'sessions')
  assert.ok(manifest.createdAt.endsWith('Z'))
})

test('buildPack 生成可读的包', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-mover-pack-'))
  try {
    const { sessionPath, filePath } = await makeSources(dir)
    const plan = planExport({
      sessions: [{ packPath: 'sessions/s1/session.v4.jsonl.zstd', sizeBytes: 13 }],
      workspaces: [{ key: 'w1', files: [{ relPath: 'a.txt', size: 5 }] }],
      includeFiles: true,
    })
    const manifest = buildManifest({
      platform: 'linux',
      dshVersion: '0.2.2-rc.1',
      mode: 'sessions+workspaces',
      sessions: [
        {
          id: 's1',
          workspaceKey: 'w1',
          messageCount: 1,
          sizeBytes: 13,
          path: 'sessions/s1/session.v4.jsonl.zstd',
        },
      ],
      workspaces: [
        {
          key: 'w1',
          title: 'P',
          sourcePath: '/p',
          sourcePlatform: 'linux',
          fileCount: 1,
          sizeBytes: 5,
          root: 'workspaces/w1/files',
        },
      ],
    })
    const sourcePaths = {
      'sessions/s1/session.v4.jsonl.zstd': sessionPath,
      'workspaces/w1/files/a.txt': filePath,
    }
    const pack = await buildPack({ plan, sourcePaths, manifest })
    const { entries } = readZip(pack)
    const names = entries.map((entry) => entry.name)
    assert.ok(names.includes('manifest.json'))
    assert.ok(names.includes('README.txt'))
    assert.ok(names.includes('sessions/s1/session.v4.jsonl.zstd'))
    assert.ok(names.includes('workspaces/w1/files/a.txt'))
    assert.equal(
      entries.find((entry) => entry.name === 'workspaces/w1/files/a.txt').data.toString(),
      'hello',
    )
    const parsedManifest = JSON.parse(
      entries.find((entry) => entry.name === 'manifest.json').data.toString(),
    )
    assert.equal(parsedManifest.mode, 'sessions+workspaces')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('缺少源文件时报错', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-mover-pack-'))
  try {
    const plan = planExport({
      sessions: [{ packPath: 'sessions/s1/session.v4.jsonl.zstd', sizeBytes: 1 }],
      includeFiles: false,
    })
    const manifest = buildManifest({
      platform: 'linux',
      dshVersion: 'test',
      mode: 'sessions',
      sessions: [
        { id: 's1', messageCount: 1, sizeBytes: 1, path: 'sessions/s1/session.v4.jsonl.zstd' },
      ],
    })
    await assert.rejects(
      () => buildPack({ plan, sourcePaths: {}, manifest }),
      (error) => error instanceof MoverError && error.code === ERROR_CODES.PACK_INVALID,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('超过单文件上限时报错', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-mover-pack-'))
  try {
    const big = join(dir, 'big.bin')
    await mkdir(join(dir, 'sub'), { recursive: true })
    await writeFile(big, Buffer.alloc(2048))
    const plan = planExport({
      sessions: [{ packPath: 'sessions/s1/session.v4.jsonl.zstd', sizeBytes: 2048 }],
      includeFiles: false,
    })
    const manifest = buildManifest({
      platform: 'linux',
      dshVersion: 'test',
      mode: 'sessions',
      sessions: [
        { id: 's1', messageCount: 1, sizeBytes: 2048, path: 'sessions/s1/session.v4.jsonl.zstd' },
      ],
    })
    await assert.rejects(
      () =>
        buildPack({
          plan,
          sourcePaths: { 'sessions/s1/session.v4.jsonl.zstd': big },
          manifest,
          maxFileBytes: 1024,
        }),
      (error) => error instanceof MoverError && error.code === ERROR_CODES.PACK_INVALID,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('非法 manifest 在打包前被拒绝', () => {
  assert.throws(
    () => buildManifest({ platform: 'linux', dshVersion: 'x', mode: 'nope' }),
    (error) => error instanceof MoverError && error.code === ERROR_CODES.MANIFEST_INVALID,
  )
})
