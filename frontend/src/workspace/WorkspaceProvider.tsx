import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useEffectEvent, useMemo, useState, type PropsWithChildren } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { ConfirmSheet } from '../components/ConfirmSheet'
import { api } from '../lib/api'
import { errorMessage } from '../lib/errors'
import {
  belongsToMailbox,
  defaultSelection,
  flattenBoard,
  inReviewScope,
  isAuthoredBy,
  MAILBOX_IDS,
  mailboxFor,
  orderedIds,
  sectionsFor,
  type MailboxId,
  type SortOption,
} from '../lib/lifecycle'
import { queryKeys } from '../lib/queryKeys'
import { useToasts } from '../lib/toastContext'
import type {
  BootstrapResponse,
  PullRequestBoardResponse,
  PullRequestItem,
  ReviewCommentItem,
  UiMutationResponse,
} from '../types/api'
import {
  WorkspaceContext,
  type ConfirmOptions,
  type Draft,
  type InspectorTab,
  type StartReviewInput,
  type WorkspaceActions,
  type WorkspaceValue,
} from './context'
import { mailboxPath, parseRoute, type SettingsTab } from './routing'
import { useTaskDetail } from './useTaskDetail'

const AUTO_SYNC_INTERVAL_MS = 120_000

const EMPTY_DRAFT: Draft = {
  text: '',
  lens: 'general',
  depth: null,
  client: null,
  event: null,
  summary: '',
}

type PendingConfirm = ConfirmOptions & { resolve: (confirmed: boolean) => void }

export function WorkspaceProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  const { pushToast } = useToasts()

  const route = useMemo(() => parseRoute(location.pathname), [location.pathname])

  const [sort, setSort] = useState<SortOption>('longest_waiting')
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set())
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('activity')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null)
  const [drafts, setDrafts] = useState<Record<number, Draft>>({})
  const [selections, setSelections] = useState<Record<number, Set<number>>>({})
  const [focusedFinding, setFocusedFinding] = useState<number | null>(null)
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null)
  const [pending, setPending] = useState({ sync: false, start: false, submit: false })
  const [lastMailbox, setLastMailbox] = useState<MailboxId>('inbox')

  const bootstrapQuery = useQuery({
    queryKey: queryKeys.bootstrap,
    queryFn: () => api.get<BootstrapResponse>('/api/v1/bootstrap'),
  })

  const boardQuery = useQuery({
    queryKey: queryKeys.pullRequestBoard,
    queryFn: () => api.get<PullRequestBoardResponse>('/api/v1/pull_requests/board'),
  })

  const board = boardQuery.data
  const bootstrap = bootstrapQuery.data
  const login = board?.settings.current_user_login ?? bootstrap?.settings.github_login ?? null
  const onlyRequested = board?.settings.only_requested_reviews ?? false
  const items = useMemo(
    () => (board ? flattenBoard(board).filter((item) => inReviewScope(item, login, onlyRequested)) : []),
    [board, login, onlyRequested],
  )

  if (route.kind === 'mailbox' && route.mailbox !== lastMailbox) setLastMailbox(route.mailbox)
  const mailbox = route.kind === 'mailbox' ? route.mailbox : lastMailbox

  const mailboxItems = useMemo(
    () => items.filter((item) => belongsToMailbox(item, mailbox, login)),
    [items, mailbox, login],
  )
  const sections = useMemo(() => sectionsFor(mailbox, mailboxItems, sort), [mailbox, mailboxItems, sort])
  const visibleIds = useMemo(
    () => orderedIds(sections.filter((section) => !collapsedSections.has(`${mailbox}:${section.id}`))),
    [sections, collapsedSections, mailbox],
  )

  const counts = useMemo(() => {
    const result: Record<MailboxId, number> = { inbox: 0, reviewing: 0, waiting: 0, mine: 0, settled: 0 }
    for (const item of items) {
      for (const id of MAILBOX_IDS) {
        if (belongsToMailbox(item, id, login)) result[id] += 1
      }
    }
    return result
  }, [items, login])

  // Legacy /review_tasks/:id links can point at merged, closed or other-repo PRs that
  // aren't on the board, so those are loaded through the task detail instead.
  const taskRouteId = route.kind === 'task' ? route.taskId : null
  const taskOnBoard = useMemo(
    () => (taskRouteId === null ? null : items.find((entry) => entry.review_task?.id === taskRouteId) ?? null),
    [items, taskRouteId],
  )
  const offBoardTask = useTaskDetail(board && taskRouteId !== null && !taskOnBoard ? taskRouteId : null)

  const selectedId = route.kind === 'mailbox' ? route.id : null
  const selected = useMemo(() => {
    if (route.kind === 'task') return offBoardTask.data?.pull_request ?? null
    return items.find((item) => item.id === selectedId) ?? null
  }, [route.kind, offBoardTask.data, items, selectedId])
  const anyReviewing = items.some((item) => item.lifecycle === 'reviewing')
  const requestedItems = useMemo(
    () => items.filter((item) => item.lifecycle === 'needs_review' && item.review_requested_for_me && !isAuthoredBy(item, login)),
    [items, login],
  )

  const invalidateAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.pullRequestBoard })
    queryClient.invalidateQueries({ queryKey: queryKeys.reviewTaskDetailRoot })
    queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap })
  }, [queryClient])

  const goToMailbox = useCallback((target: MailboxId) => navigate(mailboxPath(target)), [navigate])

  const openPullRequest = useCallback((id: number) => {
    const item = items.find((entry) => entry.id === id)
    const target = item && !belongsToMailbox(item, mailbox, login) ? mailboxFor(item, login) : mailbox
    setFocusedFinding(null)
    navigate(mailboxPath(target, id))
  }, [items, mailbox, login, navigate])

  const openNew = useCallback(() => navigate('/new'), [navigate])

  const moveSelection = useCallback((delta: number) => {
    if (visibleIds.length === 0) return
    const index = selectedId === null ? -1 : visibleIds.indexOf(selectedId)
    const nextIndex = index === -1 ? 0 : Math.max(0, Math.min(visibleIds.length - 1, index + delta))
    setFocusedFinding(null)
    navigate(mailboxPath(mailbox, visibleIds[nextIndex]))
  }, [visibleIds, selectedId, mailbox, navigate])

  const advanceFrom = useCallback((id: number) => {
    const index = visibleIds.indexOf(id)
    const remaining = visibleIds.filter((entry) => entry !== id)
    const nextId = remaining[Math.min(Math.max(index, 0), remaining.length - 1)]
    navigate(mailboxPath(mailbox, nextId ?? null))
  }, [visibleIds, mailbox, navigate])

  useEffect(() => {
    if (route.kind !== 'mailbox' || route.id !== null || !board) return
    const first = visibleIds[0]
    if (first !== undefined) navigate(mailboxPath(route.mailbox, first), { replace: true })
  }, [route, board, visibleIds, navigate])

  useEffect(() => {
    if (route.kind === 'settings') {
      setSettingsTab(route.tab)
      navigate(mailboxPath('inbox'), { replace: true })
    }
  }, [route, navigate])

  useEffect(() => {
    if (taskOnBoard) {
      navigate(mailboxPath(mailboxFor(taskOnBoard, login), taskOnBoard.id), { replace: true })
    } else if (offBoardTask.isError) {
      pushToast(errorMessage(offBoardTask.error), 'error', { title: 'Review not found' })
      navigate(mailboxPath('inbox'), { replace: true })
    }
  }, [taskOnBoard, offBoardTask.isError, offBoardTask.error, login, navigate, pushToast])

  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => {
    setPendingConfirm({ ...options, resolve })
  }), [])

  const run = useCallback(async <T,>(key: keyof typeof pending | null, task: () => Promise<T>) => {
    if (key) setPending((current) => ({ ...current, [key]: true }))
    try {
      return await task()
    } catch (error) {
      pushToast(errorMessage(error), 'error')
      return null
    } finally {
      if (key) setPending((current) => ({ ...current, [key]: false }))
    }
  }, [pushToast])

  const createReview = useCallback((item: PullRequestItem, input: StartReviewInput) => api.post<UiMutationResponse>(
    `/api/v1/pull_requests/${item.id}/review_task`,
    { cli_client: input.client, review_type: input.depth, focus: input.focus },
  ), [])

  const actions = useMemo<WorkspaceActions>(() => ({
    startReview: async (item, input) => {
      const response = await run('start', () => createReview(item, input))
      if (!response) return
      if (response.detail?.task.state === 'queued') {
        pushToast(`#${item.number} starts after the current review.`, 'info', { title: 'Added to queue' })
      }
      setDrafts((current) => ({ ...current, [item.id]: { ...(current[item.id] ?? EMPTY_DRAFT), text: '' } }))
      invalidateAll()
    },

    startReviewFromUrl: async (url, input) => {
      const response = await run('start', () => api.post<{ pull_request_id: number }>('/api/v1/reviews', {
        pr_url: url.trim(),
        cli_client: input.client,
        review_type: input.depth,
        focus: input.focus,
      }))
      if (!response) return
      await queryClient.invalidateQueries({ queryKey: queryKeys.pullRequestBoard })
      navigate(mailboxPath('reviewing', response.pull_request_id))
    },

    reviewAllRequested: async () => {
      const client = bootstrap?.settings.default_cli_client ?? 'claude'
      for (const item of requestedItems) {
        await run('start', () => createReview(item, { client, depth: 'review', focus: '' }))
      }
      invalidateAll()
      navigate(mailboxPath('reviewing'))
    },

    dequeue: async (item) => {
      if (!item.review_task) return
      const taskId = item.review_task.id
      await run(null, () => api.delete<UiMutationResponse>(`/api/v1/review_tasks/${taskId}/dequeue`))
      invalidateAll()
    },

    archive: async (item) => {
      const response = await run(null, () => api.patch<UiMutationResponse>(`/api/v1/pull_requests/${item.id}/archive`))
      if (!response) return
      advanceFrom(item.id)
      invalidateAll()
      pushToast('Click to undo.', 'info', {
        key: `archive-${item.id}`,
        title: `Archived #${item.number}`,
        onClick: () => {
          void run(null, () => api.patch<UiMutationResponse>(`/api/v1/pull_requests/${item.id}/unarchive`)).then((restored) => {
            if (!restored) return
            invalidateAll()
            navigate(mailboxPath(mailboxFor(item, login), item.id))
          })
        },
      })
    },

    remove: async (item) => {
      const confirmed = await confirm({
        title: `Delete #${item.number} from Forge?`,
        message: 'Nothing changes on GitHub. If it’s still open, the next sync brings it back. Archive it to hide it for good.',
        confirmLabel: 'Delete',
      })
      if (!confirmed) return
      const response = await run(null, () => api.delete<UiMutationResponse>('/api/v1/pull_requests/bulk_destroy', { pull_request_ids: [item.id] }))
      if (!response) return
      advanceFrom(item.id)
      invalidateAll()
    },

    setFindingStatus: async (taskId, commentId, status) => {
      const response = await run(null, () => api.patch<UiMutationResponse>(`/api/v1/review_comments/${commentId}/toggle`, { status }))
      if (!response) return
      if (response.detail) queryClient.setQueryData(queryKeys.reviewTaskDetail(String(taskId)), response.detail)
      queryClient.invalidateQueries({ queryKey: queryKeys.pullRequestBoard })
    },

    submit: async (item, input) => {
      const task = item.review_task
      if (!task) return

      if (bootstrap?.settings.auto_submit_enabled) {
        const count = input.commentIds.length
        const confirmed = await confirm({
          title: 'Submit review to GitHub?',
          message: `${input.event === 'APPROVE' ? 'Approve' : input.event === 'REQUEST_CHANGES' ? 'Request changes on' : 'Comment on'} #${item.number}${count ? ` with ${count} inline comment${count === 1 ? '' : 's'}` : ''}.`,
          confirmLabel: 'Submit',
        })
        if (!confirmed) return
      }

      const response = await run('submit', () => api.post<UiMutationResponse>(`/api/v1/review_tasks/${task.id}/submissions`, {
        event: input.event,
        summary: input.summary,
        comment_ids: input.commentIds,
        force_empty_submission: input.event === 'APPROVE' && input.commentIds.length === 0,
      }))
      if (!response) return

      pushToast(`Your review on #${item.number} is on GitHub.`, 'success', { title: 'Review submitted' })
      setDrafts((current) => {
        const next = { ...current }
        delete next[item.id]
        return next
      })
      advanceFrom(item.id)
      invalidateAll()
    },

    sync: async (force = false) => {
      const response = await run('sync', () => api.post<UiMutationResponse>('/api/v1/pull_requests/sync', { force }))
      if (response?.board) queryClient.setQueryData(queryKeys.pullRequestBoard, response.board)
      queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap })
    },

    switchRepo: async (slug) => {
      const response = await run('sync', () => api.post<UiMutationResponse>('/api/v1/repositories/switch', { repo: slug }))
      if (!response) return
      pushToast(response.message ?? `Switched to ${slug}`, 'success', { title: 'Repository switched' })
      queryClient.invalidateQueries({ queryKey: queryKeys.repositories })
      invalidateAll()
      navigate(mailboxPath('inbox'))
    },

    setOnlyRequested: async (value) => {
      const response = await run(null, () => api.patch<UiMutationResponse>('/api/v1/pull_requests/review_scope', { requested_to_me_only: value }))
      if (response?.board) queryClient.setQueryData(queryKeys.pullRequestBoard, response.board)
      queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap })
    },

    clearReview: async (item) => {
      if (!item.review_task) return
      const taskId = item.review_task.id
      const confirmed = await confirm({
        title: 'Discard this review?',
        message: `Findings and logs for #${item.number} will be deleted. The pull request stays in Forge.`,
        confirmLabel: 'Discard',
      })
      if (!confirmed) return
      await run(null, () => api.delete<UiMutationResponse>(`/api/v1/review_tasks/${taskId}/clear`))
      invalidateAll()
    },

    markDone: async (item) => {
      if (!item.review_task) return
      const taskId = item.review_task.id
      const response = await run(null, () => api.patch<UiMutationResponse>(`/api/v1/review_tasks/${taskId}/state`, { state: 'done' }))
      if (!response) return
      advanceFrom(item.id)
      invalidateAll()
    },
  }), [run, createReview, pushToast, invalidateAll, queryClient, navigate, bootstrap, requestedItems, advanceFrom, confirm, login])

  const maybeSync = useEffectEvent(() => {
    if (!board || document.visibilityState !== 'visible') return
    if (!board.sync_status.sync_needed || board.sync_status.running || pending.sync) return
    void actions.sync(false)
  })

  useEffect(() => {
    if (!board) return

    maybeSync()
    const intervalId = window.setInterval(maybeSync, AUTO_SYNC_INTERVAL_MS)
    document.addEventListener('visibilitychange', maybeSync)

    return () => {
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', maybeSync)
    }
  }, [board])

  const draftFor = useCallback((id: number) => drafts[id] ?? EMPTY_DRAFT, [drafts])
  const updateDraft = useCallback((id: number, patch: Partial<Draft>) => {
    setDrafts((current) => ({ ...current, [id]: { ...(current[id] ?? EMPTY_DRAFT), ...patch } }))
  }, [])

  const selectionFor = useCallback((taskId: number, comments: ReviewCommentItem[]) => {
    const pendingIds = new Set(comments.filter((comment) => comment.status === 'pending').map((comment) => comment.id))
    const stored = selections[taskId]
    const base = stored ?? defaultSelection(comments)
    return new Set([...base].filter((id) => pendingIds.has(id)))
  }, [selections])

  const setSelection = useCallback((taskId: number, ids: Set<number>) => {
    setSelections((current) => ({ ...current, [taskId]: ids }))
  }, [])

  const toggleSection = useCallback((id: string) => {
    setCollapsedSections((current) => {
      const key = `${mailbox}:${id}`
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [mailbox])

  const value: WorkspaceValue = {
    bootstrap,
    board,
    boardLoading: boardQuery.isLoading,
    boardError: boardQuery.error,
    items,
    login,
    route,
    mailbox,
    selected,
    sections,
    counts,
    anyReviewing,
    requestedCount: requestedItems.length,
    sort,
    setSort,
    collapsedSections,
    toggleSection,
    sidebarOpen,
    toggleSidebar: () => setSidebarOpen((current) => !current),
    inspectorOpen,
    inspectorTab,
    openInspector: (tab) => {
      if (tab) setInspectorTab(tab)
      setInspectorOpen(true)
    },
    toggleInspector: () => setInspectorOpen((current) => !current),
    paletteOpen,
    setPaletteOpen,
    settingsTab,
    openSettings: (tab = 'general') => setSettingsTab(tab),
    closeSettings: () => setSettingsTab(null),
    goToMailbox,
    openPullRequest,
    openNew,
    moveSelection,
    draftFor,
    updateDraft,
    selectionFor,
    setSelection,
    focusedFinding,
    setFocusedFinding,
    actions,
    pending,
    confirm,
    defaultClient: bootstrap?.settings.default_cli_client ?? 'claude',
    cliClients: bootstrap?.app.cli_clients ?? ['claude', 'codex', 'opencode'],
  }

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
      {pendingConfirm ? (
        <ConfirmSheet
          title={pendingConfirm.title}
          message={pendingConfirm.message}
          confirmLabel={pendingConfirm.confirmLabel}
          onResolve={(confirmed) => {
            pendingConfirm.resolve(confirmed)
            setPendingConfirm(null)
          }}
        />
      ) : null}
    </WorkspaceContext.Provider>
  )
}
