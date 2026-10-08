import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, renderHook, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DesktopBackendState } from '@shared/desktop-bridge'

import { buildDesktopBridge, installDesktopBridge, removeDesktopBridge } from '../test/desktopBridge'
import { useDesktopBadge } from '../lib/desktopStatus'
import { ServerStatus } from './ServerStatus'

function renderStatus() {
  const client = new QueryClient()
  const invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue(undefined)
  render(
    <QueryClientProvider client={client}>
      <ServerStatus />
    </QueryClientProvider>,
  )
  return { invalidate }
}

describe('ServerStatus', () => {
  afterEach(() => {
    cleanup()
    removeDesktopBridge()
  })

  it('renders nothing in a browser', () => {
    renderStatus()

    expect(screen.queryByRole('status')).toBeNull()
  })

  it('shows a reconnecting banner while the server restarts, then refetches', async () => {
    let push: (state: DesktopBackendState) => void = () => {}
    installDesktopBridge(buildDesktopBridge({ onBackendState: (listener) => { push = listener; return () => {} } }))
    const { invalidate } = renderStatus()

    await act(async () => push({ status: 'restarting', message: null }))
    const banner = screen.getByRole('status').textContent
    await act(async () => push({ status: 'ready', message: null }))

    expect(banner).toContain('Reconnecting')
    expect(screen.queryByRole('status')).toBeNull()
    expect(invalidate).toHaveBeenCalled()
  })
})

describe('useDesktopBadge', () => {
  afterEach(() => removeDesktopBridge())

  it('sends the inbox count to the dock badge', () => {
    const setBadgeCount = vi.fn()
    const inboxCount = 4
    installDesktopBridge(buildDesktopBridge({ setBadgeCount }))

    renderHook(() => useDesktopBadge(inboxCount))

    expect(setBadgeCount).toHaveBeenCalledWith(inboxCount)
  })
})
