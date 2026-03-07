import type { QueryClient } from '@tanstack/react-query'

import { queryKeys } from './queryKeys'

type UiEventPayload = {
  event?: string
  error?: string
}

type ReviewNotificationPayload = {
  type?: string
  pr_number?: number
  reason?: string
}

type ToastFn = (message: string, tone: 'success' | 'error' | 'info') => void

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
      pushToast(event.error ?? 'Sync failed', 'error')
      break
    default:
      break
  }
}

export function handleReviewNotification(event: ReviewNotificationPayload, client: QueryClient, pushToast: ToastFn) {
  if (event.type === 'review_completed') {
    pushToast(`Review completed for PR #${event.pr_number}`, 'success')
    client.invalidateQueries({ queryKey: queryKeys.reviewTaskBoard })
    client.invalidateQueries({ queryKey: queryKeys.pullRequestBoard })
    client.invalidateQueries({ queryKey: queryKeys.reviewTaskDetailRoot })
  }

  if (event.type === 'review_failed') {
    pushToast(`Review failed for PR #${event.pr_number}: ${event.reason ?? 'unknown'}`, 'error')
    client.invalidateQueries({ queryKey: queryKeys.reviewTaskBoard })
    client.invalidateQueries({ queryKey: queryKeys.pullRequestBoard })
    client.invalidateQueries({ queryKey: queryKeys.reviewTaskDetailRoot })
  }
}
