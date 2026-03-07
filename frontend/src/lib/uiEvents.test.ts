import { describe, expect, it, vi } from 'vitest'

import { queryKeys } from './queryKeys'
import { handleReviewNotification, handleUiEvent } from './uiEvents'

function buildClient() {
  return {
    invalidateQueries: vi.fn(),
  }
}

describe('uiEvents', () => {
  it('invalidates active review task detail queries on review_task.updated', () => {
    const client = buildClient()
    const pushToast = vi.fn()

    handleUiEvent({ event: 'review_task.updated' }, client as never, pushToast)

    expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.reviewTaskBoard })
    expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.pullRequestBoard })
    expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.reviewTaskDetailRoot })
  })

  it('invalidates active review task detail queries on review completion notifications', () => {
    const client = buildClient()
    const pushToast = vi.fn()

    handleReviewNotification({ type: 'review_completed', pr_number: 382 }, client as never, pushToast)

    expect(pushToast).toHaveBeenCalledWith('Review completed for PR #382', 'success')
    expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.reviewTaskDetailRoot })
  })
})
