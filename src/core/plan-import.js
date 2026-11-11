/**
 * 导入计划：把 manifest + 路径映射 + 目标现状转换为逐项动作（SPEC §FR-8 / §FR-10）。
 *
 * 默认策略来自 ADR-0006：会话冲突跳过、工作区同路径合并。
 */

import { ERROR_CODES, MoverError } from './errors.js'

/** 会话导入动作。 */
export const SESSION_ACTIONS = Object.freeze(['import', 'skip', 'overwrite', 'new-id'])

/** 工作区导入动作。 */
export const WORKSPACE_ACTIONS = Object.freeze(['create', 'merge', 'skip', 'relocate'])

/** 默认冲突策略（ADR-0006）。 */
export const DEFAULT_IMPORT_POLICY = Object.freeze({
  session: 'skip',
  workspace: 'merge',
})

/**
 * @param {string} message
 * @param {Record<string, unknown>} [details]
 * @returns {MoverError}
 */
function planImportError(message, details = {}) {
  return new MoverError(ERROR_CODES.PLAN_INVALID, message, details)
}

/**
 * 生成导入计划。
 * @param {{
 *   manifest: object,
 *   pathMap: { byKey: Record<string, string> },
 *   existingSessionIds?: readonly string[],
 *   existingWorkspacePaths?: readonly string[],
 *   preflight?: { risks?: Array<object> },
 *   policy?: { session?: string, workspace?: string }
 * }} input
 * @returns {{
 *   sessions: Array<{ id: string, title?: string, workspaceKey?: string, targetCwd?: string, action: string }>,
 *   workspaces: Array<{ key: string, title: string, targetPath: string, action: string }>,
 *   conversions: Array<{ path: string, kind: string, detail: string, suggestion?: string }>,
 *   summary: { sessions: Record<string, number>, workspaces: Record<string, number>, conversions: number }
 * }}
 */
/**
 * 归一化路径用于比较（斜杠统一、小写）。
 * @param {string} value
 * @returns {string}
 */
function normalizePath(value) {
  return String(value ?? '')
    .replace(/\\/g, '/')
    .toLowerCase()
    .replace(/\/+$/, '')
}

export function planImport(input) {
  const { manifest, pathMap } = input
  const existingCwdById = input.existingCwdById ?? new Map()
  if (manifest === null || typeof manifest !== 'object') {
    throw planImportError('缺少 manifest')
  }
  if (pathMap === null || typeof pathMap !== 'object' || typeof pathMap.byKey !== 'object') {
    throw planImportError('缺少路径映射 pathMap')
  }

  const policy = {
    session: input.policy?.session ?? DEFAULT_IMPORT_POLICY.session,
    workspace: input.policy?.workspace ?? DEFAULT_IMPORT_POLICY.workspace,
  }
  if (!SESSION_ACTIONS.includes(policy.session)) {
    throw planImportError(`非法的会话冲突策略: ${String(policy.session)}`)
  }
  if (!WORKSPACE_ACTIONS.includes(policy.workspace)) {
    throw planImportError(`非法的工作区冲突策略: ${String(policy.workspace)}`)
  }

  const existingIds = new Set(input.existingSessionIds ?? [])
  const existingPaths = new Set(
    (input.existingWorkspacePaths ?? []).map((value) => value.toLowerCase()),
  )

  const workspaces = []
  for (const workspace of manifest.workspaces ?? []) {
    const targetPath = pathMap.byKey[workspace.key]
    if (typeof targetPath !== 'string' || targetPath.length === 0) {
      throw planImportError(`工作区 ${workspace.key} 缺少目标路径映射`, { key: workspace.key })
    }
    const exists = existingPaths.has(targetPath.toLowerCase())
    workspaces.push({
      key: workspace.key,
      title: workspace.title,
      targetPath,
      action: exists ? policy.workspace : 'create',
    })
  }

  const sessions = []
  for (const session of manifest.sessions ?? []) {
    let targetCwd
    if (session.workspaceKey !== undefined) {
      targetCwd = pathMap.byKey[session.workspaceKey]
      if (typeof targetCwd !== 'string' || targetCwd.length === 0) {
        throw planImportError(
          `会话 ${session.id} 的工作区 ${session.workspaceKey} 缺少目标路径映射`,
          { id: session.id, workspaceKey: session.workspaceKey },
        )
      }
    }
    let action = existingIds.has(session.id) ? policy.session : 'import'
    // 覆盖 = 原地恢复：目标 cwd 对齐现有会话位置（避免写第二份造成重复 id）。
    if (action === 'overwrite') {
      const currentCwd = existingCwdById.get(session.id)
      if (typeof currentCwd === 'string' && currentCwd.length > 0) {
        targetCwd = currentCwd
      }
    }
    sessions.push({
      id: session.id,
      title: session.title,
      workspaceKey: session.workspaceKey,
      targetCwd,
      action,
    })
  }

  const conversions = (input.preflight?.risks ?? []).map((risk) => ({
    path: risk.path,
    kind: risk.kind,
    detail: risk.detail,
    suggestion: risk.suggestion,
  }))

  const summary = {
    sessions: { import: 0, skip: 0, overwrite: 0, 'new-id': 0 },
    workspaces: { create: 0, merge: 0, skip: 0, relocate: 0 },
    conversions: conversions.length,
  }
  for (const session of sessions) {
    if (session.action in summary.sessions) summary.sessions[session.action] += 1
  }
  for (const workspace of workspaces) {
    if (workspace.action in summary.workspaces) summary.workspaces[workspace.action] += 1
  }

  return { sessions, workspaces, conversions, summary }
}
