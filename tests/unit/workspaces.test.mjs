import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { restoreWorkspaceFiles } from '../../src/core/workspaces.js'
import { ERROR_CODES, MoverError } from '../../src/core/errors.js'

function entry(packPath, data = '') {
  return { packPath, data: Buffer.from(data) }
}

test('恢复工作区文件到目标路径', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-ws-'))
  try {
    const pathMap = { byKey: { w1: join(dir, 'p1'), w2: join(dir, 'p2') } }
    const result = await restoreWorkspaceFiles({
      entries: [
        entry('workspaces/w1/files/a.txt', 'hello'),
        entry('workspaces/w1/files/sub/b.bin', 'xyz'),
        entry('workspaces/w2/files/c.txt', 'c'),
        entry('workspaces/w1/files/emptydir/', ''),
      ],
      pathMap,
      targetPlatform: 'linux',
    })
    assert.equal(result.written.length, 3)
    assert.equal(result.dirs.length, 1)
    assert.deepEqual(result.conversions, [])
    assert.equal(await readFile(join(dir, 'p1', 'a.txt'), 'utf8'), 'hello')
    assert.equal(await readFile(join(dir, 'p1', 'sub', 'b.bin'), 'utf8'), 'xyz')
    assert.equal(await readFile(join(dir, 'p2', 'c.txt'), 'utf8'), 'c')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Windows 目标对非法文件名做安全重命名并记录', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-ws-'))
  try {
    const pathMap = { byKey: { w1: join(dir, 'p1') } }
    const result = await restoreWorkspaceFiles({
      entries: [entry('workspaces/w1/files/a?b.txt', 'data')],
      pathMap,
      targetPlatform: 'win32',
    })
    assert.equal(result.written.length, 1)
    assert.equal(result.conversions.length, 1)
    assert.equal(result.conversions[0].to, 'a_b.txt')
    assert.equal(await readFile(join(dir, 'p1', 'a_b.txt'), 'utf8'), 'data')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('缺少工作区映射时报错', async () => {
  await assert.rejects(
    () =>
      restoreWorkspaceFiles({
        entries: [entry('workspaces/w1/files/a.txt', 'x')],
        pathMap: { byKey: {} },
        targetPlatform: 'linux',
      }),
    (error) => error instanceof MoverError && error.code === ERROR_CODES.PACK_INVALID,
  )
})

test('忽略非工作区条目', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-ws-'))
  try {
    const result = await restoreWorkspaceFiles({
      entries: [entry('manifest.json', '{}'), entry('sessions/s1/x', '')],
      pathMap: { byKey: {} },
      targetPlatform: 'linux',
    })
    assert.equal(result.written.length, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
