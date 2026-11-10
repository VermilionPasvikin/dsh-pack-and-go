/**
 * 备份事务（T2.10）。
 *
 * 导入前对将被覆盖的文件建立备份；导入失败时按记录回滚：
 * - 原本存在的文件：从备份复制回去；
 * - 原本不存在的文件：删除新写入的文件。
 *
 * 备份目录：`<backupRoot>/<时间戳>/`（SPEC FR-10：`<DSH_HOME>/backups/mover/<时间戳>/`）。
 */

import { access, copyFile, mkdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { ERROR_CODES, MoverError } from './errors.js'

/**
 * @param {string} message
 * @param {Record<string, unknown>} [details]
 * @returns {MoverError}
 */
function backupError(message, details = {}) {
  return new MoverError(ERROR_CODES.PACK_INVALID, message, details)
}

/**
 * 创建一次导入的备份事务。
 * @param {{ backupRoot: string, now?: Date }} input
 * @returns {{
 *   dir: string,
 *   records: Array<{ sourcePath: string, backupPath?: string, existed: boolean }>,
 *   track(sourcePath: string, label?: string): Promise<{ existed: boolean, backupPath?: string }>,
 *   rollback(): Promise<{ restored: number, failures: Array<{ path: string, reason: string }> }>
 * }}
 */
export function createBackupTransaction(input) {
  const { backupRoot, now = new Date() } = input ?? {}
  if (typeof backupRoot !== 'string' || backupRoot.length === 0) {
    throw backupError('缺少 backupRoot')
  }

  const stamp = now.toISOString().replace(/[:.]/g, '-')
  const dir = join(backupRoot, stamp)
  /** @type {Array<{ sourcePath: string, backupPath?: string, existed: boolean }>} */
  const records = []

  return {
    dir,
    records,

    async track(sourcePath, label) {
      if (typeof sourcePath !== 'string' || sourcePath.length === 0) {
        throw backupError('track 需要非空 sourcePath')
      }
      const safeLabel = String(label ?? sourcePath).replace(/[\\/]/g, '_')
      let existed = true
      try {
        await access(sourcePath)
      } catch {
        existed = false
      }

      let backupPath
      if (existed) {
        await mkdir(dir, { recursive: true })
        backupPath = join(dir, safeLabel)
        await copyFile(sourcePath, backupPath)
      }
      const record = { sourcePath, backupPath, existed }
      records.push(record)
      return { existed, backupPath }
    },

    async rollback() {
      const failures = []
      let restored = 0
      for (const record of [...records].reverse()) {
        try {
          if (record.existed && record.backupPath !== undefined) {
            await mkdir(dirname(record.sourcePath), { recursive: true })
            await copyFile(record.backupPath, record.sourcePath)
          } else {
            await rm(record.sourcePath, { force: true })
          }
          restored += 1
        } catch (error) {
          failures.push({
            path: record.sourcePath,
            reason: error instanceof Error ? error.message : String(error),
          })
        }
      }
      return { restored, failures }
    },
  }
}
