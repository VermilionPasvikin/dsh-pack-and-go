import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const CLIENT_FILE = new URL('../../src/client/client.js', import.meta.url)

/** 极简 React 替身：createElement 记录树，hooks 返回初始值。 */
function makeFakeReact() {
  const noop = () => {}
  class Component {
    constructor(props) {
      this.props = props
      this.state = {}
    }
    setState() {}
  }
  return {
    Component,
    createElement(type, props, ...children) {
      const flat = children.flat(Infinity)
      return { type, props: { ...(props ?? {}), children: flat }, children: flat }
    },
    useState(initial) {
      const value = typeof initial === 'function' ? initial() : initial
      return [value, noop]
    },
    useEffect() {},
    useMemo(factory) {
      return factory()
    },
    useRef(initial) {
      return { current: initial }
    },
  }
}

function renderNode(node) {
  if (!node || typeof node !== 'object') return node
  if (typeof node.type === 'function') {
    if (node.type.prototype && typeof node.type.prototype.render === 'function') {
      const instance = new node.type(node.props)
      return renderNode(instance.render())
    }
    return renderNode(node.type(node.props))
  }
  return node
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
  if (typeof node === 'object' && typeof node.type === 'function') {
    return collectText(renderNode(node), out)
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

function makeFakeCtx(localeId = 'zh') {
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
      getLocale: () => ({ id: localeId }),
      subscribe: () => () => {},
    },
    remote: {
      session: { list: async () => ({ items: [] }) },
      workspace: { follow: async () => ({ [Symbol.asyncIterator]: async function* () {} }) },
      commands: { execute: async () => ({ ok: true, value: undefined }) },
    },
    uiWorkspace: { pickDirectory: async () => null },
    get(name) {
      return this[name]
    },
  }
  return { ctx, registrations }
}

test('Client factory 注册侧边栏底部按钮与全局浮层', async () => {
  const { module } = await loadClientModule()
  const { ctx, registrations } = makeFakeCtx()
  module.apply(ctx)
  const keys = registrations.map((item) => item.key)
  assert.ok(keys.includes('sidebar.footer.action'))
  assert.ok(keys.includes('shell.overlay'))
  const footer = registrations.find((item) => item.key === 'sidebar.footer.action')
  assert.equal(footer.result.options.id, 'mover')
  const overlay = registrations.find((item) => item.key === 'shell.overlay')
  assert.equal(overlay.result.options.id, 'mover-overlay')
})

test('底部按钮渲染中文标题', async () => {
  const { module } = await loadClientModule()
  const { ctx, registrations } = makeFakeCtx('zh')
  module.apply(ctx)
  const footer = registrations.find((item) => item.key === 'sidebar.footer.action')
  const tree = renderNode(footer.result.component())
  assert.equal(tree.props.title, '迁移对话或工作区')
  assert.equal(tree.props.type, 'button')
})

test('英文 locale 时按钮标题为英文', async () => {
  const { module } = await loadClientModule()
  const { ctx, registrations } = makeFakeCtx('en')
  module.apply(ctx)
  const footer = registrations.find((item) => item.key === 'sidebar.footer.action')
  const tree = renderNode(footer.result.component())
  assert.equal(tree.props.title, 'Migrate conversations or workspaces')
})
