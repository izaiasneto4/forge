import { app, BrowserWindow, dialog, session, shell } from 'electron'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { DesktopPlatform } from '@shared/desktop-bridge'
import { BackendManager, rendererBackendState, type BackendState } from './backend'
import { installCliShim, removeConnectionFile, writeConnectionFile } from './cli-shim'
import { CHANNELS } from './channels'
import { broadcast, registerIpc } from './ipc'
import { RotatingLog } from './log'
import { installMenu } from './menu'
import { resolveDesktopPaths, type DesktopPaths } from './paths'
import { handleAppProtocol, handleDevAppProtocol, registerSchemePrivileges } from './protocol'
import { APP_URL, DEV_APP_URL } from './protocol-routes'
import { recoverShellEnvironment } from './shell-env'
import { STARTING_PAGE_URL } from './starting-page'
import { Updater } from './updater'
import { createMainWindow } from './window'

// Boot order: single-instance lock, scheme privileges, ready, protocol, IPC,
// window with a starting page, login-shell env, server, then the app page.
// Quit waits for the server to stop.

const SMOKE_TIMEOUT_MS = 30_000
// Copy buttons need clipboard writes; review notifications need notifications.
const ALLOWED_PERMISSIONS = new Set(['notifications', 'clipboard-sanitized-write', 'fullscreen'])
const development = !app.isPackaged
const smoke = process.argv.includes('--smoke')
const devServerUrl = development ? process.env.ORDEM_DEV_SERVER_URL?.trim() || null : null
const appUrl = devServerUrl ? DEV_APP_URL : APP_URL
const appOrigin = appUrl.replace(/\/$/, '')

let mainWindow: BrowserWindow | null = null
let backend: BackendManager | null = null
let updater: Updater | null = null
let shellLog: RotatingLog | null = null
let readyToQuit = false
// Set once boot loaded the app page; later ready states move starting-page windows over.
let booted = false

function desktopPlatform(): DesktopPlatform {
  if (process.platform === 'darwin' || process.platform === 'win32') return process.platform
  return 'linux'
}

function logLine(message: string) {
  shellLog?.line(message)
  if (development || smoke) console.log(message)
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function onBackendState(state: BackendState, paths: DesktopPaths) {
  logLine(`[shell] server ${state.status}`)
  broadcast(CHANNELS.backendState, rendererBackendState(state))
  if (state.status === 'ready') {
    broadcast(CHANNELS.localEnvironmentChanged, state.environment)
    writeConnectionFile(paths.stateDir, state.environment, paths.cli)
    if (booted) loadAppInStartingWindows()
  } else {
    removeConnectionFile(paths.stateDir)
  }
  if (state.status === 'failed') void showBackendFailure(state.message, paths, false)
}

// A window opened while the server was down shows the starting page until now.
function loadAppInStartingWindows() {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && window.webContents.getURL() === STARTING_PAGE_URL) void window.loadURL(appUrl)
  }
}

// Returns true to retry. A failed first start offers Retry; a crash loop only Quit.
async function showBackendFailure(message: string, paths: DesktopPaths, canRetry: boolean) {
  if (smoke) {
    console.error(`[smoke] ${message}`)
    app.exit(1)
    return false
  }
  const buttons = canRetry ? ['Retry', 'Show Logs', 'Quit'] : ['Show Logs', 'Quit']
  for (;;) {
    const { response } = await dialog.showMessageBox({ type: 'error', title: 'Ordem', message: 'The Ordem server stopped', detail: message, buttons, defaultId: 0, cancelId: buttons.length - 1 })
    const choice = buttons[response]
    if (choice === 'Retry') return true
    if (choice === 'Show Logs') {
      await shell.openPath(paths.logDir)
      continue
    }
    app.exit(1)
    return false
  }
}

async function startBackend(manager: BackendManager, paths: DesktopPaths) {
  for (;;) {
    try {
      return await manager.start()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!(await showBackendFailure(message, paths, true))) return null
    }
  }
}

// Not __dirname: Bun's bundler bakes in the source folder at build time.
function openWindow(paths: DesktopPaths, url: string) {
  const window = createMainWindow({ preloadPath: join(app.getAppPath(), 'dist-electron', 'preload.cjs'), settingsFile: paths.settingsFile, appOrigin })
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })
  window.webContents.on('preload-error', (_event, preloadPath, error) => logLine(`[shell] preload ${preloadPath} failed: ${error.message}`))
  window.webContents.on('render-process-gone', (_event, details) => logLine(`[shell] renderer gone: ${details.reason}`))
  void window.loadURL(url)
  mainWindow = window
  return window
}

// --smoke: exit 0 once React rendered and the renderer reached the API with its token.
const SMOKE_PROBE = `(async () => {
  const deadline = Date.now() + 15000
  while (!document.getElementById('root')?.childElementCount) {
    if (Date.now() > deadline) return 'react did not render'
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  const bridge = window.ordemDesktop
  if (!bridge) return 'no desktop bridge'
  const { httpBaseUrl, token } = bridge.getLocalEnvironment()
  const response = await fetch(httpBaseUrl + '/api/v1/status', { headers: { Authorization: 'Bearer ' + token } })
  return response.status === 200 ? 'ok' : 'status ' + response.status
})()`

async function runSmokeCheck(window: BrowserWindow, loaded: Promise<void>) {
  const timeout = setTimeout(() => {
    console.error('[smoke] timed out')
    app.exit(1)
  }, SMOKE_TIMEOUT_MS)
  await loaded
  const result: unknown = await window.webContents.executeJavaScript(SMOKE_PROBE)
  clearTimeout(timeout)
  console.log(`[smoke] ${String(result)}`)
  await backend?.stop()
  app.exit(result === 'ok' ? 0 : 1)
}

async function installCommandLineTool(paths: DesktopPaths) {
  try {
    const { shimPath, linkedAt } = installCliShim({ home: paths.home, stateDir: paths.stateDir })
    const detail = linkedAt
      ? `Run \`ordem status\` in a terminal while Ordem is open. Linked ${linkedAt} to ${shimPath}.`
      : `Installed ${shimPath}. Add ${dirname(shimPath)} to your PATH, then run \`ordem status\` while Ordem is open.`
    await dialog.showMessageBox({ type: 'info', title: 'Ordem', message: 'The ordem command is installed', detail })
  } catch (error) {
    dialog.showErrorBox('Could not install the ordem command', error instanceof Error ? error.message : String(error))
  }
}

function restrictPermissions() {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => callback(ALLOWED_PERMISSIONS.has(permission)))
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => ALLOWED_PERMISSIONS.has(permission))
}

async function boot() {
  await app.whenReady()

  const paths = resolveDesktopPaths({
    isPackaged: app.isPackaged,
    platform: process.platform,
    homeDir: homedir(),
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    env: process.env,
  })
  shellLog = new RotatingLog(join(paths.logDir, 'desktop.log'))
  logLine(`[shell] Ordem ${app.getVersion()} (${development ? 'development' : 'packaged'}), state in ${paths.stateDir}`)

  if (devServerUrl) handleDevAppProtocol(paths.publicDir, devServerUrl)
  else handleAppProtocol(paths.publicDir)
  restrictPermissions()

  const manager = new BackendManager({
    server: paths.server,
    cwd: homedir(),
    inheritedEnv: process.env,
    shellEnv: {},
    values: { home: paths.home, stateDir: paths.stateDir, publicDir: paths.publicDir, migrationsDir: paths.migrationsDir, isPackaged: app.isPackaged },
    log: new RotatingLog(join(paths.logDir, 'server.log')),
    onState: (state) => onBackendState(state, paths),
  })
  backend = manager
  const activeUpdater = new Updater({
    log: shellLog,
    env: process.env,
    onState: (state) => broadcast(CHANNELS.updateState, state),
    beforeInstall: async () => {
      readyToQuit = true
      await manager.stop()
    },
  })
  updater = activeUpdater
  registerIpc({ appOrigin, platform: desktopPlatform(), environment: () => manager.environment, updater: activeUpdater })
  installMenu({ development, installCommandLineTool: process.platform === 'win32' ? undefined : () => void installCommandLineTool(paths) })

  // A window right away; the app page replaces the starting page once the server answers.
  openWindow(paths, STARTING_PAGE_URL)
  app.on('activate', () => {
    if (mainWindow) focusMainWindow()
    else openWindow(paths, manager.state.status === 'ready' ? appUrl : STARTING_PAGE_URL)
  })

  manager.setShellEnv(await recoverShellEnvironment({ env: process.env, platform: process.platform, log: logLine }))
  if (!(await startBackend(manager, paths))) return

  const window = mainWindow ?? openWindow(paths, STARTING_PAGE_URL)
  const loaded = window.loadURL(appUrl)
  booted = true
  if (smoke) void runSmokeCheck(window, loaded)
  else activeUpdater.start()
}

if (process.argv.includes('--version')) {
  console.log(app.getVersion())
  app.exit(0)
} else if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  registerSchemePrivileges()
  app.on('second-instance', focusMainWindow)
  // A terminal Ctrl-C (or the dev launcher restarting us) quits through before-quit.
  process.on('SIGINT', () => app.quit())
  process.on('SIGTERM', () => app.quit())
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('before-quit', (event) => {
    if (readyToQuit) return
    event.preventDefault()
    readyToQuit = true
    updater?.stop()
    void (backend?.stop() ?? Promise.resolve()).finally(() => app.quit())
  })
  boot().catch((error: unknown) => {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
    logLine(`[shell] boot failed: ${message}`)
    dialog.showErrorBox('Ordem could not start', message)
    app.exit(1)
  })
}
