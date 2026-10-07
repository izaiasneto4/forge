import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AgentLogItem } from '../types/api'
import { useLiveLogs } from './useTaskDetail'

const handlers: Array<(data: unknown) => void> = []

vi.mock('../lib/cable', () => ({
  subscribe: (_params: unknown, callbacks: { received: (data: unknown) => void }) => {
    handlers.push(callbacks.received)
    return () => {}
  },
}))

function wrapper({ children }: PropsWithChildren) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
}

describe('useLiveLogs', () => {
  afterEach(() => {
    cleanup()
    handlers.length = 0
  })

  it('drops lines streamed for a previous run when the next run goes live', () => {
    const taskId = 7
    const noLogs: AgentLogItem[] = []
    const previousRunLine = { id: 101, message: 'Reading the old diff', log_type: 'output', created_at: '2026-10-07T10:00:00Z' }

    const { result, rerender } = renderHook(({ live }) => useLiveLogs(taskId, noLogs, live), { wrapper, initialProps: { live: true } })
    act(() => handlers.at(-1)?.(previousRunLine))
    expect(result.current.map((log) => log.id)).toEqual([previousRunLine.id])

    rerender({ live: false })
    expect(result.current.map((log) => log.id)).toEqual([previousRunLine.id])

    rerender({ live: true })
    expect(result.current).toEqual(noLogs)
  })
})
