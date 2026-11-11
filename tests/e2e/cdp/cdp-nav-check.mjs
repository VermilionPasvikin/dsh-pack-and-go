/**
 * CDP：导航到指定 URL，等待加载后读取侧边栏/主区域文本并截图。
 * 用法：node cdp-nav-check.mjs <url> <outDir> <shotName>
 */
import fs from 'node:fs'
import path from 'node:path'

const CDP = 'http://127.0.0.1:9222'
const url = process.argv[2]
const outDir = process.argv[3] ?? '.'
const shotName = process.argv[4] ?? 'nav.png'
fs.mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
const waitFor = async (expression, predicate, timeoutMs = 30000) => {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const value = await evaluate(expression)
      if (predicate(value)) return value
    } catch {
      // 未就绪
    }
    await sleep(500)
  }
  return undefined
}

await send('Page.enable')
await send('Runtime.enable')
await send('Page.navigate', { url })
await waitFor(
  `document.body ? document.body.innerText : ''`,
  (t) => typeof t === 'string' && t.includes('迁移对话或工作区'),
)
await sleep(1500)
const result = await evaluate(
  `JSON.stringify({ sidebar: (document.body.innerText||'').split('\\n').slice(0,45), hasCorrupt: (document.body.innerText||'').includes('历史加载失败') })`,
)
const shot = await send('Page.captureScreenshot', { format: 'png' })
fs.writeFileSync(path.join(outDir, shotName), Buffer.from(shot.result.data, 'base64'))
console.log(result)
ws.close()
