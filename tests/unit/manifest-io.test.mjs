import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  parseManifest,
  serializeManifest,
  readManifestFile,
  writeManifestFile,
} from '../../src/core/manifest-io.js'
import { ERROR_CODES, ManifestError } from '../../src/core/errors.js'

function validManifest() {
  return {
    schemaVersion: 2,
    createdAt: '2026-11-10T15:30:00+08:00',
    source: { platform: 'linux', dshVersion: '0.2.1-rc.5', sessionFormat: 4 },
    mode: 'sessions',
    sessions: [
      {
        id: 'session-1',
        title: '示例',
        cwd: '/home/me/project',
        messageCount: 3,
        sizeBytes: 1024,
        path: 'sessions/--home-me-project--/session-1/session.v4.jsonl.zstd',
      },
    ],
    attachments: [],
    workspaces: [],
  }
}

test('合法 manifest 序列化后可原样解析回来', () => {
  const manifest = validManifest()
  const text = serializeManifest(manifest)
  const parsed = parseManifest(text)
  assert.deepEqual(parsed, manifest)
})

test('未知字段在往返中保留', () => {
  const manifest = validManifest()
  manifest.futureField = { nested: [1, 2, 3] }
  const parsed = parseManifest(serializeManifest(manifest))
  assert.deepEqual(parsed.futureField, { nested: [1, 2, 3] })
})

test('版本过高抛出明确错误码', () => {
  const manifest = validManifest()
  manifest.schemaVersion = 3
  assert.throws(
    () => serializeManifest(manifest),
    (error) =>
      error instanceof ManifestError && error.code === ERROR_CODES.MANIFEST_VERSION_TOO_NEW,
  )
  assert.throws(
    () => parseManifest(JSON.stringify(manifest)),
    (error) =>
      error instanceof ManifestError && error.code === ERROR_CODES.MANIFEST_VERSION_TOO_NEW,
  )
})

test('非法 JSON 报 E_MANIFEST_INVALID', () => {
  assert.throws(
    () => parseManifest('{ not json'),
    (error) => error instanceof ManifestError && error.code === ERROR_CODES.MANIFEST_INVALID,
  )
})

test('文件读写往返一致', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-manifest-'))
  try {
    const file = join(dir, 'manifest.json')
    const manifest = validManifest()
    const written = await writeManifestFile(file, manifest)
    assert.ok(written > 0)
    const read = await readManifestFile(file)
    assert.deepEqual(read, manifest)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
