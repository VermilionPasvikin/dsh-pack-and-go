import test from 'node:test'
import assert from 'node:assert/strict'

import { safeDirName } from '../../src/core/path-map.js'

// T13.5：`buildPathMap` / `mapCwdForWorkspace` 是零生产引用的旧实现，
// 已删除；目标目录名统一走 `safeDirName`，四步判据见 plan-import.test.mjs。

test('标题安全化：非法字符、保留名、空标题', () => {
  assert.equal(safeDirName('a?b', 'win32'), 'a_b')
  assert.equal(safeDirName('CON', 'win32'), '_CON')
  assert.equal(safeDirName('   ', 'linux'), 'workspace')
  assert.equal(safeDirName('a:b*c', 'linux'), 'a_b_c')
  assert.equal(safeDirName('normal', 'win32'), 'normal')
})

test('标题安全化：结尾点与空格被去掉', () => {
  assert.equal(safeDirName('report...', 'win32'), 'report')
  assert.equal(safeDirName('report   ', 'win32'), 'report')
})
