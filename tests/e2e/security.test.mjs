import test from 'node:test'
import assert from 'node:assert/strict'
import zlib from 'node:zlib'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createZip } from '../../src/core/zip-writer.js'
import { readZip } from '../../src/core/zip-reader.js'
import { buildManifest, buildPack } from '../../src/core/export-pack.js'
import { planExport } from '../../src/core/plan-export.js'

const FORBIDDEN = [
  '.credentials',
  'credentials',
  'llm-deepseek',
  'cache/',
  'node_modules/',
  '.env',
  'dsh-runtimes',
  'electron/',
  'profiles/',
]

function assertNoForbiddenPaths(names) {
  for (const name of names) {
    for (const forbidden of FORBIDDEN) {
      assert.ok(
        !name.includes(forbidden),
        `package entry must not contain ${forbidden}: ${name}`,
      )
    }
  }
}

test('导出包不包含凭据/缓存/依赖路径', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-mover-sec-'))
  try {
    const sessionFile = join(dir, 'session.v4.jsonl.zstd')
    const header = {
      type: 'session',
      version: 4,
      id: 's1',
      createdAt: 1,
      isSeeded: false,
      delegationDepth: 0,
      cwd: '/p',
    }
    const sessionBytes = Buffer.concat([
      zlib.zstdCompressSync(Buffer.from(`${JSON.stringify(header)}\n`)),
      zlib.zstdCompressSync(Buffer.from('{"type":"turn/start","seq":0}\n')),
    ])
    await writeFile(sessionFile, sessionBytes)
    const projectFile = join(dir, 'a.txt')
    await writeFile(projectFile, 'hello')

    const plan = planExport({
      sessions: [{ packPath: 'sessions/s1/session.v4.jsonl.zstd', sizeBytes: sessionBytes.length }],
      workspaces: [{ key: 'w1', files: [{ relPath: 'a.txt', size: 5 }] }],
      includeFiles: true,
    })
    const manifest = buildManifest({
      platform: 'linux',
      dshVersion: 'sec',
      mode: 'sessions+workspaces',
      sessions: [
        {
          id: 's1',
          workspaceKey: 'w1',
          messageCount: 1,
          sizeBytes: sessionBytes.length,
          path: 'sessions/s1/session.v4.jsonl.zstd',
        },
      ],
      workspaces: [
        {
          key: 'w1',
          title: 'P',
          sourcePath: '/p',
          sourcePlatform: 'linux',
          fileCount: 1,
          sizeBytes: 5,
          root: 'workspaces/w1/files',
        },
      ],
    })
    const pack = await buildPack({
      plan,
      sourcePaths: {
        'sessions/s1/session.v4.jsonl.zstd': sessionFile,
        'workspaces/w1/files/a.txt': projectFile,
      },
      manifest,
    })
    const { entries } = readZip(pack)
    const names = entries.map((entry) => entry.name)
    assert.ok(names.includes('manifest.json'))
    assertNoForbiddenPaths(names)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

function replaceAll(buffer, from, to) {
  assert.equal(Buffer.byteLength(from), Buffer.byteLength(to))
  const copy = Buffer.from(buffer)
  let index = 0
  while ((index = copy.indexOf(from, index)) !== -1) {
    copy.write(to, index, 'utf8')
    index += Buffer.byteLength(to)
  }
  return copy
}

test('zip 读取拒绝路径穿越与绝对路径', () => {
  const evil = createZip([{ name: '__/evil.txt', data: Buffer.from('x') }])
  assert.throws(() => readZip(replaceAll(evil, '__/evil.txt', '../evil.txt')), /\.\./)

  const abs = createZip([{ name: '_abs.txt', data: Buffer.from('x') }])
  assert.throws(() => readZip(replaceAll(abs, '_abs.txt', '/abs.txt')), /绝对路径|absolute/)

  assert.throws(() => createZip([{ name: '/abs.txt', data: Buffer.from('x') }]), /forward/)
})

test('安全名称断言覆盖常见敏感文件', () => {
  const names = ['manifest.json', 'sessions/s1/session.v4.jsonl.zstd']
  assertNoForbiddenPaths(names)
  assert.throws(() => assertNoForbiddenPaths(['.credentials.yaml']), /credentials/)
})
