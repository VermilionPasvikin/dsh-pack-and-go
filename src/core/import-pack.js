/**
 * 导入编排：读包 → 计划 → 会话写盘（T2.6/T2.7）。
 *
 * 会话动作：
 * - import：写入目标目录；
 * - skip：不写；
 * - overwrite：先备份已有文件，再覆盖；
 * - new-id：生成新 session id，改写 header.id 后写入新目录。
 *
 * 跨平台导入时，除 header.cwd 外还改写 working-directory/change 状态事件的
 * cwd（ADR-0017）；同平台保持字节保真（ADR-0007 方案 A）。
 *
 * 附件（T2.8）与工作区文件/登记（T2.9）在后续任务实现。
 */

import { randomUUID } from 'node:crypto'
import { existsSync, readdirSync } from 'node:fs'
import { access, copyFile, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import { ERROR_CODES, MoverError } from './errors.js'
import { commitStagedDirectory, removeQuietly, stagingPath } from './apply-import.js'
import { parseManifest } from './manifest-io.js'
import { sessionDir } from './paths.js'
import { planImport, planImportTargets } from './plan-import.js'
import {
  normalizeSessionAgentState,
  rewriteSessionFileReferences,
  rewriteSessionHeader,
  rewriteSessionWorkingDirectories,
} from './session-rewrite.js'
import { restoreWorkspaceFiles } from './workspaces.js'
import { listZip, readZipEntry } from './zip-reader.js'

/**
 * @param {string} message
 * @param {Record<string, unknown>} [details]
 * @returns {MoverError}
 */
function importError(message, details = {}) {
  return new MoverError(ERROR_CODES.PACK_INVALID, message, details)
}

/** 会话日志文件名前缀（vN + 压缩后缀）。 */
function sessionLogName(version) {
  return `session.v${version}.jsonl.zstd`
}

/**
 * 备份已存在的目标文件。
 * @param {string} file
 * @param {string} backupDir
 * @returns {Promise<string | undefined>}
 */
async function backupExisting(file, backupDir) {
  try {
    await access(file)
  } catch {
    return undefined
  }
  await mkdir(backupDir, { recursive: true })
  const dest = join(backupDir, `${basename(dirname(file))}-${basename(file)}`)
  await copyFile(file, dest)
  return dest
}

/**
 * 把迁移包中的会话写入目标磁盘。
 * @param {{
 *   buffer: Buffer,
 *   sessionRoot: string,
 *   pathMap: { byKey: Record<string, string> },
 *   targetPlatform?: 'win32' | 'darwin' | 'linux',
 *   existingSessionIds?: readonly string[],
 *   existingWorkspacePaths?: readonly string[],
 *   policy?: { session?: string, workspace?: string },
 *   preflight?: { risks?: Array<object> },
 *   backupRoot?: string,
 *   now?: Date
 * }} input
 * @returns {Promise<{
 *   manifest: object,
 *   plan: object,
 *   written: Array<{
 *     id: string,
 *     targetId: string,
 *     path: string,
 *     cwd?: string,
 *     action: string,
 *     backupPath?: string,
 *     cwdEventsRewritten?: number
 *   }>,
 *   skipped: string[]
 * }>}
 */
export async function importSessionsToDisk(input) {
  const { buffer, sessionRoot, pathMap } = input
  if (!Buffer.isBuffer(buffer)) {
    throw importError('importSessionsToDisk 需要 Buffer 输入')
  }
  if (typeof sessionRoot !== 'string' || sessionRoot.length === 0) {
    throw importError('缺少 sessionRoot')
  }

  // 只读中央目录定位 manifest，会话内容按需解压（NFR-6.5：大包不全量读入内存）。
  if (!listZip(buffer).some((meta) => meta.name === 'manifest.json')) {
    throw importError('迁移包缺少 manifest.json', { reason: 'no-manifest' })
  }
  const manifest = parseManifest(readZipEntry(buffer, 'manifest.json').data.toString('utf8'))
  const targetPlatform = input.targetPlatform ?? process.platform

  const plan = planImport({
    manifest,
    pathMap,
    existingSessionIds: input.existingSessionIds ?? [],
    existingWorkspacePaths: input.existingWorkspacePaths ?? [],
    existingCwdById: input.existingCwdById,
    policy: input.policy,
    preflight: input.preflight,
  })

  const version = manifest.source.sessionFormat
  const stamp = (input.now ?? new Date()).toISOString().replace(/[:.]/g, '-')
  const backupDir = input.backupRoot ? join(input.backupRoot, stamp) : undefined

  const written = []
  const skipped = []

  // 先分配目标 id，供 fork 链（parentSession）映射使用。
  const targetIdById = new Map()
  for (const session of plan.sessions) {
    if (session.action === 'skip') continue
    targetIdById.set(
      session.id,
      session.action === 'new-id' ? `session-${randomUUID()}` : session.id,
    )
  }

  for (const session of plan.sessions) {
    if (session.action === 'skip') {
      skipped.push(session.id)
      continue
    }

    const source = manifest.sessions.find((item) => item.id === session.id)
    if (!source) {
      throw importError(`manifest 中找不到会话条目: ${session.id}`, { id: session.id })
    }
    const packed = readZipEntry(buffer, source.path).data
    if (!packed) {
      throw importError(`包内缺少会话文件: ${source.path}`, { id: session.id, path: source.path })
    }

    const targetId = targetIdById.get(session.id)

    // DSH 要求会话文件所在目录与 header.cwd 一致（assertStoredIdentity）。
    // 未指定目标 cwd 时保留源 cwd 并按其计算目录；只有源与目标都无 cwd 才用 _no-cwd。
    const effectiveCwd = session.targetCwd ?? source.cwd
    const dir = sessionDir(sessionRoot, effectiveCwd, targetId)
    const file = join(dir, sessionLogName(version))

    const patch = {}
    if (session.targetCwd !== undefined) patch.cwd = session.targetCwd
    // fork 链：父会话若也在包内且目标 id 变化，则改写 parentSession 指向目标父 id。
    if (typeof source.parentSessionId === 'string') {
      const mappedParent = targetIdById.get(source.parentSessionId)
      patch.parentSession = mappedParent ?? source.parentSessionId
    }
    let finalData =
      Object.keys(patch).length > 0 ? rewriteSessionHeader(packed, patch) : packed

    // 跨平台时 working-directory/change 记录的是源平台绝对路径，DSH 的
    // workingDirectory 投影会在 isAbsolute 校验处拒绝它；它属于运行时状态，
    // 不是历史消息文本，必须随 cwd 一起迁移（ADR-0017）。
    let cwdEventsRewritten = 0
    if (session.targetCwd !== undefined && manifest.source.platform !== targetPlatform) {
      const result = rewriteSessionWorkingDirectories(finalData, {
        fromCwd: source.cwd,
        toCwd: session.targetCwd,
        sourcePlatform: manifest.source.platform,
        targetPlatform,
      })
      finalData = result.buffer
      cwdEventsRewritten = result.rewritten
    }

    // 重定位导入时 deliverables/presented 的绝对路径与 tool meta.cwd 仍指向源机器；
    // DSH 的「在工作区中查看」会按新 cwd 解析这些路径，必须改成目标端可解析的形式
    // （ADR-0017 补充，2026-11-18）。
    let fileRefsRewritten = 0
    if (session.targetCwd !== undefined && source.cwd !== session.targetCwd) {
      const refs = rewriteSessionFileReferences(finalData, {
        fromCwd: source.cwd,
        toCwd: session.targetCwd,
        sourcePlatform: manifest.source.platform,
        targetPlatform,
      })
      finalData = refs.buffer
      fileRefsRewritten = refs.rewritten
    }

    // 源机器的 auto 权限预设可能在目标 profile 不存在（DSH 恢复时报
    // "cannot restore preset auto"），跨平台导入时归一化为 workspace-write（ADR-0017 补充二）。
    let agentStateRewritten = 0
    if (manifest.source.platform !== targetPlatform) {
      const normalized = normalizeSessionAgentState(finalData)
      finalData = normalized.buffer
      agentStateRewritten = normalized.rewritten
    }

    let backupPath
    if (session.action === 'overwrite' && backupDir) {
      backupPath = await backupExisting(file, backupDir)
    }

    // ADR-0019 §3：单会话原子提交——先写暂存目录，成功后再目录级 rename；
    // 中途失败或进程被杀不会留下半个会话文件（NFR-6）。
    const staging = stagingPath(dirname(sessionRoot), 'session-import')
    let previousDir
    try {
      await mkdir(staging, { recursive: true })
      await writeFile(join(staging, sessionLogName(version)), finalData)

      // 迁移覆盖：先备份/移除旧位置同 id 目录，避免同一 id 出现两份（DSH 启动会失败）。
      if (typeof session.migrateFrom === 'string' && session.migrateFrom.length > 0) {
        const oldDir = sessionDir(sessionRoot, session.migrateFrom, targetId)
        try {
          await access(oldDir)
          if (backupDir) {
            await mkdir(backupDir, { recursive: true })
            await rename(oldDir, join(backupDir, `${targetId}-migrated`))
          } else {
            await rm(oldDir, { recursive: true, force: true })
          }
        } catch (error) {
          if (error.code !== 'ENOENT') throw error
        }
      }

      previousDir = await commitStagedDirectory({
        staging,
        target: dir,
        backupDir: input.backupRoot,
        name: targetId,
        now: input.now,
      })
    } catch (error) {
      await removeQuietly(staging)
      throw error
    }

    written.push({
      id: session.id,
      targetId,
      path: file,
      cwd: effectiveCwd,
      action: session.action,
      ...(session.migrateFrom !== undefined ? { migrateFrom: session.migrateFrom } : {}),
      ...(backupPath !== undefined ? { backupPath } : {}),
      ...(previousDir !== undefined ? { previousDir } : {}),
      ...(cwdEventsRewritten > 0 ? { cwdEventsRewritten } : {}),
      ...(fileRefsRewritten > 0 ? { fileRefsRewritten } : {}),
      ...(agentStateRewritten > 0 ? { agentStateRewritten } : {}),
    })
  }

  return { manifest, plan, written, skipped }
}

/**
 * 导入编排（host / CLI 共用；ADR-0019 §1/§4）。
 *
 * 顺序固定：读清单 → 四步判据规划（planImportTargets）→ 全部 fatal 预检 →
 * 会话原子提交（importSessionsToDisk）→ 工作区文件恢复（restoreWorkspaceFiles）。
 * 预检失败时不写任何文件（P1-1），预览与真实导入消费同一规划结果（FR-7）。
 *
 * @param {{
 *   buffer: Buffer,
 *   sessionRoot: string,
 *   targetRoot: string,
 *   platform?: 'win32' | 'darwin' | 'linux',
 *   registeredPathKeys?: readonly string[],
 *   exists?: (path: string) => boolean | Promise<boolean>,
 *   existsNonEmpty?: (path: string) => boolean | Promise<boolean>,
 *   reserved?: readonly string[],
 *   policy?: { session?: string, workspace?: string },
 *   existingSessionIds?: readonly string[],
 *   existingCwdById?: Map<string, string>,
 *   backupRoot?: string,
 *   now?: Date
 * }} input
 * @returns {Promise<{
 *   manifest: object,
 *   targets: Array<object>,
 *   conflicts: Array<object>,
 *   written: Array<object>,
 *   skipped: string[],
 *   workspaces: object
 * }>}
 */
export async function applyImport(input) {
  const {
    buffer,
    sessionRoot,
    targetRoot,
    platform = process.platform,
    registeredPathKeys = [],
    existingSessionIds = [],
    existingCwdById = new Map(),
    reserved = [],
    backupRoot,
    now,
  } = input
  if (!Buffer.isBuffer(buffer)) throw importError('applyImport 需要 Buffer 输入')
  if (typeof sessionRoot !== 'string' || sessionRoot.length === 0) {
    throw importError('缺少会话目录 sessionRoot', { reason: 'missing-session-root' })
  }
  if (typeof targetRoot !== 'string' || targetRoot.trim().length === 0) {
    throw importError('缺少目标目录 targetRoot', { reason: 'missing-target-root' })
  }

  const metas = listZip(buffer)
  if (!metas.some((meta) => meta.name === 'manifest.json')) {
    throw importError('迁移包缺少 manifest.json', { reason: 'no-manifest' })
  }
  const manifest = parseManifest(readZipEntry(buffer, 'manifest.json').data.toString('utf8'))

  // ① 规划：四步判据（ADR-0019 §2）。planImportTargets 是同步纯函数，
  // 默认探测用同步 fs（一次性探测已创建的路径）。
  const exists = typeof input.exists === 'function' ? input.exists : (path) => existsSync(path)
  const existsNonEmpty =
    typeof input.existsNonEmpty === 'function'
      ? input.existsNonEmpty
      : (path) => {
          try {
            return readdirSync(path).length > 0
          } catch {
            // 读不了按非空处理（宁可不复用）。
            return true
          }
        }
  const planned = await planImportTargets({
    manifest,
    targetRoot,
    platform,
    registeredPathKeys,
    exists,
    existsNonEmpty,
    reserved,
  })

  const pathMap = { byKey: {} }
  for (const target of planned.targets) {
    pathMap.byKey[target.workspaceKey] = target.path
  }

  // ② 预检：覆盖策略下「目标没有该会话登记」必须在写盘前失败（P1-1）。
  if ((input.policy?.session ?? 'skip') === 'overwrite') {
    const sessionPlan = planImport({
      manifest,
      pathMap,
      existingSessionIds,
      existingWorkspacePaths: registeredPathKeys,
      existingCwdById,
      policy: input.policy,
    })
    const unknown = sessionPlan.sessions.filter(
      (session) => session.action === 'overwrite' && !existingCwdById.has(session.id),
    )
    if (unknown.length > 0) {
      throw importError(
        `无法覆盖：${unknown.length} 个对话找不到现有位置（请改用「跳过」，或重启 DSH 后重试）。`,
        {
          reason: 'unknown-overwrite',
          ids: unknown.map((session) => session.id),
        },
      )
    }
  }

  // ③ 会话：单会话暂存 + 目录级 rename（ADR-0019 §3）。
  const sessions = await importSessionsToDisk({
    buffer,
    sessionRoot,
    pathMap,
    targetPlatform: platform,
    existingSessionIds,
    existingWorkspacePaths: registeredPathKeys,
    existingCwdById,
    policy: input.policy,
    backupRoot,
    now,
  })

  // ④ 工作区：只解压 workspaces/ 条目，覆盖前备份到 backupRoot（ADR-0020 §4）。
  // 空工作区没有文件条目，也要建目录（DSH 登记与侧边栏依赖目录存在）。
  for (const target of planned.targets) {
    if (target.action === 'skip') continue
    await mkdir(target.path, { recursive: true })
  }
  const workspaceEntries = []
  for (const meta of metas) {
    if (!meta.name.startsWith('workspaces/')) continue
    const entry = readZipEntry(buffer, meta.name)
    workspaceEntries.push({ packPath: entry.name, data: entry.data, mode: entry.mode })
  }
  const workspaces = await restoreWorkspaceFiles({
    entries: workspaceEntries,
    pathMap,
    targetPlatform: platform,
    sourcePlatform: manifest.source?.platform,
    backupRoot,
    now,
  })

  return {
    manifest,
    targets: planned.targets,
    conflicts: planned.conflicts,
    written: sessions.written,
    skipped: sessions.skipped,
    workspaces,
  }
}
