/**
 * 进度协议（Host → Client 的流式帧）。
 *
 * 帧结构固定、可 JSON 序列化；Client 只依赖这里的字段，不轮询。
 */

import { EXPORT_STAGES, IMPORT_STAGES } from './constants.js'
import { ERROR_CODES, MoverError } from './errors.js'

/** 全部阶段名（导出 + 导入）。 */
export const ALL_STAGES = Object.freeze([...EXPORT_STAGES, ...IMPORT_STAGES])

/** 帧状态。 */
export const PROGRESS_STATUS = Object.freeze(['running', 'success', 'error', 'cancelled'])

/**
 * @param {string} message
 * @param {Record<string, unknown>} [details]
 * @returns {MoverError}
 */
function progressError(message, details = {}) {
  return new MoverError(ERROR_CODES.PROGRESS_INVALID, message, details)
}

function isNonNegativeInt(value) {
  return Number.isSafeInteger(value) && value >= 0
}

/**
 * 构造一个进度帧（校验后冻结）。
 * @param {{
 *   taskId: string,
 *   stage: string,
 *   status?: 'running'|'success'|'error'|'cancelled',
 *   done?: number,
 *   total?: number,
 *   bytesDone?: number,
 *   bytesTotal?: number,
 *   message?: string,
 *   error?: object
 * }} input
 * @returns {Readonly<object>}
 */
export function createProgressEvent(input) {
  const {
    taskId,
    stage,
    status = 'running',
    done = 0,
    total = 0,
    bytesDone = 0,
    bytesTotal = 0,
    message,
    error,
  } = input

  if (typeof taskId !== 'string' || taskId.length === 0) {
    throw progressError('taskId 必须是非空字符串')
  }
  if (!ALL_STAGES.includes(stage)) {
    throw progressError(`未知进度阶段: ${String(stage)}`)
  }
  if (!PROGRESS_STATUS.includes(status)) {
    throw progressError(`未知进度状态: ${String(status)}`)
  }
  for (const [name, value] of Object.entries({ done, total, bytesDone, bytesTotal })) {
    if (!isNonNegativeInt(value)) {
      throw progressError(`${name} 必须是非负整数`, { field: name, value })
    }
  }
  if (total > 0 && done > total) {
    throw progressError('done 不能大于 total', { done, total })
  }
  if (bytesTotal > 0 && bytesDone > bytesTotal) {
    throw progressError('bytesDone 不能大于 bytesTotal', { bytesDone, bytesTotal })
  }
  if (message !== undefined && typeof message !== 'string') {
    throw progressError('message 必须是字符串')
  }

  return Object.freeze({
    taskId,
    stage,
    status,
    done,
    total,
    bytesDone,
    bytesTotal,
    ...(message !== undefined ? { message } : {}),
    ...(error !== undefined ? { error } : {}),
  })
}

/**
 * 计算百分比（0-100）。
 * @param {{ done: number, total: number, status: string }} event
 * @returns {number}
 */
export function progressPercent(event) {
  if (event.status === 'success') return 100
  if (!event.total) return 0
  return Math.min(100, Math.max(0, Math.round((event.done / event.total) * 100)))
}

/**
 * @param {object} event
 * @returns {string}
 */
export function serializeProgress(event) {
  return JSON.stringify(event)
}

/**
 * @param {string} text
 * @returns {object}
 */
export function parseProgress(text) {
  let value
  try {
    value = JSON.parse(text)
  } catch {
    throw progressError('进度帧不是合法 JSON')
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw progressError('进度帧必须是对象')
  }
  for (const field of ['taskId', 'stage', 'status']) {
    if (typeof value[field] !== 'string') {
      throw progressError(`进度帧缺少 ${field}`)
    }
  }
  if (!ALL_STAGES.includes(value.stage)) {
    throw progressError(`未知进度阶段: ${value.stage}`)
  }
  if (!PROGRESS_STATUS.includes(value.status)) {
    throw progressError(`未知进度状态: ${value.status}`)
  }
  return value
}
