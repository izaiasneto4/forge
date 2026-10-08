import { vi } from 'vitest'
import type { DesktopBridge, DesktopLocalEnvironment, DesktopUpdateState } from '@shared/desktop-bridge'

export const fakeLocalEnvironment: DesktopLocalEnvironment = Object.freeze({
  httpBaseUrl: 'http://127.0.0.1:51234',
  wsBaseUrl: 'ws://127.0.0.1:51234',
  token: 'desktop-test-token',
})

export const fakeUpdateState: DesktopUpdateState = Object.freeze({
  status: 'idle',
  currentVersion: '1.0.0',
  availableVersion: null,
  downloadPercent: null,
  error: null,
  checkedAt: null,
})

// A bridge like the preload's, with spies for every method.
export function buildDesktopBridge(overrides: Partial<DesktopBridge> = {}): DesktopBridge {
  return {
    platform: 'darwin',
    getLocalEnvironment: () => fakeLocalEnvironment,
    pickFolder: vi.fn(async () => null),
    openExternal: vi.fn(async () => {}),
    getUpdateState: vi.fn(async () => fakeUpdateState),
    onUpdateState: vi.fn(() => () => {}),
    checkForUpdates: vi.fn(async () => {}),
    installUpdate: vi.fn(async () => {}),
    onBackendState: vi.fn(() => () => {}),
    setBadgeCount: vi.fn(),
    ...overrides,
  }
}

export function installDesktopBridge(bridge: DesktopBridge = buildDesktopBridge()) {
  window.ordemDesktop = bridge
  return bridge
}

export function removeDesktopBridge() {
  delete window.ordemDesktop
}
