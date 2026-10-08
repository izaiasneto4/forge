import { useEffect } from 'react'
import type { DesktopBackendState } from '@shared/desktop-bridge'

import { desktopBridge } from './desktop'

export function serverStatusMessage(state: DesktopBackendState) {
  if (state.status === 'restarting' || state.status === 'starting') return 'Reconnecting to the Ordem server…'
  if (state.status === 'failed') return 'The Ordem server stopped. Quit and reopen Ordem.'
  return null
}

// Mirrors the Inbox count onto the dock (macOS) or launcher (Linux) badge.
export function useDesktopBadge(count: number) {
  useEffect(() => {
    desktopBridge()?.setBadgeCount(count)
  }, [count])
}
