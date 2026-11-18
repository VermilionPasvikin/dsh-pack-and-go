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
import { access, copyFile, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import { ERROR_CODES, MoverError } from './errors.js'
import { parseManifest } from './manifest-io.js'
import { sessionDir } from './paths.js'
import { planImport } from './plan-import.js'
import {
  normalizeSessionAgentState,
  rewriteSessionFileReferences,
  rewriteSessionHeader,
  rewriteSessionWorkingDirectories,
} from './session-rewrite.js'
import { readZip } from './zip-reader.js'

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

  const { entries } = readZip(buffer)
  const byName = new Map(entries.map((entry) => [entry.name, entry.data]))

  const manifestEntry = byName.get('manifest.json')
  if (!manifestEntry) {
    throw importError('迁移包缺少 manifest.json', { reason: 'no-manifest' })
  }
  const manifest = parseManifest(manifestEntry.toString('utf8'))
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
    const packed = byName.get(source.path)
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

    await mkdir(dir, { recursive: true })
    await writeFile(file, finalData)

    written.push({
      id: session.id,
      targetId,
      path: file,
      cwd: effectiveCwd,
      action: session.action,
      ...(session.migrateFrom !== undefined ? { migrateFrom: session.migrateFrom } : {}),
      ...(backupPath !== undefined ? { backupPath } : {}),
      ...(cwdEventsRewritten > 0 ? { cwdEventsRewritten } : {}),
      ...(fileRefsRewritten > 0 ? { fileRefsRewritten } : {}),
      ...(agentStateRewritten > 0 ? { agentStateRewritten } : {}),
    })
  }

  return { manifest, plan, written, skipped }
}
