/**
 * 最小 ustar 解析器（零依赖，Node 内置 zlib）。
 *
 * 用途：把 npm tarball（.tgz = gzip + ustar）解析为条目列表，
 * 供 freeze-baseline / check-upstream 计算文件哈希。
 *
 * 支持：
 * - 普通文件（typeflag '0' / '\0'）、目录（'5'）
 * - pax 扩展头（typeflag 'x' / 'g'）：长文件名（path）、大文件（size）
 * - GNU 扩展头（typeflag 'L' longname / 'K' longlink）
 * - 八进制与 base-256 数字字段（防御性）
 *
 * 注意：只做读取与解析，不落盘、不执行任何子进程。
 */

import zlib from 'node:zlib'

const BLOCK = 512

/**
 * 解析 tar 数字字段（八进制为主，兼容 base-256）。
 * @param {Buffer} buf 512 字节头块
 * @param {number} offset 字段起始偏移
 * @param {number} len 字段长度
 * @returns {number}
 */
function parseNumberField(buf, offset, len) {
  const raw = buf.toString('latin1', offset, offset + len).replace(/\0.*$/, '').trim()
  if (raw === '') return 0
  const first = raw.charCodeAt(0)
  if ((first & 0x80) !== 0) {
    // base-256（GNU 扩展，大文件用）；此处防御性支持
    let value = first & 0x7f
    for (let i = 1; i < raw.length; i += 1) value = value * 256 + raw.charCodeAt(i)
    return value
  }
  const parsed = parseInt(raw, 8)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * 解析 tar 字符串字段（去尾部 NUL）。
 * @param {Buffer} buf
 * @param {number} offset
 * @param {number} len
 * @returns {string}
 */
function stringField(buf, offset, len) {
  return buf.toString('utf8', offset, offset + len).replace(/\0.*$/, '')
}

/**
 * 解析 ustar 缓冲区为条目列表。
 * @param {Buffer} buffer 完整 tar 内容
 * @returns {Array<{ name: string, typeflag: string, size: number, start: number, end: number }>}
 *   start/end 是文件数据在 buffer 中的字节区间（含 start，不含 end）。
 */
export function parseTarEntries(buffer) {
  if (!Buffer.isBuffer(buffer)) throw new Error('parseTarEntries: 需要 Buffer 输入')
  const entries = []
  let offset = 0
  /** @type {Record<string, string> | null} pax/GNU 覆盖（作用于下一个普通条目） */
  let pending = null

  while (offset + BLOCK <= buffer.length) {
    const block = buffer.subarray(offset, offset + BLOCK)
    if (block.every((byte) => byte === 0)) break // 双零块：归档结束

    const name = stringField(block, 0, 100)
    const size = parseNumberField(block, 124, 12)
    const typeflag = String.fromCharCode(block[156] ?? 0)
    const prefix = stringField(block, 345, 155)

    const dataStart = offset + BLOCK
    if (dataStart + size > buffer.length) {
      throw new Error(`tar: 条目 '${name}' 数据超出缓冲区`)
    }
    const paddedEnd = dataStart + Math.ceil(size / BLOCK) * BLOCK

    // pax 扩展头：记录 "len key=value\n" 到 pending
    if (typeflag === 'x' || typeflag === 'g') {
      const text = buffer.toString('utf8', dataStart, dataStart + size)
      pending ??= {}
      for (const line of text.split('\n')) {
        if (line.length === 0) continue
        const space = line.indexOf(' ')
        if (space <= 0) continue
        const declaredLen = Number.parseInt(line.slice(0, space), 10)
        if (!Number.isFinite(declaredLen)) continue
        const record = line.slice(space + 1)
        const eq = record.indexOf('=')
        if (eq > 0) pending[record.slice(0, eq)] = record.slice(eq + 1)
      }
      offset = paddedEnd
      continue
    }

    // GNU longname / longlink：值作用于下一个条目
    if (typeflag === 'L' || typeflag === 'K') {
      const long = buffer.toString('utf8', dataStart, dataStart + size).replace(/\0.*$/, '')
      pending ??= {}
      pending[typeflag === 'L' ? 'path' : 'linkpath'] = long
      offset = paddedEnd
      continue
    }

    let resolvedName = prefix ? `${prefix}/${name}` : name
    let resolvedSize = size
    if (pending) {
      if (typeof pending.path === 'string' && pending.path.length > 0) resolvedName = pending.path
      if (typeof pending.size === 'string' && pending.size.length > 0) {
        const paxSize = Number.parseInt(pending.size, 10)
        if (Number.isFinite(paxSize) && paxSize >= 0 && paxSize <= size) resolvedSize = paxSize
      }
    }

    entries.push({
      name: resolvedName,
      typeflag,
      size: resolvedSize,
      start: dataStart,
      end: dataStart + resolvedSize,
    })
    pending = null
    offset = paddedEnd
  }

  return entries
}

/**
 * 解压并解析 .tgz（npm tarball）。
 * @param {Buffer} tgzBuffer
 * @returns {Array<{ name: string, typeflag: string, size: number, start: number, end: number }>}
 */
export function parseTarGz(tgzBuffer) {
  return parseTarEntries(zlib.gunzipSync(tgzBuffer))
}
