import test from 'node:test'
import assert from 'node:assert/strict'

import { registerWorkspaces } from '../../src/host/register.js'
import { ERROR_CODES, MoverError } from '../../src/core/errors.js'

test('登记工作区并返回实体', async () => {
  const calls = []
  const workspaceRegistry = {
    create: async (path, title) => {
      calls.push({ path, title })
      return { id: `id-${path}`, path, title }
    },
  }
  const result = await registerWorkspaces({
    workspaceRegistry,
    workspaces: [
      { key: 'w1', title: 'P1', targetPath: '/dest/p1' },
      { key: 'w2', title: 'P2', targetPath: '/dest/p2' },
    ],
  })
  assert.equal(result.registered.length, 2)
  assert.equal(result.warnings.length, 0)
  assert.deepEqual(calls[0], { path: '/dest/p1', title: 'P1' })
  assert.equal(result.registered[0].key, 'w1')
  assert.equal(result.registered[0].path, '/dest/p1')
})

test('单个登记失败只记录 warning', async () => {
  const workspaceRegistry = {
    create: async (path) => {
      if (path.includes('bad')) throw new Error('ENOENT')
      return { id: 'ok', path, title: 'T' }
    },
  }
  const result = await registerWorkspaces({
    workspaceRegistry,
    workspaces: [
      { key: 'bad', title: 'Bad', targetPath: '/dest/bad' },
      { key: 'ok', title: 'Ok', targetPath: '/dest/ok' },
    ],
  })
  assert.equal(result.registered.length, 1)
  assert.equal(result.warnings.length, 1)
  assert.match(result.warnings[0], /工作区登记失败/)
})

test('缺少 registry 时报错', async () => {
  await assert.rejects(
    () => registerWorkspaces({ workspaceRegistry: {}, workspaces: [] }),
    (error) => error instanceof MoverError && error.code === ERROR_CODES.CATALOG_INVALID,
  )
})
