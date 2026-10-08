import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '../lib/api'
import { queryKeys } from '../lib/queryKeys'
import { ToastProvider } from '../lib/toasts'
import type { DesktopUpdateState } from '@shared/desktop-bridge'
import { buildDesktopBridge, fakeUpdateState, installDesktopBridge, removeDesktopBridge } from '../test/desktopBridge'
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

describe('SettingsSheet about and updates', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    removeDesktopBridge()
  })

  function renderGeneralTab() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
    client.setQueryData(queryKeys.pullRequestBoard, buildBoard({}))
    client.setQueryData(queryKeys.settings, settings)
    vi.spyOn(api, 'get').mockImplementation(() => new Promise<never>(() => {}))
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <MemoryRouter>
            <WorkspaceProvider>
              <SettingsSheet tab="general" />
            </WorkspaceProvider>
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    )
  }

  it('hides the About group in a browser', () => {
    renderGeneralTab()

    expect(screen.queryByText('About')).toBeNull()
  })

  it('shows the version and checks for updates through the bridge', async () => {
    const checkForUpdates = vi.fn(async () => {})
    installDesktopBridge(buildDesktopBridge({ checkForUpdates }))
    renderGeneralTab()

    const checkButton = await screen.findByRole('button', { name: 'Check now' })
    await act(async () => fireEvent.click(checkButton))

    expect(screen.getByText(fakeUpdateState.currentVersion)).toBeDefined()
    expect(checkForUpdates).toHaveBeenCalled()
  })

  it('offers a restart once an update is ready and follows pushed states', async () => {
    const installUpdate = vi.fn(async () => {})
    const availableVersion = '2.0.0'
    let push: (state: DesktopUpdateState) => void = () => {}
    installDesktopBridge(buildDesktopBridge({ installUpdate, onUpdateState: (listener) => { push = listener; return () => {} } }))
    renderGeneralTab()
    await screen.findByRole('button', { name: 'Check now' })

    await act(async () => push({ ...fakeUpdateState, status: 'ready', availableVersion }))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Restart to update' })))

    expect(screen.getByText(`Version ${availableVersion} is ready to install`)).toBeDefined()
    expect(installUpdate).toHaveBeenCalled()
  })
})
