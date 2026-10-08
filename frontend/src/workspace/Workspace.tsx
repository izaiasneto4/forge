import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

import { CommandPalette } from '../components/CommandPalette'
import { Inspector } from '../components/Inspector'
import { NewReview } from '../components/NewReview'
import { PullRequestDetail, DetailEmpty } from '../components/PullRequestDetail'
import { PullRequestList } from '../components/PullRequestList'
import { RepositorySetup } from '../components/RepositorySetup'
import { SettingsSheet } from '../components/SettingsSheet'
import { Sidebar } from '../components/Sidebar'
import { subscribe } from '../lib/realtime'
import { errorMessage } from '../lib/errors'
import { MAILBOX_LABELS } from '../lib/lifecycle'
import { desktopNotificationsEnabled } from '../lib/preferences'
import { useToasts } from '../lib/toastContext'
import { handleReviewNotification, handleUiEvent, type ReviewNotificationPayload } from '../lib/uiEvents'
import { useWorkspace } from './context'

function isTyping(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
}

function isPayload(data: unknown): data is Record<string, unknown> {
  return typeof data === 'object' && data !== null && !Array.isArray(data)
}

function stringField(data: Record<string, unknown>, key: string) {
  const value = data[key]
  return typeof value === 'string' ? value : undefined
}

function numberField(data: Record<string, unknown>, key: string) {
  const value = data[key]
  return typeof value === 'number' ? value : undefined
}

function useLiveUpdates() {
  const queryClient = useQueryClient()
  const { pushToast } = useToasts()
  const navigate = useNavigate()
  const { items, openPullRequest } = useWorkspace()

  const latest = useRef({ items, openPullRequest })
  useLayoutEffect(() => {
    latest.current = { items, openPullRequest }
  })

  // PR numbers are only unique per repository, so prefer the task id, which also
  // opens reviews for other repositories or closed PRs.
  const openReview = useCallback((event: ReviewNotificationPayload) => {
    if (event.review_task_id !== undefined) {
      navigate(`/review_tasks/${event.review_task_id}`)
      return
    }
    const item = latest.current.items.find((entry) => entry.number === event.pr_number)
    if (item) latest.current.openPullRequest(item.id)
  }, [navigate])

  useEffect(() => subscribe({ channel: 'ui_events' }, {
    received: (data) => {
      if (!isPayload(data)) return
      handleUiEvent({ event: stringField(data, 'event'), error: stringField(data, 'error') }, queryClient, pushToast)
    },
  }), [queryClient, pushToast])

  useEffect(() => subscribe({ channel: 'review_notifications' }, {
    received: (data) => {
      if (!isPayload(data)) return
      const event = { type: stringField(data, 'type'), review_task_id: numberField(data, 'review_task_id'), pr_number: numberField(data, 'pr_number'), reason: stringField(data, 'reason') }
      handleReviewNotification(event, queryClient, pushToast, openReview)

      if (document.visibilityState === 'hidden' && desktopNotificationsEnabled() && event.pr_number !== undefined) {
        const prNumber = event.pr_number
        const notification = new Notification(event.type === 'review_failed' ? `Review failed · #${prNumber}` : `Review finished · #${prNumber}`, {
          body: event.type === 'review_failed' ? event.reason ?? 'The agent stopped early.' : 'Findings are ready for you to send.',
          icon: '/icon.png',
          // PR numbers repeat across repositories; the task id doesn't.
          tag: `ordem-review-${event.review_task_id ?? prNumber}`,
        })
        notification.onclick = () => {
          window.focus()
          openReview(event)
        }
      }
    },
  }), [queryClient, pushToast, openReview])
}

function useShortcuts() {
  const workspace = useWorkspace()

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    const { paletteOpen, setPaletteOpen, settingsTab, toggleSidebar, openSettings, moveSelection, toggleInspector, selected, actions, openNew } = workspace
    const mod = event.metaKey || event.ctrlKey
    const key = event.key.toLowerCase()

    if (mod && key === 'k') {
      event.preventDefault()
      setPaletteOpen(!paletteOpen)
      return
    }
    if (mod && event.key === '\\') {
      event.preventDefault()
      toggleSidebar()
      return
    }
    if (mod && event.key === ',') {
      event.preventDefault()
      openSettings()
      return
    }

    if (paletteOpen || settingsTab || mod || event.altKey || document.querySelector('.menu, .alert')) return

    if (isTyping(event.target)) {
      if (event.key === 'Escape' && event.target instanceof HTMLElement) event.target.blur()
      return
    }

    switch (key) {
      case 'j':
      case 'arrowdown':
        event.preventDefault()
        moveSelection(1)
        break
      case 'k':
      case 'arrowup':
        event.preventDefault()
        moveSelection(-1)
        break
      case 'i':
        toggleInspector()
        break
      case 'e':
        if (selected) void actions.archive(selected)
        break
      case 'n':
        event.preventDefault()
        openNew()
        break
      case 'r':
        event.preventDefault()
        document.getElementById('composer-input')?.focus()
        break
      case '/':
        event.preventDefault()
        setPaletteOpen(true)
        break
    }
  })

  useEffect(() => {
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])
}

function DetailPane() {
  const { route, selected, boardLoading, boardError, mailbox, sections, needsRepository } = useWorkspace()

  if (route.kind === 'new') return <NewReview />
  if (selected) return <PullRequestDetail item={selected} />
  if (boardError) return <DetailEmpty icon="warn" title="Couldn’t load pull requests" body={errorMessage(boardError)} />
  if (boardLoading) return <DetailEmpty icon="refresh" title="Loading" body="Fetching pull requests from Ordem…" />
  if (needsRepository) return <RepositorySetup />
  if (route.kind === 'mailbox' && route.id !== null) return <DetailEmpty icon="search" title="Pull request not found" body="It may have been merged, closed or archived." />
  if (route.kind === 'task') return <DetailEmpty icon="refresh" title="Loading" body="Opening review…" />
  if (sections.length === 0) return <DetailEmpty icon="checkCircle" title={`${MAILBOX_LABELS[mailbox]} is empty`} body="Nothing to look at here right now." />
  return <DetailEmpty title="Select a pull request" body="Use J and K to move through the list." />
}

export function Workspace() {
  const { sidebarOpen, inspectorOpen, route, selected, paletteOpen, settingsTab } = useWorkspace()
  const showInspector = inspectorOpen && route.kind !== 'new'

  useShortcuts()
  useLiveUpdates()

  const classes = ['window']
  if (!sidebarOpen) classes.push('no-sidebar')
  if (showInspector) classes.push('with-inspector')
  if (route.kind !== 'mailbox' || route.id !== null) classes.push('has-selection')

  return (
    <>
      <div className="desktop">
        <div className={classes.join(' ')}>
          <Sidebar />
          <PullRequestList />
          <DetailPane />
          {showInspector ? <Inspector item={selected} /> : <aside className="inspector" aria-hidden="true" />}
        </div>
      </div>
      {paletteOpen ? <CommandPalette /> : null}
      {settingsTab ? <SettingsSheet tab={settingsTab} /> : null}
    </>
  )
}
