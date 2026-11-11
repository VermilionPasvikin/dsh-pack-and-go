/**
 * 导出打包：把导出计划 + 源文件读入，生成 `.dshpack` 字节（T2.5）。
 *
 * 首版为内存实现：单文件与总大小受内存限制（默认 256 MiB/文件）。
 * 大工作区的流式写包在性能任务（T5.3 前）优化，见 DEVLOG。
 */

import { readFile, stat } from 'node:fs/promises'

import { SCHEMA_VERSION, SESSION_FORMAT_VERSION } from './constants.js'
import { ERROR_CODES, MoverError } from './errors.js'
import { validateManifest } from './manifest.js'
import { serializeManifest } from './manifest-io.js'
import { createZip } from './zip-writer.js'
import { writeZipStream } from './zip-stream.js'

/** 默认单文件上限（内存实现约束）。 */
export const DEFAULT_MAX_FILE_BYTES = 256 * 1024 * 1024

/**
 * @param {string} message
 * @param {Record<string, unknown>} [details]
 * @returns {MoverError}
 */
function exportError(message, details = {}) {
  return new MoverError(ERROR_CODES.PACK_INVALID, message, details)
}

/**
 * 构造 manifest（校验后返回）。
 * @param {{
 *   platform: string,
 *   dshVersion: string,
 *   sessionFormat?: number,
 *   mode: string,
 *   sessions?: Array<object>,
 *   attachments?: Array<object>,
 *   workspaces?: Array<object>,
 *   createdAt?: Date,
 *   machineName?: string,
 *   dshHome?: string
 * }} input
 * @returns {object}
 */
export function buildManifest(input) {
  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    createdAt: (input.createdAt ?? new Date()).toISOString(),
    source: {
      platform: input.platform,
      dshVersion: input.dshVersion,
      sessionFormat: input.sessionFormat ?? SESSION_FORMAT_VERSION,
      ...(input.dshHome !== undefined ? { dshHome: input.dshHome } : {}),
      ...(input.machineName !== undefined ? { machineName: input.machineName } : {}),
    },
    mode: input.mode,
    sessions: input.sessions ?? [],
    attachments: input.attachments ?? [],
    workspaces: input.workspaces ?? [],
  }
  validateManifest(manifest)
  return manifest
}

/**
 * 生成包字节。
 * @param {{
 *   plan: { items: Array<{ kind: string, path: string, size: number }> },
 *   sourcePaths: Record<string, string>,
 *   manifest: object,
 *   readme?: string,
 *   extraEntries?: Array<{ name: string, data?: Buffer, isDir?: boolean, mode?: number }>,
 *   maxFileBytes?: number
 * }} input
 * @returns {Promise<Buffer>}
 */
export async function buildPack(input) {
  const {
    plan,
    sourcePaths,
    manifest,
    readme = 'dsh-pack-and-go 迁移包\n',
    extraEntries = [],
    maxFileBytes = DEFAULT_MAX_FILE_BYTES,
  } = input

  if (plan === null || typeof plan !== 'object' || !Array.isArray(plan.items)) {
    throw exportError('缺少导出计划 plan.items')
  }
  if (sourcePaths === null || typeof sourcePaths !== 'object') {
    throw exportError('缺少源文件映射 sourcePaths')
  }

  const entries = [
    { name: 'manifest.json', data: Buffer.from(serializeManifest(manifest), 'utf8') },
    { name: 'README.txt', data: Buffer.from(readme, 'utf8') },
  ]

  for (const item of plan.items) {
    const source = sourcePaths[item.path]
    if (typeof source !== 'string' || source.length === 0) {
      throw exportError(`缺少源文件: ${item.path}`, { path: item.path })
    }
    let info
    try {
      info = await stat(source)
    } catch (error) {
      throw exportError(`无法读取源文件: ${source}`, {
        path: item.path,
        cause: error instanceof Error ? error.message : String(error),
      })
    }
    if (!info.isFile()) {
      throw exportError(`源路径不是文件: ${source}`, { path: item.path })
    }
    if (info.size > maxFileBytes) {
      throw exportError(
        `文件超过单文件上限（${info.size} > ${maxFileBytes}）: ${item.path}`,
        { path: item.path, size: info.size, maxFileBytes },
      )
    }
    const data = await readFile(source)
    entries.push({ name: item.path, data, mode: info.mode, mtime: info.mtime })
  }

  for (const extra of extraEntries) {
    entries.push(extra)
  }

  return createZip(entries)
}

/**
 * 流式生成包到文件（大工作区用；内存与文件大小无关）。
 * @param {{
 *   plan: { items: Array<{ kind: string, path: string, size: number }> },
 *   sourcePaths: Record<string, string>,
 *   manifest: object,
 *   outputPath: string,
 *   readme?: string,
 *   extraEntries?: Array<{ name: string, data?: Buffer, isDir?: boolean, mode?: number }>
 * }} input
 * @returns {Promise<{ bytes: number, entries: number }>}
 */
export async function buildPackToFile(input) {
  const {
    plan,
    sourcePaths,
    manifest,
    outputPath,
    readme = 'dsh-pack-and-go 迁移包\n',
    extraEntries = [],
    compress = true,
  } = input

  if (plan === null || typeof plan !== 'object' || !Array.isArray(plan.items)) {
    throw exportError('缺少导出计划 plan.items')
  }
  if (typeof outputPath !== 'string' || outputPath.length === 0) {
    throw exportError('缺少 outputPath')
  }

  const entries = [
    { name: 'manifest.json', data: Buffer.from(serializeManifest(manifest), 'utf8') },
    { name: 'README.txt', data: Buffer.from(readme, 'utf8') },
  ]

  for (const item of plan.items) {
    const source = sourcePaths[item.path]
    if (typeof source !== 'string' || source.length === 0) {
      throw exportError(`缺少源文件: ${item.path}`, { path: item.path })
    }
    const info = await stat(source)
    if (!info.isFile()) {
      throw exportError(`源路径不是文件: ${source}`, { path: item.path })
    }
    entries.push({ name: item.path, sourcePath: source, mode: info.mode, mtime: info.mtime })
  }

  for (const extra of extraEntries) {
    entries.push(extra)
  }

  return writeZipStream({ entries, outputPath, compress })
}
