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
})
