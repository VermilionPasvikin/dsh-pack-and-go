/**
 * Zstandard 帧扫描（ADR-0007 方案 A 的基础）。
 *
 * DSH 的会话日志是「多个独立 zstd 帧首尾拼接」：Node 的 zstdDecompressSync
 * 一次只解第一帧，所以必须先扫描出每帧的字节边界。
 *
 * 只做结构解析，不解压；块类型 3（Reserved）与截断一律报错。
 */

import { ERROR_CODES, MoverError } from './errors.js'

/** zstd 帧起始标记（LE 字节序 28 B5 2F FD）。 */
export const ZSTD_FRAME_MAGIC = 0xfd2fb528

const DICT_ID_SIZES = [0, 1, 2, 4]

/**
 * @param {string} message
 * @param {Record<string, unknown>} [details]
 * @returns {MoverError}
 */
function frameError(message, details = {}) {
  return new MoverError(ERROR_CODES.SESSION_FRAME_INVALID, message, details)
}

/**
 * 读取一帧的字节长度，并解析是否带 checksum。
 * @param {Buffer} buffer
 * @param {number} offset 帧起始偏移
 * @returns {{ length: number, checksum: boolean }}
 */
function readFrameLength(buffer, offset) {
  if (offset + 4 > buffer.length) {
    throw frameError('zstd 帧头不完整（magic 缺失）', { offset, reason: 'truncated-magic' })
  }
  if (buffer.readUInt32LE(offset) !== ZSTD_FRAME_MAGIC) {
    throw frameError(`zstd 帧起始标记不匹配（offset=${offset}）`, {
      offset,
      reason: 'bad-magic',
    })
  }

  let p = offset + 4
  if (p >= buffer.length) {
    throw frameError('zstd 帧头不完整（缺少 Frame_Header_Descriptor）', {
      offset,
      reason: 'truncated-descriptor',
    })
  }
  const descriptor = buffer[p]
  p += 1
  const fcsFlag = descriptor >> 6
  const singleSegment = (descriptor >> 5) & 1
  const checksumFlag = (descriptor >> 2) & 1
  const dictFlag = descriptor & 3

  if (!singleSegment) {
    if (p >= buffer.length) {
      throw frameError('zstd 帧头不完整（缺少 Window_Descriptor）', {
        offset,
        reason: 'truncated-window',
      })
    }
    p += 1
  }

  const dictSize = DICT_ID_SIZES[dictFlag]
  const fcsSize =
    fcsFlag === 0
      ? singleSegment
        ? 1
        : 0
      : fcsFlag === 1
        ? 2
        : fcsFlag === 2
          ? 4
          : 8
  p += dictSize + fcsSize
  if (p > buffer.length) {
    throw frameError('zstd 帧头不完整（Dictionary_ID / Content_Size 越界）', {
      offset,
      reason: 'truncated-header-fields',
    })
  }

  for (;;) {
    if (p + 3 > buffer.length) {
      throw frameError('zstd 块头不完整', { offset, reason: 'truncated-block-header' })
    }
    const blockHeader = buffer[p] | (buffer[p + 1] << 8) | (buffer[p + 2] << 16)
    p += 3
    const lastBlock = blockHeader & 1
    const blockType = (blockHeader >> 1) & 3
    const blockSize = blockHeader >>> 3

    if (blockType === 3) {
      throw frameError('zstd 保留块类型（数据损坏）', { offset, reason: 'reserved-block-type' })
    }
    if (blockType === 1) {
      // RLE：块体只占 1 字节
      if (p + 1 > buffer.length) {
        throw frameError('zstd RLE 块不完整', { offset, reason: 'truncated-rle' })
      }
      p += 1
    } else {
      if (p + blockSize > buffer.length) {
        throw frameError('zstd 块数据不完整', {
          offset,
          reason: 'truncated-block-body',
          blockSize,
        })
      }
      p += blockSize
    }

    if (lastBlock) break
  }

  if (checksumFlag) {
    if (p + 4 > buffer.length) {
      throw frameError('zstd 内容校验和不完整', { offset, reason: 'truncated-checksum' })
    }
    p += 4
  }

  return { length: p - offset, checksum: checksumFlag === 1 }
}

/**
 * 扫描拼接帧缓冲，返回每帧起止偏移。
 * @param {Buffer} buffer 整个日志文件内容
 * @returns {ReadonlyArray<{ start: number, end: number, length: number, checksum: boolean }>}
 * @throws {MoverError} `E_SESSION_FRAME_INVALID`：结构损坏或截断
 */
export function scanFrames(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw frameError('scanFrames 需要 Buffer 输入', { reason: 'not-buffer' })
  }
  if (buffer.length === 0) return []

  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const { length, checksum } = readFrameLength(buffer, offset)
    if (length <= 0) {
      throw frameError('zstd 帧长度异常', { offset, reason: 'invalid-length' })
    }
    frames.push(Object.freeze({ start: offset, end: offset + length, length, checksum }))
    offset += length
  }
  return frames
}

/**
 * 读取指定帧是否带内容校验和（T1.6 重压首帧时保持与原文件一致）。
 * @param {Buffer} buffer
 * @param {{ start: number }} frame
 * @returns {boolean}
 */
export function frameChecksumFlag(buffer, frame) {
  if (!Buffer.isBuffer(buffer) || !frame || frame.start + 5 > buffer.length) {
    throw frameError('无法读取帧的 checksum 标志', { reason: 'invalid-frame' })
  }
  return ((buffer[frame.start + 4] >> 2) & 1) === 1
}
