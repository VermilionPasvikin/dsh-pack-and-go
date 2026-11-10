/**
 * 复刻 DSH 的会话目录路径规则。
 *
 * 来源：`packages/session/session-persistence-jsonl/src/format.ts`
 * （deepseek-ai/deepseek-harness, master；本地安装版本 0.2.1-rc.5 一致）。
 *
 * 规则要点：
 * - `encodeSegment`：只保留 `[A-Za-z0-9._-]`，其余按 JS UTF-16 code unit 转 `~XXXX`；
 *   `.`/`..` 特殊处理；`~` 自身也转义。
 * - `projectKey`：`/`、`\`、`:` 折叠为 `-`（连续合并），其余非法字符 `~XXXX`，
 *   去掉前导 `-`，空则 `root`，截断 251，外层包 `--…--`。
 * - `undefined` 的 cwd 使用 `_no-cwd`。
 *
 * 这两条规则是跨平台目录名兼容的基础，必须与官方逐字一致。
 */

import { join } from 'node:path'

import { ERROR_CODES, MoverError } from './errors.js'

const SAFE_CHAR = /^[A-Za-z0-9._-]$/

/**
 * @param {unknown} value
 * @param {string} label
 * @returns {asserts value is string}
 */
function assertNonEmptyString(value, label) {
  if (typeof value !== 'string') {
    throw new MoverError(ERROR_CODES.PATH_INVALID, `${label} 必须是字符串`, { label })
  }
  if (value.length === 0) {
    throw new MoverError(ERROR_CODES.PATH_INVALID, `${label} 不能为空`, { label })
  }
}

/**
 * 把一个任意字符串编码成单个安全路径段（可逆）。
 * @param {string} raw
 * @returns {string}
 */
export function encodeSegment(raw) {
  assertNonEmptyString(raw, 'path segment')
  if (raw === '.') return '~002E'
  if (raw === '..') return '~002E~002E'

  let out = ''
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch !== '~' && SAFE_CHAR.test(ch)) {
      out += ch
    } else {
      out += `~${code.toString(16).toUpperCase().padStart(4, '0')}`
    }
  }
  return out
}

/**
 * 由 cwd 生成可读的项目目录名（`--…--`）。
 * @param {string} cwd
 * @returns {string}
 */
export function projectKey(cwd) {
  assertNonEmptyString(cwd, 'project path')

  let readable = ''
  let separatorRun = false
  for (let i = 0; i < cwd.length; i += 1) {
    const code = cwd.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (ch !== '~' && SAFE_CHAR.test(ch)) {
      readable += ch
      separatorRun = false
    } else {
      readable += `~${code.toString(16).toUpperCase().padStart(4, '0')}`
      separatorRun = false
    }
  }
  const slug = readable.replace(/^-+/, '') || 'root'
  return `--${slug.slice(0, 251)}--`
}

/**
 * 项目目录的绝对路径（`undefined` 的 cwd 使用 `_no-cwd`）。
 * @param {string} root 会话根目录
 * @param {string | undefined} cwd
 * @returns {string}
 */
export function projectDir(root, cwd) {
  if (cwd === undefined) return join(root, '_no-cwd')
  return join(root, projectKey(cwd))
}

/**
 * 某个会话的目录路径。
 * @param {string} root
 * @param {string | undefined} cwd
 * @param {string} id
 * @returns {string}
 */
export function sessionDir(root, cwd, id) {
  return join(projectDir(root, cwd), encodeSegment(id))
}
