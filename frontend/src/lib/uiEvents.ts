import type { QueryClient } from '@tanstack/react-query'

import { queryKeys } from './queryKeys'
import type { PushToastOptions, ToastType } from './toastContext'

type UiEventPayload = {
  event?: string
  error?: string
}

export type ReviewNotificationPayload = {
  type?: string
  review_task_id?: number
  pr_number?: number
  reason?: string
}

type ToastFn = (message: string, tone: ToastType, options?: PushToastOptions) => void
type OpenReview = (event: ReviewNotificationPayload) => void

export function handleUiEvent(event: UiEventPayload, client: QueryClient, pushToast: ToastFn) {
  switch (event.event) {
    case 'pull_request.updated':
    case 'pull_request.bulk_deleted':
      client.invalidateQueries({ queryKey: queryKeys.pullRequestBoard })
      client.invalidateQueries({ queryKey: queryKeys.bootstrap })
      break
    case 'review_task.updated':
      client.invalidateQueries({ queryKey: queryKeys.reviewTaskBoard })
      client.invalidateQueries({ queryKey: queryKeys.pullRequestBoard })
      client.invalidateQueries({ queryKey: queryKeys.reviewTaskDetailRoot })
      break
    case 'sync.started':
    case 'sync.completed':
      client.invalidateQueries({ queryKey: queryKeys.pullRequestBoard })
      client.invalidateQueries({ queryKey: queryKeys.bootstrap })
      break
    case 'sync.failed':
      pushToast(event.error ?? 'Sync failed', 'error', { key: 'sync-status', title: 'Sync failed' })
      break
    default:
      break
  }
}

function invalidateReviewQueries(client: QueryClient) {
  client.invalidateQueries({ queryKey: queryKeys.reviewTaskBoard })
  client.invalidateQueries({ queryKey: queryKeys.pullRequestBoard })
  client.invalidateQueries({ queryKey: queryKeys.reviewTaskDetailRoot })
}

export function handleReviewNotification(
  event: ReviewNotificationPayload,
  client: QueryClient,
  pushToast: ToastFn,
  openReview?: OpenReview,
) {
  const prNumber = event.pr_number
  // The number is optional in the payload; leave it out rather than print "#undefined".
  const suffix = prNumber === undefined ? '' : ` · #${prNumber}`
  const onClick = openReview ? () => openReview(event) : undefined

  if (event.type === 'review_completed') {
    const message = prNumber === undefined ? 'Findings are ready for you to send.' : `Findings for #${prNumber} are ready for you to send.`
    pushToast(message, 'success', { title: `Review finished${suffix}`, onClick })
    invalidateReviewQueries(client)
  }

  if (event.type === 'review_failed') {
    pushToast(event.reason ?? 'The agent stopped before producing findings.', 'error', { title: `Review failed${suffix}`, onClick })
    invalidateReviewQueries(client)
  }
}
