import { contextBridge, ipcRenderer, webFrame } from 'electron'
import { isDesktopPlatform, type DesktopBackendState, type DesktopBridge, type DesktopLocalEnvironment, type DesktopUpdateState, type PickFolderOptions } from '@shared/desktop-bridge'
import { CHANNELS } from './channels'
import { isBackendState, isLocalEnvironment, isPickFolderResult, isUpdateState } from './guards'

// Sandboxed preload: bundled into one file that requires nothing but electron.
// Exposes window.ordemDesktop, the web app's only path to the shell.

// Room the macOS traffic lights take at the left of the hidden title bar.
const MAC_WINDOW_CONTROLS_INSET = '84px'

function subscribe<Payload>(channel: string, guard: (value: unknown) => value is Payload, listener: (payload: Payload) => void) {
  const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => {
    if (guard(payload)) listener(payload)
  }
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

async function invokeUpdateState(channel: string): Promise<DesktopUpdateState> {
  const state: unknown = await ipcRenderer.invoke(channel)
  if (!isUpdateState(state)) throw new Error('Unexpected update state from the desktop shell')
  return state
}

function exposeBridge(platform: DesktopBridge['platform'], environment: DesktopLocalEnvironment) {
  let localEnvironment = environment
  subscribe(CHANNELS.localEnvironmentChanged, isLocalEnvironment, (changed) => {
    localEnvironment = changed
  })

  if (platform === 'darwin') webFrame.insertCSS(`:root { --desktop-window-controls-inset: ${MAC_WINDOW_CONTROLS_INSET}; }`)

  const bridge: DesktopBridge = {
    platform,
    getLocalEnvironment: () => ({ ...localEnvironment }),
    async pickFolder(options?: PickFolderOptions) {
      const picked: unknown = await ipcRenderer.invoke(CHANNELS.pickFolder, options ?? {})
      return isPickFolderResult(picked) ? picked : null
    },
    async openExternal(url: string) {
      await ipcRenderer.invoke(CHANNELS.openExternal, url)
    },
    getUpdateState: () => invokeUpdateState(CHANNELS.getUpdateState),
    onUpdateState: (listener: (state: DesktopUpdateState) => void) => subscribe(CHANNELS.updateState, isUpdateState, listener),
    async checkForUpdates() {
      await ipcRenderer.invoke(CHANNELS.checkForUpdates)
    },
    async installUpdate() {
      await ipcRenderer.invoke(CHANNELS.installUpdate)
    },
    onBackendState: (listener: (state: DesktopBackendState) => void) => subscribe(CHANNELS.backendState, isBackendState, listener),
    setBadgeCount(count: number) {
      ipcRenderer.send(CHANNELS.setBadgeCount, count)
    },
  }

  contextBridge.exposeInMainWorld('ordemDesktop', bridge)
}

// The main process answers only the app's own page (not the starting screen),
// so anywhere else both are null and no bridge is exposed.
const platform: unknown = ipcRenderer.sendSync(CHANNELS.getPlatform)
const initialEnvironment: unknown = ipcRenderer.sendSync(CHANNELS.getLocalEnvironment)
if (isDesktopPlatform(platform) && isLocalEnvironment(initialEnvironment)) exposeBridge(platform, initialEnvironment)
