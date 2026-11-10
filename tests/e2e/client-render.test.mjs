import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const CLIENT_FILE = new URL('../../src/client/client.js', import.meta.url)

/** 极简 React 替身：createElement 记录树，hooks 返回初始值。 */
function makeFakeReact() {
  const noop = () => {}
  return {
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children: children.flat(Infinity) }
    },
    useState(initial) {
      const value = typeof initial === 'function' ? initial() : initial
      return [value, noop]
    },
    useEffect() {},
    useMemo(factory) {
      return factory()
    },
  }
}

function collectText(node, out = []) {
  if (node === null || node === undefined) return out
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node))
    return out
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, out)
    return out
  }
  if (node.children) collectText(node.children, out)
  return out
}

async function loadClientModule() {
  const code = await readFile(fileURLToPath(CLIENT_FILE), 'utf8')
  let factory
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(definition) {
          factory = definition.factory
        },
      },
    },
  }
  vm.runInNewContext(code, sandbox)
  assert.equal(typeof factory, 'function', 'factory should be registered')
  const fakeReact = makeFakeReact()
  const module = factory((name) => {
    if (name === 'react') return fakeReact
    throw new Error(`unexpected require: ${name}`)
  })
  return { module, fakeReact }
}

function makeFakeCtx() {
  const registrations = []
  const ctx = {
    slots: {
      inject(key, callback) {
        const result = callback()
        registrations.push({ key, result })
        return () => {}
      },
      register(options, component) {
        return { options, component }
      },
    },
    locale: {
      getLocale: () => ({ id: 'zh' }),
      subscribe: () => () => {},
    },
    remote: {
      session: { list: async () => ({ items: [] }) },
      commands: { execute: async () => ({ kind: 'success', text: 'ok' }) },
    },
  }
  return { ctx, registrations }
}

test('Client factory 注册侧边栏与 main 面板', async () => {
  const { module } = await loadClientModule()
  const { ctx, registrations } = makeFakeCtx()
  module.apply(ctx)
  const keys = registrations.map((item) => item.key)
  assert.ok(keys.includes('sidebar.panellist'))
  assert.ok(keys.includes('main'))
  const main = registrations.find((item) => item.key === 'main')
  assert.equal(main.result.options.key, 'mover')
  assert.equal(typeof main.result.component, 'function')
  const sidebar = registrations.find((item) => item.key === 'sidebar.panellist')
  assert.equal(sidebar.result.options.id, 'mover')
  assert.equal(typeof sidebar.result.options.label(), 'string')
})

test('MoverPanel 首次渲染包含标题与加载态（中文）', async () => {
  const { module } = await loadClientModule()
  const { ctx, registrations } = makeFakeCtx()
  module.apply(ctx)
  const main = registrations.find((item) => item.key === 'main')
  const tree = main.result.component()
  const text = collectText(tree).join('')
  assert.match(text, /对话与工作区迁移/)
  assert.match(text, /正在读取工作区与对话/)
  assert.match(text, /导出/)
  assert.match(text, /导入/)
})

test('英文 locale 时标题为英文', async () => {
  const { module } = await loadClientModule()
  const { ctx, registrations } = makeFakeCtx()
  ctx.locale.getLocale = () => ({ id: 'en' })
  module.apply(ctx)
  const main = registrations.find((item) => item.key === 'main')
  const text = collectText(main.result.component()).join('')
  assert.match(text, /Conversation & Workspace Migration/)
  assert.match(text, /Reading workspaces and conversations/)
})
