/**
 * 最小 ZIP 容器写入器（不新增依赖）。
 *
 * 用于 `.dshpack`：标准 zip，普通解压工具可直接打开（SPEC §8）。
 * 限制：单条目与总大小 < 4 GiB、条目数 < 65535（ZIP64 不在首版范围）。
 */

import { crc32, deflateRawSync } from 'node:zlib'

const LOCAL_FILE_HEADER = 0x04034b50
const CENTRAL_DIRECTORY_HEADER = 0x02014b50
const END_OF_CENTRAL_DIRECTORY = 0x06054b50
const VERSION_NEEDED = 20
/** UNIX made-by（高字节 3 = UNIX，低字节 30 = 3.0）。 */
const VERSION_MADE_BY = 0x031e
const FLAG_UTF8 = 0x0800
const METHOD_STORE = 0
const METHOD_DEFLATE = 8
const COMPRESS_THRESHOLD = 64

const ZIP64_BYTES = 0xffffffff
const ZIP_LIMIT_ENTRIES = 0xffff

let crcTable

/**
 * CRC32 兜底实现（内置 `zlib.crc32` 不可用时使用）。
 * @param {Buffer} buffer
 * @returns {number}
 */
function crc32Fallback(buffer) {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n += 1) {
      let c = n
      for (let k = 0; k < 8; k += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      }
      crcTable[n] = c >>> 0
    }
  }
  let c = 0xffffffff
  for (let i = 0; i < buffer.length; i += 1) {
    c = crcTable[(c ^ buffer[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

/**
 * @param {Buffer} buffer
 * @returns {number}
 */
function crc32Of(buffer) {
  return typeof crc32 === 'function' ? crc32(buffer) >>> 0 : crc32Fallback(buffer)
}

/**
 * @param {Date} date
 * @returns {{ time: number, date: number }} MS-DOS 时间/日期
 */
function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear())
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { time, date: day }
}

/**
 * @param {string} name
 * @returns {void}
 */
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
 * 生成 zip 字节。
 * @param {Array<{ name: string, data?: Buffer, isDir?: boolean, mode?: number, mtime?: Date }>} entries
 * @returns {Buffer}
 */
export function createZip(entries) {
  if (!Array.isArray(entries)) throw new TypeError('entries must be an array')
  if (entries.length > ZIP_LIMIT_ENTRIES) {
    throw new RangeError(`too many zip entries: ${entries.length}`)
  }

  /** @type {Buffer[]} */
  const chunks = []
  /** @type {Array<{ nameBuf: Buffer, crc: number, method: number, csize: number, usize: number, offset: number, mode: number }>} */
  const central = []
  let offset = 0

  for (const entry of entries) {
    assertEntryName(entry.name)
    const isDir = entry.isDir === true || entry.name.endsWith('/')
    const name = isDir && !entry.name.endsWith('/') ? `${entry.name}/` : entry.name
    const nameBuf = Buffer.from(name, 'utf8')
    const raw = isDir ? Buffer.alloc(0) : (entry.data ?? Buffer.alloc(0))
    if (!Buffer.isBuffer(raw)) throw new TypeError(`entry data must be a Buffer: ${name}`)

    const crc = crc32Of(raw)
    let method = METHOD_STORE
    let payload = raw
    if (!isDir && raw.length >= COMPRESS_THRESHOLD) {
      const deflated = deflateRawSync(raw)
      if (deflated.length < raw.length) {
        method = METHOD_DEFLATE
        payload = deflated
      }
    }

    const { time, date } = dosDateTime(entry.mtime instanceof Date ? entry.mtime : new Date())
    const local = Buffer.alloc(30)
    local.writeUInt32LE(LOCAL_FILE_HEADER, 0)
    local.writeUInt16LE(VERSION_NEEDED, 4)
    local.writeUInt16LE(FLAG_UTF8, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(payload.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)

    if (payload.length >= ZIP64_BYTES || raw.length >= ZIP64_BYTES) {
      throw new RangeError(`entry too large for ZIP32: ${name}`)
    }

    chunks.push(local, nameBuf, payload)

    const mode = entry.mode ?? (isDir ? 0o040755 : 0o100644)
    central.push({
      nameBuf,
      crc,
      method,
      csize: payload.length,
      usize: raw.length,
      offset,
      mode,
    })
    offset += local.length + nameBuf.length + payload.length
  }

  const centralStart = offset
  for (const item of central) {
    const header = Buffer.alloc(46)
    header.writeUInt32LE(CENTRAL_DIRECTORY_HEADER, 0)
    header.writeUInt16LE(VERSION_MADE_BY, 4)
    header.writeUInt16LE(VERSION_NEEDED, 6)
    header.writeUInt16LE(FLAG_UTF8, 8)
    header.writeUInt16LE(item.method, 10)
    header.writeUInt16LE(0, 12) // time（延续 local header 的简化值）
    header.writeUInt16LE(0, 14) // date
    header.writeUInt32LE(item.crc, 16)
    header.writeUInt32LE(item.csize, 20)
    header.writeUInt32LE(item.usize, 24)
    header.writeUInt16LE(item.nameBuf.length, 28)
    header.writeUInt16LE(0, 30) // extra
    header.writeUInt16LE(0, 32) // comment
    header.writeUInt16LE(0, 34) // disk start
    header.writeUInt16LE(0, 36) // internal attributes
    header.writeUInt32LE((item.mode << 16) >>> 0, 38) // external attributes
    header.writeUInt32LE(item.offset, 42)
    chunks.push(header, item.nameBuf)
    offset += header.length + item.nameBuf.length
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
  chunks.push(eocd)

  return Buffer.concat(chunks)
}
