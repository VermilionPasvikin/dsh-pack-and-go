/**
 * 会话头 cwd 改写（ADR-0007 方案 A）。
 *
 * 只解压第一帧（header 行），改 cwd 后重新压缩；其余帧字节原样拼接，
 * 因此事件数据零改动。
 */

import { readFile, writeFile } from 'node:fs/promises'
import zlib from 'node:zlib'

import { SESSION_FORMAT_VERSION } from './constants.js'
import { ERROR_CODES, MoverError } from './errors.js'
import { scanFrames } from './zstd-frames.js'

/**
 * @param {string} message
 * @param {Record<string, unknown>} [details]
 * @returns {MoverError}
 */
function headerError(message, details = {}) {
  return new MoverError(ERROR_CODES.SESSION_HEADER_INVALID, message, details)
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
  if (header.version !== SESSION_FORMAT_VERSION) {
    throw new MoverError(
      ERROR_CODES.SESSION_VERSION_UNSUPPORTED,
      `会话格式版本 ${String(header.version)} 不是当前版本 ${SESSION_FORMAT_VERSION}；跨版本导入应走服务重建（ADR-0007 方案 C）`,
      { version: header.version, expected: SESSION_FORMAT_VERSION },
    )
  }

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
