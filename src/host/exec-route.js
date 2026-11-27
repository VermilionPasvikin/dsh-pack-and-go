/**
 * Exact Fetch 操作入口（ADR-0011）：`POST /api/mover/exec`。
 *
 * - 由 Connection 的共享 Fetch handler 服务（复用 Host/Origin 检查与浏览器认证）；
 * - 不经过命令通道，因此不需要会话上下文、不写会话日志；
 * - 仅接受白名单 action，参数在 Host 侧校验；
 * - 长任务（ADR-0021）：`task.start` 立即返回 taskId，`task.poll` 增量读帧，`task.cancel` 中止。
 */

import { ERROR_CODES } from '../core/errors.js'
import {
  exportAllSessions,
  exportWorkspacesOnly,
  findPacks,
  importPack,
  inspectPack,
  listCatalog,
  measureWorkspaces,
} from './commands.js'
import { createTaskRegistry } from './task-registry.js'

const ACTIONS = new Set([
  'list',
  'find',
  'size',
  'inspect',
  'export',
  'import',
  'task.start',
  'task.poll',
  'task.cancel',
])

/** 请求体上限（P2-14⑤）：超过即 413，避免超大 JSON 打满内存。 */
const MAX_BODY_BYTES = 32 * 1024 * 1024

/**
 * @param {object} deps 与命令 handler 相同的依赖
 * @param {{ warn?: (...args: unknown[]) => void }} [logger]
 * @param {{ registry?: ReturnType<typeof createTaskRegistry> }} [options]
 * @returns {(request: Request) => Promise<Response>}
 */
export function createExecHandler(deps, logger, options = {}) {
  const registry = options.registry ?? createTaskRegistry()

  return async function handleExec(request) {
    try {
      // 先看声明长度（避免无谓读取），再对实际字节数复核（防 chunked 绕过）。
      const declared = Number(request.headers.get('content-length') ?? '0')
      if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
        return json({ ok: false, error: `请求体过大（上限 ${MAX_BODY_BYTES} 字节）` }, 413)
      }
      const body = await request.text()
      if (body.length > MAX_BODY_BYTES) {
        return json({ ok: false, error: `请求体过大（上限 ${MAX_BODY_BYTES} 字节）` }, 413)
      }
      const payload = JSON.parse(body)
      const action = payload?.action
      const args = payload?.args ?? {}
      if (!ACTIONS.has(action)) {
        return json({ ok: false, error: `unknown action: ${String(action)}` }, 400)
      }
      const result = await dispatch(action, args, deps, registry)
      return json({ ok: true, result }, 200)
    } catch (error) {
      const code = error && typeof error === 'object' ? error.code : undefined
      if (code === ERROR_CODES.TASK_NOT_FOUND) {
        return json({ ok: false, error: error.message, code }, 404)
      }
      const message = error instanceof Error ? error.message : String(error)
      logger?.warn?.('[dsh-pack-and-go] exec failed', message)
      return json({ ok: false, error: message }, 500)
    }
  }
}

/**
 * @param {string} action
 * @param {Record<string, unknown>} args
 * @param {object} deps
 * @param {ReturnType<typeof createTaskRegistry>} registry
 * @returns {Promise<object>}
 */
async function dispatch(action, args, deps, registry) {
  switch (action) {
    case 'list':
      return listCatalog(deps)
    case 'find':
      return findPacks(typeof args.dir === 'string' ? args.dir : undefined)
    case 'size':
      return measureWorkspaces(Array.isArray(args.dirs) ? args.dirs : [])
    case 'inspect':
      return inspectPack(deps, args.pack, args.target)
    case 'export':
      if (Array.isArray(args.workspaces) && args.workspaces.length > 0) {
        return exportWorkspacesOnly(deps, args.target, args.workspaces)
      }
      return exportAllSessions(
        deps,
        args.target,
        Array.isArray(args.sessionIds) ? args.sessionIds : [],
        args.includeFiles === true,
        args.options ?? {},
      )
    case 'import':
      return importPack(deps, args.pack, args.target, args.options ?? {})
    case 'task.start':
      return startTask(args, deps, registry)
    case 'task.poll':
      return registry.poll(String(args.taskId ?? ''), Number(args.cursor ?? 0))
    case 'task.cancel':
      return registry.cancel(String(args.taskId ?? ''))
    default:
      return { kind: 'error', text: `unknown action: ${action}` }
  }
}

/**
 * 把导出/导入提交为后台任务（ADR-0021）。
 * @param {Record<string, unknown>} args
 * @param {object} deps
 * @param {ReturnType<typeof createTaskRegistry>} registry
 */
function startTask(args, deps, registry) {
  const kind = args.kind === 'import' ? 'import' : 'export'
  const title =
    kind === 'import'
      ? `导入 ${typeof args.pack === 'string' ? args.pack : ''}`.trim()
      : `导出 ${typeof args.target === 'string' ? args.target : ''}`.trim()

  const run = async ({ signal, onProgress }) => {
    if (kind === 'import') {
      return importPack(deps, args.pack, args.target, {
        ...(args.options ?? {}),
        signal,
        onProgress,
      })
    }
    if (Array.isArray(args.workspaces) && args.workspaces.length > 0) {
      return exportWorkspacesOnly(deps, args.target, args.workspaces, { signal, onProgress })
    }
    return exportAllSessions(
      deps,
      args.target,
      Array.isArray(args.sessionIds) ? args.sessionIds : [],
      args.includeFiles === true,
      { ...(args.options ?? {}), signal, onProgress },
    )
  }

  const { taskId } = registry.start({ kind, title, run })
  return { ok: true, taskId, kind, title }
}

/**
 * @param {unknown} value
 * @param {number} status
 * @returns {Response}
 */
function json(value, status) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}
