import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { BrowserRouter, NavLink, Route, Routes, useNavigate, useParams } from 'react-router-dom'

import { api, ApiResponseError } from './lib/api'
import { subscribe } from './lib/cable'
import { getWaitingInfo } from './lib/dateUtils'
import { filterPullRequestColumns, type SortOption } from './lib/pullRequestFilters'
import { queryKeys } from './lib/queryKeys'
import { ThemeProvider, useTheme } from './lib/theme'
import { ToastProvider, useToasts } from './lib/toasts'
import { handleReviewNotification, handleUiEvent } from './lib/uiEvents'
import { PullRequestSummaryPanel } from './components/PullRequestSummaryPanel'
import { RepoSwitcher } from './components/RepoSwitcher'
import type {
  AgentLogItem,
  BootstrapResponse,
  ParsedReviewItem,
  PullRequestBoardResponse,
  PullRequestItem,
  PullRequestStatus,
  RepositoryListResponse,
  ReviewIterationItem,
  ReviewTaskBoardResponse,
  ReviewTaskDetailResponse,
  ReviewTaskItem,
  ReviewTaskState,
  SettingsResponse,
  UiMutationResponse,
} from './types/api'

const queryClient = new QueryClient()

function isPullRequestStatus(value: string): value is PullRequestStatus {
  return pullRequestColumns.some((column) => column.key === value)
}

function isSortOption(value: string): value is SortOption {
  return ['oldest', 'newest', 'smallest_diff', 'repo', 'author', 'recent_activity', 'longest_waiting'].includes(value)
}

function isUiEventPayload(data: unknown): data is { event?: string; error?: string } {
  return typeof data === 'object' && data !== null
}

function isReviewNotificationPayload(data: unknown): data is { type?: string; pr_number?: number; reason?: string } {
  return typeof data === 'object' && data !== null
}

function isReviewTaskItem(item: unknown): item is ReviewTaskItem {
  return typeof item === 'object' && item !== null && 'id' in item && 'state' in item
}

function isReviewTaskState(value: string): value is ReviewTaskState {
  return reviewTaskColumns.some((column) => column.key === value)
}

const pullRequestColumns: Array<{ key: PullRequestStatus; title: string }> = [
  { key: 'pending_review', title: 'Pending Review' },
  { key: 'in_review', title: 'In Review' },
  { key: 'reviewed_by_me', title: 'Reviewed By Me' },
  { key: 'waiting_implementation', title: 'Waiting on Author' },
  { key: 'reviewed_by_others', title: 'Reviewed Elsewhere' },
  { key: 'review_failed', title: 'Failed' },
]

const reviewTaskColumns: Array<{ key: ReviewTaskState; title: string }> = [
  { key: 'queued', title: 'Queued' },
  { key: 'pending_review', title: 'Pending Review' },
  { key: 'in_review', title: 'In Review' },
  { key: 'reviewed', title: 'Reviewed' },
  { key: 'waiting_implementation', title: 'Waiting Impl' },
  { key: 'done', title: 'Done' },
  { key: 'failed_review', title: 'Failed' },
]

const cliClientIcons: Record<string, string> = {
  claude: '<svg class="w-4 h-4" viewBox="0 0 100 100" fill="#D97757"><path d="M50 8 L53 42 L50 50 L47 42 Z" transform="rotate(0 50 50)"/><path d="M50 8 L53 42 L50 50 L47 42 Z" transform="rotate(30 50 50)"/><path d="M50 8 L53 42 L50 50 L47 42 Z" transform="rotate(60 50 50)"/><path d="M50 8 L53 42 L50 50 L47 42 Z" transform="rotate(90 50 50)"/><path d="M50 8 L53 42 L50 50 L47 42 Z" transform="rotate(120 50 50)"/><path d="M50 8 L53 42 L50 50 L47 42 Z" transform="rotate(150 50 50)"/><path d="M50 8 L53 42 L50 50 L47 42 Z" transform="rotate(180 50 50)"/><path d="M50 8 L53 42 L50 50 L47 42 Z" transform="rotate(210 50 50)"/><path d="M50 8 L53 42 L50 50 L47 42 Z" transform="rotate(240 50 50)"/><path d="M50 8 L53 42 L50 50 L47 42 Z" transform="rotate(270 50 50)"/><path d="M50 8 L53 42 L50 50 L47 42 Z" transform="rotate(300 50 50)"/><path d="M50 8 L53 42 L50 50 L47 42 Z" transform="rotate(330 50 50)"/><circle cx="50" cy="50" r="12"/></svg>',
  codex: '<svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/></svg>',
  opencode: '<svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M3 5h7v14H3V5zm2 2v10h3V7H5zm11-2h5v2h-5v4h3v2h-3v4h5v2h-7V5h2z"/></svg>',
}

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ')
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return 'Never'
  return new Date(value).toLocaleString()
}

function severityBadgeClass(severity: string) {
  switch (severity) {
    case 'critical':
      return 'linear-badge-red'
    case 'major':
      return 'linear-badge-yellow'
    case 'minor':
      return 'linear-badge-blue'
    case 'suggestion':
      return 'linear-badge-green'
    default:
      return 'linear-badge-default'
  }
}

function statusChipClass(status: string) {
  switch (status) {
    case 'in_review':
      return 'linear-badge-yellow'
    case 'review_failed':
    case 'failed_review':
      return 'linear-badge-red'
    case 'waiting_implementation':
      return 'linear-badge-purple'
    case 'done':
    case 'reviewed_by_others':
      return 'linear-badge-green'
    case 'reviewed':
    case 'reviewed_by_me':
      return 'linear-badge-blue'
    default:
      return 'linear-badge-default'
  }
}

function errorMessage(error: unknown) {
  if (error instanceof ApiResponseError) {
    return error.error.message
  }

  if (error instanceof Error) {
    return error.message
  }

  return 'Unknown error'
}

function DangerousHtml({ html, className }: { html: string | null | undefined; className?: string }) {
  if (!html) return null
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />
}

function CliClientIcon({ client, className = 'w-4 h-4' }: { client: string; className?: string }) {
  const icon = cliClientIcons[client] ?? cliClientIcons.claude
  return <span className={className} dangerouslySetInnerHTML={{ __html: icon.replace('class="w-4 h-4"', `class="${className}"`) }} />
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const { pushToast } = useToasts()

  return (
    <button
      type="button"
      className="linear-btn linear-btn-ghost linear-btn-sm"
      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      onClick={async () => {
        try {
          await setTheme(theme === 'dark' ? 'light' : 'dark')
        } catch (error) {
          pushToast(errorMessage(error), 'error')
        }
      }}
    >
      {theme === 'dark' ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
      )}
    </button>
  )
}

function HeaderNav() {
  return (
    <header className="linear-header">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="flex items-center gap-2.5">
          <img src="/icon.svg" alt="Forge" className="w-6 h-6" />
          <span className="text-sm font-bold tracking-tight">Forge</span>
        </div>
        <div className="hidden-mobile ml-1 h-4 w-px bg-[color:var(--color-border-default)]" />
        <nav className="hidden-mobile flex items-center gap-1">
          <NavLink to="/" className={({ isActive }) => classNames('linear-btn linear-btn-ghost linear-btn-sm', isActive && 'text-[color:var(--color-accent)] font-semibold')}>Pull Requests</NavLink>
          <NavLink to="/review_tasks" className={({ isActive }) => classNames('linear-btn linear-btn-ghost linear-btn-sm', isActive && 'text-[color:var(--color-accent)] font-semibold')}>Review Tasks</NavLink>
          <NavLink to="/repositories" className={({ isActive }) => classNames('linear-btn linear-btn-ghost linear-btn-sm', isActive && 'text-[color:var(--color-accent)] font-semibold')}>Repositories</NavLink>
          <NavLink to="/settings" className={({ isActive }) => classNames('linear-btn linear-btn-ghost linear-btn-sm', isActive && 'text-[color:var(--color-accent)] font-semibold')}>Settings</NavLink>
        </nav>
      </div>
      <ThemeToggle />
    </header>
  )
}

function UiEventSubscriptions() {
  const client = useQueryClient()
  const { pushToast } = useToasts()

  useEffect(() => subscribe(
    { channel: 'UiEventsChannel' },
    {
      received: (raw) => {
        if (isUiEventPayload(raw)) {
          handleUiEvent(raw, client, pushToast)
        }
      },
    },
  ), [client, pushToast])

  useEffect(() => subscribe(
    { channel: 'ReviewNotificationsChannel' },
    {
      received: (raw) => {
        if (isReviewNotificationPayload(raw)) {
          handleReviewNotification(raw, client, pushToast)
        }
      },
    },
  ), [client, pushToast])

  return null
}

function QueryBootstrap() {
  const bootstrap = useQuery({
    queryKey: queryKeys.bootstrap,
    queryFn: () => api.get<BootstrapResponse>('/api/v1/bootstrap'),
  })
  const { applyServerPreference } = useTheme()

  useEffect(() => {
    if (bootstrap.data) {
      applyServerPreference(bootstrap.data.settings.theme_preference)
    }
  }, [applyServerPreference, bootstrap.data])

  return null
}

function getPrSizeCategory(additions: number | null, deletions: number | null): { label: string, colorClass: string, lines: number } | null {
  if (additions == null || deletions == null) return null;
  const total = additions + deletions;
  if (total < 50) return { label: 'XS', colorClass: 'linear-badge-green', lines: total };
  if (total < 200) return { label: 'S', colorClass: 'linear-badge-blue', lines: total };
  if (total < 500) return { label: 'M', colorClass: 'linear-badge-yellow', lines: total };
  if (total < 1000) return { label: 'L', colorClass: 'linear-badge-orange', lines: total };
  return { label: 'XL', colorClass: 'linear-badge-red', lines: total };
}

function PullRequestCard({ item, selected, onSelect, onArchive, onStartReview }: {
  item: PullRequestItem
  selected: boolean
  onSelect: (checked: boolean) => void
  onArchive: () => void
  onStartReview: () => void
}) {
  const task = item.review_task
  const sizeCategory = getPrSizeCategory(item.additions, item.deletions)
  const waitingInfo = getWaitingInfo(item.updated_at_github)

  return (
    <div className="group relative flex items-center gap-3 p-3 rounded-lg border border-[color:var(--color-border-subtle)] bg-[color:var(--color-bg-primary)] hover:border-[color:var(--color-border-default)] transition-colors">
      <input checked={selected} onChange={(event) => onSelect(event.target.checked)} type="checkbox" className="rounded linear-checkbox-accent flex-shrink-0" />
      
      <div className="flex-1 min-w-0 flex flex-wrap sm:flex-nowrap items-center gap-3 sm:gap-4">
        {/* Main Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-mono text-[color:var(--color-text-tertiary)]">#{item.number}</span>
            <span className="text-xs font-medium text-[color:var(--color-text-secondary)]">{item.repo_name}</span>

            {waitingInfo && (
              <span className={classNames('linear-badge text-[10px] px-1.5 py-0', waitingInfo.colorClass)}>
                {waitingInfo.label}
              </span>
            )}

            {sizeCategory && (
              <span className={classNames('linear-badge text-[10px] px-1.5 py-0', sizeCategory.colorClass)} title={`${sizeCategory.lines} lines changed`}>
                {sizeCategory.label} • {sizeCategory.lines} lines
              </span>
            )}

            {task ? <span className={classNames('linear-badge text-[10px] px-1.5 py-0', statusChipClass(task.state))}>{task.state.replaceAll('_', ' ')}</span> : null}
            {item.review_requested_for_me ? <span className="linear-badge linear-badge-blue text-[10px] px-1.5 py-0">requested</span> : null}
            {item.analysis_status === 'stale' ? <span className="linear-badge linear-badge-yellow text-[10px] px-1.5 py-0">AI stale</span> : null}
            {item.draft ? <span className="linear-badge linear-badge-default text-[10px] px-1.5 py-0">draft</span> : null}
          </div>
          <a href={item.url} target="_blank" rel="noreferrer" className="block w-fit max-w-full">
            <h3 className="text-sm font-medium text-[color:var(--color-text-primary)] truncate hover:text-[color:var(--color-accent)] cursor-pointer">{item.title}</h3>
          </a>
          {item.analysis_status === 'stale' ? (
            <p className="mt-1 text-[11px] text-[color:var(--color-text-secondary)]">
              Remote revision changed from the reviewed snapshot. Refresh analysis before trusting prior AI output.
            </p>
          ) : null}
        </div>

        {/* Author */}
        <div className="w-full sm:w-32 flex-shrink-0 flex items-center justify-start sm:justify-end gap-2 text-xs text-[color:var(--color-text-secondary)] truncate">
          <span className="truncate">{item.author}</span>
          {item.author_avatar ? (
            <img src={item.author_avatar} alt={item.author || 'Author'} className="w-5 h-5 rounded-full flex-shrink-0 hidden sm:block" />
          ) : (
            <div className="w-5 h-5 rounded-full bg-[color:var(--color-bg-tertiary)] items-center justify-center flex-shrink-0 hidden sm:flex">
              {item.author?.charAt(0)?.toUpperCase() || '?'}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity flex-shrink-0">
          <button type="button" className="linear-btn linear-btn-ghost linear-btn-sm" onClick={onArchive} title="Archive">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
          {task ? (
            <NavLink to={`/review_tasks/${task.id}`} className="linear-btn linear-btn-secondary linear-btn-sm w-full sm:w-auto justify-center">
              {task.state === 'queued' || task.state === 'pending_review' || task.state === 'in_review' ? '⏳ Progress' : '📋 Review'}
            </NavLink>
          ) : (
             <button type="button" className="linear-btn linear-btn-ghost text-[color:var(--color-accent)] linear-btn-sm w-full sm:w-auto justify-center" onClick={onStartReview}>
              🚀 Start
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

const columnStatusColors: Record<string, string> = {
  pending_review: 'bg-[color:var(--color-status-todo)]',
  in_review: 'bg-[color:var(--color-status-inprogress)]',
  reviewed_by_me: 'bg-[color:var(--color-status-done)]',
  waiting_implementation: 'bg-[color:var(--color-status-review)]',
  reviewed_by_others: 'bg-[color:var(--color-status-done)]',
  review_failed: 'bg-[color:var(--color-status-blocked)]',
  queued: 'bg-[color:var(--color-text-tertiary)]',
  reviewed: 'bg-[color:var(--color-status-done)]',
  done: 'bg-[color:var(--color-status-done)]',
  failed_review: 'bg-[color:var(--color-status-blocked)]',
}

function PullRequestSection({ status, title, items, selectedIds, onSelect, onArchive, onStartReview }: {
  status: PullRequestStatus
  title: string
  items: PullRequestItem[]
  selectedIds: Set<number>
  onSelect: (id: number, checked: boolean) => void
  onArchive: (item: PullRequestItem) => void
  onStartReview: (item: PullRequestItem) => void
}) {
  const [expanded, setExpanded] = useState(true)

  return (
    <div className="mb-4 bg-[color:var(--color-bg-primary)] border border-[color:var(--color-border-default)] rounded-xl shadow-sm overflow-hidden">
      <button 
        type="button" 
        onClick={() => setExpanded(!expanded)} 
        className={classNames("w-full flex items-center justify-between px-4 py-3 bg-[color:var(--color-bg-secondary)] hover:bg-[color:var(--color-bg-tertiary)] transition-colors text-left", expanded && "border-b border-[color:var(--color-border-subtle)]")}
      >
        <div className="flex items-center gap-2.5">
          <span className={classNames('status-dot', columnStatusColors[status])} />
          <h2 className="font-semibold text-sm text-[color:var(--color-text-primary)]">{title}</h2>
          <span className="inline-flex items-center rounded-full bg-[color:var(--color-bg-tertiary)] px-2 py-0.5 text-xs font-medium text-[color:var(--color-text-secondary)]">
            {items.length}
          </span>
        </div>
        <svg 
          className={classNames("w-5 h-5 text-[color:var(--color-text-tertiary)] transition-transform", expanded ? "rotate-180" : "rotate-0")} 
          viewBox="0 0 20 20" 
          fill="currentColor"
        >
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </button>


      {expanded && (
        <div className="p-2 sm:p-3 space-y-2 bg-[color:var(--color-bg-secondary)]">
          {items.length > 0 ? items.map((item) => (
            <PullRequestCard
              key={item.id}
              item={item}
              selected={selectedIds.has(item.id)}
              onSelect={(checked) => onSelect(item.id, checked)}
              onArchive={() => onArchive(item)}
              onStartReview={() => onStartReview(item)}
            />
          )) : (
            <div className="py-8 text-center text-sm text-[color:var(--color-text-quaternary)]">
              No pull requests in this section
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function PullRequestsPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { pushToast } = useToasts()
  const [search, setSearch] = useState('')
  const [stateFilter, setStateFilter] = useState<'all' | PullRequestStatus>('all')
  const [requestedToMeOnly, setRequestedToMeOnly] = useState(false)
  const [showOwnPrs, setShowOwnPrs] = useState(true)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [reviewModalItem, setReviewModalItem] = useState<PullRequestItem | null>(null)
  const [sortBy, setSortBy] = useState<SortOption>('oldest')
  const [repoMenuOpen, setRepoMenuOpen] = useState(false)
  const [reviewForm, setReviewForm] = useState({ cli_client: 'claude', review_type: 'review' })

  const board = useQuery({
    queryKey: queryKeys.pullRequestBoard,
    queryFn: () => api.get<PullRequestBoardResponse>('/api/v1/pull_requests/board'),
  })

  useEffect(() => {
    if (board.data) {
      setReviewForm((current) => ({ ...current, cli_client: board.data.repositories.current_repo_slug ? current.cli_client : current.cli_client }))
      setRequestedToMeOnly(board.data.settings.only_requested_reviews)
    }
  }, [board.data])

  const syncMutation = useMutation({
    mutationFn: (force: boolean) => api.post<UiMutationResponse>('/api/v1/pull_requests/sync', { force }),
    onSuccess: (response) => {
      pushToast(response.message ?? 'Sync finished', 'success', { key: 'sync-status' })
      queryClient.invalidateQueries({ queryKey: queryKeys.pullRequestBoard })
      queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap })
    },
    onError: (error) => pushToast(errorMessage(error), 'error', { key: 'sync-status' }),
  })

  const reviewScopeMutation = useMutation({
    mutationFn: (requested_to_me_only: boolean) => api.patch<UiMutationResponse>('/api/v1/pull_requests/review_scope', { requested_to_me_only }),
    onSuccess: (response, requested_to_me_only) => {
      pushToast(response.message ?? 'Review scope updated', 'success', { key: 'review-scope' })
      queryClient.setQueryData<PullRequestBoardResponse | undefined>(queryKeys.pullRequestBoard, (current) => {
        if (!current) return current

        return {
          ...current,
          settings: {
            ...current.settings,
            only_requested_reviews: requested_to_me_only,
          },
        }
      })
      queryClient.setQueryData<BootstrapResponse | undefined>(queryKeys.bootstrap, (current) => {
        if (!current) return current

        return {
          ...current,
          settings: {
            ...current.settings,
            only_requested_reviews: requested_to_me_only,
          },
        }
      })
    },
    onError: (error, requested_to_me_only) => {
      setRequestedToMeOnly(!requested_to_me_only)
      pushToast(errorMessage(error), 'error', { key: 'review-scope' })
    },
  })



  const archiveMutation = useMutation({
    mutationFn: (id: number) => api.patch<UiMutationResponse>(`/api/v1/pull_requests/${id}/archive`),
    onSuccess: (response) => {
      pushToast(response.message ?? 'Pull request archived', 'success')
      setSelectedIds(new Set())
      queryClient.invalidateQueries({ queryKey: queryKeys.pullRequestBoard })
    },
    onError: (error) => pushToast(errorMessage(error), 'error'),
  })

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: number[]) => api.delete<UiMutationResponse>('/api/v1/pull_requests/bulk_destroy', { pull_request_ids: ids }),
    onSuccess: (response) => {
      pushToast(response.message ?? 'Deleted', 'success')
      setSelectedIds(new Set())
      queryClient.invalidateQueries({ queryKey: queryKeys.pullRequestBoard })
    },
    onError: (error) => pushToast(errorMessage(error), 'error'),
  })

  const startReviewMutation = useMutation({
    mutationFn: ({ id, cli_client, review_type }: { id: number; cli_client: string; review_type: string }) =>
      api.post<UiMutationResponse>(`/api/v1/pull_requests/${id}/review_task`, { cli_client, review_type }),
    onSuccess: (response) => {
      pushToast(response.message ?? 'Review started', 'success')
      setReviewModalItem(null)
      queryClient.invalidateQueries({ queryKey: queryKeys.pullRequestBoard })
      queryClient.invalidateQueries({ queryKey: queryKeys.reviewTaskBoard })
      if (response.detail?.task?.id) {
        navigate(`/review_tasks/${response.detail.task.id}`)
      }
    },
    onError: (error) => pushToast(errorMessage(error), 'error'),
  })

  const switchRepoMutation = useMutation({
    mutationFn: (repo: string) => api.post<UiMutationResponse>('/api/v1/repositories/switch', { repo }),
    onSuccess: (response) => {
      pushToast(response.message ?? 'Repository switched', 'success')
      setRepoMenuOpen(false)
      queryClient.invalidateQueries({ queryKey: queryKeys.pullRequestBoard })
      queryClient.invalidateQueries({ queryKey: queryKeys.repositories })
      queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap })
    },
    onError: (error) => pushToast(errorMessage(error), 'error'),
  })

  const filteredColumns = useMemo(() => {
    if (!board.data) return null

    return filterPullRequestColumns({
      board: board.data,
      search,
      stateFilter,
      showOwnPrs,
      requestedToMeOnly,
      sortBy,
    })
  }, [board.data, requestedToMeOnly, search, showOwnPrs, stateFilter, sortBy])

  const visibleCount = filteredColumns ? Object.values(filteredColumns).reduce((sum, items) => sum + items.length, 0) : 0

  useEffect(() => {
    if (!board.data) return

    const maybeSync = () => {
      if (document.visibilityState !== 'visible') return
      if (!board.data.sync_status.sync_needed) return
      if (syncMutation.isPending) return

      syncMutation.mutate(false)
    }

    maybeSync()

    const intervalId = window.setInterval(maybeSync, 120_000)
    const onVisibilityChange = () => {
      maybeSync()
    }

    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [board.data, syncMutation])



  if (board.isLoading) {
    return <LoadingScreen label="Loading pull requests..." />
  }

  if (board.isError || !board.data || !filteredColumns) {
    return <ErrorScreen message={errorMessage(board.error)} />
  }

  return (
    <div className="min-h-screen">
      <HeaderNav />
      <div className="linear-filter-bar">
        <div className="flex flex-wrap items-center gap-2 flex-1">
          <RepoSwitcher
            currentRepoName={board.data.current_repo.name}
            menuOpen={repoMenuOpen}
            repositories={board.data.repositories}
            onToggle={() => setRepoMenuOpen((value) => !value)}
            onSelectRepo={(slug) => switchRepoMutation.mutate(slug)}
            onOpenSettings={() => {
              setRepoMenuOpen(false)
              navigate('/settings')
            }}
            onOpenRepositories={() => {
              setRepoMenuOpen(false)
              navigate('/repositories')
            }}
          />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search PRs..." className="linear-input w-[200px]" />
          <select 
            value={stateFilter} 
            onChange={(event) => {
              const value = event.target.value
              if (value === 'all' || isPullRequestStatus(value)) {
                setStateFilter(value)
              }
            }} 
            className="linear-select"
          >
            <option value="all">All states</option>
            {pullRequestColumns.map((column) => <option key={column.key} value={column.key}>{column.title}</option>)}
          </select>
          <div className="hidden-mobile h-4 w-px bg-[color:var(--color-border-default)]" />
          <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
            <input
              checked={requestedToMeOnly}
              onChange={(event) => {
                const nextValue = event.target.checked
                setRequestedToMeOnly(nextValue)
                reviewScopeMutation.mutate(nextValue)
              }}
              type="checkbox"
              className="rounded linear-checkbox-accent"
            />
            Requested to me only
          </label>
          <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
            <input checked={showOwnPrs} onChange={(event) => setShowOwnPrs(event.target.checked)} type="checkbox" className="rounded linear-checkbox-accent" />
            Show my PRs
          </label>
          <div className="hidden-mobile h-4 w-px bg-[color:var(--color-border-default)] mx-1" />
          <select 
            value={sortBy} 
            onChange={(event) => {
              const value = event.target.value
              if (isSortOption(value)) {
                setSortBy(value)
              }
            }} 
            className="linear-select hidden-mobile"
          >
            <option value="longest_waiting">Sort: Longest Waiting</option>
            <option value="oldest">Sort: Oldest</option>
            <option value="newest">Sort: Newest</option>
            <option value="recent_activity">Sort: Recent Activity</option>
            <option value="smallest_diff">Sort: Smallest Diff</option>
            <option value="repo">Sort: Repository</option>
            <option value="author">Sort: Author</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="linear-btn linear-btn-primary" disabled={syncMutation.isPending || board.data.sync_status.running} onClick={() => syncMutation.mutate(false)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            {syncMutation.isPending || board.data.sync_status.running ? 'Syncing…' : 'Sync'}
          </button>
          {!board.data.sync_status.sync_needed ? (
            <button type="button" className="linear-btn linear-btn-ghost" onClick={() => syncMutation.mutate(true)}>Force sync</button>
          ) : null}
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 px-5 py-2 text-[11px] text-[color:var(--color-text-tertiary)] border-b border-[color:var(--color-border-subtle)] bg-[color:var(--color-bg-secondary)]">
        <span>{visibleCount} PRs shown</span>
        <div className="flex items-center gap-3">
          {selectedIds.size > 0 ? (
            <button type="button" className="linear-btn linear-btn-danger linear-btn-sm" onClick={() => {
              if (window.confirm(`Delete ${selectedIds.size} pull requests?`)) {
                bulkDeleteMutation.mutate([ ...selectedIds ])
              }
            }}>
              Delete Selected ({selectedIds.size})
            </button>
          ) : null}
          <span>Sync: {board.data.sync_status.status}</span>
          <span>Last synced: {formatDateTime(board.data.sync_status.last_synced_at)}</span>
        </div>
      </div>
      {board.data.sync_status.last_error ? (
        <div className="mx-auto mt-4 max-w-5xl rounded-lg border border-[color:var(--color-surface-danger-border)] bg-[color:var(--color-surface-danger-bg)] px-4 py-3 text-sm text-[color:var(--color-surface-danger-text)]">
          Sync error: {board.data.sync_status.last_error}
        </div>
      ) : null}
      <div className="max-w-5xl mx-auto p-4 md:p-6 sm:space-y-6 space-y-4">
        {pullRequestColumns.map((column) => (
          <PullRequestSection
            key={column.key}
            status={column.key}
            title={column.title}
            items={filteredColumns[column.key]}
            selectedIds={selectedIds}
            onSelect={(id, checked) => setSelectedIds((current) => {
              const next = new Set(current)
              if (checked) next.add(id)
              else next.delete(id)
              return next
            })}
            onArchive={(item) => {
              if (window.confirm(`Archive PR #${item.number}?`)) {
                archiveMutation.mutate(item.id)
              }
            }}
            onStartReview={setReviewModalItem}
          />
        ))}
      </div>
      {reviewModalItem ? (
        <Modal title={`Start review for #${reviewModalItem.number}`} onClose={() => setReviewModalItem(null)}>
          <div className="space-y-4">
            <PullRequestSummaryPanel summary={reviewModalItem.ai_summary} />
            <div>
              <label className="mb-2 block text-sm font-medium">Agent</label>
              <select className="linear-select w-full" value={reviewForm.cli_client} onChange={(event) => setReviewForm((current) => ({ ...current, cli_client: event.target.value }))}>
                {['claude', 'codex', 'opencode'].map((client) => <option key={client} value={client}>{client}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium">Review type</label>
              <select className="linear-select w-full" value={reviewForm.review_type} onChange={(event) => setReviewForm((current) => ({ ...current, review_type: event.target.value }))}>
                <option value="review">Standard review</option>
                <option value="swarm">Swarm review</option>
              </select>
            </div>
            <button type="button" className="linear-btn linear-btn-primary w-full" onClick={() => startReviewMutation.mutate({ id: reviewModalItem.id, ...reviewForm })}>
              Start Review
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}

function ReviewTaskCard({ item, onArchive, onRetry, onDequeue }: {
  item: ReviewTaskItem
  onArchive: (item: ReviewTaskItem) => void
  onRetry: (item: ReviewTaskItem) => void
  onDequeue: (item: ReviewTaskItem) => void
}) {
  return (
    <div className="linear-card group">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="linear-card-id">#{item.pull_request?.number}</span>
        <span className={`linear-badge ${statusChipClass(item.state)}`}>{item.state.replaceAll('_', ' ')}</span>
      </div>
      <h3 className="linear-card-title line-clamp-2">
        <NavLink to={`/review_tasks/${item.id}`}>{item.pull_request?.title}</NavLink>
      </h3>
      <div className="linear-card-meta">
        <span className="linear-card-label">{item.pull_request?.repo_name}</span>
        <div className="flex-1" />
        <span className="text-[11px] text-[color:var(--color-text-tertiary)]">{item.pull_request?.author}</span>
      </div>
      <div className="mt-3 pt-2.5 border-t border-[color:var(--color-border-subtle)] flex flex-wrap gap-2">
        <button type="button" className="linear-btn linear-btn-ghost linear-btn-sm opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => onArchive(item)} title="Archive">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
        {item.state === 'queued' ? <button type="button" className="linear-btn linear-btn-ghost linear-btn-sm" onClick={() => onDequeue(item)}>Dequeue</button> : null}
        {item.state === 'failed_review' && item.can_retry ? <button type="button" className="linear-btn linear-btn-ghost linear-btn-sm" onClick={() => onRetry(item)}>Retry</button> : null}
      </div>
    </div>
  )
}

function ReviewTaskDraggableCard({ item, onArchive, onRetry, onDequeue }: {
  item: ReviewTaskItem
  onArchive: (item: ReviewTaskItem) => void
  onRetry: (item: ReviewTaskItem) => void
  onDequeue: (item: ReviewTaskItem) => void
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `task-card:${item.id}`, data: { item } })
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined

  return (
    <div ref={setNodeRef} style={style} className={classNames(isDragging && 'opacity-60')} {...attributes} {...listeners}>
      <ReviewTaskCard item={item} onArchive={onArchive} onRetry={onRetry} onDequeue={onDequeue} />
    </div>
  )
}

function ReviewTaskColumn({ state, title, items, onArchive, onRetry, onDequeue }: {
  state: ReviewTaskState
  title: string
  items: ReviewTaskItem[]
  onArchive: (item: ReviewTaskItem) => void
  onRetry: (item: ReviewTaskItem) => void
  onDequeue: (item: ReviewTaskItem) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `task:${state}`, data: { state } })

  return (
    <div className="linear-column">
      <div className="linear-column-header">
        <span className={classNames('status-dot', columnStatusColors[state] ?? 'bg-[color:var(--color-text-tertiary)]')} />
        <span>{title}</span>
        <span className="count">{items.length}</span>
      </div>
      <div ref={setNodeRef} className={classNames('linear-column-content', isOver && 'kanban-column--active')}>
        {items.map((item) => (
          <ReviewTaskDraggableCard key={item.id} item={item} onArchive={onArchive} onRetry={onRetry} onDequeue={onDequeue} />
        ))}
        {items.length === 0 ? <p className="py-8 text-center text-xs text-[color:var(--color-text-quaternary)]">No review tasks</p> : null}
      </div>
    </div>
  )
}

function ReviewTasksPage() {
  const queryClient = useQueryClient()
  const { pushToast } = useToasts()
  const [search, setSearch] = useState('')
  const [stateFilter, setStateFilter] = useState<'all' | ReviewTaskState>('all')
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  const board = useQuery({
    queryKey: queryKeys.reviewTaskBoard,
    queryFn: () => api.get<ReviewTaskBoardResponse>('/api/v1/review_tasks/board'),
  })

  const updateStateMutation = useMutation({
    mutationFn: ({ id, state, backward_move }: { id: number; state: ReviewTaskState; backward_move?: boolean }) =>
      api.patch<UiMutationResponse>(`/api/v1/review_tasks/${id}/state`, { state, backward_move }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.reviewTaskBoard })
      queryClient.invalidateQueries({ queryKey: queryKeys.pullRequestBoard })
    },
    onError: (error) => pushToast(errorMessage(error), 'error'),
  })

  const retryMutation = useMutation({
    mutationFn: (id: number) => api.post<UiMutationResponse>(`/api/v1/review_tasks/${id}/retry`),
    onSuccess: (response) => {
      pushToast(response.message ?? 'Retry initiated', 'success')
      queryClient.invalidateQueries({ queryKey: queryKeys.reviewTaskBoard })
      queryClient.invalidateQueries({ queryKey: queryKeys.pullRequestBoard })
    },
    onError: (error) => pushToast(errorMessage(error), 'error'),
  })

  const dequeueMutation = useMutation({
    mutationFn: (id: number) => api.delete<UiMutationResponse>(`/api/v1/review_tasks/${id}/dequeue`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.reviewTaskBoard }),
    onError: (error) => pushToast(errorMessage(error), 'error'),
  })

  const archiveMutation = useMutation({
    mutationFn: (id: number) => api.patch<UiMutationResponse>(`/api/v1/review_tasks/${id}/archive`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.reviewTaskBoard }),
    onError: (error) => pushToast(errorMessage(error), 'error'),
  })

  const filteredColumns = useMemo(() => {
    if (!board.data) return null
    
    const next: ReviewTaskBoardResponse['columns'] = {
      queued: [],
      pending_review: [],
      in_review: [],
      reviewed: [],
      waiting_implementation: [],
      done: [],
      failed_review: []
    }

    for (const column of reviewTaskColumns) {
      next[column.key] = board.data.columns[column.key].filter((item) => {
        const haystack = `${item.pull_request?.title ?? ''} ${item.pull_request?.repo_full_name ?? ''}`.toLowerCase()
        return (!search || haystack.includes(search.toLowerCase())) && (stateFilter === 'all' || item.state === stateFilter)
      })
    }

    return next
  }, [board.data, search, stateFilter])

  function isBackwardMove(currentState: ReviewTaskState, nextState: ReviewTaskState) {
    return reviewTaskColumns.findIndex((item) => item.key === nextState) < reviewTaskColumns.findIndex((item) => item.key === currentState)
  }

  function handleDragEnd(event: DragEndEvent) {
    const item = event.active.data.current?.item
    if (!isReviewTaskItem(item)) return
    
    const overId = event.over?.id
    if (typeof overId !== 'string' || !overId.startsWith('task:')) return
    
    const nextState = overId.replace('task:', '')
    if (!isReviewTaskState(nextState)) return
    
    if (nextState === item.state) return
    const backward_move = isBackwardMove(item.state, nextState)
    if (backward_move && !window.confirm(`Move review task back from ${item.state} to ${nextState}?`)) return
    updateStateMutation.mutate({ id: item.id, state: nextState, backward_move })
  }

  if (board.isLoading) {
    return <LoadingScreen label="Loading review tasks..." />
  }

  if (board.isError || !board.data || !filteredColumns) {
    return <ErrorScreen message={errorMessage(board.error)} />
  }

  return (
    <div className="min-h-screen">
      <HeaderNav />
      <div className="linear-filter-bar">
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search review tasks..." className="linear-input w-[240px]" />
        <select 
          value={stateFilter} 
          onChange={(event) => {
            const value = event.target.value
            if (value === 'all' || isReviewTaskState(value)) {
              setStateFilter(value)
            }
          }} 
          className="linear-select"
        >
          <option value="all">All states</option>
          {reviewTaskColumns.map((column) => <option key={column.key} value={column.key}>{column.title}</option>)}
        </select>
      </div>
      <div className="linear-board">
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          {reviewTaskColumns.map((column) => (
            <ReviewTaskColumn
              key={column.key}
              state={column.key}
              title={column.title}
              items={filteredColumns[column.key]}
              onArchive={(item) => {
                if (window.confirm(`Archive review task #${item.id}?`)) archiveMutation.mutate(item.id)
              }}
              onRetry={(item) => retryMutation.mutate(item.id)}
              onDequeue={(item) => dequeueMutation.mutate(item.id)}
            />
          ))}
        </DndContext>
      </div>
    </div>
  )
}

function ReviewLogStream({ taskId, initialLogs }: { taskId: string; initialLogs: AgentLogItem[] }) {
  const [logs, setLogs] = useState<AgentLogItem[]>(initialLogs)
  const queryClient = useQueryClient()

  useEffect(() => {
    setLogs(initialLogs)
  }, [initialLogs])

  useEffect(() => subscribe(
    { channel: 'ReviewTaskLogsChannel', review_task_id: taskId },
    {
      received: (data) => {
        if (!data || typeof data !== 'object' || Array.isArray(data)) return

        if ('type' in data && (data.type === 'completed' || data.type === 'failed' || data.type === 'retry_scheduled' || data.type === 'preparing')) {
          queryClient.invalidateQueries({ queryKey: queryKeys.reviewTaskDetail(taskId) })
          queryClient.invalidateQueries({ queryKey: queryKeys.reviewTaskBoard })
          queryClient.invalidateQueries({ queryKey: queryKeys.pullRequestBoard })
          return
        }

        if (
          'id' in data && typeof data.id === 'number' &&
          'message' in data && typeof data.message === 'string' &&
          'log_type' in data && typeof data.log_type === 'string' &&
          (data.log_type === 'output' || data.log_type === 'error' || data.log_type === 'status') &&
          'created_at' in data && typeof data.created_at === 'string'
        ) {
          const newLog: AgentLogItem = {
            id: data.id,
            message: data.message,
            log_type: data.log_type,
            created_at: data.created_at,
          }
          setLogs((current) => current.concat(newLog))
        }
      },
    },
  ), [queryClient, taskId])

  return (
    <div className="max-h-[480px] overflow-y-auto rounded-lg border bg-[color:var(--color-bg-tertiary)] p-4">
      {logs.map((log) => (
        <div key={log.id} className={classNames('font-mono text-[13px] leading-relaxed py-0.5', log.log_type === 'error' && 'text-red-400', log.log_type === 'status' && 'text-[color:var(--color-accent)] font-medium', log.log_type === 'output' && 'text-[color:var(--color-text-secondary)]')}>
          {log.message}
        </div>
      ))}
    </div>
  )
}

function ReviewItemBlock({ item }: { item: ParsedReviewItem }) {
  return (
    <div className="linear-checklist-item">
      <div className="linear-checklist-item-content">
        <div className="flex-1 min-w-0">
          <div className="linear-checklist-header">
            <div className="linear-checklist-meta linear-checklist-meta-primary">
              <span className="linear-checklist-title">{item.title ?? 'Untitled finding'}</span>
              <code className="linear-checklist-location">{item.location}</code>
              <span className={`linear-badge ${severityBadgeClass(item.severity)}`}>{item.severity}</span>
            </div>
          </div>
          <DangerousHtml html={item.comment_html} className="linear-checklist-body prose prose-sm max-w-none" />
          <DangerousHtml html={item.suggested_fix_html} className="mt-4" />
        </div>
      </div>
    </div>
  )
}

function ReviewHistoryBlock({ item }: { item: ReviewIterationItem }) {
  return (
    <details className="rounded-lg border bg-[color:var(--color-bg-secondary)] p-4">
      <summary className="cursor-pointer text-sm font-medium">
        Iteration #{item.iteration_number} · {item.cli_client} · {formatDateTime(item.completed_at)}
      </summary>
      <div className="mt-4 space-y-4">
        {item.output_mode === 'parsed_review_items' ? item.parsed_review_items.map((reviewItem, index) => <ReviewItemBlock key={`${item.id}:${index}`} item={reviewItem} />) : <DangerousHtml html={item.raw_output_html} className="prose prose-sm max-w-none" />}
      </div>
    </details>
  )
}

function ReviewCommentsChecklist({ detail }: { detail: ReviewTaskDetailResponse }) {
  const queryClient = useQueryClient()
  const { pushToast } = useToasts()
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [event, setEvent] = useState('COMMENT')
  const [summary, setSummary] = useState('')

  const toggleCommentMutation = useMutation({
    mutationFn: (id: number) => api.patch<UiMutationResponse>(`/api/v1/review_comments/${id}/toggle`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.reviewTaskDetail(String(detail.task.id)) }),
    onError: (error) => pushToast(errorMessage(error), 'error'),
  })

  const submitMutation = useMutation({
    mutationFn: () => api.post<UiMutationResponse>(`/api/v1/review_tasks/${detail.task.id}/submissions`, {
      event,
      summary,
      comment_ids: [ ...selectedIds ],
      force_empty_submission: event === 'APPROVE' && selectedIds.size === 0,
    }),
    onSuccess: (response) => {
      pushToast(response.message ?? 'Review submitted', 'success')
      queryClient.invalidateQueries({ queryKey: queryKeys.reviewTaskDetail(String(detail.task.id)) })
      queryClient.invalidateQueries({ queryKey: queryKeys.reviewTaskBoard })
      queryClient.invalidateQueries({ queryKey: queryKeys.pullRequestBoard })
    },
    onError: (error) => pushToast(errorMessage(error), 'error'),
  })

  const pendingComments = detail.comments.filter((comment) => comment.status === 'pending')
  const selectedCount = selectedIds.size

  return (
    <div className="space-y-4">
      <div className="linear-checklist-toolbar flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <button type="button" className="linear-btn linear-btn-ghost text-[12px]" onClick={() => {
            if (selectedCount === pendingComments.length) {
              setSelectedIds(new Set())
            } else {
              setSelectedIds(new Set(pendingComments.map((comment) => comment.id)))
            }
          }}>
            {selectedCount === pendingComments.length ? 'Clear' : 'Select All'}
          </button>
          <span className="linear-checklist-counter text-[12px]">{selectedCount} of {pendingComments.length} selected</span>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <select className="linear-select" value={event} onChange={(e) => setEvent(e.target.value)}>
            {detail.submission.allowed_events.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <input value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="Optional summary" className="linear-input flex-1" />
          <button type="button" className="linear-btn linear-btn-primary" disabled={selectedCount === 0 && event !== 'APPROVE'} onClick={() => {
            const needsConfirm = detail.submission.auto_submit_enabled
            if (needsConfirm && !window.confirm(`Submit ${event} to GitHub?`)) return
            submitMutation.mutate()
          }}>
            Submit to GitHub
          </button>
        </div>
      </div>
      <div className="linear-checklist">
        {detail.comments.map((comment) => (
          <div key={comment.id} className={classNames('linear-checklist-item', comment.status === 'dismissed' && 'is-dismissed')}>
            <div className="linear-checklist-item-content">
              <div className="flex-shrink-0">
                {comment.status === 'pending' ? (
                  <input type="checkbox" className="linear-checkbox" checked={selectedIds.has(comment.id)} onChange={(event) => setSelectedIds((current) => {
                    const next = new Set(current)
                    if (event.target.checked) next.add(comment.id)
                    else next.delete(comment.id)
                    return next
                  })} />
                ) : (
                  <span className={`linear-badge ${statusChipClass(comment.status)} text-[10px]`}>{comment.status}</span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="linear-checklist-header">
                  <div className="linear-checklist-meta linear-checklist-meta-primary">
                    <span className="linear-checklist-title">{comment.title ?? 'Untitled comment'}</span>
                    <code className="linear-checklist-location">{comment.location}</code>
                    <span className={`linear-badge ${severityBadgeClass(comment.severity)}`}>{comment.severity}</span>
                  </div>
                  <button type="button" className="linear-btn linear-btn-ghost linear-checklist-toggle-btn" onClick={() => toggleCommentMutation.mutate(comment.id)}>
                    Toggle
                  </button>
                </div>
                <DangerousHtml html={comment.body_html} className="linear-checklist-body prose prose-sm max-w-none" />
                {comment.resolution_note ? <div className="linear-checklist-note"><strong>Note:</strong> {comment.resolution_note}</div> : null}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ReviewTaskDetailPage() {
  const { id = '' } = useParams()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { pushToast } = useToasts()

  const detail = useQuery({
    queryKey: queryKeys.reviewTaskDetail(id),
    queryFn: () => api.get<ReviewTaskDetailResponse>(`/api/v1/review_tasks/${id}`),
  })

  const clearMutation = useMutation({
    mutationFn: () => api.delete<UiMutationResponse>(`/api/v1/review_tasks/${id}/clear`),
    onSuccess: () => {
      pushToast('Review cleared', 'success')
      queryClient.invalidateQueries({ queryKey: queryKeys.reviewTaskBoard })
      queryClient.invalidateQueries({ queryKey: queryKeys.pullRequestBoard })
      navigate('/')
    },
    onError: (error) => pushToast(errorMessage(error), 'error'),
  })

  if (detail.isLoading) {
    return <LoadingScreen label="Loading review task..." />
  }

  if (detail.isError || !detail.data) {
    return <ErrorScreen message={errorMessage(detail.error)} />
  }

  return (
    <div className="min-h-screen">
      <HeaderNav />
      <div className="linear-filter-bar flex items-center justify-between gap-3">
        <div>
          <h1 className="text-sm font-semibold">PR #{detail.data.task.pull_request?.number}</h1>
          <p className="text-xs text-[color:var(--color-text-tertiary)]">{detail.data.task.pull_request?.title}</p>
        </div>
        <div className="flex items-center gap-2">
          <a href={detail.data.task.pull_request?.url} target="_blank" rel="noreferrer" className="linear-btn linear-btn-secondary">GitHub</a>
          <button type="button" className="linear-btn linear-btn-ghost" onClick={() => clearMutation.mutate()}>Clear Review</button>
        </div>
      </div>
      <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
        <div className="rounded-lg border bg-[color:var(--color-bg-secondary)] p-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-[color:var(--color-text-tertiary)]">
            <span className={`linear-badge ${statusChipClass(detail.data.task.state)}`}>{detail.data.task.state.replaceAll('_', ' ')}</span>
            <span className="inline-flex items-center gap-1"><CliClientIcon client={detail.data.task.cli_client} /> {detail.data.task.cli_client}</span>
            <span>Started: {formatDateTime(detail.data.task.started_at)}</span>
            <span>Completed: {formatDateTime(detail.data.task.completed_at)}</span>
            <span>Duration: {detail.data.meta.formatted_duration ?? 'N/A'}</span>
          </div>
        </div>

        {detail.data.review_history.length > 0 ? (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold">Review History</h2>
            {detail.data.review_history.map((iteration) => <ReviewHistoryBlock key={iteration.id} item={iteration} />)}
          </section>
        ) : null}

        {detail.data.content_mode === 'comments' ? (
          <ReviewCommentsChecklist key={detail.data.task.id} detail={detail.data} />
        ) : null}

        {detail.data.content_mode === 'parsed_review_items' ? (
          <section className="space-y-3">
            {detail.data.parsed_review_items.map((item, index) => <ReviewItemBlock key={`${detail.data.task.id}:${index}`} item={item} />)}
          </section>
        ) : null}

        {detail.data.content_mode === 'raw_output' ? (
          <section className="rounded-lg border bg-[color:var(--color-bg-secondary)] p-4">
            <DangerousHtml html={detail.data.raw_output_html} className="prose prose-sm max-w-none" />
          </section>
        ) : null}

        {detail.data.content_mode === 'live_logs' ? (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold">Agent Output</h2>
            <ReviewLogStream taskId={id} initialLogs={detail.data.live_logs} />
          </section>
        ) : null}

        {detail.data.content_mode === 'empty' ? (
          <section className="rounded-lg border bg-[color:var(--color-bg-secondary)] p-8 text-center text-sm text-[color:var(--color-text-tertiary)]">
            No review output available yet.
          </section>
        ) : null}
      </div>
    </div>
  )
}

function RepositoriesPage() {
  const { pushToast } = useToasts()
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const repositories = useQuery({
    queryKey: queryKeys.repositories,
    queryFn: () => api.get<RepositoryListResponse>('/api/v1/repositories'),
  })

  const switchMutation = useMutation({
    mutationFn: (slug: string) => api.post<UiMutationResponse>('/api/v1/repositories/switch', { repo: slug }),
    onSuccess: (response) => {
      pushToast(response.message ?? 'Repository switched', 'success')
      queryClient.invalidateQueries({ queryKey: queryKeys.repositories })
      queryClient.invalidateQueries({ queryKey: queryKeys.pullRequestBoard })
      queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap })
      navigate('/')
    },
    onError: (error) => pushToast(errorMessage(error), 'error'),
  })

  if (repositories.isLoading) {
    return <LoadingScreen label="Loading repositories..." />
  }

  if (repositories.isError || !repositories.data) {
    return <ErrorScreen message={errorMessage(repositories.error)} />
  }

  return (
    <div className="min-h-screen">
      <HeaderNav />
      <div className="mx-auto max-w-4xl p-4 md:p-6">
        <div className="mb-4 rounded-lg border bg-[color:var(--color-bg-secondary)] px-4 py-3">
          <p className="text-sm">Scanning folder: <code>{repositories.data.repos_folder ?? 'Not configured'}</code></p>
        </div>
        <div className="overflow-hidden rounded-lg border bg-[color:var(--color-bg-secondary)]">
          <ul className="divide-y divide-[color:var(--color-border-default)]">
            {repositories.data.items.map((repo) => (
              <li key={repo.path}>
                <button type="button" className="flex w-full items-center justify-between px-4 py-4 text-left hover:bg-[color:var(--color-bg-tertiary)]" onClick={() => repo.slug && switchMutation.mutate(repo.slug)}>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{repo.name}</span>
                      {repo.current ? <span className="linear-badge linear-badge-blue">Current</span> : null}
                    </div>
                    <p className="mt-1 text-xs text-[color:var(--color-text-tertiary)]">{repo.path}</p>
                  </div>
                  <span className="text-xs text-[color:var(--color-text-tertiary)]">{repo.branch}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

function SettingsPage() {
  const { pushToast } = useToasts()
  const queryClient = useQueryClient()
  const settings = useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => api.get<SettingsResponse>('/api/v1/settings'),
  })

  const [form, setForm] = useState({
    repos_folder: '',
    default_cli_client: 'claude',
    auto_submit_enabled: true,
  })

  useEffect(() => {
    if (settings.data) {
      setForm({
        repos_folder: settings.data.repos_folder ?? '',
        default_cli_client: settings.data.default_cli_client,
        auto_submit_enabled: settings.data.auto_submit_enabled,
      })
    }
  }, [settings.data])

  const updateMutation = useMutation({
    mutationFn: () => api.patch<UiMutationResponse>('/api/v1/settings', form),
    onSuccess: (response) => {
      pushToast(response.message ?? 'Settings updated', 'success')
      queryClient.invalidateQueries({ queryKey: queryKeys.settings })
      queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap })
      queryClient.invalidateQueries({ queryKey: queryKeys.repositories })
    },
    onError: (error) => pushToast(errorMessage(error), 'error'),
  })

  const pickFolderMutation = useMutation({
    mutationFn: () => api.post<{ path: string | null }>('/api/v1/settings/pick_folder'),
    onSuccess: (response) => setForm((current) => ({ ...current, repos_folder: response.path ?? '' })),
    onError: (error) => pushToast(errorMessage(error), 'error'),
  })

  if (settings.isLoading) {
    return <LoadingScreen label="Loading settings..." />
  }

  if (settings.isError || !settings.data) {
    return <ErrorScreen message={errorMessage(settings.error)} />
  }

  return (
    <div className="min-h-screen">
      <HeaderNav />
      <div className="mx-auto max-w-xl p-4 md:p-6">
        <div className="rounded-lg border bg-[color:var(--color-bg-secondary)] p-6">
          <div className="mb-6">
            <label className="mb-2 block text-sm font-medium">Repos Folder</label>
            <div className="flex gap-2">
              <input className="linear-input flex-1" value={form.repos_folder} onChange={(event) => setForm((current) => ({ ...current, repos_folder: event.target.value }))} />
              <button type="button" className="linear-btn linear-btn-secondary" onClick={() => pickFolderMutation.mutate()}>Browse</button>
            </div>
          </div>
          <div className="mb-6">
            <label className="mb-2 block text-sm font-medium">Default CLI Client</label>
            <select className="linear-select w-full" value={form.default_cli_client} onChange={(event) => setForm((current) => ({ ...current, default_cli_client: event.target.value }))}>
              {settings.data.cli_clients.map((client) => <option key={client} value={client}>{client}</option>)}
            </select>
          </div>
          <label className="mb-6 flex items-center gap-2 text-sm">
            <input type="checkbox" className="rounded linear-checkbox-accent" checked={form.auto_submit_enabled} onChange={(event) => setForm((current) => ({ ...current, auto_submit_enabled: event.target.checked }))} />
            Show confirmation before submitting reviews
          </label>
          <div className="flex justify-end">
            <button type="button" className="linear-btn linear-btn-primary" onClick={() => updateMutation.mutate()}>Save Settings</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Modal({ title, onClose, children }: React.PropsWithChildren<{ title: string; onClose: () => void }>) {
  return (
    <div className="linear-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="linear-modal-panel w-full max-w-lg" onClick={(event) => event.stopPropagation()}>
        <div className="linear-modal-header">
          <h2 className="linear-modal-title">{title}</h2>
          <button type="button" className="linear-modal-close" onClick={onClose}>Close</button>
        </div>
        <div className="linear-modal-body">{children}</div>
      </div>
    </div>
  )
}

function LoadingScreen({ label }: { label: string }) {
  return (
    <div className="min-h-screen">
      <HeaderNav />
      <div className="flex items-center justify-center gap-3 p-12">
        <svg className="animate-spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2.5"><circle cx="12" cy="12" r="10" strokeOpacity="0.2" /><path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" /></svg>
        <span className="text-sm text-[color:var(--color-text-tertiary)]">{label}</span>
      </div>
    </div>
  )
}

function ErrorScreen({ message }: { message: string }) {
  return (
    <div className="min-h-screen">
      <HeaderNav />
      <div className="flex items-center gap-3 p-6 mx-4 mt-6 rounded-xl" style={{ background: 'var(--color-surface-danger-bg)', border: '1px solid var(--color-surface-danger-border)' }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-status-blocked)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
        <span className="text-sm" style={{ color: 'var(--color-surface-danger-text)' }}>{message}</span>
      </div>
    </div>
  )
}

function RoutedApp() {
  return (
    <>
      <QueryBootstrap />
      <UiEventSubscriptions />
      <Routes>
        <Route path="/" element={<PullRequestsPage />} />
        <Route path="/review_tasks" element={<ReviewTasksPage />} />
        <Route path="/review_tasks/:id" element={<ReviewTaskDetailPage />} />
        <Route path="/repositories" element={<RepositoriesPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ToastProvider>
          <BrowserRouter>
            <RoutedApp />
          </BrowserRouter>
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
