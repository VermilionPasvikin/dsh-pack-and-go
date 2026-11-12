/**
 * CDP 测试第二阶段：导出 + 导入流程（AGENTS.md §8）。
 * 用法：node cdp-flow-test.mjs <url> <outDir> <exportDir> <packPath> [importDir]
 */
import fs from 'node:fs'
import path from 'node:path'

const CDP = 'http://127.0.0.1:9222'
const url = process.argv[2]
const outDir = process.argv[3]
const exportDir = process.argv[4]
const packPath = process.argv[5]
const importDir = process.argv[6] ?? path.join(exportDir, 'imported')
fs.mkdirSync(outDir, { recursive: true })
fs.mkdirSync(exportDir, { recursive: true })

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const HELPERS = `
  window.__moverTest = {
    setInput(placeholder, value) {
      const el = [...document.querySelectorAll('input')].find(
        (i) => i.placeholder && i.placeholder.includes(placeholder),
      )
      if (!el) return false
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(el, value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    },
    clickText(text) {
      const el = [...document.querySelectorAll('button')].find(
        (b) => (b.textContent || '').trim() === text,
      )
      const fallback = el || [...document.querySelectorAll('button')].find(
        (b) => (b.textContent || '').includes(text),
      )
      if (!fallback) return false
      fallback.click()
      return true
    },
    clickLabel(text) {
      const el = [...document.querySelectorAll('label')].find(
        (l) => (l.textContent || '').includes(text),
      )
      if (!el) return false
      el.click()
      return true
    },
    closeOverlay() {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    },
  }
  'ok'
`

async function main() {
  const tabs = await fetch(`${CDP}/json`).then((r) => r.json())
  const page = tabs.find((t) => t.type === 'page') ?? tabs[0]
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
      throw new Error(result.result.exceptionDetails.exception?.description ?? 'evaluate failed')
    }
    return result.result?.result?.value
  }
  const shot = async (name) => {
    const result = await send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(outDir, name), Buffer.from(result.result.data, 'base64'))
  }
  const waitFor = async (expression, predicate, timeoutMs = 20000) => {
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
  const bodyText = `document.body ? document.body.innerText : ''`
  const results = {}
  const findLine = (needles, excludes = []) =>
    evaluate(
      `(() => { const lines = [...document.querySelectorAll('div')].map((d) => d.textContent).filter((t) => t && t.length <= 400 && ${JSON.stringify(needles)}.some((n) => t.includes(n)) && !${JSON.stringify(excludes)}.some((n) => t.includes(n))); return lines.sort((a, b) => a.length - b.length)[0]?.slice(0, 300) ?? null })()`,
    )

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Page.navigate', { url })
  await waitFor(bodyText, (t) => typeof t === 'string' && t.includes('迁移对话或工作区'), 30000)
  await evaluate(HELPERS)

  // 重置：先关闭可能已打开的浮层，再打开并切到导出 tab
  await evaluate(`window.__moverTest.closeOverlay()`)
  await sleep(500)
  await evaluate(
    `[...document.querySelectorAll('button')].find((b) => (b.textContent||'').includes('迁移对话或工作区'))?.click()`,
  )
  await waitFor(bodyText, (t) => t.includes('对话与工作区迁移'), 10000)
  await evaluate(`window.__moverTest.clickText('导出')`)
  await sleep(500)
  results.treeReady = Boolean(await waitFor(bodyText, (t) => t.includes('个对话'), 15000))
  await shot('04-export-tab.png')

  results.groupClick = await evaluate(`window.__moverTest.clickLabel('个对话')`)
  await sleep(500)
  results.selected = Boolean(
    await waitFor(bodyText, (t) => t.includes('已选 ') && !t.includes('已选 0 个工作区'), 5000),
  )
  results.afterSelect = await findLine(['已选 '])

  results.setTarget = await evaluate(
    `window.__moverTest.setInput('保存位置', ${JSON.stringify(exportDir)})`,
  )
  results.setName = await evaluate(`window.__moverTest.setInput('包名', 'cdp-test')`)
  results.clickExport = await evaluate(`window.__moverTest.clickText('开始打包')`)
  await waitFor(
    bodyText,
    (t) => t.includes('复制路径') || t.includes('导出失败') || t.includes('读取失败'),
    30000,
  )
  results.afterExport = await findLine(['已导出', '导出失败', '读取失败', '错误'])
  await shot('05-export-done.png')
  results.packExists = fs.existsSync(packPath)

  results.clickImportTab = await evaluate(`window.__moverTest.clickText('导入')`)
  await sleep(800)
  results.setPack = await evaluate(
    `window.__moverTest.setInput('迁移包', ${JSON.stringify(packPath)})`,
  )
  results.setImportTarget = await evaluate(
    `window.__moverTest.setInput('目标目录', ${JSON.stringify(importDir)})`,
  )
  results.clickPreview = await evaluate(`window.__moverTest.clickText('预览')`)
  results.previewShown = Boolean(await waitFor(bodyText, (t) => t.includes('迁移包预览'), 20000))
  results.afterPreview = await findLine(['迁移包预览', '预览失败', '读取失败'])
  await shot('06-preview.png')

  results.clickNewId = await evaluate(`window.__moverTest.clickLabel('另存为新对话')`)
  results.clickImport = await evaluate(`window.__moverTest.clickText('开始导入')`)
  results.importResult = Boolean(
    await waitFor(
      bodyText,
      (t) =>
        t.includes('已导入') ||
        t.includes('导入完成') ||
        t.includes('请先选择目标目录') ||
        /导入失败[：:]/.test(t),
      30000,
    ),
  )
  results.afterImport = await findLine(
    ['已导入', '导入完成', '导入失败：', '请先选择目标目录'],
    ['会直接报错', '已存在对话：跳过'],
  )
  await shot('07-import-done.png')

  fs.writeFileSync(path.join(outDir, 'cdp-flow-result.json'), JSON.stringify(results, null, 2))
  console.log(JSON.stringify(results, null, 2))
  ws.close()
}

main().catch((error) => {
  console.error('CDP-FLOW-FAILED', error)
  process.exitCode = 1
})
