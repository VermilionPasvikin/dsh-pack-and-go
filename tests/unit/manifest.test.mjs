import test from 'node:test'
import assert from 'node:assert/strict'

import {
  validateManifest,
  validateMappingEntry,
  MODES,
  PLATFORMS,
} from '../../src/core/manifest.js'
import { ERROR_CODES, ManifestError } from '../../src/core/errors.js'

/** SPEC §8 示例（合法基线）。 */
function validManifest() {
  return {
    schemaVersion: 2,
    createdAt: '2026-11-10T15:30:00+08:00',
    source: {
      platform: 'win32',
      dshVersion: '0.2.1-rc.5',
      sessionFormat: 4,
      dshHome: 'C:\\Users\\me\\.dsh',
      machineName: 'DESKTOP-XXX',
    },
    mode: 'sessions+workspaces',
    sessions: [
      {
        id: 'session-0cf30744-2d48-4c48-bcf8-9bc4dabb7e88',
        title: 'DSH 迁移插件',
        cwd: 'F:\\PersonalProjects\\python\\新建文件夹',
        workspaceKey: 'ws-1',
        messageCount: 42,
        sizeBytes: 302044,
        path: 'sessions/--F-PersonalProjects-python-~65B0~5EFA~6587~4EF6~5939--/session-0cf30744-2d48-4c48-bcf8-9bc4dabb7e88/session.v4.jsonl.zstd',
        sha256: 'a'.repeat(64),
      },
    ],
    attachments: [{ id: 'att-1', sizeBytes: 12345, sha256: 'b'.repeat(64) }],
    workspaces: [
      {
        key: 'ws-1',
        title: '新建文件夹',
        sourcePath: 'F:\\PersonalProjects\\python\\新建文件夹',
        sourcePlatform: 'win32',
        fileCount: 128,
        sizeBytes: 45678901,
        excluded: ['node_modules'],
        root: 'workspaces/ws-1/files',
        mapping: 'workspaces/ws-1/mapping.json',
      },
    ],
  }
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof ManifestError, `expected ManifestError, got ${error?.constructor?.name}`)
    assert.equal(error.code, code)
    return true
  })
}

test('合法 manifest 通过校验', () => {
  assert.equal(validateManifest(validManifest()), true)
})

test('允许未知字段（前向兼容）', () => {
  const manifest = validManifest()
  manifest.futureField = { anything: true }
  assert.equal(validateManifest(manifest), true)
})

test('缺少必填字段时报 E_MANIFEST_INVALID', () => {
  const manifest = validManifest()
  delete manifest.sessions
  expectCode(() => validateManifest(manifest), ERROR_CODES.MANIFEST_INVALID)
})

test('版本过高报 E_MANIFEST_VERSION_TOO_NEW', () => {
  const manifest = validManifest()
  manifest.schemaVersion = 3
  expectCode(() => validateManifest(manifest), ERROR_CODES.MANIFEST_VERSION_TOO_NEW)
})

test('版本过低报 E_MANIFEST_VERSION_UNSUPPORTED', () => {
  const manifest = validManifest()
  manifest.schemaVersion = 1
  expectCode(() => validateManifest(manifest), ERROR_CODES.MANIFEST_VERSION_UNSUPPORTED)
})

test('非法 mode 报错', () => {
  const manifest = validManifest()
  manifest.mode = 'everything'
  expectCode(() => validateManifest(manifest), ERROR_CODES.MANIFEST_INVALID)
})

test('workspaceKey 引用不存在的工作区时报错', () => {
  const manifest = validManifest()
  manifest.sessions[0].workspaceKey = 'ws-missing'
  expectCode(() => validateManifest(manifest), ERROR_CODES.MANIFEST_INVALID)
})

test('包内路径禁止 .. 与反斜杠', () => {
  const manifest = validManifest()
  manifest.sessions[0].path = '../escape/session.v4.jsonl.zstd'
  expectCode(() => validateManifest(manifest), ERROR_CODES.MANIFEST_INVALID)
})

test('mode 与平台常量覆盖规格取值', () => {
  assert.deepEqual([...MODES], ['sessions', 'workspaces', 'sessions+workspaces'])
  assert.deepEqual([...PLATFORMS], ['win32', 'darwin', 'linux'])
})

test('mapping 条目校验', () => {
  assert.equal(
    validateMappingEntry({
      sourcePath: 'src/index.js',
      packPath: 'workspaces/ws-1/files/src/index.js',
      type: 'file',
      mode: 420,
      mtimeMs: 1700000000000,
      action: 'none',
    }),
    true,
  )
  assert.throws(
    () =>
      validateMappingEntry({
        sourcePath: 'a',
        packPath: 'b',
        type: 'file',
        action: 'unknown-action',
      }),
    (error) => error instanceof ManifestError && error.code === ERROR_CODES.MANIFEST_INVALID,
  )
})
