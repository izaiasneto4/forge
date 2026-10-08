// The contract between the desktop shell's preload and the web app. No imports,
// so the frontend and the sandboxed Electron preload can both bundle it.
// The web app detects desktop by the presence of `window.ordemDesktop`, nothing else.

export type DesktopPlatform = 'darwin' | 'linux' | 'win32'

export const DESKTOP_PLATFORMS: readonly DesktopPlatform[] = Object.freeze(['darwin', 'linux', 'win32'])

export function isDesktopPlatform(value: unknown): value is DesktopPlatform {
  return DESKTOP_PLATFORMS.some((platform) => platform === value)
}

// Where the renderer reaches the server the shell started for it.
export interface DesktopLocalEnvironment {
  httpBaseUrl: string
  wsBaseUrl: string
  token: string
}

export type DesktopUpdateStatus = 'disabled' | 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error'

export interface DesktopUpdateState {
  status: DesktopUpdateStatus
  currentVersion: string
  availableVersion: string | null
  downloadPercent: number | null
  error: string | null
  checkedAt: string | null
}

export interface PickFolderOptions {
  initialPath?: string
}

export interface DesktopBridge {
  platform: DesktopPlatform
  getLocalEnvironment(): DesktopLocalEnvironment
  pickFolder(options?: PickFolderOptions): Promise<string | null>
  openExternal(url: string): Promise<void>
  getUpdateState(): Promise<DesktopUpdateState>
  onUpdateState(listener: (state: DesktopUpdateState) => void): () => void
  checkForUpdates(): Promise<void>
  installUpdate(): Promise<void>
}
