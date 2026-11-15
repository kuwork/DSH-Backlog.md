/**
 * Client half of the Backlog.md Browser bundle.
 *
 * Contributes three things to the Web UI:
 *   1. a third Conversation view tab ("Backlog") that embeds the running
 *      `backlog browser` page in an iframe, or offers a centered start button;
 *   2. a Session header entry that starts/stops the server and opens the
 *      initialization dialog;
 *   3. the initialization dialog itself (a `shell.overlay` entry), which
 *      collects the `backlog init` parameters instead of applying defaults.
 *
 * Transport: same-origin `fetch('/backlog/<endpoint>', …)` against the Host's
 * own prefix route in index.js. The shared `/api` channel belongs to the
 * Gateway, and Connection's `rpc.handle()` cannot mount a third-party row, so
 * the two halves talk over a plain JSON route instead of an RPC envelope.
 */
window.__ModuleLoader__.load({
  id: 'dsh-backlog.md',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    const NS = 'backlog'
    const CHANNEL = '/backlog'
    /** Sidebar panel id and the `main` slot key that renders its page. */
    const PANEL_ID = 'backlog'
    const ACCENT = '#4D6BFE'

    const zh = {
      'view.backlog': 'Backlog.md',
      'view.title': 'Backlog.md 看板',
      'view.intro': '在 Harness 里直接查看当前工作区的任务看板。',
      'view.start': '启动 Backlog.md Browser',
      'view.starting': '正在启动…',
      'view.retry': '重试',
      'view.stop': '关闭服务',
      'view.openTab': '在新窗口打开',
      'view.shifted': '端口被占用，已改用',
      'view.notInitialized': '当前工作区还没有 Backlog.md 配置',
      'view.notInitializedHint': '先初始化，会在工作区创建 backlog/ 目录与配置文件。',
      'view.initialize': '初始化 Backlog.md',
      'view.noWorkspace': '这个会话没有关联工作区目录',
      'view.loading': '正在读取状态…',
      'header.title': 'Backlog.md',
      'header.running': '服务运行中',
      'header.stopped': '服务未启动',
      'header.start': '启动 Backlog.md Browser',
      'header.stop': '关闭 Backlog.md Browser',
      'header.init': '初始化 Backlog.md',
      'header.refresh': '刷新状态',
      'header.statusError': '无法读取状态：',
      'panel.label': 'Backlog.md',
      'panel.title': 'Backlog.md 看板',
      'panel.refresh': '刷新全部',
      'panel.empty': '还没有工作区。先在侧边栏添加一个工作区目录。',
      'panel.hint': '选一个运行中的工作区，看板会显示在这里。',
      'panel.pick': '选择工作区',
      'panel.statusFailed': '读取失败：',
      'panel.noConfig': '未初始化',
      'init.title': '初始化 Backlog.md',
      'init.intro': '参数会原样交给 backlog init，非交互执行。',
      'init.projectName': '项目名称',
      'init.backlogDir': 'backlog 目录',
      'init.backlogDirHint': 'backlog、.backlog，或相对工作区的自定义路径',
      'init.configLocation': '配置位置',
      'init.configFolder': '目录内（backlog/config.yml）',
      'init.configRoot': '工作区根（backlog.config.yml）',
      'init.taskPrefix': '任务 ID 前缀',
      'init.integration': 'AI 集成方式',
      'init.integrationCli': 'CLI 指令',
      'init.integrationMcp': 'MCP 连接器',
      'init.integrationNone': '跳过',
      'init.agentInstructions': '写入的指令文件',
      'init.agents': 'AGENTS.md',
      'init.claude': 'CLAUDE.md',
      'init.gemini': 'GEMINI.md',
      'init.copilot': 'copilot 指令',
      'init.cursor': 'cursor 规则',
      'init.git': '启用 Git 集成',
      'init.gitHint': '关闭时等同于 --no-git，不读取分支、不自动提交',
      'init.submit': '开始初始化',
      'init.busy': '初始化中…',
      'init.cancel': '取消',
      'init.done': '初始化完成',
    }

    const en = {
      'view.backlog': 'Backlog.md',
      'view.title': 'Backlog.md board',
      'view.intro': 'Read this workspace\u2019s task board without leaving Harness.',
      'view.start': 'Start Backlog.md Browser',
      'view.starting': 'Starting\u2026',
      'view.retry': 'Retry',
      'view.stop': 'Stop server',
      'view.openTab': 'Open in a new window',
      'view.shifted': 'port taken, using',
      'view.notInitialized': 'This workspace has no Backlog.md configuration yet',
      'view.notInitializedHint': 'Initialize it to create the backlog/ folder and its config.',
      'view.initialize': 'Initialize Backlog.md',
      'view.noWorkspace': 'This session has no workspace directory',
      'view.loading': 'Reading status\u2026',
      'header.title': 'Backlog.md',
      'header.running': 'Server running',
      'header.stopped': 'Server stopped',
      'header.start': 'Start Backlog.md Browser',
      'header.stop': 'Close Backlog.md Browser',
      'header.init': 'Initialize Backlog.md',
      'header.refresh': 'Refresh status',
      'header.statusError': 'Cannot read status: ',
      'panel.label': 'Backlog.md',
      'panel.title': 'Backlog.md board',
      'panel.refresh': 'Refresh all',
      'panel.empty': 'No workspace yet. Add a workspace directory in the sidebar first.',
      'panel.hint': 'Pick a running workspace to show its board here.',
      'panel.pick': 'Choose a workspace',
      'panel.statusFailed': 'Read failed: ',
      'panel.noConfig': 'Not initialized',
      'init.title': 'Initialize Backlog.md',
      'init.intro': 'These values are passed straight to backlog init, non-interactively.',
      'init.projectName': 'Project name',
      'init.backlogDir': 'Backlog directory',
      'init.backlogDirHint': 'backlog, .backlog, or a workspace-relative path',
      'init.configLocation': 'Config location',
      'init.configFolder': 'Inside the folder (backlog/config.yml)',
      'init.configRoot': 'Workspace root (backlog.config.yml)',
      'init.taskPrefix': 'Task ID prefix',
      'init.integration': 'AI integration',
      'init.integrationCli': 'CLI instructions',
      'init.integrationMcp': 'MCP connector',
      'init.integrationNone': 'Skip',
      'init.agentInstructions': 'Instruction files',
      'init.agents': 'AGENTS.md',
      'init.claude': 'CLAUDE.md',
      'init.gemini': 'GEMINI.md',
      'init.copilot': 'copilot instructions',
      'init.cursor': 'cursor rules',
      'init.git': 'Enable Git integration',
      'init.gitHint': 'Off is --no-git: no branch reads, no automatic commits',
      'init.submit': 'Initialize',
      'init.busy': 'Initializing\u2026',
      'init.cancel': 'Cancel',
      'init.done': 'Initialization finished',
    }

    /** Module-scoped store: the header entry and the dialog share it without a service. */
    const store = {
      dialog: null,
      revision: 0,
      listeners: new Set(),
      emit() {
        store.revision += 1
        for (const listener of [...store.listeners]) listener()
      },
      subscribe(listener) {
        store.listeners.add(listener)
        return () => { store.listeners.delete(listener) }
      },
      openDialog(cwd, projectName) {
        store.dialog = { cwd, projectName }
        store.emit()
      },
      closeDialog() {
        store.dialog = null
        store.emit()
      },
    }

    /** Subscribe a component to the shared store. */
    function useStore() {
      const [, force] = useState(0)
      useEffect(() => store.subscribe(() => force(value => value + 1)), [])
      return store
    }

    /** Human readable failure for any thrown shape. */
    const messageOf = error => (error instanceof Error ? error.message : String(error))

    /**
     * Build the transport helper.
     *
     * Plain same-origin `fetch` against the Host's own `/backlog` route, not
     * `connection.rpc.call`: the shared RPC channel is the Gateway's and the
     * Host mounts this route itself, so the two halves agree on one URL and one
     * JSON body instead of an RPC envelope.
     * @returns call(endpoint, payload) resolved to the Host value.
     */
    function makeCaller() {
      return async (endpoint, payload) => {
        const response = await fetch(`${CHANNEL}/${endpoint}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload ?? {}),
        })
        if (!response.ok) throw new Error(`backlog: HTTP ${String(response.status)}`)
        const result = await response.json()
        if (result !== null && typeof result === 'object' && result.ok === true) return result.value
        const failure = result !== null && typeof result === 'object' ? result.error : undefined
        const error = new Error(failure?.message ?? 'backlog: request failed')
        error.code = failure?.code
        throw error
      }
    }

    /**
     * Chrome that has to follow the active theme. DSH publishes these `--dsw-alias-*`
     * tokens for both themes, so a surface built from them repaints when the theme
     * switches; the fallbacks only cover a build that lacks the token.
     */
    const THEME_CSS = `
.bk-menu {
  background: var(--dsw-alias-bg-layer-3, var(--dsw-alias-bg-layer-2, Canvas));
  color: var(--dsw-alias-label-primary, CanvasText);
  border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.28));
  box-shadow: var(--dsw-elevation-prominent, 0 12px 32px rgba(0,0,0,0.18));
}
.bk-item { background: transparent; color: var(--dsw-alias-label-primary, CanvasText); }
.bk-item:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.14)); }
.bk-item:disabled { opacity: 0.45; cursor: default; }
.bk-status { color: var(--dsw-alias-label-secondary, CanvasText); }
.bk-hint { color: var(--dsw-alias-label-secondary, CanvasText); }
.bk-label { color: var(--dsw-alias-label-primary, CanvasText); }
.bk-ghost {
  border: 1px solid var(--dsw-alias-border-l3, rgba(128,128,128,0.35));
  background: transparent;
  color: var(--dsw-alias-label-primary, CanvasText);
}
.bk-ghost:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.12)); }
.bk-ghost:disabled { opacity: 0.5; cursor: default; }
.bk-input {
  border: 1px solid var(--dsw-alias-border-l3, rgba(128,128,128,0.4));
  background: var(--dsw-alias-bg-layer-1, transparent);
  color: var(--dsw-alias-label-primary, CanvasText);
}
.bk-input option { background: var(--dsw-alias-bg-layer-2, Canvas); color: var(--dsw-alias-label-primary, CanvasText); }
.bk-dialog { background: var(--dsw-alias-bg-layer-2, Canvas); color: var(--dsw-alias-label-primary, CanvasText); }
.bk-error { color: var(--dsw-alias-state-error-primary, #d14343); }
.bk-log {
  background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.12));
  color: var(--dsw-alias-label-secondary, CanvasText);
}

/* Sidebar panel: one row per Workspace, plus the board of the selected one. */
.bk-page {
  height: 100%;
  min-height: 0;
  overflow: auto;
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-sizing: border-box;
}
.bk-page-head { display: flex; align-items: center; gap: 10px; flex: 0 0 auto; }
.bk-page-title { font-size: 16px; font-weight: 600; margin: 0; }
.bk-page-actions { margin-left: auto; display: flex; gap: 8px; }
.bk-page-hint { font-size: 12px; }
/* One row regardless of how many Workspaces exist: picker, state, actions. */
.bk-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.24));
  flex: 0 0 auto;
}
/* Workspace picker: a button plus its own listbox, one status dot per row. */
.bk-picker { position: relative; flex: 0 0 auto; }
.bk-picker-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 180px;
  max-width: 300px;
  justify-content: space-between;
  cursor: pointer;
}
.bk-picker-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bk-caret { opacity: 0.65; font-size: 10px; line-height: 1; }
.bk-picker-list {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 40;
  min-width: 300px;
  max-width: 420px;
  max-height: 320px;
  overflow-y: auto;
  padding: 6px;
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: var(--dsw-alias-bg-layer-3, Canvas);
  color: var(--dsw-alias-label-primary, CanvasText);
  border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.28));
  box-shadow: var(--dsw-elevation-prominent, 0 12px 32px rgba(0,0,0,0.18));
}
.bk-option {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  padding: 7px 9px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-primary, CanvasText);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.bk-option:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.14)); }
.bk-option[aria-selected='true'] { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.1)); }
.bk-option-main { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.bk-option-title { font-size: 12px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bk-option-sub {
  font-size: 11px;
  color: var(--dsw-alias-label-secondary, CanvasText);
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.bk-bar .bk-dot { margin-top: 0; }
.bk-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  margin-top: 6px;
  flex: 0 0 auto;
  background: rgba(128,128,128,0.55);
}
.bk-dot-on { background: #2ea043; }
.bk-row-main { min-width: 0; flex: 1 1 auto; display: flex; flex-direction: column; gap: 2px; }
.bk-row-path, .bk-row-state {
  font-size: 11px;
  color: var(--dsw-alias-label-secondary, CanvasText);
  overflow-wrap: anywhere;
}
.bk-row-actions { display: flex; gap: 6px; flex: 0 0 auto; align-items: center; }
.bk-btn { display: inline-flex; align-items: center; text-decoration: none; line-height: 18px; }
.bk-frame {
  width: 100%;
  flex: 1 1 auto;
  min-height: 420px;
  border: 0;
  border-radius: 10px;
  background: #fff;
}
`

    const styles = {
      root: {
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        overflow: 'hidden',
      },
      frame: { flex: '1 1 auto', width: '100%', minHeight: 0, border: 0, background: '#fff' },
      center: {
        flex: '1 1 auto',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        padding: '32px',
        textAlign: 'center',
      },
      title: { fontSize: '16px', fontWeight: 600, margin: 0 },
      hint: { fontSize: '13px', opacity: 0.7, margin: 0, maxWidth: '420px', lineHeight: 1.6 },
      primary: {
        appearance: 'none',
        border: 0,
        borderRadius: '8px',
        padding: '10px 18px',
        fontSize: '13px',
        fontWeight: 600,
        color: '#fff',
        background: ACCENT,
        cursor: 'pointer',
      },
      ghost: {
        appearance: 'none',
        borderRadius: '8px',
        padding: '6px 12px',
        fontSize: '12px',
        cursor: 'pointer',
      },
      error: { fontSize: '12px', maxWidth: '520px', whiteSpace: 'pre-wrap' },
      menuWrap: { position: 'relative', display: 'inline-flex' },
      menu: {
        position: 'absolute',
        top: '125%',
        right: 0,
        zIndex: 40,
        minWidth: '232px',
        padding: '6px',
        borderRadius: '10px',
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
      },
      item: {
        appearance: 'none',
        border: 0,
        borderRadius: '6px',
        padding: '7px 10px',
        fontSize: '12px',
        textAlign: 'left',
        cursor: 'pointer',
      },
      status: { fontSize: '11px', padding: '4px 10px' },
      overlay: {
        position: 'fixed',
        inset: 0,
        zIndex: 90,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.42)',
      },
      dialog: {
        width: 'min(560px, calc(100vw - 32px))',
        maxHeight: 'calc(100vh - 64px)',
        overflowY: 'auto',
        padding: '20px',
        borderRadius: '14px',
        boxShadow: '0 24px 64px rgba(0,0,0,0.32)',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      },
      field: { display: 'flex', flexDirection: 'column', gap: '5px' },
      label: { fontSize: '12px', fontWeight: 600, opacity: 0.85 },
      input: {
        padding: '8px 10px',
        borderRadius: '8px',
        fontSize: '13px',
      },
      row: { display: 'flex', gap: '10px' },
      actions: { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' },
      log: {
        maxHeight: '160px',
        overflow: 'auto',
        fontSize: '11px',
        lineHeight: 1.5,
        padding: '8px 10px',
        borderRadius: '8px',
        whiteSpace: 'pre-wrap',
      },
    }

    /**
     * Third Conversation view tab: embedded board, or a centered start button.
     * @param props - session id, owner share, locale `t`, and `useSessions`.
     */
    function BacklogView(props) {
      const { sessionId, useSessions } = props
      const t = useMemo(() => {
        const translate = props.t
        return key => (typeof translate === 'function' ? translate(key) : key)
      }, [props.t])
      const cwd = useSessions(state => {
        const session = state?.byId?.[sessionId]
        return session?.cwd ?? undefined
      })
      const call = props.call
      const [state, setState] = useState({ phase: 'loading' })

      const refresh = useCallback(async () => {
        if (typeof cwd !== 'string' || cwd.length === 0) {
          setState({ phase: 'no-workspace' })
          return
        }
        try {
          const info = await call('status', { cwd })
          setState({ phase: info.running ? 'running' : info.initialized ? 'idle' : 'uninitialized', info })
        } catch (error) {
          setState({ phase: 'error', message: messageOf(error) })
        }
      }, [call, cwd])

      const start = useCallback(async () => {
        if (typeof cwd !== 'string' || cwd.length === 0) return
        setState(current => ({ ...current, phase: 'starting' }))
        try {
          const info = await call('start', { cwd })
          setState({ phase: 'running', info })
        } catch (error) {
          setState({ phase: 'error', message: messageOf(error) })
        }
      }, [call, cwd])

      const shared = useStore()
      useEffect(() => { void refresh() }, [refresh, shared.revision])

      const info = state.info

      if (state.phase === 'loading') {
        return h('div', { 'data-conversation-composer-overlay': '', style: styles.root },
          h('div', { style: styles.center }, h('p', { className: 'bk-hint', style: styles.hint }, t('view.loading'))))
      }

      if (state.phase === 'no-workspace') {
        return h('div', { 'data-conversation-composer-overlay': '', style: styles.root },
          h('div', { style: styles.center }, h('p', { className: 'bk-hint', style: styles.hint }, t('view.noWorkspace'))))
      }

      if (state.phase === 'running' && info?.url) {
        // No bar above the board: its status, port and the two actions live in
        // the session header's Backlog menu, so the board gets the whole height.
        return h('div', { 'data-conversation-composer-overlay': '', style: styles.root },
          h('iframe', {
            key: info.url,
            src: info.url,
            title: t('view.title'),
            style: styles.frame,
            referrerPolicy: 'no-referrer',
          }))
      }

      const uninitialized = state.phase === 'uninitialized'
      return h('div', { 'data-conversation-composer-overlay': '', style: styles.root },
        h('div', { style: styles.center },
          h('h2', { className: 'bk-label', style: styles.title }, t('view.title')),
          h('p', { className: 'bk-hint', style: styles.hint }, uninitialized ? t('view.notInitialized') : t('view.intro')),
          uninitialized
            ? h('button', {
              type: 'button',
              style: styles.primary,
              onClick: () => store.openDialog(cwd, basename(cwd)),
            }, t('view.initialize'))
            : h('button', {
              type: 'button',
              style: styles.primary,
              disabled: state.phase === 'starting',
              onClick: () => { void start() },
            }, state.phase === 'starting' ? t('view.starting') : t('view.start')),
          state.phase === 'error'
            ? h('div', { className: 'bk-error', style: styles.error },
              h('div', null, state.message),
              h('button', { type: 'button', className: 'bk-ghost', style: { ...styles.ghost, marginTop: '8px' }, onClick: () => { void refresh() } }, t('view.retry')))
            : null))
    }

    /**
     * Session header entry: status, start/stop, initialize.
     * @param props - session id plus locale `t`.
     */
    function BacklogHeaderActions(props) {
      const props_safe = props ?? {}
      const translate = props_safe.t
      const t = useCallback(key => (typeof translate === 'function' ? translate(key) : key), [translate])
      const call = props_safe.call
      const sessionId = props_safe.sessionId
      const useSessions = props_safe.useSessions
      const cwd = useSessions(state => {
        const session = state?.byId?.[sessionId]
        return session?.cwd ?? undefined
      })
      const [open, setOpen] = useState(false)
      const [info, setInfo] = useState(null)
      const [busy, setBusy] = useState(false)
      // A failed status read is not "no project": the two look identical once
      // `info` is null, so the transport error is kept and shown instead.
      const [statusError, setStatusError] = useState(null)
      const wrap = useRef(null)

      const refresh = useCallback(async () => {
        if (typeof cwd !== 'string' || cwd.length === 0) return
        try {
          setInfo(await call('status', { cwd }))
          setStatusError(null)
        } catch (error) {
          setInfo(null)
          setStatusError(messageOf(error))
        }
      }, [call, cwd])

      const shared = useStore()
      useEffect(() => { void refresh() }, [refresh, shared.revision])

      useEffect(() => {
        if (!open) return undefined
        const onDown = event => {
          if (wrap.current !== null && !wrap.current.contains(event.target)) setOpen(false)
        }
        document.addEventListener('mousedown', onDown)
        return () => document.removeEventListener('mousedown', onDown)
      }, [open])

      const act = useCallback(async (endpoint) => {
        if (typeof cwd !== 'string' || cwd.length === 0) return
        setBusy(true)
        try {
          const next = await call(endpoint, { cwd })
          setInfo(next)
          store.emit()
        } catch (error) {
          setInfo(current => ({ ...(current ?? {}), lastError: messageOf(error) }))
        } finally {
          setBusy(false)
        }
      }, [call, cwd])

      if (typeof cwd !== 'string' || cwd.length === 0) return null

      return h('div', { style: styles.menuWrap, ref: wrap },
        h('button', {
          type: 'button',
          title: t('header.title'),
          className: 'bk-ghost',
          style: { ...styles.ghost, display: 'inline-flex', alignItems: 'center', gap: '6px' },
          onClick: () => setOpen(value => !value),
        }, h('span', {
          style: {
            width: '7px', height: '7px', borderRadius: '50%',
            background: info?.running ? '#2ea043' : 'rgba(128,128,128,0.6)',
          },
        }), 'Backlog.md'),
        open
          ? h('div', { className: 'bk-menu', style: styles.menu },
            h('div', {
              className: statusError !== null ? 'bk-status bk-error' : 'bk-status',
              style: styles.status,
            },
            statusError !== null
              ? `${t('header.statusError')}${statusError}`
              : info?.running
                ? `${t('header.running')} · 127.0.0.1:${String(info.port)}`
                  + `${info.shiftedPort ? `（${t('view.shifted')} ${String(info.requestedPort)} → ${String(info.port)}）` : ''}`
                : info?.initialized ? t('header.stopped') : t('view.notInitialized')),
            info?.running
              ? h('button', {
                type: 'button', className: 'bk-item', style: styles.item, disabled: busy,
                onClick: () => { void act('stop') },
              }, t('header.stop'))
              : h('button', {
                type: 'button', className: 'bk-item', style: styles.item, disabled: busy || !info?.initialized,
                onClick: () => { void act('start') },
              }, t('header.start')),
            // The board's own bar is gone, so opening it in a window lives here.
            info?.running && info?.url
              ? h('a', {
                href: info.url,
                target: '_blank',
                rel: 'noreferrer',
                className: 'bk-item',
                style: { ...styles.item, display: 'block', textDecoration: 'none' },
                onClick: () => setOpen(false),
              }, t('view.openTab'))
              : null,
            h('button', {
              type: 'button',
              className: 'bk-item',
              style: styles.item,
              disabled: busy || info?.initialized === true,
              onClick: () => { setOpen(false); store.openDialog(cwd, basename(cwd)) },
            }, t('header.init')),
            h('button', {
              type: 'button', className: 'bk-item', style: styles.item, disabled: busy,
              onClick: () => { void refresh() },
            }, t('header.refresh')),
            info?.lastError ? h('div', { className: 'bk-error', style: { ...styles.error, padding: '4px 10px' } }, info.lastError) : null)
          : null)
    }

    /**
     * Sidebar panel: every Workspace with its board state, startable without a
     * Session. The hero/composer states carry no session-scoped slot, so this
     * page is the entry point the empty state otherwise lacks.
     * @param props - the board caller, the Workspaces service and locale `t`.
     */
    function BacklogPanel(props) {
      const translate = props?.t
      const t = useCallback(key => (typeof translate === 'function' ? translate(key) : key), [translate])
      const call = props?.call
      // Resolved lazily: hard-injecting `workspaces` would keep the whole plugin
      // (tab and header too) from applying in a composition without it.
      const workspaces = typeof props?.getWorkspaces === 'function' ? props.getWorkspaces() : undefined

      const [revision, setRevision] = useState(0)
      const [states, setStates] = useState({})
      const [busyId, setBusyId] = useState(null)
      const [selectedId, setSelectedId] = useState(null)
      const [error, setError] = useState(null)
      const [pickerOpen, setPickerOpen] = useState(false)
      const pickerRef = useRef(null)

      useEffect(() => {
        if (typeof workspaces?.list?.subscribe !== 'function') return undefined
        return workspaces.list.subscribe(() => setRevision(value => value + 1))
      }, [workspaces])

      const items = useMemo(() => {
        const snapshot = typeof workspaces?.list?.getSnapshot === 'function'
          ? workspaces.list.getSnapshot()
          : undefined
        return snapshot?.items ?? []
      }, [workspaces, revision])

      // Only the chosen Workspace is queried, not every one in the list: the
      // sidebar may hold dozens, and the panel must stay one row tall.
      const refresh = useCallback(async (item) => {
        if (typeof call !== 'function' || item === undefined) return
        try {
          const info = await call('status', { cwd: item.path })
          setStates(current => ({ ...current, [item.workspaceId]: info }))
        } catch (failure) {
          setStates(current => ({ ...current, [item.workspaceId]: { failed: messageOf(failure) } }))
        }
      }, [call])

      const currentId = selectedId ?? items[0]?.workspaceId
      const current = items.find(item => item.workspaceId === currentId)

      useEffect(() => { void refresh(current) }, [refresh, currentId, revision])

      // Opening the list asks every Workspace for its state, because each row
      // shows its own address; the closed panel still queries only the chosen one.
      useEffect(() => {
        if (!pickerOpen) return
        for (const item of items) void refresh(item)
      }, [pickerOpen, revision, refresh])

      useEffect(() => {
        if (!pickerOpen) return undefined
        const onDown = event => {
          if (pickerRef.current !== null && !pickerRef.current.contains(event.target)) setPickerOpen(false)
        }
        const onKey = event => {
          if (event.key === 'Escape') setPickerOpen(false)
        }
        document.addEventListener('mousedown', onDown)
        document.addEventListener('keydown', onKey)
        return () => {
          document.removeEventListener('mousedown', onDown)
          document.removeEventListener('keydown', onKey)
        }
      }, [pickerOpen])

      const act = useCallback(async (endpoint, item) => {
        if (typeof call !== 'function') return
        setBusyId(item.workspaceId)
        setError(null)
        try {
          const info = await call(endpoint, { cwd: item.path })
          setStates(states_ => ({ ...states_, [item.workspaceId]: info }))
          if (endpoint === 'start' && typeof info?.url === 'string') setSelectedId(item.workspaceId)
        } catch (failure) {
          setError(`${item.title}：${messageOf(failure)}`)
        } finally {
          setBusyId(null)
        }
      }, [call])

      const info = currentId === undefined ? undefined : states[currentId]
      const busy = busyId === currentId
      const state = info?.failed !== undefined
        ? `${t('panel.statusFailed')}${info.failed}`
        : info?.running
          ? `${t('header.running')} · 127.0.0.1:${String(info.port)}`
            + `${info.shiftedPort ? `（${t('view.shifted')} ${String(info.requestedPort)} → ${String(info.port)}）` : ''}`
          : info === undefined
            ? t('view.loading')
            : info.initialized ? t('header.stopped') : t('panel.noConfig')

      // One compact row: a Workspace picker, the chosen one's path and state,
      // and its actions. The board below keeps the rest of the height.
      const optionSub = item => {
        const itemInfo = states[item.workspaceId]
        if (itemInfo?.failed !== undefined) return `${t('panel.statusFailed')}${itemInfo.failed}`
        if (itemInfo?.running === true) {
          return `127.0.0.1:${String(itemInfo.port)}`
            + `${itemInfo.shiftedPort ? `（${t('view.shifted')} ${String(itemInfo.requestedPort)} → ${String(itemInfo.port)}）` : ''}`
        }
        if (itemInfo === undefined) return t('view.loading')
        return itemInfo.initialized ? t('header.stopped') : t('panel.noConfig')
      }

      const bar = current === undefined
        ? h('div', { className: 'bk-page-hint bk-hint' }, t('panel.empty'))
        : h('div', { className: 'bk-bar' },
          // A native <select> cannot draw two lines or a state dot per row, so the
          // picker is a button plus its own listbox.
          h('div', { className: 'bk-picker', ref: pickerRef },
            h('button', {
              type: 'button',
              className: 'bk-input bk-picker-btn',
              'aria-haspopup': 'listbox',
              'aria-expanded': pickerOpen,
              'aria-label': t('panel.pick'),
              onClick: () => setPickerOpen(value => !value),
            },
            h('span', { className: 'bk-picker-label' }, current.title),
            h('span', { className: 'bk-caret', 'aria-hidden': true }, '\u25be')),
            pickerOpen
              ? h('div', { className: 'bk-picker-list', role: 'listbox' },
                items.map(item => h('button', {
                  key: item.workspaceId,
                  type: 'button',
                  role: 'option',
                  className: 'bk-option',
                  'aria-selected': item.workspaceId === currentId,
                  onClick: () => { setSelectedId(item.workspaceId); setPickerOpen(false) },
                },
                h('span', { className: states[item.workspaceId]?.running === true ? 'bk-dot bk-dot-on' : 'bk-dot' }),
                h('span', { className: 'bk-option-main' },
                  h('span', { className: 'bk-option-title' }, item.title),
                  h('span', { className: 'bk-option-sub' }, optionSub(item))))))
              : null),
          h('span', { className: info?.running === true ? 'bk-dot bk-dot-on' : 'bk-dot' }),
          h('div', { className: 'bk-row-main' },
            h('div', { className: 'bk-row-path', title: current.path }, current.path),
            h('div', { className: 'bk-row-state' }, state)),
          h('div', { className: 'bk-row-actions' },
            info?.running === true
              ? h('button', {
                type: 'button', className: 'bk-ghost bk-btn', disabled: busy,
                onClick: () => { void act('stop', current) },
              }, t('view.stop'))
              : h('button', {
                type: 'button', className: 'bk-ghost bk-btn', disabled: busy || info?.initialized !== true,
                onClick: () => { void act('start', current) },
              }, t('view.start')),
            info?.running === true && typeof info.url === 'string'
              ? h('a', {
                className: 'bk-ghost bk-btn', href: info.url, target: '_blank', rel: 'noreferrer',
              }, t('view.openTab'))
              : null,
            info !== undefined && info.failed === undefined && info.initialized !== true
              ? h('button', {
                type: 'button', className: 'bk-ghost bk-btn',
                onClick: () => store.openDialog(current.path, current.title),
              }, t('view.initialize'))
              : null))

      const selectedUrl = typeof info?.url === 'string' ? info.url : undefined

      return h('div', { className: 'bk-page' },
        h('div', { className: 'bk-page-head' },
          h('h2', { className: 'bk-label bk-page-title' }, t('panel.title')),
          h('div', { className: 'bk-page-actions' },
            h('button', {
              type: 'button', className: 'bk-ghost bk-btn', style: styles.ghost,
              onClick: () => { void refresh(current) },
            }, t('panel.refresh')))),
        error !== null ? h('div', { className: 'bk-error' }, error) : null,
        bar,
        selectedUrl !== undefined
          ? h('iframe', {
            className: 'bk-frame',
            key: selectedUrl,
            src: selectedUrl,
            title: `${t('panel.title')} · ${current?.title ?? ''}`,
            referrerPolicy: 'no-referrer',
          })
          : h('div', { className: 'bk-page-hint bk-hint' }, t('panel.hint')))
    }

    /**
     * Sidebar glyph for the panel list; the sidebar owns the row, label, and
     * selected state.
     * @param props - requested edge length.
     */
    function BacklogPanelIcon(props) {
      const size = typeof props?.size === 'number' ? props.size : 16
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true,
      },
      h('rect', { x: 2.25, y: 3.25, width: 11.5, height: 9.5, rx: 2, stroke: 'currentColor', strokeWidth: 1.3 }),
      h('path', { d: 'M5.25 6.5h5.5M5.25 9.5h3.5', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' }))
    }

    /**
     * `backlog init` parameter form; rendered from `shell.overlay`.
     * @param props - locale `t` and the caller.
     */
    function InitDialog(props) {
      const translate = props?.t
      const t = useCallback(key => (typeof translate === 'function' ? translate(key) : key), [translate])
      const call = props?.call
      const current = useStore().dialog
      const [form, setForm] = useState(null)
      const [busy, setBusy] = useState(false)
      const [log, setLog] = useState('')
      const [error, setError] = useState('')

      useEffect(() => {
        if (current === null) {
          setForm(null)
          setBusy(false)
          setLog('')
          setError('')
          return
        }
        setForm({
          projectName: current.projectName ?? '',
          backlogDir: 'backlog',
          configLocation: 'folder',
          taskPrefix: 'task',
          integrationMode: 'cli',
          agentInstructions: ['agents'],
          git: true,
        })
      }, [current])

      if (current === null || form === null) return null

      const field = (label, control, hint) => h('div', { style: styles.field },
        h('label', { className: 'bk-label', style: styles.label }, label),
        control,
        hint ? h('span', { className: 'bk-hint', style: { fontSize: '11px', opacity: 0.6 } }, hint) : null)

      const set = patch => setForm({ ...form, ...patch })
      const toggleInstruction = value => {
        const next = form.agentInstructions.includes(value)
          ? form.agentInstructions.filter(item => item !== value)
          : [...form.agentInstructions, value]
        set({ agentInstructions: next.length > 0 ? next : ['agents'] })
      }

      const submit = async () => {
        setBusy(true)
        setError('')
        setLog('')
        try {
          const value = await call('init', { cwd: current.cwd, options: form })
          setLog(value?.log ?? '')
          store.emit()
        } catch (failure) {
          setError(messageOf(failure))
        } finally {
          setBusy(false)
        }
      }

      const instructionOptions = [
        ['agents', t('init.agents')],
        ['claude', t('init.claude')],
        ['gemini', t('init.gemini')],
        ['copilot', t('init.copilot')],
        ['cursor', t('init.cursor')],
      ]

      return h('div', { style: styles.overlay, onMouseDown: event => { if (event.target === event.currentTarget) store.closeDialog() } },
        h('div', { className: 'bk-dialog', style: styles.dialog },
          h('h2', { className: 'bk-label', style: { ...styles.title, fontSize: '15px' } }, t('init.title')),
          h('p', { className: 'bk-hint', style: styles.hint }, t('init.intro')),
          field(t('init.projectName'),
            h('input', {
              className: 'bk-input',
              style: styles.input,
              value: form.projectName,
              onChange: event => set({ projectName: event.target.value }),
            })),
          h('div', { style: styles.row },
            h('div', { style: { ...styles.field, flex: '1 1 0' } },
              h('label', { className: 'bk-label', style: styles.label }, t('init.backlogDir')),
              h('input', {
                className: 'bk-input',
                style: styles.input,
                value: form.backlogDir,
                onChange: event => set({ backlogDir: event.target.value }),
              }),
              h('span', { className: 'bk-hint', style: { fontSize: '11px', opacity: 0.6 } }, t('init.backlogDirHint'))),
            h('div', { style: { ...styles.field, flex: '1 1 0' } },
              h('label', { className: 'bk-label', style: styles.label }, t('init.taskPrefix')),
              h('input', {
                className: 'bk-input',
                style: styles.input,
                value: form.taskPrefix,
                onChange: event => set({ taskPrefix: event.target.value.replace(/[^A-Za-z]/g, '') }),
              }))),
          field(t('init.configLocation'),
            h('select', {
              className: 'bk-input',
              style: styles.input,
              value: form.configLocation,
              onChange: event => set({ configLocation: event.target.value }),
            },
            h('option', { value: 'folder' }, t('init.configFolder')),
            h('option', { value: 'root' }, t('init.configRoot')))),
          field(t('init.integration'),
            h('select', {
              className: 'bk-input',
              style: styles.input,
              value: form.integrationMode,
              onChange: event => set({ integrationMode: event.target.value }),
            },
            h('option', { value: 'cli' }, t('init.integrationCli')),
            h('option', { value: 'mcp' }, t('init.integrationMcp')),
            h('option', { value: 'none' }, t('init.integrationNone')))),
          field(t('init.agentInstructions'),
            h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } },
              instructionOptions.map(([value, label]) => h('button', {
                key: value,
                type: 'button',
                className: 'bk-ghost',
                style: {
                  ...styles.ghost,
                  borderColor: form.agentInstructions.includes(value) ? ACCENT : undefined,
                  color: form.agentInstructions.includes(value) ? ACCENT : undefined,
                },
                onClick: () => toggleInstruction(value),
              }, label)))),
          h('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' } },
            h('input', {
              type: 'checkbox',
              checked: form.git,
              onChange: event => set({ git: event.target.checked }),
            }),
            t('init.git')),
          h('span', { className: 'bk-hint', style: { fontSize: '11px', opacity: 0.6 } }, t('init.gitHint')),
          error ? h('div', { className: 'bk-error', style: styles.error }, error) : null,
          log ? h('div', { className: 'bk-log', style: styles.log }, log) : null,
          h('div', { style: styles.actions },
            h('button', { type: 'button', className: 'bk-ghost', style: styles.ghost, onClick: () => store.closeDialog() }, t('init.cancel')),
            h('button', {
              type: 'button',
              style: { ...styles.primary, opacity: busy ? 0.6 : 1 },
              disabled: busy,
              onClick: () => { void submit() },
            }, busy ? t('init.busy') : t('init.submit')))))
    }

    /** Last path segment of a workspace directory. */
    function basename(value) {
      if (typeof value !== 'string' || value.length === 0) return 'backlog'
      const parts = value.split(/[\\/]/).filter(Boolean)
      return parts.length > 0 ? parts[parts.length - 1] : 'backlog'
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const call = makeCaller()
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'backlog: dictionaries')
        // Inline styles cannot express :hover or repaint with the theme; one
        // stylesheet keyed on the theme tokens does both.
        ctx.effect(() => {
          const style = document.createElement('style')
          style.setAttribute('data-backlog-styles', '')
          style.textContent = THEME_CSS
          document.head.append(style)
          return () => { style.remove() }
        }, 'backlog: theme styles')
        const t = ctx.locale.bind(NS)

        ctx.slots.inject('conversation.view', () => ctx.slots.register({
          name: 'conversation.view',
          id: 'backlog',
          order: 20,
          locale: NS,
          label: () => t('view.backlog'),
          inject: () => ({ call }),
        }, BacklogView))

        ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
          name: 'conversation.session.header.utilities',
          id: 'backlog-actions',
          order: 60,
          locale: NS,
          inject: () => ({ call }),
        }, BacklogHeaderActions))

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'backlog-init-dialog',
          locale: NS,
          inject: () => ({ call }),
        }, InitDialog))

        // A global panel: the sidebar entry plus its page exist without any
        // Session, which is what the empty (no-conversation) state needs. Both
        // registrations are isolated, so a change to these slot contracts can
        // never take the board tab and the header menu down with it.
        try {
          ctx.slots.inject('main', () => ctx.slots.register({
            name: 'main',
            key: PANEL_ID,
            locale: NS,
            inject: () => ({ call, getWorkspaces: () => ctx.get('workspaces') }),
          }, BacklogPanel))

          ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 10,
            locale: NS,
            label: () => t('panel.label'),
          }, BacklogPanelIcon))
        } catch (error) {
          console.warn(`backlog: sidebar panel unavailable: ${messageOf(error)}`)
        }
      },
    }
  },
})
