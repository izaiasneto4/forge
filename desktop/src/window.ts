import { BrowserWindow, screen, shell, type BrowserWindowConstructorOptions } from 'electron'
import { isExternalUrl } from './guards'
import { APP_HOST } from './protocol-routes'
import { clampToDisplays, MIN_SIZE, readDesktopSettings, writeDesktopSettings, type DesktopSettings } from './window-state'

// The app's one window: sandboxed renderer, persisted bounds, hidden title bar
// on macOS, every outside link sent to the OS browser.

const BACKGROUND_COLOR = '#131315'
const SAVE_DELAY_MS = 500

export interface WindowOptions {
  preloadPath: string
  settingsFile: string
  appOrigin: string
}

function platformChrome(): BrowserWindowConstructorOptions {
  // Windows and Linux keep the native frame; the menu bar hides until Alt.
  if (process.platform === 'darwin') return { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 18 } }
  return { autoHideMenuBar: true }
}

function isAppUrl(url: string, appOrigin: string) {
  try {
    const parsed = new URL(url)
    return `${parsed.protocol}//${parsed.host}` === appOrigin && parsed.host === APP_HOST
  } catch {
    return false
  }
}

function openOutside(url: string) {
  if (isExternalUrl(url)) void shell.openExternal(url)
}

export function createMainWindow(options: WindowOptions) {
  const saved = readDesktopSettings(options.settingsFile)
  const displays = screen.getAllDisplays().map((display) => display.workArea)
  const bounds = clampToDisplays(saved.bounds, displays, screen.getPrimaryDisplay().workArea)

  const window = new BrowserWindow({
    ...bounds,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    show: false,
    title: 'Ordem',
    backgroundColor: BACKGROUND_COLOR,
    ...platformChrome(),
    webPreferences: {
      preload: options.preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: true,
    },
  })

  if (saved.maximized) window.maximize()
  window.once('ready-to-show', () => window.show())

  // Links never navigate the app window away; https ones open in the browser.
  window.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url, options.appOrigin)) return
    event.preventDefault()
    openOutside(url)
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    openOutside(url)
    return { action: 'deny' }
  })

  let saveTimer: ReturnType<typeof setTimeout> | null = null
  const save = () => {
    if (window.isDestroyed()) return
    const settings: DesktopSettings = { bounds: window.getNormalBounds(), maximized: window.isMaximized() }
    writeDesktopSettings(options.settingsFile, settings)
  }
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(save, SAVE_DELAY_MS)
  }
  window.on('resize', scheduleSave)
  window.on('move', scheduleSave)
  window.on('close', () => {
    if (saveTimer) clearTimeout(saveTimer)
    save()
  })

  return window
}
