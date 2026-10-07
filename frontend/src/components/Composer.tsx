import { useEffect, useEffectEvent, useLayoutEffect, useRef } from 'react'

import {
  agentLabel,
  composeFocus,
  DEPTHS,
  EVENTS,
  isReviewDepth,
  isReviewEvent,
  isReviewLens,
  LENSES,
  type ReviewDepth,
} from '../lib/agents'
import { pluralize } from '../lib/format'
import { suggestedEvent } from '../lib/lifecycle'
import type { PullRequestItem, ReviewEvent } from '../types/api'
import { useWorkspace } from '../workspace/context'
import { useTaskDetail } from '../workspace/useTaskDetail'
import { AgentIcon } from './Glyphs'
import { Icon } from './Icon'
import { MenuButton } from './Menu'

type Mode = 'start' | 'rereview' | 'retry' | 'submit' | 'running' | 'none'

function composerModeFor(item: PullRequestItem): Mode {
  switch (item.lifecycle) {
    case 'needs_review':
      return item.has_new_commits ? 'rereview' : 'start'
    case 'authored':
      return 'start'
    case 'failed':
      return 'retry'
    case 'ready':
      return 'submit'
    case 'reviewing':
      return 'running'
    case 'waiting':
      return 'rereview'
    default:
      return 'none'
  }
}

function useAutosize(value: string) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const textarea = ref.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`
  }, [value])

  return ref
}

function isTypingElsewhere(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  if (target.id === 'composer-input') return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

function usePrimaryShortcut(action: () => void, enabled: boolean) {
  const onShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (!enabled || event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return
    if (isTypingElsewhere(event.target)) return
    event.preventDefault()
    action()
  })

  useEffect(() => {
    document.addEventListener('keydown', onShortcut)
    return () => document.removeEventListener('keydown', onShortcut)
  }, [])
}

function Hints({ hints }: { hints: Array<[string, string]> }) {
  return (
    <div className="composer-hint">
      {hints.map(([key, label]) => <span key={key}><kbd>{key}</kbd> {label}</span>)}
    </div>
  )
}

type ReviewPillsProps = {
  client: string
  depth: ReviewDepth
  lens: keyof typeof LENSES
  onClient: (client: string) => void
  onDepth: (depth: ReviewDepth) => void
  onLens?: (lens: keyof typeof LENSES) => void
}

export function ReviewPills({ client, depth, lens, onClient, onDepth, onLens }: ReviewPillsProps) {
  const { cliClients } = useWorkspace()

  return (
    <>
      <MenuButton
        sections={[{ title: 'Agent', items: cliClients.map((entry) => ({ key: entry, label: agentLabel(entry), checked: entry === client, icon: <AgentIcon client={entry} size={14} /> })) }]}
        onSelect={onClient}
      >
        <AgentIcon client={client} size={14} />{agentLabel(client)}<Icon name="chevDown" size={12} className="chev" />
      </MenuButton>
      <span className="vsep" />
      <MenuButton
        sections={[{ title: 'Depth', items: Object.entries(DEPTHS).map(([key, entry]) => ({ key, label: entry.label, sub: entry.description, checked: key === depth, icon: <Icon name={entry.icon} size={14} /> })) }]}
        onSelect={(key) => { if (isReviewDepth(key)) onDepth(key) }}
      >
        <Icon name={DEPTHS[depth].icon} size={14} />{DEPTHS[depth].label}<Icon name="chevDown" size={12} className="chev" />
      </MenuButton>
      {onLens ? (
        <>
          <span className="vsep opt2" />
          <MenuButton
            className="pill opt2"
            sections={[{ title: 'Focus', items: Object.entries(LENSES).map(([key, entry]) => ({ key, label: entry.label, checked: key === lens, icon: <Icon name={entry.icon} size={14} /> })) }]}
            onSelect={(key) => { if (isReviewLens(key)) onLens(key) }}
          >
            <Icon name={LENSES[lens].icon} size={14} />{LENSES[lens].label}<Icon name="chevDown" size={12} className="chev" />
          </MenuButton>
        </>
      ) : null}
    </>
  )
}

function StartComposer({ item, mode }: { item: PullRequestItem; mode: 'start' | 'rereview' | 'retry' }) {
  const { draftFor, updateDraft, defaultClient, actions, pending, login } = useWorkspace()
  const draft = draftFor(item.id)
  const task = item.review_task
  const client = draft.client ?? task?.cli_client ?? defaultClient
  const depth: ReviewDepth = draft.depth ?? (task?.review_type === 'swarm' ? 'swarm' : 'review')
  const textareaRef = useAutosize(draft.text)
  const authored = item.author?.toLowerCase() === login?.toLowerCase()

  const start = () => {
    if (pending.start) return
    void actions.startReview(item, { client, depth, focus: composeFocus(draft.lens, draft.text) })
  }

  usePrimaryShortcut(start, true)

  const placeholder = mode === 'rereview'
    ? 'Anything to check in the new commits? (optional)'
    : authored
      ? 'Self-review before your reviewers do — anything to focus on?'
      : `Anything ${agentLabel(client)} should focus on? e.g. “check the migration is safe to run online”`

  const sendLabel = mode === 'rereview' ? 'Re-review' : mode === 'retry' ? 'Retry review' : null

  return (
    <div className="composer-wrap">
      <div className="composer">
        <textarea
          id="composer-input"
          ref={textareaRef}
          rows={2}
          value={draft.text}
          placeholder={placeholder}
          onChange={(event) => updateDraft(item.id, { text: event.target.value })}
        />
        <div className="bar">
          <ReviewPills
            client={client}
            depth={depth}
            lens={draft.lens}
            onClient={(value) => updateDraft(item.id, { client: value })}
            onDepth={(value) => updateDraft(item.id, { depth: value })}
            onLens={(value) => updateDraft(item.id, { lens: value })}
          />
          {sendLabel ? (
            <button type="button" className="send wide" disabled={pending.start} onClick={start}>
              <Icon name="refresh" size={14} />{sendLabel}<kbd>⌘↵</kbd>
            </button>
          ) : (
            <button type="button" className="send" disabled={pending.start} title="Start review  ⌘↵" aria-label="Start review" onClick={start}>
              <Icon name="arrowUp" size={17} stroke={2.2} />
            </button>
          )}
        </div>
      </div>
      <Hints hints={[['⌘↵', mode === 'start' ? 'start review' : sendLabel?.toLowerCase() ?? 'run'], ['J K', 'next / previous'], ['E', 'archive']]} />
    </div>
  )
}

function SubmitComposer({ item }: { item: PullRequestItem }) {
  const { draftFor, updateDraft, selectionFor, actions, pending } = useWorkspace()
  const task = item.review_task
  const detail = useTaskDetail(task?.id).data
  const draft = draftFor(item.id)
  const textareaRef = useAutosize(draft.summary)
  const comments = detail?.comments ?? []
  const selection = task ? selectionFor(task.id, comments) : new Set<number>()
  const suggested = suggestedEvent(comments)
  const event: ReviewEvent = draft.event ?? suggested
  const included = selection.size
  const nothingIncluded = included === 0 && event !== 'APPROVE'
  const blocked = !detail || pending.submit || nothingIncluded

  const submit = () => {
    if (blocked) return
    void actions.submit(item, { event, summary: draft.summary.trim(), commentIds: [...selection] })
  }

  usePrimaryShortcut(submit, true)

  return (
    <div className="composer-wrap">
      <div className="composer">
        <textarea
          id="composer-input"
          ref={textareaRef}
          rows={2}
          value={draft.summary}
          placeholder={`Add a summary for ${item.author ?? 'the author'} (optional)…`}
          onChange={(change) => updateDraft(item.id, { summary: change.target.value })}
        />
        <div className="bar">
          <MenuButton
            sections={[{
              title: 'Submit as',
              items: Object.entries(EVENTS).map(([key, entry]) => ({
                key,
                label: entry.label,
                sub: key === suggested ? 'suggested' : undefined,
                checked: key === event,
                icon: <span className="swatch" style={{ '--c': entry.color }} />,
              })),
            }]}
            onSelect={(key) => { if (isReviewEvent(key)) updateDraft(item.id, { event: key }) }}
          >
            <span className="swatch" style={{ '--c': EVENTS[event].color }} />{EVENTS[event].label}<Icon name="chevDown" size={12} className="chev" />
          </MenuButton>
          <span className="vsep opt2" />
          <span className="pill opt2" style={{ pointerEvents: 'none' }}><Icon name="message" size={14} />{pluralize(included, 'inline comment')}</span>
          <button type="button" className="send wide" disabled={blocked} title={nothingIncluded ? 'Include a finding or approve' : undefined} onClick={submit}>
            {pending.submit ? 'Submitting…' : 'Submit review'}<kbd>⌘↵</kbd>
          </button>
        </div>
      </div>
      <Hints hints={[['X', 'include finding'], ['J K', 'next / previous'], ['⌘↵', 'submit to GitHub']]} />
    </div>
  )
}

function RunningComposer({ item }: { item: PullRequestItem }) {
  const { openInspector } = useWorkspace()
  const task = item.review_task
  const depth = task?.review_type && isReviewDepth(task.review_type) ? task.review_type : 'review'

  return (
    <div className="composer-wrap">
      <div className="composer">
        <textarea rows={2} disabled placeholder={`${agentLabel(task?.cli_client)} is reviewing. You’ll get a notification when findings are ready — feel free to move on.`} />
        <div className="bar">
          <span className="pill" style={{ pointerEvents: 'none' }}><AgentIcon client={task?.cli_client} size={14} />{agentLabel(task?.cli_client)}</span>
          <span className="vsep" />
          <span className="pill" style={{ pointerEvents: 'none' }}><Icon name={DEPTHS[depth].icon} size={14} />{DEPTHS[depth].label}</span>
          <button type="button" className="send stop wide" style={{ padding: '0 14px' }} onClick={() => openInspector('log')}>
            <Icon name="activity" size={14} />Watch log
          </button>
        </div>
      </div>
    </div>
  )
}

export function Composer({ item }: { item: PullRequestItem }) {
  const mode = composerModeFor(item)

  switch (mode) {
    case 'submit':
      return <SubmitComposer key={item.id} item={item} />
    case 'running':
      return <RunningComposer item={item} />
    case 'none':
      return null
    default:
      return <StartComposer key={item.id} item={item} mode={mode} />
  }
}
