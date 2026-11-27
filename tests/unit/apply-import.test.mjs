import test from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  commitStagedDirectory,
  pathExists,
  removeQuietly,
  stagingPath,
  timestampOf,
} from '../../src/core/apply-import.js'

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

test('stagingPath 生成点开头的唯一目录', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-apply-'))
  try {
    const first = stagingPath(dir, 'session-import')
    const second = stagingPath(dir, 'session-import')
    assert.notEqual(first, second)
    assert.ok(first.startsWith(join(dir, '.session-import-tmp-')))
    assert.equal(await exists(first), false, 'stagingPath 只给路径，不创建目录')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('commitStagedDirectory 把暂存目录移到目标位置', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-apply-'))
  try {
    const staging = join(dir, '.stage')
    await mkdir(staging, { recursive: true })
    await writeFile(join(staging, 'a.txt'), 'hello')
    const target = join(dir, 'nested', 'target')
    const backupPath = await commitStagedDirectory({ staging, target })
    assert.equal(backupPath, undefined)
    assert.equal(await readFile(join(target, 'a.txt'), 'utf8'), 'hello')
    assert.equal(await exists(staging), false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('目标已存在且有备份根时，旧目录整体移入备份', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-apply-'))
  try {
    const target = join(dir, 'target')
    await mkdir(target, { recursive: true })
    await writeFile(join(target, 'old.txt'), 'old')
    const staging = join(dir, '.stage')
    await mkdir(staging, { recursive: true })
    await writeFile(join(staging, 'new.txt'), 'new')
    const backupDir = join(dir, 'backups')
    const backupPath = await commitStagedDirectory({
      staging,
      target,
      backupDir,
      name: 'target',
      now: new Date('2026-11-27T10:00:00Z'),
    })
    assert.ok(backupPath)
    assert.equal(await readFile(join(backupPath, 'old.txt'), 'utf8'), 'old')
    assert.equal(await readFile(join(target, 'new.txt'), 'utf8'), 'new')
    assert.equal(await exists(join(target, 'old.txt')), false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('目标已存在且无备份根时旧目录被删除', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-apply-'))
  try {
    const target = join(dir, 'target')
    await mkdir(target, { recursive: true })
    await writeFile(join(target, 'old.txt'), 'old')
    const staging = join(dir, '.stage')
    await mkdir(staging, { recursive: true })
    await writeFile(join(staging, 'new.txt'), 'new')
    await commitStagedDirectory({ staging, target })
    assert.equal(await readFile(join(target, 'new.txt'), 'utf8'), 'new')
    assert.equal(await exists(join(target, 'old.txt')), false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('提交失败时旧目录放回原位（覆盖回滚）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-apply-'))
  try {
    const target = join(dir, 'target')
    await mkdir(target, { recursive: true })
    await writeFile(join(target, 'old.txt'), 'old')
    // 暂存目录不存在 → rename 必然失败，触发回滚分支。
    const staging = join(dir, '.missing-stage')
    const backupDir = join(dir, 'backups')
    await assert.rejects(
      () => commitStagedDirectory({ staging, target, backupDir, name: 'target' }),
      (error) => error.code === 'ENOENT',
    )
    assert.equal(await readFile(join(target, 'old.txt'), 'utf8'), 'old', '旧目录必须恢复')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('removeQuietly 与 pathExists 辅助', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-apply-'))
  try {
    const target = join(dir, 'x')
    assert.equal(await pathExists(target), false)
    await mkdir(target, { recursive: true })
    assert.equal(await pathExists(target), true)
    await removeQuietly(target)
    assert.equal(await pathExists(target), false)
    await removeQuietly(target) // 幂等，不抛错
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('timestampOf 生成文件名安全的时间戳', () => {
  const stamp = timestampOf(new Date('2026-11-27T10:11:12.345Z'))
  assert.equal(stamp, '2026-11-27T10-11-12-345Z')
  assert.ok(!stamp.includes(':'))
  assert.ok(!stamp.includes('.'))
})
