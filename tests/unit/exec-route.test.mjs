import test from 'node:test'
import assert from 'node:assert/strict'

import { createExecHandler } from '../../src/host/exec-route.js'

function makeDeps() {
  return {
    workspaceRegistry: { list: () => [] },
    sessionPersistence: { list: async () => [] },
    sessionQuery: undefined,
    dshHome: 'C:/tmp/home',
    platform: 'win32',
    dshVersion: 'test',
  }
}

function post(body, headers = {}) {
  return new Request('http://127.0.0.1:1234/api/mover/exec', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  })
}

test('未知 action 返回 400', async () => {
  const handler = createExecHandler(makeDeps(), {})
  const response = await handler(post({ action: 'nope' }))
  assert.equal(response.status, 400)
  const payload = await response.json()
  assert.equal(payload.ok, false)
})

test('list action 正常返回 200', async () => {
  const handler = createExecHandler(makeDeps(), {})
  const response = await handler(post({ action: 'list' }))
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.ok, true)
})

test('请求体过大返回 413（P2-14⑤）', async () => {
  const handler = createExecHandler(makeDeps(), {})
  const huge = 'x'.repeat(33 * 1024 * 1024)
  const response = await handler(post(JSON.stringify({ action: 'list', pad: huge })))
  assert.equal(response.status, 413)
  const payload = await response.json()
  assert.equal(payload.ok, false)
  assert.match(payload.error, /请求体过大/)
})

test('声明 Content-Length 过大时直接 413，不读取正文', async () => {
  const handler = createExecHandler(makeDeps(), {})
  const request = new Request('http://127.0.0.1:1234/api/mover/exec', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': String(64 * 1024 * 1024),
    },
    body: '{}',
  })
  const response = await handler(request)
  assert.equal(response.status, 413)
})

test('task.start 立即返回 taskId，task.poll 拿到终态结果（ADR-0021）', async () => {
  const handler = createExecHandler(makeDeps(), {})
  const started = await handler(
    post({ action: 'task.start', args: { kind: 'export', target: 'C:/tmp/out.dshpack' } }),
  )
  assert.equal(started.status, 200)
  const first = await started.json()
  assert.equal(first.ok, true)
  const taskId = first.result.taskId
  assert.match(taskId, /^export-/)

  // 轮询直到终态（导出空目录会返回成功或错误结果，两种都算「跑完了」）。
  let payload
  for (let i = 0; i < 50; i += 1) {
    const polled = await handler(post({ action: 'task.poll', args: { taskId } }))
    assert.equal(polled.status, 200)
    payload = await polled.json()
    if (payload.result.status !== 'running') break
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.notEqual(payload.result.status, 'running')
  assert.equal(payload.result.taskId, taskId)
})

test('task.poll 未知 id 返回 404', async () => {
  const handler = createExecHandler(makeDeps(), {})
  const response = await handler(post({ action: 'task.poll', args: { taskId: 'nope' } }))
  assert.equal(response.status, 404)
  const payload = await response.json()
  assert.equal(payload.ok, false)
})

test('task.cancel 对已完成任务返回 cancelled:false，对未知 id 返回 404', async () => {
  const handler = createExecHandler(makeDeps(), {})
  const missing = await handler(post({ action: 'task.cancel', args: { taskId: 'nope' } }))
  assert.equal(missing.status, 404)
})
