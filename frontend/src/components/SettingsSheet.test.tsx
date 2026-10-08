import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '../lib/api'
import { queryKeys } from '../lib/queryKeys'
import { ToastProvider } from '../lib/toasts'
import { buildDesktopBridge, installDesktopBridge, removeDesktopBridge } from '../test/desktopBridge'
import { buildBoard } from '../test/factories'
import type { RepositoryListResponse, SettingsResponse } from '../types/api'
import { WorkspaceProvider } from '../workspace/WorkspaceProvider'
import { SettingsSheet } from './SettingsSheet'

const currentFolder = '/Users/dev/code'
const pickedFolder = '/Users/dev/work'

const settings: SettingsResponse = {
  repos_folder: currentFolder,
  current_repo: { path: null, slug: null, name: null },
  default_cli_client: 'claude',
  auto_submit_enabled: false,
  theme_preference: null,
  cli_clients: ['claude'],
  valid_theme_preferences: ['light', 'dark'],
}

const repositories: RepositoryListResponse = { repos_folder: currentFolder, current_repo_path: null, current_repo_slug: null, items: [] }

function renderRepositoriesTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  client.setQueryData(queryKeys.pullRequestBoard, buildBoard({}))
  client.setQueryData(queryKeys.settings, settings)
  client.setQueryData(queryKeys.repositories, repositories)
  vi.spyOn(api, 'get').mockImplementation(() => new Promise<never>(() => {}))
  const patch = vi.spyOn(api, 'patch').mockResolvedValue({ status: 'ok' })

  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>
          <WorkspaceProvider>
            <SettingsSheet tab="repositories" />
          </WorkspaceProvider>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
  return { patch }
}

describe('SettingsSheet folder picker', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    removeDesktopBridge()
  })

  it('asks the server to pick a folder in a browser', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ path: pickedFolder })
    const { patch } = renderRepositoriesTab()

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Choose…' })))

    expect(post).toHaveBeenCalledWith('/api/v1/settings/pick_folder')
    expect(patch).toHaveBeenCalledWith('/api/v1/settings', expect.objectContaining({ repos_folder: pickedFolder }))
  })

  it('opens the native dialog through the desktop bridge', async () => {
    const pickFolder = vi.fn(async () => pickedFolder)
    installDesktopBridge(buildDesktopBridge({ pickFolder }))
    const post = vi.spyOn(api, 'post')
    const { patch } = renderRepositoriesTab()

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Choose…' })))

    expect(pickFolder).toHaveBeenCalledWith({ initialPath: currentFolder })
    expect(post).not.toHaveBeenCalled()
    expect(patch).toHaveBeenCalledWith('/api/v1/settings', expect.objectContaining({ repos_folder: pickedFolder }))
  })

  it('keeps the folder when the native dialog is cancelled', async () => {
    const pickFolder = vi.fn(async () => null)
    installDesktopBridge(buildDesktopBridge({ pickFolder }))
    const { patch } = renderRepositoriesTab()

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Choose…' })))

    expect(pickFolder).toHaveBeenCalled()
    expect(patch).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Repositories folder')).toHaveProperty('value', currentFolder)
  })
})
