import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdtemp, rm, readFile, stat, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { restoreWorkspaceFiles, sanitizeRelativePath } from '../../src/core/workspaces.js'
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

test('目录权限两阶段恢复（ADR-0016 B2）', { skip: process.platform === 'win32' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-ws-'))
  try {
    const pathMap = { byKey: { w1: join(dir, 'p1') } }
    const result = await restoreWorkspaceFiles({
      entries: [
        { packPath: 'workspaces/w1/files/private/', data: Buffer.alloc(0), mode: 0o40700 },
        {
          packPath: 'workspaces/w1/files/private/secret.txt',
          data: Buffer.from('s'),
          mode: 0o100600,
        },
        { packPath: 'workspaces/w1/files/shared/', data: Buffer.alloc(0), mode: 0o40755 },
        { packPath: 'workspaces/w1/files/shared/a.txt', data: Buffer.from('a'), mode: 0o100644 },
        { packPath: 'workspaces/w1/files/readonly/', data: Buffer.alloc(0), mode: 0o40500 },
        { packPath: 'workspaces/w1/files/readonly/b.txt', data: Buffer.from('b'), mode: 0o100644 },
      ],
      pathMap,
      targetPlatform: 'linux',
      sourcePlatform: 'linux',
    })
    const perms = async (name) => (await stat(join(dir, 'p1', name))).mode & 0o777
    assert.equal(await perms('private'), 0o700)
    assert.equal(await perms('shared'), 0o755)
    // 两阶段：0500 目录仍能先写入文件，最后才收紧。
    assert.equal(await perms('readonly'), 0o500)
    assert.equal(await readFile(join(dir, 'p1', 'readonly', 'b.txt'), 'utf8'), 'b')
    assert.equal(result.modes.dirsApplied, 3)
    assert.equal(result.modes.dirsFailed, 0)
  } finally {
    // POSIX 下 0500 目录内的文件无法直接 unlink，清理前先恢复写权限（macOS/Linux 通用）。
    await chmod(join(dir, 'p1', 'readonly'), 0o700).catch(() => {})
    await rm(dir, { recursive: true, force: true })
  }
})

test('目录 setuid/setgid 位被剥离（ADR-0016 B2）', { skip: process.platform === 'win32' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-ws-'))
  try {
    const pathMap = { byKey: { w1: join(dir, 'p1') } }
    await restoreWorkspaceFiles({
      entries: [
        { packPath: 'workspaces/w1/files/suid-dir/', data: Buffer.alloc(0), mode: 0o104755 },
        { packPath: 'workspaces/w1/files/sgid-dir/', data: Buffer.alloc(0), mode: 0o102700 },
      ],
      pathMap,
      targetPlatform: 'linux',
      sourcePlatform: 'linux',
    })
    for (const name of ['suid-dir', 'sgid-dir']) {
      const mode = (await stat(join(dir, 'p1', name))).mode
      assert.equal(mode & 0o4000, 0, name + ' 不得带 setuid')
      assert.equal(mode & 0o2000, 0, name + ' 不得带 setgid')
    }
    assert.equal((await stat(join(dir, 'p1', 'suid-dir'))).mode & 0o777, 0o755)
    assert.equal((await stat(join(dir, 'p1', 'sgid-dir'))).mode & 0o777, 0o700)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('win32 源包跳过目录权限恢复（ADR-0016 B2）', { skip: process.platform === 'win32' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-ws-'))
  try {
    const pathMap = { byKey: { w1: join(dir, 'p1') } }
    const result = await restoreWorkspaceFiles({
      entries: [{ packPath: 'workspaces/w1/files/d/', data: Buffer.alloc(0), mode: 0o40766 }],
      pathMap,
      targetPlatform: 'linux',
      sourcePlatform: 'win32',
    })
    assert.equal(result.modes.dirsApplied, 0)
    // 目录仍按 mkdir + umask 落盘，不套用 win32 合成 mode。
    assert.equal((await stat(join(dir, 'p1', 'd'))).mode & 0o777, 0o777 & ~process.umask())
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Windows 目标忽略目录权限（ADR-0003）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-ws-'))
  try {
    const pathMap = { byKey: { w1: join(dir, 'p1') } }
    const result = await restoreWorkspaceFiles({
      entries: [{ packPath: 'workspaces/w1/files/d/', data: Buffer.alloc(0), mode: 0o40700 }],
      pathMap,
      targetPlatform: 'win32',
      sourcePlatform: 'linux',
    })
    assert.equal(result.modes.dirsApplied, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// ---- ADR-0020 路径安全闭环 ----

test('sanitizeRelativePath 逐段净化（ADR-0020 §1）', () => {
  // linux 不做任何改名。
  const linux = sanitizeRelativePath('dir/a?b.txt', 'linux')
  assert.equal(linux.path, 'dir/a?b.txt')
  assert.deepEqual(linux.conversions, [])

  // win32 段内非法字符替换为 `_`，且目录段同样处理。
  const win = sanitizeRelativePath('dir?x/a?b.txt', 'win32')
  assert.equal(win.path, 'dir_x/a_b.txt')
  assert.deepEqual(
    win.conversions.map((item) => item.to),
    ['dir_x', 'a_b.txt'],
  )

  // 保留名加前缀（含扩展名形式）。
  assert.equal(sanitizeRelativePath('CON.txt', 'win32').path, '_CON.txt')
  assert.equal(sanitizeRelativePath('sub/NUL', 'win32').path, 'sub/_NUL')

  // 段尾空格/点去掉。
  assert.equal(sanitizeRelativePath('a. /b ', 'win32').path, 'a/b')

  // 空段与 `..` 被丢弃（防越界）。
  assert.equal(sanitizeRelativePath('a//../b', 'linux').path, 'a/b')

  // 单段超过 255 字节截断，且不切坏多字节字符。
  const long = `${'x'.repeat(300)}.txt`
  const truncated = sanitizeRelativePath(long, 'linux')
  assert.ok(Buffer.byteLength(truncated.path, 'utf8') <= 255)
  assert.equal(truncated.conversions.length, 1)
  const cjk = sanitizeRelativePath(`${'中'.repeat(100)}.txt`, 'linux')
  assert.ok(Buffer.byteLength(cjk.path, 'utf8') <= 255)
  assert.ok(!cjk.path.includes('\uFFFD'), '截断不得切坏 UTF-8 序列')
})

test('Windows 目标对目录段做净化并保持层级（ADR-0020 §1）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-ws-'))
  try {
    const pathMap = { byKey: { w1: join(dir, 'p1') } }
    const result = await restoreWorkspaceFiles({
      entries: [
        entry('workspaces/w1/files/dir?x/', ''),
        entry('workspaces/w1/files/dir?x/a?b.txt', 'data'),
      ],
      pathMap,
      targetPlatform: 'win32',
    })
    assert.equal(result.dirs.length, 1)
    assert.equal(await readFile(join(dir, 'p1', 'dir_x', 'a_b.txt'), 'utf8'), 'data')
    assert.equal(result.conversions.length, 2)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('大小写不敏感目标上同名文件不再互相覆盖（ADR-0020 §2）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-ws-'))
  try {
    const pathMap = { byKey: { w1: join(dir, 'p1') } }
    const result = await restoreWorkspaceFiles({
      entries: [
        entry('workspaces/w1/files/Report.txt', 'first'),
        entry('workspaces/w1/files/report.txt', 'second'),
      ],
      pathMap,
      targetPlatform: 'win32',
    })
    assert.equal(result.written.length, 2)
    assert.equal(await readFile(join(dir, 'p1', 'Report.txt'), 'utf8'), 'first')
    assert.equal(await readFile(join(dir, 'p1', 'report (1).txt'), 'utf8'), 'second')
    assert.equal(result.conversions.length, 1)
    assert.equal(result.conversions[0].kind, 'case-collision')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('darwin 目标同样处理大小写冲突（ADR-0020 §2）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-ws-'))
  try {
    const pathMap = { byKey: { w1: join(dir, 'p1') } }
    const result = await restoreWorkspaceFiles({
      entries: [
        entry('workspaces/w1/files/A/a.txt', 'a'),
        entry('workspaces/w1/files/a/a.txt', 'b'),
      ],
      pathMap,
      targetPlatform: 'darwin',
    })
    // 第二个文件写入小写目录下的同名文件时同样追加序号，避免覆盖。
    assert.equal(result.written.length, 2)
    assert.equal(result.conversions.length, 1)
    assert.equal(result.conversions[0].kind, 'case-collision')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Windows 目标路径过长时跳过并记录（ADR-0020 §3）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-ws-'))
  try {
    const pathMap = { byKey: { w1: join(dir, 'p1') } }
    const longName = `${'x'.repeat(230)}.txt`
    const result = await restoreWorkspaceFiles({
      entries: [entry(`workspaces/w1/files/${longName}`, 'data')],
      pathMap,
      targetPlatform: 'win32',
    })
    assert.equal(result.written.length, 0)
    assert.equal(result.conversions.length, 1)
    assert.equal(result.conversions[0].kind, 'path-too-long')
    assert.equal(result.warnings.length, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
