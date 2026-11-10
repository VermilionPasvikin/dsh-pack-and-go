import test from 'node:test'
import assert from 'node:assert/strict'

import { rebuildSessionViaService } from '../../src/host/rebuild.js'
import { ERROR_CODES, MoverError } from '../../src/core/errors.js'

function makeServices(events = []) {
  const captured = { createdHeader: undefined, appended: undefined }
  return {
    captured,
    sessionPersistence: {
      open: async (id, access) => ({
        read: async () => ({ events }),
        close: async () => {},
        id,
        access,
      }),
      create: async (header) => {
        captured.createdHeader = header
        return {
          append: async (next) => {
            captured.appended = next
          },
          flush: async () => {},
          close: async () => {},
        }
      },
    },
  }
}

test('重建会话：新 header + 原事件', async () => {
  const events = [
    { type: 'turn/start', seq: 0, time: 1, data: { turn: 0 } },
    { type: 'turn/end', seq: 1, time: 2, data: { turn: 0, reason: { kind: 'completed' } } },
  ]
  const { sessionPersistence, captured } = makeServices(events)
  const result = await rebuildSessionViaService({
    sessionPersistence,
    sourceId: 'session-old',
    newCwd: '/new/proj',
    createdAt: 1700000000000,
  })
  assert.match(result.id, /^session-/)
  assert.equal(result.events, 2)
  assert.equal(result.cwd, '/new/proj')
  assert.equal(captured.createdHeader.id, result.id)
  assert.equal(captured.createdHeader.cwd, '/new/proj')
  assert.equal(captured.createdHeader.version, 4)
  assert.equal(captured.createdHeader.createdAt, 1700000000000)
  assert.equal(captured.appended.length, 2)
})

test('不传 newCwd 时 header 不带 cwd', async () => {
  const { sessionPersistence, captured } = makeServices([])
  const result = await rebuildSessionViaService({
    sessionPersistence,
    sourceId: 'session-old',
  })
  assert.equal(result.cwd, undefined)
  assert.equal('cwd' in captured.createdHeader, false)
  assert.equal(captured.appended, undefined) // 无事件时不调用 append
})

test('缺少服务或 sourceId 报 E_REBUILD_FAILED', async () => {
  await assert.rejects(
    () => rebuildSessionViaService({ sessionPersistence: {}, sourceId: 'x' }),
    (error) => error instanceof MoverError && error.code === ERROR_CODES.REBUILD_FAILED,
  )
  await assert.rejects(
    () =>
      rebuildSessionViaService({
        sessionPersistence: {
          open: async () => ({ read: async () => ({ events: [] }), close: async () => {} }),
          create: async () => ({ append: async () => {}, flush: async () => {}, close: async () => {} }),
        },
      }),
    (error) => error instanceof MoverError && error.code === ERROR_CODES.REBUILD_FAILED,
  )
})

test('读取失败会传播错误', async () => {
  await assert.rejects(
    () =>
      rebuildSessionViaService({
        sessionPersistence: {
          open: async () => {
            throw new Error('not found')
          },
          create: async () => ({ append: async () => {}, flush: async () => {}, close: async () => {} }),
        },
        sourceId: 'missing',
      }),
    /not found/,
  )
})
