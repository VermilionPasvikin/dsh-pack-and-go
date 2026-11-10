/**
 * Exact Fetch 操作入口（ADR-0011）：`POST /api/mover/exec`。
 *
 * - 由 Connection 的共享 Fetch handler 服务（复用 Host/Origin 检查与浏览器认证）；
 * - 不经过命令通道，因此不需要会话上下文、不写会话日志；
 * - 仅接受白名单 action，参数在 Host 侧校验。
 */

import {
  exportAllSessions,
  findPacks,
  importPack,
  inspectPack,
  listCatalog,
  measureWorkspaces,
} from './commands.js'

const ACTIONS = new Set(['list', 'find', 'size', 'inspect', 'export', 'import'])

/**
 * @param {object} deps 与命令 handler 相同的依赖
 * @param {{ warn?: (...args: unknown[]) => void }} [logger]
 * @returns {(request: Request) => Promise<Response>}
 */
export function createExecHandler(deps, logger) {
  return async function handleExec(request) {
    try {
      const payload = JSON.parse(await request.text())
      const action = payload?.action
      const args = payload?.args ?? {}
      if (!ACTIONS.has(action)) {
        return json({ ok: false, error: `unknown action: ${String(action)}` }, 400)
      }
      const result = await dispatch(action, args, deps)
      return json({ ok: true, result }, 200)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger?.warn?.('[dsh-mover] exec failed', message)
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
      return inspectPack(deps, args.pack)
    case 'export':
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
