import assert from 'node:assert/strict'
import test from 'node:test'

import { ERROR_CODES, MoverError } from '../../src/core/errors.js'
import { TASK_STATUS, createTaskRegistry } from '../../src/host/task-registry.js'

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 等到任务不再是 running。 */
async function settle(registry, taskId, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const state = registry.poll(taskId)
    if (state.status !== 'running') return state
    await sleep(5)
  }
  throw new Error('task did not settle in time')
}

test('start 在后台执行，成功后可 poll 到 result 与全部帧', async () => {
  const registry = createTaskRegistry()
  try {
    const { taskId } = registry.start({
      kind: 'export',
      title: '导出 3 个对话',
      run: async ({ taskId: id, onProgress }) => {
        onProgress({ taskId: id, stage: 'scan', status: 'running', done: 1, total: 2 })
        onProgress({ taskId: id, stage: 'done', status: 'success', done: 2, total: 2 })
        return { kind: 'success', text: '导出完成' }
      },
    })
    assert.match(taskId, /^export-/)

    const state = await settle(registry, taskId)
    assert.equal(state.status, 'success')
    assert.equal(state.frames.length, 2)
    assert.equal(state.frames[0].stage, 'scan')
    assert.equal(state.frames[1].stage, 'done')
    assert.equal(state.result.text, '导出完成')
    assert.equal(state.nextCursor, 2)
  } finally {
    registry.dispose()
  }
})

test('poll 游标只返回新增帧', async () => {
  const registry = createTaskRegistry()
  try {
    let release = null
    const gate = new Promise((resolve) => {
      release = resolve
    })
    const { taskId } = registry.start({
      kind: 'import',
      run: async ({ taskId: id, onProgress }) => {
        onProgress({ taskId: id, stage: 'verify', status: 'running', done: 1, total: 3 })
        await gate
        onProgress({ taskId: id, stage: 'register', status: 'running', done: 2, total: 3 })
        return { kind: 'success', text: 'ok' }
      },
    })

    await sleep(10)
    const first = registry.poll(taskId, 0)
    assert.equal(first.frames.length, 1)
    assert.equal(first.nextCursor, 1)

    const repeat = registry.poll(taskId, first.nextCursor)
    assert.equal(repeat.frames.length, 0)
    assert.equal(repeat.nextCursor, 1)

    release()
    const final = await settle(registry, taskId)
    const tail = registry.poll(taskId, 1)
    assert.equal(tail.frames.length, 1)
    assert.equal(tail.frames[0].stage, 'register')
    assert.equal(final.status, 'success')
  } finally {
    registry.dispose()
  }
})

test('cancel 中止正在运行的任务并标记 cancelled', async () => {
  const registry = createTaskRegistry()
  try {
    const { taskId } = registry.start({
      kind: 'export',
      run: async ({ taskId: id, signal, onProgress }) => {
        onProgress({ taskId: id, stage: 'scan', status: 'running', done: 1, total: 5 })
        await new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(new MoverError(ERROR_CODES.TASK_CANCELLED, '操作已取消'))
          })
        })
        return { kind: 'success', text: 'never' }
      },
    })

    await sleep(10)
    const result = registry.cancel(taskId)
    assert.equal(result.cancelled, true)

    const state = await settle(registry, taskId)
    assert.equal(state.status, 'cancelled')
    assert.equal(state.error.code, ERROR_CODES.TASK_CANCELLED)
    assert.equal(state.frames.length, 1, '取消后不再追加帧')

    const again = registry.cancel(taskId)
    assert.equal(again.cancelled, false)
    assert.equal(again.status, 'cancelled')
  } finally {
    registry.dispose()
  }
})

test('任务失败时记录 error 且状态为 error', async () => {
  const registry = createTaskRegistry()
  try {
    const { taskId } = registry.start({
      kind: 'import',
      run: async () => {
        throw new MoverError(ERROR_CODES.PACK_INVALID, '迁移包损坏')
      },
    })
    const state = await settle(registry, taskId)
    assert.equal(state.status, 'error')
    assert.equal(state.error.code, ERROR_CODES.PACK_INVALID)
    assert.equal(state.error.title, '迁移包损坏或被篡改')
    assert.equal(state.result, undefined)
  } finally {
    registry.dispose()
  }
})

test('未知 taskId 的 poll/cancel 抛 E_TASK_NOT_FOUND', () => {
  const registry = createTaskRegistry()
  try {
    assert.throws(
      () => registry.poll('missing-task'),
      (error) => error.code === ERROR_CODES.TASK_NOT_FOUND,
    )
    assert.throws(
      () => registry.cancel('missing-task'),
      (error) => error.code === ERROR_CODES.TASK_NOT_FOUND,
    )
  } finally {
    registry.dispose()
  }
})

test('TTL 到期后已完成任务被清理', async () => {
  let clock = 1_000_000
  const registry = createTaskRegistry({ ttlMs: 1000, now: () => clock })
  try {
    const { taskId } = registry.start({
      kind: 'export',
      run: async () => ({ kind: 'success', text: 'ok' }),
    })
    const state = await settle(registry, taskId)
    assert.equal(state.status, 'success')

    clock += 500
    registry.prune()
    assert.equal(registry.poll(taskId).status, 'success')

    clock += 600
    registry.prune()
    assert.throws(
      () => registry.poll(taskId),
      (error) => error.code === ERROR_CODES.TASK_NOT_FOUND,
    )
  } finally {
    registry.dispose()
  }
})

test('list 返回任务元数据，dispose 清空并停止清理定时器', async () => {
  const registry = createTaskRegistry()
  const { taskId } = registry.start({
    kind: 'export',
    title: '测试任务',
    run: async () => ({ kind: 'success', text: 'ok' }),
  })
  await settle(registry, taskId)
  const rows = registry.list()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].taskId, taskId)
  assert.equal(rows[0].kind, 'export')
  assert.equal(rows[0].title, '测试任务')
  assert.equal(rows[0].status, 'success')
  assert.equal(rows[0].frameCount, 0)

  registry.dispose()
  assert.equal(registry.list().length, 0)
  assert.equal(TASK_STATUS.includes('cancelled'), true)
})
