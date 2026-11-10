/**
 * 工作区扫描：遍历目录、应用排除规则、统计大小（SPEC §FR-4 / §FR-9）。
 *
 * 只读元数据（lstat），不读取文件内容；不跟随符号链接（避免循环）。
 */

import { lstat, readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { ERROR_CODES, MoverError } from './errors.js'

/** 默认排除的可再生目录（SPEC §FR-4）。 */
export const DEFAULT_EXCLUDED_DIRS = Object.freeze([
  'node_modules',
  '.venv',
  'venv',
  '__pycache__',
  '.pytest_cache',
  'dist',
  'build',
  'out',
  '.next',
  'coverage',
  '.cache',
])

/**
 * @param {string} message
 * @param {Record<string, unknown>} [details]
 * @returns {MoverError}
 */
function scanError(message, details = {}) {
  return new MoverError(ERROR_CODES.SCAN_INVALID, message, details)
}

/**
 * 计算本次扫描的排除集合。
 * @param {{ full?: boolean, includeGit?: boolean, excludedDirs?: readonly string[] }} [options]
 * @returns {{ excluded: Set<string>, skipGit: boolean }}
 */
export function resolveExclusions(options = {}) {
  const full = options.full === true
  if (full) return { excluded: new Set(), skipGit: false }
  const dirs = options.excludedDirs ?? DEFAULT_EXCLUDED_DIRS
  return { excluded: new Set(dirs), skipGit: options.includeGit === false }
}

/**
 * 扫描工作区。
 * @param {string} root
 * @param {{ full?: boolean, includeGit?: boolean, excludedDirs?: readonly string[] }} [options]
 * @returns {Promise<{
 *   root: string,
 *   files: number,
 *   dirs: number,
 *   totalBytes: number,
 *   excluded: Array<{ relPath: string, reason: string }>,
 *   entries: Array<{ relPath: string, name: string, isDir: boolean, isSymlink: boolean, size: number, mode: number, mtimeMs: number }>
 * }>}
 */
export async function scanWorkspace(root, options = {}) {
  let rootStat
  try {
    rootStat = await lstat(root)
  } catch (error) {
    throw scanError(`无法读取工作区: ${root}`, {
      root,
      cause: error instanceof Error ? error.message : String(error),
    })
  }
  if (!rootStat.isDirectory()) {
    throw scanError(`工作区不是目录: ${root}`, { root })
  }

  const { excluded, skipGit } = resolveExclusions(options)
  const entries = []
  const excludedEntries = []
  let files = 0
  let dirs = 0
  let totalBytes = 0

  /**
   * @param {string} dir
   * @param {string} relDir
   */
  async function walk(dir, relDir) {
    let children
    try {
      children = await readdir(dir, { withFileTypes: true })
    } catch (error) {
      throw scanError(`无法读取目录: ${dir}`, {
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

      if (isDirectory) {
        if (excluded.has(child.name)) {
          excludedEntries.push({ relPath: rel, reason: 'default-excluded' })
          continue
        }
        if (skipGit && child.name === '.git') {
          excludedEntries.push({ relPath: rel, reason: 'git-excluded' })
          continue
        }
      }

      entries.push({
        relPath: rel,
        name: child.name,
        isDir: isDirectory,
        isSymlink,
        size: isDirectory ? 0 : info.size,
        mode: info.mode,
        mtimeMs: info.mtimeMs,
      })

      if (isDirectory) {
        dirs += 1
        await walk(abs, rel)
      } else {
        files += 1
        totalBytes += info.size
      }
    }
  }

  await walk(root, '')

  return { root, files, dirs, totalBytes, excluded: excludedEntries, entries }
}
