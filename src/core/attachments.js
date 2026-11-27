/**
 * 附件解析与复制（T2.8）。
 *
 * 存储规则（已核实，@deepseek-ai/dsh-attachment-local）：
 * - 图片对象：`<attachmentsRoot>/objects/<digest前2>/<digest>`
 * - 文件对象：`<attachmentsRoot>/file-objects/<digest前2>/<digest>`
 * - 文件引用：`<attachmentsRoot>/files/<digest前2>/<digest>/<name>`（只读硬链接）
 * - id 形如 `sha256:<64 位小写十六进制>`
 *
 * 迁移包内保留同样的相对路径（`attachments/v1/...`），导入时按相对路径写回。
 */

import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import zlib from 'node:zlib'

import { ERROR_CODES, MoverError } from './errors.js'
import { scanFrames } from './zstd-frames.js'

/** 包内附件根（相对路径）。 */
export const PACK_ATTACHMENTS_ROOT = 'attachments/v1'

const SHA256_ID = /^sha256:([0-9a-f]{64})$/i

/**
 * @param {string} message
 * @param {Record<string, unknown>} [details]
 * @returns {MoverError}
 */
function attachmentError(message, details = {}) {
  return new MoverError(ERROR_CODES.PACK_INVALID, message, details)
}

/**
 * 解析 `sha256:<digest>` 形式的附件 id。
 * @param {string} id
 * @returns {{ digest: string }}
 */
export function parseAttachmentId(id) {
  if (typeof id !== 'string') {
    throw attachmentError('附件 id 必须是字符串', { id })
  }
  const match = SHA256_ID.exec(id)
  if (!match) {
    throw attachmentError(`不支持的附件 id: ${id}`, { id })
  }
  return { digest: match[1].toLowerCase() }
}

/**
 * 图片对象路径。
 * @param {string} attachmentsRoot `<DSH_HOME>/attachments/v1`
 * @param {string} id
 * @returns {string}
 */
export function imageObjectPath(attachmentsRoot, id) {
  const { digest } = parseAttachmentId(id)
  return join(attachmentsRoot, 'objects', digest.slice(0, 2), digest)
}

/**
 * 文件对象路径。
 * @param {string} attachmentsRoot
 * @param {string} id
 * @returns {string}
 */
export function fileObjectPath(attachmentsRoot, id) {
  const { digest } = parseAttachmentId(id)
  return join(attachmentsRoot, 'file-objects', digest.slice(0, 2), digest)
}

/**
 * 文件引用路径。
 * @param {string} attachmentsRoot
 * @param {string} id
 * @param {string} name
 * @returns {string}
 */
export function fileReferencePath(attachmentsRoot, id, name) {
  const { digest } = parseAttachmentId(id)
  return join(attachmentsRoot, 'files', digest.slice(0, 2), digest, name)
}

/**
 * 包内相对路径（用于 zip 条目）。
 * @param {'image'|'file-object'|'file-reference'} kind
 * @param {string} id
 * @param {string} [name]
 * @returns {string}
 */
export function packAttachmentPath(kind, id, name) {
  const { digest } = parseAttachmentId(id)
  if (kind === 'image') return `${PACK_ATTACHMENTS_ROOT}/objects/${digest.slice(0, 2)}/${digest}`
  if (kind === 'file-object') {
    return `${PACK_ATTACHMENTS_ROOT}/file-objects/${digest.slice(0, 2)}/${digest}`
  }
  if (kind === 'file-reference') {
    if (typeof name !== 'string' || name.length === 0) {
      throw attachmentError('文件引用缺少 name', { id })
    }
    return `${PACK_ATTACHMENTS_ROOT}/files/${digest.slice(0, 2)}/${digest}/${name}`
  }
  throw attachmentError(`未知附件类型: ${String(kind)}`)
}

/**
 * 解码会话日志的全部事件（多帧拼接后按行解析）。
 * @param {Buffer} buffer
 * @returns {object[]}
 */
export function decodeSessionEvents(buffer) {
  const frames = scanFrames(buffer)
  const parts = frames.map((frame) =>
    zlib.zstdDecompressSync(buffer.subarray(frame.start, frame.end)),
  )
  const text = Buffer.concat(parts).toString('utf8')
  return text
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line))
}

/**
 * 从一个会话日志中提取附件引用（去重）。
 * @param {Buffer} buffer
 * @returns {Array<{ attachmentId: string, kind: 'image'|'file', name?: string, bytes?: number }>}
 */
export function extractAttachmentRefs(buffer) {
  const refs = new Map()

  /** @param {unknown} value */
  const visit = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (value === null || typeof value !== 'object') return

    const record = /** @type {Record<string, unknown>} */ (value)
    const attachment = record.attachment
    if (attachment !== null && typeof attachment === 'object') {
      const ref = /** @type {Record<string, unknown>} */ (attachment)
      if (typeof ref.attachmentId === 'string') {
        const kind = typeof ref.mediaType === 'string' ? 'image' : 'file'
        const existing = refs.get(ref.attachmentId)
        refs.set(ref.attachmentId, {
          attachmentId: ref.attachmentId,
          kind,
          ...(typeof ref.name === 'string' ? { name: ref.name } : {}),
          ...(typeof ref.bytes === 'number' ? { bytes: ref.bytes } : {}),
          ...existing,
        })
      }
    }
    for (const child of Object.values(record)) visit(child)
  }

  for (const event of decodeSessionEvents(buffer)) visit(event)
  return [...refs.values()]
}

/**
 * 把包内附件写回本机存储。
 * @param {{
 *   entries: Array<{ packPath: string, data: Buffer }>,
 *   attachmentsRoot: string
 * }} input
 * @returns {Promise<{ restored: number, warnings: string[] }>}
 */
export async function restoreAttachments(input) {
  const { entries, attachmentsRoot } = input
  let restored = 0
  const warnings = []

  for (const entry of entries) {
    if (!entry.packPath.startsWith(`${PACK_ATTACHMENTS_ROOT}/`)) {
      warnings.push(`跳过非附件条目: ${entry.packPath}`)
      continue
    }
    const relative = entry.packPath.slice(`${PACK_ATTACHMENTS_ROOT}/`.length)
    const target = join(attachmentsRoot, relative)
    try {
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, entry.data)
      restored += 1
    } catch (error) {
      warnings.push(
        `附件写入失败: ${entry.packPath}（${
          error instanceof Error ? error.message : String(error)
        }）`,
      )
    }
  }

  return { restored, warnings }
}
