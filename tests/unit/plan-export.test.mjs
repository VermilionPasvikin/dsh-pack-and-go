import test from 'node:test'
import assert from 'node:assert/strict'

import { planExport, inferMode, EXPORT_MODES } from '../../src/core/plan-export.js'
import { ERROR_CODES, MoverError } from '../../src/core/errors.js'

const sessions = [
  { packPath: 'sessions/a/session.v4.jsonl.zstd', sizeBytes: 100 },
  { packPath: 'sessions/b/session.v4.jsonl.zstd', sizeBytes: 200 },
]

const workspace = {
  key: 'ws-1',
  files: [
    { relPath: 'a.txt', size: 10 },
    { relPath: 'sub/b.bin', size: 20 },
  ],
}

test('仅对话模式', () => {
  const plan = planExport({ sessions, includeFiles: false })
  assert.equal(plan.mode, 'sessions')
  assert.equal(plan.items.length, 2)
  assert.equal(plan.totalBytes, 300)
  assert.deepEqual(plan.counts, { sessions: 2, workspaces: 0, attachments: 0, files: 0 })
})

test('仅工作区模式必须包含文件', () => {
  const plan = planExport({
    workspaces: [workspace],
    includeFiles: true,
  })
  assert.equal(plan.mode, 'workspaces')
  assert.equal(plan.items.length, 2)
  assert.equal(plan.totalBytes, 30)
  assert.equal(plan.counts.files, 2)
  assert.ok(plan.items.every((item) => item.kind === 'workspace-file'))
  assert.equal(plan.items[0].path, 'workspaces/ws-1/files/a.txt')
})

test('对话 + 工作区模式', () => {
  const plan = planExport({
    sessions,
    workspaces: [workspace],
    includeFiles: true,
  })
  assert.equal(plan.mode, 'sessions+workspaces')
  assert.equal(plan.items.length, 4)
  assert.equal(plan.totalBytes, 330)
})

test('includeFiles=false 时工作区文件不计入', () => {
  const plan = planExport({
    sessions,
    workspaces: [workspace],
    includeFiles: false,
  })
  assert.equal(plan.mode, 'sessions+workspaces')
  assert.equal(plan.items.length, 2)
  assert.equal(plan.totalBytes, 300)
  assert.equal(plan.counts.files, 0)
})

test('附件计入清单', () => {
  const plan = planExport({
    sessions,
    attachments: [{ packPath: 'attachments/v1/objects/ab/cd', sizeBytes: 50 }],
    includeFiles: false,
  })
  assert.equal(plan.items.length, 3)
  assert.equal(plan.totalBytes, 350)
  assert.ok(plan.items.some((item) => item.kind === 'attachment'))
})

test('空选择与无内容计划报错', () => {
  assert.throws(
    () => planExport({}),
    (error) => error instanceof MoverError && error.code === ERROR_CODES.PLAN_INVALID,
  )
  assert.throws(
    () => planExport({ workspaces: [workspace], includeFiles: false }),
    (error) => error instanceof MoverError && error.code === ERROR_CODES.PLAN_INVALID,
  )
})

test('inferMode 与模式常量', () => {
  assert.equal(inferMode({ sessions: [1], workspaces: [] }), 'sessions')
  assert.equal(inferMode({ sessions: [], workspaces: [1] }), 'workspaces')
  assert.equal(inferMode({ sessions: [1], workspaces: [1] }), 'sessions+workspaces')
  assert.deepEqual([...EXPORT_MODES], ['sessions', 'workspaces', 'sessions+workspaces'])
})
