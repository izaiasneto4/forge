import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import type { DesktopLocalEnvironment, DesktopPlatform } from '@shared/desktop-bridge'
import { CHANNELS } from './channels'
import { badgeCount, isExternalUrl, pickFolderOptions } from './guards'
import type { Updater } from './updater'

// Handlers behind the preload bridge. Each checks the caller is the app's own
// page, and every argument is narrowed before use.

export interface IpcOptions {
  appOrigin: string
  platform: DesktopPlatform
  environment: () => DesktopLocalEnvironment | null
  updater: Updater
}

function fromApp(event: IpcMainEvent | IpcMainInvokeEvent, appOrigin: string) {
  const url = event.senderFrame?.url
  if (!url) return false
  try {
    const parsed = new URL(url)
    return `${parsed.protocol}//${parsed.host}` === appOrigin
  } catch {
    return false
  }
}

export function registerIpc(options: IpcOptions) {
  const guardedHandle = (channel: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      if (!fromApp(event, options.appOrigin)) throw new Error('Blocked IPC from an unexpected origin')
      return handler(event, ...args)
    })
  }

  ipcMain.on(CHANNELS.getPlatform, (event) => {
    event.returnValue = fromApp(event, options.appOrigin) ? options.platform : null
  })
  ipcMain.on(CHANNELS.getLocalEnvironment, (event) => {
    event.returnValue = fromApp(event, options.appOrigin) ? options.environment() : null
  })
  // Linux shows it only under Unity-style launchers; Windows ignores it.
  ipcMain.on(CHANNELS.setBadgeCount, (event, count: unknown) => {
    if (fromApp(event, options.appOrigin)) app.setBadgeCount(badgeCount(count))
  })

  guardedHandle(CHANNELS.pickFolder, async (event, rawOptions) => {
    const { initialPath } = pickFolderOptions(rawOptions)
    const owner = BrowserWindow.fromWebContents(event.sender)
    const dialogOptions: Electron.OpenDialogOptions = {
      title: 'Choose your repositories folder',
      buttonLabel: 'Choose',
      properties: ['openDirectory', 'createDirectory'],
      ...(initialPath ? { defaultPath: initialPath } : {}),
    }
    const result = owner ? await dialog.showOpenDialog(owner, dialogOptions) : await dialog.showOpenDialog(dialogOptions)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  guardedHandle(CHANNELS.openExternal, async (_event, url) => {
    if (!isExternalUrl(url)) throw new Error('Only https links open outside the app')
    await shell.openExternal(url)
  })

  guardedHandle(CHANNELS.getUpdateState, () => options.updater.current)
  guardedHandle(CHANNELS.checkForUpdates, () => options.updater.check())
  guardedHandle(CHANNELS.installUpdate, () => options.updater.install())
}

export function broadcast(channel: string, payload: unknown) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }
}
