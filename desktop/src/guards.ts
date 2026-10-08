import type { DesktopBackendState, DesktopBackendStatus, DesktopLocalEnvironment, DesktopUpdateState, DesktopUpdateStatus, PickFolderOptions } from '@shared/desktop-bridge'

// IPC payloads cross a trust boundary in both directions; narrow, never cast.

const BACKEND_STATUSES: readonly DesktopBackendStatus[] = Object.freeze(['starting', 'ready', 'restarting', 'failed', 'stopped'])
const UPDATE_STATUSES: readonly DesktopUpdateStatus[] = Object.freeze(['disabled', 'idle', 'checking', 'available', 'downloading', 'ready', 'error'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

export function isLocalEnvironment(value: unknown): value is DesktopLocalEnvironment {
  return isRecord(value) && typeof value.httpBaseUrl === 'string' && typeof value.wsBaseUrl === 'string' && typeof value.token === 'string'
}

export function isUpdateStatus(value: unknown): value is DesktopUpdateStatus {
  return UPDATE_STATUSES.some((status) => status === value)
}

export function isUpdateState(value: unknown): value is DesktopUpdateState {
  return (
    isRecord(value) &&
    isUpdateStatus(value.status) &&
    typeof value.currentVersion === 'string' &&
    isNullableString(value.availableVersion) &&
    (value.downloadPercent === null || typeof value.downloadPercent === 'number') &&
    isNullableString(value.error) &&
    isNullableString(value.checkedAt)
  )
}

export function isPickFolderResult(value: unknown): value is string | null {
  return isNullableString(value)
}

export function pickFolderOptions(value: unknown): PickFolderOptions {
  if (!isRecord(value) || typeof value.initialPath !== 'string' || value.initialPath === '') return {}
  return { initialPath: value.initialPath }
}

// Only web pages leave the app; file:, javascript: and custom schemes never do.
export function isExternalUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

export function isBackendState(value: unknown): value is DesktopBackendState {
  return isRecord(value) && BACKEND_STATUSES.some((status) => status === value.status) && isNullableString(value.message)
}

// Badge counts arrive from the renderer: whole, non-negative and sane.
export function badgeCount(value: unknown) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return 0
  return Math.min(value, 9999)
}
