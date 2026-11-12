/**
 * 工作区文件恢复（T2.9）。
 *
 * 包内布局：`workspaces/<key>/files/<相对路径>`。
 * 目标布局：`pathMap.byKey[key]` + 相对路径。
 * Windows 目标会对非法文件名做安全重命名并记录转换。
 */

import { chmod, mkdir, stat, writeFile } from 'node:fs/promises'
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
 *   entries: Array<{ packPath: string, data: Buffer, mode?: number }>,
 *   pathMap: { byKey: Record<string, string> },
 *   targetPlatform: 'win32'|'darwin'|'linux',
 *   sourcePlatform?: 'win32'|'darwin'|'linux'
 * }} input
 * @returns {Promise<{
 *   written: Array<{ key: string, path: string }>,
 *   dirs: Array<{ key: string, path: string }>,
 *   conversions: Array<{ key: string, from: string, to: string, kind: string }>,
 *   modes: { applied: number, failed: number },
 *   warnings: string[]
 * }>}
 */
export async function restoreWorkspaceFiles(input) {
  const { entries, pathMap, targetPlatform, sourcePlatform } = input
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
      // 权限位随条目带入，否则下面的 exec 位 chmod 分支永远不执行（P-05a）。
      mode: entry.mode,
    })
  }

  const written = []
  const overwritten = []
  const dirs = []
  const dirModes = []
  const conversions = []
  const modes = { applied: 0, failed: 0, dirsApplied: 0, dirsFailed: 0 }
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
        // ADR-0016 B2：目录权限两阶段恢复——先以可写创建，写完全部文件后再统一 chmod。
        dirModes.push({ key, relative: file.relative, path: target, mode: file.mode })
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
      let existed = false
      try {
        await stat(target)
        existed = true
      } catch {
        // 目标不存在
      }
      await writeFile(target, file.data)
      // 权限恢复（SPEC FR-9 / ADR-0016 B1）：
      // POSIX 源 + POSIX 目标 → 按包内 mode 恢复，自动剥离 setuid/setgid/sticky（只取低 9 位）；
      // win32 源包（mode 是 libuv 由 READONLY 合成的 `0666`/`0444`，不是权限事实）与未知来源
      // → 只恢复 exec 位；
      // Windows 目标 → 一律忽略（ADR-0003）。
      const fileMode = typeof file.mode === 'number' ? file.mode : undefined
      const fullRestore = targetPlatform !== 'win32' && sourcePlatform !== 'win32'
      const shouldRestore =
        targetPlatform !== 'win32' &&
        fileMode !== undefined &&
        (fullRestore ? (fileMode & 0o777) !== 0 : (fileMode & 0o111) !== 0)
      if (shouldRestore) {
        try {
          await chmod(target, fileMode & 0o777)
          modes.applied += 1
        } catch {
          // 权限恢复失败不阻断导入，但要让调用方看到（ADR-0016 B1 约束 6）。
          modes.failed += 1
          warnings.push(`权限位恢复失败：${relative}`)
        }
      }
      written.push({ key, path: target })
      if (existed) overwritten.push({ key, path: target })
    }
  }

  // 第二阶段：全量文件写完后统一恢复目录权限（ADR-0016 B2）。
  // - 仅 POSIX 源 + POSIX 目标；win32 源包的目录 mode 是 libuv 合成值（无 x 位）→ 跳过；
  // - 只取低 9 位，剥离 setuid/setgid/sticky；
  // - 先深后浅：先 chmod 深层目录，避免父目录被收紧后无法进入。
  const fullRestore = targetPlatform !== 'win32' && sourcePlatform !== 'win32'
  if (fullRestore) {
    dirModes.sort((a, b) => b.path.length - a.path.length)
    for (const dir of dirModes) {
      if (typeof dir.mode !== 'number') continue
      try {
        await chmod(dir.path, dir.mode & 0o777)
        modes.dirsApplied += 1
      } catch {
        modes.dirsFailed += 1
        warnings.push(`目录权限恢复失败：${dir.relative}`)
      }
    }
  }

  return { written, overwritten, dirs, conversions, modes, warnings }
}
