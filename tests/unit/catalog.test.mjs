import test from 'node:test'
import assert from 'node:assert/strict'

import {
  assembleCatalog,
  loadCatalog,
  fallbackTitle,
} from '../../src/host/catalog.js'
import { ERROR_CODES, MoverError } from '../../src/core/errors.js'

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
