/**
 * 导出计划：把用户选择转换为包内文件清单与体积预估（SPEC §FR-2 / §FR-5 / §8）。
 *
 * 纯计算，不做 IO；文件清单由调用方（T1.9 扫描结果）提供。
 */

import { ERROR_CODES, MoverError } from './errors.js'

/** 包内容模式（与 manifest.mode 一致）。 */
export const EXPORT_MODES = Object.freeze(['sessions', 'workspaces', 'sessions+workspaces'])

/**
 * @param {string} message
 * @param {Record<string, unknown>} [details]
 * @returns {MoverError}
 */
function planError(message, details = {}) {
  return new MoverError(ERROR_CODES.PLAN_INVALID, message, details)
}

/**
 * 由选择推断包模式。
 * @param {{ sessions: unknown[], workspaces: unknown[] }} input
 * @returns {'sessions'|'workspaces'|'sessions+workspaces'}
 */
export function inferMode({ sessions, workspaces }) {
  if (sessions.length > 0 && workspaces.length > 0) return 'sessions+workspaces'
  if (sessions.length > 0) return 'sessions'
  return 'workspaces'
}

/**
 * @param {{
 *   sessions?: Array<{ packPath: string, sizeBytes?: number }>,
 *   workspaces?: Array<{ key: string, files?: Array<{ relPath: string, size?: number }> }>,
 *   attachments?: Array<{ packPath: string, sizeBytes?: number }>,
 *   includeFiles?: boolean
 * }} input
 * @returns {{
 *   mode: string,
 *   items: Array<{ kind: 'session'|'workspace-file'|'attachment', path: string, size: number }>,
 *   counts: { sessions: number, workspaces: number, attachments: number, files: number },
 *   totalBytes: number
 * }}
 */
export function planExport(input) {
  const sessions = input.sessions ?? []
  const workspaces = input.workspaces ?? []
  const attachments = input.attachments ?? []
  const includeFiles = input.includeFiles === true

  if (!Array.isArray(sessions) || !Array.isArray(workspaces) || !Array.isArray(attachments)) {
    throw planError('sessions / workspaces / attachments 必须是数组')
  }
  if (sessions.length === 0 && workspaces.length === 0) {
    throw planError('至少选择一个对话或工作区')
  }

  const mode = inferMode({ sessions, workspaces })
  const items = []
  let totalBytes = 0
  let files = 0

  for (const session of sessions) {
    if (typeof session.packPath !== 'string' || session.packPath.length === 0) {
      throw planError('会话缺少包内路径 packPath')
    }
    const size = session.sizeBytes ?? 0
    items.push({ kind: 'session', path: session.packPath, size })
    totalBytes += size
  }

  for (const workspace of workspaces) {
    if (includeFiles) {
      for (const file of workspace.files ?? []) {
        const path = `workspaces/${workspace.key}/files/${file.relPath}`
        const size = file.size ?? 0
        items.push({ kind: 'workspace-file', path, size })
        totalBytes += size
        files += 1
      }
    }
  }

  for (const attachment of attachments) {
    if (typeof attachment.packPath !== 'string' || attachment.packPath.length === 0) {
      throw planError('附件缺少包内路径 packPath')
    }
    const size = attachment.sizeBytes ?? 0
    items.push({ kind: 'attachment', path: attachment.packPath, size })
    totalBytes += size
  }

  if (items.length === 0) {
    throw planError('没有可打包的内容（仅工作区模式需要包含项目文件）')
  }

  return {
    mode,
    items,
    counts: {
      sessions: sessions.length,
      workspaces: workspaces.length,
      attachments: attachments.length,
      files,
    },
    totalBytes,
  }
}
