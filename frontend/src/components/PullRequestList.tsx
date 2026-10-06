import { useEffect, useRef } from 'react'

import { EVENTS, isReviewEvent } from '../lib/agents'
import { elapsedClock, formatCount, pluralize, relativeAge, staleness } from '../lib/format'
import { isAuthoredBy, MAILBOX_LABELS, SORT_LABELS, isSortOption, type MailboxId } from '../lib/lifecycle'
import { useNow } from '../lib/useNow'
import type { PullRequestItem } from '../types/api'
import { useWorkspace } from '../workspace/context'
import { StatusGlyph } from './Glyphs'
import { Icon } from './Icon'
import { MenuButton } from './Menu'

function LiveClock({ since }: { since: string | null }) {
  const now = useNow(1000)
  return <span className="chip ghost mono" style={{ '--c': 'var(--accent)' }}>{since ? elapsedClock(since, now) : 'Starting'}</span>
}

function DiffStat({ item }: { item: PullRequestItem }) {
  if (item.additions == null || item.deletions == null) return null

  return (
    <span className="diffstat">
      <span className="a">+{formatCount(item.additions)}</span>
      <span className="d">−{formatCount(item.deletions)}</span>
    </span>
  )
}

function RowTag({ item }: { item: PullRequestItem }) {
  const task = item.review_task

  switch (item.lifecycle) {
    case 'ready':
      return task && task.pending_comment_count > 0
        ? <span className="chip" style={{ '--c': 'var(--accent)' }}>{pluralize(task.pending_comment_count, 'finding')}</span>
        : <span className="chip" style={{ '--c': 'var(--green)' }}>No findings</span>
    case 'reviewing':
      return <LiveClock since={task?.started_at ?? null} />
    case 'queued':
      return <span className="chip">Queued{task?.queue_position ? ` · ${task.queue_position}` : ''}</span>
    case 'failed':
      return <span className="chip" style={{ '--c': 'var(--red)' }}>Failed</span>
    case 'waiting':
      return item.has_new_commits
        ? <span className="chip" style={{ '--c': 'var(--purple)' }}>New commits</span>
        : <span className="chip ghost">{task ? `${task.pending_comment_count} open` : 'Waiting'}</span>
    case 'settled': {
      const event = task?.submitted_event
      return <span className="chip ghost">{isReviewEvent(event) ? EVENTS[event].past.replace(/^./, (char) => char.toUpperCase()) : 'Reviewed'}</span>
    }
    case 'authored':
      return item.draft ? <span className="chip ghost">Draft</span> : <DiffStat item={item} />
    case 'needs_review':
      return item.has_new_commits ? <span className="chip" style={{ '--c': 'var(--purple)' }}>New commits</span> : <DiffStat item={item} />
  }
}

function Row({ item, selected }: { item: PullRequestItem; selected: boolean }) {
  const { login, openPullRequest } = useWorkspace()
  const now = useNow(60_000)
  const ref = useRef<HTMLButtonElement>(null)
  const ageClass = item.lifecycle === 'needs_review' ? staleness(item.updated_at_github, now) : 'fresh'

  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  return (
    <button
      ref={ref}
      type="button"
      className={selected ? 'row on' : 'row'}
      aria-current={selected ? 'true' : undefined}
      onClick={() => openPullRequest(item.id)}
    >
      <span className="glyph"><StatusGlyph lifecycle={item.lifecycle} requested={item.review_requested_for_me} /></span>
      <span className="title">{item.title}</span>
      <span className={ageClass === 'fresh' ? 'age' : `age ${ageClass}`}>{relativeAge(item.updated_at_github, now)}</span>
      <span className="meta">
        <span>{item.repo_name} #{item.number}</span>
        <span style={{ color: 'var(--t4)' }}>·</span>
        <span className="who">{isAuthoredBy(item, login) ? 'you' : item.author}</span>
        {item.draft ? <><span style={{ color: 'var(--t4)' }}>·</span><span>draft</span></> : null}
      </span>
      <span className="tag"><RowTag item={item} /></span>
    </button>
  )
}

const EMPTY_COPY: Record<MailboxId, { title: string; body: string }> = {
  inbox: { title: 'Inbox zero', body: 'Every pull request that needs you has been handled.' },
  reviewing: { title: 'No agents running', body: 'Start a review from your inbox and it will show up here.' },
  waiting: { title: 'Nothing waiting', body: 'Pull requests you requested changes on will wait here.' },
  mine: { title: 'No open pull requests', body: 'Pull requests you open in this repository show up here.' },
  settled: { title: 'Nothing settled yet', body: 'Reviews you finish end up here.' },
}

function subtitleFor(mailbox: MailboxId, items: PullRequestItem[]) {
  switch (mailbox) {
    case 'inbox':
      return items.length ? `${items.length} need you` : 'All clear'
    case 'reviewing': {
      const running = items.filter((item) => item.lifecycle === 'reviewing').length
      return `${running} running · ${items.length - running} queued`
    }
    case 'waiting':
      return `${items.length} with authors`
    case 'mine':
      return `${items.length} open`
    case 'settled':
      return `${items.length} done`
  }
}

export function PullRequestList() {
  const {
    mailbox, sections, selected, sort, setSort, board, actions, collapsedSections, toggleSection,
    boardLoading, sidebarOpen, toggleSidebar,
  } = useWorkspace()
  const items = sections.flatMap((section) => section.items)
  const onlyRequested = board?.settings.only_requested_reviews ?? false
  const empty = EMPTY_COPY[mailbox]

  return (
    <section className="list" aria-label={MAILBOX_LABELS[mailbox]}>
      <div className="toolbar">
        {!sidebarOpen ? <button type="button" className="tb-btn" title="Show sidebar  ⌘\" onClick={toggleSidebar}><Icon name="sidebar" /></button> : null}
        <div className="ttl">
          <h2>{MAILBOX_LABELS[mailbox]}{board?.current_repo.name ? <span style={{ color: 'var(--t3)', fontWeight: 500 }}> · {board.current_repo.name}</span> : null}</h2>
          <div className="sub">{subtitleFor(mailbox, items)}</div>
        </div>
        <MenuButton
          className="tb-btn"
          title="Filter and sort"
          align="right"
          sections={[
            { title: 'Show', items: [{ key: 'only-requested', label: 'Only PRs requesting my review', checked: onlyRequested }] },
            { title: 'Sort by', items: Object.entries(SORT_LABELS).map(([key, label]) => ({ key, label, checked: sort === key })) },
          ]}
          onSelect={(key) => {
            if (key === 'only-requested') void actions.setOnlyRequested(!onlyRequested)
            else if (isSortOption(key)) setSort(key)
          }}
        >
          <Icon name="filter" />
        </MenuButton>
      </div>

      <div className="rows">
        {boardLoading ? <div className="loading-line"><Icon name="refresh" className="spin" size={14} />Loading pull requests…</div> : null}

        {!boardLoading && items.length === 0 ? (
          <div className="list-empty">
            <div className="big"><Icon name="check" size={26} stroke={2.2} /></div>
            <b>{empty.title}</b>
            <span>{empty.body}</span>
          </div>
        ) : null}

        {sections.map((section) => {
          const collapsed = collapsedSections.has(`${mailbox}:${section.id}`)

          return (
            <div key={section.id}>
              {section.label ? (
                <button
                  type="button"
                  className={collapsed ? 'section-label toggle collapsed' : 'section-label toggle'}
                  onClick={() => toggleSection(section.id)}
                  aria-expanded={!collapsed}
                >
                  <Icon name="chevDown" size={11} stroke={2.2} />
                  {section.label}
                  <span className="n">{section.items.length}</span>
                </button>
              ) : null}
              {collapsed ? null : section.items.map((item) => <Row key={item.id} item={item} selected={selected?.id === item.id} />)}
            </div>
          )
        })}
      </div>
    </section>
  )
}
