/**
 * 工作区登记（T2.9）：调用 Host 的 `workspaceRegistry.create`。
 *
 * `create` 要求目标路径已存在且为目录（内部 realpath 规范化），
 * 相同路径重复创建返回已有实体且不改标题。
 */

import { ERROR_CODES, MoverError } from '../core/errors.js'
import { resolveWorkspaceTitle } from '../core/workspace-title.js'

/**
 * @param {string} message
 * @param {Record<string, unknown>} [details]
 * @returns {MoverError}
 */
function registerError(message, details = {}) {
  return new MoverError(ERROR_CODES.CATALOG_INVALID, message, details)
}

/**
 * 登记工作区。
 * @param {{
 *   workspaceRegistry: { create(path: string, title?: string): Promise<object> },
 *   workspaces: Array<{ key: string, title: string, targetPath: string }>,
 *   logger?: { warn?: (...args: unknown[]) => void }
 * }} input
 * @returns {Promise<{ registered: Array<{ key: string, id: string, path: string, title: string }>, warnings: string[] }>}
 */
export async function registerWorkspaces(input) {
  const { workspaceRegistry, workspaces } = input
  if (!workspaceRegistry || typeof workspaceRegistry.create !== 'function') {
    throw registerError('缺少 workspaceRegistry.create')
  }

  const registered = []
  const warnings = []
  const existing =
    typeof workspaceRegistry.list === 'function' ? workspaceRegistry.list() : []
  const existingByPath = new Set(
    existing
      .map((item) => (typeof item?.path === 'string' ? item.path.toLowerCase() : undefined))
      .filter(Boolean),
  )
  const existingTitles = new Set(
    existing.map((item) => item?.title).filter((title) => typeof title === 'string'),
  )

  for (const workspace of workspaces) {
    try {
      // 规则与 CLI 共用（T13.5 / core/workspace-title.js）。
      const resolved = resolveWorkspaceTitle({
        title: workspace.title,
        targetPath: workspace.targetPath,
        existingPathKeys: existingByPath,
        existingTitles,
      })
      const finalTitle = resolved.title
      if (resolved.renamed) existingTitles.add(finalTitle)
      const entity = await workspaceRegistry.create(workspace.targetPath, finalTitle)
      existingByPath.add(String(entity.path ?? workspace.targetPath).toLowerCase())
      existingTitles.add(entity.title)
      registered.push({
        key: workspace.key,
        id: entity.id,
        path: entity.path,
        title: entity.title,
        entity,
      })
    } catch (error) {
      warnings.push(
        `工作区登记失败: ${workspace.title}（${workspace.targetPath}）：${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  return { registered, warnings }
}
