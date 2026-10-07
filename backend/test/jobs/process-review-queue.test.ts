import { describe, expect, test } from 'bun:test'
import { processReviewQueueJob } from '../../src/jobs/handlers/process-review-queue'
import { claimAndStartNextQueued, findReviewTask, startReview } from '../../src/models/review-task'
import { createTestContext } from '../support/context'
import { insertPullRequest, insertReviewTask } from '../support/factories'

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000)

describe('processReviewQueueJob', () => {
  test('does nothing when a review is running', async () => {
    const ctx = createTestContext()
    insertReviewTask(ctx.db, { pullRequestId: insertPullRequest(ctx.db).id, state: 'in_review' })
    const queued = insertReviewTask(ctx.db, { pullRequestId: insertPullRequest(ctx.db).id, state: 'queued', queuedAt: new Date() })

    await processReviewQueueJob(ctx)

    expect(findReviewTask(ctx.db, queued.id).state).toBe('queued')
    expect(ctx.jobs.all()).toEqual([])
  })

  test('starts next queued task when no review is running', async () => {
    const ctx = createTestContext()
    const queued = insertReviewTask(ctx.db, { pullRequestId: insertPullRequest(ctx.db).id, state: 'queued', queuedAt: new Date() })

    await processReviewQueueJob(ctx)

    expect(ctx.jobs.unfinished('ReviewTaskJob')).toEqual([
      expect.objectContaining({ name: 'ReviewTaskJob', payload: { reviewTaskId: queued.id, isRetry: false } }),
    ])
    expect(findReviewTask(ctx.db, queued.id)).toMatchObject({ state: 'pending_review', queuedAt: null })
  })

  test('does nothing when queue is empty', async () => {
    const ctx = createTestContext()
    insertReviewTask(ctx.db, { pullRequestId: insertPullRequest(ctx.db).id, state: 'done' })

    await processReviewQueueJob(ctx)

    expect(ctx.jobs.all()).toEqual([])
  })

  test('claim_and_start_next_queued prevents double claiming', () => {
    const ctx = createTestContext()
    const first = insertReviewTask(ctx.db, { pullRequestId: insertPullRequest(ctx.db).id, state: 'queued', queuedAt: minutesAgo(1) })
    const second = insertReviewTask(ctx.db, { pullRequestId: insertPullRequest(ctx.db).id, state: 'queued', queuedAt: new Date() })

    const claimed = claimAndStartNextQueued(ctx)
    expect(claimed?.id).toBe(first.id)
    expect(findReviewTask(ctx.db, first.id).state).toBe('pending_review')

    startReview(ctx, findReviewTask(ctx.db, first.id))

    expect(claimAndStartNextQueued(ctx)).toBeNull()
    expect(findReviewTask(ctx.db, second.id).state).toBe('queued')
  })
})
