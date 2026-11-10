/**
 * 统一错误类型与错误码。
 * 完整错误码表在 T1.15 收敛；这里先定义 manifest 校验所需的最小集合。
 */

/** 项目内所有可预期错误的基类，`code` 稳定、可被 UI 映射为中文建议。 */
export class MoverError extends Error {
  /**
   * @param {string} code 稳定错误码（`E_*`）
   * @param {string} message 面向开发者的英文说明
   * @param {Record<string, unknown>} [details] 定位信息（字段路径、文件等）
   */
  constructor(code, message, details = {}) {
    super(message)
    this.name = new.target.name
    this.code = code
    this.details = details
  }
}

/** manifest 结构/版本错误。 */
export class ManifestError extends MoverError {}

/** 稳定错误码（只追加，不复用）。 */
export const ERROR_CODES = Object.freeze({
  MANIFEST_INVALID: 'E_MANIFEST_INVALID',
  MANIFEST_VERSION_TOO_NEW: 'E_MANIFEST_VERSION_TOO_NEW',
  MANIFEST_VERSION_UNSUPPORTED: 'E_MANIFEST_VERSION_UNSUPPORTED',
  SESSION_FRAME_INVALID: 'E_SESSION_FRAME_INVALID',
  SESSION_HEADER_INVALID: 'E_SESSION_HEADER_INVALID',
  SESSION_VERSION_UNSUPPORTED: 'E_SESSION_VERSION_UNSUPPORTED',
  PATH_INVALID: 'E_PATH_INVALID',
  PREFLIGHT_INVALID: 'E_PREFLIGHT_INVALID',
  SCAN_INVALID: 'E_SCAN_INVALID',
  PACK_INVALID: 'E_PACK_INVALID',
  PLAN_INVALID: 'E_PLAN_INVALID',
  PROGRESS_INVALID: 'E_PROGRESS_INVALID',
  CATALOG_INVALID: 'E_CATALOG_INVALID',
  REBUILD_FAILED: 'E_REBUILD_FAILED',
})

/**
 * 每个错误码对应的中文说明与下一步建议（面向 0 技术背景用户）。
 * key 必须与 ERROR_CODES 的值一一对应（单测校验）。
 */
export const ERROR_MESSAGES = Object.freeze({
  E_MANIFEST_INVALID: {
    title: '迁移包清单格式不正确',
    next: '请确认文件完整，或让来源方使用当前版本重新导出',
  },
  E_MANIFEST_VERSION_TOO_NEW: {
    title: '迁移包版本高于本机插件',
    next: '请先升级本机 DSH 插件，再重新导入',
  },
  E_MANIFEST_VERSION_UNSUPPORTED: {
    title: '迁移包版本过旧',
    next: '请让来源方使用当前版本重新导出',
  },
  E_SESSION_FRAME_INVALID: {
    title: '会话日志损坏或截断',
    next: '请重新导出该对话；若持续出现，请附上诊断信息',
  },
  E_SESSION_HEADER_INVALID: {
    title: '会话头无法解析',
    next: '请重新导出该对话',
  },
  E_SESSION_VERSION_UNSUPPORTED: {
    title: '会话格式版本不受支持',
    next: '跨版本导入需要目标机支持该会话格式，请升级 DSH 后重试',
  },
  E_PATH_INVALID: {
    title: '路径无效',
    next: '请检查目标位置是否为合法路径',
  },
  E_PREFLIGHT_INVALID: {
    title: '平台预检失败',
    next: '请确认工作区可读，且目标平台受支持',
  },
  E_SCAN_INVALID: {
    title: '工作区扫描失败',
    next: '请确认工作区存在且可读',
  },
  E_PACK_INVALID: {
    title: '迁移包损坏或被篡改',
    next: '请重新拷贝文件；若仍失败，请让来源方重新导出',
  },
  E_PLAN_INVALID: {
    title: '打包/导入计划无效',
    next: '请检查选择内容与目标路径后重试',
  },
  E_PROGRESS_INVALID: {
    title: '进度数据异常',
    next: '请重试；若持续出现，请导出诊断信息并反馈',
  },
  E_CATALOG_INVALID: {
    title: '无法读取工作区或会话列表',
    next: '请确认 DSH 正在运行且数据可读，然后重试',
  },
  E_REBUILD_FAILED: {
    title: '会话重建失败',
    next: '请确认目标 DSH 支持该会话格式，或改用同版本迁移',
  },
})

/**
 * 把任意错误转换为可展示的中文描述。
 * @param {unknown} error
 * @returns {{ code: string, title: string, next: string, message: string }}
 */
export function describeError(error) {
  const code =
    error !== null && typeof error === 'object' && typeof error.code === 'string'
      ? error.code
      : 'E_UNKNOWN'
  const known = ERROR_MESSAGES[code]
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : String(error)
  if (known) {
    return { code, title: known.title, next: known.next, message }
  }
  return {
    code: 'E_UNKNOWN',
    title: '操作失败',
    next: '请重试；若持续出现，请导出诊断信息并反馈',
    message,
  }
}
