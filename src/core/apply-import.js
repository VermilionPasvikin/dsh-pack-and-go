/**
 * 导入落盘原语（T11.5，ADR-0019 §3）。
 *
 * 原子提交约定：
 * - 会话：先写入 `<home>/.sessions-import-tmp-<uuid>/<targetId>/session.vN.jsonl.zstd`，
 *   全部写完后逐个目录级 rename 到 `<sessions>/<projectKey>/<targetId>`；
 * - 工作区：目标目录不存在时写 `<root>/.workspace-import-tmp-<uuid>/` 再 rename；
 * - 覆盖：旧目录先移到备份根（或删除），成功才 rename 暂存目录；
 * - 任何一步失败都清理暂存目录，不留半成品（NFR-6）。
 *
 * 这些原语只做文件系统动作，不决定导入策略（策略见 `plan-import.js`）。
 */

import { randomUUID } from 'node:crypto'
import { access, mkdir, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * 统一的时间戳格式（备份目录与日志共用）。
 * @param {Date} [now]
 * @returns {string}
 */
export function timestampOf(now = new Date()) {
  return now.toISOString().replace(/[:.]/g, '-')
}

/**
 * 生成同卷暂存目录路径（点开头，避免被 DSH 当作项目/会话目录扫描）。
 * @param {string} parent 暂存目录的父目录（必须与目标同卷，rename 才是原子的）
 * @param {string} label
 * @returns {string}
 */
export function stagingPath(parent, label = 'import') {
  return join(parent, `.${label}-tmp-${randomUUID()}`)
}

/**
 * @param {string} path
 * @returns {Promise<boolean>}
 */
export async function pathExists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/**
 * 静默清理（不覆盖调用方真正的错误）。
 * @param {string} path
 * @returns {Promise<void>}
 */
export async function removeQuietly(path) {
  try {
    await rm(path, { recursive: true, force: true })
  } catch {
    // 清理失败只影响残留文件，不应掩盖原始异常
  }
}

/**
 * 目录级提交：把暂存目录 rename 到目标位置。
 *
 * 目标已存在时：
 * - 有 `backupDir` → 先 rename 到 `<backupDir>/<name>-previous-<stamp>`（保留完整旧目录）；
 * - 无 `backupDir` → 直接删除（调用方应已确认允许覆盖）。
 *
 * @param {{
 *   staging: string,
 *   target: string,
 *   backupDir?: string,
 *   name?: string,
 *   now?: Date
 * }} input
 * @returns {Promise<string | undefined>} 旧目录的备份路径（未覆盖时 undefined）
 */
export async function commitStagedDirectory(input) {
  const { staging, target, backupDir } = input
  const name = input.name ?? target.split(/[\\/]/).filter(Boolean).pop() ?? 'target'
  let backupPath
  if (await pathExists(target)) {
    if (backupDir) {
      await mkdir(backupDir, { recursive: true })
      backupPath = join(backupDir, `${name}-previous-${timestampOf(input.now)}`)
      await removeQuietly(backupPath)
      await rename(target, backupPath)
    } else {
      await rm(target, { recursive: true, force: true })
    }
  }
  await mkdir(dirname(target), { recursive: true })
  try {
    await rename(staging, target)
  } catch (error) {
    // 提交失败：把旧目录放回原位，避免「旧目录已挪走、新目录没到位」的半提交状态。
    if (backupPath !== undefined) {
      await removeQuietly(target)
      await rename(backupPath, target).catch(() => {})
    }
    throw error
  }
  return backupPath
}
