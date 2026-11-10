/**
 * 跨版本会话重建（ADR-0007 方案 C）。
 *
 * 旧格式会话由 `sessionPersistence.open(id, 'read')` 读取——后端会在内存中
 * 完成历史格式迁移并返回**当前逻辑事件**；再用 `create(新 header)` + `append(events)`
 * 交给官方后端重新写盘。这样不手写 zstd 帧，跨版本也能正确迁移。
 */

import { randomUUID } from 'node:crypto'

import { SESSION_FORMAT_VERSION } from '../core/constants.js'
import { ERROR_CODES, MoverError } from '../core/errors.js'

/**
 * @param {string} message
 * @param {Record<string, unknown>} [details]
 * @returns {MoverError}
 */
function rebuildError(message, details = {}) {
  return new MoverError(ERROR_CODES.REBUILD_FAILED, message, details)
}

/**
 * 用 Host 服务重建一个会话。
 * @param {{
 *   sessionPersistence: {
 *     open(id: string, access: 'read'|'write', options?: object): Promise<{
 *       read(offset?: number, length?: number): Promise<{ events: readonly object[] }>,
 *       close(): Promise<void>
 *     }>,
 *     create(header: object, options?: object): Promise<{
 *       append(events: readonly object[]): Promise<void>,
 *       flush(): Promise<void>,
 *       close(): Promise<void>
 *     }>
 *   },
 *   sourceId: string,
 *   newId?: string,
 *   newCwd?: string,
 *   createdAt?: number,
 *   logger?: { warn?: (...args: unknown[]) => void }
 * }} input
 * @returns {Promise<{ id: string, events: number, cwd?: string }>}
 */
export async function rebuildSessionViaService(input) {
  const { sessionPersistence, sourceId } = input
  if (!sessionPersistence || typeof sessionPersistence.open !== 'function') {
    throw rebuildError('缺少 sessionPersistence.open')
  }
  if (typeof sessionPersistence.create !== 'function') {
    throw rebuildError('缺少 sessionPersistence.create')
  }
  if (typeof sourceId !== 'string' || sourceId.length === 0) {
    throw rebuildError('缺少 sourceId')
  }

  const readHandle = await sessionPersistence.open(sourceId, 'read')
  let events
  try {
    const result = await readHandle.read()
    events = result.events
  } finally {
    await readHandle.close()
  }

  const newId = input.newId ?? `session-${randomUUID()}`
  const header = {
    version: SESSION_FORMAT_VERSION,
    id: newId,
    createdAt: input.createdAt ?? Date.now(),
    isSeeded: false,
    delegationDepth: 0,
    ...(input.newCwd !== undefined ? { cwd: input.newCwd } : {}),
  }

  const writeHandle = await sessionPersistence.create(header)
  try {
    if (events.length > 0) {
      await writeHandle.append(events)
    }
    await writeHandle.flush()
  } finally {
    await writeHandle.close()
  }

  return {
    id: newId,
    events: events.length,
    ...(input.newCwd !== undefined ? { cwd: input.newCwd } : {}),
  }
}
