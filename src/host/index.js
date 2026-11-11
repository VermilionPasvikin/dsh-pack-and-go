/**
 * Host 侧插件入口（Cordis bundle）。
 *
 * T2.1 建立可加载骨架；T2.4 目录读取；T2.5 导出；T2.9 导入（会话+工作区+登记）。
 * 自检逻辑仅在 `DSH_PACK_AND_GO_SELFTEST=1` 时运行，用于一次性 DSH_HOME 集成验证。
 */

import { appendFileSync } from 'node:fs'
import { join } from 'node:path'

import { loadCatalog } from './catalog.js'
import { createMoverCommand } from './commands.js'
import { createExecHandler } from './exec-route.js'
import { rebuildSessionViaService } from './rebuild.js'

/** @type {string} */
export const name = 'dsh-pack-and-go'

/** 这些服务缺失时不激活插件（保持 DSH 可正常启动）。 */
export const inject = ['workspaceRegistry', 'sessionPersistence', 'commands']

/**
 * Cordis 插件挂载入口。
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {Record<string, unknown>} config
 */
export function apply(ctx, config) {
  void config
  const logger = ctx.logger
  logger?.info?.('[dsh-pack-and-go] host plugin loaded')

  const command = createMoverCommand({
    workspaceRegistry: ctx.workspaceRegistry,
    sessionPersistence: ctx.sessionPersistence,
    sessionQuery: typeof ctx.get === 'function' ? ctx.get('sessionQuery') : undefined,
    workspaceController: typeof ctx.get === 'function' ? ctx.get('workspaceController') : undefined,
    dshHome: process.env.DSH_HOME,
    platform: process.platform,
    dshVersion: process.env.DSH_VERSION ?? 'unknown',
    logger,
  })
  ctx.effect(() => ctx.commands.register(command))
  console.log('[dsh-pack-and-go] command registered: mover')

  // ADR-0011：exact Fetch 操作入口（不依赖会话上下文、不写会话日志）。
  // connection 服务可能在 apply 时尚未就绪，因此延迟重试注册。
  const execDeps = {
    workspaceRegistry: ctx.workspaceRegistry,
    sessionPersistence: ctx.sessionPersistence,
    sessionQuery: typeof ctx.get === 'function' ? ctx.get('sessionQuery') : undefined,
    // 服务延迟解析：apply 时可能尚未就绪，请求时再取。
    get workspaceController() {
      return typeof ctx.get === 'function' ? ctx.get('workspaceController') : undefined
    },
    get sessionController() {
      return typeof ctx.get === 'function' ? ctx.get('sessionController') : undefined
    },
    get sessions() {
      return typeof ctx.get === 'function' ? ctx.get('sessions') : undefined
    },
    dshHome: process.env.DSH_HOME,
    platform: process.platform,
    dshVersion: process.env.DSH_VERSION ?? 'unknown',
    logger,
  }
  const registerExecRoute = () => {
    const connection = typeof ctx.get === 'function' ? ctx.get('connection') : undefined
    if (!connection || !connection.fetch || typeof connection.fetch.register !== 'function') {
      return false
    }
    try {
      const handleExec = createExecHandler(execDeps, logger)
      ctx.effect(() =>
        connection.fetch.register({
          path: '/api/mover/exec',
          methods: ['POST'],
          requestBody: 'buffered',
          fetch: handleExec,
        }),
      )
      console.log('[dsh-pack-and-go] exec route registered: /api/mover/exec')
      return true
    } catch (error) {
      console.error('[dsh-pack-and-go] exec route registration failed', error)
      return false
    }
  }
  if (!registerExecRoute()) {
    console.warn('[dsh-pack-and-go] connection.fetch not ready; retrying exec route registration')
    let attempts = 0
    const timer = setInterval(() => {
      attempts += 1
      if (registerExecRoute() || attempts >= 120) {
        clearInterval(timer)
        if (attempts >= 120) {
          console.warn('[dsh-pack-and-go] exec route unavailable; UI falls back to command channel')
        }
      }
    }, 500)
    ctx.effect(() => () => clearInterval(timer))
  }

  // 启动修复：迁移覆盖后的会话可能因旧归属残留而落入「未分组」。
  // DSH 启动索引已建好，此时按会话 cwd 匹配已登记工作区补 attach（只加不减）。
  const repairGrouping = async () => {
    const registry = typeof ctx.get === 'function' ? ctx.get('workspaceRegistry') : undefined
    const persistence = ctx.sessionPersistence
    if (!registry || !persistence) return false
    let workspaces
    try {
      workspaces = registry.list()
    } catch {
      return false
    }
    if (!Array.isArray(workspaces) || workspaces.length === 0) return false
    const normalize = (value) =>
      String(value ?? '')
        .replace(/\\/g, '/')
        .toLowerCase()
        .replace(/\/+$/, '')
    const byPath = new Map(workspaces.map((workspace) => [normalize(workspace.path), workspace]))
    let snapshots
    try {
      snapshots = await persistence.list()
    } catch {
      return false
    }
    // 先修双记账：同一会话只保留一个归属（cwd 匹配者优先），避免 DSH 启动校验失败。
    const ownersBySession = new Map()
    for (const workspace of workspaces) {
      for (const sessionId of workspace.sessionIds ?? []) {
        if (!ownersBySession.has(sessionId)) ownersBySession.set(sessionId, [])
        ownersBySession.get(sessionId).push(workspace)
      }
    }
    let detached = 0
    for (const snapshot of snapshots) {
      const sessionId = snapshot.header.id
      const owners = ownersBySession.get(sessionId) ?? []
      if (owners.length <= 1) continue
      const currentWorkspace = byPath.get(normalize(snapshot.header.cwd))
      const keep =
        currentWorkspace && owners.includes(currentWorkspace) ? currentWorkspace : owners[0]
      for (const workspace of owners) {
        if (workspace === keep) continue
        try {
          await workspace.detachSession(sessionId)
          detached += 1
        } catch (detachError) {
          console.error('[dsh-pack-and-go] grouping detach failed', sessionId, detachError)
        }
      }
    }
    if (detached > 0) console.log('[dsh-pack-and-go] grouping detached', detached, 'stale ownerships')

    let repaired = 0
    for (const snapshot of snapshots) {
      const workspace = byPath.get(normalize(snapshot.header.cwd))
      if (!workspace || typeof workspace.attachSession !== 'function') continue
      if (workspace.sessionIds.includes(snapshot.header.id)) continue
      try {
        await workspace.attachSession(snapshot.header.id)
        repaired += 1
      } catch (attachError) {
        console.error('[dsh-pack-and-go] grouping repair failed', snapshot.header.id, attachError)
      }
    }
    if (repaired > 0) console.log('[dsh-pack-and-go] grouping repaired', repaired, 'sessions')
    return true
  }
  {
    let attempts = 0
    const timer = setInterval(() => {
      attempts += 1
      void repairGrouping()
        .then((done) => {
          if (done || attempts >= 60) clearInterval(timer)
        })
        .catch(() => {})
    }, 1000)
    ctx.effect(() => () => clearInterval(timer))
  }

  if (process.env.DSH_PACK_AND_GO_SELFTEST === '1') {
    console.log('[dsh-pack-and-go] apply() reached')
    void (async () => {
      try {
        const catalog = await loadCatalog({
          workspaceRegistry: ctx.workspaceRegistry,
          sessionPersistence: ctx.sessionPersistence,
          sessionQuery: typeof ctx.get === 'function' ? ctx.get('sessionQuery') : undefined,
          logger,
        })
        console.log(
          `DSH-PACK-AND-GO-SELFTEST ${JSON.stringify({
            workspaces: catalog.workspaces.length,
            ungrouped: catalog.ungrouped.length,
            totals: catalog.totals,
            firstWorkspace: catalog.workspaces[0]?.title ?? null,
            firstSession: catalog.workspaces[0]?.sessions[0]?.title ?? null,
          })}`,
        )

        if (process.env.DSH_PACK_AND_GO_SELFTEST_LIST === '1') {
          await runSessionListSelfTest(ctx)
        } else if (process.env.DSH_PACK_AND_GO_SELFTEST_FOLLOW === '1') {
          await runFollowSelfTest(ctx)
        } else if (process.env.DSH_PACK_AND_GO_SELFTEST_CMD === '1') {
          await runCommandSelfTest(ctx, catalog)
        } else if (process.env.DSH_PACK_AND_GO_SELFTEST_REBUILD === '1') {
          await runRebuildSelfTest(ctx, catalog)
        } else if (process.env.DSH_PACK_AND_GO_SELFTEST_IMPORT === '1') {
          await runImportSelfTest(ctx, catalog)
        } else if (process.env.DSH_PACK_AND_GO_SELFTEST_EXPORT === '1') {
          await runExportSelfTest(ctx, catalog)
        }
      } catch (error) {
        console.log(
          `DSH-PACK-AND-GO-SELFTEST-FAILED ${error instanceof Error ? error.stack : String(error)}`,
        )
      }
    })()
  }
}

/**
 * 重建自检：读取第一个会话，用服务 API 重建为新会话（ADR-0007 方案 C）。
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {object} catalog
 */
async function runRebuildSelfTest(ctx, catalog) {
  const source = [
    ...catalog.workspaces.flatMap((workspace) => workspace.sessions),
    ...catalog.ungrouped,
  ][0]
  if (!source) {
    console.log('DSH-PACK-AND-GO-REBUILD none')
    return
  }
  const rebuilt = await rebuildSessionViaService({
    sessionPersistence: ctx.sessionPersistence,
    sourceId: source.id,
    newCwd: source.cwd,
    createdAt: Date.now(),
  })
  console.log(`DSH-PACK-AND-GO-REBUILD ${JSON.stringify(rebuilt)}`)

  const after = await loadCatalog({
    workspaceRegistry: ctx.workspaceRegistry,
    sessionPersistence: ctx.sessionPersistence,
    sessionQuery: typeof ctx.get === 'function' ? ctx.get('sessionQuery') : undefined,
    logger: ctx.logger,
  })
  console.log(`DSH-PACK-AND-GO-REBUILD-AFTER ${JSON.stringify(after.totals)}`)
}

/** 自检日志：同时写终端与临时文件（终端缓冲不可靠）。 */function logLine(message) {
  console.log(message)
  try {
    appendFileSync(
      join(process.env.TEMP ?? '.', 'mover-selftest.log'),
      `${new Date().toISOString()} ${message}\n`,
    )
  } catch {
    // 日志失败不影响自检
  }
}

/**
 * 会话列表自检：打印 DSH session.list 的 visible rows 与工作区 sessionIds，
 * 用于定位「导入会话不出现在侧边栏」的过滤原因。
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
async function runSessionListSelfTest(ctx) {
  try {
    const controller = ctx.get('sessionController')
    if (!controller || typeof controller.list !== 'function') {
      logLine('DSH-PACK-AND-GO-LIST no-session-controller')
      return
    }
    const result = await controller.list({}, new AbortController().signal)
    const items = result?.items ?? []
    logLine(`DSH-PACK-AND-GO-LIST count=${items.length}`)
    for (const item of items.slice(0, 30)) {
      logLine(
        `DSH-PACK-AND-GO-SESSION-ROW ${JSON.stringify({
          id: item.sessionId,
          cwd: item.cwd,
          blank: item.blank,
          agentAvailable: item.agentAvailable,
          formatStatus: item.formatStatus,
          hasProjections: Boolean(item.projections),
          title: item.projections?.values?.title,
        })}`,
      )
    }
    const registry = ctx.workspaceRegistry
    if (registry && typeof registry.list === 'function') {
      for (const workspace of registry.list()) {
        logLine(
          `DSH-PACK-AND-GO-WS ${JSON.stringify({
            id: workspace.id,
            path: workspace.path,
            title: workspace.title,
            sessionIds: workspace.sessionIds,
          })}`,
        )
      }
    }
  } catch (error) {
    logLine(
      `DSH-PACK-AND-GO-LIST-FAILED ${error instanceof Error ? error.stack : String(error)}`,
    )
  }
}

/**
 * follow 自检：调用 workspaceController.follow 第一帧，捕获 DSH 内部错误堆栈。
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
async function runFollowSelfTest(ctx) {
  try {
    const controller = ctx.get('workspaceController')
    logLine(`DSH-PACK-AND-GO-FOLLOW-CTRL ${typeof controller} follow=${typeof controller?.follow}`)
    if (!controller || typeof controller.follow !== 'function') return
    const stream = await controller.follow(new AbortController().signal)
    let frames = 0
    for await (const frame of stream) {
      frames += 1
      logLine(
        `DSH-PACK-AND-GO-FOLLOW-FRAME ${frame.type} ${JSON.stringify(frame.value).slice(0, 400)}`,
      )
      break
    }
    logLine(`DSH-PACK-AND-GO-FOLLOW-OK frames=${frames}`)
    if (typeof stream.dispose === 'function') stream.dispose()
  } catch (error) {
    logLine(
      `DSH-PACK-AND-GO-FOLLOW-FAILED ${error instanceof Error ? error.stack : String(error)}`,
    )
  }
}

/**
 * 命令自检：解析 agent 后直接调用 commands.execute，验证命令链路。
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {object} catalog
 */
async function runCommandSelfTest(ctx, catalog) {
  try {
    const sessionController = ctx.get('sessionController')
    logLine(`DSH-PACK-AND-GO-CMD-CTRL ${typeof sessionController}`)
    const first = [
      ...catalog.workspaces.flatMap((workspace) => workspace.sessions),
      ...catalog.ungrouped,
    ][0]
    if (!first) {
      logLine('DSH-PACK-AND-GO-CMD none')
      return
    }
    const resolved = await sessionController.resolveAgent(first.id)
    logLine(`DSH-PACK-AND-GO-CMD-RESOLVE ${JSON.stringify(resolved && Object.keys(resolved))}`)
    const agent = resolved && (resolved.agent ?? resolved)
    const definition = ctx.commands.find(agent, 'mover')
    logLine(`DSH-PACK-AND-GO-CMD-FIND ${Boolean(definition)}`)
    const execution = await ctx.commands.execute(
      agent,
      '/mover list',
      [],
      new AbortController().signal,
    )
    logLine(
      `DSH-PACK-AND-GO-CMD-EXEC ${JSON.stringify(execution?.result ?? execution).slice(0, 300)}`,
    )
  } catch (error) {
    logLine(`DSH-PACK-AND-GO-CMD-FAILED ${error instanceof Error ? error.stack : String(error)}`)
  }
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {object} catalog
 */
async function runExportSelfTest(ctx, catalog) {
  const core = await import('../core/index.js')
  const { writeFile } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')

  const sessions = catalog.workspaces
    .flatMap((workspace) => workspace.sessions)
    .filter((session) => typeof session.locationPath === 'string')
  const first = sessions[0]
  if (!first) {
    console.log('DSH-PACK-AND-GO-EXPORT none')
    return
  }
  const packPath = `sessions/${first.id}/session.v4.jsonl.zstd`
  const plan = core.planExport({
    sessions: [{ packPath, sizeBytes: first.sizeBytes }],
    includeFiles: false,
  })
  const manifest = core.buildManifest({
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
  const pack = await core.buildPack({
    plan,
    sourcePaths: { [packPath]: first.locationPath },
    manifest,
  })
  const output = join(tmpdir(), 'dsh-pack-and-go-selftest.dshpack')
  await writeFile(output, pack)
  console.log(`DSH-PACK-AND-GO-EXPORT ${output} ${pack.length}`)
}

/**
 * 导入自检：读取 `DSH_PACK_AND_GO_SELFTEST_PACK` 并导入到 `DSH_PACK_AND_GO_SELFTEST_TARGET`。
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {object} beforeCatalog
 */
async function runImportSelfTest(ctx, beforeCatalog) {
  const { readFile } = await import('node:fs/promises')
  const { join } = await import('node:path')

  const packPath = process.env.DSH_PACK_AND_GO_SELFTEST_PACK
  const targetRoot = process.env.DSH_PACK_AND_GO_SELFTEST_TARGET
  if (!packPath || !targetRoot) {
    console.log('DSH-PACK-AND-GO-IMPORT skipped (missing pack/target env)')
    return
  }

  const core = await import('../core/index.js')
  const { registerWorkspaces } = await import('./register.js')

  const buffer = await readFile(packPath)
  const { entries } = core.readZip(buffer)
  const manifest = core.parseManifest(
    entries.find((entry) => entry.name === 'manifest.json').data.toString('utf8'),
  )

  const pathMap = { byKey: {} }
  for (const workspace of manifest.workspaces) {
    pathMap.byKey[workspace.key] = join(
      targetRoot,
      core.safeDirName(workspace.title, process.platform),
    )
  }

  const sessionRoot = join(process.env.DSH_HOME, 'sessions')
  const sessions = await core.importSessionsToDisk({ buffer, sessionRoot, pathMap })
  const workspaceEntries = entries
    .filter((entry) => entry.name.startsWith('workspaces/'))
    .map((entry) => ({ packPath: entry.name, data: entry.data }))
  const files = await core.restoreWorkspaceFiles({
    entries: workspaceEntries,
    pathMap,
    targetPlatform: process.platform,
  })
  const registered = await registerWorkspaces({
    workspaceRegistry: ctx.workspaceRegistry,
    workspaces: manifest.workspaces.map((workspace) => ({
      key: workspace.key,
      title: workspace.title,
      targetPath: pathMap.byKey[workspace.key],
    })),
  })

  console.log(
    `DSH-PACK-AND-GO-IMPORT ${JSON.stringify({
      sessions: sessions.written.length,
      skipped: sessions.skipped.length,
      files: files.written.length,
      dirs: files.dirs.length,
      registered: registered.registered.length,
      warnings: [...files.warnings, ...registered.warnings],
    })}`,
  )

  // 启动后导入不会触发 registry 的启动索引，这里把会话挂到对应工作区。
  const entityByKey = new Map(
    registered.registered.map((item) => [item.key, item.entity]),
  )
  let attached = 0
  const attachWarnings = []
  for (const written of sessions.written) {
    const source = manifest.sessions.find((item) => item.id === written.id)
    const key = source?.workspaceKey
    const entity = key !== undefined ? entityByKey.get(key) : undefined
    if (!entity || typeof entity.attachSession !== 'function') continue
    try {
      await entity.attachSession(written.targetId)
      attached += 1
    } catch (error) {
      attachWarnings.push(
        `挂载会话失败: ${written.targetId}（${error instanceof Error ? error.message : String(error)}）`,
      )
    }
  }
  if (attached > 0 || attachWarnings.length > 0) {
    console.log(
      `DSH-PACK-AND-GO-ATTACH ${JSON.stringify({ attached, warnings: attachWarnings })}`,
    )
  }

  const after = await loadCatalog({
    workspaceRegistry: ctx.workspaceRegistry,
    sessionPersistence: ctx.sessionPersistence,
    sessionQuery: typeof ctx.get === 'function' ? ctx.get('sessionQuery') : undefined,
    logger: ctx.logger,
  })
  console.log(
    `DSH-PACK-AND-GO-AFTER ${JSON.stringify({
      workspaces: after.workspaces.map((workspace) => ({
        title: workspace.title,
        path: workspace.path,
        sessions: workspace.sessions.length,
      })),
      ungrouped: after.ungrouped.length,
      totals: after.totals,
    })}`,
  )
}
