import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { LIFECYCLE_LABELS } from '../lib/lifecycle'
import { useWorkspace } from '../workspace/context'
import { StatusGlyph } from './Glyphs'
import { Icon, type IconName } from './Icon'

type PaletteEntry = {
  id: string
  group: 'Pull requests' | 'Actions'
  label: string
  hint?: string
  icon: ReactNode
  keywords: string
  run: () => void
}

function ActionIcon({ name }: { name: IconName }) {
  return <span className="ic"><Icon name={name} size={13} /></span>
}

export function CommandPalette() {
  const workspace = useWorkspace()
  const { items, board, setPaletteOpen, openPullRequest, openNew, actions, toggleInspector, openSettings, requestedCount, goToMailbox } = workspace
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => inputRef.current?.focus(), [])

  const entries = useMemo(() => {
    const close = (run: () => void) => () => {
      setPaletteOpen(false)
      run()
    }

    const pullRequests: PaletteEntry[] = items.map((item) => ({
      id: `pr:${item.id}`,
      group: 'Pull requests',
      label: item.title,
      hint: `${item.repo_name} #${item.number}`,
      icon: <span className="ic" style={{ background: 'none' }}><StatusGlyph lifecycle={item.lifecycle} requested={item.review_requested_for_me} /></span>,
      keywords: `${item.title} ${item.number} #${item.number} ${item.author ?? ''} ${item.repo_full_name} ${LIFECYCLE_LABELS[item.lifecycle]}`.toLowerCase(),
      run: close(() => openPullRequest(item.id)),
    }))

    const action = (id: string, label: string, icon: IconName, run: () => void, hint?: string): PaletteEntry => ({
      id: `action:${id}`,
      group: 'Actions',
      label,
      hint,
      icon: <ActionIcon name={icon} />,
      keywords: label.toLowerCase(),
      run: close(run),
    })

    const repositoryActions = (board?.repositories.items ?? [])
      .filter((repo) => repo.slug && !repo.current)
      .map((repo) => action(`repo:${repo.path}`, `Switch to ${repo.slug}`, 'folder', () => void actions.switchRepo(repo.slug ?? '')))

    const actionEntries: PaletteEntry[] = [
      action('new', 'New review', 'compose', openNew, 'N'),
      action('sync', 'Sync with GitHub', 'refresh', () => void actions.sync(true)),
      ...(requestedCount > 0 ? [action('review-all', requestedCount === 1 ? 'Review the PR requested from you' : `Review all ${requestedCount} requested from you`, 'layers', () => void actions.reviewAllRequested())] : []),
      action('inbox', 'Go to Inbox', 'inbox', () => goToMailbox('inbox')),
      action('reviewing', 'Go to Reviewing', 'sparkles', () => goToMailbox('reviewing')),
      action('inspector', 'Toggle inspector', 'inspector', toggleInspector, 'I'),
      action('settings', 'Settings…', 'gear', () => openSettings(), '⌘,'),
      ...repositoryActions,
    ]

    return [...pullRequests, ...actionEntries]
  }, [items, board, setPaletteOpen, openPullRequest, openNew, actions, toggleInspector, openSettings, requestedCount, goToMailbox])

  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const results = entries.filter((entry) => terms.every((term) => entry.keywords.includes(term)))
  const visible = [
    ...results.filter((entry) => entry.group === 'Pull requests').slice(0, terms.length ? 8 : 5),
    ...results.filter((entry) => entry.group === 'Actions'),
  ]
  const active = Math.min(highlight, Math.max(visible.length - 1, 0))

  useEffect(() => {
    listRef.current?.querySelector('.it.hl')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  return (
    <>
      <div className="scrim" onClick={() => setPaletteOpen(false)} />
      <div className="palette" role="dialog" aria-label="Command palette">
        <div className="q">
          <Icon name="search" size={18} />
          <input
            ref={inputRef}
            value={query}
            placeholder="Search pull requests or actions…"
            aria-label="Search"
            onChange={(event) => {
              setQuery(event.target.value)
              setHighlight(0)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                setPaletteOpen(false)
              } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                const step = event.key === 'ArrowDown' ? 1 : -1
                setHighlight((active + step + visible.length) % Math.max(visible.length, 1))
              } else if (event.key === 'Enter') {
                event.preventDefault()
                visible[active]?.run()
              }
            }}
          />
        </div>
        <div className="res" ref={listRef}>
          {visible.length === 0 ? <div className="grp" style={{ padding: 16 }}>No results</div> : null}
          {visible.map((entry, index) => (
            <div key={entry.id}>
              {index === 0 || visible[index - 1].group !== entry.group ? <div className="grp">{entry.group}</div> : null}
              <button type="button" className={index === active ? 'it hl' : 'it'} onMouseMove={() => setHighlight(index)} onClick={entry.run}>
                {entry.icon}
                <span className="t">{entry.label}</span>
                {entry.hint ? <span className="s">{entry.group === 'Actions' ? <kbd>{entry.hint}</kbd> : entry.hint}</span> : null}
              </button>
            </div>
          ))}
        </div>
        <div className="foot"><span><kbd>↑↓</kbd> navigate</span><span><kbd>↵</kbd> open</span><span><kbd>esc</kbd> close</span></div>
      </div>
    </>
  )
}
