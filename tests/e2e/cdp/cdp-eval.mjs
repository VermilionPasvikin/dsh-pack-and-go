/**
 * 通用 CDP evaluate：node cdp-eval.mjs "<表达式>" 或 node cdp-eval.mjs <表达式文件>
 */
import fs from 'node:fs'

const CDP = 'http://127.0.0.1:9222'
const arg = process.argv[2]
const expression = fs.existsSync(arg) ? fs.readFileSync(arg, 'utf8') : arg

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
const result = await send('Runtime.evaluate', {
  expression,
  returnByValue: true,
  awaitPromise: true,
})
console.log(JSON.stringify(result.result, null, 2))
ws.close()
