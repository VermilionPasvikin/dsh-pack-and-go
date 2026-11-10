import test from 'node:test'
import assert from 'node:assert/strict'
import zlib from 'node:zlib'
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  parseMoverArgs,
  exportAllSessions,
  importPack,
  handleMover,
  createMoverCommand,
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
    },
    sessionQuery: undefined,
    dshHome: join(dir, 'home'),
    platform: 'linux',
    dshVersion: 'test',
  }
}

test('parseMoverArgs 兼容 /mover 前缀', () => {
  assert.deepEqual(parseMoverArgs('export /tmp/a.dshpack'), ['export', '/tmp/a.dshpack'])
  assert.deepEqual(parseMoverArgs('/mover import /tmp/a.dshpack /tmp/t'), [
    'import',
    '/tmp/a.dshpack',
    '/tmp/t',
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
