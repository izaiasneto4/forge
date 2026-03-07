import type { RepositoryListResponse } from '../types/api'

export function RepoSwitcher({
  currentRepoName,
  menuOpen,
  repositories,
  onToggle,
  onSelectRepo,
  onOpenSettings,
  onOpenRepositories,
}: {
  currentRepoName: string | null
  menuOpen: boolean
  repositories: RepositoryListResponse
  onToggle: () => void
  onSelectRepo: (slug: string) => void
  onOpenSettings: () => void
  onOpenRepositories: () => void
}) {
  return (
    <div className="relative">
      <button type="button" className="linear-btn linear-btn-secondary" onClick={onToggle}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        {currentRepoName ?? 'Select repo'}
      </button>
      {menuOpen ? (
        <div className="linear-dropdown absolute left-0 top-full mt-1 w-72 z-50">
          {repositories.items.length > 0 ? (
            repositories.items.map((repo) => (
              <button key={repo.path} type="button" className="linear-dropdown-item w-full text-left" onClick={() => repo.slug && onSelectRepo(repo.slug)}>
                <span className="flex-1">{repo.name}</span>
                {repo.current ? <span className="linear-badge linear-badge-blue">Current</span> : null}
              </button>
            ))
          ) : repositories.repos_folder ? (
            <div className="px-3 py-3 space-y-2">
              <p className="text-xs text-[color:var(--color-text-secondary)]">No repositories were found in the configured root folder.</p>
              <button type="button" className="linear-btn linear-btn-secondary linear-btn-sm w-full justify-center" onClick={onOpenRepositories}>
                Open Repositories
              </button>
            </div>
          ) : (
            <div className="px-3 py-3 space-y-2">
              <p className="text-xs text-[color:var(--color-text-secondary)]">Configure a repositories root folder before selecting a repo.</p>
              <button type="button" className="linear-btn linear-btn-secondary linear-btn-sm w-full justify-center" onClick={onOpenSettings}>
                Open Settings
              </button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
