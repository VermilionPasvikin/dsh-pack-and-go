import test from 'node:test'
import assert from 'node:assert/strict'

import {
  SCHEMA_VERSION,
  PACK_EXTENSION,
  EXPORT_STAGES,
  IMPORT_STAGES,
} from '../../src/core/index.js'

test('core 常量可导入且符合包格式 v2', () => {
  assert.equal(SCHEMA_VERSION, 2)
  assert.equal(PACK_EXTENSION, '.dshpack')
})

test('阶段列表已冻结且非空', () => {
  assert.ok(Object.isFrozen(EXPORT_STAGES))
  assert.ok(Object.isFrozen(IMPORT_STAGES))
  assert.ok(EXPORT_STAGES.length > 0)
  assert.ok(IMPORT_STAGES.length > 0)
  assert.equal(EXPORT_STAGES.at(-1), 'done')
  assert.equal(IMPORT_STAGES.at(-1), 'done')
})
