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

        if (process.env.DSH_MOVER_SELFTEST_EXPORT === '1') {
          const { planExport, buildManifest, buildPack } = await import('../core/index.js')
          const { writeFile } = await import('node:fs/promises')
          const { join } = await import('node:path')
          const { tmpdir } = await import('node:os')

          const sessions = catalog.workspaces
            .flatMap((workspace) => workspace.sessions)
            .filter((session) => typeof session.locationPath === 'string')
          const first = sessions[0]
          if (!first) {
            console.log('DSH-MOVER-EXPORT none')
            return
          }
          const packPath = `sessions/${first.id}/session.v4.jsonl.zstd`
          const plan = planExport({
            sessions: [{ packPath, sizeBytes: first.sizeBytes }],
            includeFiles: false,
          })
          const manifest = buildManifest({
            platform: process.platform,
            dshVersion: process.env.DSH_VERSION ?? 'selftest',
            mode: 'sessions',
            sessions: [
              {
                id: first.id,
                title: first.title,
                cwd: first.cwd,
                messageCount: first.eventCount ?? 0,
                sizeBytes: first.sizeBytes,
                path: packPath,
              },
            ],
          })
          const pack = await buildPack({
            plan,
            sourcePaths: { [packPath]: first.locationPath },
            manifest,
          })
          const output = join(tmpdir(), 'dsh-mover-selftest.dshpack')
          await writeFile(output, pack)
          console.log(`DSH-MOVER-EXPORT ${output} ${pack.length}`)
        }
      } catch (error) {
        console.log(
          `DSH-MOVER-SELFTEST-FAILED ${error instanceof Error ? error.stack : String(error)}`,
        )
      }
    })()
  }
}
