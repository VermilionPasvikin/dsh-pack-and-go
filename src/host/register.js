/**
 * 工作区登记（T2.9）：调用 Host 的 `workspaceRegistry.create`。
 *
 * `create` 要求目标路径已存在且为目录（内部 realpath 规范化），
 * 相同路径重复创建返回已有实体且不改标题。
 */

import { ERROR_CODES, MoverError } from '../core/errors.js'

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

  for (const workspace of workspaces) {
    try {
      const entity = await workspaceRegistry.create(workspace.targetPath, workspace.title)
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
