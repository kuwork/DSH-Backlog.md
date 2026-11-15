/**
 * Host half of the Backlog.md Browser bundle.
 *
 * Owns one `backlog browser` child process per workspace, allocates a loopback
 * port per workspace so several workspaces can run at once, and exposes the
 * whole lifecycle to the Client half through four endpoints on its own `/backlog`
 * HTTP route (same-origin JSON, authenticated by Connection's admission):
 *
 *   inspect  { cwd }            -> { cwd, initialized, configPath, running, port, url }
 *   status   { cwd }            -> same as inspect (cheap, no spawn)
 *   start    { cwd }            -> inspect + { starting: false }
 *   stop     { cwd }            -> { cwd, running: false }
 *   init     { cwd, options }   -> { cwd, initialized, log }
 *
 * Port policy (multiple workspaces at once):
 *   1. a per-workspace preferred port derived from the workspace path hash,
 *      offset from `basePort` (default 6420) into a 100-port window;
 *   2. on EADDRINUSE the next candidate port is tried, up to `portTries`;
 *   3. after that an OS-assigned ephemeral port is used.
 * Readiness is confirmed by polling the HTTP root, not by parsing stdout,
 * because `backlog` prints an animated status line.
 */
import { promises as fsp } from 'node:fs'
import net from 'node:net'
import path from 'node:path'

export const name = 'dsh-backlog.md'

/**
 * Services this plugin needs before `apply` runs. `webServer` hosts the channel's
 * physical route; `connection` owns its authentication and envelope.
 */
export const inject = ['subprocess', 'connection', 'webServer']

/**
 * The logical RPC channel this plugin owns.
 *
 * `/api` is the Gateway's exclusive shared channel: its interceptor already
 * answers every endpoint it claims, and a second interceptor on the same channel
 * throws. A plugin that adds its own endpoints therefore registers a dedicated
 * channel instead, which Connection mounts as its own authenticated route.
 */
const CHANNEL = '/backlog'

/** Config file names inside a data folder. */
const CONFIG_FILES = ['config.yml', 'config.yaml']
/** Data folders a backlog project lives in. Only these count as initialization. */
const DATA_DIRS = ['backlog', '.backlog']
/** Entries that mark a folder as a backlog board rather than an unrelated directory. */
const BOARD_MARKERS = ['config.yml', 'config.yaml', 'tasks', 'completed', 'archive', 'drafts', 'decisions', 'docs', 'milestones']
const READY_TIMEOUT_MS = 90_000
/** SGR/CSI sequences the CLI writes even when captured without a terminal. */
const ANSI_ESCAPE = /\u001b\[[0-9;?]*[ -/]*[@-~]/g
const DEFAULT_PORT_TRIES = 20
const STDERR_TAIL_BYTES = 4096

/** One managed `backlog browser` process for one workspace. */
const entries = new Map()
/** In-flight starts keyed by workspace, so a double click spawns one process. */
const starting = new Map()

/**
 * Normalize a workspace directory into the registry key and the spawn cwd.
 * @param raw - caller supplied directory.
 * @returns absolute normalized path.
 */
function normalizeCwd(raw) {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw Object.assign(new Error('backlog: "cwd" is required'), { code: 'backlog/bad-request' })
  }
  if (!path.isAbsolute(raw)) {
    throw Object.assign(new Error(`backlog: "cwd" must be absolute, got "${raw}"`), { code: 'backlog/bad-request' })
  }
  return path.resolve(raw)
}

/**
 * Registry key: Windows paths are case-insensitive, so fold them.
 * @param cwd - absolute workspace directory.
 * @returns lookup key.
 */
function keyOf(cwd) {
  return process.platform === 'win32' ? cwd.toLowerCase() : cwd
}

/**
 * Stable non-negative hash of the workspace path, used to spread workspaces
 * across distinct port windows instead of racing for 6420.
 * @param value - workspace key.
 * @returns hash in [0, 2^31).
 */
function hashOf(value) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (Math.imul(hash, 31) + value.charCodeAt(index)) | 0
  }
  return Math.abs(hash)
}

/**
 * Resolve the `backlog` command into a concrete argv prefix.
 *
 * The npm launcher is a `.cmd`/`.ps1` shim; this seam never runs a shell, so a
 * shim is translated back into `node <cli.js>` using the npm layout
 * (`<prefix>/backlog.cmd` next to `<prefix>/node_modules/@kuwork/backlog.md/cli.js`).
 * @param ctx - host context.
 * @param config - the bundle row's config.
 * @param cwd - workspace directory, for a project-local install.
 * @returns argv prefix that runs the CLI.
 */
async function resolveCommand(ctx, config, cwd) {
  const override = typeof config?.executablePath === 'string' && config.executablePath.length > 0
    ? config.executablePath
    : undefined

  const jsEntry = async (from) => {
    try {
      await fsp.access(from)
      return [process.execPath, from]
    } catch {
      return undefined
    }
  }

  if (override !== undefined) {
    if (/\.(c?js|mjs)$/i.test(override)) return jsEntry(override) ?? [process.execPath, override]
    return [override]
  }

  const candidates = []
  if (process.platform === 'win32' && typeof process.env.APPDATA === 'string') {
    candidates.push(path.join(process.env.APPDATA, 'npm', 'node_modules', '@kuwork', 'backlog.md', 'cli.js'))
  }
  candidates.push(path.join(cwd, 'node_modules', '@kuwork', 'backlog.md', 'cli.js'))

  let resolved
  try {
    resolved = await ctx.subprocess.resolveExecutable('backlog')
  } catch {
    resolved = undefined
  }

  if (resolved !== undefined) {
    if (/\.exe$/i.test(resolved)) return [resolved]
    if (/\.(c?js|mjs)$/i.test(resolved)) return [process.execPath, resolved]
    const prefix = path.dirname(resolved)
    candidates.unshift(path.join(prefix, 'node_modules', '@kuwork', 'backlog.md', 'cli.js'))
    candidates.push(path.join(prefix, '..', 'lib', 'node_modules', '@kuwork', 'backlog.md', 'cli.js'))
  }

  for (const candidate of candidates) {
    const argv = await jsEntry(candidate)
    if (argv !== undefined) return argv
  }

  throw Object.assign(
    new Error('找不到 backlog 命令。请先执行 npm i -g @kuwork/backlog.md，或在插件配置里设置 executablePath。'),
    { code: 'backlog/not-installed' },
  )
}

/**
 * `stat` without throwing: every probe below is an existence question.
 * @param target - absolute path.
 * @returns the stats, or undefined when the path cannot be examined.
 */
async function statOf(target) {
  try {
    return await fsp.stat(target)
  } catch {
    return undefined
  }
}

/**
 * Whether `target` exists as a regular file.
 * @param target - absolute path.
 * @returns true for an existing file.
 */
async function isFile(target) {
  const stats = await statOf(target)
  return stats?.isFile() === true
}

/**
 * Whether `target` exists as a directory.
 * @param target - absolute path.
 * @returns true for an existing directory.
 */
async function isDir(target) {
  const stats = await statOf(target)
  return stats?.isDirectory() === true
}

/**
 * Locate the config file of one project folder.
 * @param dir - absolute candidate project folder.
 * @returns the absolute config path, or undefined.
 */
async function configIn(dir) {
  for (const name of ['config.yml', 'config.yaml']) {
    const candidate = path.join(dir, name)
    if (await isFile(candidate)) return candidate
  }
  return undefined
}

/**
 * Whether a folder carries a backlog board but no config file. `backlog init`
 * always creates `config.yml` plus these subfolders, so finding them means the
 * project exists even when the config ended up somewhere unexpected.
 * @param dir - absolute candidate project folder.
 * @returns true when at least one board marker exists.
 */
async function looksLikeBoard(dir) {
  try {
    const entries = await fsp.readdir(dir)
    return entries.some(entry => BOARD_MARKERS.includes(entry))
  } catch {
    return false
  }
}

/**
 * Report which backlog project the workspace already has.
 *
 * Only a `backlog/` or `.backlog/` folder counts: that is where a project's
 * data lives, and where `backlog init` writes `config.yml`. A root-level
 * `backlog.config.yml` is deliberately not evidence — it is a config location
 * `backlog` itself supports, but a stray one does not make the workspace a
 * backlog project. A folder that carries the board without a config file is
 * still accepted, so an initialized workspace is never reported as
 * uninitialized.
 * @param cwd - workspace directory.
 * @returns the detected project path relative to `cwd`, or undefined.
 */
export async function detectConfig(cwd) {
  for (const folder of DATA_DIRS) {
    const absolute = path.join(cwd, folder)
    if (!(await isDir(absolute))) continue
    const config = await configIn(absolute)
    // Reported to the UI, so keep one separator on every platform.
    if (config !== undefined) return path.relative(cwd, config).split(path.sep).join('/')
    if (await looksLikeBoard(absolute)) return folder
  }
  return undefined
}

/**
 * Test whether a loopback port can be bound right now.
 * @param port - candidate port.
 * @returns true when the bind succeeded and the probe socket closed.
 */
function isPortFree(port) {
  return new Promise(resolve => {
    const server = net.createServer()
    const settle = value => {
      server.removeAllListeners()
      resolve(value)
    }
    server.once('error', () => settle(false))
    server.once('listening', () => { server.close(() => settle(true)) })
    server.listen(port, '127.0.0.1')
  })
}

/**
 * Ask the OS for a free ephemeral port.
 * @returns an unused loopback port.
 */
function ephemeralPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.once('listening', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
    server.listen(0, '127.0.0.1')
  })
}

/**
 * Build the ordered candidate ports for one workspace.
 * @param cwd - absolute workspace directory.
 * @param basePort - preferred base port.
 * @param tries - window size.
 * @returns candidate ports in preference order.
 */
function candidatePorts(cwd, basePort, tries) {
  const start = basePort + (hashOf(keyOf(cwd)) % 100)
  const ports = []
  for (let index = 0; index < tries; index += 1) {
    ports.push(((start - 6420 + index) % 20000) + 6420)
  }
  return ports
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

/**
 * The URL line the CLI prints once its HTTP server is bound. `backlog browser`
 * moves to a temporary port when the requested one is taken, and this line is
 * the only authoritative report of where it ended up:
 *
 *    Default port 6499 is occupied. Using temporary port 6500.
 *    Backlog.md browser interface running at http://localhost:6500
 *
 * The port is captured directly rather than parsed out of the URL: a trailing
 * sentence or punctuation after the URL must not shift the number.
 */
const ANNOUNCED_PORT = /(?:running at|Running at)\s+https?:\/\/[^\s"'`]*?:(\d{2,5})(?!\d)/

/**
 * Read the port the CLI reports it bound from its startup output.
 * @param text - accumulated stdout (or any line of it).
 * @returns the announced port, or undefined while the line has not appeared.
 */
export function announcedPort(text) {
  const match = ANNOUNCED_PORT.exec(text)
  if (match === null) return undefined
  const port = Number(match[1])
  return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : undefined
}

/**
 * Poll the server root until it answers, or the child exits, or time is up.
 * The port is re-read from the record on every pass: the CLI may move to a
 * temporary port when the requested one is taken, so the requested port is only
 * the first guess and the announcement decides the rest.
 * @param entry - the managed process record.
 * @param timeoutMs - overall budget.
 * @returns true when HTTP answered.
 */
async function waitUntilReady(entry, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (entry.exited) return false
    const port = entry.port
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`, { method: 'GET' })
      await response.arrayBuffer().catch(() => undefined)
      if (response.status < 500) {
        entry.url = `http://127.0.0.1:${port}/`
        return true
      }
    } catch {
      // not up yet
    }
    await delay(300)
  }
  return false
}

/**
 * Terminate one managed process and wait for its whole process range.
 * @param entry - the managed process record.
 */
async function stopEntry(entry) {
  try {
    entry.handle.terminate()
  } catch {
    // already gone
  }
  try {
    await entry.handle.waitForExit()
  } catch {
    // provider can no longer observe the range; nothing left to wait for
  }
}

/**
 * Spawn `backlog browser --port <port> --no-open` for one workspace.
 * @param ctx - host context.
 * @param argvPrefix - command that runs the CLI.
 * @param cwd - workspace directory.
 * @param port - port to bind.
 * @returns the managed process record.
 */
function spawnServer(ctx, argvPrefix, cwd, port) {
  const handle = ctx.subprocess.spawn({
    argv: [...argvPrefix, 'browser', '--port', String(port), '--no-open'],
    cwd,
    stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
    graceMs: 5_000,
    env: { BROWSER: '', BACKLOG_STATUS_LINE: '0' },
  })
  const entry = {
    /** Port the CLI was asked for; the announcement may replace it below. */
    requestedPort: port,
    /** Port the CLI reports it bound (starts as the requested one). */
    port,
    url: null,
    handle,
    exited: false,
    stderrTail: '',
    outputTail: '',
    startedAt: Date.now(),
  }
  const keepTail = chunk => {
    entry.stderrTail = (entry.stderrTail + chunk.toString('utf8')).slice(-STDERR_TAIL_BYTES)
  }
  // The announcement is the only place the real port appears when the CLI moves
  // to a temporary one, so stdout is parsed rather than discarded. The tail is
  // kept bounded and also feeds the failure diagnostic.
  const readAnnouncement = chunk => {
    entry.outputTail = (entry.outputTail + chunk.toString('utf8')).slice(-STDERR_TAIL_BYTES)
    if (entry.url !== null) return
    const announced = announcedPort(entry.outputTail)
    if (announced === undefined) return
    entry.port = announced
    // The CLI binds loopback only; `localhost` may resolve to ::1, so the
    // announced URL is reported with the address the readiness probe used.
    entry.url = `http://127.0.0.1:${announced}/`
  }
  handle.stdout?.on('data', readAnnouncement)
  handle.stderr?.on('data', keepTail)
  // A pipe the child never reads from must still be drained.
  handle.stdout?.resume()
  handle.done.then(
    () => { entry.exited = true },
    error => { entry.exited = true; keepTail(String(error?.message ?? error)) },
  )
  return entry
}

/**
 * Public state for one workspace.
 * @param ctx - host context.
 * @param config - bundle row config.
 * @param cwd - absolute workspace directory.
 * @returns inspect payload.
 */
async function inspectWorkspace(ctx, config, cwd) {
  const entry = entries.get(keyOf(cwd))
  const configPath = await detectConfig(cwd)
  let executable
  try {
    executable = (await resolveCommand(ctx, config, cwd)).join(' ')
  } catch (error) {
    executable = `(unresolved: ${error.message})`
  }
  return {
    cwd,
    initialized: configPath !== undefined,
    configPath: configPath ?? null,
    running: entry !== undefined,
    port: entry?.port ?? null,
    url: entry?.url ?? null,
    /** Present while running: what was asked for, and whether the CLI moved. */
    requestedPort: entry?.requestedPort ?? null,
    shiftedPort: entry !== undefined && entry.port !== entry.requestedPort,
    executable,
  }
}

/**
 * Start (or return) the workspace's server.
 * @param ctx - host context.
 * @param config - bundle row config.
 * @param cwd - absolute workspace directory.
 * @returns inspect payload of the running server.
 */
async function startWorkspace(ctx, config, cwd) {
  const key = keyOf(cwd)
  const existing = entries.get(key)
  if (existing !== undefined) return inspectWorkspace(ctx, config, cwd)

  const pending = starting.get(key)
  if (pending !== undefined) return pending

  const run = (async () => {
    const argvPrefix = await resolveCommand(ctx, config, cwd)
    const basePort = Number.isInteger(config?.basePort) ? config.basePort : 6420
    const tries = Number.isInteger(config?.portTries) ? config.portTries : DEFAULT_PORT_TRIES
    const timeout = Number.isInteger(config?.readyTimeoutMs) ? config.readyTimeoutMs : READY_TIMEOUT_MS
    const ports = candidatePorts(cwd, basePort, tries)
    let lastError = ''

    for (const port of [...ports, await ephemeralPort()]) {
      if (!(await isPortFree(port))) continue
      const entry = spawnServer(ctx, argvPrefix, cwd, port)
      if (await waitUntilReady(entry, timeout)) {
        entries.set(key, entry)
        handleExit(key, entry)
        return inspectWorkspace(ctx, config, cwd)
      }
      // Both streams carry the reason: the CLI reports its complaints on stdout.
      lastError = (entry.stderrTail || entry.outputTail).trim()
        || (entry.exited ? '进程启动后立即退出' : '等待服务就绪超时')
      await stopEntry(entry)
    }

    throw Object.assign(
      new Error(`backlog browser 启动失败：${lastError || '没有可用端口'}`),
      { code: 'backlog/start-failed' },
    )
  })()

  starting.set(key, run)
  try {
    return await run
  } finally {
    starting.delete(key)
  }
}

/**
 * Drop the registry row when the child exits on its own.
 * @param key - workspace key.
 * @param entry - the record that was registered.
 */
function handleExit(key, entry) {
  entry.handle.done.then(
    () => { if (entries.get(key) === entry) entries.delete(key) },
    () => { if (entries.get(key) === entry) entries.delete(key) },
  )
}

/**
 * Stop the workspace's server and wait for the process range to empty.
 * @param cwd - absolute workspace directory.
 * @returns inspect payload with `running: false`.
 */
async function stopWorkspace(ctx, config, cwd) {
  const key = keyOf(cwd)
  const entry = entries.get(key)
  if (entry !== undefined) {
    entries.delete(key)
    await stopEntry(entry)
  }
  return inspectWorkspace(ctx, config, cwd)
}

/**
 * Run `backlog init` with the options the dialog collected.
 * @param ctx - host context.
 * @param config - bundle row config.
 * @param cwd - absolute workspace directory.
 * @param options - form values.
 * @returns inspect payload plus the CLI output.
 */
async function initWorkspace(ctx, config, cwd, options) {
  const argvPrefix = await resolveCommand(ctx, config, cwd)
  const argv = [...argvPrefix, 'init']
  const projectName = typeof options?.projectName === 'string' && options.projectName.trim().length > 0
    ? options.projectName.trim()
    : path.basename(cwd)
  argv.push(projectName, '--defaults')
  if (typeof options?.backlogDir === 'string' && options.backlogDir.length > 0) argv.push('--backlog-dir', options.backlogDir)
  if (options?.configLocation === 'root' || options?.configLocation === 'folder') {
    argv.push('--config-location', options.configLocation)
  }
  if (typeof options?.taskPrefix === 'string' && /^[A-Za-z]+$/.test(options.taskPrefix)) {
    argv.push('--task-prefix', options.taskPrefix)
  }
  const integrations = ['cli', 'mcp', 'none']
  if (integrations.includes(options?.integrationMode)) argv.push('--integration-mode', options.integrationMode)
  const allowed = ['claude', 'agents', 'gemini', 'copilot', 'cursor', 'none']
  const requested = Array.isArray(options?.agentInstructions) ? options.agentInstructions : ['agents']
  const instructions = requested.filter(value => allowed.includes(value))
  argv.push('--agent-instructions', instructions.length > 0 ? instructions.join(',') : 'agents')
  if (options?.git === false) argv.push('--no-git')

  const handle = ctx.subprocess.spawn({
    argv,
    cwd,
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: 65_536 },
      stderr: { maxBytes: 65_536 },
    },
    graceMs: 5_000,
    // The wizard prints a status line and ANSI color; the dialog shows plain text.
    env: { NO_COLOR: '1', BACKLOG_STATUS_LINE: '0', BROWSER: '' },
  })
  const outcome = await handle.done
  const stdout = handle.collected.stdout?.readFrom(0).text ?? ''
  const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
  const log = `${stdout}${stderr}`.replace(ANSI_ESCAPE, '').trim()
  if (outcome.exitCode !== 0) {
    throw Object.assign(
      new Error(`backlog init 失败（退出码 ${String(outcome.exitCode)}）：${log || '无输出'}`),
      { code: 'backlog/init-failed' },
    )
  }
  const state = await inspectWorkspace(ctx, config, cwd)
  // A run that exits zero but leaves no project behind must not look like success:
  // the tab would keep offering 初始化 with no hint about what happened.
  if (state.initialized !== true) {
    throw Object.assign(
      new Error(
        `backlog init 退出码 0，但没有在工作区找到配置（已检查 backlog.config.yml 与 backlog/、.backlog/ 目录）。`
        + `${log ? `\n\n${log}` : ''}`,
      ),
      { code: 'backlog/init-unverified' },
    )
  }
  return { ...state, log }
}

/** Largest request body the channel accepts; every payload is a small JSON document. */
const MAX_BODY_BYTES = 64 * 1024

/**
 * Read a whole request body under a byte cap.
 * @param request - node:http request.
 * @returns the body as UTF-8 text.
 */
function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let total = 0
    request.on('data', chunk => {
      total += chunk.length
      if (total > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('backlog: request body is too large'), { code: 'backlog/body-too-large' }))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

/**
 * Serve one `/backlog/<endpoint>` call.
 *
 * Admission is Connection's own: the Host/Origin fence plus the signed browser
 * session, exactly what the shared `/api` channel applies. The route itself is
 * mounted by this plugin — `connection.rpc.handle()` cannot be used here,
 * because it registers from the Connection service's context, which does not
 * inject `webServer`, and so throws `cannot get property "webServer" without
 * inject` for any third-party row.
 * @param ctx - host context.
 * @param request - node:http request.
 * @param response - node:http response.
 * @param dispatch - endpoint handler returning the `{ ok, value }` result.
 */
async function serveChannel(ctx, request, response, dispatch) {
  const reply = (status, body) => {
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    response.end(JSON.stringify(body))
  }
  const admission = ctx.connection.admit(request)
  if ('rejection' in admission) {
    response.writeHead(admission.rejection)
    response.end(admission.rejection === 401 ? 'unauthorized' : 'forbidden')
    return
  }
  if (request.method !== 'POST') {
    reply(405, { ok: false, error: { code: 'backlog/method-not-allowed', message: 'POST only', details: {} } })
    return
  }
  const pathname = new URL(request.url ?? '/', 'http://dsh.invalid').pathname
  const endpoint = pathname.slice(CHANNEL.length + 1)
  if (endpoint.length === 0 || endpoint.includes('/')) {
    reply(404, { ok: false, error: { code: 'backlog/unknown-endpoint', message: pathname, details: {} } })
    return
  }
  let payload
  try {
    payload = JSON.parse(await readBody(request))
  } catch (error) {
    reply(400, {
      ok: false,
      error: { code: 'backlog/bad-request', message: error instanceof Error ? error.message : String(error), details: {} },
    })
    return
  }
  reply(200, await dispatch(endpoint, payload))
}

/**
 * Host plugin body: own the `/backlog` HTTP route and every child process.
 * @param ctx - host context.
 * @param config - bundle row config (`executablePath`, `basePort`, `portTries`, `readyTimeoutMs`).
 */
export function apply(ctx, config) {
  if (ctx.connection === undefined || ctx.webServer === undefined) {
    ctx.logger?.warn?.('backlog: connection or webServer is absent; the Backlog tab cannot reach the Host')
    return
  }

  const dispatch = async (endpoint, payload) => {
    const body = payload !== null && typeof payload === 'object' ? payload : {}
    switch (endpoint) {
      case 'inspect':
      case 'status':
        return { ok: true, value: await inspectWorkspace(ctx, config, normalizeCwd(body.cwd)) }
      case 'start':
        return { ok: true, value: await startWorkspace(ctx, config, normalizeCwd(body.cwd)) }
      case 'stop':
        return { ok: true, value: await stopWorkspace(ctx, config, normalizeCwd(body.cwd)) }
      case 'init':
        return { ok: true, value: await initWorkspace(ctx, config, normalizeCwd(body.cwd), body.options) }
      default:
        return { ok: false, error: { code: 'backlog/unknown-endpoint', message: endpoint, details: {} } }
    }
  }

  const guarded = async (endpoint, payload, signal, peer) => {
    try {
      return await dispatch(endpoint, payload)
    } catch (error) {
      return {
        ok: false,
        error: {
          code: typeof error?.code === 'string' ? error.code : 'backlog/failed',
          message: error instanceof Error ? error.message : String(error),
          details: {},
        },
      }
    }
  }

  // Mounted here rather than through `connection.rpc.handle()`: that helper
  // registers from the Connection service's own context, which does not inject
  // `webServer`, so it fails for a third-party row. The prefix route is
  // authenticated inside `serveChannel` with the same admission Connection uses.
  ctx.effect(() => {
    return ctx.webServer.register({
      kind: 'prefix',
      path: CHANNEL,
      handler: (request, response) => serveChannel(ctx, request, response, guarded),
    })
  }, 'backlog: channel route')

  ctx.effect(() => {
    return async () => {
      const live = [...entries.values()]
      entries.clear()
      for (const entry of live) await stopEntry(entry)
    }
  })
}
