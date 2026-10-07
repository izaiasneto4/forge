import { useEffect, useRef, useState, type ReactNode } from 'react'

import { agentLabel, EVENTS, isReviewEvent } from '../lib/agents'
import { formatDuration, pluralize, relativeAgo } from '../lib/format'
import type { PullRequestItem, ReviewIterationItem, ReviewTaskDetailResponse } from '../types/api'
import { useWorkspace, type InspectorTab } from '../workspace/context'
import { useLiveLogs, useTaskDetail } from '../workspace/useTaskDetail'
import { AgentIcon } from './Glyphs'
import { Html } from './Html'
import { Icon, type IconName } from './Icon'

const TABS: Array<[InspectorTab, string]> = [
  ['activity', 'Activity'],
  ['log', 'Agent log'],
  ['history', 'History'],
]

type TimelineEntry = {
  icon: IconName
  what: ReactNode
  at: string
}

function timeline(item: PullRequestItem, detail: ReviewTaskDetailResponse | undefined, lastSyncedAt: string | null) {
  const task = detail?.task ?? item.review_task
  const entries: Array<TimelineEntry | null> = [
    item.created_at_github ? { icon: 'branch', what: <><b>{item.author ?? 'Someone'}</b> opened this pull request</>, at: item.created_at_github } : null,
    item.updated_at_github && item.updated_at_github !== item.created_at_github ? { icon: 'branch', what: 'Last updated on GitHub', at: item.updated_at_github } : null,
    lastSyncedAt ? { icon: 'refresh', what: 'Synced from GitHub', at: lastSyncedAt } : null,
    task?.queued_at ? { icon: 'hourglass', what: 'Review queued', at: task.queued_at } : null,
    task?.started_at ? { icon: 'sparkles', what: `${agentLabel(task.cli_client)} started reviewing`, at: task.started_at } : null,
    task?.completed_at && task.state !== 'failed_review'
      ? { icon: 'sparkles', what: `${agentLabel(task.cli_client)} finished${detail ? ` · ${pluralize(detail.comments.length, 'finding')}` : ''}`, at: task.completed_at }
      : null,
    task?.state === 'failed_review' && task.completed_at ? { icon: 'warn', what: 'Review failed', at: task.completed_at } : null,
    task?.submitted_at && isReviewEvent(task.submitted_event)
      ? { icon: 'github', what: `You ${EVENTS[task.submitted_event].past} on GitHub`, at: task.submitted_at }
      : null,
  ]

  return entries
    .filter((entry): entry is TimelineEntry => entry !== null)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
}

function Activity({ item, detail }: { item: PullRequestItem; detail: ReviewTaskDetailResponse | undefined }) {
  const { board } = useWorkspace()
  const entries = timeline(item, detail, board?.sync_status.last_synced_at ?? null)

  if (entries.length === 0) return <div className="insp-empty">No activity yet.</div>

  return (
    <div className="tl">
      {entries.map((entry, index) => (
        <div key={`${entry.at}:${index}`} className="tl-item">
          <span className="tl-dot"><Icon name={entry.icon} size={12} /></span>
          <div><div className="what">{entry.what}</div><div className="when">{relativeAgo(entry.at)}</div></div>
        </div>
      ))}
    </div>
  )
}

function Log({ item, detail }: { item: PullRequestItem; detail: ReviewTaskDetailResponse | undefined }) {
  const logs = useLiveLogs(item.review_task?.id, detail?.live_logs ?? [], item.lifecycle === 'reviewing')
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [logs.length])

  if (!item.review_task) return <div className="insp-empty">No review has run on this pull request yet.</div>
  if (logs.length === 0) return <div className="insp-empty">The agent hasn’t written anything yet.</div>

  return (
    <div className="full-log">
      {logs.map((log) => (
        <div key={log.id} className={`ln ${log.log_type === 'status' ? 'status' : log.log_type === 'error' ? 'err' : ''}`}>
          {log.log_type === 'status' ? '→ ' : '  '}{log.message}
        </div>
      ))}
      <div ref={endRef} />
    </div>
  )
}

function HistoryRun({ iteration }: { iteration: ReviewIterationItem }) {
  const [open, setOpen] = useState(false)
  const hasOutput = iteration.output_mode !== 'empty'

  return (
    <div className={open ? 'history-item open' : 'history-item'}>
      <button type="button" className="history-head" disabled={!hasOutput} aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <div className="what">
          <AgentIcon client={iteration.cli_client} size={13} />Run {iteration.iteration_number} · {agentLabel(iteration.cli_client)}
          {hasOutput ? <Icon name="chevRight" size={12} className="chev" /> : null}
        </div>
        <div className="when">
          {[
            iteration.review_type === 'swarm' ? 'Swarm' : 'Standard',
            formatDuration(iteration.duration_seconds),
            iteration.parsed_review_items.length ? pluralize(iteration.parsed_review_items.length, 'finding') : null,
            relativeAgo(iteration.completed_at),
          ].filter(Boolean).join(' · ')}
        </div>
      </button>
      {open ? (
        <div className="history-body">
          {iteration.output_mode === 'parsed_review_items'
            ? iteration.parsed_review_items.map((entry, index) => (
              <div key={`${entry.location}:${index}`} className="history-finding">
                <div className="top">
                  <span className="f-title">{entry.title ?? 'Finding'}</span>
                  <span className="f-loc" title={entry.location}>{entry.location}</span>
                </div>
                <div className="sev">{entry.severity}</div>
                <Html html={entry.comment_html} />
              </div>
            ))
            : <Html html={iteration.raw_output_html} />}
        </div>
      ) : null}
    </div>
  )
}

function History({ detail }: { detail: ReviewTaskDetailResponse | undefined }) {
  const iterations = detail?.review_history ?? []
  if (iterations.length === 0) return <div className="insp-empty">Past review runs show up here.</div>

  return (
    <div>
      {[...iterations].reverse().map((iteration) => <HistoryRun key={iteration.id} iteration={iteration} />)}
    </div>
  )
}

export function Inspector({ item }: { item: PullRequestItem | null }) {
  const { inspectorTab, openInspector } = useWorkspace()
  const detail = useTaskDetail(item?.review_task?.id).data

  return (
    <aside className="inspector" aria-label="Inspector">
      <div className="toolbar">
        <div className="seg" role="tablist">
          {TABS.map(([tab, label]) => (
            <button key={tab} type="button" role="tab" aria-selected={inspectorTab === tab} className={inspectorTab === tab ? 'on' : ''} onClick={() => openInspector(tab)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="insp-body">
        {!item ? <div className="insp-empty">Select a pull request.</div> : null}
        {item && inspectorTab === 'activity' ? <Activity item={item} detail={detail} /> : null}
        {item && inspectorTab === 'log' ? <Log item={item} detail={detail} /> : null}
        {item && inspectorTab === 'history' ? <History detail={detail} /> : null}
      </div>
    </aside>
  )
}
