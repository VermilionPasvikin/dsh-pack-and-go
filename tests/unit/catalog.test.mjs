import test from 'node:test'
import assert from 'node:assert/strict'

import {
  assembleCatalog,
  loadCatalog,
  fallbackTitle,
  readTitleFromFile,
  titleFromEvents,
} from '../../src/host/catalog.js'
import { ERROR_CODES, MoverError } from '../../src/core/errors.js'
import { decodeSessionEvents } from '../../src/core/attachments.js'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import zlib from 'node:zlib'

function makeServices() {
  return {
    workspaceRegistry: {
      list: () => [
        { id: 'w1', path: '/p', title: 'P', sessionIds: ['s1', 's2'] },
        { id: 'w2', path: '/q', title: 'Q', sessionIds: [] },
      ],
    },
    sessionPersistence: {
      list: async () => [
        { header: { id: 's1', cwd: '/p', createdAt: 100 }, sizeBytes: 10 },
        { header: { id: 's2', cwd: '/p', createdAt: 200 }, sizeBytes: 20 },
        { header: { id: 's3', cwd: '/other', createdAt: 300 }, sizeBytes: 30 },
      ],
    },
    sessionQuery: {
      readTitleSnapshots: async (ids) =>
        ids.map((id) => ({
          sessionId: id,
          status: 'fulfilled',
          value: { session: { id }, title: { title: `T-${id}` } },
        })),
    },
    platform: 'linux',
  }
}

test('assembleCatalog 归组、未归组与排序', () => {
  const catalog = assembleCatalog({
    workspaces: [{ id: 'w1', path: '/p', title: 'P', sessionIds: ['s1', 's2'] }],
    snapshots: [
      { header: { id: 's1', cwd: '/p', createdAt: 100 }, sizeBytes: 10 },
      { header: { id: 's2', cwd: '/p', createdAt: 200 }, sizeBytes: 20 },
      { header: { id: 's3', cwd: '/other', createdAt: 300 }, sizeBytes: 30 },
    ],
    titles: new Map([['s1', '标题一']]),
  })
  assert.equal(catalog.workspaces.length, 1)
  assert.deepEqual(
    catalog.workspaces[0].sessions.map((session) => session.id),
    ['s2', 's1'],
  )
  assert.equal(catalog.workspaces[0].sessions[1].title, '标题一')
  assert.equal(catalog.ungrouped.length, 1)
  assert.equal(catalog.ungrouped[0].id, 's3')
  assert.deepEqual(catalog.totals, { workspaces: 1, sessions: 3, bytes: 60 })
})

test('缺失标题时使用 cwd 末段兜底', () => {
  const catalog = assembleCatalog({
    workspaces: [],
    snapshots: [
      { header: { id: 's1', cwd: 'F:\\work\\proj', createdAt: 1 } },
      { header: { id: 's2', createdAt: 2 } },
    ],
  })
  assert.equal(catalog.ungrouped.find((s) => s.id === 's1').title, 'proj')
  assert.equal(catalog.ungrouped.find((s) => s.id === 's2').title, 's2')
})

test('fallbackTitle 处理无 cwd 与根路径', () => {
  assert.equal(fallbackTitle({ id: 'x' }), 'x')
  assert.equal(fallbackTitle({ id: 'x', cwd: '/' }), '/')
  assert.equal(fallbackTitle({ id: 'x', cwd: 'C:\\' }), 'C:')
})

test('loadCatalog 从服务读取并合并标题', async () => {
  const catalog = await loadCatalog(makeServices())
  assert.equal(catalog.totals.sessions, 3)
  assert.equal(catalog.workspaces[0].sessions[0].title, 'T-s2')
  assert.equal(catalog.platform, 'linux')
})

test('loadCatalog 标题读取失败时仍返回目录', async () => {
  const services = makeServices()
  services.sessionQuery = {
    readTitleSnapshots: async () => {
      throw new Error('title backend down')
    },
  }
  const warnings = []
  services.logger = { warn: (...args) => warnings.push(args) }
  const catalog = await loadCatalog(services)
  assert.equal(catalog.totals.sessions, 3)
  assert.equal(warnings.length, 1)
})

test('loadCatalog 缺少必要服务时报错', async () => {
  await assert.rejects(
    () => loadCatalog({ sessionPersistence: { list: async () => [] } }),
    (error) => error instanceof MoverError && error.code === ERROR_CODES.CATALOG_INVALID,
  )
  await assert.rejects(
    () => loadCatalog({ workspaceRegistry: { list: () => [] } }),
    (error) => error instanceof MoverError && error.code === ERROR_CODES.CATALOG_INVALID,
  )
})


test('titleFromEvents：rename 优先于首条用户消息（P2-14④）', () => {
  const events = [
    { type: 'user/message', data: { content: [{ type: 'text', text: '最初的提问' }] } },
    { type: 'session/rename', data: { title: '正式标题' } },
  ]
  assert.equal(titleFromEvents(events), '正式标题')
})

test('titleFromEvents：多次 rename 取最后一次', () => {
  const events = [
    { type: 'session/rename', data: { title: '旧标题' } },
    { type: 'session/rename', data: { title: '新标题' } },
  ]
  assert.equal(titleFromEvents(events), '新标题')
})

test('titleFromEvents：没有 rename 时用首条用户消息前 24 字', () => {
  const events = [
    { type: 'user/message', data: { content: [{ type: 'text', text: '  第一句  ' }] } },
    { type: 'user/message', data: { content: [{ type: 'text', text: '第二句' }] } },
  ]
  assert.equal(titleFromEvents(events), '第一句')
})

test('readTitleFromFile 只读头部：尾部非法 JSON 不影响标题（P2-9）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-catalog-'))
  try {
    const header = { type: 'session', version: 4, id: 's1', createdAt: 1, cwd: '/p' }
    const userMessage = {
      type: 'user/message',
      seq: 0,
      data: { content: [{ type: 'text', text: 'Hello world' }] },
    }
    const filler = { type: 'turn/start', seq: 1, data: { note: 'x'.repeat(200) } }
    const frames = [
      zlib.zstdCompressSync(Buffer.from(JSON.stringify(header) + '\n' + JSON.stringify(userMessage) + '\n')),
    ]
    for (let i = 0; i < 300; i += 1) {
      frames.push(zlib.zstdCompressSync(Buffer.from(JSON.stringify(filler) + '\n')))
    }
    // 尾部一帧是非法 JSON：全量解析会抛错，头部读取应当成功
    frames.push(zlib.zstdCompressSync(Buffer.from('not-json-tail\n')))
    const logPath = join(dir, 'session.v4.jsonl.zstd')
    await writeFile(logPath, Buffer.concat(frames))

    assert.throws(() => decodeSessionEvents(readFileSync(logPath)))

    const title = await readTitleFromFile(logPath, { maxBytes: 4096 })
    assert.equal(title, 'Hello world')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('loadCatalog 在 sessionQuery 缺失时用头部读取标题（P2-9）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-catalog-'))
  try {
    const header = { type: 'session', version: 4, id: 's1', createdAt: 1, cwd: '/p' }
    const rename = { type: 'session/rename', seq: 1, data: { title: 'Final Name' } }
    const logPath = join(dir, 's1.v4.jsonl.zstd')
    await writeFile(
      logPath,
      zlib.zstdCompressSync(Buffer.from(JSON.stringify(header) + '\n' + JSON.stringify(rename) + '\n')),
    )
    const catalog = await loadCatalog({
      workspaceRegistry: {
        list: () => [{ id: 'w1', path: '/p', title: 'P', sessionIds: ['s1'] }],
      },
      sessionPersistence: {
        list: async () => [
          {
            header: { id: 's1', cwd: '/p', createdAt: 1 },
            sizeBytes: 10,
            location: { kind: 'jsonl', path: logPath },
          },
        ],
      },
      platform: 'linux',
    })
    assert.equal(catalog.workspaces[0].sessions[0].title, 'Final Name')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
