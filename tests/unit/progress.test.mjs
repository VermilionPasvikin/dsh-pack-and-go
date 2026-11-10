import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createProgressEvent,
  progressPercent,
  serializeProgress,
  parseProgress,
  ALL_STAGES,
  PROGRESS_STATUS,
} from '../../src/core/progress.js'
import { ERROR_CODES, MoverError } from '../../src/core/errors.js'

function expectProgressError(fn) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof MoverError)
    assert.equal(error.code, ERROR_CODES.PROGRESS_INVALID)
    return true
  })
}

test('合法进度帧可创建并冻结', () => {
  const event = createProgressEvent({
    taskId: 'task-1',
    stage: 'scan',
    done: 3,
    total: 10,
    bytesDone: 30,
    bytesTotal: 100,
    message: '扫描中',
  })
  assert.equal(event.taskId, 'task-1')
  assert.equal(event.stage, 'scan')
  assert.equal(event.status, 'running')
  assert.ok(Object.isFrozen(event))
})

test('支持导出与导入的全部阶段', () => {
  const event = createProgressEvent({ taskId: 't', stage: 'restore-sessions' })
  assert.equal(event.stage, 'restore-sessions')
  assert.ok(ALL_STAGES.includes('pack-workspaces'))
  assert.ok(ALL_STAGES.includes('register'))
})

test('非法字段被拒绝', () => {
  expectProgressError(() => createProgressEvent({ taskId: 't', stage: 'unknown-stage' }))
  expectProgressError(() =>
    createProgressEvent({ taskId: 't', stage: 'scan', status: 'exploded' }),
  )
  expectProgressError(() => createProgressEvent({ taskId: '', stage: 'scan' }))
  expectProgressError(() => createProgressEvent({ taskId: 't', stage: 'scan', done: -1 }))
  expectProgressError(() =>
    createProgressEvent({ taskId: 't', stage: 'scan', done: 5, total: 3 }),
  )
  expectProgressError(() =>
    createProgressEvent({ taskId: 't', stage: 'scan', bytesDone: 5, bytesTotal: 3 }),
  )
})

test('百分比计算', () => {
  assert.equal(progressPercent({ done: 0, total: 10, status: 'running' }), 0)
  assert.equal(progressPercent({ done: 5, total: 10, status: 'running' }), 50)
  assert.equal(progressPercent({ done: 10, total: 10, status: 'running' }), 100)
  assert.equal(progressPercent({ done: 2, total: 0, status: 'running' }), 0)
  assert.equal(progressPercent({ done: 2, total: 10, status: 'success' }), 100)
})

test('序列化与解析往返', () => {
  const event = createProgressEvent({
    taskId: 'task-1',
    stage: 'verify',
    status: 'success',
    done: 10,
    total: 10,
    bytesDone: 100,
    bytesTotal: 100,
  })
  const parsed = parseProgress(serializeProgress(event))
  assert.equal(parsed.taskId, event.taskId)
  assert.equal(parsed.stage, event.stage)
  assert.equal(parsed.status, 'success')
})

test('错误帧可携带结构化错误', () => {
  const event = createProgressEvent({
    taskId: 'task-1',
    stage: 'verify',
    status: 'error',
    error: { code: 'E_PACK_INVALID', title: '迁移包损坏', next: '请重新拷贝' },
  })
  assert.equal(event.error.code, 'E_PACK_INVALID')
})

test('解析非法帧被拒绝', () => {
  expectProgressError(() => parseProgress('not json'))
  expectProgressError(() => parseProgress('[]'))
  expectProgressError(() => parseProgress(JSON.stringify({ taskId: 't' })))
  expectProgressError(() =>
    parseProgress(JSON.stringify({ taskId: 't', stage: 'bogus', status: 'running' })),
  )
})

test('状态常量', () => {
  assert.deepEqual([...PROGRESS_STATUS], ['running', 'success', 'error', 'cancelled'])
})
