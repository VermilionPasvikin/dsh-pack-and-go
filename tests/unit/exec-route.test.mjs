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
