#!/usr/bin/env node
/**
 * 检出上游：对比基线快照与目标 DSH 版本，输出差异报告。
 *
 * 用法：
 *   node scripts/compat/check-upstream.mjs [--baseline <file|auto>] [--target <dshVersion|dist-tag|auto>]
 *
 * 默认：
 *   --baseline auto → docs/compat/baseline/ 下 dshVersion 最大的快照
 *   --target  auto  → registry dist-tags.next（@deepseek-ai/dsh）
 *
 * 行为：
 *   1. 打印 @deepseek-ai/dsh 的 dist-tags 快照（latest/next/alpha）；
 *   2. 若 target 与基线版本相同 → 输出「无变化」，退出码 0；
 *   3. 解析 target 版本的 WATCH_PACKAGES 版本表，与基线逐包对比：
 *      版本不同 → 下载 tarball，逐文件 sha256 对比 → changed/added/removed 清单；
 *   4. stdout 输出一行 JSON 报告；退出码：
 *      0 = 无变化；1 = 检出到变化（含「版本无变化但文件变化」）；2 = 错误。
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { BASELINE_DIR, DEFAULT_CACHE_DIR, DEFAULT_DIST_TAG, WATCH_PACKAGES, isContractFile, resolveWatchVersions } from './config.mjs'
import { fetchPackument, fetchTarball } from './lib/registry.mjs'
import { parseTarGz } from './lib/tar.mjs'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** @param {Buffer} buf @returns {string} */
function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

function fail(message) {
  process.stderr.write(`[check-upstream] ${message}\n`)
  process.exitCode = 2
  throw new Error(message)
}

function parseArgs(argv) {
  const args = { baseline: undefined, target: undefined, cacheDir: undefined }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--baseline' && argv[i + 1]) args.baseline = argv[i + 1]
    else if (arg === '--target' && argv[i + 1]) args.target = argv[i + 1]
    else if (arg === '--cache-dir' && argv[i + 1]) args.cacheDir = argv[i + 1]
    if (arg.startsWith('--') && argv[i + 1] && !argv[i + 1].startsWith('--')) i += 1
  }
  return args
}

/** 基线目录里 dshVersion 最大的快照文件（按字符串排序近似版本序）。 */
function latestBaseline(baselineDir) {
  if (!existsSync(baselineDir)) fail(`基线目录不存在：${baselineDir}`)
  const names = readdirSync(baselineDir).filter((name) =>
    /^\d+\.\d+\.\d+(-[A-Za-z0-9.]+)?\.json$/.test(name),
  )
  if (names.length === 0) fail(`基线目录没有快照：${baselineDir}`)
  return join(baselineDir, names.sort().at(-1))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const baselinePath =
    args.baseline && args.baseline !== 'auto'
      ? resolve(args.baseline)
      : latestBaseline(join(REPO_ROOT, BASELINE_DIR))
  if (!existsSync(baselinePath)) fail(`基线文件不存在：${baselinePath}`)
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))
  const cacheDir = args.cacheDir ? resolve(args.cacheDir) : DEFAULT_CACHE_DIR

  console.log(`[check-upstream] baseline=${baselinePath} (DSH ${baseline.dshVersion})`)

  // 1. dist-tags 快照
  const dshPackument = await fetchPackument('@deepseek-ai/dsh')
  const distTags = dshPackument['dist-tags'] ?? {}
  console.log(`[check-upstream] dist-tags: ${JSON.stringify(distTags)}`)

  const target =
    args.target && args.target !== 'auto'
      ? args.target
      : (distTags[DEFAULT_DIST_TAG] ?? null)
  if (!target) fail(`无法确定 target 版本（dist-tags.${DEFAULT_DIST_TAG} 不存在）`)
  console.log(`[check-upstream] target=${target}`)

  // 2. 版本相同 → 无变化
  if (target === baseline.dshVersion) {
    console.log(JSON.stringify({ ok: true, changed: false, baseline: baseline.dshVersion, target }))
    process.exitCode = 0
    return
  }

  // 3. 逐包对比
  const versions = await resolveWatchVersions(dshPackument.versions ?? {}, target)
  const report = {
    ok: true,
    changed: true,
    baseline: baseline.dshVersion,
    target,
    packageDiffs: [],
    summary: { packagesChanged: 0, packagesSame: 0, filesChanged: 0, filesAdded: 0, filesRemoved: 0 },
  }

  for (const name of WATCH_PACKAGES) {
    const base = baseline.packages?.[name]
    if (!base) {
      report.packageDiffs.push({ name, kind: 'missing-in-baseline', targetVersion: versions[name] })
      report.summary.packagesChanged += 1
      console.log(`[check-upstream] ${name}: 基线中没有此包（新依赖？）→ 目标 ${versions[name]}`)
      continue
    }
    if (base.version === versions[name]) {
      report.summary.packagesSame += 1
      console.log(`[check-upstream] ${name}@${versions[name]}: 版本未变`)
      continue
    }
    report.summary.packagesChanged += 1
    const packument = await fetchPackument(name)
    const entry = packument.versions?.[versions[name]]
    const integrity = entry?.dist?.integrity
    const { path: tgzPath, cached } = await fetchTarball(name, versions[name], cacheDir, integrity)
    const buffer = readFileSync(tgzPath)
    const entries = parseTarGz(buffer)
    const targetFiles = {}
    for (const item of entries) {
      if (item.typeflag === '5') continue
      if (!isContractFile(item.name)) continue
      targetFiles[item.name] = sha256(buffer.subarray(item.start, item.end))
    }
    const changed = []
    const added = []
    const removed = []
    for (const [file, hash] of Object.entries(targetFiles)) {
      if (!(file in base.files)) added.push(file)
      else if (base.files[file] !== hash) changed.push(file)
    }
    for (const file of Object.keys(base.files)) {
      if (!(file in targetFiles)) removed.push(file)
    }
    report.summary.filesChanged += changed.length
    report.summary.filesAdded += added.length
    report.summary.filesRemoved += removed.length
    report.packageDiffs.push({
      name,
      kind: 'version-bump',
      baselineVersion: base.version,
      targetVersion: versions[name],
      changed,
      added,
      removed,
    })
    console.log(
      `[check-upstream] ${name}: ${base.version} → ${versions[name]}（changed=${changed.length} added=${added.length} removed=${removed.length}${cached ? ' cached' : ''}）`,
    )
  }

  console.log(JSON.stringify(report))
  process.exitCode = 1
}

main().catch((error) => {
  if (!process.exitCode) process.exitCode = 2
  process.stderr.write(`[check-upstream] ${error instanceof Error ? error.stack : String(error)}\n`)
})
