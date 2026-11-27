/**
 * 导入计划：把 manifest + 路径映射 + 目标现状转换为逐项动作（SPEC §FR-8 / §FR-10）。
 *
 * 默认策略来自 ADR-0006：会话冲突跳过、工作区同路径合并。
 */

import { join } from 'node:path'

import { ERROR_CODES, MoverError } from './errors.js'
import { safeDirName } from './path-map.js'

/** 会话导入动作。 */
export const SESSION_ACTIONS = Object.freeze(['import', 'skip', 'overwrite', 'new-id'])

/** 工作区导入动作。 */
export const WORKSPACE_ACTIONS = Object.freeze(['create', 'merge', 'skip', 'relocate'])

/** 工作区目标落点动作（ADR-0019）。 */
export const WORKSPACE_TARGET_ACTIONS = Object.freeze(['create', 'reuse', 'rename'])

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
    let migrateFrom
    if (action === 'overwrite') {
      const currentCwd = existingCwdById.get(session.id)
      if (typeof currentCwd === 'string' && currentCwd.length > 0) {
        if (
          typeof targetCwd === 'string' &&
          normalizePath(currentCwd) !== normalizePath(targetCwd)
        ) {
          // 迁移覆盖：写入目标位置，旧目录由写入层备份并移除
          migrateFrom = currentCwd
        } else {
          // 原地恢复
          targetCwd = currentCwd
        }
      }
    }
    sessions.push({
      id: session.id,
      title: session.title,
      workspaceKey: session.workspaceKey,
      targetCwd,
      ...(migrateFrom !== undefined ? { migrateFrom } : {}),
      action,
    })
  }

  // fork 链：父会话被跳过时，子会话强制跳过（保持链完整）。
  const actionById = new Map(sessions.map((session) => [session.id, session.action]))
  let changed = true
  while (changed) {
    changed = false
    for (const session of sessions) {
      if (session.action === 'skip') continue
      const source = (manifest.sessions ?? []).find((item) => item.id === session.id)
      const parentId = source?.parentSessionId
      if (typeof parentId === 'string' && actionById.get(parentId) === 'skip') {
        session.action = 'skip'
        actionById.set(session.id, 'skip')
        changed = true
      }
    }
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

/**
 * 为冲突路径生成下一个可用名：`<base> (n)`，n 从 1 递增。
 * 同时避开本次已分配路径（`reserved`）与目标端已存在路径（`exists`）。
 * @param {string} basePath
 * @param {{ reserved: Set<string>, exists: (path: string) => boolean, maxAttempts?: number }} input
 * @returns {string}
 */
function nextFreePath(basePath, input) {
  const maxAttempts = input.maxAttempts ?? 999
  for (let n = 1; n <= maxAttempts; n += 1) {
    const candidate = `${basePath} (${n})`
    if (!input.reserved.has(normalizePath(candidate)) && !input.exists(candidate)) return candidate
  }
  throw planImportError(`无法为 ${basePath} 找到可用的目标目录名`, { basePath })
}

/**
 * 规划工作区落点（ADR-0019 四步判据，纯函数）：
 * 1. 已登记 → 复用；2. 本次已分配 → `标题 (n)`；3. 存在 + 空 + 未登记 → 复用（D3 兜底）；
 * 4. 存在 + 非空 + 未登记 → `标题 (n)`。
 *
 * 不触碰文件系统：`exists` / `existsNonEmpty` 由调用方注入，便于完整单测与预览/导入共用。
 * @param {{
 *   manifest: object,
 *   targetRoot: string,
 *   platform?: 'win32'|'darwin'|'linux',
 *   registeredPathKeys?: readonly string[],
 *   reserved?: readonly string[],
 *   exists?: (path: string) => boolean,
 *   existsNonEmpty?: (path: string) => boolean
 * }} input
 * @returns {{
 *   targets: Array<{ workspaceKey: string, title: string, path: string, basePath: string, action: string, reason: string }>,
 *   byKey: Record<string, string>,
 *   conflicts: Array<{ key: string, title: string, kind: string, from: string, to: string, reason?: string }>
 * }}
 */
export function planImportTargets(input) {
  const { manifest } = input
  if (manifest === null || typeof manifest !== 'object') {
    throw planImportError('缺少 manifest')
  }
  if (typeof input.targetRoot !== 'string' || input.targetRoot.length === 0) {
    throw planImportError('缺少目标目录 targetRoot', { reason: 'missing-target-root' })
  }
  const platform = input.platform ?? process.platform
  const registered = new Set((input.registeredPathKeys ?? []).map((value) => normalizePath(value)))
  const reserved = new Set((input.reserved ?? []).map((value) => normalizePath(value)))
  const exists = typeof input.exists === 'function' ? input.exists : () => false
  const existsNonEmpty =
    typeof input.existsNonEmpty === 'function' ? input.existsNonEmpty : (path) => exists(path)

  const targets = []
  const conflicts = []
  const byKey = {}

  for (const workspace of manifest.workspaces ?? []) {
    const basePath = join(input.targetRoot, safeDirName(workspace.title, platform))
    const baseKey = normalizePath(basePath)
    let path = basePath
    let action = 'create'
    let reason = 'new'

    if (registered.has(baseKey)) {
      action = 'reuse'
      reason = 'registered'
    } else if (reserved.has(baseKey)) {
      path = nextFreePath(basePath, { reserved, exists })
      action = 'rename'
      reason = 'already-allocated-in-this-import'
    } else if (exists(basePath)) {
      if (existsNonEmpty(basePath)) {
        path = nextFreePath(basePath, { reserved, exists })
        action = 'rename'
        reason = 'existing-non-empty'
      } else {
        action = 'reuse'
        reason = 'empty-unregistered'
      }
    }

    reserved.add(normalizePath(path))
    targets.push({
      workspaceKey: workspace.key,
      title: workspace.title,
      path,
      basePath,
      action,
      reason,
    })
    byKey[workspace.key] = path

    if (action === 'rename') {
      conflicts.push({
        key: workspace.key,
        title: workspace.title,
        kind: 'renamed',
        from: basePath,
        to: path,
        reason,
      })
    } else if (reason === 'empty-unregistered') {
      conflicts.push({
        key: workspace.key,
        title: workspace.title,
        kind: 'reused-empty-directory',
        from: basePath,
        to: path,
      })
    }
  }

  return { targets, byKey, conflicts }
}
