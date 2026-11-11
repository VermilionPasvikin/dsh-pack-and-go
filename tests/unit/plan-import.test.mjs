import test from 'node:test'
import assert from 'node:assert/strict'

import {
  planImport,
  DEFAULT_IMPORT_POLICY,
  SESSION_ACTIONS,
  WORKSPACE_ACTIONS,
} from '../../src/core/plan-import.js'
import { ERROR_CODES, MoverError } from '../../src/core/errors.js'

function makeManifest() {
  return {
    schemaVersion: 2,
    createdAt: '2026-11-10T15:30:00+08:00',
    source: { platform: 'win32', dshVersion: '0.2.1-rc.5', sessionFormat: 4 },
    mode: 'sessions+workspaces',
    sessions: [
      { id: 's1', workspaceKey: 'ws-1', messageCount: 1, sizeBytes: 10, path: 'sessions/a' },
      { id: 's2', workspaceKey: 'ws-1', messageCount: 1, sizeBytes: 20, path: 'sessions/b' },
      { id: 's3', messageCount: 1, sizeBytes: 30, path: 'sessions/c' },
    ],
    attachments: [],
    workspaces: [
      {
        key: 'ws-1',
        title: 'proj',
        sourcePath: 'F:\\proj',
        sourcePlatform: 'win32',
        fileCount: 1,
        sizeBytes: 5,
        root: 'workspaces/ws-1/files',
      },
    ],
  }
}

const pathMap = { byKey: { 'ws-1': '/dest/proj' } }

function expectPlanError(fn) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof MoverError)
    assert.equal(error.code, ERROR_CODES.PLAN_INVALID)
    return true
  })
}

test('覆盖：cwd 不同走迁移覆盖，cwd 相同原地恢复', () => {
  const migrated = planImport({
    manifest: makeManifest(),
    pathMap,
    existingSessionIds: ['s1'],
    existingCwdById: new Map([['s1', 'F:\\proj']]),
    policy: { session: 'overwrite' },
  })
  assert.equal(migrated.sessions[0].action, 'overwrite')
  assert.equal(migrated.sessions[0].targetCwd, '/dest/proj')
  assert.equal(migrated.sessions[0].migrateFrom, 'F:\\proj')

  const inPlace = planImport({
    manifest: makeManifest(),
    pathMap,
    existingSessionIds: ['s1'],
    existingCwdById: new Map([['s1', '/dest/proj']]),
    policy: { session: 'overwrite' },
  })
  assert.equal(inPlace.sessions[0].action, 'overwrite')
  assert.equal(inPlace.sessions[0].targetCwd, '/dest/proj')
  assert.equal(inPlace.sessions[0].migrateFrom, undefined)
})

test('无冲突：全部导入/创建，未归组会话无 cwd', () => {
  const plan = planImport({ manifest: makeManifest(), pathMap })
  assert.deepEqual(
    plan.sessions.map((s) => s.action),
    ['import', 'import', 'import'],
  )
  assert.deepEqual(
    plan.workspaces.map((w) => w.action),
    ['create'],
  )
  assert.equal(plan.sessions[0].targetCwd, '/dest/proj')
  assert.equal(plan.sessions[2].targetCwd, undefined)
  assert.equal(plan.summary.sessions.import, 3)
  assert.equal(plan.summary.workspaces.create, 1)
})

test('会话 id 已存在时默认跳过', () => {
  const plan = planImport({
    manifest: makeManifest(),
    pathMap,
    existingSessionIds: ['s1'],
  })
  assert.deepEqual(
    plan.sessions.map((s) => s.action),
    ['skip', 'import', 'import'],
  )
  assert.equal(plan.summary.sessions.skip, 1)
})

test('可覆盖会话策略', () => {
  const plan = planImport({
    manifest: makeManifest(),
    pathMap,
    existingSessionIds: ['s1'],
    policy: { session: 'overwrite' },
  })
  assert.equal(plan.sessions[0].action, 'overwrite')
})

test('工作区同路径默认合并', () => {
  const plan = planImport({
    manifest: makeManifest(),
    pathMap,
    existingWorkspacePaths: ['/dest/proj'],
  })
  assert.equal(plan.workspaces[0].action, 'merge')
})

test('缺少目标路径映射时报错', () => {
  expectPlanError(() =>
    planImport({ manifest: makeManifest(), pathMap: { byKey: {} } }),
  )
})

test('转换项透传预检报告', () => {
  const plan = planImport({
    manifest: makeManifest(),
    pathMap,
    preflight: {
      risks: [
        { path: 'a?b.txt', kind: 'invalid-name', detail: '非法字符', suggestion: 'a_b.txt' },
      ],
    },
  })
  assert.equal(plan.conversions.length, 1)
  assert.equal(plan.conversions[0].kind, 'invalid-name')
  assert.equal(plan.summary.conversions, 1)
})

test('非法策略报错', () => {
  expectPlanError(() =>
    planImport({ manifest: makeManifest(), pathMap, policy: { session: 'explode' } }),
  )
  expectPlanError(() =>
    planImport({ manifest: makeManifest(), pathMap, policy: { workspace: 'explode' } }),
  )
})

test('默认策略与动作常量', () => {
  assert.deepEqual(DEFAULT_IMPORT_POLICY, { session: 'skip', workspace: 'merge' })
  assert.ok(SESSION_ACTIONS.includes('new-id'))
  assert.ok(WORKSPACE_ACTIONS.includes('create'))
})
