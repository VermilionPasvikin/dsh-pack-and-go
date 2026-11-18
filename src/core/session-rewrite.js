/**
 * 会话日志改写：header cwd（ADR-0007 方案 A）与
 * working-directory/change 状态事件 cwd（ADR-0017）。
 *
 * header 改写只解压第一帧，其余帧字节原样拼接；只有当移植后 cwd 变化且
 * 源/目标平台不同时，才解压事件帧，仅重写 working-directory/change 的
 * `data.cwd`。其余事件内容保持不变。
 */

import { readFile, writeFile } from 'node:fs/promises'
import zlib from 'node:zlib'

import { SESSION_FORMAT_VERSION } from './constants.js'
import { ERROR_CODES, MoverError } from './errors.js'
import { PLATFORMS } from './manifest.js'
import { scanFrames } from './zstd-frames.js'

/** 事件帧重压分块大小：与 DSH 会话写入器的 1 MB 分块一致。 */
const EVENT_FRAME_BYTES = 1024 * 1024

const PLATFORM_SEPARATOR = Object.freeze({ win32: '\\', darwin: '/', linux: '/' })

/**
 * @param {string} message
 * @param {Record<string, unknown>} [details]
 * @returns {MoverError}
 */
function headerError(message, details = {}) {
  return new MoverError(ERROR_CODES.SESSION_HEADER_INVALID, message, details)
}

/**
 * @param {string} message
 * @param {Record<string, unknown>} [details]
 * @returns {MoverError}
 */
function frameError(message, details = {}) {
  return new MoverError(ERROR_CODES.SESSION_FRAME_INVALID, message, details)
}

/**
 * @param {string} platform
 * @returns {string}
 */
function separatorFor(platform) {
  if (!PLATFORMS.includes(platform)) {
    throw headerError(`不支持的平台: ${String(platform)}`, { reason: 'invalid-platform', platform })
  }
  return PLATFORM_SEPARATOR[platform]
}

/**
 * 归一化 cwd：统一分隔符、去掉尾部多余分隔符，保留根路径。
 * @param {string} value
 * @param {string} platform
 * @returns {string}
 */
function normalizeCwd(value, platform) {
  if (typeof value !== 'string' || value.length === 0) return ''
  if (platform === 'win32') {
    let path = value.replace(/\//g, '\\')
    if (/^[A-Za-z]:\\$/.test(path)) return path
    path = path.replace(/\\+$/, '')
    return path.length === 0 ? '\\' : path
  }
  if (platform !== 'win32') {
    const path = value.replace(/\/+$/, '')
    return path.length === 0 ? '/' : path
  }
  return value
}

/**
 * Windows 路径比较忽略大小写；POSIX 保持大小写敏感。
 * @param {string} value
 * @param {string} platform
 * @returns {string}
 */
function foldCwd(value, platform) {
  return platform === 'win32' ? value.toLowerCase() : value
}

/**
 * 把会话事件中的 cwd 映射到目标平台。
 *
 * - 等于源根或在源根之下：替换为 `toCwd` + 相对路径（分隔符转为目标平台）；
 * - 源根之外（例如用户中途切到别的目录）：回落到 `toCwd`，保证目标平台合法；
 * - 源根缺失：直接回落到 `toCwd`。
 *
 * @param {string} cwd 事件中的 cwd
 * @param {{
 *   fromCwd?: string,
 *   toCwd: string,
 *   sourcePlatform: string,
 *   targetPlatform: string
 * }} input
 * @returns {string}
 */
export function mapSessionCwd(cwd, input) {
  const { fromCwd, toCwd, sourcePlatform, targetPlatform } = input
  const sourceSeparator = separatorFor(sourcePlatform)
  const targetSeparator = separatorFor(targetPlatform)
  const target = normalizeCwd(toCwd, targetPlatform)
  if (target.length === 0) {
    throw headerError('toCwd 必须是非空字符串', { reason: 'invalid-cwd' })
  }

  const from = normalizeCwd(fromCwd ?? '', sourcePlatform)
  if (typeof cwd !== 'string' || cwd.length === 0 || from.length === 0) return target

  // 已经落在目标根下（重复执行/目标路径恰好相同）：保持不变，保证幂等。
  const alreadyTarget = normalizeCwd(cwd, targetPlatform)
  const foldedTarget = foldCwd(alreadyTarget, targetPlatform)
  const foldedRoot = foldCwd(target, targetPlatform)
  const targetPrefix = foldedRoot.endsWith(targetSeparator)
    ? foldedRoot
    : foldedRoot + targetSeparator
  if (foldedTarget === foldedRoot || foldedTarget.startsWith(targetPrefix)) return cwd

  const event = normalizeCwd(cwd, sourcePlatform)
  const foldedEvent = foldCwd(event, sourcePlatform)
  const foldedFrom = foldCwd(from, sourcePlatform)
  if (foldedEvent === foldedFrom) return target

  const prefix = foldedFrom.endsWith(sourceSeparator) ? foldedFrom : foldedFrom + sourceSeparator
  if (foldedEvent.startsWith(prefix)) {
    const rest = event.slice(from.length + (from.endsWith(sourceSeparator) ? 0 : 1))
    const restTarget =
      sourceSeparator === targetSeparator ? rest : rest.split(sourceSeparator).join(targetSeparator)
    if (restTarget.length === 0) return target
    return target.endsWith(targetSeparator)
      ? `${target}${restTarget}`
      : `${target}${targetSeparator}${restTarget}`
  }
  return target
}

/**
 * 解析并校验首帧 header，返回帧列表与 header。
 * @param {Buffer} buffer
 * @returns {{
 *   frames: ReadonlyArray<{ start: number, end: number, length: number, checksum: boolean }>,
 *   first: { start: number, end: number, length: number, checksum: boolean },
 *   text: string,
 *   header: Record<string, any>
 * }}
 */
function decodeSessionHeader(buffer) {
  const frames = scanFrames(buffer)
  if (frames.length === 0) {
    throw headerError('会话日志为空，缺少 header 帧', { reason: 'empty' })
  }

  const first = frames[0]
  let decoded
  try {
    decoded = zlib.zstdDecompressSync(buffer.subarray(first.start, first.end))
  } catch (error) {
    throw headerError('header 帧解压失败', {
      reason: 'decompress-failed',
      cause: error instanceof Error ? error.message : String(error),
    })
  }

  const text = decoded.toString('utf8')
  if (!text.endsWith('\n')) {
    throw headerError('header 帧不是换行结尾的单行记录', { reason: 'no-trailing-newline' })
  }

  let header
  try {
    header = JSON.parse(text.slice(0, -1))
  } catch (error) {
    throw headerError('header 不是合法 JSON', {
      reason: 'json-parse',
      cause: error instanceof Error ? error.message : String(error),
    })
  }

  if (header === null || typeof header !== 'object' || Array.isArray(header)) {
    throw headerError('header 必须是 JSON 对象', { reason: 'not-object' })
  }
  if (header.type !== 'session') {
    throw headerError(`首行不是会话 header（type=${String(header.type)}）`, {
      reason: 'not-session',
    })
  }
  return { frames, first, text, header }
}

/**
 * 校验会话格式版本是否为当前版本。
 * @param {Record<string, any>} header
 */
function assertCurrentVersion(header) {
  if (header.version !== SESSION_FORMAT_VERSION) {
    throw new MoverError(
      ERROR_CODES.SESSION_VERSION_UNSUPPORTED,
      `会话格式版本 ${String(header.version)} 不是当前版本 ${SESSION_FORMAT_VERSION}；跨版本导入应走服务重建（ADR-0007 方案 C）`,
      { version: header.version, expected: SESSION_FORMAT_VERSION },
    )
  }
}

/**
 * 改写会话首帧 header 的字段（cwd / id / parentSession），不触碰其余帧。
 * @param {Buffer} buffer 完整会话日志文件内容
 * @param {{ cwd?: string, id?: string, parentSession?: string }} patch 要覆盖的字段
 * @returns {Buffer} 新的会话日志内容
 * @throws {MoverError} 结构损坏或版本不是当前版本（跨版本应走 ADR-0007 方案 C）
 */
export function rewriteSessionHeader(buffer, patch = {}) {
  if (!Buffer.isBuffer(buffer)) {
    throw headerError('rewriteSessionHeader 需要 Buffer 输入', { reason: 'not-buffer' })
  }
  if (patch.cwd !== undefined && (typeof patch.cwd !== 'string' || patch.cwd.length === 0)) {
    throw headerError('cwd 必须是非空字符串', { reason: 'invalid-cwd' })
  }
  if (patch.id !== undefined && (typeof patch.id !== 'string' || patch.id.length === 0)) {
    throw headerError('id 必须是非空字符串', { reason: 'invalid-id' })
  }
  if (
    patch.parentSession !== undefined &&
    (typeof patch.parentSession !== 'string' || patch.parentSession.length === 0)
  ) {
    throw headerError('parentSession 必须是非空字符串', { reason: 'invalid-parent' })
  }

  const { first, header } = decodeSessionHeader(buffer)
  assertCurrentVersion(header)

  if (patch.cwd !== undefined) header.cwd = patch.cwd
  if (patch.id !== undefined) header.id = patch.id
  if (patch.parentSession !== undefined) header.parentSession = patch.parentSession
  const line = `${JSON.stringify(header)}\n`

  const options = first.checksum
    ? { params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 } }
    : undefined
  const newFirst = zlib.zstdCompressSync(Buffer.from(line, 'utf8'), options)

  return Buffer.concat([newFirst, buffer.subarray(first.end)])
}

/**
 * 改写会话日志首帧 header 的 `cwd`，不触碰其余帧。
 * @param {Buffer} buffer 完整会话日志文件内容
 * @param {string} newCwd 目标平台绝对路径
 * @returns {Buffer} 新的会话日志内容
 */
export function rewriteSessionCwd(buffer, newCwd) {
  return rewriteSessionHeader(buffer, { cwd: newCwd })
}

/**
 * 把事件行按目标字节数、以完整行为边界切分并压缩为多帧。
 * @param {string[]} lines 事件行（不含换行符）
 * @param {boolean} trailingNewline 原文是否以换行结尾
 * @param {number} targetBytes 单帧目标字节数
 * @returns {Buffer[]}
 */
function packEventFrames(lines, trailingNewline, targetBytes, checksum) {
  const options = checksum ? { params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 } } : undefined
  const chunks = []
  let current = ''
  let currentBytes = 0

  for (let i = 0; i < lines.length; i += 1) {
    const isLast = i === lines.length - 1
    const piece = `${lines[i]}${isLast && !trailingNewline ? '' : '\n'}`
    const size = Buffer.byteLength(piece, 'utf8')
    if (currentBytes > 0 && currentBytes + size > targetBytes) {
      chunks.push(current)
      current = ''
      currentBytes = 0
    }
    current += piece
    currentBytes += size
  }
  if (currentBytes > 0) chunks.push(current)

  return chunks.map((chunk) => zlib.zstdCompressSync(Buffer.from(chunk, 'utf8'), options))
}

/**
 * 跨平台导入时改写 `working-directory/change` 事件的 `data.cwd`（ADR-0017）。
 *
 * - 首帧（header）原样保留，保证仍是单行 header；
 * - 事件帧整体解压后按行处理，只改目标事件，其余行内容不变；
 * - 无目标事件或没有值变化时返回原 Buffer（字节级不变）。
 *
 * @param {Buffer} buffer 完整会话日志文件内容
 * @param {{
 *   fromCwd?: string,
 *   toCwd: string,
 *   sourcePlatform: 'win32'|'darwin'|'linux',
 *   targetPlatform: 'win32'|'darwin'|'linux',
 *   chunkBytes?: number
 * }} input
 * @returns {{ buffer: Buffer, rewritten: number }}
 * @throws {MoverError} 结构损坏、版本不符或参数非法
 */
export function rewriteSessionWorkingDirectories(buffer, input = {}) {
  if (!Buffer.isBuffer(buffer)) {
    throw headerError('rewriteSessionWorkingDirectories 需要 Buffer 输入', {
      reason: 'not-buffer',
    })
  }
  const { fromCwd, toCwd, sourcePlatform, targetPlatform } = input
  if (typeof toCwd !== 'string' || toCwd.length === 0) {
    throw headerError('toCwd 必须是非空字符串', { reason: 'invalid-cwd' })
  }
  separatorFor(sourcePlatform)
  separatorFor(targetPlatform)
  const chunkBytes = input.chunkBytes ?? EVENT_FRAME_BYTES
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes <= 0) {
    throw headerError('chunkBytes 必须是正整数', { reason: 'invalid-chunk-size' })
  }

  const { frames, first, header } = decodeSessionHeader(buffer)
  assertCurrentVersion(header)
  if (frames.length === 1) return { buffer, rewritten: 0 }

  const eventFrames = frames.slice(1)
  const decoded = []
  for (const frame of eventFrames) {
    try {
      decoded.push(zlib.zstdDecompressSync(buffer.subarray(frame.start, frame.end)))
    } catch (error) {
      throw frameError('事件帧解压失败', {
        reason: 'decompress-failed',
        offset: frame.start,
        cause: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const text = Buffer.concat(decoded).toString('utf8')
  const trailingNewline = text.endsWith('\n')
  const lines = text.split('\n')
  if (trailingNewline) lines.pop()

  let rewritten = 0
  const nextLines = lines.map((line) => {
    if (line.length === 0) return line
    let event
    try {
      event = JSON.parse(line)
    } catch {
      return line
    }
    if (
      event === null ||
      typeof event !== 'object' ||
      event.type !== 'working-directory/change' ||
      event.data === null ||
      typeof event.data !== 'object'
    ) {
      return line
    }
    if (typeof event.data.cwd !== 'string' || event.data.cwd.length === 0) return line
    const mapped = mapSessionCwd(event.data.cwd, {
      fromCwd,
      toCwd,
      sourcePlatform,
      targetPlatform,
    })
    if (mapped === event.data.cwd) return line
    event.data.cwd = mapped
    rewritten += 1
    return JSON.stringify(event)
  })

  if (rewritten === 0) return { buffer, rewritten: 0 }

  const eventFramesOut = packEventFrames(nextLines, trailingNewline, chunkBytes, eventFrames[0].checksum)
  return {
    buffer: Buffer.concat([buffer.subarray(first.start, first.end), ...eventFramesOut]),
    rewritten,
  }
}

/**
 * 判断值是否为该平台的绝对路径。
 * @param {string} value
 * @param {string} platform
 * @returns {boolean}
 */
function isAbsolutePath(value, platform) {
  if (typeof value !== 'string' || value.length === 0) return false
  if (platform === 'win32') {
    return /^[A-Za-z]:[\\/]/.test(value) || /^\\\\[^\\]/.test(value)
  }
  return value.startsWith('/')
}

/**
 * 返回绝对路径相对 root 的 POSIX 相对路径；不在 root 下返回 undefined。
 * @param {string} value
 * @param {string} root
 * @param {string} platform
 * @returns {string|undefined}
 */
function relativeUnderRoot(value, root, platform) {
  const separator = separatorFor(platform)
  const normalizedRoot = normalizeCwd(root, platform)
  const normalizedValue = normalizeCwd(value, platform)
  if (normalizedRoot.length === 0) return undefined
  const foldedRoot = foldCwd(normalizedRoot, platform)
  const foldedValue = foldCwd(normalizedValue, platform)
  if (foldedValue === foldedRoot) return ''
  const prefix = foldedRoot.endsWith(separator) ? foldedRoot : foldedRoot + separator
  if (!foldedValue.startsWith(prefix)) return undefined
  const start = normalizedRoot.length + (normalizedRoot.endsWith(separator) ? 0 : 1)
  return normalizedValue.slice(start).split(separator).join('/')
}

/**
 * 统一的事件行重写：首帧原样保留，事件帧按行解压/变换/重压。
 * @param {Buffer} buffer
 * @param {(event: Record<string, any>) => boolean} transform 返回 true 表示事件被改写
 * @param {number} [chunkBytes]
 * @returns {{ buffer: Buffer, rewritten: number }}
 */
function rewriteEventLines(buffer, transform, chunkBytes = EVENT_FRAME_BYTES) {
  if (!Buffer.isBuffer(buffer)) {
    throw headerError('会话改写需要 Buffer 输入', { reason: 'not-buffer' })
  }
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes <= 0) {
    throw headerError('chunkBytes 必须是正整数', { reason: 'invalid-chunk-size' })
  }
  const { frames, first, header } = decodeSessionHeader(buffer)
  assertCurrentVersion(header)
  if (frames.length === 1) return { buffer, rewritten: 0 }

  const eventFrames = frames.slice(1)
  const decoded = []
  for (const frame of eventFrames) {
    try {
      decoded.push(zlib.zstdDecompressSync(buffer.subarray(frame.start, frame.end)))
    } catch (error) {
      throw frameError('事件帧解压失败', {
        reason: 'decompress-failed',
        offset: frame.start,
        cause: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const text = Buffer.concat(decoded).toString('utf8')
  const trailingNewline = text.endsWith('\n')
  const lines = text.split('\n')
  if (trailingNewline) lines.pop()

  let rewritten = 0
  const nextLines = lines.map((line) => {
    if (line.length === 0) return line
    let event
    try {
      event = JSON.parse(line)
    } catch {
      return line
    }
    if (event === null || typeof event !== 'object') return line
    if (transform(event) !== true) return line
    rewritten += 1
    return JSON.stringify(event)
  })

  if (rewritten === 0) return { buffer, rewritten: 0 }
  const eventFramesOut = packEventFrames(
    nextLines,
    trailingNewline,
    chunkBytes,
    eventFrames[0].checksum,
  )
  return {
    buffer: Buffer.concat([buffer.subarray(first.start, first.end), ...eventFramesOut]),
    rewritten,
  }
}

/**
 * 跨平台/重定位导入时改写结构化文件引用路径（ADR-0017 补充）：
 *
 * - `deliverables/presented` 的 `data.files[].path`：源根下绝对路径 → 工作区相对 POSIX 路径，
 *   保证 DSH 的 `/api/present.open` 在新 cwd 下仍可解析；
 * - `tool/result`/`tool/call` 的 `data.meta.cwd`：源根 cwd → 目标 cwd；
 * - 历史消息正文里的路径文本不改（沿用 ADR-0001 Q4）。
 *
 * @param {Buffer} buffer
 * @param {{
 *   fromCwd?: string,
 *   toCwd: string,
 *   sourcePlatform: 'win32'|'darwin'|'linux',
 *   targetPlatform: 'win32'|'darwin'|'linux',
 *   chunkBytes?: number
 * }} input
 * @returns {{ buffer: Buffer, rewritten: number }}
 */
export function rewriteSessionFileReferences(buffer, input = {}) {
  const { fromCwd, toCwd, sourcePlatform, targetPlatform } = input
  if (typeof toCwd !== 'string' || toCwd.length === 0) {
    throw headerError('toCwd 必须是非空字符串', { reason: 'invalid-cwd' })
  }
  separatorFor(sourcePlatform)
  separatorFor(targetPlatform)
  const target = normalizeCwd(toCwd, targetPlatform)

  return rewriteEventLines(
    buffer,
    (event) => {
      let changed = false

      if (event.type === 'deliverables/presented') {
        const files = event.data?.files
        if (Array.isArray(files)) {
          for (const file of files) {
            if (!file || typeof file.path !== 'string' || file.path.length === 0) continue
            const path = file.path
            let relative
            if (isAbsolutePath(path, sourcePlatform)) {
              relative = relativeUnderRoot(path, fromCwd ?? '', sourcePlatform)
            }
            if (
              (relative === undefined || relative.length === 0) &&
              isAbsolutePath(path, targetPlatform)
            ) {
              relative = relativeUnderRoot(path, target, targetPlatform)
            }
            if (relative !== undefined && relative.length > 0 && relative !== path) {
              file.path = relative
              changed = true
            }
          }
        }
      } else if (event.type === 'tool/result' || event.type === 'tool/call') {
        const meta = event.data?.meta
        if (meta && typeof meta.cwd === 'string' && meta.cwd.length > 0) {
          const mapped = mapSessionCwd(meta.cwd, {
            fromCwd,
            toCwd,
            sourcePlatform,
            targetPlatform,
          })
          if (mapped !== meta.cwd) {
            meta.cwd = mapped
            changed = true
          }
        }
      }

      return changed
    },
    input.chunkBytes ?? EVENT_FRAME_BYTES,
  )
}

/**
 * 修复已导入会话中的失效绝对路径（ADR-0017 补充，repair 命令使用）：
 *
 * - `deliverables/presented`：绝对且目标端不存在的路径，按最长后缀在 `sessionCwd`
 *   下查找真实文件，命中后写成工作区相对 POSIX 路径；
 * - `tool/result`/`tool/call` 的 `meta.cwd` 与 `working-directory/change` 的 `cwd`：
 *   绝对且不等于 `sessionCwd` 时改为 `sessionCwd`。
 *
 * @param {Buffer} buffer
 * @param {{
 *   sessionCwd: string,
 *   exists?: (relativePosix: string) => boolean,
 *   chunkBytes?: number
 * }} input
 * @returns {{ buffer: Buffer, rewritten: number }}
 */
export function repairSessionFileReferences(buffer, input = {}) {
  const sessionCwd = typeof input.sessionCwd === 'string' ? input.sessionCwd : ''
  if (sessionCwd.length === 0) {
    throw headerError('sessionCwd 必须是非空字符串', { reason: 'invalid-cwd' })
  }
  const exists = typeof input.exists === 'function' ? input.exists : undefined

  return rewriteEventLines(
    buffer,
    (event) => {
      let changed = false

      if (event.type === 'deliverables/presented' && exists !== undefined) {
        const files = event.data?.files
        if (Array.isArray(files)) {
          for (const file of files) {
            if (!file || typeof file.path !== 'string' || file.path.length === 0) continue
            const path = file.path
            if (!isAbsolutePath(path, 'win32') && !isAbsolutePath(path, 'linux')) continue
            const segments = path
              .replace(/\\/g, '/')
              .split('/')
              .filter((segment) => segment.length > 0)
            let start = 0
            if (segments.length > 0 && /^[A-Za-z]:$/.test(segments[0])) start = 1
            let relative
            for (let index = start; index < segments.length; index += 1) {
              const candidate = segments.slice(index).join('/')
              if (exists(candidate)) {
                relative = candidate
                break
              }
            }
            if (relative !== undefined && relative !== path) {
              file.path = relative
              changed = true
            }
          }
        }
      }

      if (event.type === 'working-directory/change') {
        const cwd = event.data?.cwd
        if (
          typeof cwd === 'string' &&
          cwd.length > 0 &&
          cwd !== sessionCwd &&
          (isAbsolutePath(cwd, 'win32') || isAbsolutePath(cwd, 'linux'))
        ) {
          event.data.cwd = sessionCwd
          changed = true
        }
      }

      if (event.type === 'tool/result' || event.type === 'tool/call') {
        const meta = event.data?.meta
        if (
          meta &&
          typeof meta.cwd === 'string' &&
          meta.cwd.length > 0 &&
          meta.cwd !== sessionCwd &&
          (isAbsolutePath(meta.cwd, 'win32') || isAbsolutePath(meta.cwd, 'linux'))
        ) {
          meta.cwd = sessionCwd
          changed = true
        }
      }

      return changed
    },
    input.chunkBytes ?? EVENT_FRAME_BYTES,
  )
}

/**
 * 读取会话首帧 header（repair 等诊断用途）。
 * @param {Buffer} buffer
 * @returns {Record<string, any>}
 */
export function readSessionHeaderFromBuffer(buffer) {
  return decodeSessionHeader(buffer).header
}

/**
 * 读取会话文件、改写 cwd、写入目标文件。
 * @param {string} sourcePath
 * @param {string} targetPath
 * @param {string} newCwd
 * @returns {Promise<{ bytesWritten: number, frames: number }>}
 */
export async function rewriteSessionCwdFile(sourcePath, targetPath, newCwd) {
  const buffer = await readFile(sourcePath)
  const rewritten = rewriteSessionCwd(buffer, newCwd)
  await writeFile(targetPath, rewritten)
  return { bytesWritten: rewritten.length, frames: scanFrames(rewritten).length }
}
