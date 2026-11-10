/**
 * ZIP 容器读取器（与 zip-writer 配对）。
 *
 * 安全校验：拒绝路径穿越（`..`）、绝对路径、反斜杠、Windows 盘符路径；
 * 拒绝截断、损坏的 local header、不支持的压缩方法、大小不符、CRC 不符。
 */

import { crc32, inflateRawSync } from 'node:zlib'

import { ERROR_CODES, MoverError } from './errors.js'

const LOCAL_FILE_HEADER = 0x04034b50
const CENTRAL_DIRECTORY_HEADER = 0x02014b50
const END_OF_CENTRAL_DIRECTORY = 0x06054b50

const MAX_ENTRIES = 100000
const MAX_ENTRY_BYTES = 1024 * 1024 * 1024

/**
 * @param {string} message
 * @param {Record<string, unknown>} [details]
 * @returns {MoverError}
 */
function packError(message, details = {}) {
  return new MoverError(ERROR_CODES.PACK_INVALID, message, details)
}

/**
 * 拒绝不安全或跨平台的条目名。
 * @param {string} name
 * @returns {void}
 */
export function assertSafeEntryName(name) {
  if (typeof name !== 'string' || name.length === 0) {
    throw packError('zip 条目名为空', { name })
  }
  if (name.startsWith('/')) {
    throw packError(`zip 条目名不能是绝对路径: ${name}`, { name, reason: 'absolute' })
  }
  if (name.includes('\\')) {
    throw packError(`zip 条目名不能包含反斜杠: ${name}`, { name, reason: 'backslash' })
  }
  if (/^[A-Za-z]:/.test(name)) {
    throw packError(`zip 条目名不能是盘符路径: ${name}`, { name, reason: 'drive' })
  }
  if (name.split('/').includes('..')) {
    throw packError(`zip 条目名不能包含 '..': ${name}`, { name, reason: 'traversal' })
  }
}

/**
 * @param {Buffer} buffer
 * @returns {number} EOCD 起始偏移
 */
function findEndOfCentralDirectory(buffer) {
  const minimum = Math.max(0, buffer.length - 22 - 0xffff)
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) return offset
  }
  throw packError('不是有效的 zip：缺少 End of Central Directory', { reason: 'no-eocd' })
}

/**
 * 读取 zip 并返回全部条目（内容已解压、已校验）。
 * @param {Buffer} buffer
 * @param {{ verifyChecksums?: boolean, maxEntryBytes?: number }} [options]
 * @returns {{ entries: Array<{ name: string, data: Buffer, size: number, method: number, mode: number }> }}
 */
export function readZip(buffer, options = {}) {
  if (!Buffer.isBuffer(buffer)) {
    throw packError('readZip 需要 Buffer 输入', { reason: 'not-buffer' })
  }
  const verifyChecksums = options.verifyChecksums !== false
  const maxEntryBytes = options.maxEntryBytes ?? MAX_ENTRY_BYTES

  const eocd = findEndOfCentralDirectory(buffer)
  if (eocd + 22 > buffer.length) {
    throw packError('zip 结构截断（EOCD 越界）', { reason: 'truncated-eocd' })
  }

  const entryCount = buffer.readUInt16LE(eocd + 10)
  const centralSize = buffer.readUInt32LE(eocd + 12)
  const centralOffset = buffer.readUInt32LE(eocd + 16)

  if (entryCount > MAX_ENTRIES) {
    throw packError(`zip 条目过多: ${entryCount}`, { reason: 'too-many-entries', entryCount })
  }
  if (centralOffset + centralSize > buffer.length) {
    throw packError('zip 结构截断（central directory 越界）', {
      reason: 'truncated-central',
      centralOffset,
      centralSize,
    })
  }

  const entries = []
  let p = centralOffset
  for (let index = 0; index < entryCount; index += 1) {
    if (p + 46 > buffer.length) {
      throw packError('zip 结构截断（central header 不完整）', { reason: 'truncated-entry' })
    }
    if (buffer.readUInt32LE(p) !== CENTRAL_DIRECTORY_HEADER) {
      throw packError('zip central directory 签名错误', { reason: 'bad-central-signature' })
    }

    const method = buffer.readUInt16LE(p + 10)
    const crc = buffer.readUInt32LE(p + 16)
    const compressedSize = buffer.readUInt32LE(p + 20)
    const uncompressedSize = buffer.readUInt32LE(p + 24)
    const nameLength = buffer.readUInt16LE(p + 28)
    const extraLength = buffer.readUInt16LE(p + 30)
    const commentLength = buffer.readUInt16LE(p + 32)
    const externalAttributes = buffer.readUInt32LE(p + 38)
    const localOffset = buffer.readUInt32LE(p + 42)

    if (p + 46 + nameLength > buffer.length) {
      throw packError('zip 结构截断（条目名不完整）', { reason: 'truncated-name' })
    }
    const name = buffer.subarray(p + 46, p + 46 + nameLength).toString('utf8')
    p += 46 + nameLength + extraLength + commentLength
    if (p > buffer.length) {
      throw packError('zip 结构截断（central directory 越界）', { reason: 'truncated-central-entry' })
    }

    assertSafeEntryName(name)

    if (uncompressedSize > maxEntryBytes) {
      throw packError(`条目过大: ${name}（${uncompressedSize} 字节）`, {
        name,
        reason: 'entry-too-large',
      })
    }
    if (localOffset + 30 > buffer.length) {
      throw packError(`local header 越界: ${name}`, { name, reason: 'truncated-local-header' })
    }
    if (buffer.readUInt32LE(localOffset) !== LOCAL_FILE_HEADER) {
      throw packError(`local header 签名错误: ${name}`, { name, reason: 'bad-local-signature' })
    }

    const localNameLength = buffer.readUInt16LE(localOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    if (dataStart + compressedSize > buffer.length) {
      throw packError(`条目数据截断: ${name}`, { name, reason: 'truncated-data' })
    }

    const compressed = buffer.subarray(dataStart, dataStart + compressedSize)
    let data
    if (method === 0) {
      data = compressed
    } else if (method === 8) {
      try {
        data = inflateRawSync(compressed)
      } catch (error) {
        throw packError(`条目解压失败: ${name}`, {
          name,
          reason: 'inflate-failed',
          cause: error instanceof Error ? error.message : String(error),
        })
      }
    } else {
      throw packError(`不支持的压缩方法 ${method}: ${name}`, { name, method })
    }

    if (data.length !== uncompressedSize) {
      throw packError(`条目大小不符: ${name}（声明 ${uncompressedSize}，实际 ${data.length}）`, {
        name,
        reason: 'size-mismatch',
      })
    }
    if (verifyChecksums) {
      const actual = crc32(data) >>> 0
      if (actual !== crc) {
        throw packError(`条目校验和不符: ${name}`, {
          name,
          reason: 'crc-mismatch',
          expected: crc,
          actual,
        })
      }
    }

    entries.push({
      name,
      data,
      size: data.length,
      method,
      mode: (externalAttributes >>> 16) & 0xffff,
    })
  }

  return { entries }
}

/**
 * 只列出条目元数据（不解压内容）。
 * @param {Buffer} buffer
 * @returns {Array<{ name: string, size: number, compressedSize: number, method: number }>}
 */
export function listZip(buffer) {
  return readZip(buffer, { verifyChecksums: false }).entries.map((entry) => ({
    name: entry.name,
    size: entry.size,
    compressedSize: entry.size,
    method: entry.method,
  }))
}
