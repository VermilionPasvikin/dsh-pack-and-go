import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  classifyEntry,
  detectCaseCollisions,
  sanitizeWindowsName,
  preflightWorkspace,
} from '../../src/core/preflight.js'
import { ERROR_CODES, MoverError } from '../../src/core/errors.js'

const win32 = { targetPlatform: 'win32', rootPath: 'C:\\work\\proj' }
const linux = { targetPlatform: 'linux', rootPath: '/home/me/proj' }

test('非法文件名字符（Windows）', () => {
  const risks = classifyEntry({ name: 'a?b.txt', relPath: 'a?b.txt', isDirectory: false }, win32)
  assert.equal(risks.length, 1)
  assert.equal(risks[0].kind, 'invalid-name')
  assert.equal(risks[0].suggestion, 'a_b.txt')
})

test('Windows 保留名', () => {
  const risks = classifyEntry({ name: 'CON.txt', relPath: 'CON.txt', isDirectory: false }, win32)
  assert.equal(risks[0].kind, 'reserved-name')
  assert.equal(risks[0].suggestion, '_CON.txt')
})

test('结尾点或空格（Windows）', () => {
  const risks = classifyEntry({ name: 'name. ', relPath: 'name. ', isDirectory: false }, win32)
  assert.equal(risks[0].kind, 'trailing-dot-space')
})

test('路径长度（Windows）', () => {
  const risks = classifyEntry(
    { name: 'f.txt', relPath: 'a'.repeat(260), isDirectory: false },
    win32,
  )
  assert.ok(risks.some((risk) => risk.kind === 'path-length'))
})

test('符号链接风险（任意目标）', () => {
  const risks = classifyEntry(
    { name: 'link', relPath: 'link', isSymlink: true, isDirectory: false },
    linux,
  )
  assert.equal(risks.length, 1)
  assert.equal(risks[0].kind, 'symlink')
})

test('可执行位（Windows 目标）', () => {
  const risks = classifyEntry(
    { name: 'run.sh', relPath: 'run.sh', isDirectory: false, mode: 0o755 },
    win32,
  )
  assert.ok(risks.some((risk) => risk.kind === 'permission'))
})

test('非 Windows 目标不报 Windows 专属风险', () => {
  const risks = classifyEntry(
    { name: 'a?b.txt', relPath: 'a?b.txt', isDirectory: false, mode: 0o755 },
    linux,
  )
  assert.deepEqual(risks, [])
})

test('sanitizeWindowsName 生成安全建议', () => {
  assert.equal(sanitizeWindowsName('a?b.txt'), 'a_b.txt')
  assert.equal(sanitizeWindowsName('CON.txt'), '_CON.txt')
  assert.equal(sanitizeWindowsName('name. '), 'name')
  assert.equal(sanitizeWindowsName('   '), '_')
})

test('大小写冲突检测', () => {
  const collisions = detectCaseCollisions([
    { dir: '', name: 'a.txt' },
    { dir: '', name: 'A.txt' },
    { dir: 'sub', name: 'b.txt' },
    { dir: 'sub', name: 'B.txt' },
    { dir: '', name: 'c.txt' },
  ])
  assert.equal(collisions.length, 2)
  const keys = collisions.map((c) => c.names.join(',')).sort()
  assert.deepEqual(keys, ['A.txt,a.txt', 'B.txt,b.txt'])
})

test('preflightWorkspace 返回可序列化报告', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-preflight-'))
  try {
    await writeFile(join(dir, 'a.txt'), 'hello')
    await mkdir(join(dir, 'sub'))
    await writeFile(join(dir, 'sub', 'b.bin'), 'abc')
    const report = await preflightWorkspace(dir, 'linux')
    assert.equal(report.scannedFiles, 2)
    assert.equal(report.scannedDirs, 1)
    assert.equal(report.totalBytes, 8)
    assert.deepEqual(report.risks, [])
    assert.equal(report.summary.invalidName, 0)
    assert.doesNotThrow(() => JSON.stringify(report))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('preflightWorkspace 拒绝非法平台与不存在的目录', async () => {
  await assert.rejects(
    () => preflightWorkspace('/tmp', 'plan9'),
    (error) => error instanceof MoverError && error.code === ERROR_CODES.PREFLIGHT_INVALID,
  )
  await assert.rejects(
    () => preflightWorkspace('Z:\\no-such-dsh-pack-and-go-dir', 'linux'),
    (error) => error instanceof MoverError && error.code === ERROR_CODES.PREFLIGHT_INVALID,
  )
})
