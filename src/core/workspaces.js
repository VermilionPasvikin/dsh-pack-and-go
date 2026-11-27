/**
 * 工作区文件恢复（T2.9）。
 *
 * 包内布局：`workspaces/<key>/files/<相对路径>`。
 * 目标布局：`pathMap.byKey[key]` + 相对路径。
 *
 * ADR-0020 路径安全闭环：
 * - Windows 目标逐段净化（非法字符 / 保留名 / 段尾空格点），单段超 255 字节截断；
 * - 大小写不敏感目标（win32 / darwin）同目录同名文件追加 ` (n)`，不再互相覆盖；
 * - Windows 全路径超 240 字符的条目跳过并记录（不静默）。
 */

import { chmod, mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { ERROR_CODES, MoverError } from './errors.js'
import { sanitizeWindowsName } from './preflight.js'

/** 单段文件名上限（ext4 / NTFS 均为 255 字节）。 */
const MAX_SEGMENT_BYTES = 255
/** Windows 目标整条路径上限（ADR-0020 §3：给 260 的 Win32 限制留余量）。 */
const MAX_WIN32_PATH_LENGTH = 240
/** 大小写不敏感的文件系统平台（ADR-0020 §2）。 */
const CASE_INSENSITIVE_PLATFORMS = new Set(['win32', 'darwin'])

/**
 * @param {string} message
 * @param {Record<string, unknown>} [details]
 * @returns {MoverError}
 */
function workspaceError(message, details = {}) {
  return new MoverError(ERROR_CODES.PACK_INVALID, message, details)
}

/**
 * 按 UTF-8 字节数截断，且不切断多字节字符（ADR-0020 §1）。
 * @param {string} text
 * @param {number} maxBytes
 * @returns {string}
 */
function truncateUtf8(text, maxBytes) {
  const buffer = Buffer.from(text, 'utf8')
  if (buffer.length <= maxBytes) return text
  let end = maxBytes
  // 回退到「最后一个字符首字节」之后的位置（丢弃被切断的续字节）。
  while (end > 0 && (buffer[end - 1] & 0xc0) === 0x80) end -= 1
  if (end > 0) {
    const lead = buffer[end - 1]
    const needed = lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : lead >= 0xc0 ? 2 : 1
    const sequenceEnd = end - 1 + needed
    // 首字节声明的完整序列放得下就保留整段，放不下就丢掉这个字符。
    end = sequenceEnd <= maxBytes ? sequenceEnd : end - 1
  }
  return buffer.subarray(0, end).toString('utf8')
}

/**
 * 逐段净化包内相对路径（ADR-0020 §1）。
 *
 * - win32：非法字符换成 `_`、去掉段尾空格/点、保留名（CON/PRN/NUL/COM1…）加 `_` 前缀；
 * - 任意平台：单段超过 255 字节截断（保留完整 UTF-8 序列）；
 * - 空段、`.`、`..` 丢弃（包内路径越界由 zip 校验兜底）。
 *
 * @param {string} relative
 * @param {'win32'|'darwin'|'linux'} platform
 * @returns {{ path: string, conversions: Array<{ from: string, to: string, kind: string }> }}
 */
export function sanitizeRelativePath(relative, platform) {
  const segments = String(relative ?? '')
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
  const sanitized = []
  const conversions = []
  for (const segment of segments) {
    let next = platform === 'win32' ? sanitizeWindowsName(segment) : segment
    if (Buffer.byteLength(next, 'utf8') > MAX_SEGMENT_BYTES) {
      next = truncateUtf8(next, MAX_SEGMENT_BYTES)
    }
    if (next !== segment) conversions.push({ from: segment, to: next, kind: 'renamed' })
    sanitized.push(next)
  }
  return { path: sanitized.join('/'), conversions }
}

/**
 * 在扩展名前插入大小写冲突序号（`report.txt` → `report (1).txt`）。
 * 无扩展名或点开头的隐藏文件直接在末尾追加。
 * @param {string} name
 * @param {number} attempt
 * @returns {string}
 */
function withCollisionSuffix(name, attempt) {
  const dot = name.lastIndexOf('.')
  const suffix = ` (${attempt})`
  if (dot > 0) return `${name.slice(0, dot)}${suffix}${name.slice(dot)}`
  return `${name}${suffix}`
}

/**
 * 每个导入工作区一份的大小写冲突注册表（ADR-0020 §2）。
 * 目录键取小写，保证 `Sub/` 与 `sub/` 视为同一层。
 * @param {'win32'|'darwin'|'linux'} platform
 * @returns {{ unique: (relative: string) => { path: string, conflict: boolean } }}
 */
function createNameRegistry(platform) {
  const caseInsensitive = CASE_INSENSITIVE_PLATFORMS.has(platform)
  /** @type {Map<string, Set<string>>} 目录（小写）→ 已占用的小写文件名 */
  const directories = new Map()
  return {
    unique(relative) {
      if (!caseInsensitive) return { path: relative, conflict: false }
      const segments = relative.split('/')
      const name = segments.pop() ?? ''
      const dirKey = segments.join('/').toLowerCase()
      let used = directories.get(dirKey)
      if (!used) {
        used = new Set()
        directories.set(dirKey, used)
      }
      let candidate = name
      let attempt = 1
      while (used.has(candidate.toLowerCase())) {
        candidate = withCollisionSuffix(name, attempt)
        attempt += 1
      }
      used.add(candidate.toLowerCase())
      return { path: [...segments, candidate].join('/'), conflict: candidate !== name }
    },
  }
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

    const nameRegistry = createNameRegistry(targetPlatform)

    for (const file of files) {
      // ADR-0020 §1：目录与文件的每一段都净化（目录名也可能是非法名或保留名）。
      const sanitized = sanitizeRelativePath(file.relative, targetPlatform)
      let relative = sanitized.path
      if (sanitized.conversions.length > 0) {
        conversions.push({ key, from: file.relative, to: relative, kind: 'renamed' })
      }

      if (file.isDir) {
        if (relative.length === 0) continue
        const target = join(targetRoot, relative)
        await mkdir(target, { recursive: true })
        dirs.push({ key, path: target })
        // ADR-0016 B2：目录权限两阶段恢复——先以可写创建，写完全部文件后再统一 chmod。
        dirModes.push({ key, relative, path: target, mode: file.mode })
        continue
      }

      // ADR-0020 §2：大小写不敏感目标上同名文件会互相覆盖，冲突方追加 ` (n)`。
      const unique = nameRegistry.unique(relative)
      if (unique.conflict) {
        conversions.push({ key, from: relative, to: unique.path, kind: 'case-collision' })
        relative = unique.path
      }

      const target = join(targetRoot, relative)
      // ADR-0020 §3：Windows 全路径超长写入会失败，跳过并显式记录（不静默）。
      if (targetPlatform === 'win32' && target.length > MAX_WIN32_PATH_LENGTH) {
        conversions.push({ key, from: relative, to: relative, kind: 'path-too-long' })
        warnings.push(`路径过长已跳过：${relative}`)
        continue
      }
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
