import type { DesktopBridge } from '@shared/desktop-bridge'

// The desktop shell's preload sets window.ordemDesktop. In a browser it is
// absent and every helper here falls back to same-origin behaviour.

export function desktopBridge(): DesktopBridge | undefined {
  return typeof window === 'undefined' ? undefined : window.ordemDesktop
}

export function isDesktop() {
  return desktopBridge() !== undefined
}

// Prefix for API paths: empty in a browser (same origin), the sidecar's URL on desktop.
export function apiBase() {
  return desktopBridge()?.getLocalEnvironment().httpBaseUrl ?? ''
}

export function authHeaders(): Record<string, string> {
  const bridge = desktopBridge()
  if (!bridge) return {}
  return { Authorization: `Bearer ${bridge.getLocalEnvironment().token}` }
}

export function wsUrl() {
  const bridge = desktopBridge()
  if (bridge) {
    const { wsBaseUrl, token } = bridge.getLocalEnvironment()
    return `${wsBaseUrl}/ws?token=${encodeURIComponent(token)}`
  }

  if (typeof window === 'undefined') return 'ws://localhost:3000/ws'

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/ws`
}

// Lets CSS adapt the window chrome per platform (traffic lights on macOS).
export function applyDesktopPlatform(root: HTMLElement = document.documentElement) {
  const bridge = desktopBridge()
  if (bridge) root.dataset.platform = bridge.platform
}
