import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { DesktopUpdateState } from '@shared/desktop-bridge'
import type { RotatingLog } from './log'

// electron-updater against GitHub Releases. First check 15 s after launch, then
// every 4 minutes. Installing stops the server first, then quits and installs.

export const FIRST_CHECK_DELAY_MS = 15_000
export const CHECK_INTERVAL_MS = 4 * 60_000

export interface UpdaterOptions {
  log: RotatingLog
  env: Record<string, string | undefined>
  onState: (state: DesktopUpdateState) => void
  beforeInstall: () => Promise<void>
  firstCheckDelayMs?: number
  // Install as soon as the download finishes (the update smoke test).
  installWhenReady?: boolean
}

// ORDEM_UPDATE_FEED_URL points a packaged build at a plain HTTP folder holding
// latest*.yml and the artifacts, so CI can test an update without publishing.
export function updateFeedOverride(env: Record<string, string | undefined>) {
  const url = env.ORDEM_UPDATE_FEED_URL?.trim()
  return url ? url : null
}

// electron-builder writes app-update.yml next to the app when a publish target
// exists; without it (local builds) there is nothing to check against.
function updatesAvailable(env: Record<string, string | undefined>) {
  if (!app.isPackaged || env.ORDEM_DISABLE_UPDATES === '1') return false
  return updateFeedOverride(env) !== null || existsSync(join(process.resourcesPath, 'app-update.yml'))
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export class Updater {
  private state: DesktopUpdateState
  private timers: Array<ReturnType<typeof setTimeout>> = []
  private readonly enabled: boolean

  constructor(private readonly options: UpdaterOptions) {
    this.enabled = updatesAvailable(options.env)
    this.state = {
      status: this.enabled ? 'idle' : 'disabled',
      currentVersion: app.getVersion(),
      availableVersion: null,
      downloadPercent: null,
      error: null,
      checkedAt: null,
    }
  }

  get current() {
    return this.state
  }

  start() {
    if (!this.enabled) return
    // Nightly builds follow nightly-*.yml; stable ones never see prereleases.
    if (/-nightly\./.test(app.getVersion())) {
      autoUpdater.channel = 'nightly'
      autoUpdater.allowPrerelease = true
    }
    const feedOverride = updateFeedOverride(this.options.env)
    if (feedOverride) autoUpdater.setFeedURL({ provider: 'generic', url: feedOverride })
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.logger = { info: (message) => this.log(message), warn: (message) => this.log(message), error: (message) => this.log(message), debug: () => {} }

    autoUpdater.on('checking-for-update', () => this.update({ status: 'checking', error: null }))
    autoUpdater.on('update-not-available', () => this.update({ status: 'idle', checkedAt: new Date().toISOString() }))
    autoUpdater.on('update-available', (info) => this.update({ status: 'downloading', availableVersion: info.version, downloadPercent: 0, checkedAt: new Date().toISOString() }))
    autoUpdater.on('download-progress', (progress) => this.update({ status: 'downloading', downloadPercent: Math.round(progress.percent) }))
    autoUpdater.on('update-downloaded', (info) => {
      this.update({ status: 'ready', availableVersion: info.version, downloadPercent: 100 })
      if (this.options.installWhenReady) void this.install()
    })
    autoUpdater.on('error', (error) => this.update({ status: 'error', error: errorText(error), checkedAt: new Date().toISOString() }))

    this.timers.push(setTimeout(() => void this.check(), this.options.firstCheckDelayMs ?? FIRST_CHECK_DELAY_MS))
    this.timers.push(setInterval(() => void this.check(), CHECK_INTERVAL_MS))
  }

  stop() {
    for (const timer of this.timers) clearTimeout(timer)
    this.timers = []
  }

  async check() {
    if (!this.enabled) return
    // A downloaded update waits for the user; a running download is already busy.
    if (this.state.status === 'downloading' || this.state.status === 'ready' || this.state.status === 'checking') return
    try {
      await autoUpdater.checkForUpdates()
    } catch (error) {
      this.update({ status: 'error', error: errorText(error), checkedAt: new Date().toISOString() })
    }
  }

  async install() {
    if (this.state.status !== 'ready') return
    this.log('[updater] stopping the server before installing')
    await this.options.beforeInstall()
    autoUpdater.quitAndInstall()
  }

  private update(patch: Partial<DesktopUpdateState>) {
    this.state = { ...this.state, ...patch }
    this.options.onState(this.state)
  }

  private log(message: string) {
    this.options.log.line(`[updater] ${message}`)
  }
}
