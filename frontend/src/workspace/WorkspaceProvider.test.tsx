import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api, ApiResponseError } from '../lib/api'
import { queryKeys } from '../lib/queryKeys'
import { useToasts } from '../lib/toastContext'
import { ToastProvider } from '../lib/toasts'
import { handleUiEvent } from '../lib/uiEvents'
import { buildBoard } from '../test/factories'
import { useWorkspace } from './context'
import { WorkspaceProvider } from './WorkspaceProvider'

function renderWorkspace() {
  const board = buildBoard({})
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(queryKeys.pullRequestBoard, board)
  vi.spyOn(api, 'get').mockImplementation(() => new Promise<never>(() => {}))

  function wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={client}>
        <ToastProvider>
          <MemoryRouter>
            <WorkspaceProvider>{children}</WorkspaceProvider>
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>
    )
  }

  const hook = renderHook(() => ({ workspace: useWorkspace(), toasts: useToasts() }), { wrapper })
  return { ...hook, client }
}

describe('sync error notifications', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it.each(['before', 'after'])('shows one toast when realtime arrives %s the add-repository response', async (order) => {
    const path = '/code/api'
    const reason = 'gh is not authenticated'
    const message = `Added repo but sync failed: ${reason}`
    const error = new ApiResponseError({ code: 'sync_failed', message }, 422)
    const event = { event: 'sync.failed', error: reason }
    const { result, client } = renderWorkspace()
    const notify = () => handleUiEvent(event, client, result.current.toasts.pushToast)
    vi.spyOn(api, 'post').mockImplementation(async () => {
      if (order === 'before') notify()
      throw error
    })

    await act(async () => {
      await result.current.workspace.actions.addRepository(path)
      if (order === 'after') notify()
    })

    expect(document.querySelectorAll('.notif')).toHaveLength(1)
    expect(document.querySelector('.notif b')?.textContent).toBe('Sync failed')
    expect(document.querySelector('.notif p')?.textContent).toBe(order === 'before' ? message : reason)
  })

  it('reports a forced sync failure without needing realtime delivery', async () => {
    const force = true
    const message = 'gh is not authenticated'
    const error = new ApiResponseError({ code: 'sync_failed', message }, 422)
    const { result } = renderWorkspace()
    const post = vi.spyOn(api, 'post').mockRejectedValue(error)

    await act(async () => result.current.workspace.actions.sync(force))

    expect(post).toHaveBeenCalledWith('/api/v1/pull_requests/sync', { force })
    expect(document.querySelectorAll('.notif')).toHaveLength(1)
    expect(document.querySelector('.notif b')?.textContent).toBe('Sync failed')
    expect(document.querySelector('.notif p')?.textContent).toBe(message)
  })

  it('keeps validation errors separate from sync notifications', async () => {
    const path = '/missing'
    const message = `${path} is not a folder`
    const error = new ApiResponseError({ code: 'invalid_input', message }, 422)
    const { result } = renderWorkspace()
    vi.spyOn(api, 'post').mockRejectedValue(error)

    await act(async () => result.current.workspace.actions.addRepository(path))

    expect(document.querySelector('.notif b')?.textContent).toBe('Something went wrong')
    expect(document.querySelector('.notif p')?.textContent).toBe(message)
  })
})
