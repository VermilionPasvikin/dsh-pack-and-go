/**
 * 长任务注册表（ADR-0021）。
 *
 * - 进程内存态：任务在后台执行，进度帧按顺序追加，客户端用 `poll(taskId, cursor)` 增量读取；
 * - 每个任务一个 `AbortController`，`cancel()` 置 `cancelled` 并中止；
 * - 已完成任务保留 `ttlMs`（默认 30 分钟）后清理，保证客户端刷新/重连后仍能拿到结果。
 *
 * 本模块不读写磁盘、不依赖 Cordis，可直接单测。
 */

import { randomUUID } from 'node:crypto'

import { ERROR_CODES, MoverError, describeError } from '../core/errors.js'

/** 任务状态。 */
export const TASK_STATUS = Object.freeze(['running', 'success', 'error', 'cancelled'])

/** 默认保留时长：30 分钟。 */
export const DEFAULT_TTL_MS = 30 * 60_000

/** 默认清理间隔：60 秒。 */
export const DEFAULT_PRUNE_INTERVAL_MS = 60_000

/**
 * @param {unknown} error
 * @returns {{ code?: string, title?: string, next?: string, message: string }}
 */
function serializeError(error) {
  const described = describeError(error)
  return {
    ...(described.code !== undefined ? { code: described.code } : {}),
    ...(described.title !== undefined ? { title: described.title } : {}),
    ...(described.next !== undefined ? { next: described.next } : {}),
    message: described.message,
  }
}

/**
 * @param {string} taskId
 * @returns {MoverError}
 */
function notFound(taskId) {
  return new MoverError(ERROR_CODES.TASK_NOT_FOUND, `任务不存在或已过期：${taskId}`, {
    reason: 'task-not-found',
    taskId,
  })
}

/**
 * 创建任务注册表。
 * @param {{ ttlMs?: number, pruneIntervalMs?: number, now?: () => number }} [options]
 */
export function createTaskRegistry(options = {}) {
  const ttlMs = Number.isSafeInteger(options.ttlMs) && options.ttlMs > 0
    ? options.ttlMs
    : DEFAULT_TTL_MS
  const pruneIntervalMs =
    Number.isSafeInteger(options.pruneIntervalMs) && options.pruneIntervalMs > 0
      ? options.pruneIntervalMs
      : DEFAULT_PRUNE_INTERVAL_MS
  const now = typeof options.now === 'function' ? options.now : Date.now

  /** @type {Map<string, { id: string, kind: string, title: string, status: string, frames: object[], result?: object, error?: object, startedAt: number, finishedAt?: number, controller: AbortController }>} */
  const tasks = new Map()

  function prune() {
    const cutoff = now() - ttlMs
    for (const [taskId, task] of tasks) {
      if (task.status === 'running') continue
      if (typeof task.finishedAt === 'number' && task.finishedAt <= cutoff) {
        tasks.delete(taskId)
      }
    }
  }

  const pruneTimer = setInterval(prune, pruneIntervalMs)
  // Node 侧不因注册表阻止进程退出；浏览器/其它宿主没有 unref 时忽略。
  if (typeof pruneTimer.unref === 'function') pruneTimer.unref()

  /**
   * 启动一个后台任务。
   * @param {{
   *   kind: string,
   *   title?: string,
   *   run: (context: { taskId: string, signal: AbortSignal, onProgress: (event: object) => void }) => Promise<object>
   * }} input
   * @returns {{ taskId: string }}
   */
  function start(input) {
    if (!input || typeof input.run !== 'function') {
      throw new MoverError(ERROR_CODES.PROGRESS_INVALID, 'start 需要 run 函数', {
        reason: 'run-missing',
      })
    }
    const kind = typeof input.kind === 'string' && input.kind.length > 0 ? input.kind : 'task'
    const taskId = `${kind}-${randomUUID()}`
    /** @type {any} */
    const task = {
      id: taskId,
      kind,
      title: typeof input.title === 'string' ? input.title : '',
      status: 'running',
      frames: [],
      startedAt: now(),
      controller: new AbortController(),
    }
    tasks.set(taskId, task)

    const onProgress = (event) => {
      if (!event || typeof event !== 'object') return
      if (task.status !== 'running') return
      task.frames.push(event)
    }

    // 后台执行：不 await，调用方立刻拿到 taskId；完成/失败写回任务状态。
    void Promise.resolve()
      .then(() => input.run({ taskId, signal: task.controller.signal, onProgress }))
      .then((result) => {
        if (task.status === 'cancelled') {
          task.result = undefined
        } else {
          task.status = 'success'
          task.result = result
        }
        task.finishedAt = now()
      })
      .catch((error) => {
        const code = error && typeof error === 'object' ? error.code : undefined
        if (task.status === 'cancelled' || code === ERROR_CODES.TASK_CANCELLED) {
          task.status = 'cancelled'
          task.error = serializeError(
            new MoverError(ERROR_CODES.TASK_CANCELLED, '操作已取消', { reason: 'cancelled' }),
          )
        } else {
          task.status = 'error'
          task.error = serializeError(error)
        }
        task.finishedAt = now()
      })

    return { taskId }
  }

  /**
   * 增量读取任务。
   * @param {string} taskId
   * @param {number} [cursor]
   */
  function poll(taskId, cursor = 0) {
    const task = tasks.get(taskId)
    if (!task) throw notFound(taskId)
    const from = Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : 0
    const frames = task.frames.slice(from)
    const payload = {
      taskId: task.id,
      kind: task.kind,
      title: task.title,
      status: task.status,
      frames,
      nextCursor: task.frames.length,
      startedAt: task.startedAt,
      ...(task.finishedAt !== undefined ? { finishedAt: task.finishedAt } : {}),
    }
    if (task.status === 'success' && task.result !== undefined) payload.result = task.result
    if ((task.status === 'error' || task.status === 'cancelled') && task.error !== undefined) {
      payload.error = task.error
    }
    return payload
  }

  /**
   * 请求取消（尽力而为）。
   * @param {string} taskId
   */
  function cancel(taskId) {
    const task = tasks.get(taskId)
    if (!task) throw notFound(taskId)
    if (task.status !== 'running') {
      return { taskId, cancelled: false, status: task.status }
    }
    task.status = 'cancelled'
    task.error = serializeError(
      new MoverError(ERROR_CODES.TASK_CANCELLED, '操作已取消', { reason: 'cancelled' }),
    )
    task.controller.abort(new MoverError(ERROR_CODES.TASK_CANCELLED, '操作已取消'))
    return { taskId, cancelled: true, status: task.status }
  }

  /** 列出任务元数据（不含帧内容与结果）。 */
  function list() {
    return [...tasks.values()].map((task) => ({
      taskId: task.id,
      kind: task.kind,
      title: task.title,
      status: task.status,
      startedAt: task.startedAt,
      ...(task.finishedAt !== undefined ? { finishedAt: task.finishedAt } : {}),
      frameCount: task.frames.length,
    }))
  }

  function dispose() {
    clearInterval(pruneTimer)
    tasks.clear()
  }

  return { start, poll, cancel, list, dispose, prune }
}
