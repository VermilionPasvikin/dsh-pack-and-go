/**
 * 跨平台预检：在打包/导入前找出目标平台的风险（SPEC §FR-9）。
 *
 * 纯函数部分（classifyEntry / detectCaseCollisions / sanitizeWindowsName）可在任意
 * 平台单测；preflightWorkspace 负责遍历真实目录并汇总为可序列化报告。
 */

import { lstat, readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { PLATFORMS } from './manifest.js'
import { ERROR_CODES, MoverError } from './errors.js'

/** Windows 保留设备名（不区分大小写，含扩展名时同样保留）。 */
export const WINDOWS_RESERVED_NAMES = Object.freeze([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
])

const WINDOWS_RESERVED = new Set(WINDOWS_RESERVED_NAMES)

/** Windows 文件名单段中的非法字符。 */
const WINDOWS_INVALID_CHARS = /[<>:"/\\|?*\u0000-\u001f]/

/** 风险类型（只追加）。 */
export const RISK_KINDS = Object.freeze([
  'invalid-name',
  'reserved-name',
  'trailing-dot-space',
  'path-length',
  'symlink',
  'permission',
])

/** Windows 路径长度预算（MAX_PATH 260，留 1 给结尾 NUL）。 */
const WINDOWS_MAX_PATH = 259

/**
 * @param {string} message
 * @param {Record<string, unknown>} [details]
 * @returns {MoverError}
 */
function preflightError(message, details = {}) {
  return new MoverError(ERROR_CODES.PREFLIGHT_INVALID, message, details)
}

/**
 * 生成 Windows 安全文件名建议（检测阶段只给建议，实际重命名在导入时执行）。
 * @param {string} name
 * @returns {string}
 */
export function sanitizeWindowsName(name) {
  let sanitized = name.replace(WINDOWS_INVALID_CHARS, '_').replace(/[. ]+$/g, '')
  if (sanitized.length === 0) sanitized = '_'
  const base = sanitized.split('.')[0].toUpperCase()
  if (WINDOWS_RESERVED.has(base)) sanitized = `_${sanitized}`
  return sanitized
}

/**
 * 判断单个条目在目标平台的风险。
 * @param {{ name: string, relPath: string, isSymlink?: boolean, isDirectory?: boolean, mode?: number, size?: number }} entry
 * @param {{ targetPlatform: 'win32'|'darwin'|'linux', rootPath: string }} options
 * @returns {Array<{ path: string, kind: string, detail: string, suggestion?: string }>}
 */
export function classifyEntry(entry, options) {
  if (!PLATFORMS.includes(options.targetPlatform)) {
    throw preflightError(`不支持的目标平台: ${String(options.targetPlatform)}`, {
      platform: options.targetPlatform,
    })
  }
  const risks = []
  const path = entry.relPath
  const isWindows = options.targetPlatform === 'win32'

  if (isWindows && WINDOWS_INVALID_CHARS.test(entry.name)) {
    risks.push({
      path,
      kind: 'invalid-name',
      detail: '文件名包含 Windows 非法字符',
      suggestion: sanitizeWindowsName(entry.name),
    })
  }
  if (isWindows && WINDOWS_RESERVED.has(entry.name.split('.')[0].toUpperCase())) {
    risks.push({
      path,
      kind: 'reserved-name',
      detail: '文件名是 Windows 保留设备名',
      suggestion: sanitizeWindowsName(entry.name),
    })
  }
  if (isWindows && /[. ]$/.test(entry.name)) {
    risks.push({
      path,
      kind: 'trailing-dot-space',
      detail: '文件名以点或空格结尾，Windows 会静默去掉',
      suggestion: sanitizeWindowsName(entry.name),
    })
  }
  if (isWindows && options.rootPath.length + 1 + path.length > WINDOWS_MAX_PATH) {
    risks.push({
      path,
      kind: 'path-length',
      detail: `目标路径超过 ${WINDOWS_MAX_PATH} 字符，可能创建失败`,
    })
  }
  if (entry.isSymlink) {
    risks.push({
      path,
      kind: 'symlink',
      detail: '符号链接将按默认策略解引用为普通文件',
    })
  }
  if (isWindows && !entry.isDirectory && typeof entry.mode === 'number' && (entry.mode & 0o111) !== 0) {
    risks.push({
      path,
      kind: 'permission',
      detail: '可执行权限位在 Windows 目标上会丢失',
    })
  }
  return risks
}

/**
 * 检测大小写冲突（目标文件系统不区分大小写时）。
 * @param {Array<{ dir: string, name: string }>} entries
 * @returns {Array<{ dir: string, key: string, names: string[] }>}
 */
export function detectCaseCollisions(entries) {
  /** @type {Map<string, Map<string, string[]>>} */
  const byDir = new Map()
  for (const entry of entries) {
    const key = entry.name.toLowerCase()
    if (!byDir.has(entry.dir)) byDir.set(entry.dir, new Map())
    const byKey = byDir.get(entry.dir)
    if (!byKey.has(key)) byKey.set(key, [])
    byKey.get(key).push(entry.name)
  }

  const collisions = []
  for (const [dir, byKey] of byDir) {
    for (const [key, names] of byKey) {
      if (names.length > 1 && new Set(names).size > 1) {
        collisions.push({ dir, key, names: [...new Set(names)].sort() })
      }
    }
  }
  return collisions
}

/**
 * 遍历工作区并生成预检报告（不读取文件内容）。
 * @param {string} root 工作区目录
 * @param {'win32'|'darwin'|'linux'} targetPlatform
 * @returns {Promise<object>} 可 JSON 序列化的报告
 */
export async function preflightWorkspace(root, targetPlatform) {
  if (!PLATFORMS.includes(targetPlatform)) {
    throw preflightError(`不支持的目标平台: ${String(targetPlatform)}`, { platform: targetPlatform })
  }

  let rootStat
  try {
    rootStat = await lstat(root)
  } catch (error) {
    throw preflightError(`无法读取工作区: ${root}`, {
      root,
      cause: error instanceof Error ? error.message : String(error),
    })
  }
  if (!rootStat.isDirectory()) {
    throw preflightError(`工作区不是目录: ${root}`, { root })
  }

  const items = []
  const caseEntries = []
  let scannedFiles = 0
  let scannedDirs = 0
  let totalBytes = 0

  /** @param {string} dir @param {string} relDir */
  async function walk(dir, relDir) {
    let children
    try {
      children = await readdir(dir, { withFileTypes: true })
    } catch (error) {
      throw preflightError(`无法读取目录: ${dir}`, {
        dir,
        cause: error instanceof Error ? error.message : String(error),
      })
    }

    for (const child of children) {
      const abs = join(dir, child.name)
      const rel = relDir ? `${relDir}/${child.name}` : child.name
      const info = await lstat(abs)
      const isSymlink = info.isSymbolicLink()
      const isDirectory = !isSymlink && info.isDirectory()

      caseEntries.push({ dir: relDir, name: child.name })
      items.push({
        name: child.name,
        relPath: rel,
        isSymlink,
        isDirectory,
        mode: info.mode,
        size: info.size,
      })

      if (isDirectory) {
        scannedDirs += 1
        await walk(abs, rel)
      } else {
        scannedFiles += 1
        totalBytes += info.size
      }
    }
  }

  await walk(root, '')

  const risks = items.flatMap((item) =>
    classifyEntry(item, { targetPlatform, rootPath: root }),
  )

  const collisions = targetPlatform === 'linux' ? [] : detectCaseCollisions(caseEntries)
  for (const collision of collisions) {
    const where = collision.dir ? `${collision.dir}/` : ''
    risks.push({
      path: `${where}${collision.names.join(' | ')}`,
      kind: 'case-collision',
      detail: '目标文件系统不区分大小写，同名文件会冲突',
    })
  }

  const summary = {
    invalidName: 0,
    reservedName: 0,
    trailingDotSpace: 0,
    caseCollision: 0,
    pathLength: 0,
    symlink: 0,
    permission: 0,
  }
  const kindToSummary = {
    'invalid-name': 'invalidName',
    'reserved-name': 'reservedName',
    'trailing-dot-space': 'trailingDotSpace',
    'case-collision': 'caseCollision',
    'path-length': 'pathLength',
    symlink: 'symlink',
    permission: 'permission',
  }
  for (const risk of risks) {
    const key = kindToSummary[risk.kind]
    if (key) summary[key] += 1
  }

  return {
    root,
    targetPlatform,
    scannedFiles,
    scannedDirs,
    totalBytes,
    risks,
    summary,
  }
}
