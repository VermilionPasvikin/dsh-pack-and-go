/**
 * compat CLI smoke 测试：三个脚本的错误路径与退出码语义。
 *
 * 网络相关用例由环境变量 DSH_COMPAT_NETWORK=1 门控（默认跳过），
 * 因为 freeze/check 需要访问 registry.npmjs.org。
 *
 * 运行（本机全量）：
 *   DSH_COMPAT_NETWORK=1 node --test "tests/compat"/*.test.mjs
 * 运行（无网络/沙箱）：
 *   node --test --experimental-test-isolation=none "tests/compat"/*.test.mjs
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const NETWORK = process.env.DSH_COMPAT_NETWORK === '1'

/** 运行 node 脚本；spawn 被环境禁止时返回 null（调用方 skip）。 */
function runNode(script, args) {
  const result = spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    timeout: 600_000,
  })
  if (result.error && result.error.code === 'EPERM') return null
  return result
}

test('脚本文件存在且语法可解析', (t) => {
  for (const rel of [
    'scripts/compat/freeze-baseline.mjs',
    'scripts/compat/check-upstream.mjs',
    'scripts/compat/probe-host.mjs',
    'scripts/compat/lib/tar.mjs',
    'scripts/compat/lib/registry.mjs',
    'scripts/compat/config.mjs',
  ]) {
    const path = join(ROOT, rel)
    assert.ok(existsSync(path), `缺少 ${rel}`)
    const check = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' })
    if (check.error && check.error.code === 'EPERM') {
      return t.skip('环境禁止 spawn 子进程')
    }
    assert.equal(check.status, 0, `node --check 失败：${rel}\n${check.stderr}`)
  }
})

test('freeze-baseline：缺 --version 报错且退出码 2', (t) => {
  const result = runNode(join(ROOT, 'scripts/compat/freeze-baseline.mjs'), [])
  if (result === null) return t.skip('环境禁止 spawn 子进程')
  assert.equal(result.status, 2)
  assert.match(result.stderr, /缺少 --version/)
})

test('check-upstream：基线文件不存在报错且退出码 2', (t) => {
  const result = runNode(join(ROOT, 'scripts/compat/check-upstream.mjs'), [
    '--baseline',
    join(ROOT, 'docs/compat/baseline/不存在.json'),
    '--target',
    '0.2.2-rc.2',
  ])
  if (result === null) return t.skip('环境禁止 spawn 子进程')
  assert.equal(result.status, 2)
  assert.match(result.stderr, /基线文件不存在/)
})

test('probe-host：输出合法 JSON 与 hint（退出码 0 或 2）', (t) => {
  const result = runNode(join(ROOT, 'scripts/compat/probe-host.mjs'), [])
  if (result === null) return t.skip('环境禁止 spawn 子进程')
  assert.ok(result.status === 0 || result.status === 2)
  const line = result.stdout.trim().split(/\r?\n/).at(-1)
  const parsed = JSON.parse(line)
  assert.equal(typeof parsed.ok, 'boolean')
  if (!parsed.ok) assert.equal(typeof parsed.hint, 'string')
})

test('基线快照文件存在且结构完整', () => {
  const path = join(ROOT, 'docs/compat/baseline/0.2.2-rc.2.json')
  assert.ok(existsSync(path), '缺少 docs/compat/baseline/0.2.2-rc.2.json')
  const snapshot = JSON.parse(readFileSync(path, 'utf8'))
  assert.equal(snapshot.schemaVersion, 1)
  assert.equal(snapshot.dshVersion, '0.2.2-rc.2')
  assert.ok(Object.keys(snapshot.packages).length >= 14, '基线包数量异常')
  for (const [name, entry] of Object.entries(snapshot.packages)) {
    assert.equal(typeof entry.version, 'string', `${name}.version`)
    assert.equal(typeof entry.integrity, 'string', `${name}.integrity`)
    assert.ok(Object.keys(entry.files).length > 0, `${name} 没有任何契约文件`)
  }
})

test('check-upstream：同版本检出返回无变化且退出码 0（需网络）', async (t) => {
  if (!NETWORK) return t.skip('设置 DSH_COMPAT_NETWORK=1 以运行网络用例')
  const result = runNode(join(ROOT, 'scripts/compat/check-upstream.mjs'), [
    '--baseline',
    join(ROOT, 'docs/compat/baseline/0.2.2-rc.2.json'),
    '--target',
    '0.2.2-rc.2',
  ])
  if (result === null) return t.skip('环境禁止 spawn 子进程')
  assert.equal(result.status, 0, result.stderr)
  const line = result.stdout.trim().split(/\r?\n/).at(-1)
  assert.deepEqual(JSON.parse(line), {
    ok: true,
    changed: false,
    baseline: '0.2.2-rc.2',
    target: '0.2.2-rc.2',
  })
})
