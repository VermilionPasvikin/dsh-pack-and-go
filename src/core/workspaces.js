/**
 * 工作区文件恢复（T2.9）。
 *
 * 包内布局：`workspaces/<key>/files/<相对路径>`。
 * 目标布局：`pathMap.byKey[key]` + 相对路径。
 * Windows 目标会对非法文件名做安全重命名并记录转换。
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { ERROR_CODES, MoverError } from './errors.js'
import { sanitizeWindowsName } from './preflight.js'

/**
 * @param {string} message
 * @param {Record<string, unknown>} [details]
 * @returns {MoverError}
 */
function workspaceError(message, details = {}) {
  return new MoverError(ERROR_CODES.PACK_INVALID, message, details)
}

/**
 * 从包内条目恢复工作区文件。
 * @param {{
 *   entries: Array<{ packPath: string, data: Buffer }>,
 *   pathMap: { byKey: Record<string, string> },
 *   targetPlatform: 'win32'|'darwin'|'linux'
 * }} input
 * @returns {Promise<{
 *   written: Array<{ key: string, path: string }>,
 *   dirs: Array<{ key: string, path: string }>,
 *   conversions: Array<{ key: string, from: string, to: string, kind: string }>,
 *   warnings: string[]
 * }>}
 */
export async function restoreWorkspaceFiles(input) {
  const { entries, pathMap, targetPlatform } = input
  if (!Array.isArray(entries)) throw workspaceError('entries 必须是数组')
  if (pathMap === null || typeof pathMap !== 'object' || typeof pathMap.byKey !== 'object') {
    throw workspaceError('缺少路径映射 pathMap')
  }

  const byWorkspace = new Map()
  for (const entry of entries) {
    const match = /^workspaces\/([^/]+)\/files\/?(.*)$/.exec(entry.packPath)
    if (!match) continue
    const key = match[1]
    const relative = match[2]
    if (!byWorkspace.has(key)) byWorkspace.set(key, [])
    byWorkspace.get(key).push({
      relative,
      isDir: entry.packPath.endsWith('/') || relative.length === 0,
      data: entry.data,
    })
  }

  const written = []
  const dirs = []
  const conversions = []
  const warnings = []

  for (const [key, files] of byWorkspace) {
    const targetRoot = pathMap.byKey[key]
    if (typeof targetRoot !== 'string' || targetRoot.length === 0) {
      throw workspaceError(`工作区 ${key} 缺少目标路径映射`, { key })
    }
    // 即使没有文件条目，也要让目标目录存在（否则 workspaceRegistry.create 的 realpath 会失败）
    await mkdir(targetRoot, { recursive: true })

    for (const file of files) {
      if (file.isDir) {
        const target = join(targetRoot, file.relative)
        await mkdir(target, { recursive: true })
        dirs.push({ key, path: target })
        continue
      }

      let relative = file.relative
      if (targetPlatform === 'win32') {
        const segments = relative.split('/')
        const name = segments.pop() ?? ''
        const safe = sanitizeWindowsName(name)
        if (safe !== name) {
          conversions.push({ key, from: relative, to: [...segments, safe].join('/'), kind: 'renamed' })
          relative = [...segments, safe].join('/')
        }
      }

      const target = join(targetRoot, relative)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, file.data)
      written.push({ key, path: target })
    }
  }

  return { written, dirs, conversions, warnings }
}
