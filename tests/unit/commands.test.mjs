import test from 'node:test'
import assert from 'node:assert/strict'
import zlib from 'node:zlib'
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  parseMoverArgs,
  exportAllSessions,
  importPack,
  handleMover,
  createMoverCommand,
  resolveExportTarget,
  listCatalog,
  measureWorkspaces,
  inspectPack,
} from '../../src/host/commands.js'
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
  const dir = await mkdtemp(join(tmpdir(), 'dsh-mover-cmd-'))
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
  const dir = await mkdtemp(join(tmpdir(), 'dsh-mover-cmd-'))
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
  const dir = await mkdtemp(join(tmpdir(), 'dsh-mover-cmd-'))
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
  const dir = await mkdtemp(join(tmpdir(), 'dsh-mover-cmd-'))
  try {
    const resolvedDir = await resolveExportTarget(dir)
    assert.ok(resolvedDir.startsWith(dir))
    assert.match(resolvedDir, /dsh-mover-\d{8}-\d{6}\.dshpack$/)

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
  const dir = await mkdtemp(join(tmpdir(), 'dsh-mover-cmd-'))
  try {
    const bytes = makeSessionBytes()
    const sessionFile = join(dir, 's1.v4.jsonl.zstd')
    await writeFile(sessionFile, bytes)
    const deps = await makeDeps(dir, sessionFile, bytes)
    const result = await exportAllSessions(deps, dir)
    assert.equal(result.kind, 'success')
    const names = await readdir(dir)
    assert.ok(names.some((name) => /^dsh-mover-\d{8}-\d{6}\.dshpack$/.test(name)))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('inspect 预览包信息与冲突', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-mover-cmd-'))
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
    assert.ok(Array.isArray(data.conflicts.sessions))
    assert.ok(data.packBytes > 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('导入冲突策略：默认跳过，new-id 另存为新对话', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-mover-cmd-'))
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

    const copied = await importPack(deps, out, join(dir, 'target-new'), {
      sessionPolicy: 'new-id',
    })
    assert.equal(copied.kind, 'success')
    assert.match(copied.text, /已导入 1 个对话/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('measureWorkspaces 统计目录字节数', async () => {  const dir = await mkdtemp(join(tmpdir(), 'dsh-mover-cmd-'))
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
  const dir = await mkdtemp(join(tmpdir(), 'dsh-mover-cmd-'))
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
  const dir = await mkdtemp(join(tmpdir(), 'dsh-mover-cmd-'))
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
