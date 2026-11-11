/**
 * 导入编排：读包 → 计划 → 会话写盘（T2.6/T2.7）。
 *
 * 会话动作：
 * - import：写入目标目录；
 * - skip：不写；
 * - overwrite：先备份已有文件，再覆盖；
 * - new-id：生成新 session id，改写 header.id 后写入新目录。
 *
 * 附件（T2.8）与工作区文件/登记（T2.9）在后续任务实现。
 */

import { randomUUID } from 'node:crypto'
import { access, copyFile, mkdir, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import { ERROR_CODES, MoverError } from './errors.js'
import { parseManifest } from './manifest-io.js'
import { sessionDir } from './paths.js'
import { planImport } from './plan-import.js'
import { rewriteSessionHeader } from './session-rewrite.js'
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
 *   written: Array<{ id: string, targetId: string, path: string, cwd?: string, action: string, backupPath?: string }>,
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
    if (session.action === 'new-id') patch.id = targetId
    // fork 链：父会话若也在包内且目标 id 变化，则改写 parentSession 指向目标父 id。
    if (typeof source.parentSessionId === 'string') {
      const mappedParent = targetIdById.get(source.parentSessionId)
      patch.parentSession = mappedParent ?? source.parentSessionId
    }
    const finalData =
      Object.keys(patch).length > 0 ? rewriteSessionHeader(packed, patch) : packed

    let backupPath
    if (session.action === 'overwrite' && backupDir) {
      backupPath = await backupExisting(file, backupDir)
    }

    await mkdir(dir, { recursive: true })
    await writeFile(file, finalData)

    written.push({
      id: session.id,
      targetId,
      path: file,
      cwd: effectiveCwd,
      action: session.action,
      ...(backupPath !== undefined ? { backupPath } : {}),
    })
  }

  return { manifest, plan, written, skipped }
}
