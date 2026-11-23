/**
 * npm registry 访问（零依赖，Node 内置 fetch）。
 *
 * - fetchPackument(name)：包元数据（含 versions / dist-tags）
 * - fetchTarball(name, version, cacheDir)：下载 .tgz（带缓存与完整性校验）
 * - resolveRange(versions, range)：把 ~ / ^ / 精确版本解析为具体版本
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const REGISTRY = 'https://registry.npmjs.org'

/**
 * @param {string} name 包名（scoped 会自动转义）
 * @returns {Promise<object>} packument
 */
export async function fetchPackument(name) {
  const url = `${REGISTRY}/${name.replace('/', '%2F')}`
  // abbreviated metadata：体积小、含 versions[*].dependencies，足够版本解析
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: { accept: 'application/vnd.npm.install-v1+json' },
        signal: AbortSignal.timeout(30_000),
      })
      if (!res.ok) throw new Error(`registry HTTP ${res.status}: ${url}`)
      return await res.json()
    } catch (error) {
      if (attempt === 2) throw error
    }
  }
}

/**
 * 下载 tarball 到缓存目录；命中缓存时校验 sha512（integrity）。
 * @param {string} name 包名
 * @param {string} version 具体版本
 * @param {string} cacheDir 缓存目录（不存在则创建）
 * @param {string} [integrity] registry 的 dist.integrity（sha512-…）
 * @returns {Promise<{ path: string, cached: boolean }>}
 */
export async function fetchTarball(name, version, cacheDir, integrity) {
  const safeName = name.replace('/', '__')
  const file = join(cacheDir, `${safeName}@${version}.tgz`)
  // registry integrity 形如 "sha512-<base64>"；比较时剥离算法前缀
  const expected = integrity ? integrity.replace(/^[A-Za-z0-9]+-/, '') : undefined

  if (existsSync(file)) {
    const buf = readFileSync(file)
    if (expected) {
      const hash = sha512Base64(buf)
      if (hash !== expected) {
        throw new Error(
          `${name}@${version}: 缓存校验失败（缓存 ${hash.slice(0, 12)}… ≠ integrity ${expected.slice(0, 12)}…）；请删除 ${file} 后重试`,
        )
      }
    }
    return { path: file, cached: true }
  }

  const packument = await fetchPackument(name)
  const entry = packument.versions?.[version]
  if (!entry?.dist?.tarball) throw new Error(`${name}@${version}: registry 无此版本或 tarball URL`)

  mkdirSync(cacheDir, { recursive: true })
  const res = await fetch(entry.dist.tarball, {
    redirect: 'follow',
    signal: AbortSignal.timeout(120_000),
  })
  if (!res.ok) throw new Error(`${name}@${version}: 下载失败 HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())

  if (expected) {
    const hash = sha512Base64(buf)
    if (hash !== expected) {
      throw new Error(`${name}@${version}: 下载内容与 registry integrity 不符`)
    }
  }
  writeFileSync(file, buf)
  return { path: file, cached: false }
}

/** @param {Buffer} buf @returns {string} base64 编码的 sha512 */
export function sha512Base64(buf) {
  return createHash('sha512').update(buf).digest('base64')
}

/**
 * 把 semver range 解析为具体版本。
 *
 * 支持范围（本插件关注的上游依赖只用到这些）：
 * - 精确：`0.2.2-rc.2`
 * - 波浪：`~4.1.0` → 4.1.x 中最新
 * - 脱字符：`^4.1.0` → 4.x.y 中最新
 * - 前缀：`4.1` → 4.1.x 中最新
 *
 * 候选版本按 packument.versions 的发布顺序取最后一个（npm 对该顺序的最新发布）。
 * @param {Record<string, object>} versions packument.versions
 * @param {string} range
 * @returns {string} 具体版本；解析失败抛错
 */
/**
 * 比较两个版本号的数值部分（忽略 prerelease 标记）。
 * @param {string} a
 * @param {string} b
 * @returns {number} a>b:1、a<b:-1、相等:0
 */
export function compareSemver(a, b) {
  const ap = a.split('-')[0].split('.').map((part) => Number.parseInt(part, 10))
  const bp = b.split('-')[0].split('.').map((part) => Number.parseInt(part, 10))
  for (let i = 0; i < 3; i += 1) {
    const av = ap[i] ?? 0
    const bv = bp[i] ?? 0
    if (av > bv) return 1
    if (av < bv) return -1
  }
  return 0
}

/**
 * 把 semver range 解析为具体版本。
 *
 * 支持范围（本插件关注的上游依赖只用到这些）：
 * - 精确：`0.2.2-rc.2`
 * - 波浪：`~4.1.0` / `~4.1` → 4.1.x 中最新
 * - 脱字符：`^4.1.0` → 4.x.y 中最新
 * - 前缀：`4.1` → 4.1.x 中最新
 * - 比较：`>=13.7.0`、`>13.7.0`、`<=13.7.0`、`<13.7.0` → 满足条件的最新发布
 *
 * 候选版本按 packument.versions 的发布顺序取最后一个；range 不含
 * prerelease 时排除 prerelease 版本（严格 semver 语义）。
 * @param {Record<string, object>} versions packument.versions
 * @param {string} range
 * @returns {string} 具体版本；解析失败抛错
 */
export function resolveRange(versions, range) {
  const keys = Object.keys(versions)
  if (keys.length === 0) throw new Error(`resolveRange: 包没有任何已发布版本（range=${range}）`)
  if (range in versions) return range

  const rangeHasPrerelease = range.includes('-')
  const usable = keys.filter((key) => rangeHasPrerelease || !key.includes('-'))
  if (usable.length === 0) {
    throw new Error(`resolveRange: 无可用版本满足 range=${range}（候选均为 prerelease）`)
  }

  const pickLatest = (matches) => {
    if (matches.length === 0) {
      throw new Error(`resolveRange: 无版本满足 range=${range}（候选 ${usable.length} 个）`)
    }
    return matches.at(-1)
  }

  // 比较运算符
  if (range.startsWith('>=') || range.startsWith('<=') || range.startsWith('>') || range.startsWith('<')) {
    const op = range.startsWith('>=') ? '>=' : range.startsWith('<=') ? '<=' : range.startsWith('>') ? '>' : '<'
    const core = range.slice(op === '>' || op === '<' ? 1 : 2)
    const matches = usable.filter((key) => {
      const cmp = compareSemver(key, core)
      if (op === '>=') return cmp >= 0
      if (op === '>') return cmp > 0
      if (op === '<=') return cmp <= 0
      return cmp < 0
    })
    return pickLatest(matches)
  }

  // 剥离前缀运算符，避免把 '~4' 解析成 NaN
  let operator = null
  let core = range
  if (core.startsWith('~') || core.startsWith('^')) {
    operator = core[0]
    core = core.slice(1)
  }
  const parts = core.split('.').map((part) => Number.parseInt(part, 10))
  const major = parts[0]
  const minor = parts[1] ?? 0
  if (!Number.isFinite(major)) {
    throw new Error(`resolveRange: 无法解析 range=${range}`)
  }

  const matches = usable.filter((key) => {
    const keyParts = key.split('.').map((part) => Number.parseInt(part, 10))
    if (!Number.isFinite(keyParts[0]) || !Number.isFinite(keyParts[1])) return false
    if (operator === '~') return keyParts[0] === major && keyParts[1] === minor
    if (operator === '^') {
      return keyParts[0] === major && (keyParts[1] > minor || (keyParts[1] === minor && (keyParts[2] ?? 0) >= (parts[2] ?? 0)))
    }
    // 无运算符：'x.y' 前缀形式
    return keyParts[0] === major && (parts.length < 2 || keyParts[1] === minor)
  })
  return pickLatest(matches)
}
