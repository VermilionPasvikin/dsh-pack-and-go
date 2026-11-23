#!/usr/bin/env node
/**
 * 冻结基线：为指定 DSH 版本生成依赖签名快照。
 *
 * 用法：
 *   node scripts/compat/freeze-baseline.mjs --version <dshVersion> [--baseline-dir <dir>] [--cache-dir <dir>]
 *
 * 行为（每一步都有机器可读输出）：
 *   1. 解析 @deepseek-ai/dsh@<version> 的 dependencies → WATCH_PACKAGES 版本表；
 *   2. 逐包下载 tarball（带缓存 + sha512 integrity 校验）→ 解析 tar → 计算每个文件的 sha256；
 *   3. 写快照 <baseline-dir>/<version>.json；
 *   4. stdout 输出一行 JSON 摘要；退出码 0=成功、2=失败。
 *
 * 快照只存签名（路径→sha256），不复制任何第三方源码。
 * 失败时保留错误信息（stderr + 退出码），不静默重试。
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { BASELINE_DIR, DEFAULT_CACHE_DIR, WATCH_PACKAGES, isContractFile, resolveWatchVersions } from './config.mjs'
import { fetchPackument, fetchTarball } from './lib/registry.mjs'
import { parseTarGz } from './lib/tar.mjs'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** @param {Buffer} buf @returns {string} */
function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

function fail(message) {
  process.stderr.write(`[freeze-baseline] ${message}\n`)
  process.exitCode = 2
  throw new Error(message)
}

function parseArgs(argv) {
  const args = { version: undefined, baselineDir: undefined, cacheDir: undefined, output: undefined }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--version' && argv[i + 1]) args.version = argv[i + 1]
    else if (arg === '--baseline-dir' && argv[i + 1]) args.baselineDir = argv[i + 1]
    else if (arg === '--cache-dir' && argv[i + 1]) args.cacheDir = argv[i + 1]
    else if (arg === '--output' && argv[i + 1]) args.output = argv[i + 1]
    if (arg.startsWith('--') && argv[i + 1] && !argv[i + 1].startsWith('--')) i += 1
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.version) {
    fail('缺少 --version <dshVersion>（例如 --version 0.2.2-rc.2）。用法：node scripts/compat/freeze-baseline.mjs --version <dshVersion>')
  }
  const dshVersion = args.version
  const baselineDir = args.baselineDir ? resolve(args.baselineDir) : join(REPO_ROOT, BASELINE_DIR)
  const cacheDir = args.cacheDir ? resolve(args.cacheDir) : DEFAULT_CACHE_DIR
  const outputPath = args.output ? resolve(args.output) : join(baselineDir, `${dshVersion}.json`)
  if (!args.output && existsSync(outputPath)) {
    fail(`基线已存在：${outputPath}。若要重冻结请先删除该文件（或换用新版本号）。`)
  }
  mkdirSync(dirname(outputPath), { recursive: true })

  console.log(`[freeze-baseline] dshVersion=${dshVersion} baselineDir=${baselineDir} cacheDir=${cacheDir}`)

  // 1. 版本表
  const dshPackument = await fetchPackument('@deepseek-ai/dsh')
  const versions = await resolveWatchVersions(dshPackument.versions ?? {}, dshVersion)
  console.log(`[freeze-baseline] resolved ${Object.keys(versions).length} package versions`)
  for (const [name, version] of Object.entries(versions)) {
    console.log(`[freeze-baseline]   ${name}@${version}`)
  }

  // 2. 逐包签名
  const packages = {}
  let fileCount = 0
  for (const name of WATCH_PACKAGES) {
    const version = versions[name]
    const packument = await fetchPackument(name)
    const entry = packument.versions?.[version]
    const integrity = entry?.dist?.integrity
    const { path: tgzPath, cached } = await fetchTarball(name, version, cacheDir, integrity)
    const entries = parseTarGz(readFileSync(tgzPath))
    const files = {}
    let count = 0
    for (const item of entries) {
      if (item.typeflag === '5') continue // 目录
      if (!isContractFile(item.name)) continue
      const data = readFileSync(tgzPath).subarray(item.start, item.end)
      files[item.name] = sha256(data)
      count += 1
    }
    packages[name] = { version, integrity: integrity ?? null, files }
    fileCount += count
    console.log(`[freeze-baseline] ${name}@${version}: ${count} files${cached ? ' (cached)' : ''}`)
  }

  // 3. 写快照
  const snapshot = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    dshVersion,
    packages,
    meta: {
      baselineDir: 'docs/compat/baseline',
      watchPackages: WATCH_PACKAGES,
      registry: 'https://registry.npmjs.org',
      sourceRepo: 'deepseek-ai/deepseek-harness',
      note: '签名快照（sha256），不含第三方源码；由 scripts/compat/freeze-baseline.mjs 生成',
    },
  }
  writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`)
  console.log(`[freeze-baseline] wrote ${outputPath}`)
  console.log(
    JSON.stringify({
      ok: true,
      outputPath,
      dshVersion,
      packages: Object.keys(packages).length,
      files: fileCount,
    }),
  )
}

main().catch((error) => {
  if (!process.exitCode) process.exitCode = 2
  process.stderr.write(`[freeze-baseline] ${error instanceof Error ? error.stack : String(error)}\n`)
})
