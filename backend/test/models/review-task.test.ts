import { describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { agentLogs, reviewComments, reviewIterations } from '../../src/db/schema'
import { findPullRequest } from '../../src/models/pull-request'
import { activateSnapshot } from '../../src/models/pull-request-snapshot'
import { transaction } from '../../src/models/record'
import {
  addLog,
  anyReviewRunning,
  claimAndStartNextQueued,
  createReviewTask,
  destroyReviewTask,
  findReviewTask,
  inProgressOrRetrying,
  markFailed,
  markSubmitted,
  MAX_RETRY_ATTEMPTS,
  moveBackward,
  parsedRetryHistory,
  prepareNewRun,
  processQueueIfIdle,
  queuePosition,
  recoverOrphanedInReviewTasks,
  resetStuckTasks,
  reviewTaskIdsWithPendingJob,
  startReview,
  updateReviewTask,
} from '../../src/models/review-task'
import { STREAMS } from '../../src/realtime/broadcaster'
import { createTestContext } from '../support/context'
import { insertAgentLog, insertPullRequest, insertReviewComment, insertReviewTask } from '../support/factories'

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000)

describe('ReviewTask model', () => {
  test('broadcasts creation and state changes as review_task.updated', () => {
    const ctx = createTestContext()
    const pullRequest = insertPullRequest(ctx.db)

    const task = createReviewTask(ctx, { pullRequestId: pullRequest.id, state: 'pending_review', cliClient: 'claude', reviewType: 'review' })
    updateReviewTask(ctx, task, { state: 'in_review' })

    expect(ctx.events.on(STREAMS.uiEvents)).toEqual([
      expect.objectContaining({ event: 'review_task.updated', review_task_id: task.id, state: 'pending_review', previous_state: null }),
      expect.objectContaining({ event: 'review_task.updated', state: 'in_review', previous_state: 'pending_review' }),
    ])
  })

  test('claims the oldest queued task and starts its job, but only when idle', () => {
    const ctx = createTestContext()
    const older = insertReviewTask(ctx.db, { pullRequestId: insertPullRequest(ctx.db).id, state: 'queued', queuedAt: minutesAgo(5) })
    const newer = insertReviewTask(ctx.db, { pullRequestId: insertPullRequest(ctx.db).id, state: 'queued', queuedAt: minutesAgo(1) })

    expect(queuePosition(ctx.db, newer)).toBe(2)
    const claimed = claimAndStartNextQueued(ctx)

    expect(claimed?.id).toBe(older.id)
    expect(claimed?.state).toBe('pending_review')
    expect(ctx.jobs.unfinished('ReviewTaskJob')).toEqual([expect.objectContaining({ payload: { reviewTaskId: older.id, isRetry: false } })])

    updateReviewTask(ctx, findReviewTask(ctx.db, older.id), { state: 'in_review' })
    expect(anyReviewRunning(ctx)).toBe(true)
    expect(claimAndStartNextQueued(ctx)).toBeNull()
  })

  test('moving backward archives the review as an iteration and clears its artifacts', () => {
    const ctx = createTestContext()
    const reviewOutput = '### Review\nLooks good'
    const task = insertReviewTask(ctx.db, { pullRequestId: insertPullRequest(ctx.db).id, state: 'reviewed', reviewOutput, aiModel: 'opus' })
    insertReviewComment(ctx.db, { reviewTaskId: task.id })
    insertAgentLog(ctx.db, { reviewTaskId: task.id })

    const moved = moveBackward(ctx, task, 'pending_review')

    expect(moved?.state).toBe('pending_review')
    expect(moved?.reviewOutput).toBeNull()
    expect(ctx.db.select().from(reviewIterations).all()).toEqual([
      expect.objectContaining({ iterationNumber: 1, reviewOutput, fromState: 'reviewed', toState: 'archived', aiModel: 'opus' }),
    ])
    expect(ctx.db.select().from(reviewComments).where(eq(reviewComments.reviewTaskId, task.id)).all()).toEqual([])
    expect(ctx.db.select().from(agentLogs).where(eq(agentLogs.reviewTaskId, task.id)).all()).toEqual([])
  })

  test('failing records permanent retry history and fails the pull request', () => {
    const ctx = createTestContext()
    const reason = 'Review failed (permanent failure): bad credentials'
    const pullRequest = insertPullRequest(ctx.db, { reviewStatus: 'in_review' })
    const task = insertReviewTask(ctx.db, { pullRequestId: pullRequest.id, state: 'in_review' })

    const failed = markFailed(ctx, task, reason)

    expect(failed.state).toBe('failed_review')
    expect(parsedRetryHistory(failed)).toEqual([expect.objectContaining({ attempt: 1, reason, permanent: true })])
    expect(findPullRequest(ctx.db, pullRequest.id).reviewStatus).toBe('review_failed')
  })

  test('recovers orphaned in_review tasks after a restart', () => {
    const ctx = createTestContext()
    const pullRequest = insertPullRequest(ctx.db, { reviewStatus: 'in_review' })
    const task = insertReviewTask(ctx.db, { pullRequestId: pullRequest.id, state: 'in_review', startedAt: minutesAgo(10) })

    expect(recoverOrphanedInReviewTasks(ctx)).toBe(1)
    expect(findReviewTask(ctx.db, task.id)).toMatchObject({ state: 'pending_review', startedAt: null })
    expect(findPullRequest(ctx.db, pullRequest.id).reviewStatus).toBe('pending_review')
  })

  test('leaves in_review tasks alone while a review job is running', () => {
    const ctx = createTestContext()
    const task = insertReviewTask(ctx.db, { pullRequestId: insertPullRequest(ctx.db).id, state: 'in_review', startedAt: minutesAgo(30) })
    ctx.jobs.enqueue('ReviewTaskJob', { reviewTaskId: task.id, isRetry: false })
    ctx.jobs.claimNext()

    expect(recoverOrphanedInReviewTasks(ctx)).toBe(0)
    expect(resetStuckTasks(ctx)).toBe(0)
  })

  test('resets tasks stuck in review without recent activity', () => {
    const ctx = createTestContext()
    const timeoutMinutes = 10
    const task = insertReviewTask(ctx.db, { pullRequestId: insertPullRequest(ctx.db).id, state: 'in_review', startedAt: minutesAgo(timeoutMinutes * 2) })
    insertAgentLog(ctx.db, { reviewTaskId: task.id, createdAt: minutesAgo(timeoutMinutes + 1) })

    expect(resetStuckTasks(ctx, timeoutMinutes)).toBe(1)
    expect(findReviewTask(ctx.db, task.id).failureReason).toBe(`Reset: task was stuck in review for over ${timeoutMinutes} minutes`)
  })

  test('kicks the queue only when tasks wait and nothing runs', () => {
    const ctx = createTestContext()
    insertReviewTask(ctx.db, { pullRequestId: insertPullRequest(ctx.db).id, state: 'queued', queuedAt: new Date() })

    processQueueIfIdle(ctx)
    processQueueIfIdle(ctx)

    expect(ctx.jobs.all().filter((job) => job.name === 'ProcessReviewQueueJob')).toHaveLength(1)
  })

  test('destroying a task resets a reviewed pull request and removes dependents', () => {
    const ctx = createTestContext()
    const pullRequest = insertPullRequest(ctx.db, { reviewStatus: 'reviewed_by_me' })
    const task = insertReviewTask(ctx.db, { pullRequestId: pullRequest.id, state: 'reviewed' })
    insertReviewComment(ctx.db, { reviewTaskId: task.id })

    destroyReviewTask(ctx, task)

    expect(findPullRequest(ctx.db, pullRequest.id).reviewStatus).toBe('pending_review')
    expect(() => findReviewTask(ctx.db, task.id)).toThrow()
    expect(ctx.db.select().from(reviewComments).all()).toEqual([])
  })

  test('streams each log line to the task log channel', () => {
    const ctx = createTestContext()
    const message = 'Fetching PR from GitHub...'
    const task = insertReviewTask(ctx.db, { pullRequestId: insertPullRequest(ctx.db).id })

    addLog(ctx, task, '   ')
    const log = addLog(ctx, task, message, 'status')

    expect(ctx.events.on(STREAMS.reviewTaskLogs(task.id))).toEqual([expect.objectContaining({ id: log?.id, log_type: 'status', message })])
  })
})

describe('transaction', () => {
  test('delivers broadcasts after commit and drops them on rollback', () => {
    const ctx = createTestContext()
    const pullRequest = insertPullRequest(ctx.db)
    const task = insertReviewTask(ctx.db, { pullRequestId: pullRequest.id })
    const failure = new Error('rollback')

    expect(() =>
      transaction(ctx, (txCtx) => {
        updateReviewTask(txCtx, task, { state: 'in_review' })
        throw failure
      }),
    ).toThrow(failure)
    expect(ctx.events.messages).toEqual([])
    expect(findReviewTask(ctx.db, task.id).state).toBe('pending_review')

    transaction(ctx, (txCtx) => updateReviewTask(txCtx, task, { state: 'in_review' }))
    expect(ctx.events.messages).toHaveLength(1)
  })
})

describe('activateSnapshot', () => {
  test('makes one snapshot current, stales the rest and queues one AI summary', () => {
    const ctx = createTestContext()
    const pullRequest = insertPullRequest(ctx.db)
    const first = activateSnapshot(ctx, { pullRequestId: pullRequest.id, headSha: 'aaa', baseSha: 'base', staleReason: 'revision_changed' })

    const second = activateSnapshot(ctx, { pullRequestId: pullRequest.id, headSha: 'bbb', baseSha: 'base', staleReason: 'revision_changed' })
    const reactivated = activateSnapshot(ctx, { pullRequestId: pullRequest.id, headSha: 'bbb', baseSha: 'base', staleReason: 'revision_changed' })

    expect(reactivated.id).toBe(second.id)
    expect(ctx.jobs.unfinished('PullRequestSummaryJob').map((job) => job.payload)).toEqual([{ snapshotId: first.id }, { snapshotId: second.id }])
  })
})

describe('ReviewTask runs', () => {
  test('a failed task is not in progress, even right after its last retry', () => {
    const ctx = createTestContext()
    const recentRetry = minutesAgo(2)
    const failed = insertReviewTask(ctx.db, { pullRequestId: insertPullRequest(ctx.db).id, state: 'failed_review', lastRetryAt: recentRetry })
    const pending = insertReviewTask(ctx.db, { pullRequestId: insertPullRequest(ctx.db).id, state: 'pending_review', lastRetryAt: recentRetry })

    expect(inProgressOrRetrying(failed)).toBe(false)
    expect(inProgressOrRetrying(pending)).toBe(true)
  })

  test('starting a run clears the previous run\'s submission', () => {
    const ctx = createTestContext()
    const pending = 'pending_submission'
    const task = insertReviewTask(ctx.db, { pullRequestId: insertPullRequest(ctx.db).id, state: 'pending_review' })
    const submitted = markSubmitted(ctx, task, 'COMMENT')

    const started = startReview(ctx, submitted)

    expect(started).toMatchObject({ submissionStatus: pending, submittedAt: null, submittedEvent: null })
  })

  test('preparing a new run moves the previous findings into history and resets the retry budget', () => {
    const ctx = createTestContext()
    const previousOutput = 'Earlier findings'
    const task = insertReviewTask(ctx.db, {
      pullRequestId: insertPullRequest(ctx.db).id,
      state: 'reviewed',
      reviewOutput: previousOutput,
      retryCount: MAX_RETRY_ATTEMPTS,
      lastRetryAt: minutesAgo(1),
    })
    insertReviewComment(ctx.db, { reviewTaskId: task.id, severity: 'critical' })

    const prepared = prepareNewRun(ctx, task)

    expect(prepared).toMatchObject({ reviewOutput: null, retryCount: 0, lastRetryAt: null })
    expect(ctx.db.select().from(reviewComments).where(eq(reviewComments.reviewTaskId, task.id)).all()).toEqual([])
    expect(ctx.db.select().from(reviewIterations).where(eq(reviewIterations.reviewTaskId, task.id)).all().map((iteration) => iteration.reviewOutput)).toEqual([previousOutput])
  })

  test('preparing a run without findings only resets the retry budget', () => {
    const ctx = createTestContext()
    const failureReason = 'Network error'
    const task = insertReviewTask(ctx.db, {
      pullRequestId: insertPullRequest(ctx.db).id,
      state: 'failed_review',
      retryCount: MAX_RETRY_ATTEMPTS,
      failureReason,
    })

    const prepared = prepareNewRun(ctx, task)

    expect(prepared).toMatchObject({ retryCount: 0, failureReason: null })
    expect(ctx.db.select().from(reviewIterations).where(eq(reviewIterations.reviewTaskId, task.id)).all()).toEqual([])
  })

  test('a review job waiting to run holds the slot and marks its task', () => {
    const ctx = createTestContext()
    const task = insertReviewTask(ctx.db, { pullRequestId: insertPullRequest(ctx.db).id, state: 'pending_review' })
    const backoffSeconds = 30

    expect(anyReviewRunning(ctx)).toBe(false)
    ctx.jobs.enqueue('ReviewTaskJob', { reviewTaskId: task.id, isRetry: true }, { waitSeconds: backoffSeconds })

    expect(anyReviewRunning(ctx)).toBe(true)
    expect([...reviewTaskIdsWithPendingJob(ctx.jobs)]).toEqual([task.id])
  })
})
