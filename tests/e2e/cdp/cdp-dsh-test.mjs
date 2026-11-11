/**
 * 无头 Chrome CDP 驱动 DSH Web UI 的最小测试脚本（AGENTS.md §8）。
 * 用法：node cdp-dsh-test.mjs <url> <outDir>
 */
import fs from 'node:fs'
import path from 'node:path'

const CDP = 'http://127.0.0.1:9222'
const url = process.argv[2]
const outDir = process.argv[3] ?? '.'
fs.mkdirSync(outDir, { recursive: true })

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  const tabs = await fetch(`${CDP}/json`).then((r) => r.json())
  const page = tabs.find((t) => t.type === 'page') ?? tabs[0]
  if (!page) throw new Error('no page target')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  let nextId = 0
  const pending = new Map()
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message)
      pending.delete(message.id)
    }
  }
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++nextId
      pending.set(id, resolve)
      ws.send(JSON.stringify({ id, method, params }))
    })
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (result.result?.exceptionDetails) {
      throw new Error(JSON.stringify(result.result.exceptionDetails))
    }
    return result.result?.result?.value
  }
  const shot = async (name) => {
    const result = await send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(outDir, name), Buffer.from(result.result.data, 'base64'))
  }
  const waitFor = async (expression, predicate, timeoutMs = 25000) => {
    const started = Date.now()
    while (Date.now() - started < timeoutMs) {
      try {
        const value = await evaluate(expression)
        if (predicate(value)) return value
      } catch {
        // 页面未就绪
      }
      await sleep(500)
    }
    return undefined
  }

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Page.navigate', { url })

  const results = {}
  const bodyText = await waitFor(
    `document.body ? document.body.innerText : ''`,
    (text) => typeof text === 'string' && text.includes('迁移对话或工作区'),
  )
  results.d1_launcher = Boolean(bodyText)
  await shot('01-home.png')

  const clicked = await evaluate(
    `(() => { const el = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes('迁移对话或工作区')); if (!el) return false; el.click(); return true })()`,
  )
  results.d2_clicked = clicked
  const overlay = await waitFor(
    `document.body ? document.body.innerText : ''`,
    (text) => typeof text === 'string' && text.includes('对话与工作区迁移'),
    10000,
  )
  results.d2_overlay = Boolean(overlay)
  await sleep(1500)
  await shot('02-overlay.png')

  results.d3_treeText = await evaluate(
    `(() => { const all = document.body.innerText.split('\\n'); const idx = all.findIndex((l) => l.includes('导出')); return all.slice(0, 60).join(' | ') })()`,
  )
  results.d4_diagnostics = await evaluate(
    `(() => { const line = [...document.querySelectorAll('div')].map((d) => d.textContent).find((t) => t && t.includes('诊断：')); return line ? line.slice(0, 200) : null })()`,
  )

  const toggled = await evaluate(
    `(() => { const boxes = [...document.querySelectorAll('input[type=checkbox]')]; if (!boxes.length) return false; boxes[0].click(); return true })()`,
  )
  results.d5_toggled = toggled
  await sleep(600)
  results.d5_stats = await evaluate(
    `(() => { const line = [...document.querySelectorAll('div')].map((d) => d.textContent).find((t) => t && t.includes('已选')); return line ? line.slice(0, 120) : null })()`,
  )
  await shot('03-selected.png')

  results.d8_advanced = await evaluate(
    `(() => { const el = [...document.querySelectorAll('summary')].find((s) => (s.textContent || '').includes('高级选项')); return Boolean(el) })()`,
  )

  // 搜索框已按用户决定移除（DEVLOG 133），这里断言不存在。
  results.d6_search = await evaluate(
    `(() => Boolean(document.querySelector('input[placeholder*="搜索对话"]')))()`,
  )

  results.url = url
  fs.writeFileSync(path.join(outDir, 'cdp-result.json'), JSON.stringify(results, null, 2))
  console.log(JSON.stringify(results, null, 2))
  ws.close()
}

main().catch((error) => {
  console.error('CDP-TEST-FAILED', error)
  process.exitCode = 1
})
