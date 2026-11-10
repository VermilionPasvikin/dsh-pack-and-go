/**
 * 导入编排：读包 → 计划 → 会话写盘（T2.6）。
 *
 * 首版聚焦会话写盘；附件（T2.8）与工作区文件/登记（T2.9）在后续任务实现。
 * 写盘前先做 manifest 校验、冲突计划与 cwd 改写（ADR-0007 方案 A）。
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { ERROR_CODES, MoverError } from './errors.js'
import { parseManifest } from './manifest-io.js'
import { sessionDir } from './paths.js'
import { planImport } from './plan-import.js'
import { rewriteSessionCwd } from './session-rewrite.js'
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
 * 把迁移包中的会话写入目标磁盘。
 * @param {{
 *   buffer: Buffer,
 *   sessionRoot: string,
 *   pathMap: { byKey: Record<string, string> },
 *   existingSessionIds?: readonly string[],
 *   existingWorkspacePaths?: readonly string[],
 *   policy?: { session?: string, workspace?: string },
 *   preflight?: { risks?: Array<object> }
 * }} input
 * @returns {Promise<{
 *   manifest: object,
 *   plan: object,
 *   written: Array<{ id: string, path: string, cwd?: string, action: string }>,
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
    policy: input.policy,
    preflight: input.preflight,
  })

  const version = manifest.source.sessionFormat
  const written = []
  const skipped = []

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

    let finalData = packed
    if (session.targetCwd !== undefined) {
      finalData = rewriteSessionCwd(packed, session.targetCwd)
    }

    const dir = sessionDir(sessionRoot, session.targetCwd, session.id)
    const file = join(dir, sessionLogName(version))
    await mkdir(dir, { recursive: true })
    await writeFile(file, finalData)

    written.push({
      id: session.id,
      path: file,
      cwd: session.targetCwd,
      action: session.action,
    })
  }

  return { manifest, plan, written, skipped }
}
