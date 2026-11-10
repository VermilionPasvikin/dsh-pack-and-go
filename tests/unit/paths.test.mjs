import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'

import { encodeSegment, projectKey, projectDir, sessionDir } from '../../src/core/paths.js'
import { ERROR_CODES, MoverError } from '../../src/core/errors.js'

test('encodeSegment 保留安全字符', () => {
  assert.equal(encodeSegment('session-abc_1.2'), 'session-abc_1.2')
})

test('encodeSegment 特判 . 与 ..', () => {
  assert.equal(encodeSegment('.'), '~002E')
  assert.equal(encodeSegment('..'), '~002E~002E')
})

test('encodeSegment 转义 ~、空格、中文与代理对', () => {
  assert.equal(encodeSegment('a~b'), 'a~007Eb')
  assert.equal(encodeSegment('a b'), 'a~0020b')
  assert.equal(encodeSegment('新建文件夹'), '~65B0~5EFA~6587~4EF6~5939')
  // emoji 由两个 UTF-16 code unit 组成
  assert.equal(encodeSegment('😀'), '~D83D~DE00')
})

test('encodeSegment 空字符串报错', () => {
  assert.throws(
    () => encodeSegment(''),
    (error) => error instanceof MoverError && error.code === ERROR_CODES.PATH_INVALID,
  )
})

test('projectKey 与真实 DSH 目录名一致（Windows 路径样本）', () => {
  assert.equal(
    projectKey('F:\\PersonalProjects\\python\\新建文件夹'),
    '--F-PersonalProjects-python-~65B0~5EFA~6587~4EF6~5939--',
  )
  assert.equal(projectKey('C:\\Users\\15349\\Desktop'), '--C-Users-15349-Desktop--')
})

test('projectKey 折叠分隔符且正反斜杠等价', () => {
  assert.equal(projectKey('F:\\a\\b'), '--F-a-b--')
  assert.equal(projectKey('F:/a/b'), '--F-a-b--')
  assert.equal(projectKey('/home//me///project'), '--home-me-project--')
})

test('projectKey 去掉前导分隔符，纯分隔符退化为 root', () => {
  assert.equal(projectKey('/home'), '--home--')
  assert.equal(projectKey('///'), '--root--')
})

test('projectKey 截断到 251 字符', () => {
  const key = projectKey('x'.repeat(300))
  assert.equal(key, `--${'x'.repeat(251)}--`)
})

test('projectKey 空 cwd 报错', () => {
  assert.throws(
    () => projectKey(''),
    (error) => error instanceof MoverError && error.code === ERROR_CODES.PATH_INVALID,
  )
})

test('projectDir 对 undefined cwd 使用 _no-cwd', () => {
  assert.equal(projectDir('/root', undefined), join('/root', '_no-cwd'))
  assert.equal(projectDir('/root', '/home/me'), join('/root', '--home-me--'))
})

test('sessionDir 拼接编码后的会话 id', () => {
  assert.equal(
    sessionDir('/root', '/home/me', 'session-1'),
    join('/root', '--home-me--', 'session-1'),
  )
  assert.equal(
    sessionDir('/root', '/home/me', 'a b'),
    join('/root', '--home-me--', 'a~0020b'),
  )
})
