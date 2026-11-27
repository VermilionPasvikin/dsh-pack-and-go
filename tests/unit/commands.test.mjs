import test from 'node:test'
import assert from 'node:assert/strict'
import zlib from 'node:zlib'
import { mkdtemp, rm, mkdir, stat, writeFile, readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  parseMoverArgs,
  exportAllSessions,
  exportWorkspacesOnly,
  importPack,
  handleMover,
  createMoverCommand,
  resolveExportTarget,
  listCatalog,
  measureWorkspaces,
  inspectPack,
} from '../../src/host/commands.js'
import { buildManifest, buildPackToFile } from '../../src/core/export-pack.js'
import { readZip } from '../../src/core/zip-reader.js'
import { scanFrames } from '../../src/core/zstd-frames.js'

function makeSessionBytes(id = 's1', cwd = '/p') {
  const header = {
    type: 'session',
    version: 4,
    id,
    createdAt: 1700000000000,
    isSeeded: false,
    delegationDepth: 0,
    cwd,
  }
  return Buffer.concat([
    zlib.zstdCompressSync(Buffer.from(`${JSON.stringify(header)}\n`)),
    zlib.zstdCompressSync(Buffer.from('{"type":"turn/start","seq":0}\n')),
  ])
}

async function makeDeps(dir, sessionFile, bytes) {
  return {
    workspaceRegistry: {
      list: () => [{ id: 'w1', path: '/p', title: 'P', sessionIds: ['s1'] }],
      create: async (path, title) => ({ id: `id-${path}`, path, title }),
    },
    sessionPersistence: {
      list: async () => [
        {
          header: { id: 's1', cwd: '/p', createdAt: 1 },
          sizeBytes: bytes.length,
          location: { kind: 'jsonl', path: sessionFile },
        },
      ],
      create: async () => ({
        append: async () => {},
        flush: async () => {},
        close: async () => {},
      }),
    },
    sessionController: {
      fork: async () => ({ sessionId: 'session-forked-1' }),
    },
    sessionQuery: undefined,
    dshHome: join(dir, 'home'),
    platform: 'linux',
    dshVersion: 'test',
  }
}

test('parseMoverArgs 兼容 /mover 前缀与引号路径', () => {
  assert.deepEqual(parseMoverArgs('export /tmp/a.dshpack'), ['export', '/tmp/a.dshpack'])
  assert.deepEqual(parseMoverArgs('/mover import /tmp/a.dshpack /tmp/t'), [
    'import',
    '/tmp/a.dshpack',
    '/tmp/t',
  ])
  assert.deepEqual(parseMoverArgs('export "C:\\My Files\\a.dshpack" s1 s2'), [
    'export',
    'C:\\My Files\\a.dshpack',
    's1',
    's2',
  ])
  assert.deepEqual(parseMoverArgs('   '), [])
})

test('export 生成可读包', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-cmd-'))
  try {
    const bytes = makeSessionBytes()
    const sessionFile = join(dir, 's1.v4.jsonl.zstd')
    await writeFile(sessionFile, bytes)
    const deps = await makeDeps(dir, sessionFile, bytes)
    const out = join(dir, 'out.dshpack')
    const result = await exportAllSessions(deps, out)
    assert.equal(result.kind, 'success')
    assert.match(result.text, /已导出 1 个对话/)

    const { entries } = readZip(await readFile(out))
    const names = entries.map((entry) => entry.name)
    assert.ok(names.includes('manifest.json'))
    assert.ok(names.includes('sessions/s1/session.v4.jsonl.zstd'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('import 写回会话并保留可解析 header', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-cmd-'))
  try {
    const bytes = makeSessionBytes()
    const sessionFile = join(dir, 's1.v4.jsonl.zstd')
    await writeFile(sessionFile, bytes)
    const deps = await makeDeps(dir, sessionFile, bytes)
    const out = join(dir, 'out.dshpack')
    await exportAllSessions(deps, out)

    const targetRoot = join(dir, 'target')
    await mkdir(targetRoot, { recursive: true })
    // 模拟空 home：已有会话集合为空，避免新冲突检测把本次导入判为 skip
    deps.sessionPersistence.list = async () => []
    const result = await importPack(deps, out, targetRoot)
    assert.equal(result.kind, 'success')
    assert.match(result.text, /已导入 1 个对话/)

    const imported = join(deps.dshHome, 'sessions', '--p--', 's1', 'session.v4.jsonl.zstd')
    const data = await readFile(imported)
    const frames = scanFrames(data)
    const header = JSON.parse(
      zlib
        .zstdDecompressSync(data.subarray(frames[0].start, frames[0].end))
        .toString('utf8')
        .slice(0, -1),
    )
    assert.equal(header.id, 's1')
    assert.equal(header.cwd, '/p')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('用法错误返回 error 文本', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-cmd-'))
  try {
    const bytes = makeSessionBytes()
    const sessionFile = join(dir, 's1.v4.jsonl.zstd')
    await writeFile(sessionFile, bytes)
    const deps = await makeDeps(dir, sessionFile, bytes)
    const result = await handleMover(deps, { rawInput: 'unknown' })
    assert.equal(result.kind, 'error')
    assert.match(result.text, /用法/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('createMoverCommand 暴露 name/description/handler', () => {
  const command = createMoverCommand({})
  assert.equal(command.name, 'mover')
  assert.equal(typeof command.description, 'string')
  assert.equal(typeof command.handler, 'function')
})

test('resolveExportTarget：目录自动生成文件名，文件原样，父目录不存在报错', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-cmd-'))
  try {
    const resolvedDir = await resolveExportTarget(dir)
    assert.ok(resolvedDir.startsWith(dir))
    assert.match(resolvedDir, /dsh-pack-and-go-\d{8}-\d{6}\.dshpack$/)

    const file = join(dir, 'a.dshpack')
    assert.equal(await resolveExportTarget(file), file)

    await assert.rejects(
      () => resolveExportTarget(join(dir, 'missing', 'b.dshpack')),
      /目标目录不存在/,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('export 到目录时自动生成包文件', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-cmd-'))
  try {
    const bytes = makeSessionBytes()
    const sessionFile = join(dir, 's1.v4.jsonl.zstd')
    await writeFile(sessionFile, bytes)
    const deps = await makeDeps(dir, sessionFile, bytes)
    const result = await exportAllSessions(deps, dir)
    assert.equal(result.kind, 'success')
    const names = await readdir(dir)
    assert.ok(names.some((name) => /^dsh-pack-and-go-\d{8}-\d{6}\.dshpack$/.test(name)))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('inspect 预览包信息与冲突', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-cmd-'))
  try {
    const bytes = makeSessionBytes()
    const sessionFile = join(dir, 's1.v4.jsonl.zstd')
    await writeFile(sessionFile, bytes)
    const deps = await makeDeps(dir, sessionFile, bytes)
    const out = join(dir, 'out.dshpack')
    await exportAllSessions(deps, out)
    const result = await inspectPack(deps, out)
    assert.equal(result.kind, 'success')
    const data = JSON.parse(result.text)
    assert.equal(data.sessions, 1)
    assert.equal(data.workspaces, 0)
    assert.equal(data.conflicts.sessions, 1)
    assert.ok(Array.isArray(data.conflictDetails.sessions))
    assert.equal(data.conflictDetails.sessions[0].kind, 'overwrite-in-place')
    assert.ok(data.packBytes > 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('导入冲突策略：默认跳过，overwrite 覆盖', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-cmd-'))
  try {
    const bytes = makeSessionBytes()
    const sessionFile = join(dir, 's1.v4.jsonl.zstd')
    await writeFile(sessionFile, bytes)
    const deps = await makeDeps(dir, sessionFile, bytes)
    const out = join(dir, 'out.dshpack')
    await exportAllSessions(deps, out)

    // makeDeps 的 list 返回 s1 → 同 id 冲突
    const skipped = await importPack(deps, out, join(dir, 'target-skip'))
    assert.equal(skipped.kind, 'success')
    assert.match(skipped.text, /已导入 0 个对话/)
    assert.match(skipped.text, /跳过 1 个已存在/)

    const overwritten = await importPack(deps, out, join(dir, 'target-over'), {
      sessionPolicy: 'overwrite',
    })
    assert.equal(overwritten.kind, 'success')
    assert.match(overwritten.text, /覆盖 1 个/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('仅导出工作区（含文件）并导入还原文件结构', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-cmd-'))
  try {
    const workspace = join(dir, 'ws-with-files')
    await mkdir(join(workspace, 'sub'), { recursive: true })
    await writeFile(join(workspace, 'a.txt'), 'hello')
    await writeFile(join(workspace, 'sub', 'b.txt'), 'world')
    const deps = await makeDeps(dir, join(dir, 'unused.zst'), Buffer.alloc(0))
    const out = join(dir, 'ws-files.dshpack')
    const exported = await exportWorkspacesOnly(deps, out, [workspace])
    assert.equal(exported.kind, 'success')
    assert.match(exported.text, /2 个文件/)

    const target = join(dir, 'import-target')
    const imported = await importPack(deps, out, target, { sessionPolicy: 'skip' })
    assert.equal(imported.kind, 'success')
    assert.match(imported.text, /登记 1 个工作区/)
    assert.equal(await readFile(join(target, 'ws-with-files', 'a.txt'), 'utf8'), 'hello')
    assert.equal(await readFile(join(target, 'ws-with-files', 'sub', 'b.txt'), 'utf8'), 'world')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('仅导出工作区（含空目录）并导入登记为空工作区', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-cmd-'))
  try {
    const emptyWorkspace = join(dir, 'empty-workspace')
    await mkdir(emptyWorkspace)
    const deps = await makeDeps(dir, join(dir, 'unused.zst'), Buffer.alloc(0))
    const out = join(dir, 'ws-only.dshpack')
    const exported = await exportWorkspacesOnly(deps, out, [emptyWorkspace])
    assert.equal(exported.kind, 'success')
    assert.match(exported.text, /已导出 1 个工作区/)

    const target = join(dir, 'import-target')
    const imported = await importPack(deps, out, target, { sessionPolicy: 'skip' })
    assert.equal(imported.kind, 'success')
    assert.match(imported.text, /登记 1 个工作区/)
    assert.match(imported.text, /暂无对话/)
    assert.ok(existsSync(join(target, 'empty-workspace')))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('仅导出工作区：文件符号链接解引用并计入统计', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-cmd-'))
  try {
    const workspace = join(dir, 'ws-link')
    await mkdir(workspace, { recursive: true })
    await writeFile(join(workspace, 'target.txt'), 'x')
    let linked = false
    try {
      await symlink(join(workspace, 'target.txt'), join(workspace, 'link.txt'), 'file')
      linked = true
    } catch {
      // Windows 未开启开发者模式时无法创建符号链接，跳过本用例
    }
    if (!linked) return
    const deps = await makeDeps(dir, join(dir, 'unused.zst'), Buffer.alloc(0))
    const out = join(dir, 'ws-link.dshpack')
    const exported = await exportWorkspacesOnly(deps, out, [workspace])
    assert.equal(exported.kind, 'success')
    assert.match(exported.text, /解引用 1 个符号链接/)
    const target = join(dir, 'import-target')
    const imported = await importPack(deps, out, target, { sessionPolicy: 'skip' })
    assert.equal(imported.kind, 'success')
    assert.equal(await readFile(join(target, 'ws-link', 'link.txt'), 'utf8'), 'x')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('导出附件时缺少 dshHome 回退到默认 home（不抛 path 错误）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-mover-cmd-'))
  try {
    const bytes = makeSessionBytes()
    const sessionFile = join(dir, 's1.v4.jsonl.zstd')
    await writeFile(sessionFile, bytes)
    const deps = await makeDeps(dir, sessionFile, bytes)
    delete deps.dshHome
    const out = join(dir, 'out.dshpack')
    const result = await exportAllSessions(deps, out, [], true, { attachments: true })
    assert.equal(result.kind, 'success')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('导入必须指定目标目录且不接受已移除的 new-id', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-cmd-'))
  try {
    const bytes = makeSessionBytes()
    const sessionFile = join(dir, 's1.v4.jsonl.zstd')
    await writeFile(sessionFile, bytes)
    const deps = await makeDeps(dir, sessionFile, bytes)
    const out = join(dir, 'out.dshpack')
    await exportAllSessions(deps, out)

    const missing = await importPack(deps, out, '')
    assert.equal(missing.kind, 'error')
    assert.match(missing.text, /目标目录/)

    const rejected = await importPack(deps, out, join(dir, 'target'), {
      sessionPolicy: 'new-id',
    })
    assert.equal(rejected.kind, 'error')
    assert.match(rejected.text, /已移除/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('measureWorkspaces 统计目录字节数', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-cmd-'))
  try {
    const project = join(dir, 'proj')
    await mkdir(join(project, 'sub'), { recursive: true })
    await writeFile(join(project, 'a.txt'), Buffer.alloc(1000, 0x61))
    await writeFile(join(project, 'sub', 'b.txt'), Buffer.alloc(2000, 0x62))
    const result = await measureWorkspaces([project])
    assert.equal(result.kind, 'success')
    const data = JSON.parse(result.text)
    assert.equal(data.items.length, 1)
    assert.equal(data.items[0].path, project)
    assert.equal(data.items[0].bytes, 3000)
    assert.equal(data.items[0].files, 2)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('listCatalog 返回可解析的 JSON', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-cmd-'))
  try {
    const bytes = makeSessionBytes()
    const sessionFile = join(dir, 's1.v4.jsonl.zstd')
    await writeFile(sessionFile, bytes)
    const deps = await makeDeps(dir, sessionFile, bytes)
    const result = await listCatalog(deps)
    assert.equal(result.kind, 'success')
    const data = JSON.parse(result.text)
    assert.equal(data.workspaces.length, 1)
    assert.equal(data.workspaces[0].sessions[0].id, 's1')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('导出默认连带 fork 子代理会话，--no-fork 只导出选中', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-cmd-'))
  try {
    const parentBytes = makeSessionBytes('s1', '/p')
    const childBytes = makeSessionBytes('s2', '/p')
    const parentFile = join(dir, 's1.v4.jsonl.zstd')
    const childFile = join(dir, 's2.v4.jsonl.zstd')
    await writeFile(parentFile, parentBytes)
    await writeFile(childFile, childBytes)
    const deps = {
      workspaceRegistry: {
        list: () => [{ id: 'w1', path: '/p', title: 'P', sessionIds: ['s1'] }],
      },
      sessionPersistence: {
        list: async () => [
          {
            header: { id: 's1', cwd: '/p', createdAt: 1, isSeeded: false, delegationDepth: 0 },
            sizeBytes: parentBytes.length,
            location: { kind: 'jsonl', path: parentFile },
          },
          {
            header: {
              id: 's2',
              cwd: '/p',
              createdAt: 2,
              parentSession: 's1',
              origin: 'subagent',
              isSeeded: false,
              delegationDepth: 1,
            },
            sizeBytes: childBytes.length,
            location: { kind: 'jsonl', path: childFile },
          },
        ],
      },
      sessionQuery: undefined,
      dshHome: join(dir, 'home'),
      platform: 'linux',
      dshVersion: 'test',
    }

    const withFork = join(dir, 'with-fork.dshpack')
    const result = await exportAllSessions(deps, withFork, ['s1'])
    assert.equal(result.kind, 'success')
    const names = readZip(await readFile(withFork)).entries.map((entry) => entry.name)
    assert.ok(names.includes('sessions/s1/session.v4.jsonl.zstd'))
    assert.ok(names.includes('sessions/s2/session.v4.jsonl.zstd'))

    const withoutFork = join(dir, 'without-fork.dshpack')
    const result2 = await exportAllSessions(deps, withoutFork, ['s1'], false, {
      includeFork: false,
    })
    assert.equal(result2.kind, 'success')
    const names2 = readZip(await readFile(withoutFork)).entries.map((entry) => entry.name)
    assert.ok(names2.includes('sessions/s1/session.v4.jsonl.zstd'))
    assert.ok(!names2.includes('sessions/s2/session.v4.jsonl.zstd'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test(
  '仅导出工作区包含目录条目 mode（ADR-0016 B2）',
  { skip: process.platform === 'win32' },
  async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-cmd-'))
  try {
    const workspace = join(dir, 'ws-dir-mode')
    await mkdir(join(workspace, 'sub'), { recursive: true })
    await writeFile(join(workspace, 'sub', 'a.txt'), 'a')
    const deps = await makeDeps(dir, join(dir, 'unused.zst'), Buffer.alloc(0))
    const out = join(dir, 'dir-mode.dshpack')
    const exported = await exportWorkspacesOnly(deps, out, [workspace])
    assert.equal(exported.kind, 'success')
    const zip = readZip(await readFile(out))
    const dirEntry = zip.entries.find(
      (entry) => entry.name === 'workspaces/ws-1/files/sub/',
    )
    assert.ok(dirEntry, '应包含目录条目')
    // 目录 mode 受当前 umask 影响，按实际创建的目录比较，避免依赖 022 的 CI 假设。
    const expectedMode = (await stat(join(workspace, 'sub'))).mode & 0o777
    assert.equal(dirEntry.mode & 0o777, expectedMode, '目录条目应记录真实 mode')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('导出时无法读取的工作区被列出而不是静默跳过（P1-4）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-cmd-'))
  try {
    const bytes = makeSessionBytes()
    const sessionFile = join(dir, 's1.v4.jsonl.zstd')
    await writeFile(sessionFile, bytes)
    const deps = await makeDeps(dir, sessionFile, bytes)
    const missing = join(dir, 'missing-workspace')
    // cwd 指向不存在的目录：scanWorkspace 会抛 SCAN_INVALID（P1-4 的典型场景：
    // 来源机器上的工作区路径在本机不存在）。
    deps.sessionPersistence.list = async () => [
      {
        header: { id: 's1', cwd: missing, createdAt: 1 },
        sizeBytes: bytes.length,
        location: { kind: 'jsonl', path: sessionFile },
      },
    ]

    const out = join(dir, 'ok.dshpack')
    const result = await exportAllSessions(deps, out, [], true, {})
    assert.equal(result.kind, 'success')
    assert.match(result.text, /1 个工作区无法读取已跳过/)
    assert.ok(result.text.includes(missing))
    const { entries } = readZip(await readFile(out))
    const manifestEntry = entries.find((entry) => entry.name === 'manifest.json')
    const manifest = JSON.parse(manifestEntry.data.toString('utf8'))
    assert.equal(manifest.workspaces.length, 0)
    assert.equal(manifest.sessions.length, 1)

    // --strict：中止导出且不产出包文件
    const strictOut = join(dir, 'strict.dshpack')
    const strict = await exportAllSessions(deps, strictOut, [], true, { strict: true })
    assert.equal(strict.kind, 'error')
    assert.match(strict.text, /导出中止（--strict）/)
    assert.ok(strict.text.includes(missing))
    assert.equal(existsSync(strictOut), false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('仅导出工作区：显式指定的不存在目录报错且不产出包（P1-4）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-cmd-'))
  try {
    const bytes = makeSessionBytes()
    const sessionFile = join(dir, 's1.v4.jsonl.zstd')
    await writeFile(sessionFile, bytes)
    const deps = await makeDeps(dir, sessionFile, bytes)
    const good = join(dir, 'good-workspace')
    await mkdir(good, { recursive: true })
    await writeFile(join(good, 'a.txt'), 'a')

    const okOut = join(dir, 'ws.dshpack')
    const ok = await exportWorkspacesOnly(deps, okOut, [good], {})
    assert.equal(ok.kind, 'success')
    assert.match(ok.text, /已导出 1 个工作区/)
    assert.ok(!ok.text.includes('无法读取已跳过'))

    const missing = join(dir, 'missing-workspace')
    const errOut = join(dir, 'ws-missing.dshpack')
    const err = await exportWorkspacesOnly(deps, errOut, [missing], {})
    assert.equal(err.kind, 'error')
    assert.match(err.text, /工作区目录不存在/)
    assert.equal(existsSync(errOut), false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})


test('命令入口默认执行导出预检，--no-preflight 才跳过（P2-8 / D1）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-cmd-'))
  try {
    const bytes = makeSessionBytes()
    const sessionFile = join(dir, 's1.v4.jsonl.zstd')
    await writeFile(sessionFile, bytes)
    const deps = await makeDeps(dir, sessionFile, bytes)
    const workspaceDir = join(dir, 'workspace')
    await mkdir(workspaceDir, { recursive: true })
    await writeFile(join(workspaceDir, 'a.txt'), 'a')
    deps.sessionPersistence.list = async () => [
      {
        header: { id: 's1', cwd: workspaceDir, createdAt: 1 },
        sizeBytes: bytes.length,
        location: { kind: 'jsonl', path: sessionFile },
      },
    ]

    const withPreflight = await handleMover(deps, {
      rawInput: `export ${join(dir, 'a.dshpack')} --files`,
    })
    assert.equal(withPreflight.kind, 'success')
    assert.match(withPreflight.text, /预检 \d+ 项/)

    const withoutPreflight = await handleMover(deps, {
      rawInput: `export ${join(dir, 'b.dshpack')} --files --no-preflight`,
    })
    assert.equal(withoutPreflight.kind, 'success')
    assert.ok(!/预检 \d+ 项/.test(withoutPreflight.text))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('inspect 预览展示来源机器名；旧包显示空（ADR-0022 / T13.1）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-cmd-'))
  try {
    const bytes = makeSessionBytes()
    const sessionFile = join(dir, 's1.v4.jsonl.zstd')
    await writeFile(sessionFile, bytes)
    const deps = await makeDeps(dir, sessionFile, bytes)
    const out = join(dir, 'out.dshpack')
    await exportAllSessions(deps, out)
    const fresh = JSON.parse((await inspectPack(deps, out)).text)
    assert.equal(typeof fresh.machineName, 'string')
    assert.ok(fresh.machineName.length > 0)

    // 旧包：manifest 未写 machineName（保持旧语义）
    const legacyManifest = buildManifest({
      platform: 'linux',
      dshVersion: 'legacy',
      mode: 'sessions',
      sessions: [
        {
          id: 's1',
          cwd: '/p',
          messageCount: 0,
          sizeBytes: bytes.length,
          path: 'sessions/s1/session.v4.jsonl.zstd',
        },
      ],
    })
    const legacyOut = join(dir, 'legacy.dshpack')
    await buildPackToFile({
      plan: { items: [{ path: 'sessions/s1/session.v4.jsonl.zstd' }] },
      sourcePaths: { 'sessions/s1/session.v4.jsonl.zstd': sessionFile },
      manifest: legacyManifest,
      outputPath: legacyOut,
    })
    const legacy = JSON.parse((await inspectPack(deps, legacyOut)).text)
    assert.equal(legacy.machineName, null)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('inspect 预览目标与真实导入同源（P2-7 / T13.2）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-cmd-'))
  try {
    const bytes = makeSessionBytes()
    const sessionFile = join(dir, 's1.v4.jsonl.zstd')
    await writeFile(sessionFile, bytes)
    const deps = await makeDeps(dir, sessionFile, bytes)
    const sourceFile = join(dir, 'x.txt')
    await writeFile(sourceFile, 'demo')
    const manifest = buildManifest({
      platform: 'linux',
      dshVersion: 'test',
      mode: 'workspaces',
      workspaces: [
        {
          key: 'w1',
          title: 'Proj',
          sourcePath: '/src/Proj',
          sourcePlatform: 'linux',
          fileCount: 1,
          sizeBytes: 4,
          root: 'workspaces/w1',
        },
      ],
    })
    const packPath = join(dir, 'ws.dshpack')
    await buildPackToFile({
      plan: { items: [{ path: 'workspaces/w1/files/x.txt' }] },
      sourcePaths: { 'workspaces/w1/files/x.txt': sourceFile },
      manifest,
      outputPath: packPath,
    })

    const targetRoot = join(dir, 'target')
    await mkdir(join(targetRoot, 'Proj'), { recursive: true })
    await writeFile(join(targetRoot, 'Proj', 'existing.txt'), 'old')

    const preview = JSON.parse((await inspectPack(deps, packPath, targetRoot)).text)
    assert.equal(preview.targetRoot, targetRoot)
    assert.equal(preview.previewTargets.length, 1)
    assert.equal(preview.previewTargets[0].action, 'rename')
    assert.ok(preview.previewTargets[0].path.endsWith('Proj (1)'))
    assert.equal(preview.conflicts.workspaces, 1)

    const imported = await importPack(deps, packPath, targetRoot, {})
    assert.equal(imported.kind, 'success')
    assert.ok(existsSync(join(targetRoot, 'Proj (1)', 'x.txt')))
    assert.equal(await readFile(join(targetRoot, 'Proj', 'existing.txt'), 'utf8'), 'old')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('inspect 预览统计目标已存在的附件对象（P2-7 / ADR-0022）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-cmd-'))
  try {
    const bytes = makeSessionBytes()
    const sessionFile = join(dir, 's1.v4.jsonl.zstd')
    await writeFile(sessionFile, bytes)
    const deps = await makeDeps(dir, sessionFile, bytes)
    const digest = 'a'.repeat(64)
    const manifest = buildManifest({
      platform: 'linux',
      dshVersion: 'test',
      mode: 'sessions',
      sessions: [],
      attachments: [{ id: `sha256:${digest}`, sizeBytes: 1 }],
    })
    const packPath = join(dir, 'att.dshpack')
    await buildPackToFile({ plan: { items: [] }, manifest, outputPath: packPath, sourcePaths: {} })
    const objectDir = join(deps.dshHome, 'attachments', 'v1', 'objects', digest.slice(0, 2))
    await mkdir(objectDir, { recursive: true })
    await writeFile(join(objectDir, digest), 'x')
    const preview = JSON.parse((await inspectPack(deps, packPath)).text)
    assert.equal(preview.conflicts.attachments, 1)
    assert.equal(preview.conflictDetails.attachments[0].kind, 'existing-object')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('handleMover 默认不写 mover-debug.log，DSH_PACK_AND_GO_DEBUG=1 时才写（P2-11）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-debug-'))
  const previousHome = process.env.DSH_HOME
  const previousDebug = process.env.DSH_PACK_AND_GO_DEBUG
  try {
    const sessionFile = join(dir, 's1.v4.jsonl.zstd')
    const bytes = makeSessionBytes()
    await writeFile(sessionFile, bytes)
    const deps = await makeDeps(dir, sessionFile, bytes)
    process.env.DSH_HOME = dir
    delete process.env.DSH_PACK_AND_GO_DEBUG
    const logPath = join(dir, 'mover-debug.log')

    const quiet = await handleMover(deps, { rawInput: 'list' })
    assert.equal(quiet.kind, 'success')
    assert.equal(existsSync(logPath), false)

    process.env.DSH_PACK_AND_GO_DEBUG = '1'
    const verbose = await handleMover(deps, { rawInput: 'list' })
    assert.equal(verbose.kind, 'success')
    assert.equal(existsSync(logPath), true)
    const logged = await readFile(logPath, 'utf8')
    assert.match(logged, /args=\["list"\]/)
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    if (previousDebug === undefined) delete process.env.DSH_PACK_AND_GO_DEBUG
    else process.env.DSH_PACK_AND_GO_DEBUG = previousDebug
    await rm(dir, { recursive: true, force: true })
  }
})
