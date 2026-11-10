import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ERROR_CODES,
  ERROR_MESSAGES,
  MoverError,
  describeError,
} from '../../src/core/errors.js'

test('每个错误码都有中文说明与下一步', () => {
  for (const code of Object.values(ERROR_CODES)) {
    const message = ERROR_MESSAGES[code]
    assert.ok(message, `missing message for ${code}`)
    assert.equal(typeof message.title, 'string')
    assert.ok(message.title.length > 0)
    assert.equal(typeof message.next, 'string')
    assert.ok(message.next.length > 0)
  }
})

test('ERROR_MESSAGES 没有多余 key', () => {
  const codes = new Set(Object.values(ERROR_CODES))
  for (const key of Object.keys(ERROR_MESSAGES)) {
    assert.ok(codes.has(key), `unknown error message key: ${key}`)
  }
})

test('describeError 返回已知错误的中文描述', () => {
  const error = new MoverError(ERROR_CODES.PACK_INVALID, 'zip crc mismatch')
  const described = describeError(error)
  assert.equal(described.code, 'E_PACK_INVALID')
  assert.equal(described.title, ERROR_MESSAGES.E_PACK_INVALID.title)
  assert.equal(described.next, ERROR_MESSAGES.E_PACK_INVALID.next)
  assert.equal(described.message, 'zip crc mismatch')
})

test('未知错误回退到通用说明', () => {
  const described = describeError(new Error('boom'))
  assert.equal(described.code, 'E_UNKNOWN')
  assert.equal(described.title, '操作失败')
  assert.equal(described.message, 'boom')
})

test('非 Error 输入也能描述', () => {
  assert.equal(describeError('oops').message, 'oops')
  assert.equal(describeError(undefined).code, 'E_UNKNOWN')
})
