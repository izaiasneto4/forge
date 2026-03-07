import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { RepoSwitcher } from './RepoSwitcher'

describe('RepoSwitcher', () => {
  it('offers settings navigation when no repos folder is configured', () => {
    const onOpenSettings = vi.fn()

    render(
      <RepoSwitcher
        currentRepoName={null}
        menuOpen
        repositories={{
          repos_folder: null,
          current_repo_path: null,
          current_repo_slug: null,
          items: [],
        }}
        onToggle={() => {}}
        onSelectRepo={() => {}}
        onOpenSettings={onOpenSettings}
        onOpenRepositories={() => {}}
      />,
    )

    expect(screen.getByText(/Configure a repositories root folder/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open Settings' }))
    expect(onOpenSettings).toHaveBeenCalledOnce()
  })

  it('offers repositories navigation when scan returns no items', () => {
    const onOpenRepositories = vi.fn()

    render(
      <RepoSwitcher
        currentRepoName={null}
        menuOpen
        repositories={{
          repos_folder: '/tmp/repos',
          current_repo_path: null,
          current_repo_slug: null,
          items: [],
        }}
        onToggle={() => {}}
        onSelectRepo={() => {}}
        onOpenSettings={() => {}}
        onOpenRepositories={onOpenRepositories}
      />,
    )

    expect(screen.getByText(/No repositories were found/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open Repositories' }))
    expect(onOpenRepositories).toHaveBeenCalledOnce()
  })
})
