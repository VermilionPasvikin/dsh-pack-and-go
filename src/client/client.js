/**
 * Client 侧插件入口（浏览器）。
 *
 * T3.2 侧边栏图标 + main 页面壳；T3.3 会话选择树；T3.4 导出；T3.5 导入。
 * 数据来自已有的 `ctx.remote.session.list()`；动作通过 `ctx.remote.commands.execute()`
 * 调用 Host 的 `mover` 命令（ADR-0008）。
 */

window.__ModuleLoader__.load({
  id: 'dsh-mover',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useMemo, useState } = React

    /** apply 时保存的 Context，供组件调用已有 Remote。 */
    let ownerCtx = null

    function MoverIcon(props) {
      const size = props && typeof props.size === 'number' ? props.size : 18
      const active = Boolean(props && props.active)
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          style: { opacity: active ? 1 : 0.72 },
        },
        h('path', { d: 'M4 7h13' }),
        h('path', { d: 'M14 4l3 3-3 3' }),
        h('path', { d: 'M20 17H7' }),
        h('path', { d: 'M10 14l-3 3 3 3' }),
      )
    }

    function titleOf(item) {
      const values = item && item.projections ? item.projections.values : undefined
      const title = values ? values.title : undefined
      if (typeof title === 'string' && title.length > 0) return title
      if (title && typeof title === 'object' && typeof title.title === 'string') {
        return title.title
      }
      if (typeof item.cwd === 'string' && item.cwd.length > 0) {
        const segments = item.cwd.split(/[\\/]/).filter((segment) => segment.length > 0)
        return segments.length > 0 ? segments[segments.length - 1] : item.cwd
      }
      return String(item.sessionId)
    }

    function groupSessions(items) {
      const groups = new Map()
      for (const item of items) {
        if (item.blank) continue
        const cwd = typeof item.cwd === 'string' && item.cwd.length > 0 ? item.cwd : null
        const key = cwd ?? ''
        if (!groups.has(key)) {
          groups.set(key, {
            cwd,
            title: cwd ? titleOf({ cwd }) : '未归入工作区',
            sessions: [],
          })
        }
        groups.get(key).sessions.push({
          sessionId: item.sessionId,
          title: titleOf(item),
          updatedAt: item.updatedAt,
        })
      }
      const list = [...groups.values()]
      for (const group of list) {
        group.sessions.sort((left, right) => right.updatedAt - left.updatedAt)
      }
      list.sort((left, right) => {
        if (left.cwd === null) return 1
        if (right.cwd === null) return -1
        return String(left.title).localeCompare(String(right.title))
      })
      return list
    }

    function Spinner() {
      return h(
        'span',
        {
          style: {
            display: 'inline-block',
            marginRight: 8,
            animation: 'dsh-mover-spin 1s linear infinite',
          },
          'aria-hidden': true,
        },
        '◐',
      )
    }

    function fieldStyle() {
      return {
        flex: '1 1 360px',
        minWidth: 240,
        padding: '8px 10px',
        borderRadius: 8,
        border: '1px solid color-mix(in srgb, currentColor 20%, transparent)',
        background: 'transparent',
        color: 'inherit',
        fontSize: 13,
      }
    }

    function buttonStyle(disabled) {
      return {
        padding: '8px 16px',
        borderRadius: 8,
        border: '1px solid color-mix(in srgb, currentColor 20%, transparent)',
        background: disabled
          ? 'color-mix(in srgb, currentColor 8%, transparent)'
          : 'color-mix(in srgb, currentColor 14%, transparent)',
        color: 'inherit',
        fontSize: 13,
        fontWeight: 600,
        cursor: disabled ? 'default' : 'pointer',
      }
    }

    function MoverPanel() {
      const [tab, setTab] = useState('export')
      const [status, setStatus] = useState('loading')
      const [groups, setGroups] = useState([])
      const [selected, setSelected] = useState(() => new Set())
      const [targetPath, setTargetPath] = useState('')
      const [importPackPath, setImportPackPath] = useState('')
      const [importTarget, setImportTarget] = useState('')
      const [busy, setBusy] = useState(false)
      const [message, setMessage] = useState(null)
      const [error, setError] = useState(null)
      const [reloadTick, setReloadTick] = useState(0)

      useEffect(() => {
        let cancelled = false
        async function load() {
          try {
            const value = await ownerCtx.remote.session.list({})
            if (cancelled) return
            setGroups(groupSessions(value.items ?? []))
            setStatus('ready')
          } catch (loadError) {
            if (cancelled) return
            setStatus('error')
            setError(loadError instanceof Error ? loadError.message : String(loadError))
          }
        }
        load()
        return () => {
          cancelled = true
        }
      }, [reloadTick])

      const allSessions = useMemo(
        () => groups.flatMap((group) => group.sessions),
        [groups],
      )
      const agentId = allSessions.length > 0 ? allSessions[0].sessionId : undefined

      function toggleSession(sessionId) {
        setSelected((previous) => {
          const next = new Set(previous)
          if (next.has(sessionId)) next.delete(sessionId)
          else next.add(sessionId)
          return next
        })
      }

      function toggleGroup(group) {
        setSelected((previous) => {
          const next = new Set(previous)
          const allSelected = group.sessions.every((session) => next.has(session.sessionId))
          for (const session of group.sessions) {
            if (allSelected) next.delete(session.sessionId)
            else next.add(session.sessionId)
          }
          return next
        })
      }

      async function runCommand(line, successText) {
        if (!agentId) {
          setError('没有可用的对话上下文。')
          return
        }
        setBusy(true)
        setError(null)
        setMessage(null)
        try {
          const result = await ownerCtx.remote.commands.execute(
            { id: agentId },
            line,
            [],
            undefined,
          )
          const text =
            result && typeof result.text === 'string' && result.text.length > 0
              ? result.text
              : successText
          if (result && result.kind === 'error') setError(text)
          else {
            setMessage(text)
            // 导入/导出后刷新会话列表（新会话可能已出现）
            setReloadTick((tick) => tick + 1)
          }
        } catch (executeError) {
          setError(executeError instanceof Error ? executeError.message : String(executeError))
        } finally {
          setBusy(false)
        }
      }

      async function startExport() {
        if (selected.size === 0) {
          setError('请至少选择一个对话。')
          return
        }
        if (targetPath.trim().length === 0) {
          setError('请填写保存位置（例如 D:\\迁移\\我的包.dshpack）。')
          return
        }
        const ids = [...selected]
        await runCommand(`/mover export "${targetPath.trim()}" ${ids.join(' ')}`, '打包完成')
      }

      async function startImport() {
        if (importPackPath.trim().length === 0) {
          setError('请填写迁移包路径。')
          return
        }
        const target = importTarget.trim()
        const line =
          target.length > 0
            ? `/mover import "${importPackPath.trim()}" "${target}"`
            : `/mover import "${importPackPath.trim()}"`
        await runCommand(line, '导入完成')
      }

      return h(
        'div',
        { style: { padding: '20px 24px', maxWidth: 980, margin: '0 auto' } },
        h(
          'style',
          null,
          '@keyframes dsh-mover-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}',
        ),
        h('div', { style: { fontSize: 20, fontWeight: 600, marginBottom: 4 } }, '对话与工作区迁移'),
        h(
          'div',
          { style: { fontSize: 13, opacity: 0.72, marginBottom: 14 } },
          '把对话和项目打包带走，换台电脑继续。',
        ),
        tabBar(),
        tab === 'export' ? exportView() : importView(),
        message ? h('div', { style: { marginTop: 12, fontSize: 13, color: '#2e8b57' } }, message) : null,
        error ? h('div', { style: { marginTop: 12, fontSize: 13, color: '#c0392b' } }, error) : null,
      )

      function tabBar() {
        return h(
          'div',
          { style: { display: 'flex', gap: 8, marginBottom: 14 } },
          tabButton('导出', 'export'),
          tabButton('导入', 'import'),
        )
      }

      function tabButton(text, key) {
        const active = tab === key
        return h(
          'button',
          {
            key,
            type: 'button',
            onClick: () => setTab(key),
            style: {
              padding: '6px 14px',
              borderRadius: 8,
              cursor: 'pointer',
              fontSize: 13,
              border: '1px solid color-mix(in srgb, currentColor 18%, transparent)',
              background: active
                ? 'color-mix(in srgb, currentColor 12%, transparent)'
                : 'transparent',
              color: 'inherit',
              fontWeight: active ? 600 : 400,
            },
          },
          text,
        )
      }

      function exportView() {
        return h(
          'div',
          null,
          status === 'loading'
            ? h(
                'div',
                { style: { padding: 24, fontSize: 13, opacity: 0.8 } },
                h(Spinner),
                '正在读取工作区与对话…',
              )
            : status === 'error'
              ? h('div', { style: { padding: 16, fontSize: 13, color: '#c0392b' } }, `读取失败：${error}`)
              : renderTree(),
          h(
            'div',
            { style: { marginTop: 16, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
            h('input', {
              type: 'text',
              value: targetPath,
              placeholder: '保存位置，例如 D:\\迁移\\我的包.dshpack',
              onChange: (event) => setTargetPath(event.target.value),
              disabled: busy,
              style: fieldStyle(),
            }),
            h(
              'button',
              { type: 'button', onClick: startExport, disabled: busy || status !== 'ready', style: buttonStyle(busy || status !== 'ready') },
              busy ? h('span', null, h(Spinner), '打包中…') : '开始打包',
            ),
          ),
        )
      }

      function importView() {
        return h(
          'div',
          null,
          h(
            'div',
            { style: { fontSize: 13, opacity: 0.8, marginBottom: 10 } },
            '填写迁移包路径；目标目录留空时默认放到「用户目录/dsh-mover-import」。已存在的对话默认跳过，同路径工作区默认合并。',
          ),
          h(
            'div',
            { style: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 } },
            h('input', {
              type: 'text',
              value: importPackPath,
              placeholder: '迁移包路径，例如 D:\\迁移\\我的包.dshpack',
              onChange: (event) => setImportPackPath(event.target.value),
              disabled: busy,
              style: fieldStyle(),
            }),
          ),
          h(
            'div',
            { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
            h('input', {
              type: 'text',
              value: importTarget,
              placeholder: '目标目录（可选）',
              onChange: (event) => setImportTarget(event.target.value),
              disabled: busy,
              style: fieldStyle(),
            }),
            h(
              'button',
              { type: 'button', onClick: startImport, disabled: busy, style: buttonStyle(busy) },
              busy ? h('span', null, h(Spinner), '导入中…') : '开始导入',
            ),
          ),
        )
      }

      function renderTree() {
        if (groups.length === 0) {
          return h('div', { style: { padding: 24, fontSize: 13, opacity: 0.8 } }, '还没有可迁移的对话。')
        }
        return h(
          'div',
          {
            style: {
              border: '1px solid color-mix(in srgb, currentColor 14%, transparent)',
              borderRadius: 12,
              overflow: 'hidden',
            },
          },
          groups.map((group) => renderGroup(group)),
          h(
            'div',
            { style: { padding: '10px 14px', fontSize: 12, opacity: 0.7 } },
            `已选 ${selected.size} 个对话`,
          ),
        )
      }

      function renderGroup(group) {
        const allSelected =
          group.sessions.length > 0 &&
          group.sessions.every((session) => selected.has(session.sessionId))
        const someSelected = group.sessions.some((session) => selected.has(session.sessionId))
        return h(
          'div',
          {
            key: group.cwd ?? 'ungrouped',
            style: { borderBottom: '1px solid color-mix(in srgb, currentColor 10%, transparent)' },
          },
          h(
            'label',
            {
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 14px',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: 13,
              },
            },
            h('input', {
              type: 'checkbox',
              checked: allSelected,
              ref: (node) => {
                if (node) node.indeterminate = someSelected && !allSelected
              },
              onChange: () => toggleGroup(group),
            }),
            h('span', null, group.title),
            h(
              'span',
              { style: { fontWeight: 400, opacity: 0.6, fontSize: 12 } },
              `${group.sessions.length} 个对话`,
            ),
          ),
          h(
            'div',
            { style: { padding: '0 14px 10px 42px' } },
            group.sessions.map((session) =>
              h(
                'label',
                {
                  key: session.sessionId,
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '3px 0',
                    cursor: 'pointer',
                    fontSize: 13,
                  },
                },
                h('input', {
                  type: 'checkbox',
                  checked: selected.has(session.sessionId),
                  onChange: () => toggleSession(session.sessionId),
                }),
                h('span', null, session.title),
              ),
            ),
          ),
        )
      }
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ownerCtx = ctx
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: 'mover', order: 60, label: () => '迁移' },
            MoverIcon,
          ),
        )
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: 'mover' }, MoverPanel),
        )
      },
    }
  },
})
