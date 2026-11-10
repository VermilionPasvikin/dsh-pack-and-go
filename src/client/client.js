/**
 * Client 侧插件入口（浏览器）。
 *
 * 通过 `window.__ModuleLoader__.load` 注册一个懒工厂；React 由宿主模块表提供。
 * T3.1 只注册一个占位面板到 `main` slot（key `mover`），T3.2 再接侧边栏入口。
 */

window.__ModuleLoader__.load({
  id: 'dsh-mover',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    function MoverPanel() {
      return h(
        'div',
        { style: { padding: '16px 20px', fontSize: 14 } },
        '对话与工作区迁移（建设中）',
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: 'mover' }, MoverPanel),
        )
      },
    }
  },
})
