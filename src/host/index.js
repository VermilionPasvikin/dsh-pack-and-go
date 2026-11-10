/**
 * Host 侧插件入口（Cordis bundle）。
 *
 * T2.1 只建立可加载的骨架；服务注册、Remote 接口、任务编排在 T2.2+ 实现。
 * 本文件运行在 DSH Host（Node / Electron 的 Node 模式）内。
 */

/** @type {string} */
export const name = 'dsh-mover'

/**
 * Cordis 插件挂载入口。
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {Record<string, unknown>} config
 */
export function apply(ctx, config) {
  void config
  const logger = ctx.logger
  if (logger && typeof logger.info === 'function') {
    logger.info('[dsh-mover] host plugin loaded')
  }
}
