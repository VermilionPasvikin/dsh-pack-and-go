/**
 * 包格式 v2 的字段清单与结构校验（对应 docs/SPEC.md §8）。
 *
 * 只校验结构与引用完整性；不校验文件是否存在、校验和是否匹配（属于 zip 读取任务）。
 * 未知字段一律允许并保留（前向兼容）。
 */

import { SCHEMA_VERSION } from './constants.js'
import { ERROR_CODES, ManifestError } from './errors.js'

/** manifest 顶层字段。 */
export const MANIFEST_FIELDS = Object.freeze([
  'schemaVersion',
  'createdAt',
  'source',
  'mode',
  'sessions',
  'attachments',
  'workspaces',
])

/** `source` 必填字段。 */
export const SOURCE_REQUIRED_FIELDS = Object.freeze([
  'platform',
  'dshVersion',
  'sessionFormat',
])

/** 一个会话条目的字段。 */
export const SESSION_FIELDS = Object.freeze([
  'id',
  'title',
  'cwd',
  'workspaceKey',
  'messageCount',
  'sizeBytes',
  'path',
  'sha256',
])

/** 一个附件条目的字段。 */
export const ATTACHMENT_FIELDS = Object.freeze(['id', 'sizeBytes', 'sha256'])

/** 一个工作区条目的字段。 */
export const WORKSPACE_FIELDS = Object.freeze([
  'key',
  'title',
  'sourcePath',
  'sourcePlatform',
  'fileCount',
  'sizeBytes',
  'excluded',
  'root',
  'mapping',
])

/** `mapping.json` 中一个条目的字段。 */
export const MAPPING_ENTRY_FIELDS = Object.freeze([
  'sourcePath',
  'packPath',
  'type',
  'mode',
  'mtimeMs',
  'action',
])

/** 包内容模式。 */
export const MODES = Object.freeze(['sessions', 'workspaces', 'sessions+workspaces'])

/** 源平台取值。 */
export const PLATFORMS = Object.freeze(['win32', 'darwin', 'linux'])

/** mapping 条目类型。 */
export const MAPPING_TYPES = Object.freeze(['file', 'dir', 'symlink', 'skipped'])

/** mapping 转换动作。 */
export const CONVERSION_ACTIONS = Object.freeze([
  'none',
  'renamed',
  'dereferenced',
  'skipped',
])

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function isNonNegativeInt(value) {
  return Number.isSafeInteger(value) && value >= 0
}

/**
 * @param {string} path 字段路径（用于定位）
 * @param {string} message 说明
 * @param {string} [code]
 * @returns {never}
 */
function fail(path, message, code = ERROR_CODES.MANIFEST_INVALID) {
  throw new ManifestError(code, `${path}: ${message}`, { path })
}

function validateSource(source) {
  if (!isPlainObject(source)) fail('manifest.source', '必须是对象')
  for (const field of SOURCE_REQUIRED_FIELDS) {
    if (!(field in source)) fail(`manifest.source.${field}`, '缺少必填字段')
  }
  if (!PLATFORMS.includes(source.platform)) {
    fail('manifest.source.platform', `必须是 ${PLATFORMS.join(' / ')} 之一`)
  }
  if (!isNonEmptyString(source.dshVersion)) {
    fail('manifest.source.dshVersion', '必须是非空字符串')
  }
  if (!Number.isSafeInteger(source.sessionFormat) || source.sessionFormat < 0) {
    fail('manifest.source.sessionFormat', '必须是非负整数')
  }
}

function validateSession(session, index) {
  const at = `manifest.sessions[${index}]`
  if (!isPlainObject(session)) fail(at, '必须是对象')
  if (!isNonEmptyString(session.id)) fail(`${at}.id`, '必须是非空字符串')
  if (session.title !== undefined && typeof session.title !== 'string') {
    fail(`${at}.title`, '必须是字符串')
  }
  if (session.cwd !== undefined && typeof session.cwd !== 'string') {
    fail(`${at}.cwd`, '必须是字符串（无 cwd 时省略）')
  }
  if (session.workspaceKey !== undefined && typeof session.workspaceKey !== 'string') {
    fail(`${at}.workspaceKey`, '必须是字符串（未归组时省略）')
  }
  if (!isNonNegativeInt(session.messageCount)) {
    fail(`${at}.messageCount`, '必须是非负整数')
  }
  if (!isNonNegativeInt(session.sizeBytes)) {
    fail(`${at}.sizeBytes`, '必须是非负整数')
  }
  if (!isNonEmptyString(session.path)) fail(`${at}.path`, '必须是非空字符串')
  if (session.path.includes('..') || session.path.startsWith('/') || session.path.includes('\\')) {
    fail(`${at}.path`, '必须是包内相对路径（不得包含 ..、反斜杠或以 / 开头）')
  }
  if (session.sha256 !== undefined && !/^[0-9a-f]{64}$/i.test(session.sha256)) {
    fail(`${at}.sha256`, '必须是 64 位十六进制字符串')
  }
}

function validateAttachment(attachment, index) {
  const at = `manifest.attachments[${index}]`
  if (!isPlainObject(attachment)) fail(at, '必须是对象')
  if (!isNonEmptyString(attachment.id)) fail(`${at}.id`, '必须是非空字符串')
  if (!isNonNegativeInt(attachment.sizeBytes)) {
    fail(`${at}.sizeBytes`, '必须是非负整数')
  }
  if (attachment.sha256 !== undefined && !/^[0-9a-f]{64}$/i.test(attachment.sha256)) {
    fail(`${at}.sha256`, '必须是 64 位十六进制字符串')
  }
}

function validateWorkspace(workspace, index) {
  const at = `manifest.workspaces[${index}]`
  if (!isPlainObject(workspace)) fail(at, '必须是对象')
  if (!isNonEmptyString(workspace.key)) fail(`${at}.key`, '必须是非空字符串')
  if (!isNonEmptyString(workspace.title)) fail(`${at}.title`, '必须是非空字符串')
  if (!isNonEmptyString(workspace.sourcePath)) {
    fail(`${at}.sourcePath`, '必须是非空字符串')
  }
  if (!PLATFORMS.includes(workspace.sourcePlatform)) {
    fail(`${at}.sourcePlatform`, `必须是 ${PLATFORMS.join(' / ')} 之一`)
  }
  if (!isNonNegativeInt(workspace.fileCount)) {
    fail(`${at}.fileCount`, '必须是非负整数')
  }
  if (!isNonNegativeInt(workspace.sizeBytes)) {
    fail(`${at}.sizeBytes`, '必须是非负整数')
  }
  if (workspace.excluded !== undefined && !Array.isArray(workspace.excluded)) {
    fail(`${at}.excluded`, '必须是字符串数组')
  }
  if (!isNonEmptyString(workspace.root)) fail(`${at}.root`, '必须是非空字符串')
  if (workspace.root.includes('..') || workspace.root.startsWith('/')) {
    fail(`${at}.root`, '必须是包内相对路径')
  }
  if (workspace.mapping !== undefined) {
    if (!isNonEmptyString(workspace.mapping)) {
      fail(`${at}.mapping`, '必须是字符串')
    }
    if (workspace.mapping.includes('..') || workspace.mapping.startsWith('/')) {
      fail(`${at}.mapping`, '必须是包内相对路径')
    }
  }
}

/**
 * 校验 manifest 结构与引用完整性。
 * @param {unknown} value 解析后的 manifest
 * @returns {true} 通过时返回 true
 * @throws {ManifestError} 结构或版本不合法
 */
export function validateManifest(value) {
  if (!isPlainObject(value)) fail('manifest', '必须是 JSON 对象')

  const { schemaVersion } = value
  if (!Number.isSafeInteger(schemaVersion)) {
    fail('manifest.schemaVersion', '必须是整数')
  }
  if (schemaVersion > SCHEMA_VERSION) {
    fail(
      'manifest.schemaVersion',
      `不支持的包格式版本 ${schemaVersion}（本机最高 ${SCHEMA_VERSION}），请升级插件`,
      ERROR_CODES.MANIFEST_VERSION_TOO_NEW,
    )
  }
  if (schemaVersion < SCHEMA_VERSION) {
    fail(
      'manifest.schemaVersion',
      `包格式版本 ${schemaVersion} 过旧（当前 ${SCHEMA_VERSION}），请让来源方使用当前版本重新导出`,
      ERROR_CODES.MANIFEST_VERSION_UNSUPPORTED,
    )
  }

  if (!isNonEmptyString(value.createdAt) || Number.isNaN(Date.parse(value.createdAt))) {
    fail('manifest.createdAt', '必须是有效的日期时间字符串')
  }
  validateSource(value.source)

  if (!MODES.includes(value.mode)) {
    fail('manifest.mode', `必须是 ${MODES.join(' / ')} 之一`)
  }
  if (!Array.isArray(value.sessions)) fail('manifest.sessions', '必须是数组')
  value.sessions.forEach(validateSession)
  if (!Array.isArray(value.attachments)) fail('manifest.attachments', '必须是数组')
  value.attachments.forEach(validateAttachment)
  if (!Array.isArray(value.workspaces)) fail('manifest.workspaces', '必须是数组')
  value.workspaces.forEach(validateWorkspace)

  const workspaceKeys = new Set(value.workspaces.map((workspace) => workspace.key))
  for (const [index, session] of value.sessions.entries()) {
    if (session.workspaceKey !== undefined && !workspaceKeys.has(session.workspaceKey)) {
      fail(
        `manifest.sessions[${index}].workspaceKey`,
        `引用了不存在的 workspace key "${session.workspaceKey}"`,
      )
    }
  }

  return true
}

/**
 * 校验 mapping 条目（T1.14 导入计划会使用）。
 * @param {unknown} entry
 * @returns {true}
 */
export function validateMappingEntry(entry) {
  if (!isPlainObject(entry)) fail('mapping.entry', '必须是对象')
  if (!isNonEmptyString(entry.sourcePath)) fail('mapping.sourcePath', '必须是非空字符串')
  if (!isNonEmptyString(entry.packPath)) fail('mapping.packPath', '必须是非空字符串')
  if (!MAPPING_TYPES.includes(entry.type)) {
    fail('mapping.type', `必须是 ${MAPPING_TYPES.join(' / ')} 之一`)
  }
  if (entry.mode !== undefined && !isNonNegativeInt(entry.mode)) {
    fail('mapping.mode', '必须是 0-65535 的整数权限位')
  }
  if (entry.mtimeMs !== undefined && !isNonNegativeInt(entry.mtimeMs)) {
    fail('mapping.mtimeMs', '必须是非负整数')
  }
  if (!CONVERSION_ACTIONS.includes(entry.action)) {
    fail('mapping.action', `必须是 ${CONVERSION_ACTIONS.join(' / ')} 之一`)
  }
  return true
}
