import { relativeAgo } from '../lib/format'
import { MAILBOX_IDS, MAILBOX_LABELS, type MailboxId } from '../lib/lifecycle'
import { useWorkspace } from '../workspace/context'
import { Spinner } from './Glyphs'
import { Icon, type IconName } from './Icon'

const MAILBOX_ICONS: Record<MailboxId, IconName> = {
  inbox: 'inbox',
  reviewing: 'sparkles',
  waiting: 'hourglass',
  mine: 'user',
  settled: 'checkCircle',
}

function SyncChip() {
  const { board, pending, actions } = useWorkspace()
  const status = board?.sync_status
  const running = pending.sync || status?.running
  const failed = Boolean(status?.last_error) && !running

  let label = 'Not synced yet'
  if (running) label = 'Syncing…'
  else if (failed) label = 'Sync failed'
  else if (status?.last_synced_at) label = `Synced ${relativeAgo(status.last_synced_at)}`

  return (
    <button
      type="button"
      className={failed ? 'sync-chip err' : 'sync-chip'}
      title={failed ? status?.last_error ?? undefined : 'Sync with GitHub'}
      onClick={() => void actions.sync(true)}
      disabled={Boolean(running)}
    >
      {running ? <Spinner size={12} stroke={2} /> : <span className={failed ? 'dot err' : 'dot'} />}
      <span>{label}</span>
    </button>
  )
}

export function Sidebar() {
  const { board, counts, mailbox, route, anyReviewing, goToMailbox, setPaletteOpen, openSettings, toggleSidebar, openNew, actions } = useWorkspace()
  const repositories = (board?.repositories.items ?? []).filter((repo) => repo.slug)
  const currentRepo = board?.current_repo

  return (
    <aside className="sidebar">
      <div className="titlebar">
        <div className="brand">
          <span className="brand-mark"><Icon name="flame" size={14} stroke={2} /></span>
          <span>Forge</span>
        </div>
        <button type="button" className="tb-btn" title="Hide sidebar  ⌘\" onClick={toggleSidebar}><Icon name="sidebar" /></button>
        <button type="button" className={route.kind === 'new' ? 'tb-btn on' : 'tb-btn'} title="New review  N" onClick={openNew}><Icon name="compose" /></button>
      </div>

      <div className="sb-scroll">
        <button type="button" className="sb-search" onClick={() => setPaletteOpen(true)}>
          <Icon name="search" size={14} />
          <span>Search</span>
          <kbd>⌘K</kbd>
        </button>

        {MAILBOX_IDS.map((id) => {
          const count = counts[id]
          const active = route.kind === 'mailbox' && mailbox === id
          const dim = id === 'settled'

          return (
            <button
              key={id}
              type="button"
              className={['sb-item', dim && 'dim', active && 'on'].filter(Boolean).join(' ')}
              onClick={() => goToMailbox(id)}
            >
              <Icon name={MAILBOX_ICONS[id]} />
              <span className="label">{MAILBOX_LABELS[id]}</span>
              <span className={id === 'inbox' && count > 0 ? 'count hot' : 'count'}>
                {id === 'reviewing' && anyReviewing ? <Spinner size={12} stroke={2} /> : null}
                {count || ''}
              </span>
            </button>
          )
        })}

        <div className="sb-head">
          <span>Repositories</span>
          <button type="button" title="Repository settings" onClick={() => openSettings('repositories')}><Icon name="plus" size={14} /></button>
        </div>

        {repositories.length === 0 ? <div className="sb-empty">Choose a repositories folder in Settings.</div> : null}

        {repositories.map((repo) => {
          const current = repo.path === currentRepo?.path || repo.current

          return (
            <button
              key={repo.path}
              type="button"
              className={current ? 'sb-item on' : 'sb-item'}
              title={current ? repo.path : `Switch to ${repo.slug}`}
              onClick={() => {
                if (!current && repo.slug) void actions.switchRepo(repo.slug)
              }}
            >
              <span className="repo-dot" style={{ background: current ? 'var(--accent)' : 'var(--t4)' }} />
              <span className="label">{repo.name}</span>
              {repo.branch ? <span className="sb-repo-branch">{repo.branch}</span> : null}
            </button>
          )
        })}
      </div>

      <div className="sb-foot">
        <SyncChip />
        <button type="button" className="tb-btn" title="Settings  ⌘," onClick={() => openSettings()}><Icon name="gear" size={15} /></button>
      </div>
    </aside>
  )
}
