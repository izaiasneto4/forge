import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:net'
import type { DesktopLocalEnvironment } from '@shared/desktop-bridge'
import type { RotatingLog } from './log'
import type { ServerCommand } from './paths'
import type { Env } from './shell-env'

// Owns the server process: picks a port and a token, spawns it, waits for /up,
// restarts it with backoff when it dies, and stops it on quit. Node built-ins
// only, so tests can drive it with a stand-in server.

export const LOOPBACK_HOST = '127.0.0.1'
export const READY_TIMEOUT_MS = 20_000
export const READY_POLL_INTERVAL_MS = 100
// The server drains its job worker for 5 s on SIGTERM.
export const STOP_TIMEOUT_MS = 6_000
export const MAX_RESTARTS = 5
export const BACKOFF_CAP_MS = 30_000
// A server that stayed up this long starts the restart count over.
export const STABLE_UPTIME_MS = 60_000

// Settings a developer's shell must not leak into the app's server: every
// ORDEM_* key (and the legacy FORGE_* fallbacks the server still honours), plus
// plain variables the server reads that would move its data or port.
const STRIPPED_KEYS = new Set(['DATABASE_PATH', 'PORT', 'NODE_ENV', 'RAILS_ROOT', 'FRONTEND_DEV_URL', 'ELECTRON_RUN_AS_NODE'])

export function stripServerKeys(env: Env): Env {
  const stripped: Env = {}
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith('ORDEM_') || key.startsWith('FORGE_') || STRIPPED_KEYS.has(key)) continue
    stripped[key] = value
  }
  return stripped
}

export interface DesktopServerValues {
  home: string
  stateDir: string
  publicDir: string
  migrationsDir: string
  isPackaged: boolean
  port: number
  token: string
}

// Inherited env first, recovered login-shell values on top (a GUI launch's short
// PATH must lose), then the stripped keys go, then the desktop values.
export function buildServerEnv(inherited: Env, shellEnv: Env, values: DesktopServerValues): Env {
  return {
    ...stripServerKeys({ ...inherited, ...shellEnv }),
    ORDEM_MODE: 'desktop',
    ORDEM_HOME: values.home,
    ORDEM_STATE_DIR: values.stateDir,
    NODE_ENV: values.isPackaged ? 'production' : 'development',
    ORDEM_HOST: LOOPBACK_HOST,
    PORT: String(values.port),
    ORDEM_DESKTOP_TOKEN: values.token,
    ORDEM_PUBLIC_DIR: values.publicDir,
    ORDEM_MIGRATIONS_DIR: values.migrationsDir,
    ORDEM_LOG_LEVEL: 'info',
  }
}

// 1 s, 2 s, 4 s, ... capped at 30 s. `attempt` counts from 1.
export function backoffDelayMs(attempt: number) {
  return Math.min(1000 * 2 ** (attempt - 1), BACKOFF_CAP_MS)
}

export function createToken() {
  return randomBytes(32).toString('hex')
}

export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.unref()
    probe.on('error', reject)
    probe.listen(0, LOOPBACK_HOST, () => {
      const address = probe.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      probe.close(() => (port > 0 ? resolve(port) : reject(new Error('No free port'))))
    })
  })
}

export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer()
    probe.unref()
    probe.once('error', () => resolve(false))
    probe.listen(port, LOOPBACK_HOST, () => probe.close(() => resolve(true)))
  })
}

export function localEnvironment(port: number, token: string): DesktopLocalEnvironment {
  return { httpBaseUrl: `http://${LOOPBACK_HOST}:${port}`, wsBaseUrl: `ws://${LOOPBACK_HOST}:${port}`, token }
}

export type BackendState =
  | { status: 'starting' }
  | { status: 'ready'; environment: DesktopLocalEnvironment; pid: number }
  | { status: 'restarting'; attempt: number; delayMs: number }
  | { status: 'failed'; message: string }
  | { status: 'stopped' }

export interface BackendManagerOptions {
  server: ServerCommand
  cwd: string
  inheritedEnv: Env
  shellEnv: Env
  values: Omit<DesktopServerValues, 'port' | 'token'>
  log: RotatingLog
  platform?: NodeJS.Platform
  onState?: (state: BackendState) => void
  readyTimeoutMs?: number
  stopTimeoutMs?: number
  backoff?: (attempt: number) => number
}

export class BackendStartError extends Error {}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function waitForExit(child: ChildProcess, timeoutMs: number) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true)
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve(true)
    })
  })
}

export class BackendManager {
  private child: ChildProcess | null = null
  private port = 0
  private readonly token = createToken()
  private stopping = false
  private restarts = 0
  private restartTimer: ReturnType<typeof setTimeout> | null = null
  private readySince = 0
  private current: BackendState = { status: 'stopped' }

  constructor(private readonly options: BackendManagerOptions) {}

  get state() {
    return this.current
  }

  get environment(): DesktopLocalEnvironment | null {
    return this.current.status === 'ready' ? this.current.environment : null
  }

  get pid() {
    return this.child?.pid ?? null
  }

  // Resolves once /up answers. Throws BackendStartError if the first start fails.
  async start(): Promise<DesktopLocalEnvironment> {
    this.stopping = false
    this.restarts = 0
    this.port = await findFreePort()
    const environment = await this.launch()
    if (!environment) throw new BackendStartError(this.failureMessage())
    return environment
  }

  async stop() {
    this.stopping = true
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.restartTimer = null
    const child = this.child
    if (child) {
      this.options.log.line(`[shell] stopping server pid ${child.pid ?? '?'}`)
      // Windows has no SIGTERM: kill() ends the process, and orphaned review
      // tasks are recovered by the server on its next boot.
      if (this.platform === 'win32') child.kill()
      else child.kill('SIGTERM')
      if (!(await waitForExit(child, this.options.stopTimeoutMs ?? STOP_TIMEOUT_MS))) {
        this.options.log.line('[shell] server ignored SIGTERM, killing it')
        child.kill('SIGKILL')
        await waitForExit(child, 2000)
      }
    }
    this.child = null
    this.setState({ status: 'stopped' })
  }

  private get platform() {
    return this.options.platform ?? process.platform
  }

  private failureMessage() {
    return `The Ordem server did not start. Details are in ${this.options.log.path}`
  }

  private setState(state: BackendState) {
    this.current = state
    this.options.onState?.(state)
  }

  // One spawn plus readiness wait. Returns null when the process died or never answered.
  private async launch(): Promise<DesktopLocalEnvironment | null> {
    this.setState({ status: 'starting' })
    const { server, values } = this.options
    const env = buildServerEnv(this.options.inheritedEnv, this.options.shellEnv, { ...values, port: this.port, token: this.token })
    this.options.log.line(`[shell] starting ${server.command} ${server.args.join(' ')} on port ${this.port}`)

    const child = spawn(server.command, server.args, { cwd: this.options.cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    this.child = child
    child.stdout?.on('data', (chunk: Buffer) => this.options.log.write(chunk))
    child.stderr?.on('data', (chunk: Buffer) => this.options.log.write(chunk))
    child.once('error', (error) => this.options.log.line(`[shell] spawn failed: ${error.message}`))
    child.once('exit', (code, signal) => this.onExit(child, code, signal))

    const environment = localEnvironment(this.port, this.token)
    const ready = await this.waitForUp(child, environment.httpBaseUrl)
    if (!ready) {
      if (child.exitCode === null && child.signalCode === null) {
        this.options.log.line('[shell] server did not answer /up in time, stopping it')
        child.kill('SIGKILL')
      }
      return null
    }

    this.readySince = Date.now()
    this.options.log.line(`[shell] server ready on ${environment.httpBaseUrl} (pid ${child.pid ?? '?'})`)
    this.setState({ status: 'ready', environment, pid: child.pid ?? 0 })
    return environment
  }

  private async waitForUp(child: ChildProcess, httpBaseUrl: string) {
    const deadline = Date.now() + (this.options.readyTimeoutMs ?? READY_TIMEOUT_MS)
    while (Date.now() < deadline) {
      if (this.stopping || this.child !== child || child.exitCode !== null || child.signalCode !== null) return false
      try {
        const response = await fetch(`${httpBaseUrl}/up`, { signal: AbortSignal.timeout(1000) })
        if (response.ok) return true
      } catch {
        // Not listening yet.
      }
      await sleep(READY_POLL_INTERVAL_MS)
    }
    return false
  }

  private onExit(child: ChildProcess, code: number | null, signal: NodeJS.Signals | null) {
    this.options.log.line(`[shell] server pid ${child.pid ?? '?'} exited (code ${code ?? 'none'}, signal ${signal ?? 'none'})`)
    if (this.child !== child) return
    this.child = null
    if (this.stopping) return
    // Only a server that had been ready restarts here; a failed launch is handled by its caller.
    if (this.current.status === 'ready') this.scheduleRestart()
  }

  private scheduleRestart() {
    if (Date.now() - this.readySince >= STABLE_UPTIME_MS) this.restarts = 0
    this.restarts += 1
    if (this.restarts > MAX_RESTARTS) {
      this.setState({ status: 'failed', message: this.failureMessage() })
      return
    }

    const delayMs = (this.options.backoff ?? backoffDelayMs)(this.restarts)
    this.setState({ status: 'restarting', attempt: this.restarts, delayMs })
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      void this.restart()
    }, delayMs)
  }

  private async restart() {
    if (this.stopping) return
    // Keep the port so the renderer's URLs stay valid; move only if something took it.
    if (!(await isPortFree(this.port))) this.port = await findFreePort()
    const environment = await this.launch()
    if (!environment && !this.stopping) this.scheduleRestart()
  }
}
