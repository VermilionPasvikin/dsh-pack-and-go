/**
 * Exact Fetch 操作入口（ADR-0011）：`POST /api/mover/exec`。
 *
 * - 由 Connection 的共享 Fetch handler 服务（复用 Host/Origin 检查与浏览器认证）；
 * - 不经过命令通道，因此不需要会话上下文、不写会话日志；
 * - 仅接受白名单 action，参数在 Host 侧校验。
 */

import {
  exportAllSessions,
  exportWorkspacesOnly,
  findPacks,
  importPack,
  inspectPack,
  listCatalog,
  measureWorkspaces,
} from './commands.js'

const ACTIONS = new Set(['list', 'find', 'size', 'inspect', 'export', 'import'])

/** 请求体上限（P2-14⑤）：超过即 413，避免超大 JSON 打满内存。 */
const MAX_BODY_BYTES = 32 * 1024 * 1024

/**
 * @param {object} deps 与命令 handler 相同的依赖
 * @param {{ warn?: (...args: unknown[]) => void }} [logger]
 * @returns {(request: Request) => Promise<Response>}
 */
export function createExecHandler(deps, logger) {
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
      const result = await dispatch(action, args, deps)
      return json({ ok: true, result }, 200)
    } catch (error) {
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
 * @returns {Promise<{ kind: string, text: string }>}
 */
async function dispatch(action, args, deps) {
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
    default:
      return { kind: 'error', text: `unknown action: ${action}` }
  }
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
