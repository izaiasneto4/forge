import { useEffect, type ReactNode } from 'react'

import { agentLabel, DEPTHS, EVENTS, isReviewEvent } from '../lib/agents'
import { elapsedClock, formatCount, pluralize, relativeAgo } from '../lib/format'
import {
  groupBySeverity,
  isAuthoredBy,
  LIFECYCLE_LABELS,
  pendingComments,
  SEVERITY_LABELS,
  severityCounts,
  suggestedEvent,
} from '../lib/lifecycle'
import { useNow } from '../lib/useNow'
import type {
  AgentLogItem,
  ParsedReviewItem,
  PullRequestItem,
  ReviewCommentItem,
  ReviewTaskDetailResponse,
} from '../types/api'
import { useWorkspace } from '../workspace/context'
import { useLiveLogs, useTaskDetail } from '../workspace/useTaskDetail'
import { Composer } from './Composer'
import { AgentIcon, Avatar, CheckBadge, Spinner, StatusGlyph } from './Glyphs'
import { Icon, type IconName } from './Icon'
import { MenuButton, type MenuItem } from './Menu'

const SEVERITY_COLORS: Record<ReviewCommentItem['severity'], string> = {
  critical: 'var(--red)',
  major: 'var(--orange)',
  minor: 'var(--t3)',
  suggestion: 'var(--t3)',
  nitpick: 'var(--t4)',
}

function SeverityChip({ severity, children }: { severity: ReviewCommentItem['severity']; children: ReactNode }) {
  return <span className="chip"><i className="dot" style={{ '--c': SEVERITY_COLORS[severity] }} />{children}</span>
}

const RUN_STEPS = ['Prepare worktree', 'Run the review', 'Write findings']

function InlineCode({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g)
  return <>{parts.map((part, index) => (part.startsWith('`') && part.endsWith('`') && part.length > 2 ? <code key={index}>{part.slice(1, -1)}</code> : part))}</>
}

function Html({ html, className = 'md' }: { html: string | null; className?: string }) {
  if (!html) return null
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />
}

function Block({ title, aside, children, delay = 0 }: { title: string; aside?: ReactNode; children: ReactNode; delay?: number }) {
  return (
    <div className="block" style={{ '--d': delay }}>
      <div className="block-head"><h3>{title}</h3>{aside ? <span className="aside">{aside}</span> : null}</div>
      {children}
    </div>
  )
}

function Callout({ icon, color, title, children, actions }: { icon: IconName; color?: string; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="card callout" style={color ? { '--c': color } : undefined}>
      <div className="ico"><Icon name={icon} size={18} /></div>
      <div>
        <div className="what">{title}</div>
        {children ? <div className="why">{children}</div> : null}
      </div>
      {actions ? <div className="actions">{actions}</div> : <span />}
    </div>
  )
}

function Header({ item }: { item: PullRequestItem }) {
  const { login } = useWorkspace()
  const authored = isAuthoredBy(item, login)
  const checks = item.check_status
  const checkIcon: IconName = checks === 'success' ? 'checkCircle' : checks === 'failure' ? 'warn' : 'hourglass'
  const checkLabel = checks === 'success' ? 'Checks passing' : checks === 'failure' ? 'Checks failing' : 'Checks running'

  return (
    <>
      <div className="kicker" style={{ '--d': 0 }}>
        <span className="state" style={item.lifecycle === 'failed' ? { '--c': 'var(--red)' } : undefined}>
          <StatusGlyph lifecycle={item.lifecycle} requested={item.review_requested_for_me} size={14} />
          {LIFECYCLE_LABELS[item.lifecycle]}
        </span>
        <span style={{ color: 'var(--t4)' }}>·</span>
        <span>{item.repo_full_name} #{item.number}</span>
        {item.draft ? <><span style={{ color: 'var(--t4)' }}>·</span><span>Draft</span></> : null}
      </div>
      <h1 className="pr-title" style={{ '--d': 1 }}>{item.title}</h1>
      <div className="byline" style={{ '--d': 2 }}>
        <Avatar name={item.author} url={item.author_avatar} size={20} />
        <b>{authored ? 'You' : item.author ?? 'Someone'}</b>
        <span>{authored ? 'want' : 'wants'} to merge into</span>
        {item.base_ref ? <span className="ref">{item.base_ref}</span> : null}
        {item.head_ref ? <><span>from</span><span className="ref">{item.head_ref}</span></> : null}
      </div>
      <div className="stats" style={{ '--d': 3 }}>
        {item.additions != null && item.deletions != null ? (
          <span className="stat"><span className="diffstat"><span className="a">+{formatCount(item.additions)}</span><span className="d">−{formatCount(item.deletions)}</span></span></span>
        ) : null}
        {item.changed_files != null ? <span className="stat"><Icon name="files" size={14} />{pluralize(item.changed_files, 'file')}</span> : null}
        {checks ? <span className={checks === 'failure' ? 'stat danger' : 'stat'} style={checks === 'failure' ? { '--c': 'var(--red)' } : undefined}><Icon name={checkIcon} size={14} />{checkLabel}</span> : null}
        {item.review_requested_for_me ? <span className="stat"><Icon name="user" size={14} />Requested you</span> : null}
        {item.updated_at_github ? <span className="stat"><Icon name="clock" size={14} />Updated {relativeAgo(item.updated_at_github)}</span> : null}
      </div>
    </>
  )
}

function Brief({ item }: { item: PullRequestItem }) {
  const summary = item.ai_summary
  const aside = <span className="ai-mark"><Icon name="sparkles" size={12} />Brief{summary.stale ? ' · older commit' : ''}</span>

  if (summary.status === 'pending') {
    return (
      <Block title="What changed" aside={aside} delay={4}>
        <div className="card brief-pending"><Spinner size={14} /><span className="shimmer">Writing a brief of this pull request…</span></div>
      </Block>
    )
  }

  if (summary.main_changes.length === 0) {
    if (!item.description?.trim()) return null
    return (
      <Block title="Description" delay={4}>
        <div className="card"><div className="description">{item.description}</div></div>
      </Block>
    )
  }

  return (
    <Block title="What changed" aside={aside} delay={4}>
      <div className="card brief">
        <ul>{summary.main_changes.map((change) => <li key={change}><span><InlineCode text={change} /></span></li>)}</ul>
        {summary.risk_areas.length > 0 ? (
          <div className="risks">
            <span className="lbl">Watch for</span>
            {summary.risk_areas.map((risk) => <span key={risk} className="chip">{risk}</span>)}
          </div>
        ) : null}
      </div>
    </Block>
  )
}

function currentStep(logs: AgentLogItem[]) {
  if (logs.some((log) => /review completed/i.test(log.message))) return 2
  if (logs.some((log) => log.log_type === 'output' || /^running /i.test(log.message))) return 1
  return 0
}

function RunCard({ item, detail }: { item: PullRequestItem; detail: ReviewTaskDetailResponse | undefined }) {
  const task = item.review_task
  const now = useNow(1000)
  const logs = useLiveLogs(task?.id, detail?.live_logs ?? [], true)
  const step = currentStep(logs)
  const latest = [...logs].reverse().find((log) => log.log_type !== 'error')
  const depth = task?.review_type === 'swarm' ? DEPTHS.swarm : DEPTHS.review

  return (
    <div className="card run">
      <div className="run-head">
        <div className="agent-badge"><AgentIcon client={task?.cli_client} size={20} /></div>
        <div>
          <div className="what">{agentLabel(task?.cli_client)} is reviewing</div>
          <div className="sub">{[task?.ai_model, depth.label].filter(Boolean).join(' · ')}</div>
        </div>
        <span className="clock">{task?.started_at ? elapsedClock(task.started_at, now) : 'Starting'}</span>
      </div>
      <div className="steps">
        {RUN_STEPS.map((label, index) => {
          const done = index < step
          const active = index === step
          return (
            <div key={label} className={done ? 'step done' : active ? 'step now' : 'step'}>
              <span className="d">
                {done ? <CheckBadge size={16} /> : active ? <Spinner size={16} /> : (
                  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="var(--t4)" strokeWidth="1.5" strokeDasharray="2.4 2" /></svg>
                )}
              </span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {active && latest ? <span className="shimmer">{label} — {latest.message}</span> : label}
              </span>
            </div>
          )
        })}
      </div>
      <div className="log">
        {logs.slice(-7).map((log) => (
          <div key={log.id} className={`ln ${log.log_type === 'status' ? 'status' : log.log_type === 'error' ? 'err' : ''}`}>
            {log.log_type === 'status' ? '→ ' : '  '}{log.message}
          </div>
        ))}
      </div>
    </div>
  )
}

function Verdict({ item, detail }: { item: PullRequestItem; detail: ReviewTaskDetailResponse }) {
  const { openInspector } = useWorkspace()
  const task = detail.task
  const comments = detail.comments
  const counts = severityCounts(item.lifecycle === 'ready' ? pendingComments(comments) : comments)
  const submittedEvent = isReviewEvent(task.submitted_event) ? task.submitted_event : null
  const submitted = item.lifecycle !== 'ready' && submittedEvent !== null && task.submitted_at !== null

  let headline: ReactNode
  let reason: string

  if (submitted && submittedEvent) {
    headline = <>You {EVENTS[submittedEvent].past} {relativeAgo(task.submitted_at)}</>
    const addressed = comments.filter((comment) => comment.status === 'addressed').length
    reason = comments.length ? `${addressed} of ${pluralize(comments.length, 'finding')} sent or addressed.` : 'No inline comments were attached.'
  } else {
    const event = suggestedEvent(comments)
    const blocker = pendingComments(comments).find((comment) => comment.severity === 'critical' || comment.severity === 'major')
    const pendingCount = pendingComments(comments).length
    headline = <>{agentLabel(task.cli_client)} suggests <em>{EVENTS[event].label.toLowerCase()}</em></>
    reason = blocker
      ? `${blocker.title ?? 'A blocking issue'}${pendingCount > 1 ? ', plus a few smaller things.' : '.'}`
      : pendingCount > 0 ? 'No blockers — a few things worth mentioning.' : detail.content_mode === 'comments' || detail.content_mode === 'empty' ? 'No issues found in the changed code.' : 'See the agent output below.'
  }

  const meta = [
    `${agentLabel(task.cli_client)}${task.ai_model ? ` ${task.ai_model}` : ''}`,
    task.review_type === 'swarm' ? 'Swarm' : 'Standard',
    detail.meta.formatted_duration,
    task.completed_at ? relativeAgo(task.completed_at) : null,
  ].filter(Boolean)

  return (
    <Block title="Review" aside={<button type="button" className="link" onClick={() => openInspector('log')}>View log</button>} delay={5}>
      <div className="card">
        <div className="verdict">
          <div className="agent-badge"><AgentIcon client={task.cli_client} size={20} /></div>
          <div>
            <div className="what">{headline}</div>
            <div className="why">{reason}</div>
            <div className="meta">{meta.map((entry, index) => <span key={entry}>{index > 0 ? '· ' : ''}{entry}</span>)}</div>
            {task.review_focus ? <div className="meta"><Icon name="eye" size={12} />Focus: {task.review_focus}</div> : null}
          </div>
          <span />
        </div>
        {counts.length > 0 ? (
          <div className="sev-summary">
            {counts.map(({ severity, count }) => <SeverityChip key={severity} severity={severity}>{count} {SEVERITY_LABELS[severity].toLowerCase()}</SeverityChip>)}
          </div>
        ) : null}
      </div>
    </Block>
  )
}

function Finding({ comment, editable, included, onToggle }: { comment: ReviewCommentItem; editable: boolean; included: boolean; onToggle: () => void }) {
  const { focusedFinding, setFocusedFinding } = useWorkspace()
  const focused = focusedFinding === comment.id
  const classes = ['finding']
  if (editable && !included) classes.push('off')
  if (focused) classes.push('focus')
  if (comment.status === 'addressed') classes.push('addressed')
  if (comment.status === 'dismissed') classes.push('dismissed')

  return (
    <div className={classes.join(' ')} onClick={() => setFocusedFinding(comment.id)}>
      {editable ? (
        <button
          type="button"
          className={included ? 'check on' : 'check'}
          title="Include in review  X"
          aria-pressed={included}
          onClick={(event) => {
            event.stopPropagation()
            setFocusedFinding(comment.id)
            onToggle()
          }}
        >
          <Icon name="check" size={12} stroke={3} />
        </button>
      ) : (
        <span style={{ paddingTop: 1 }}>
          {comment.status === 'addressed' ? <CheckBadge size={18} /> : (
            <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="var(--t3)" strokeWidth="1.5" /></svg>
          )}
        </span>
      )}
      <div style={{ minWidth: 0 }}>
        <div className="top">
          <span className="f-title">{comment.title ?? 'Untitled finding'}</span>
          <span className="f-meta">
            {!editable && comment.status !== 'pending' ? <span className={`status-tag ${comment.status}`}>{comment.status === 'addressed' ? 'Sent' : 'Dismissed'}</span> : null}
            <span className="f-loc" title={comment.location}>{comment.file_path.split('/').pop()}{comment.line_number ? `:${comment.line_number}` : ''}</span>
          </span>
        </div>
        <Html html={comment.body_html} className="md f-body" />
        {comment.resolution_note ? <div className="note">{comment.resolution_note}</div> : null}
      </div>
    </div>
  )
}

function Findings({ item, detail }: { item: PullRequestItem; detail: ReviewTaskDetailResponse }) {
  const { selectionFor, setSelection, focusedFinding } = useWorkspace()
  const taskId = detail.task.id
  const editable = item.lifecycle === 'ready'
  const comments = detail.comments
  const pending = pendingComments(comments)
  const selection = selectionFor(taskId, comments)
  const groups = groupBySeverity(editable ? comments.filter((comment) => comment.status !== 'addressed') : comments)

  const toggle = (id: number) => {
    const next = new Set(selection)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelection(taskId, next)
  }

  useEffect(() => {
    if (!editable) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'x' || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target
      if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return
      const id = focusedFinding ?? pending[0]?.id
      if (id === undefined) return
      event.preventDefault()
      const next = new Set(selection)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      setSelection(taskId, next)
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [editable, focusedFinding, pending, selection, setSelection, taskId])

  if (groups.length === 0) return null

  const allIncluded = pending.every((comment) => selection.has(comment.id))

  return (
    <Block
      title="Findings"
      delay={6}
      aside={editable ? (
        <>
          <span>{selection.size} of {pending.length} included</span>
          <button type="button" className="link" onClick={() => setSelection(taskId, allIncluded ? new Set() : new Set(pending.map((comment) => comment.id)))}>
            {allIncluded ? 'Exclude all' : 'Include all'}
          </button>
        </>
      ) : null}
    >
      {groups.map((group) => (
        <div key={group.severity}>
          <div className="finding-group">
            <SeverityChip severity={group.severity}>{SEVERITY_LABELS[group.severity]}</SeverityChip>
            <span>{group.comments.length}</span>
          </div>
          {group.comments.map((comment) => (
            <Finding key={comment.id} comment={comment} editable={editable && comment.status === 'pending'} included={selection.has(comment.id)} onToggle={() => toggle(comment.id)} />
          ))}
        </div>
      ))}
    </Block>
  )
}

function ParsedItems({ items }: { items: ParsedReviewItem[] }) {
  return (
    <Block title="Findings" delay={6}>
      {items.map((entry, index) => (
        <div key={`${entry.location}:${index}`} className="finding">
          <span style={{ paddingTop: 1 }}><Icon name="message" size={16} /></span>
          <div style={{ minWidth: 0 }}>
            <div className="top">
              <span className="f-title">{entry.title ?? 'Finding'}</span>
              <span className="f-meta"><span className="chip">{entry.severity}</span><span className="f-loc">{entry.location}</span></span>
            </div>
            <Html html={entry.comment_html} className="md f-body" />
            <Html html={entry.suggested_fix_html} className="md finding-fix" />
          </div>
        </div>
      ))}
    </Block>
  )
}

function ReviewOutput({ item, detail }: { item: PullRequestItem; detail: ReviewTaskDetailResponse }) {
  return (
    <>
      <Verdict item={item} detail={detail} />
      {detail.content_mode === 'comments' ? <Findings item={item} detail={detail} /> : null}
      {detail.content_mode === 'parsed_review_items' ? <ParsedItems items={detail.parsed_review_items} /> : null}
      {detail.content_mode === 'raw_output' ? (
        <Block title="Agent output" delay={6}><div className="card"><Html html={detail.raw_output_html} /></div></Block>
      ) : null}
    </>
  )
}

function StatusCallouts({ item }: { item: PullRequestItem }) {
  const { actions } = useWorkspace()
  const task = item.review_task

  if (item.lifecycle === 'queued' && task) {
    return (
      <Callout
        icon="hourglass"
        color="var(--t2)"
        title={`Queued${task.queue_position ? ` · position ${task.queue_position}` : ''}`}
        actions={<button type="button" className="btn" onClick={() => void actions.dequeue(item)}>Remove from queue</button>}
      >
        {agentLabel(task.cli_client)} picks this up when the current review finishes.
      </Callout>
    )
  }

  if (item.lifecycle === 'failed' && task) {
    return (
      <Callout icon="warn" color="var(--red)" title={`Review failed${task.retry_count ? ` after ${pluralize(task.retry_count + 1, 'attempt')}` : ''}`}>
        {task.failure_reason ?? 'The agent stopped before producing findings.'}
      </Callout>
    )
  }

  if (item.has_new_commits && (item.lifecycle === 'waiting' || item.lifecycle === 'needs_review')) {
    return (
      <Callout icon="branch" title="New commits since your review">
        {item.author ?? 'The author'} pushed changes {relativeAgo(item.updated_at_github)}. Re-review to check what changed and which findings were addressed.
      </Callout>
    )
  }

  if (item.has_new_commits && item.lifecycle === 'ready') {
    return (
      <Callout icon="warn" title="These findings are for an older commit">
        New commits landed after this review ran. Re-run it from the ⋯ menu before sending, or send as-is.
      </Callout>
    )
  }

  if (item.lifecycle === 'authored') {
    return (
      <Callout icon="user" title="Your pull request">
        Run a self-review before your reviewers get to it. Findings stay in Forge until you decide what to do with them.
      </Callout>
    )
  }

  if (item.lifecycle === 'settled' && !task) {
    const reason = item.remote_state === 'merged' ? 'Merged' : item.remote_state === 'closed' ? 'Closed' : 'You already reviewed this on GitHub'
    return <Callout icon="checkCircle" title={reason}>Nothing left to do here.</Callout>
  }

  return null
}

function MainContent({ item }: { item: PullRequestItem }) {
  const task = item.review_task
  const detailQuery = useTaskDetail(task?.id)
  const detail = detailQuery.data
  const showOutput = detail && ['ready', 'waiting', 'settled'].includes(item.lifecycle)
  const showReReviewOutput = detail && item.lifecycle === 'needs_review' && item.has_new_commits

  return (
    <>
      <div className="block" style={{ '--d': 5 }}><StatusCallouts item={item} /></div>
      {item.lifecycle === 'reviewing' ? <Block title="Review in progress" delay={5}><RunCard item={item} detail={detail} /></Block> : null}
      {task && detailQuery.isLoading && item.lifecycle !== 'reviewing' ? <div className="loading-line"><Spinner size={14} />Loading review…</div> : null}
      {showOutput || showReReviewOutput ? <ReviewOutput item={item} detail={detail} /> : null}
    </>
  )
}

function DetailToolbar({ item }: { item: PullRequestItem }) {
  const { inspectorOpen, toggleInspector, actions, openInspector } = useWorkspace()
  const task = item.review_task

  const menuItems: MenuItem[] = [
    { key: 'github', label: 'Open on GitHub', icon: <Icon name="github" size={14} /> },
    { key: 'files', label: 'Open files changed', icon: <Icon name="files" size={14} /> },
    { key: 'copy', label: 'Copy link', icon: <Icon name="link" size={14} /> },
  ]
  const reviewItems: MenuItem[] = []
  if (task && item.lifecycle === 'waiting') reviewItems.push({ key: 'done', label: 'Mark as done', icon: <Icon name="checkCircle" size={14} /> })
  if (task && ['ready', 'waiting', 'settled'].includes(item.lifecycle)) reviewItems.push({ key: 'rerun', label: 'Run review again', icon: <Icon name="refresh" size={14} /> })
  if (task) reviewItems.push({ key: 'log', label: 'Show agent log', icon: <Icon name="activity" size={14} /> })
  if (task && item.lifecycle !== 'reviewing') reviewItems.push({ key: 'clear', label: 'Discard review…', icon: <Icon name="x" size={14} /> })
  reviewItems.push({ key: 'archive', label: 'Archive', icon: <Icon name="archive" size={14} />, shortcut: 'E' })

  return (
    <div className="toolbar">
      <div className="crumbs">
        <span>{item.repo_name}</span>
        <Icon name="chevRight" size={12} />
        <b>#{item.number} {item.title}</b>
      </div>
      <a className="tb-btn" href={item.url} target="_blank" rel="noreferrer" title="Open on GitHub"><Icon name="github" size={15} /></a>
      <MenuButton
        className="tb-btn"
        title="More"
        align="right"
        sections={[{ items: menuItems }, { items: reviewItems }]}
        onSelect={(key) => {
          if (key === 'github') window.open(item.url, '_blank', 'noreferrer')
          if (key === 'files') window.open(`${item.url}/files`, '_blank', 'noreferrer')
          if (key === 'copy') void navigator.clipboard?.writeText(item.url)
          if (key === 'done') void actions.markDone(item)
          if (key === 'rerun' && task) void actions.startReview(item, { client: task.cli_client, depth: task.review_type === 'swarm' ? 'swarm' : 'review', focus: task.review_focus ?? '' })
          if (key === 'log') openInspector('log')
          if (key === 'clear') void actions.clearReview(item)
          if (key === 'archive') void actions.archive(item)
        }}
      >
        <Icon name="more" />
      </MenuButton>
      <button type="button" className={inspectorOpen ? 'tb-btn on' : 'tb-btn'} title="Inspector  I" onClick={toggleInspector}><Icon name="inspector" /></button>
    </div>
  )
}

export function PullRequestDetail({ item }: { item: PullRequestItem }) {
  return (
    <main className="detail">
      <DetailToolbar item={item} />
      <div className="scroll">
        <div className="page" key={item.id}>
          <Header item={item} />
          <Brief item={item} />
          <MainContent item={item} />
        </div>
      </div>
      <Composer item={item} />
    </main>
  )
}

export function DetailEmpty({ title, body, icon = 'inbox' }: { title: string; body: string; icon?: IconName }) {
  const { sidebarOpen, toggleSidebar } = useWorkspace()

  return (
    <main className="detail">
      <div className="toolbar" style={{ borderBottomColor: 'transparent' }}>
        {!sidebarOpen ? <button type="button" className="tb-btn" onClick={toggleSidebar}><Icon name="sidebar" /></button> : null}
      </div>
      <div className="detail-empty">
        <div className="big"><Icon name={icon} size={24} /></div>
        <b>{title}</b>
        <span>{body}</span>
      </div>
    </main>
  )
}
