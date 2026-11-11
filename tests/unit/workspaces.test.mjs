import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, stat, mkdir, writeFile } from 'node:fs/promises'
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

test('POSIX 目标恢复可执行位（P-05a）', { skip: process.platform === 'win32' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-ws-'))
  try {
    const pathMap = { byKey: { w1: join(dir, 'p1') } }
    await restoreWorkspaceFiles({
      entries: [
        {
          packPath: 'workspaces/w1/files/run.sh',
          data: Buffer.from('#!/bin/sh\necho hi\n'),
          mode: 0o100755,
        },
        { packPath: 'workspaces/w1/files/plain.txt', data: Buffer.from('x'), mode: 0o100644 },
      ],
      pathMap,
      targetPlatform: 'linux',
    })
    const exec = await stat(join(dir, 'p1', 'run.sh'))
    assert.equal(exec.mode & 0o777, 0o755, '包内 0755 的文件导入后应恢复可执行位')
    const plain = await stat(join(dir, 'p1', 'plain.txt'))
    assert.equal(plain.mode & 0o111, 0, '普通文件不应被加上可执行位')
    assert.equal(await readFile(join(dir, 'p1', 'run.sh'), 'utf8'), '#!/bin/sh\necho hi\n')
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

test('POSIX 源包按包内 mode 恢复文件权限（ADR-0016 B1）', { skip: process.platform === 'win32' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-ws-'))
  try {
    const pathMap = { byKey: { w1: join(dir, 'p1') } }
    const result = await restoreWorkspaceFiles({
      entries: [
        { packPath: 'workspaces/w1/files/private.txt', data: Buffer.from('s'), mode: 0o100600 },
        { packPath: 'workspaces/w1/files/plain.txt', data: Buffer.from('p'), mode: 0o100644 },
        { packPath: 'workspaces/w1/files/run.sh', data: Buffer.from('r'), mode: 0o100755 },
      ],
      pathMap,
      targetPlatform: 'linux',
      sourcePlatform: 'linux',
    })
    assert.equal(result.modes.applied, 3)
    assert.equal(result.modes.failed, 0)
    const perms = async (name) => (await stat(join(dir, 'p1', name))).mode & 0o777
    assert.equal(await perms('private.txt'), 0o600, '0600 必须保持')
    assert.equal(await perms('plain.txt'), 0o644, '0644 必须保持')
    assert.equal(await perms('run.sh'), 0o755, '0755 必须保持')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('setuid/setgid 位不会被恢复到目标', { skip: process.platform === 'win32' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-ws-'))
  try {
    const pathMap = { byKey: { w1: join(dir, 'p1') } }
    await restoreWorkspaceFiles({
      entries: [
        { packPath: 'workspaces/w1/files/suid', data: Buffer.from('a'), mode: 0o104755 },
        { packPath: 'workspaces/w1/files/sgid', data: Buffer.from('b'), mode: 0o102755 },
      ],
      pathMap,
      targetPlatform: 'linux',
      sourcePlatform: 'linux',
    })
    for (const name of ['suid', 'sgid']) {
      const mode = (await stat(join(dir, 'p1', name))).mode
      assert.equal(mode & 0o777, 0o755, name + ' 只保留低 9 位')
      assert.equal(mode & 0o4000, 0, name + ' 不得带 setuid')
      assert.equal(mode & 0o2000, 0, name + ' 不得带 setgid')
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('win32 源包不按合成 mode 恢复，仅恢复 exec 位', { skip: process.platform === 'win32' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-ws-'))
  try {
    const pathMap = { byKey: { w1: join(dir, 'p1') } }
    const result = await restoreWorkspaceFiles({
      entries: [
        { packPath: 'workspaces/w1/files/a.txt', data: Buffer.from('a'), mode: 0o100666 },
        { packPath: 'workspaces/w1/files/b.sh', data: Buffer.from('b'), mode: 0o100755 },
      ],
      pathMap,
      targetPlatform: 'linux',
      sourcePlatform: 'win32',
    })
    const defaultFileMode = 0o666 & ~process.umask()
    assert.equal((await stat(join(dir, 'p1', 'a.txt'))).mode & 0o777, defaultFileMode, '合成 0666 不得落到目标')
    assert.equal((await stat(join(dir, 'p1', 'b.sh'))).mode & 0o777, 0o755, 'exec 位规则仍然生效')
    assert.equal(result.modes.applied, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Windows 目标忽略权限位（ADR-0003）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-ws-'))
  try {
    const pathMap = { byKey: { w1: join(dir, 'p1') } }
    const result = await restoreWorkspaceFiles({
      entries: [{ packPath: 'workspaces/w1/files/a.txt', data: Buffer.from('a'), mode: 0o100600 }],
      pathMap,
      targetPlatform: 'win32',
      sourcePlatform: 'linux',
    })
    assert.equal(result.modes.applied, 0)
    assert.equal((await stat(join(dir, 'p1', 'a.txt'))).mode & 0o777, 0o666 & ~process.umask())
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
