/**
 * 跨版本维护的共享配置。
 *
 * WATCH_PACKAGES：基线冻结与检出比对的对象。
 * 选取原则：本插件直接/间接依赖的 DSH 契约所在包（见 docs/UPSTREAM-COMPAT.md §2）：
 *   - dsh 聚合包（版本图 + CLI）
 *   - Cordis 内核与 loader/include（插件加载与 cordis.patch.yml 方言）
 *   - 会话格式、JSONL 持久化（sessions 目录、v4 header、zstd 帧）
 *   - workspace 存储（workspaceRegistry / storages/workspace.json）
 *   - 附件存储布局（attachments/v1）
 *   - DSH_HOME 路径布局
 *   - 会话查询（标题快照）
 *   - Client UI 运行时（slots / remote / ModuleLoader）
 *
 * 新增/减少依赖时，同时更新本清单、docs/UPSTREAM-COMPAT.md §2 与基线快照。
 */

import os from 'node:os'
import path from 'node:path'

/** @type {string[]} 基线冻结与检出比对的目标包 */
export const WATCH_PACKAGES = [
  '@deepseek-ai/dsh',
  '@deepseek-ai/cordis',
  '@deepseek-ai/cordis-plugin-loader',
  '@deepseek-ai/cordis-plugin-include',
  '@deepseek-ai/dsh-session-format',
  '@deepseek-ai/dsh-session-format-catalog',
  '@deepseek-ai/dsh-session-format-v3-to-v4',
  '@deepseek-ai/dsh-session-persistence-jsonl',
  '@deepseek-ai/dsh-workspace',
  '@deepseek-ai/dsh-attachment-local',
  '@deepseek-ai/dsh-home-paths',
  '@deepseek-ai/dsh-session-query-sqlite',
  '@deepseek-ai/dsh-client-ui-cordis',
  '@deepseek-ai/dsh-client-ui-chat',
]

/** 基线快照目录（相对仓库根）。 */
export const BASELINE_DIR = 'docs/compat/baseline'

/** tarball 下载缓存目录（每次运行自动创建；跨次运行复用）。 */
export const DEFAULT_CACHE_DIR = path.join(os.tmpdir(), 'dsh-compat-cache')

/** 上游 DSH 的开源仓库（语义对照与源码追溯用）。 */
export const DSH_REPO = 'deepseek-ai/deepseek-harness'

/** registry dist-tag：默认检出目标（latest 正式 / next 最新候选）。 */
export const DEFAULT_DIST_TAG = 'next'

/**
 * 契约文件过滤：只记录「契约相关」文件的签名，不镜像整个包。
 * - 记录：package.json、lib/ 与 src/ 下的 .js/.mjs/.cjs/.ts/.d.ts
 * - 排除：构建产物（dist/、*.map、*.min.js）、说明文件（README/LICENSE 等）
 * 依据：本插件依赖的是这些包暴露的服务/类型/格式实现（见 docs/UPSTREAM-COMPAT.md §2）。
 * @param {string} name tar 内条目路径（如 package/lib/foo.js）
 * @returns {boolean}
 */
export function isContractFile(name) {
  // tar 条目形如 package/lib/foo.js；先归一化去掉 package/ 前缀
  const rel = name.startsWith('package/') ? name.slice('package/'.length) : name
  const base = rel.split('/').at(-1) ?? rel
  const dir = rel.slice(0, rel.length - base.length)
  if (dir.startsWith('dist/')) return false
  if (name.endsWith('.map')) return false
  if (/\.min\.(js|css)$/.test(name)) return false
  if (base === 'package.json') return true
  const inLibOrSrc = dir === 'lib/' || dir.startsWith('lib/') || dir === 'src/' || dir.startsWith('src/')
  if (!inLibOrSrc) return false
  return /\.(js|mjs|cjs|ts|d\.ts)$/.test(base)
}

/**
 * 由 dsh 聚合包的依赖树解析出 WATCH_PACKAGES 的版本表。
 *
 * 方法：从 @deepseek-ai/dsh@<version> 出发，沿 dependencies 递归遍历
 * （深度 ≤ 6，按包名去重防环）；对每个 WATCH_PACKAGES 取「依赖树中最近一层
 * 声明的 range」解析为具体版本。dsh 依赖用精确版本或 ~/^；resolveRange
 * 在 registry 里定位具体版本。
 * @param {Record<string, object>} dshVersions packument.versions of @deepseek-ai/dsh
 * @param {string} dshVersion
 * @returns {Promise<Record<string, string>>} 包名 → 具体版本
 */
export async function resolveWatchVersions(dshVersions, dshVersion) {
  const { fetchPackument, resolveRange } = await import('./lib/registry.mjs')
  const entry = dshVersions[dshVersion]
  if (!entry) throw new Error(`@deepseek-ai/dsh@${dshVersion} 在 registry 中不存在`)

  const resolved = { '@deepseek-ai/dsh': dshVersion }
  const packumentCache = new Map([['@deepseek-ai/dsh', { versions: dshVersions }]])
  const walkedPackages = new Set()

  async function walk(packument, version, depth) {
    if (depth > 4) return
    const node = packument.versions?.[version]
    if (!node) throw new Error(`${packument.name ?? '?'}@${version} 在 packument 中不存在`)
    for (const [depName, range] of Object.entries(node.dependencies ?? {})) {
      // 只沿 @deepseek-ai 作用域递归（DSH 契约包都在该作用域；第三方包不参与）
      if (!depName.startsWith('@deepseek-ai/')) continue
      if (walkedPackages.has(depName)) continue
      walkedPackages.add(depName)
      let depPackument = packumentCache.get(depName)
      if (!depPackument) {
        depPackument = await fetchPackument(depName)
        packumentCache.set(depName, depPackument)
      }
      let depVersion
      try {
        depVersion = resolveRange(depPackument.versions ?? {}, range)
      } catch (error) {
        // 非关注包解析失败（如只有 prerelease 的工具包）不阻断整棵树
        if (WATCH_PACKAGES.includes(depName)) throw error
        continue
      }
      if (WATCH_PACKAGES.includes(depName) && !(depName in resolved)) {
        resolved[depName] = depVersion
      }
      await walk(depPackument, depVersion, depth + 1)
    }
  }

  await walk({ versions: dshVersions }, dshVersion, 0)

  const missing = WATCH_PACKAGES.filter((name) => !(name in resolved))
  if (missing.length > 0) {
    throw new Error(
      `以下包不在 @deepseek-ai/dsh@${dshVersion} 的 @deepseek-ai 依赖树中（深度 ≤ 4）：${missing.join(', ')}；请检查 WATCH_PACKAGES 或提高遍历深度`,
    )
  }
  return resolved
}
