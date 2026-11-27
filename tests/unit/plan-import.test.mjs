import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'

import {
  planImport,
  planImportTargets,
  DEFAULT_IMPORT_POLICY,
  SESSION_ACTIONS,
  WORKSPACE_ACTIONS,
  WORKSPACE_TARGET_ACTIONS,
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

function makeWorkspaceManifest(titles) {
  return {
    schemaVersion: 2,
    createdAt: '2026-11-27T10:00:00+08:00',
    source: { platform: 'win32', dshVersion: '0.2.3', sessionFormat: 4 },
    mode: 'sessions+workspaces',
    sessions: [],
    workspaces: titles.map((title, index) => ({
      key: `ws-${index + 1}`,
      title,
      sourcePath: `C:/src/${title}`,
    })),
    attachments: [],
  }
}

const TARGET_ROOT = join('C:/', 'target-under-root')

test('planImportTargets：全新目录 → create', () => {
  const result = planImportTargets({
    manifest: makeWorkspaceManifest(['Alpha']),
    targetRoot: TARGET_ROOT,
    platform: 'win32',
  })
  assert.equal(result.targets.length, 1)
  assert.deepEqual(result.targets[0], {
    workspaceKey: 'ws-1',
    title: 'Alpha',
    path: join(TARGET_ROOT, 'Alpha'),
    basePath: join(TARGET_ROOT, 'Alpha'),
    action: 'create',
    reason: 'new',
  })
  assert.equal(result.byKey['ws-1'], join(TARGET_ROOT, 'Alpha'))
  assert.equal(result.conflicts.length, 0)
})

test('planImportTargets：已登记路径 → 复用', () => {
  const result = planImportTargets({
    manifest: makeWorkspaceManifest(['Alpha']),
    targetRoot: TARGET_ROOT,
    platform: 'win32',
    registeredPathKeys: [join(TARGET_ROOT, 'Alpha')],
    exists: () => true,
    existsNonEmpty: () => true,
  })
  assert.equal(result.targets[0].action, 'reuse')
  assert.equal(result.targets[0].reason, 'registered')
  assert.equal(result.targets[0].path, join(TARGET_ROOT, 'Alpha'))
})

test('planImportTargets：同包两个同名工作区 → 第二个加 (1)，不合并', () => {
  const result = planImportTargets({
    manifest: makeWorkspaceManifest(['Report', 'Report']),
    targetRoot: TARGET_ROOT,
    platform: 'win32',
    exists: () => false,
  })
  assert.equal(result.targets[0].path, join(TARGET_ROOT, 'Report'))
  assert.equal(result.targets[0].action, 'create')
  assert.equal(result.targets[1].path, join(TARGET_ROOT, 'Report (1)'))
  assert.equal(result.targets[1].action, 'rename')
  assert.equal(result.targets[1].reason, 'already-allocated-in-this-import')
  assert.equal(result.conflicts.length, 1)
  assert.equal(result.conflicts[0].kind, 'renamed')
  assert.equal(result.byKey['ws-2'], join(TARGET_ROOT, 'Report (1)'))
})

test('planImportTargets：存在但为空且未登记 → 复用（D3 兜底）', () => {
  const path = join(TARGET_ROOT, 'Alpha')
  const result = planImportTargets({
    manifest: makeWorkspaceManifest(['Alpha']),
    targetRoot: TARGET_ROOT,
    platform: 'win32',
    exists: (candidate) => candidate === path,
    existsNonEmpty: () => false,
  })
  assert.equal(result.targets[0].action, 'reuse')
  assert.equal(result.targets[0].reason, 'empty-unregistered')
  assert.equal(result.targets[0].path, path)
  assert.equal(result.conflicts[0].kind, 'reused-empty-directory')
})

test('planImportTargets：存在且非空且未登记 → 加 (1)', () => {
  const path = join(TARGET_ROOT, 'Alpha')
  const result = planImportTargets({
    manifest: makeWorkspaceManifest(['Alpha']),
    targetRoot: TARGET_ROOT,
    platform: 'win32',
    exists: (candidate) => candidate === path,
    existsNonEmpty: () => true,
  })
  assert.equal(result.targets[0].action, 'rename')
  assert.equal(result.targets[0].path, join(TARGET_ROOT, 'Alpha (1)'))
  assert.equal(result.targets[0].reason, 'existing-non-empty')
})

test('planImportTargets：(1) 也被占用 → 顺延到 (2)', () => {
  const occupied = new Set([join(TARGET_ROOT, 'Alpha'), join(TARGET_ROOT, 'Alpha (1)')])
  const result = planImportTargets({
    manifest: makeWorkspaceManifest(['Alpha']),
    targetRoot: TARGET_ROOT,
    platform: 'win32',
    exists: (candidate) => occupied.has(candidate),
    existsNonEmpty: () => true,
  })
  assert.equal(result.targets[0].path, join(TARGET_ROOT, 'Alpha (2)'))
})

test('planImportTargets：标题按目标平台净化', () => {
  const result = planImportTargets({
    manifest: makeWorkspaceManifest(['A:B']),
    targetRoot: TARGET_ROOT,
    platform: 'win32',
  })
  assert.equal(result.targets[0].path, join(TARGET_ROOT, 'A_B'))
})

test('planImportTargets：缺少 targetRoot 报错', () => {
  expectPlanError(() => planImportTargets({ manifest: makeWorkspaceManifest(['Alpha']) }))
  expectPlanError(() => planImportTargets({ manifest: makeWorkspaceManifest(['Alpha']), targetRoot: '' }))
  expectPlanError(() => planImportTargets({ targetRoot: TARGET_ROOT }))
})

test('WORKSPACE_TARGET_ACTIONS 常量', () => {
  assert.deepEqual(WORKSPACE_TARGET_ACTIONS, ['create', 'reuse', 'rename'])
})
