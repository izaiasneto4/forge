import { contextBridge, ipcRenderer, webFrame } from 'electron'
import { isDesktopPlatform, type DesktopBridge, type DesktopLocalEnvironment, type DesktopUpdateState, type PickFolderOptions } from '@shared/desktop-bridge'
import { CHANNELS } from './channels'
import { isLocalEnvironment, isPickFolderResult, isUpdateState } from './guards'

// Sandboxed preload: bundled into one file that requires nothing but electron.
// Exposes window.ordemDesktop, the web app's only path to the shell.

// Room the macOS traffic lights take at the left of the hidden title bar.
const MAC_WINDOW_CONTROLS_INSET = '84px'

function readPlatform() {
  const platform: unknown = ipcRenderer.sendSync(CHANNELS.getPlatform)
  if (!isDesktopPlatform(platform)) throw new Error('Unexpected platform from the desktop shell')
  return platform
}

function readLocalEnvironment(): DesktopLocalEnvironment {
  const environment: unknown = ipcRenderer.sendSync(CHANNELS.getLocalEnvironment)
  if (!isLocalEnvironment(environment)) throw new Error('The desktop shell has no server environment')
  return environment
}

const platform = readPlatform()
let localEnvironment = readLocalEnvironment()

ipcRenderer.on(CHANNELS.localEnvironmentChanged, (_event, environment: unknown) => {
  if (isLocalEnvironment(environment)) localEnvironment = environment
})

if (platform === 'darwin') webFrame.insertCSS(`:root { --desktop-window-controls-inset: ${MAC_WINDOW_CONTROLS_INSET}; }`)

async function invokeUpdateState(channel: string): Promise<DesktopUpdateState> {
  const state: unknown = await ipcRenderer.invoke(channel)
  if (!isUpdateState(state)) throw new Error('Unexpected update state from the desktop shell')
  return state
}

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
  onUpdateState(listener: (state: DesktopUpdateState) => void) {
    const handler = (_event: Electron.IpcRendererEvent, state: unknown) => {
      if (isUpdateState(state)) listener(state)
    }
    ipcRenderer.on(CHANNELS.updateState, handler)
    return () => {
      ipcRenderer.removeListener(CHANNELS.updateState, handler)
    }
  },
  async checkForUpdates() {
    await ipcRenderer.invoke(CHANNELS.checkForUpdates)
  },
  async installUpdate() {
    await ipcRenderer.invoke(CHANNELS.installUpdate)
  },
}

contextBridge.exposeInMainWorld('ordemDesktop', bridge)
