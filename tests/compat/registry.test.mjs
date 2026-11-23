/**
 * registry.mjs / config.mjs 纯函数单测：semver 解析与契约文件过滤。
 * 不访问网络。运行：node --test tests/compat/registry.test.mjs
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { compareSemver, resolveRange } from '../../scripts/compat/lib/registry.mjs'
import { isContractFile, WATCH_PACKAGES } from '../../scripts/compat/config.mjs'

test('compareSemver 数值比较', () => {
  assert.equal(compareSemver('1.2.3', '1.2.3'), 0)
  assert.equal(compareSemver('1.2.4', '1.2.3'), 1)
  assert.equal(compareSemver('1.2.2', '1.2.3'), -1)
  assert.equal(compareSemver('2.0.0', '1.9.9'), 1)
  assert.equal(compareSemver('1.2.3-rc.1', '1.2.2'), 1)
})

test('resolveRange：精确版本直接命中', () => {
  const versions = { '0.2.2-rc.2': {}, '0.2.2-rc.5': {} }
  assert.equal(resolveRange(versions, '0.2.2-rc.2'), '0.2.2-rc.2')
})

test('resolveRange：~ 取同 minor 最新', () => {
  const versions = { '4.1.0': {}, '4.1.2': {}, '4.2.0': {} }
  assert.equal(resolveRange(versions, '~4.1.0'), '4.1.2')
})

test('resolveRange：^ 取同 major 最新', () => {
  const versions = { '4.1.0': {}, '4.5.3': {}, '5.0.0': {} }
  assert.equal(resolveRange(versions, '^4.1.0'), '4.5.3')
})

test('resolveRange：>= 比较运算符', () => {
  const versions = { '13.0.0': {}, '13.7.0': {}, '13.9.1': {}, '14.0.0': {} }
  assert.equal(resolveRange(versions, '>=13.7.0'), '14.0.0')
})

test('resolveRange：range 不含 prerelease 时排除 prerelease', () => {
  const versions = { '4.1.0': {}, '4.1.1-rc.1': {} }
  assert.equal(resolveRange(versions, '~4.1.0'), '4.1.0')
})

test('resolveRange：range 自身含 prerelease 时允许 prerelease', () => {
  const versions = { '0.2.2-rc.1': {}, '0.2.2-rc.2': {} }
  assert.equal(resolveRange(versions, '~0.2.2-rc.1'), '0.2.2-rc.2')
})

test('resolveRange：无匹配抛错', () => {
  assert.throws(() => resolveRange({ '1.0.0': {} }, '~2.0.0'), /无版本满足/)
  assert.throws(() => resolveRange({}, '~2.0.0'), /没有任何已发布版本/)
})

test('isContractFile：记录 package.json 与 lib/src 源码', () => {
  assert.equal(isContractFile('package/package.json'), true)
  assert.equal(isContractFile('package/lib/index.js'), true)
  assert.equal(isContractFile('package/lib/types/a.d.ts'), true)
  assert.equal(isContractFile('package/src/format.ts'), true)
})

test('isContractFile：排除构建产物与说明文件', () => {
  assert.equal(isContractFile('package/dist/bundle.js'), false)
  assert.equal(isContractFile('package/lib/index.js.map'), false)
  assert.equal(isContractFile('package/lib/app.min.js'), false)
  assert.equal(isContractFile('package/README.md'), false)
  assert.equal(isContractFile('package/LICENSE'), false)
  assert.equal(isContractFile('package/bin/cli'), false)
  assert.equal(isContractFile('package/lib/assets/icon.svg'), false)
})

test('WATCH_PACKAGES 清单完整且覆盖核心契约包', () => {
  for (const name of [
    '@deepseek-ai/dsh',
    '@deepseek-ai/cordis',
    '@deepseek-ai/cordis-plugin-loader',
    '@deepseek-ai/cordis-plugin-include',
    '@deepseek-ai/dsh-session-format',
    '@deepseek-ai/dsh-session-format-catalog',
    '@deepseek-ai/dsh-session-format-v3-to-v4',
    '@deepseek-ai/dsh-session-persistence-jsonl',
    '@deepseek-ai/dsh-workspace',
    '@deepseek-ai/dsh-attachment-local',
    '@deepseek-ai/dsh-home-paths',
    '@deepseek-ai/dsh-session-query-sqlite',
    '@deepseek-ai/dsh-client-ui-cordis',
    '@deepseek-ai/dsh-client-ui-chat',
  ]) {
    assert.ok(WATCH_PACKAGES.includes(name), `WATCH_PACKAGES 缺少 ${name}`)
  }
})
