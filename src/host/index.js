/**
 * Host 侧插件入口（Cordis bundle）。
 *
 * T2.1 建立可加载骨架；T2.4 增加目录读取自检（仅在 DSH_MOVER_SELFTEST=1 时）。
 * 服务注册、Remote 接口、任务编排在 T2.5+ 实现。
 */

import { loadCatalog } from './catalog.js'

/** @type {string} */
export const name = 'dsh-mover'

/** 这些服务缺失时不激活插件（保持 DSH 可正常启动）。 */
export const inject = ['workspaceRegistry', 'sessionPersistence']

/**
 * Cordis 插件挂载入口。
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {Record<string, unknown>} config
 */
export function apply(ctx, config) {
  void config
  const logger = ctx.logger
  logger?.info?.('[dsh-mover] host plugin loaded')

  if (process.env.DSH_MOVER_SELFTEST === '1') {
    // 自检直接写 stdout，避免依赖 DSH 的 logger 输出通道
    console.log('[dsh-mover] apply() reached')
    void (async () => {
      try {
        const catalog = await loadCatalog({
          workspaceRegistry: ctx.workspaceRegistry,
          sessionPersistence: ctx.sessionPersistence,
          sessionQuery: typeof ctx.get === 'function' ? ctx.get('sessionQuery') : undefined,
          logger,
        })
        console.log(
          `DSH-MOVER-SELFTEST ${JSON.stringify({
            workspaces: catalog.workspaces.length,
            ungrouped: catalog.ungrouped.length,
            totals: catalog.totals,
            firstWorkspace: catalog.workspaces[0]?.title ?? null,
            firstSession: catalog.workspaces[0]?.sessions[0]?.title ?? null,
          })}`,
        )
      } catch (error) {
        console.log(`DSH-MOVER-SELFTEST-FAILED ${error instanceof Error ? error.stack : String(error)}`)
      }
    })()
  }
}
