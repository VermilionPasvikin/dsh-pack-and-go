import test from 'node:test'
import assert from 'node:assert/strict'

import { resolveWorkspaceTitle } from '../../src/core/workspace-title.js'

test('目标路径已登记时保留原标题', () => {
  const result = resolveWorkspaceTitle({
    title: 'Proj',
    targetPath: 'C:\\dest\\Proj',
    existingPathKeys: ['c:\\dest\\proj'],
    existingTitles: ['Proj'],
  })
  assert.deepEqual(result, { title: 'Proj', renamed: false, reason: 'existing-path' })
})

test('新路径 + 标题冲突时追加（导入 1）', () => {
  const result = resolveWorkspaceTitle({
    title: 'Proj',
    targetPath: '/dest/Proj (1)',
    existingPathKeys: ['/dest/Proj'],
    existingTitles: ['Proj'],
  })
  assert.equal(result.title, 'Proj（导入 1）')
  assert.equal(result.renamed, true)
  assert.equal(result.reason, 'title-conflict')
})

test('（导入 N）也被占用时继续顺延', () => {
  const result = resolveWorkspaceTitle({
    title: 'Proj',
    targetPath: '/dest/Proj (2)',
    existingPathKeys: ['/dest/Proj', '/dest/Proj (1)'],
    existingTitles: ['Proj', 'Proj（导入 1）'],
  })
  assert.equal(result.title, 'Proj（导入 2）')
})

test('无冲突时原样返回且不改名', () => {
  const result = resolveWorkspaceTitle({
    title: 'Other',
    targetPath: '/dest/Other',
    existingPathKeys: ['/dest/Proj'],
    existingTitles: ['Proj'],
  })
  assert.deepEqual(result, { title: 'Other', renamed: false })
})

test('缺少 targetPath 时抛错', () => {
  assert.throws(() => resolveWorkspaceTitle({ title: 'x' }), /targetPath/)
})
