#!/usr/bin/env node
/**
 * 探测本地 DSH 宿主 CLI 与版本。
 *
 * 用法：
 *   node scripts/compat/probe-host.mjs [--verbose]
 *
 * 查找顺序（第一个可用即停）：
 *   1. 环境变量 DSH_CLI（显式指定 CLI 路径，最优先）
 *   2. Windows 桌面版自带 CLI：%LOCALAPPDATA%\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd
 *      与 <盘符>:\dsh\resources\runtime\cli\bin\dsh.cmd（常见安装路径）
 *   3. PATH 中的 dsh / dsh.cmd（npm 全局安装）
 *
 * 找到后运行 `<cli> --version`（超时 30s），输出一行 JSON：
 *   { ok: true, found: true, path, version }
 * 找不到或运行失败：{ ok: false, found: false, hint }，退出码 2。
 *
 * 注意：本脚本只读探测，不安装、不写任何配置。
 */

import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

function runVersion(candidate) {
  // Windows 的 .cmd/.bat 不能被 spawnSync 直接执行（EINVAL），需经 cmd.exe 包装；
  // 注意：不要用 /s（会破坏含引号路径的解析），路径与参数分开传递。
  const isCmd = process.platform === 'win32' && /\.(cmd|bat)$/i.test(candidate)
  const result = isCmd
    ? spawnSync('cmd.exe', ['/d', '/c', candidate, '--version'], {
        encoding: 'utf8',
        timeout: 30_000,
        windowsHide: true,
      })
    : spawnSync(candidate, ['--version'], {
        encoding: 'utf8',
        timeout: 30_000,
        windowsHide: true,
      })
  if (result.error) return { ok: false, detail: `spawn 失败：${result.error.message}` }
  if (result.status !== 0) return { ok: false, detail: `退出码 ${result.status}` }
  const version = String(result.stdout ?? '')
    .trim()
    .split(/\r?\n/)
    .at(-1)
    .trim()
  if (!/^\d+\.\d+\.\d+/.test(version)) {
    return { ok: false, detail: `输出不是版本号：${String(result.stdout ?? '').slice(0, 120)}` }
  }
  return { ok: true, version }
}

function candidates() {
  const list = []
  if (process.env.DSH_CLI) list.push(process.env.DSH_CLI)

  const localAppData = process.env.LOCALAPPDATA
  if (localAppData) {
    list.push(join(localAppData, 'Programs', 'DeepSeek Harness', 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd'))
  }
  // 常见盘符下的安装位置
  for (const drive of process.platform === 'win32' ? ['C', 'D', 'E', 'F'] : []) {
    list.push(join(`${drive}:\\dsh`, 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd'))
  }

  for (const name of process.platform === 'win32' ? ['dsh.cmd', 'dsh'] : ['dsh']) {
    const pathDirs = (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':')
    for (const dir of pathDirs) {
      if (!dir) continue
      const candidate = join(dir, name)
      if (existsSync(candidate)) list.push(candidate)
    }
  }
  return list
}

function main() {
  const verbose = process.argv.includes('--verbose')
  const tried = []
  for (const candidate of candidates()) {
    if (!existsSync(candidate)) continue
    if (verbose) console.log(`[probe-host] try ${candidate}`)
    const result = runVersion(candidate)
    if (result.ok) {
      console.log(JSON.stringify({ ok: true, found: true, path: candidate, version: result.version }))
      process.exitCode = 0
      return
    }
    tried.push({ path: candidate, detail: result.detail })
  }
  console.log(
    JSON.stringify({
      ok: false,
      found: false,
      tried: verbose ? tried : tried.length,
      hint:
        '未找到可用的 dsh CLI。安装方式（二选一）：' +
        '① npm i -g @deepseek-ai/dsh@<版本>；' +
        '② 安装 DeepSeek Harness 桌面版后使用其自带 CLI（resources/runtime/cli/bin/dsh.cmd）。' +
        '也可用环境变量 DSH_CLI=<path> 显式指定。',
    }),
  )
  process.exitCode = 2
}

main()
