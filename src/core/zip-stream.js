/**
 * 流式 ZIP 写入器（替代内存版，用于大工作区）。
 *
 * - 逐文件流式读、流式 deflate、流式写盘，内存与文件大小无关；
 * - local header 使用 data descriptor（flag bit 3），数据后再写 CRC/大小；
 * - central directory 在末尾写入真实值。
 *
 * 兼容性：本仓库 `readZip` 使用 central directory，可直接读取本写入器的输出；
 * 标准解压工具同样支持 data descriptor。
 */

import { createReadStream, createWriteStream } from 'node:fs'
import { once } from 'node:events'
import { rm, stat } from 'node:fs/promises'
import { Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createDeflateRaw, deflateRawSync } from 'node:zlib'

const LOCAL_FILE_HEADER = 0x04034b50
const CENTRAL_DIRECTORY_HEADER = 0x02014b50
const END_OF_CENTRAL_DIRECTORY = 0x06054b50
const DATA_DESCRIPTOR = 0x08074b50
const VERSION_NEEDED = 20
const VERSION_MADE_BY = 0x031e
const FLAG_UTF8 = 0x0800
const FLAG_DATA_DESCRIPTOR = 0x0008
const METHOD_STORE = 0
const METHOD_DEFLATE = 8

const STREAM_CHUNK = 1024 * 1024

let crcTable

function ensureCrcTable() {
  if (crcTable) return crcTable
  crcTable = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    crcTable[n] = c >>> 0
  }
  return crcTable
}

/** @returns {number} 增量 CRC 初始状态 */
export function crc32Init() {
  return 0xffffffff
}

/**
 * 增量更新 CRC。
 * @param {number} state
 * @param {Buffer} chunk
 * @returns {number}
 */
export function crc32Update(state, chunk) {
  const table = ensureCrcTable()
  let c = state
  for (let i = 0; i < chunk.length; i += 1) {
    c = table[(c ^ chunk[i]) & 0xff] ^ (c >>> 8)
  }
  return c >>> 0
}

/**
 * 增量 CRC 收尾。
 * @param {number} state
 * @returns {number}
 */
export function crc32Final(state) {
  return (state ^ 0xffffffff) >>> 0
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear())
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { time, date: day }
}

function assertEntryName(name) {
  if (typeof name !== 'string' || name.length === 0) {
    throw new TypeError('zip entry name must be a non-empty string')
  }
  if (name.startsWith('/') || name.includes('\\')) {
    throw new TypeError(`zip entry name must use forward slashes: ${name}`)
  }
  if (name.split('/').includes('..')) {
    throw new TypeError(`zip entry name must not contain '..': ${name}`)
  }
}

/**
 * 流式写入 zip。
 * @param {{
 *   entries: Array<{ name: string, sourcePath?: string, data?: Buffer, isDir?: boolean, mode?: number, mtime?: Date }>,
 *   outputPath: string,
 *   compress?: boolean
 * }} input
 * @returns {Promise<{ bytes: number, entries: number }>}
 */
export async function writeZipStream(input) {
  const { entries, outputPath, compress = true } = input
  if (!Array.isArray(entries)) throw new TypeError('entries must be an array')
  if (typeof outputPath !== 'string' || outputPath.length === 0) {
    throw new TypeError('outputPath is required')
  }
  // 先校验全部条目名，避免创建输出流后失败留下半成品文件
  for (const entry of entries) assertEntryName(entry.name)

  const output = createWriteStream(outputPath)
  let offset = 0
  const central = []

  const write = async (buffer) => {
    if (!output.write(buffer)) await once(output, 'drain')
    offset += buffer.length
  }

  try {
    for (const entry of entries) {
      assertEntryName(entry.name)
      const isDir = entry.isDir === true || entry.name.endsWith('/')
      const name = isDir && !entry.name.endsWith('/') ? `${entry.name}/` : entry.name
      const nameBuf = Buffer.from(name, 'utf8')
      const { time, date } = dosDateTime(entry.mtime instanceof Date ? entry.mtime : new Date())
      const localOffset = offset

      let method = METHOD_STORE
      let crc = 0
      let usize = 0
      let csize = 0
      let flags = FLAG_UTF8

      if (isDir) {
        await write(localHeader(nameBuf, METHOD_STORE, flags, time, date, 0, 0, 0))
      } else if (entry.data !== undefined) {
        const payload = entry.data
        let compressed = payload
        if (compress && payload.length >= 64) {
          const deflated = deflateRawSync(payload)
          if (deflated.length < payload.length) {
            method = METHOD_DEFLATE
            compressed = deflated
          }
        }
        crc = crc32Final(crc32Update(crc32Init(), payload))
        usize = payload.length
        csize = compressed.length
        await write(localHeader(nameBuf, method, flags, time, date, crc, csize, usize))
        await write(compressed)
      } else if (entry.sourcePath) {
        const info = await stat(entry.sourcePath)
        if (!info.isFile()) throw new TypeError(`not a file: ${entry.sourcePath}`)
        method = compress && info.size >= 64 ? METHOD_DEFLATE : METHOD_STORE
        flags = FLAG_UTF8 | FLAG_DATA_DESCRIPTOR
        await write(localHeader(nameBuf, method, flags, time, date, 0, 0, 0))

        let state = crc32Init()
        if (method === METHOD_DEFLATE) {
          const deflater = createDeflateRaw()
          // sink 负责把压缩数据写入 output 并处理背压；pipeline 完成即数据全部落盘，
          // 避免 pipe + pipeline 混用导致 output.end() 后仍有迟到写入。
          const sink = new Writable({
            write(chunk, encoding, callback) {
              csize += chunk.length
              if (output.write(chunk)) callback()
              else output.once('drain', () => callback())
            },
          })
          const reader = createReadStream(entry.sourcePath, { highWaterMark: STREAM_CHUNK })
          reader.on('data', (chunk) => {
            state = crc32Update(state, chunk)
            usize += chunk.length
          })
          await pipeline(reader, deflater, sink)
          offset += csize
        } else {
          const reader = createReadStream(entry.sourcePath, { highWaterMark: STREAM_CHUNK })
          for await (const chunk of reader) {
            state = crc32Update(state, chunk)
            usize += chunk.length
            await write(chunk)
            csize += chunk.length
          }
        }
        crc = crc32Final(state)
        await write(dataDescriptor(crc, csize, usize))
      } else {
        await write(localHeader(nameBuf, METHOD_STORE, flags, time, date, 0, 0, 0))
      }

      central.push({
        nameBuf,
        method,
        flags,
        time,
        date,
        crc,
        csize,
        usize,
        localOffset,
        mode: entry.mode ?? (isDir ? 0o040755 : 0o100644),
      })
    }

    const centralStart = offset
    for (const item of central) {
      await write(
        centralHeader(
          item.nameBuf,
          item.method,
          item.flags,
          item.time,
          item.date,
          item.crc,
          item.csize,
          item.usize,
          item.localOffset,
          item.mode,
        ),
      )
    }
    const centralSize = offset - centralStart

    const eocd = Buffer.alloc(22)
    eocd.writeUInt32LE(END_OF_CENTRAL_DIRECTORY, 0)
    eocd.writeUInt16LE(0, 4)
    eocd.writeUInt16LE(0, 6)
    eocd.writeUInt16LE(central.length, 8)
    eocd.writeUInt16LE(central.length, 10)
    eocd.writeUInt32LE(centralSize, 12)
    eocd.writeUInt32LE(centralStart, 16)
    eocd.writeUInt16LE(0, 20)
    await write(eocd)

    output.end()
    await once(output, 'finish')
    return { bytes: offset, entries: central.length }
  } catch (error) {
    output.destroy()
    // 失败时清理半成品文件，避免下一次导出出现“两个包”
    try {
      await rm(outputPath, { force: true })
    } catch {
      // 清理失败不覆盖原始错误
    }
    throw error
  }
}

function localHeader(nameBuf, method, flags, time, date, crc, csize, usize) {
  const header = Buffer.alloc(30)
  header.writeUInt32LE(LOCAL_FILE_HEADER, 0)
  header.writeUInt16LE(VERSION_NEEDED, 4)
  header.writeUInt16LE(flags, 6)
  header.writeUInt16LE(method, 8)
  header.writeUInt16LE(time, 10)
  header.writeUInt16LE(date, 12)
  header.writeUInt32LE(crc, 14)
  header.writeUInt32LE(csize, 18)
  header.writeUInt32LE(usize, 22)
  header.writeUInt16LE(nameBuf.length, 26)
  header.writeUInt16LE(0, 28)
  return Buffer.concat([header, nameBuf])
}

function centralHeader(nameBuf, method, flags, time, date, crc, csize, usize, localOffset, mode) {
  const header = Buffer.alloc(46)
  header.writeUInt32LE(CENTRAL_DIRECTORY_HEADER, 0)
  header.writeUInt16LE(VERSION_MADE_BY, 4)
  header.writeUInt16LE(VERSION_NEEDED, 6)
  header.writeUInt16LE(flags, 8)
  header.writeUInt16LE(method, 10)
  header.writeUInt16LE(time, 12)
  header.writeUInt16LE(date, 14)
  header.writeUInt32LE(crc, 16)
  header.writeUInt32LE(csize, 20)
  header.writeUInt32LE(usize, 24)
  header.writeUInt16LE(nameBuf.length, 28)
  header.writeUInt16LE(0, 30)
  header.writeUInt16LE(0, 32)
  header.writeUInt16LE(0, 34)
  header.writeUInt16LE(0, 36)
  header.writeUInt32LE((mode << 16) >>> 0, 38)
  header.writeUInt32LE(localOffset, 42)
  return Buffer.concat([header, nameBuf])
}

function dataDescriptor(crc, csize, usize) {
  const buffer = Buffer.alloc(16)
  buffer.writeUInt32LE(DATA_DESCRIPTOR, 0)
  buffer.writeUInt32LE(crc, 4)
  buffer.writeUInt32LE(csize, 8)
  buffer.writeUInt32LE(usize, 12)
  return buffer
}
