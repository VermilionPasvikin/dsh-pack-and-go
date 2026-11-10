/**
 * manifest 的文本与文件读写。对应 docs/SPEC.md §8。
 *
 * - 解析后立即做结构校验；未知字段原样保留（前向兼容）。
 * - 序列化前先校验，避免写出无法被本机或他人读取的包。
 */

import { readFile, writeFile } from 'node:fs/promises'

import { validateManifest } from './manifest.js'
import { ERROR_CODES, ManifestError } from './errors.js'

/**
 * 解析 manifest 文本并校验。
 * @param {string} text manifest.json 内容
 * @returns {object} 解析后的 manifest（保留未知字段）
 * @throws {ManifestError} JSON 无法解析或结构不合法
 */
export function parseManifest(text) {
  let value
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new ManifestError(
      ERROR_CODES.MANIFEST_INVALID,
      `manifest.json 不是合法 JSON: ${error instanceof Error ? error.message : String(error)}`,
      { reason: 'json-parse', cause: error instanceof Error ? error.message : String(error) },
    )
  }
  validateManifest(value)
  return value
}

/**
 * 序列化 manifest（2 空格缩进，末尾换行）。
 * @param {object} manifest 已校验或待校验的 manifest
 * @returns {string}
 * @throws {ManifestError} 结构不合法
 */
export function serializeManifest(manifest) {
  validateManifest(manifest)
  return `${JSON.stringify(manifest, null, 2)}\n`
}

/**
 * 读取并校验 manifest 文件。
 * @param {string} filePath 绝对或相对路径
 * @returns {Promise<object>}
 */
export async function readManifestFile(filePath) {
  const text = await readFile(filePath, 'utf8')
  return parseManifest(text)
}

/**
 * 校验后写入 manifest 文件。
 * @param {string} filePath
 * @param {object} manifest
 * @returns {Promise<number>} 写入字节数
 */
export async function writeManifestFile(filePath, manifest) {
  const text = serializeManifest(manifest)
  await writeFile(filePath, text, 'utf8')
  return Buffer.byteLength(text, 'utf8')
}
