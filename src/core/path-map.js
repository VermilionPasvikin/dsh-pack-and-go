/**
 * 路径映射：把源平台的工作区路径映射到目标平台路径（SPEC §FR-8）。
 *
 * - `auto`：同平台保留原路径；跨平台放到用户选择的根目录下。
 * - `original`：始终保留原路径（要求目标平台存在且合法）。
 * 目标目录名统一走 `safeDirName`；四步判据与冲突消解由 `planImportTargets` 负责（ADR-0019）。
 */

import { join } from 'node:path'

import { PLATFORMS } from './manifest.js'
import { WINDOWS_RESERVED_NAMES } from './preflight.js'
import { ERROR_CODES, MoverError } from './errors.js'

const WINDOWS_RESERVED = new Set(WINDOWS_RESERVED_NAMES)
const WINDOWS_INVALID_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g

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
