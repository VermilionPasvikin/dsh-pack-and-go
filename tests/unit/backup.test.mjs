import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir, writeFile, readFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { createBackupTransaction } from '../../src/core/backup.js'
import { ERROR_CODES, MoverError } from '../../src/core/errors.js'

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

test('覆盖已有文件后可回滚', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-mover-backup-'))
  try {
    const target = join(dir, 'target', 'session.v4.jsonl.zstd')
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, 'old')

    const tx = createBackupTransaction({
      backupRoot: join(dir, 'backups'),
      now: new Date('2026-11-10T00:00:00Z'),
    })
    const tracked = await tx.track(target, 'session-1')
    assert.equal(tracked.existed, true)
    assert.ok(tracked.backupPath)
    assert.equal(await readFile(tracked.backupPath, 'utf8'), 'old')

    await writeFile(target, 'new')
    const result = await tx.rollback()
    assert.equal(result.restored, 1)
    assert.deepEqual(result.failures, [])
    assert.equal(await readFile(target, 'utf8'), 'old')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('新写入的文件回滚后被删除', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-mover-backup-'))
  try {
    const target = join(dir, 'target', 'new.txt')
    await mkdir(dirname(target), { recursive: true })
    const tx = createBackupTransaction({ backupRoot: join(dir, 'backups') })
    const tracked = await tx.track(target, 'new')
    assert.equal(tracked.existed, false)
    assert.equal(tracked.backupPath, undefined)

    await writeFile(target, 'brand-new')
    await tx.rollback()
    assert.equal(await exists(target), false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('混合场景按逆序恢复', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-mover-backup-'))
  try {
    const existing = join(dir, 'a.txt')
    const fresh = join(dir, 'b.txt')
    await writeFile(existing, 'A-old')

    const tx = createBackupTransaction({ backupRoot: join(dir, 'backups') })
    await tx.track(existing, 'a')
    await tx.track(fresh, 'b')
    await writeFile(existing, 'A-new')
    await writeFile(fresh, 'B-new')

    const result = await tx.rollback()
    assert.equal(result.restored, 2)
    assert.equal(await readFile(existing, 'utf8'), 'A-old')
    assert.equal(await exists(fresh), false)
    assert.equal(tx.records.length, 2)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('备份目录使用时间戳', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-mover-backup-'))
  try {
    const tx = createBackupTransaction({
      backupRoot: join(dir, 'backups'),
      now: new Date('2026-11-10T12:34:56Z'),
    })
    assert.match(tx.dir, /backups[\\/]2026-11-10T12-34-56-000Z$/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('缺少 backupRoot 报错', () => {
  assert.throws(
    () => createBackupTransaction({}),
    (error) => error instanceof MoverError && error.code === ERROR_CODES.PACK_INVALID,
  )
})
