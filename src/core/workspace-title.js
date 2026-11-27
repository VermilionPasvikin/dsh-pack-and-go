/**
 * 工作区标题消歧（T13.5）：Host 的 `registerWorkspaces` 与 CLI 的离线
 * `workspace.json` 写入共用同一套规则，避免两条路径行为分叉。
 *
 * 规则（与 ADR-0014 决策 3、DEVLOG 120 的「（导入 N）」约定一致）：
 * - 目标路径已登记：不改标题（DSH 的 `create` 会返回已有实体）。
 * - 目标路径是新的、但标题已被占用：追加 `（导入 N）`，N 从 1 递增到不冲突。
 * - 其它情况：保留原标题。
 */

/**
 * @param {{
 *   title: string,
 *   targetPath: string,
 *   existingPathKeys?: Iterable<string>,
 *   existingTitles?: Iterable<string>
 * }} input
 * @returns {{ title: string, renamed: boolean, reason?: 'existing-path'|'title-conflict' }}
 */
export function resolveWorkspaceTitle(input) {
  const title = String(input?.title ?? '')
  const targetPath = String(input?.targetPath ?? '')
  if (targetPath.length === 0) throw new Error('resolveWorkspaceTitle 需要 targetPath')
  const pathKey = targetPath.toLowerCase()

  const pathKeys = new Set(
    [...(input?.existingPathKeys ?? [])].map((value) => String(value).toLowerCase()),
  )
  if (pathKeys.has(pathKey)) {
    return { title, renamed: false, reason: 'existing-path' }
  }

  const titles = new Set([...(input?.existingTitles ?? [])].map((value) => String(value)))
  if (!titles.has(title)) return { title, renamed: false }

  let suffix = 1
  while (titles.has(`${title}（导入 ${suffix}）`)) suffix += 1
  return { title: `${title}（导入 ${suffix}）`, renamed: true, reason: 'title-conflict' }
}
