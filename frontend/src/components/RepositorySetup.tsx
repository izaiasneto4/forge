import { useState } from 'react'

import { useWorkspace } from '../workspace/context'
import { Spinner } from './Glyphs'
import { Icon } from './Icon'

// Shown until a GitHub repository is tracked: pick or paste a local checkout,
// or choose one of the checkouts already found in the repositories folder.
export function RepositorySetup() {
  const { board, actions, pending, sidebarOpen, toggleSidebar } = useWorkspace()
  const [path, setPath] = useState('')
  const reposFolder = board?.repositories.repos_folder ?? null
  const found = (board?.repositories.items ?? []).flatMap((repo) => (repo.slug ? [{ path: repo.path, slug: repo.slug }] : []))
  const busy = pending.sync

  return (
    <main className="detail">
      <div className="toolbar" style={{ borderBottomColor: 'transparent' }}>
        {!sidebarOpen ? <button type="button" className="tb-btn" onClick={toggleSidebar}><Icon name="sidebar" /></button> : null}
      </div>
      <div className="hero repo-setup">
        <div className="mark"><Icon name="folder" size={32} stroke={1.7} /></div>
        <h2>Add a repository</h2>
        <p>Pick a local clone of a GitHub repository. Ordem keeps its pull requests in sync from then on.</p>

        <button type="button" className="btn primary" disabled={busy} onClick={() => void actions.pickRepository()}>
          {busy ? <Spinner size={13} stroke={2} /> : <Icon name="folder" size={14} />}
          Choose folder…
        </button>

        <form
          className="repo-setup-path"
          onSubmit={(event) => {
            event.preventDefault()
            if (path.trim()) void actions.addRepository(path)
          }}
        >
          <input className="field" value={path} placeholder="or paste a path, like ~/code/my-app" aria-label="Repository path" onChange={(event) => setPath(event.target.value)} />
          <button type="submit" className="btn" disabled={busy || !path.trim()}>Add</button>
        </form>

        {found.length > 0 ? (
          <>
            <div className="repo-setup-found">Found in {reposFolder}</div>
            <div className="suggestions">
              {found.map((repo) => (
                <button key={repo.path} type="button" className="suggestion" disabled={busy} onClick={() => void actions.switchRepo(repo.slug)}>
                  <Icon name="github" size={14} />{repo.slug}
                </button>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </main>
  )
}
