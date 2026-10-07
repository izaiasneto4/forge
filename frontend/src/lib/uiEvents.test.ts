import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

import { queryKeys } from './queryKeys'
import { handleReviewNotification, handleUiEvent } from './uiEvents'

function buildClient() {
  const client = new QueryClient()
  const invalidateQueries = vi.spyOn(client, 'invalidateQueries')
  return { client, invalidateQueries }
}

describe('uiEvents', () => {
  it('invalidates active review task detail queries on review_task.updated', () => {
    const { client, invalidateQueries } = buildClient()
    const pushToast = vi.fn()

    handleUiEvent({ event: 'review_task.updated' }, client, pushToast)

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.reviewTaskBoard })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.pullRequestBoard })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.reviewTaskDetailRoot })
  })

  it('notifies with a link to the pull request when a review completes', () => {
    const { client, invalidateQueries } = buildClient()
    const pushToast = vi.fn()
    const openReview = vi.fn()
    const prNumber = 382
    const event = { type: 'review_completed', review_task_id: 41, pr_number: prNumber }

    handleReviewNotification(event, client, pushToast, openReview)

    const [message, tone, options] = pushToast.mock.calls[0]
    expect(message).toContain(`#${prNumber}`)
    expect(tone).toBe('success')
    expect(options.title).toContain(`#${prNumber}`)

    options.onClick()
    expect(openReview).toHaveBeenCalledWith(event)
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.reviewTaskDetailRoot })
  })

  it('surfaces the failure reason when a review fails', () => {
    const { client } = buildClient()
    const pushToast = vi.fn()
    const reason = 'Worktree checkout failed'

    handleReviewNotification({ type: 'review_failed', pr_number: 7, reason }, client, pushToast)

    const [message, tone, options] = pushToast.mock.calls[0]
    expect(message).toBe(reason)
    expect(tone).toBe('error')
    expect(options.onClick).toBeUndefined()
  })

  it('leaves the pull request number out when the payload has none', () => {
    const { client } = buildClient()
    const pushToast = vi.fn()

    handleReviewNotification({ type: 'review_completed' }, client, pushToast)
    handleReviewNotification({ type: 'review_failed' }, client, pushToast)

    const texts = pushToast.mock.calls.flatMap(([message, , options]) => [message, options.title])
    expect(texts.some((text) => String(text).includes('#'))).toBe(false)
  })
})
