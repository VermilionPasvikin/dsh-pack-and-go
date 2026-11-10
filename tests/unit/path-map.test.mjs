import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'

import { buildPathMap, mapCwdForWorkspace, safeDirName } from '../../src/core/path-map.js'
import { ERROR_CODES, MoverError } from '../../src/core/errors.js'

const workspaces = [
  { key: 'ws-1', title: 'proj', sourcePath: 'F:\\work\\proj' },
  { key: 'ws-2', title: 'notes', sourcePath: 'F:\\work\\notes' },
  { key: 'ws-3', title: 'scratch', sourcePath: 'F:\\work\\scratch' },
]

test('跨平台 auto：放到目标根目录下', () => {
  const map = buildPathMap({
    sourcePlatform: 'win32',
    targetPlatform: 'linux',
    targetRoot: '/home/me/DSH迁移',
    workspaces,
  })
  assert.equal(map.entries.length, 3)
  for (const entry of map.entries) {
    assert.equal(entry.action, 'relocate')
    assert.ok(entry.targetPath.startsWith(join('/home/me/DSH迁移', '')) || entry.targetPath.includes('DSH迁移'))
  }
  assert.equal(map.byKey['ws-1'], join('/home/me/DSH迁移', 'proj'))
})

test('同平台 auto：保留原路径', () => {
  const map = buildPathMap({
    sourcePlatform: 'win32',
    targetPlatform: 'win32',
    workspaces,
  })
  assert.equal(map.entries[0].action, 'keep')
  assert.equal(map.byKey['ws-1'], 'F:\\work\\proj')
})

test('under-root 在 POSIX→Windows 时拼接目标根', () => {
  const map = buildPathMap({
    sourcePlatform: 'linux',
    targetPlatform: 'win32',
    targetRoot: 'C:\\Users\\me\\DSH迁移',
    workspaces: [{ key: 'w', title: 'proj', sourcePath: '/home/me/proj' }],
    strategy: 'under-root',
  })
  assert.equal(map.byKey.w, join('C:\\Users\\me\\DSH迁移', 'proj'))
})

test('标题冲突自动加后缀', () => {
  const map = buildPathMap({
    sourcePlatform: 'win32',
    targetPlatform: 'linux',
    targetRoot: '/dest',
    workspaces: [
      { key: 'a', title: 'same', sourcePath: 'F:\\x\\a' },
      { key: 'b', title: 'same', sourcePath: 'F:\\x\\b' },
    ],
  })
  assert.equal(map.byKey.a, join('/dest', 'same'))
  assert.equal(map.byKey.b, join('/dest', 'same-2'))
  assert.deepEqual(map.conflicts, [])
})

test('标题安全化：非法字符、保留名、空标题', () => {
  assert.equal(safeDirName('a?b', 'win32'), 'a_b')
  assert.equal(safeDirName('CON', 'win32'), '_CON')
  assert.equal(safeDirName('   ', 'linux'), 'workspace')
  const map = buildPathMap({
    sourcePlatform: 'linux',
    targetPlatform: 'win32',
    targetRoot: 'C:\\dest',
    workspaces: [{ key: 'w', title: 'CON', sourcePath: '/x' }],
  })
  assert.equal(map.byKey.w, join('C:\\dest', '_CON'))
})

test('original 策略下相同路径产生冲突报告', () => {
  const map = buildPathMap({
    sourcePlatform: 'linux',
    targetPlatform: 'linux',
    workspaces: [
      { key: 'a', title: 'x', sourcePath: '/same' },
      { key: 'b', title: 'y', sourcePath: '/same' },
    ],
    strategy: 'original',
  })
  assert.equal(map.conflicts.length, 1)
  assert.deepEqual(map.conflicts[0].keys.sort(), ['a', 'b'])
})

test('缺少目标根目录或平台非法时抛错', () => {
  assert.throws(
    () =>
      buildPathMap({
        sourcePlatform: 'win32',
        targetPlatform: 'linux',
        workspaces,
      }),
    (error) => error instanceof MoverError && error.code === ERROR_CODES.PATH_INVALID,
  )
  assert.throws(
    () => buildPathMap({ sourcePlatform: 'plan9', targetPlatform: 'linux', workspaces }),
    (error) => error instanceof MoverError && error.code === ERROR_CODES.PATH_INVALID,
  )
})

test('mapCwdForWorkspace 返回目标路径', () => {
  const map = buildPathMap({
    sourcePlatform: 'win32',
    targetPlatform: 'linux',
    targetRoot: '/dest',
    workspaces,
  })
  assert.equal(mapCwdForWorkspace('ws-1', map), join('/dest', 'proj'))
  assert.equal(mapCwdForWorkspace(undefined, map), undefined)
  assert.equal(mapCwdForWorkspace('missing', map), undefined)
})
