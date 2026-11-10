import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  scanWorkspace,
  resolveExclusions,
  DEFAULT_EXCLUDED_DIRS,
} from '../../src/core/scan.js'
import { ERROR_CODES, MoverError } from '../../src/core/errors.js'

async function makeTree() {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-mover-scan-'))
  await mkdir(join(dir, 'src'))
  await writeFile(join(dir, 'src', 'a.txt'), 'hello')
  await mkdir(join(dir, 'node_modules'))
  await writeFile(join(dir, 'node_modules', 'big.bin'), 'x'.repeat(100))
  await mkdir(join(dir, 'dist'))
  await writeFile(join(dir, 'dist', 'out.js'), 'x'.repeat(50))
  await mkdir(join(dir, '.git'))
  await writeFile(join(dir, '.git', 'config'), 'gitconfig')
  await mkdir(join(dir, 'empty'))
  return dir
}

test('默认排除可再生目录，.git 保留', async () => {
  const dir = await makeTree()
  try {
    const result = await scanWorkspace(dir, {})
    const paths = result.entries.map((entry) => entry.relPath)
    assert.ok(paths.includes('src/a.txt'))
    assert.ok(paths.includes('.git/config'))
    assert.ok(!paths.some((p) => p.startsWith('node_modules/')))
    assert.ok(!paths.some((p) => p.startsWith('dist/')))
    assert.equal(result.files, 2) // src/a.txt + .git/config
    assert.equal(result.totalBytes, 5 + 9)
    assert.deepEqual(
      result.excluded.map((item) => item.relPath).sort(),
      ['dist', 'node_modules'],
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('includeGit=false 时排除 .git', async () => {
  const dir = await makeTree()
  try {
    const result = await scanWorkspace(dir, { includeGit: false })
    assert.ok(!result.entries.some((entry) => entry.relPath.startsWith('.git')))
    assert.ok(result.excluded.some((item) => item.reason === 'git-excluded'))
    assert.equal(result.files, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('full=true 时不排除任何目录', async () => {
  const dir = await makeTree()
  try {
    const result = await scanWorkspace(dir, { full: true })
    const paths = result.entries.map((entry) => entry.relPath)
    assert.ok(paths.includes('node_modules/big.bin'))
    assert.ok(paths.includes('dist/out.js'))
    assert.ok(paths.includes('.git/config'))
    assert.deepEqual(result.excluded, [])
    assert.equal(result.files, 4)
    assert.equal(result.totalBytes, 5 + 100 + 50 + 9)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('空目录被记录', async () => {
  const dir = await makeTree()
  try {
    const result = await scanWorkspace(dir, {})
    const empty = result.entries.find((entry) => entry.relPath === 'empty')
    assert.ok(empty)
    assert.equal(empty.isDir, true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('符号链接被记录但不跟随', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-mover-link-'))
  try {
    await writeFile(join(dir, 'target.txt'), 'x')
    await mkdir(join(dir, 'real'))
    await writeFile(join(dir, 'real', 'inner.txt'), 'y')
    let linked = false
    try {
      await symlink(join(dir, 'real'), join(dir, 'linkdir'), 'dir')
      linked = true
    } catch {
      // Windows 未开启开发者模式时可能失败；其余断言仍有效
    }
    const result = await scanWorkspace(dir, {})
    if (linked) {
      const link = result.entries.find((entry) => entry.relPath === 'linkdir')
      assert.ok(link)
      assert.equal(link.isSymlink, true)
      assert.ok(!result.entries.some((entry) => entry.relPath.includes('linkdir/')))
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('resolveExclusions 规则', () => {
  assert.equal(resolveExclusions({}).skipGit, false) // .git 默认保留
  assert.equal(resolveExclusions({ includeGit: false }).skipGit, true)
  assert.equal(resolveExclusions({ full: true }).excluded.size, 0)
  assert.ok(resolveExclusions({}).excluded.has('node_modules'))
  assert.ok(DEFAULT_EXCLUDED_DIRS.includes('__pycache__'))
})

test('不存在的工作区报 E_SCAN_INVALID', async () => {
  await assert.rejects(
    () => scanWorkspace('Z:\\no-such-dsh-mover-scan', {}),
    (error) => error instanceof MoverError && error.code === ERROR_CODES.SCAN_INVALID,
  )
})

test('1 万文件扫描 < 2s', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-mover-scan-big-'))
  try {
    const many = join(dir, 'many')
    await mkdir(many)
    for (let i = 0; i < 10000; i += 1) {
      await writeFile(join(many, `f${i}.txt`), '')
    }
    const start = performance.now()
    const result = await scanWorkspace(dir, {})
    const elapsed = performance.now() - start
    assert.equal(result.files, 10000)
    assert.ok(elapsed < 2000, `scan took ${elapsed.toFixed(0)}ms`)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
