/**
 * 路径映射：把源平台的工作区路径映射到目标平台路径（SPEC §FR-8）。
 *
 * - `auto`：同平台保留原路径；跨平台放到用户选择的根目录下。
 * - `original`：始终保留原路径（要求目标平台存在且合法）。
 * - `under-root`：始终放到根目录下，目录名取工作区标题并做平台安全化。
 */

import { join } from 'node:path'

import { PLATFORMS } from './manifest.js'
import { WINDOWS_RESERVED_NAMES } from './preflight.js'
import { ERROR_CODES, MoverError } from './errors.js'

const WINDOWS_RESERVED = new Set(WINDOWS_RESERVED_NAMES)
const WINDOWS_INVALID_CHARS = /[<>:"/\\|?*\u0000-\u001f]/

/**
 * @param {string} message
 * @param {Record<string, unknown>} [details]
 * @returns {MoverError}
 */
function pathMapError(message, details = {}) {
  return new MoverError(ERROR_CODES.PATH_INVALID, message, details)
}

/**
 * 生成目标平台安全的目录名。
 * @param {string} name
 * @param {'win32'|'darwin'|'linux'} platform
 * @returns {string}
 */
export function safeDirName(name, platform) {
  let safe = String(name ?? '')
    .replace(WINDOWS_INVALID_CHARS, '_')
    .replace(/[. ]+$/g, '')
    .trim()
  if (safe.length === 0) safe = 'workspace'
  if (platform === 'win32' && WINDOWS_RESERVED.has(safe.split('.')[0].toUpperCase())) {
    safe = `_${safe}`
  }
  return safe
}

/**
 * 构建工作区路径映射。
 * @param {{
 *   sourcePlatform: 'win32'|'darwin'|'linux',
 *   targetPlatform: 'win32'|'darwin'|'linux',
 *   targetRoot?: string,
 *   workspaces: Array<{ key: string, title: string, sourcePath: string }>,
 *   strategy?: 'auto'|'original'|'under-root'
 * }} input
 * @returns {{
 *   sourcePlatform: string,
 *   targetPlatform: string,
 *   targetRoot: string | undefined,
 *   entries: Array<{ key: string, title: string, sourcePath: string, targetPath: string, action: 'keep'|'relocate' }>,
 *   byKey: Record<string, string>,
 *   conflicts: Array<{ targetPath: string, keys: string[] }>
 * }}
 */
export function buildPathMap(input) {
  const { sourcePlatform, targetPlatform, targetRoot, workspaces } = input
  const strategy = input.strategy ?? 'auto'

  for (const platform of [sourcePlatform, targetPlatform]) {
    if (!PLATFORMS.includes(platform)) {
      throw pathMapError(`不支持的平台: ${String(platform)}`, { platform })
    }
  }
  if (!Array.isArray(workspaces)) {
    throw pathMapError('workspaces 必须是数组')
  }
  if (strategy === 'under-root' || (strategy === 'auto' && sourcePlatform !== targetPlatform)) {
    if (typeof targetRoot !== 'string' || targetRoot.length === 0) {
      throw pathMapError('缺少目标根目录 targetRoot', { strategy })
    }
  }

  const entries = []
  const byKey = {}
  const used = new Map()

  for (const workspace of workspaces) {
    const keepOriginal =
      strategy === 'original' || (strategy === 'auto' && sourcePlatform === targetPlatform)

    let targetPath
    if (keepOriginal) {
      targetPath = workspace.sourcePath
    } else {
      const base = safeDirName(workspace.title, targetPlatform)
      const key = base.toLowerCase()
      const count = (used.get(key) ?? 0) + 1
      used.set(key, count)
      const dir = count === 1 ? base : `${base}-${count}`
      targetPath = join(targetRoot, dir)
    }

    entries.push({
      key: workspace.key,
      title: workspace.title,
      sourcePath: workspace.sourcePath,
      targetPath,
      action: keepOriginal ? 'keep' : 'relocate',
    })
    byKey[workspace.key] = targetPath
  }

  const byTarget = new Map()
  for (const entry of entries) {
    const key = entry.targetPath.toLowerCase()
    if (!byTarget.has(key)) byTarget.set(key, [])
    byTarget.get(key).push(entry.key)
  }
  const conflicts = [...byTarget.entries()]
    .filter(([, keys]) => keys.length > 1)
    .map(([targetPath, keys]) => ({ targetPath, keys }))

  return {
    sourcePlatform,
    targetPlatform,
    targetRoot,
    entries,
    byKey,
    conflicts,
  }
}

/**
 * 取某个工作区对应的目标路径（不存在返回 undefined）。
 * @param {string | undefined} workspaceKey
 * @param {{ byKey: Record<string, string> }} pathMap
 * @returns {string | undefined}
 */
export function mapCwdForWorkspace(workspaceKey, pathMap) {
  if (workspaceKey === undefined) return undefined
  return pathMap.byKey[workspaceKey]
}
