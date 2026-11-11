/**
 * Client 侧插件入口（浏览器）。
 *
 * 方案 1：侧边栏底部动作按钮 → 打开 frame-wide 浮层（shell.overlay），
 * 浮层叠加在当前页面之上、可拖动、可关闭，不切换主面板。
 *
 * 数据：`ctx.remote.workspace.follow`（baseline）+ Host `mover list` 命令（标题）。
 * 动作：`ctx.remote.commands.execute(sessionId, line, attachments)`，返回值是
 * `RemoteResult { ok, value }`，`value` 为 `CommandExecution { commandId, result }`。
 */

window.__ModuleLoader__.load({
  id: 'dsh-pack-and-go',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useMemo, useRef, useState } = React

    let ownerCtx = null
    const BUILD_TAG = 'b2111-0200'

    /** DSH 主题 token（深色/浅色自动跟随）。 */
    const THEME = {
      bg: 'var(--dsw-alias-bg-overlay)',
      surface: 'var(--dsw-alias-bg-layer-1)',
      border: 'var(--dsw-alias-border-l1)',
      borderStrong: 'var(--dsw-alias-border-l2)',
      text: 'var(--dsw-alias-label-primary)',
      textMuted: 'var(--dsw-alias-label-secondary)',
      error: 'var(--dsw-alias-state-error-primary)',
      success: 'var(--dsw-alias-state-success-primary)',
    }

    const TEXTS = {
      zh: {
        title: '对话与工作区迁移',
        launcher: '迁移对话或工作区',
        subtitle: '把对话和项目打包带走，换台电脑继续。',
        tabExport: '导出',
        tabImport: '导入',
        loading: '正在读取工作区与对话…',
        loadFailed: '读取失败：',
        noSessions: '还没有可迁移的对话。先在 DSH 里开始一个对话。',
        selected: (n) => `已选 ${n} 个对话`,
        selectedStats: (workspaces, sessions) =>
          `已选 ${workspaces} 个工作区 · ${sessions} 个对话`,
        fileEstimate: (size) => `含项目文件约 ${size}`,
                showArchived: '显示已归档',
        ungrouped: '未分组',
        archivedNotice: '已归档会话暂不参与导出（可在 DSH 侧边栏取消归档后再试）。',
        copyPath: '复制路径',
        advanced: '高级选项',
        fullMode: '全量打包（不排除任何目录）',
        preflight: '导出前预检',
        excludePlaceholder: '额外排除目录，逗号分隔（如 .cache,tmp）',
        attachmentsTodo: '附件打包将在后续版本支持。',
        attachments: '包含附件（图片 / 文件）',
        preview: '预览',
        previewTitle: '迁移包预览',
        previewCounts: (sessions, workspaces, attachments) =>
          `对话 ${sessions} · 工作区 ${workspaces} · 附件 ${attachments}`,
        previewConflicts: (n) => `与当前数据冲突 ${n} 项（导入时按所选策略处理）`,
        conflictSummary: (sessions, workspaces) =>
          `与当前数据冲突：${sessions} 个对话、${workspaces} 个工作区`,
        conflictSessionLine: (name, kind) => `对话「${name}」：${kind}`,
        conflictWorkspaceLine: (name) => `工作区「${name}」：路径已存在，将复用/合并`,
        conflictMigrateKind: '覆盖将迁移到新目录',
        conflictInPlaceKind: '覆盖原地恢复',
        conflictMore: (n) => `…等 ${n} 项`,
        conflictModeLabel: '冲突处理',
        conflictSkipShort: '跳过',
        conflictOverwriteShort: '覆盖',
        placeOriginal: '放回原路径',
        placeFolder: '指定目录',        conflictSkip: '已存在对话：跳过',
        conflictOverwrite: '已存在对话：覆盖',
        importNeedsTarget: '请先选择目标目录（导入必须指定目录，不会自动回退）。',
        restartHint:
          '导入内容若未出现在左侧列表，请重启 DSH 后可见（工作区索引在启动时构建）。',
        sessionsUnit: (n) => `${n} 个对话`,
        savePlaceholder: '保存位置：输入完整路径，或点「选择目录」',
        pickDirectory: '选择目录',
        startExport: '开始打包',
        exportModeSessions: '对话 + 工作区',
        exportModeWorkspaces: '仅工作区',
        exportNeedsWorkspace: '请至少选择一个工作区。',
        workspacesOnlyHint: '导出工作区的文件与目录结构（空文件夹保留骨架），不导出任何对话。',
        noWorkspaces: '没有可用的工作区。',
        packing: '打包中…',
        exportNeedsSelection: '请至少选择一个对话。',
        exportNeedsPath: '请填写保存位置。',
        noContext: '没有可用的对话上下文。',
        importHint: '选择迁移包，并填写目标目录（必填；导入失败会直接报错，不会自动回退到默认目录）。',
        packPlaceholder: '迁移包路径',
        targetPlaceholder: '目标目录（必填）',
        startImport: '开始导入',
        importing: '导入中…',
        importNeedsPack: '请填写迁移包路径。',
        exportDone: '打包完成',
        importDone: '导入完成',
        includeFiles: '将工作区一并导出',
        includeFilesHint: '默认只打包对话；勾选后会把所选对话所属工作区的文件一并打包。',
        noSelectionHint: '至少选择一个对话，或勾选一个工作区。',
        pickPack: '选择文件',
        pickPackEmpty: '该目录下没有 .dshpack 文件。',
        packageOptions: '选择迁移包：',
        openOverlay: '打开迁移面板',
        packageName: '包名（可选）',
        commandNotExecuted: '命令未执行：未找到命令或会话上下文不可用。',
        commandFailed: '命令调用失败：',
        defaultWorkspace: '默认工作区',
        sessionFallback: (shortId) => `对话 ${shortId}`,
        close: '关闭',
        dragHint: '拖动标题栏可移动',
        diagnostics: (w, s) => `诊断：workspaces=${w} sessions=${s}`,
      },
      en: {
        title: 'Conversation & Workspace Migration',
        launcher: 'Migrate conversations or workspaces',
        subtitle: 'Package conversations and projects, then continue on another machine.',
        tabExport: 'Export',
        tabImport: 'Import',
        loading: 'Reading workspaces and conversations…',
        loadFailed: 'Failed to load: ',
        noSessions: 'Nothing to migrate yet. Start a conversation in DSH first.',
        selected: (n) => `${n} selected`,
        selectedStats: (workspaces, sessions) =>
          `${workspaces} workspaces · ${sessions} conversations`,
        fileEstimate: (size) => `~${size} with files`,
                showArchived: 'Show archived',
        ungrouped: 'Ungrouped',
        archivedNotice: 'Archived conversations are not exportable yet; unarchive them in DSH first.',
        copyPath: 'Copy path',
        advanced: 'Advanced options',
        fullMode: 'Full packing (exclude nothing)',
        preflight: 'Preflight before export',
        excludePlaceholder: 'Extra excluded dirs, comma separated (e.g. .cache,tmp)',
        attachmentsTodo: 'Attachment packing is planned for a later version.',
        attachments: 'Include attachments (images / files)',
        preview: 'Preview',
        previewTitle: 'Package preview',
        previewCounts: (sessions, workspaces, attachments) =>
          `${sessions} conversations · ${workspaces} workspaces · ${attachments} attachments`,
        previewConflicts: (n) => `${n} conflicts with current data (handled by the selected policy)`,
        conflictSummary: (sessions, workspaces) =>
          `Conflicts with current data: ${sessions} conversations, ${workspaces} workspaces`,
        conflictSessionLine: (name, kind) => `Conversation "${name}": ${kind}`,
        conflictWorkspaceLine: (name) =>
          `Workspace "${name}": path exists, will be reused/merged`,
        conflictMigrateKind: 'overwrite will migrate to the new folder',
        conflictInPlaceKind: 'overwrite in place',
        conflictMore: (n) => `…and ${n} more`,
        conflictModeLabel: 'Conflict policy',
        conflictSkipShort: 'skip',
        conflictOverwriteShort: 'overwrite',
        placeOriginal: 'Restore original path',
        placeFolder: 'Choose folder',
        conflictSkip: 'Existing conversations: skip',
        conflictOverwrite: 'Existing conversations: overwrite',
        importNeedsTarget: 'Choose a target folder first (import requires a folder and never falls back).',
        restartHint:
          'If imported items do not appear on the left, restart DSH (the workspace index is built at startup).',
        sessionsUnit: (n) => `${n} conversations`,
        savePlaceholder: 'Save to: type a full path, or choose a folder',
        pickDirectory: 'Choose folder',
        startExport: 'Start export',
        exportModeSessions: 'Conversations + workspaces',
        exportModeWorkspaces: 'Workspaces only',
        exportNeedsWorkspace: 'Select at least one workspace.',
        workspacesOnlyHint: 'Export workspace files and folder structure (empty folders keep their skeleton); no conversations.',
        noWorkspaces: 'No workspaces available.',
        packing: 'Packing…',
        exportNeedsSelection: 'Select at least one conversation.',
        exportNeedsPath: 'Choose where to save the package.',
        noContext: 'No conversation context available.',
        importHint: 'Choose a package and a target folder (required; failures are reported, never silently fell back).',
        packPlaceholder: 'Package path',
        targetPlaceholder: 'Target folder (required)',
        startImport: 'Start import',
        importing: 'Importing…',
        importNeedsPack: 'Enter the package path.',
        exportDone: 'Export finished',
        importDone: 'Import finished',
        includeFiles: 'Include workspace files',
        includeFilesHint: 'By default only conversations are packed; enable to include files of the workspaces above.',
        noSelectionHint: 'Select at least one conversation, or a workspace.',
        pickPack: 'Choose package',
        pickPackEmpty: 'No .dshpack files in that folder.',
        packageOptions: 'Choose a package:',
        openOverlay: 'Open migration panel',
        packageName: 'Package name (optional)',
        commandNotExecuted: 'Command did not run: unknown command or unavailable session context.',
        commandFailed: 'Command call failed: ',
        defaultWorkspace: 'Default Workspace',
        sessionFallback: (shortId) => `Conversation ${shortId}`,
        close: 'Close',
        dragHint: 'Drag the title bar to move',
        diagnostics: (w, s) => `diagnostics: workspaces=${w} sessions=${s}`,
      },
    }

    /** 浮层开关（footer 按钮与 overlay 组件共享）。 */
    const overlayStore = {
      visible: false,
      listeners: new Set(),
      set(next) {
        overlayStore.visible = next
        for (const listener of overlayStore.listeners) listener()
      },
      subscribe(listener) {
        overlayStore.listeners.add(listener)
        return () => overlayStore.listeners.delete(listener)
      },
    }

    function getService(name) {
      try {
        return ownerCtx && typeof ownerCtx.get === 'function'
          ? ownerCtx.get(name)
          : undefined
      } catch {
        return undefined
      }
    }

    function getRemote() {
      try {
        return ownerCtx && ownerCtx.remote ? ownerCtx.remote : undefined
      } catch {
        return undefined
      }
    }

    function currentLocaleId() {
      try {
        const locale =
          (ownerCtx && ownerCtx.locale) || getService('locale')
        const snapshot =
          locale && typeof locale.getLocale === 'function' ? locale.getLocale() : null
        const id = snapshot && (snapshot.active ?? snapshot.id ?? snapshot.locale ?? snapshot.language)
        return typeof id === 'string' && id.toLowerCase().startsWith('en') ? 'en' : 'zh'
      } catch {
        return 'zh'
      }
    }

    function shortSessionId(id) {
      const text = String(id ?? '')
      return text.startsWith('session-') ? text.slice(8, 16) : text.slice(0, 8)
    }

    function formatBytes(bytes) {
      if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
      const units = ['B', 'KB', 'MB', 'GB']
      let value = bytes
      let index = 0
      while (value >= 1024 && index < units.length - 1) {
        value /= 1024
        index += 1
      }
      return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`
    }

    function displayWorkspaceTitle(title, localeId) {
      if (title === 'default-workspace') {
        return localeId === 'en' ? 'Default Workspace' : '默认工作区'
      }
      return title
    }

    function titleOf(item) {
      const values = item && item.projections ? item.projections.values : undefined
      const title = values ? values.title : undefined
      if (typeof title === 'string' && title.length > 0) return title
      if (title && typeof title === 'object' && typeof title.title === 'string') {
        return title.title
      }
      return undefined
    }

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
          style: { opacity: active ? 1 : 0.78 },
        },
        h('path', { d: 'M4 7h13' }),
        h('path', { d: 'M14 4l3 3-3 3' }),
        h('path', { d: 'M20 17H7' }),
        h('path', { d: 'M10 14l-3 3 3 3' }),
      )
    }

    /** 侧边栏底部动作（宽栏显示文字，窄栏只显示图标）。 */
    function MoverLauncher(props) {
      const [localeId, setLocaleId] = useState(currentLocaleId)
      useEffect(() => {
        const locale = getService('locale')
        const disposer =
          locale && typeof locale.subscribe === 'function'
            ? locale.subscribe(() => setLocaleId(currentLocaleId()))
            : undefined
        return () => {
          if (typeof disposer === 'function') disposer()
        }
      }, [])
      const label = (TEXTS[localeId] ?? TEXTS.zh).launcher
      const wide = Boolean(props && props.wide)
      return h(
        'button',
        {
          type: 'button',
          title: label,
          'aria-label': label,
          onClick: () => overlayStore.set(!overlayStore.visible),
          style: {
            height: 32,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: wide ? '0 10px' : 0,
            border: '1px solid transparent',
            background: 'transparent',
            color: THEME.textMuted,
            cursor: 'pointer',
            borderRadius: 8,
            fontSize: 12,
            maxWidth: '100%',
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
          },
        },
        h(MoverIcon, { size: 18, active: overlayStore.visible }),
        wide ? h('span', null, label) : null,
      )
    }

    class MoverBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }

      static getDerivedStateFromError(error) {
        return { error }
      }

      render() {
        if (this.state.error) {
          return h(
            'pre',
            {
              style: {
                padding: 16,
                margin: 0,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                color: THEME.error,
                fontSize: 12,
              },
            },
            `MOVER ERROR\n${this.state.error && (this.state.error.stack || this.state.error)}`,
          )
        }
        return this.props.children
      }
    }

    /** 设置页备用入口（SPEC FR-1）：点击打开迁移浮层并关闭设置面板。 */
    function MoverSettingsSection(props) {
      const [localeId, setLocaleId] = useState(currentLocaleId)
      useEffect(() => {
        const locale = getService('locale')
        const disposer =
          locale && typeof locale.subscribe === 'function'
            ? locale.subscribe(() => setLocaleId(currentLocaleId()))
            : undefined
        return () => {
          if (typeof disposer === 'function') disposer()
        }
      }, [])
      const t = TEXTS[localeId] ?? TEXTS.zh
      return h(
        'div',
        { style: { padding: 16 } },
        h('div', { style: { fontSize: 14, fontWeight: 600, color: THEME.text } }, t.title),
        h(
          'div',
          { style: { fontSize: 12, color: THEME.textMuted, marginTop: 4, marginBottom: 12 } },
          t.subtitle,
        ),
        h(
          'button',
          {
            type: 'button',
            onClick: () => {
              overlayStore.set(true)
              if (props && typeof props.close === 'function') props.close()
            },
            style: primaryButtonStyle(false),
          },
          t.openOverlay,
        ),
      )
    }

    function MoverOverlay() {
      const [visible, setVisible] = useState(overlayStore.visible)
      useEffect(() => overlayStore.subscribe(() => setVisible(overlayStore.visible)), [])
      if (!visible) return null
      return h(MoverBoundary, null, h(MoverDialog))
    }

    function MoverDialog() {
      const [localeId, setLocaleId] = useState(currentLocaleId)
      const [tab, setTab] = useState('export')
      const [status, setStatus] = useState('loading')
      const [groups, setGroups] = useState([])
      const [rawItems, setRawItems] = useState([])
      const [selected, setSelected] = useState(() => new Set())
      const [exportMode, setExportMode] = useState('sessions')
      const [workspaceOnlySelection, setWorkspaceOnlySelection] = useState(() => new Set())
      const [targetPath, setTargetPath] = useState('')
      const [importPackPath, setImportPackPath] = useState('')
      const [importTarget, setImportTarget] = useState('')
      const [includeFiles, setIncludeFiles] = useState(false)
      const [packOptions, setPackOptions] = useState([])
      const [busy, setBusy] = useState(false)
      const [message, setMessage] = useState(null)
      const [error, setError] = useState(null)
      const [reloadTick, setReloadTick] = useState(0)
      const [meta, setMeta] = useState(null)
      const [sizeById, setSizeById] = useState(() => new Map())
      const [workspaceBytes, setWorkspaceBytes] = useState(() => new Map())
      const [showArchived, setShowArchived] = useState(false)
      const [lastExport, setLastExport] = useState(null)
      const [fullMode, setFullMode] = useState(false)
      const [extraExclude, setExtraExclude] = useState('')
      const [includeAttachments, setIncludeAttachments] = useState(false)
      const [exportName, setExportName] = useState('')
      const [preview, setPreview] = useState(null)
      const [importConflictMode, setImportConflictMode] = useState('skip')
      const [needsRestartHint, setNeedsRestartHint] = useState(false)
      const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
      const dragRef = useRef(null)

      const t = TEXTS[localeId] ?? TEXTS.zh
      const uiService = getService('uiWorkspace')
      const canPickDirectory = Boolean(
        uiService && typeof uiService.pickDirectory === 'function',
      )

      useEffect(() => {
        const locale = getService('locale')
        const disposer =
          locale && typeof locale.subscribe === 'function'
            ? locale.subscribe(() => setLocaleId(currentLocaleId()))
            : undefined
        return () => {
          if (typeof disposer === 'function') disposer()
        }
      }, [])

      useEffect(() => {
        const onKeyDown = (event) => {
          if (event.key === 'Escape') overlayStore.set(false)
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
      }, [])

      useEffect(() => {
        let cancelled = false
        const controller = new AbortController()
        async function load() {
          try {
            const remote = getRemote()
            if (!remote || !remote.workspace || typeof remote.workspace.follow !== 'function') {
              throw new Error('client remote.workspace.follow unavailable')
            }

            let items = []
            let archivedIds = new Set()
            const stream = await remote.workspace.follow(controller.signal)
            try {
              for await (const frame of stream) {
                if (cancelled) break
                if (frame.type === 'baseline' || frame.type === 'replace') {
                  items = frame.value?.items ?? []
                  archivedIds = new Set(frame.value?.archivedSessionIds ?? [])
                  break
                }
              }
            } finally {
              if (typeof stream.dispose === 'function') stream.dispose()
            }
            if (cancelled) return

            let listItems = []
            let titles = new Map()
            try {
              const listResult = await remote.session.list({})
              listItems = listResult?.items ?? []
              titles = new Map(
                listItems
                  .map((item) => [item.sessionId, titleOf(item)])
                  .filter(([, title]) => typeof title === 'string' && title.length > 0),
              )
            } catch {
              // 标题不可用时走命令兜底
            }

            const firstSessionId =
              listItems.find((item) => typeof item?.sessionId === 'string')?.sessionId ??
              items.flatMap((workspace) => workspace.sessionIds ?? [])[0]
            let titleInfo = null
            try {
              const execResult = await runAction('list', {})
              if (!execResult.unsupported && execResult.result?.kind === 'success') {
                titleInfo = parseCatalogText(execResult.result.text)
              }
            } catch {
              titleInfo = null
            }
            if (!titleInfo && firstSessionId) {
              titleInfo = await loadTitlesFromCommand(remote, firstSessionId)
            }
            if (titleInfo) {
              if (titleInfo.meta) {
                setMeta(titleInfo.meta)
                // 默认目标目录：用户目录/dsh-pack-and-go-import（可改）；留空提交会报错，不会静默回退。
                if (typeof titleInfo.meta.defaultImportDir === 'string') {
                  const defaultDir = titleInfo.meta.defaultImportDir
                  setImportTarget((current) => (current.trim().length === 0 ? defaultDir : current))
                }
              }
              if ((titleInfo.sizes?.size ?? 0) > 0) setSizeById(titleInfo.sizes)
              for (const [id, title] of titleInfo.titles ?? []) {
                if (!titles.has(id) && typeof title === 'string' && title.length > 0) {
                  titles.set(id, title)
                }
              }
            }

            setRawItems(items)
            setGroups(
              groupFromWorkspaces(items, listItems, titles, localeId, t, archivedIds, showArchived),
            )
            setStatus('ready')
          } catch (loadError) {
            if (cancelled) return
            console.error('[dsh-pack-and-go] load failed', loadError)
            setStatus('error')
            setError(loadError instanceof Error ? loadError.message : String(loadError))
          }
        }
        load()
        return () => {
          cancelled = true
          controller.abort()
        }
      }, [reloadTick])

      async function loadTitlesFromCommand(remote, sessionId) {
        try {
          const response = await remote.commands.execute(sessionId, '/mover list', [])
          if (!response || response.ok !== true) {
            return { titles: new Map(), meta: null, sizes: new Map() }
          }
          const execution = response.value
          if (!execution) {
            return { titles: new Map(), meta: null, sizes: new Map() }
          }
          const commandResult = execution.result ?? execution
          if (commandResult.kind !== 'success' || typeof commandResult.text !== 'string') {
            return { titles: new Map(), meta: null, sizes: new Map() }
          }
          const data = JSON.parse(commandResult.text)
          const titles = new Map()
          const sizes = new Map()
          for (const workspace of data.workspaces ?? []) {
            for (const session of workspace.sessions ?? []) {
              if (session.id && session.title) titles.set(session.id, session.title)
              if (session.id && typeof session.sizeBytes === 'number') {
                sizes.set(session.id, session.sizeBytes)
              }
            }
          }
          for (const session of data.ungrouped ?? []) {
            if (session.id && session.title) titles.set(session.id, session.title)
            if (session.id && typeof session.sizeBytes === 'number') {
              sizes.set(session.id, session.sizeBytes)
            }
          }
          return { titles, meta: data.meta ?? null, sizes }
        } catch {
          return { titles: new Map(), meta: null, sizes: new Map() }
        }
      }

      const allSessions = useMemo(
        () => groups.flatMap((group) => group.sessions),
        [groups],
      )
      const agentId = allSessions.length > 0 ? allSessions[0].sessionId : undefined

      const selectedGroups = useMemo(
        () =>
          groups.filter((group) =>
            group.sessions.some((session) => selected.has(session.sessionId)),
          ),
        [groups, selected],
      )
      const sessionBytes = useMemo(
        () =>
          allSessions
            .filter((session) => selected.has(session.sessionId))
            .reduce((sum, session) => sum + (sizeById.get(session.sessionId) ?? 0), 0),
        [allSessions, selected, sizeById],
      )
      const fileBytes = includeFiles
        ? selectedGroups.reduce(
            (sum, group) => sum + (workspaceBytes.get(group.cwd) ?? 0),
            0,
          )
        : 0
      const visibleGroups = groups

      const statsText = `${t.selectedStats(selectedGroups.length, selected.size)}${
        includeFiles ? ` · ${t.fileEstimate(formatBytes(sessionBytes + fileBytes))}` : ''
      }`

      useEffect(() => {
        if (!includeFiles) return
        const remote = getRemote()
        if (!remote || !agentId) return
        const paths = [
          ...new Set(
            groups
              .filter((group) =>
                group.sessions.some((session) => selected.has(session.sessionId)),
              )
              .map((group) => group.cwd)
              .filter((path) => typeof path === 'string' && path.length > 0),
          ),
        ]
        if (paths.length === 0) return
        const timer = setTimeout(async () => {
          try {
            const line = `/mover size ${paths.map((path) => `"${path}"`).join(' ')}`
            const response = await remote.commands.execute(agentId, line, [])
            if (!response || response.ok !== true) return
            const execution = response.value
            const commandResult = execution && (execution.result ?? execution)
            if (!commandResult || commandResult.kind !== 'success') return
            const data = JSON.parse(commandResult.text)
            setWorkspaceBytes(
              new Map((data.items ?? []).map((item) => [item.path, item.bytes ?? 0])),
            )
          } catch {
            // 估算失败不影响主流程
          }
        }, 300)
        return () => clearTimeout(timer)
      }, [selected, includeFiles, groups, agentId])

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

      /**
       * ADR-0011 的 exact Fetch 操作入口：不依赖会话上下文、不写会话日志。
       * 路由不存在（404）时返回 { unsupported: true }，调用方回退命令通道。
       * @param {string} action
       * @param {object} [args]
       */
      async function runAction(action, args = {}) {
        const response = await fetch('/api/mover/exec', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action, args }),
        })
        if (response.status === 404) return { unsupported: true }
        let payload
        try {
          payload = await response.json()
        } catch {
          throw new Error(`exec ${action} returned non-JSON`)
        }
        if (!payload || payload.ok !== true) {
          throw new Error(payload?.error ?? `exec ${action} failed`)
        }
        return { unsupported: false, result: payload.result }
      }

      function parseCatalogText(text) {
        const data = JSON.parse(text)
        const titles = new Map()
        const sizes = new Map()
        const collect = (sessions) => {
          for (const session of sessions ?? []) {
            if (!session || typeof session.id !== 'string') continue
            if (typeof session.title === 'string' && session.title.length > 0) {
              titles.set(session.id, session.title)
            }
            if (typeof session.sizeBytes === 'number') sizes.set(session.id, session.sizeBytes)
          }
        }
        for (const workspace of data.workspaces ?? []) collect(workspace.sessions)
        collect(data.ungrouped)
        return { titles, sizes, meta: data.meta ?? null }
      }

      /**
       * 统一操作入口：优先 ADR-0011 的 exec 路由，404 时回退命令通道。
       * @param {string} action
       * @param {object} args
       * @param {() => string} buildCommand
       */
      async function runMoverAction(action, args, buildCommand) {
        setBusy(true)
        setError(null)
        setMessage(null)
        try {
          const execResult = await runAction(action, args)
          if (!execResult.unsupported) {
            const result = execResult.result
            const text = typeof result?.text === 'string' ? result.text : ''
            const ok = result?.kind === 'success'
            if (ok) {
              setMessage(text)
              setReloadTick((tick) => tick + 1)
            } else {
              setError(text || t.commandFailed)
            }
            return { ok, text }
          }
          return await runCommand(buildCommand(), t.exportDone)
        } catch (error) {
          setError(error instanceof Error ? error.message : String(error))
          return { ok: false }
        } finally {
          setBusy(false)
        }
      }

      async function runCommand(line, successText) {
        if (!agentId) {
          setError(t.noContext)
          return { ok: false }
        }
        setBusy(true)
        setError(null)
        setMessage(null)
        try {
          const remote = getRemote()
          if (!remote || !remote.commands || typeof remote.commands.execute !== 'function') {
            throw new Error('client remote.commands.execute unavailable')
          }
          // 官方调用：execute(sessionId, line, attachments)，返回 RemoteResult { ok, value }
          const response = await remote.commands.execute(agentId, line, [])
          if (!response) {
            setError(t.commandNotExecuted)
            return { ok: false }
          }
          if (response.ok !== true) {
            const detail = response.error
              ? `${response.error.code ?? ''} ${response.error.message ?? ''}`.trim()
              : ''
            setError(`${t.commandFailed}${detail}`)
            return { ok: false }
          }
          const execution = response.value
          if (!execution) {
            setError(t.commandNotExecuted)
            return { ok: false }
          }
          const commandResult = execution.result ?? execution
          const text =
            typeof commandResult.text === 'string' && commandResult.text.length > 0
              ? commandResult.text
              : successText
          if (commandResult.kind === 'error') {
            setError(text)
            return { ok: false }
          }
          setMessage(text)
          setReloadTick((tick) => tick + 1)
          return { ok: true, text }
        } catch (executeError) {
          setError(executeError instanceof Error ? executeError.message : String(executeError))
          return { ok: false }
        } finally {
          setBusy(false)
        }
      }

      async function pickDirectory() {
        if (!canPickDirectory) return
        try {
          const dir = await uiService.pickDirectory()
          if (typeof dir === 'string' && dir.length > 0) setTargetPath(dir)
        } catch (pickError) {
          setError(pickError instanceof Error ? pickError.message : String(pickError))
        }
      }

      async function startExport() {
        if (exportMode === 'workspaces') {
          if (workspaceOnlySelection.size === 0) {
            setError(t.exportNeedsWorkspace)
            return
          }
          if (targetPath.trim().length === 0) {
            setError(t.exportNeedsPath)
            return
          }
          const paths = [...workspaceOnlySelection]
          setLastExport(null)
          const started = Date.now()
          const message = await runMoverAction(
            'export',
            { target: targetPath.trim(), workspaces: paths },
            () =>
              `/mover export "${targetPath.trim()}"${paths
                .map((item) => ` --workspace "${item}"`)
                .join('')}`,
          )
          if (message && message.ok) {
            const match = String(message.text ?? '').match(/到 (.+?)（(\d+) 字节）/)
            setLastExport({
              path: match ? match[1] : targetPath.trim(),
              bytes: match ? Number(match[2]) : 0,
              durationMs: Date.now() - started,
            })
          }
          return
        }
        if (selected.size === 0) {
          setError(t.exportNeedsSelection)
          return
        }
        if (targetPath.trim().length === 0) {
          setError(t.exportNeedsPath)
          return
        }
        const ids = [...selected]
        const excluded = extraExclude
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
        setLastExport(null)
        const started = Date.now()
        const message = await runMoverAction(
          'export',
          {
            target: targetPath.trim(),
            sessionIds: ids,
            includeFiles,
            options: {
              includeFork: true,
              full: fullMode,
              attachments: includeAttachments,
              excludedDirs: excluded,
              name: exportName.trim(),
            },
          },
          () => {
            const flags = []
            if (includeFiles) flags.push('--files')
            if (fullMode) flags.push('--full')
            if (includeAttachments) flags.push('--attachments')
            const excludeArg = excluded.length > 0 ? ` --exclude "${excluded.join(',')}"` : ''
            const nameArg = exportName.trim().length > 0 ? ` --name "${exportName.trim()}"` : ''
            const flagText = flags.length > 0 ? ` ${flags.join(' ')}` : ''
            return `/mover export "${targetPath.trim()}"${flagText}${excludeArg}${nameArg} ${ids.join(' ')}`
          },
        )
        if (message && message.ok) {
          const match = String(message.text ?? '').match(/到 (.+?)（(\d+) 字节）/)
          setLastExport({
            path: match ? match[1] : targetPath.trim(),
            bytes: match ? Number(match[2]) : 0,
            durationMs: Date.now() - started,
          })
        }
      }

      async function pickPack() {
        if (!canPickDirectory) return
        try {
          const dir = await uiService.pickDirectory()
          if (typeof dir !== 'string' || dir.length === 0) return
          let text = null
          const execResult = await runAction('find', { dir })
          if (!execResult.unsupported) {
            if (execResult.result?.kind === 'success') {
              text = execResult.result.text
            } else {
              setError(execResult.result?.text ?? t.commandFailed)
              return
            }
          } else {
            if (!agentId) {
              setError(t.noContext)
              return
            }
            const remote = getRemote()
            if (!remote || !remote.commands || typeof remote.commands.execute !== 'function') {
              setError(t.commandFailed)
              return
            }
            const response = await remote.commands.execute(agentId, `/mover find "${dir}"`, [])
            if (!response || response.ok !== true) {
              setError(t.commandFailed)
              return
            }
            const execution = response.value
            const commandResult = execution && (execution.result ?? execution)
            if (
              !commandResult ||
              commandResult.kind !== 'success' ||
              typeof commandResult.text !== 'string'
            ) {
              setError(t.commandFailed)
              return
            }
            text = commandResult.text
          }
          const data = JSON.parse(text)
          const packs = data.packs ?? []
          if (packs.length === 0) {
            setError(t.pickPackEmpty)
            return
          }
          if (packs.length === 1) {
            setImportPackPath(packs[0].path)
            setPackOptions([])
            return
          }
          setPackOptions(packs)
        } catch (pickError) {
          setError(pickError instanceof Error ? pickError.message : String(pickError))
        }
      }

      async function previewPack() {
        if (importPackPath.trim().length === 0) {
          setError(t.importNeedsPack)
          return
        }
        try {
          let text = null
          const execResult = await runAction('inspect', {
            pack: importPackPath.trim(),
            ...(importTarget.trim().length > 0 ? { target: importTarget.trim() } : {}),
          })
          if (!execResult.unsupported) {
            if (execResult.result?.kind === 'success') {
              text = execResult.result.text
            } else {
              setError(execResult.result?.text ?? t.commandFailed)
              return
            }
          } else {
            if (!agentId) {
              setError(t.noContext)
              return
            }
            const remote = getRemote()
            if (!remote || !remote.commands || typeof remote.commands.execute !== 'function') {
              setError(t.commandFailed)
              return
            }
            const response = await remote.commands.execute(
              agentId,
              `/mover inspect "${importPackPath.trim()}"`,
              [],
            )
            if (!response || response.ok !== true) {
              setError(t.commandFailed)
              return
            }
            const execution = response.value
            const commandResult = execution && (execution.result ?? execution)
            if (!commandResult || commandResult.kind !== 'success') {
              setError(t.commandFailed)
              return
            }
            text = commandResult.text
          }
          setPreview(JSON.parse(text))
        } catch (previewError) {
          setError(previewError instanceof Error ? previewError.message : String(previewError))
        }
      }

      async function pickImportDirectory() {
        if (!canPickDirectory) return
        try {
          const dir = await uiService.pickDirectory()
          if (typeof dir === 'string' && dir.length > 0) setImportTarget(dir)
        } catch (pickError) {
          setError(pickError instanceof Error ? pickError.message : String(pickError))
        }
      }

      async function startImport() {
        if (importPackPath.trim().length === 0) {
          setError(t.importNeedsPack)
          return
        }
        const target = importTarget.trim()
        if (target.length === 0) {
          setError(t.importNeedsTarget)
          return
        }
        const message = await runMoverAction(
          'import',
          {
            pack: importPackPath.trim(),
            target,
            options: {
              sessionPolicy: importConflictMode === 'overwrite' ? 'overwrite' : 'skip',
            },
          },
          () => {
            const overwriteArg = importConflictMode === 'overwrite' ? ' --overwrite' : ''
            return `/mover import "${importPackPath.trim()}" "${target}"${overwriteArg}`
          },
        )
        if (message && message.ok) setNeedsRestartHint(true)
      }

      function onHeaderMouseDown(event) {
        if (event.button !== 0) return
        event.preventDefault()
        dragRef.current = {
          startX: event.clientX,
          startY: event.clientY,
          originX: dragOffset.x,
          originY: dragOffset.y,
        }
        const onMove = (moveEvent) => {
          const base = dragRef.current
          if (!base) return
          setDragOffset({
            x: base.originX + moveEvent.clientX - base.startX,
            y: base.originY + moveEvent.clientY - base.startY,
          })
        }
        const onUp = () => {
          dragRef.current = null
          window.removeEventListener('mousemove', onMove)
          window.removeEventListener('mouseup', onUp)
        }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
      }

      return h(
        'div',
        {
          style: {
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            zIndex: 1200,
            pointerEvents: 'auto',
          },
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) overlayStore.set(false)
          },
        },
        h(
          'div',
          {
            style: {
              position: 'fixed',
              left: '50%',
              top: '50%',
              transform: `translate(calc(-50% + ${dragOffset.x}px), calc(-50% + ${dragOffset.y}px))`,
              width: 480,
              maxWidth: 'calc(100vw - 32px)',
              maxHeight: '72vh',
              overflow: 'auto',
              border: `1px solid ${THEME.border}`,
              borderRadius: 14,
              boxShadow: '0 18px 48px rgba(0,0,0,0.35)',
              background: 'var(--dsw-alias-bg-base)',
              color: THEME.text,
              backdropFilter: 'blur(10px)',
              padding: '12px 16px 16px',
            },
          },
          h(
            'div',
            {
              onMouseDown: onHeaderMouseDown,
              style: {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'move',
                userSelect: 'none',
                marginBottom: 8,
              },
              title: t.dragHint,
            },
            h('div', { style: { fontSize: 16, fontWeight: 600, color: THEME.text } }, t.title),
            h(
              'button',
              {
                type: 'button',
                onClick: () => overlayStore.set(false),
                title: t.close,
                'aria-label': t.close,
                style: {
                  width: 24,
                  height: 24,
                  border: 'none',
                  background: 'transparent',
                  color: THEME.textMuted,
                  opacity: 0.8,
                  cursor: 'pointer',
                  fontSize: 18,
                  lineHeight: '24px',
                  padding: 0,
                },
              },
              '×',
            ),
          ),
          h('div', { style: { fontSize: 12, color: THEME.textMuted, marginTop: 2 } }, t.subtitle),
          meta
            ? h(
                'div',
                {
                  style: {
                    fontSize: 10,
                    color: THEME.textMuted,
                    opacity: 0.7,
                    marginTop: 2,
                    marginBottom: 8,
                    wordBreak: 'break-all',
                  },
                },
                `${meta.platform ?? '-'} · ${meta.dshHome ?? '-'} · ${meta.dshVersion ?? '-'}`,
              )
            : h('div', { style: { marginBottom: 8 } }),
          tabBar(),
          tab === 'export' ? exportView() : importView(),
          message
            ? h('div', { style: { marginTop: 10, fontSize: 13, color: THEME.success } }, message)
            : null,
          error
            ? h('div', { style: { marginTop: 10, fontSize: 13, color: THEME.error } }, error)
            : null,
        ),
      )

      function tabBar() {
        return h(
          'div',
          { style: { display: 'flex', gap: 8, marginBottom: 10 } },
          tabButton(t.tabExport, 'export'),
          tabButton(t.tabImport, 'import'),
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
              padding: '5px 14px',
              borderRadius: 999,
              cursor: 'pointer',
              fontSize: 12,
              border: `1px solid ${THEME.border}`,
              background: active
                ? `color-mix(in srgb, ${THEME.text} 10%, transparent)`
                : 'transparent',
              color: THEME.text,
              fontWeight: active ? 600 : 400,
            },
          },
          text,
        )
      }

      function workspaceOnlyTree() {
        const items = groups.filter(
          (group) => typeof group.cwd === 'string' && group.cwd.length > 0,
        )
        if (items.length === 0) {
          return h(
            'div',
            { style: { padding: 12, fontSize: 12, color: THEME.textMuted } },
            t.noWorkspaces,
          )
        }
        return h(
          'div',
          {
            style: {
              maxHeight: 200,
              overflow: 'auto',
              border: `1px solid ${THEME.border}`,
              borderRadius: 8,
              padding: 8,
            },
          },
          ...items.map((group) =>
            h(
              'label',
              {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '4px 2px',
                  fontSize: 12,
                  color: THEME.text,
                  cursor: busy ? 'default' : 'pointer',
                },
              },
              h('input', {
                type: 'checkbox',
                checked: workspaceOnlySelection.has(group.cwd),
                disabled: busy,
                onChange: (event) => {
                  setWorkspaceOnlySelection((prev) => {
                    const next = new Set(prev)
                    if (event.target.checked) next.add(group.cwd)
                    else next.delete(group.cwd)
                    return next
                  })
                },
              }),
              h(
                'span',
                { style: { flex: '1 1 auto', wordBreak: 'break-all' } },
                `${group.title}  ${group.cwd}`,
              ),
            ),
          ),
        )
      }

      function exportView() {
        const isWorkspacesOnly = exportMode === 'workspaces'
        const noSelection = isWorkspacesOnly
          ? workspaceOnlySelection.size === 0
          : selected.size === 0
        return h(
          'div',
          null,
          h(
            'div',
            { style: { display: 'flex', gap: 6, marginBottom: 8 } },
            ...[
              ['sessions', t.exportModeSessions],
              ['workspaces', t.exportModeWorkspaces],
            ].map(([mode, label]) =>
              h(
                'button',
                {
                  type: 'button',
                  disabled: busy,
                  onClick: () => setExportMode(mode),
                  style: {
                    padding: '5px 12px',
                    borderRadius: 6,
                    border: `1px solid ${
                      exportMode === mode ? THEME.text : THEME.border
                    }`,
                    background: exportMode === mode ? 'rgba(127,127,127,0.18)' : 'transparent',
                    color: THEME.text,
                    fontSize: 12,
                    cursor: busy ? 'default' : 'pointer',
                  },
                },
                label,
              ),
            ),
          ),
          isWorkspacesOnly
            ? h(
                'div',
                { style: { fontSize: 11, color: THEME.textMuted, marginBottom: 8 } },
                t.workspacesOnlyHint,
              )
            : null,
          status === 'loading'
            ? h(
                'div',
                { style: { padding: 16, fontSize: 13, color: THEME.textMuted } },
                h(Spinner),
                t.loading,
              )
            : status === 'error'
              ? h(
                  'div',
                  { style: { padding: 12, fontSize: 13, color: THEME.error } },
                  `${t.loadFailed}${error}`,
                )
              : isWorkspacesOnly
                ? workspaceOnlyTree()
                : treeBox(),
          isWorkspacesOnly
            ? null
            : h(
                'label',
                {
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    marginTop: 10,
                    fontSize: 13,
                    color: THEME.text,
                    cursor: busy ? 'default' : 'pointer',
                  },
                },
                h('input', {
                  type: 'checkbox',
                  checked: includeFiles,
                  disabled: busy,
                  onChange: (event) => setIncludeFiles(event.target.checked),
                }),
                h('span', null, t.includeFiles),
              ),
          isWorkspacesOnly
            ? null
            : h(
                'div',
                {
                  style: { fontSize: 11, color: THEME.textMuted, marginTop: 2, marginBottom: 8 },
                },
                t.includeFilesHint,
              ),
          isWorkspacesOnly
            ? null
            : h(
                'details',
            { style: { marginBottom: 8 } },
            h(
              'summary',
              { style: { fontSize: 11, color: THEME.textMuted, cursor: 'pointer' } },
              t.advanced,
            ),
            h(
              'div',
              {
                style: {
                  padding: '6px 0 0 4px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                },
              },
              h(
                'label',
                {
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 12,
                    color: THEME.text,
                  },
                },
                h('input', {
                  type: 'checkbox',
                  checked: fullMode,
                  disabled: busy,
                  onChange: (event) => setFullMode(event.target.checked),
                }),
                h('span', null, t.fullMode),
              ),
              h('input', {
                type: 'text',
                value: extraExclude,
                disabled: busy,
                placeholder: t.excludePlaceholder,
                onChange: (event) => setExtraExclude(event.target.value),
                style: fieldStyle(),
              }),
              h(
                'label',
                {
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 12,
                    color: THEME.text,
                  },
                },
                h('input', {
                  type: 'checkbox',
                  checked: includeAttachments,
                  disabled: busy,
                  onChange: (event) => setIncludeAttachments(event.target.checked),
                }),
                h('span', null, t.attachments),
              ),
            ),
          ),
          h(
            'div',
            {
              style: {
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                flexWrap: 'wrap',
              },
            },
            h('input', {
              type: 'text',
              value: targetPath,
              placeholder: t.savePlaceholder,
              onChange: (event) => setTargetPath(event.target.value),
              disabled: busy,
              style: fieldStyle(),
            }),
            h('input', {
              type: 'text',
              value: exportName,
              placeholder: t.packageName,
              onChange: (event) => setExportName(event.target.value),
              disabled: busy,
              style: { ...fieldStyle(), flex: '0 1 160px', minWidth: 120 },
            }),
            canPickDirectory
              ? h(
                  'button',
                  {
                    type: 'button',
                    onClick: pickDirectory,
                    disabled: busy,
                    style: buttonStyle(busy),
                  },
                  t.pickDirectory,
                )
              : null,
            h(
              'button',
              {
                type: 'button',
                onClick: startExport,
                disabled: busy || status !== 'ready' || noSelection,
                style: primaryButtonStyle(busy || status !== 'ready' || noSelection),
              },
              busy ? h('span', null, h(Spinner), t.packing) : t.startExport,
            ),
          ),
          noSelection
            ? h(
                'div',
                { style: { marginTop: 6, fontSize: 11, color: THEME.textMuted } },
                isWorkspacesOnly ? t.exportNeedsWorkspace : t.noSelectionHint,
              )
            : null,
          lastExport
            ? h(
                'div',
                {
                  style: {
                    marginTop: 10,
                    padding: '10px 12px',
                    border: `1px solid ${THEME.border}`,
                    borderRadius: 8,
                    fontSize: 12,
                  },
                },
                h('div', { style: { fontWeight: 600, color: THEME.text } }, t.exportDone),
                h(
                  'div',
                  {
                    style: {
                      color: THEME.textMuted,
                      marginTop: 2,
                      wordBreak: 'break-all',
                    },
                  },
                  lastExport.path,
                ),
                h(
                  'div',
                  { style: { color: THEME.textMuted, marginTop: 2 } },
                  `${formatBytes(lastExport.bytes)} · ${(lastExport.durationMs / 1000).toFixed(1)}s`,
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    onClick: () => {
                      try {
                        navigator.clipboard?.writeText(lastExport.path)
                      } catch {
                        // 复制失败不提示
                      }
                    },
                    style: {
                      ...buttonStyle(false),
                      marginTop: 6,
                      padding: '3px 8px',
                      fontSize: 11,
                    },
                  },
                  t.copyPath,
                ),
              )
            : null,
        )
      }

      function importView() {
        return h(
          'div',
          null,
          h(
            'div',
            { style: { fontSize: 12, color: THEME.textMuted, marginBottom: 8 } },
            t.importHint,
          ),
          h(
            'div',
            {
              style: {
                display: 'flex',
                gap: 14,
                fontSize: 12,
                marginBottom: 8,
                color: THEME.text,
              },
            },
            h(
              'label',
              { style: { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' } },
              h('input', {
                type: 'radio',
                name: 'mover-conflict',
                checked: importConflictMode === 'skip',
                onChange: () => setImportConflictMode('skip'),
              }),
              h('span', null, t.conflictSkip),
            ),
            h(
              'label',
              { style: { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' } },
              h('input', {
                type: 'radio',
                name: 'mover-conflict',
                checked: importConflictMode === 'overwrite',
                onChange: () => setImportConflictMode('overwrite'),
              }),
              h('span', null, t.conflictOverwrite),
            ),
          ),
          h(
            'div',
            { style: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 } },
            h('input', {
              type: 'text',
              value: importPackPath,
              placeholder: t.packPlaceholder,
              onChange: (event) => setImportPackPath(event.target.value),
              disabled: busy,
              style: fieldStyle(),
            }),
            canPickDirectory
              ? h(
                  'button',
                  {
                    type: 'button',
                    onClick: pickPack,
                    disabled: busy,
                    style: buttonStyle(busy),
                  },
                  t.pickPack,
                )
              : null,
            h(
              'button',
              {
                type: 'button',
                onClick: previewPack,
                disabled: busy,
                style: buttonStyle(busy),
              },
              t.preview,
            ),
          ),
          preview
            ? h(
                'div',
                {
                  style: {
                    border: `1px solid ${THEME.border}`,
                    borderRadius: 8,
                    padding: '8px 10px',
                    marginBottom: 8,
                    fontSize: 12,
                  },
                },
                h('div', { style: { fontWeight: 600, color: THEME.text } }, t.previewTitle),
                h(
                  'div',
                  { style: { color: THEME.textMuted, marginTop: 2 } },
                  `${preview.source?.platform ?? '-'} · DSH ${preview.source?.dshVersion ?? '-'} · ${formatBytes(preview.packBytes ?? 0)}`,
                ),
                h(
                  'div',
                  { style: { color: THEME.textMuted, marginTop: 2 } },
                  t.previewCounts(
                    preview.sessions ?? 0,
                    preview.workspaces ?? 0,
                    preview.attachments ?? 0,
                  ),
                ),
                (() => {
                  const conflictSessions = preview.conflictDetails?.sessions ?? []
                  const conflictWorkspaces = preview.conflictDetails?.workspaces ?? []
                  const total = conflictSessions.length + conflictWorkspaces.length
                  if (total === 0) return null
                  const lines = [
                    ...conflictSessions.slice(0, 5).map((item) =>
                      h(
                        'div',
                        { style: { marginTop: 2 } },
                        t.conflictSessionLine(
                          item.title ?? item.id,
                          item.kind === 'migrate-overwrite'
                            ? t.conflictMigrateKind
                            : t.conflictInPlaceKind,
                        ),
                      ),
                    ),
                    ...conflictWorkspaces.slice(0, 5).map((item) =>
                      h(
                        'div',
                        { style: { marginTop: 2 } },
                        t.conflictWorkspaceLine(item.title),
                      ),
                    ),
                  ]
                  return h(
                    'div',
                    { style: { color: THEME.error, marginTop: 4 } },
                    h('div', null, t.conflictSummary(conflictSessions.length, conflictWorkspaces.length)),
                    ...lines,
                    total > lines.length
                      ? h('div', { style: { marginTop: 2 } }, t.conflictMore(total - lines.length))
                      : null,
                  )
                })(),
                h(
                  'div',
                  { style: { color: THEME.textMuted, marginTop: 2 } },
                  `${t.conflictModeLabel}: ${
                    importConflictMode === 'overwrite'
                      ? t.conflictOverwriteShort
                      : t.conflictSkipShort
                  }`,
                ),
              )
            : null,
          packOptions.length > 0
            ? h(
                'div',
                {
                  style: {
                    border: `1px solid ${THEME.border}`,
                    borderRadius: 8,
                    padding: '6px 8px',
                    marginBottom: 8,
                    maxHeight: 120,
                    overflowY: 'auto',
                  },
                },
                h(
                  'div',
                  { style: { fontSize: 11, color: THEME.textMuted, marginBottom: 4 } },
                  t.packageOptions,
                ),
                packOptions.map((pack) =>
                  h(
                    'button',
                    {
                      key: pack.path,
                      type: 'button',
                      onClick: () => {
                        setImportPackPath(pack.path)
                        setPackOptions([])
                      },
                      style: {
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        border: 'none',
                        background: 'transparent',
                        color: THEME.text,
                        fontSize: 12,
                        padding: '3px 4px',
                        cursor: 'pointer',
                      },
                    },
                    pack.name,
                  ),
                ),
              )
            : null,
          h(
            'div',
            { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
            h('input', {
              type: 'text',
              value: importTarget,
              placeholder: t.targetPlaceholder,
              onChange: (event) => setImportTarget(event.target.value),
              disabled: busy,
              style: fieldStyle(),
            }),
            canPickDirectory
              ? h(
                  'button',
                  {
                    type: 'button',
                    onClick: pickImportDirectory,
                    disabled: busy,
                    style: buttonStyle(busy),
                  },
                  t.pickDirectory,
                )
              : null,
            h(
              'button',
              { type: 'button', onClick: startImport, disabled: busy, style: primaryButtonStyle(busy) },
              busy ? h('span', null, h(Spinner), t.importing) : t.startImport,
            ),
          ),
          needsRestartHint
            ? h(
                'div',
                { style: { marginTop: 8, fontSize: 11, color: THEME.textMuted } },
                t.restartHint,
              )
            : null,
        )
      }

      function treeBox() {
        if (visibleGroups.length === 0) {
          return h(
            'div',
            {
              style: {
                border: `1px solid ${THEME.border}`,
                borderRadius: 10,
                padding: 16,
                fontSize: 13,
                color: THEME.textMuted,
              },
            },
            t.noSessions,
          )
        }
        return h(
          'div',
          {
            style: {
              border: `1px solid ${THEME.border}`,
              borderRadius: 10,
              maxHeight: 'min(300px, 36vh)',
              overflowY: 'auto',
            },
          },
          visibleGroups.map((group) => renderGroup(group)),
          h(
            'div',
            { style: { padding: '6px 12px', fontSize: 11, color: THEME.textMuted } },
            statsText,
          ),
          h(
            'label',
            {
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '0 12px 6px',
                fontSize: 11,
                color: THEME.textMuted,
                cursor: 'pointer',
              },
            },
            h('input', {
              type: 'checkbox',
              checked: showArchived,
              onChange: (event) => {
                setShowArchived(event.target.checked)
                setReloadTick((tick) => tick + 1)
              },
            }),
            h('span', null, t.showArchived),
          ),
          showArchived
            ? h(
                'div',
                { style: { padding: '0 12px 8px', fontSize: 10, color: THEME.textMuted } },
                t.archivedNotice,
              )
            : null,
          h(
            'div',
            { style: { padding: '0 12px 8px', fontSize: 10, color: THEME.textMuted, opacity: 0.7 } },
            `${t.diagnostics(rawItems.length, allSessions.length)} · locale=${localeId} · ${BUILD_TAG}`,
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
            key: group.cwd ?? group.title,
            style: { borderBottom: `1px solid ${THEME.border}` },
          },
          h(
            'label',
            {
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '7px 12px',
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
              { style: { fontWeight: 400, opacity: 0.55, fontSize: 11 } },
              t.sessionsUnit(group.sessions.length),
            ),
          ),
          h(
            'div',
            { style: { padding: '0 12px 6px 34px' } },
            group.sessions.map((session) =>
              h(
                'label',
                {
                  key: session.sessionId,
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '2px 0',
                    cursor: 'pointer',
                    fontSize: 12,
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

    function normalizePath(value) {
      return String(value ?? '')
        .replace(/\\/g, '/')
        .toLowerCase()
        .replace(/\/+$/, '')
    }

    /**
     * 用会话列表（cwd）归组，与左侧侧边栏一致；未匹配的会话作为「未分组」。
     * `session.list` 不可用（空数组）时回退到 workspace.sessionIds，保证树不整棵消失。
     * @param {Array<object>} items workspace.follow 的 WorkspaceView
     * @param {Array<object>} listItems session.list 的 SessionSummary
     */
    function groupFromWorkspaces(items, listItems, titles, localeId, texts, archivedIds, showArchived) {
      const groups = []
      const useList = Array.isArray(listItems) && listItems.length > 0
      const toSession = (item) => ({
        sessionId: item.sessionId,
        title: titles.get(item.sessionId) ?? texts.sessionFallback(shortSessionId(item.sessionId)),
        updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : 0,
      })
      if (useList) {
        const assigned = new Set()
        const sessionsByCwd = new Map()
        for (const item of listItems) {
          if (!item || typeof item.sessionId !== 'string') continue
          const key = normalizePath(item.cwd)
          if (key.length === 0) continue
          if (!sessionsByCwd.has(key)) sessionsByCwd.set(key, [])
          sessionsByCwd.get(key).push(item)
        }
        for (const workspace of items) {
          const own = sessionsByCwd.get(normalizePath(workspace.path)) ?? []
          const sessions = own
            .filter((item) => showArchived || !archivedIds.has(item.sessionId))
            .map((item) => {
              assigned.add(item.sessionId)
              return toSession(item)
            })
          groups.push({
            cwd: workspace.path,
            title: displayWorkspaceTitle(workspace.title, localeId),
            sessions,
          })
        }
        const ungrouped = listItems
          .filter(
            (item) => item && typeof item.sessionId === 'string' && !assigned.has(item.sessionId),
          )
          .filter((item) => showArchived || !archivedIds.has(item.sessionId))
          .map(toSession)
        if (ungrouped.length > 0) {
          groups.push({ cwd: undefined, title: texts.ungrouped, sessions: ungrouped })
        }
        return groups
      }
      for (const workspace of items) {
        const sessions = (workspace.sessionIds ?? [])
          .filter((sessionId) => showArchived || !archivedIds.has(sessionId))
          .map((sessionId) => ({
            sessionId,
            title: titles.get(sessionId) ?? texts.sessionFallback(shortSessionId(sessionId)),
            updatedAt: 0,
          }))
        groups.push({
          cwd: workspace.path,
          title: displayWorkspaceTitle(workspace.title, localeId),
          sessions,
        })
      }
      return groups
    }

    function Spinner() {
      return h(
        'span',
        {
          style: {
            display: 'inline-block',
            marginRight: 8,
            animation: 'dsh-pack-and-go-spin 1s linear infinite',
          },
          'aria-hidden': true,
        },
        '◐',
      )
    }

    function fieldStyle() {
      return {
        flex: '1 1 220px',
        minWidth: 160,
        padding: '7px 10px',
        borderRadius: 8,
        border: `1px solid ${THEME.border}`,
        background: 'var(--dsw-alias-bg-layer-1)',
        color: THEME.text,
        fontSize: 13,
      }
    }

    function primaryButtonStyle(disabled) {
      return {
        padding: '7px 14px',
        borderRadius: 8,
        border: `1px solid var(--dsw-alias-brand-primary)`,
        background: disabled
          ? `color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent)`
          : `color-mix(in srgb, var(--dsw-alias-brand-primary) 24%, transparent)`,
        color: THEME.text,
        fontSize: 13,
        fontWeight: 600,
        cursor: disabled ? 'default' : 'pointer',
        whiteSpace: 'nowrap',
      }
    }

    function buttonStyle(disabled) {
      return {
        padding: '7px 14px',
        borderRadius: 8,
        border: `1px solid ${THEME.border}`,
        background: disabled
          ? `color-mix(in srgb, ${THEME.text} 6%, transparent)`
          : `color-mix(in srgb, ${THEME.text} 12%, transparent)`,
        color: THEME.text,
        fontSize: 13,
        fontWeight: 600,
        cursor: disabled ? 'default' : 'pointer',
        whiteSpace: 'nowrap',
      }
    }

    return {
      inject: [
        'slots',
        'locale',
        'remote',
        'remote.session',
        'remote.workspace',
        'remote.commands',
        'uiWorkspace',
      ],
      apply(ctx) {
        ownerCtx = ctx
        ctx.slots.inject('sidebar.footer.action', () =>
          ctx.slots.register(
            {
              name: 'sidebar.footer.action',
              id: 'mover',
              order: 60,
              label: () => TEXTS[currentLocaleId()].title,
            },
            MoverLauncher,
          ),
        )
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register({ name: 'shell.overlay', id: 'mover-overlay', order: 60 }, MoverOverlay),
        )
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'mover',
              order: 60,
              label: () => TEXTS[currentLocaleId()].launcher,
            },
            MoverSettingsSection,
          ),
        )
      },
      // 仅用于 e2e 渲染测试：暴露纯函数，不影响生产行为
      _test: { groupFromWorkspaces, titleOf, normalizePath },
    }
  },
})
