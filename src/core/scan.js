/**
 * 工作区扫描：遍历目录、应用排除规则、统计大小（SPEC §FR-4 / §FR-9）。
 *
 * 只读元数据（lstat），不递归符号链接目录，避免循环；
 * 符号链接文件按 FR-9 默认「解引用」为普通文件（记录 dereferenced 标记），
 * 目录链接与损坏链接跳过并写入 excluded 记录。
 */

import { lstat, readdir, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'

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
 * 判断真实路径是否位于工作区根之内（含根本身）。
 * @param {string} rootReal 已解析的工作区根
 * @param {string} targetReal 已解析的链接目标
 * @returns {boolean}
 */
function isInsideRoot(rootReal, targetReal) {
  const rel = relative(rootReal, targetReal)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

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
  // 解引用边界（ADR-0020 §5）：符号链接目标必须仍在工作区根之内，
  // 否则把工作区外的文件悄悄打进包里（P2-13 / NFR-4）。
  const rootReal = await realpath(root).catch(() => root)
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

      if (isSymlink) {
        // 默认解引用：文件链接按普通文件打包；目录链接/损坏链接跳过并记录。
        try {
          const targetInfo = await stat(abs)
          if (targetInfo.isFile()) {
            const targetReal = await realpath(abs).catch(() => undefined)
            if (targetReal !== undefined && !isInsideRoot(rootReal, targetReal)) {
              excludedEntries.push({ relPath: rel, reason: 'symlink-outside' })
              continue
            }
            entries.push({
              relPath: rel,
              name: child.name,
              isDir: false,
              isSymlink: true,
              dereferenced: true,
              size: targetInfo.size,
              mode: targetInfo.mode,
              mtimeMs: targetInfo.mtimeMs,
            })
            files += 1
            totalBytes += targetInfo.size
            continue
          }
          excludedEntries.push({ relPath: rel, reason: 'symlink-dir-skipped' })
        } catch {
          excludedEntries.push({ relPath: rel, reason: 'symlink-broken' })
        }
        continue
      }

      const isDirectory = info.isDirectory()

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
        isSymlink: false,
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
