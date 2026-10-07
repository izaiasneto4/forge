import { and, asc, count, desc, eq, inArray, lt, max } from 'drizzle-orm'
import type { AppContext } from '../context'
import type { Db } from '../db/client'
import { agentLogs, reviewComments, reviewIterations, reviewTasks } from '../db/schema'
import { RecordNotFoundError } from '../lib/errors'
import { literals } from '../lib/literals'
import { isPresent, iso8601, secondsAgo } from '../lib/ruby'
import { reviewTaskUpdated } from '../realtime/ui-events'
import { createAgentLog, type LogType } from './agent-log'
import { currentSnapshotOrCreate, findPullRequestUnscoped, updatePullRequest, updatePullRequestColumns } from './pull-request'
import { changed, hasChanges, transaction, Validator } from './record'
import { CLI_CLIENTS } from './setting'

export type ReviewTaskRecord = typeof reviewTasks.$inferSelect
export type ReviewTaskValues = Omit<typeof reviewTasks.$inferInsert, 'id' | 'createdAt' | 'updatedAt'>
export type ReviewTaskChanges = Partial<ReviewTaskValues>

export const REVIEW_TASK_STATES = literals(
  'queued',
  'pending_review',
  'in_review',
  'reviewed',
  'waiting_implementation',
  'done',
  'failed_review',
)
export type ReviewTaskState = (typeof REVIEW_TASK_STATES)[number]
export const REVIEW_TYPES = ['review', 'swarm']
export const SUBMISSION_STATUSES = ['pending_submission', 'submitted', 'submission_failed']
export const SUBMITTED_EVENTS = literals('COMMENT', 'APPROVE', 'REQUEST_CHANGES')
export const MAX_RETRY_ATTEMPTS = 3
export const BACKOFF_BASE_SECONDS = 2
// Workflow order for detecting backward moves; failed_review sits outside it.
export const STATE_ORDER = ['queued', 'pending_review', 'in_review', 'reviewed', 'waiting_implementation', 'done']

export function isReviewTaskState(value: string): value is ReviewTaskState {
  return REVIEW_TASK_STATES.some((state) => state === value)
}

export const notArchivedTasks = eq(reviewTasks.archived, false)
export const tasksInState = (state: ReviewTaskState) => and(notArchivedTasks, eq(reviewTasks.state, state))

export function findReviewTask(db: Db, id: number): ReviewTaskRecord {
  const record = db.select().from(reviewTasks).where(eq(reviewTasks.id, id)).get()
  if (!record) throw new RecordNotFoundError('ReviewTask', id)
  return record
}

export function reloadReviewTask(db: Db, task: ReviewTaskRecord) {
  return findReviewTask(db, task.id)
}

// Not archived, in `state`, ordered by queued_at for the queue.
export function tasksIn(db: Db, state: ReviewTaskState) {
  const query = db.select().from(reviewTasks).where(tasksInState(state))
  return state === 'queued' ? query.orderBy(asc(reviewTasks.queuedAt)).all() : query.all()
}

function existsInState(db: Db, state: ReviewTaskState) {
  return db.select({ id: reviewTasks.id }).from(reviewTasks).where(tasksInState(state)).get() !== undefined
}

function validate(values: ReviewTaskValues) {
  const validator = new Validator()
  validator.inclusion('State', values.state ?? 'pending_review', REVIEW_TASK_STATES)
  validator.inclusion('Cli client', values.cliClient ?? 'claude', CLI_CLIENTS)
  validator.inclusion('Review type', values.reviewType ?? 'review', REVIEW_TYPES)
  validator.inclusion('Submission status', values.submissionStatus, SUBMISSION_STATUSES, { allowNil: true })
  validator.inclusion('Submitted event', values.submittedEvent, SUBMITTED_EVENTS, { allowNil: true })
  validator.assertValid()
}

function broadcastStateChange(ctx: AppContext, task: ReviewTaskRecord, previousState: string | null) {
  reviewTaskUpdated(ctx.events, task, findPullRequestUnscoped(ctx.db, task.pullRequestId), previousState)
}

// `pull_request.build_review_task(...).save!`; broadcasts the initial state.
export function createReviewTask(ctx: AppContext, values: ReviewTaskValues): ReviewTaskRecord {
  validate(values)
  const now = new Date()
  const record = ctx.db.insert(reviewTasks).values({ ...values, createdAt: now, updatedAt: now }).returning().get()
  broadcastStateChange(ctx, record, null)
  return record
}

// `review_task.update!(...)`: validates, touches updated_at, broadcasts state changes.
export function updateReviewTask(ctx: AppContext, task: ReviewTaskRecord, changes: ReviewTaskChanges): ReviewTaskRecord {
  if (!hasChanges(task, changes)) return task
  validate({ ...task, ...changes })
  const updated = ctx.db
    .update(reviewTasks)
    .set({ ...changes, updatedAt: new Date() })
    .where(eq(reviewTasks.id, task.id))
    .returning()
    .get()
  if (!updated) throw new RecordNotFoundError('ReviewTask', task.id)
  if (changed(task, changes, 'state')) broadcastStateChange(ctx, updated, task.state)
  return updated
}

export function inProgressOrRetrying(task: ReviewTaskRecord, now = new Date()) {
  if (task.state === 'in_review') return true
  if (task.state === 'pending_review' && task.retryCount > 0) return true
  return task.lastRetryAt !== null && task.lastRetryAt > secondsAgo(5 * 60, now)
}

export function canRetry(task: ReviewTaskRecord) {
  return task.retryCount < MAX_RETRY_ATTEMPTS
}

export function retriesExhausted(task: ReviewTaskRecord) {
  return task.retryCount >= MAX_RETRY_ATTEMPTS
}

export function backoffSeconds(task: ReviewTaskRecord) {
  return BACKOFF_BASE_SECONDS ** (task.retryCount + 1)
}

export interface RetryHistoryEntry {
  attempt: number
  reason: string
  timestamp: string
  permanent: boolean
}

export function parsedRetryHistory(task: ReviewTaskRecord): unknown[] {
  if (!isPresent(task.retryHistory)) return []
  try {
    const parsed: unknown = JSON.parse(task.retryHistory)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function retryHistoryWith(task: ReviewTaskRecord, reason: string, permanent: boolean) {
  const entry: RetryHistoryEntry = { attempt: task.retryCount + 1, reason, timestamp: iso8601(new Date()), permanent }
  return JSON.stringify([...parsedRetryHistory(task), entry])
}

export function markSubmitted(ctx: AppContext, task: ReviewTaskRecord, event: string | null = null) {
  return updateReviewTask(ctx, task, {
    submissionStatus: 'submitted',
    submittedAt: new Date(),
    ...(isPresent(event) ? { submittedEvent: event } : {}),
  })
}

export function markSubmissionFailed(ctx: AppContext, task: ReviewTaskRecord, reason: string | null = null) {
  return updateReviewTask(ctx, task, { submissionStatus: 'submission_failed', failureReason: reason })
}

export function enqueueReviewTask(ctx: AppContext, task: ReviewTaskRecord) {
  return updateReviewTask(ctx, task, { state: 'queued', queuedAt: new Date() })
}

export function dequeueReviewTask(ctx: AppContext, task: ReviewTaskRecord) {
  return updateReviewTask(ctx, task, { state: 'pending_review', queuedAt: null })
}

export function queuePosition(db: Db, task: ReviewTaskRecord) {
  if (task.state !== 'queued' || task.queuedAt === null) return task.state === 'queued' ? 1 : null
  const ahead = db
    .select({ total: count() })
    .from(reviewTasks)
    .where(and(tasksInState('queued'), lt(reviewTasks.queuedAt, task.queuedAt)))
    .get()
  return (ahead?.total ?? 0) + 1
}

export function claimedReviewJobExists(ctx: AppContext) {
  return ctx.jobs.hasClaimed('ReviewTaskJob')
}

export function anyReviewRunning(ctx: AppContext) {
  return existsInState(ctx.db, 'in_review') || claimedReviewJobExists(ctx)
}

// Atomically moves the oldest queued task to pending_review and starts its job.
export function claimAndStartNextQueued(ctx: AppContext): ReviewTaskRecord | null {
  return transaction(ctx, (txCtx) => {
    if (anyReviewRunning(txCtx)) return null
    const [next] = tasksIn(txCtx.db, 'queued')
    if (!next) return null
    const dequeued = dequeueReviewTask(txCtx, next)
    txCtx.jobs.enqueue('ReviewTaskJob', { reviewTaskId: dequeued.id, isRetry: false })
    return dequeued
  })
}

export function startNextQueued(ctx: AppContext) {
  const [next] = tasksIn(ctx.db, 'queued')
  if (!next) return null
  const dequeued = dequeueReviewTask(ctx, next)
  ctx.jobs.enqueue('ReviewTaskJob', { reviewTaskId: dequeued.id, isRetry: false })
  return dequeued
}

function pullRequestOf(db: Db, task: ReviewTaskRecord) {
  const pullRequest = findPullRequestUnscoped(db, task.pullRequestId)
  if (!pullRequest) throw new RecordNotFoundError('PullRequest', task.pullRequestId)
  return pullRequest
}

export function startReview(ctx: AppContext, task: ReviewTaskRecord) {
  const started = updateReviewTask(ctx, task, { state: 'in_review', startedAt: new Date() })
  const pullRequest = pullRequestOf(ctx.db, started)
  if (pullRequest.reviewStatus === 'pending_review' || pullRequest.reviewStatus === 'review_failed') {
    updatePullRequest(ctx, pullRequest, { reviewStatus: 'in_review' })
  }
  return started
}

export function completeReview(ctx: AppContext, task: ReviewTaskRecord, output: string) {
  const completed = updateReviewTask(ctx, task, { state: 'reviewed', reviewOutput: output, completedAt: new Date() })
  const pullRequest = pullRequestOf(ctx.db, completed)
  if (pullRequest.reviewStatus === 'pending_review' || pullRequest.reviewStatus === 'in_review') {
    updatePullRequest(ctx, pullRequest, { reviewStatus: 'reviewed_by_me' })
  }
  return completed
}

export function markWaitingImplementation(ctx: AppContext, task: ReviewTaskRecord) {
  return updateReviewTask(ctx, task, { state: 'waiting_implementation' })
}

export function markDone(ctx: AppContext, task: ReviewTaskRecord) {
  return updateReviewTask(ctx, task, { state: 'done' })
}

export function markFailed(ctx: AppContext, task: ReviewTaskRecord, reason: string) {
  const failed = updateReviewTask(ctx, task, {
    retryHistory: retryHistoryWith(task, reason, true),
    state: 'failed_review',
    failureReason: reason,
    completedAt: new Date(),
  })
  updatePullRequest(ctx, pullRequestOf(ctx.db, failed), { reviewStatus: 'review_failed' })
  return failed
}

export class ReviewTaskTransitionError extends Error {}

export function retryReview(ctx: AppContext, task: ReviewTaskRecord) {
  if (task.state !== 'failed_review') throw new ReviewTaskTransitionError('Cannot retry: not in failed state')
  if (!canRetry(task)) throw new ReviewTaskTransitionError('Cannot retry: max attempts reached')

  const pullRequest = pullRequestOf(ctx.db, task)
  const snapshot = currentSnapshotOrCreate(ctx, pullRequest)
  const retried = updateReviewTask(ctx, task, {
    state: 'pending_review',
    startedAt: null,
    completedAt: null,
    worktreePath: null,
    pullRequestSnapshotId: snapshot?.id ?? null,
  })
  updatePullRequest(ctx, pullRequestOf(ctx.db, retried), { reviewStatus: 'pending_review' })
  return retried
}

export function incrementRetry(ctx: AppContext, task: ReviewTaskRecord, reason: string) {
  return updateReviewTask(ctx, task, {
    retryHistory: retryHistoryWith(task, reason, false),
    retryCount: task.retryCount + 1,
    lastRetryAt: new Date(),
    failureReason: reason,
  })
}

export function resetRetryState(ctx: AppContext, task: ReviewTaskRecord) {
  return updateReviewTask(ctx, task, { retryCount: 0, lastRetryAt: null, failureReason: null, retryHistory: null })
}

// `add_log`: blank messages are ignored; each log is pushed to the task's stream.
export function addLog(ctx: AppContext, task: { id: number }, message: string | null, logType: LogType = 'output') {
  if (!isPresent(message)) return undefined
  return createAgentLog(ctx, { reviewTaskId: task.id, message, logType })
}

export function clearLogs(db: Db, task: { id: number }) {
  db.delete(agentLogs).where(eq(agentLogs.reviewTaskId, task.id)).run()
}

export function backwardMovement(task: ReviewTaskRecord, newState: string) {
  if (newState === 'failed_review') return false
  const currentIndex = STATE_ORDER.indexOf(task.state)
  const newIndex = STATE_ORDER.indexOf(newState)
  if (currentIndex === -1 || newIndex === -1) return false
  return newIndex < currentIndex
}

function hasComments(db: Db, taskId: number) {
  return db.select({ id: reviewComments.id }).from(reviewComments).where(eq(reviewComments.reviewTaskId, taskId)).get() !== undefined
}

// Archives the current review as a new ReviewIteration before moving backward.
export function archiveCurrentReview(db: Db, task: ReviewTaskRecord) {
  if (!isPresent(task.reviewOutput) && !hasComments(db, task.id)) return
  const latest = db
    .select({ number: max(reviewIterations.iterationNumber) })
    .from(reviewIterations)
    .where(eq(reviewIterations.reviewTaskId, task.id))
    .get()
  const now = new Date()
  db.insert(reviewIterations)
    .values({
      reviewTaskId: task.id,
      iterationNumber: (latest?.number ?? 0) + 1,
      reviewOutput: task.reviewOutput,
      cliClient: task.cliClient,
      reviewType: task.reviewType,
      aiModel: task.aiModel,
      fromState: task.state,
      toState: 'archived',
      startedAt: task.startedAt,
      completedAt: task.completedAt,
      createdAt: now,
      updatedAt: now,
    })
    .run()
}

export function resetForNewReview(ctx: AppContext, task: ReviewTaskRecord) {
  ctx.db.delete(reviewComments).where(eq(reviewComments.reviewTaskId, task.id)).run()
  clearLogs(ctx.db, task)
  return updateReviewTask(ctx, task, {
    reviewOutput: null,
    aiModel: null,
    startedAt: null,
    completedAt: null,
    failureReason: null,
    retryCount: 0,
    retryHistory: null,
  })
}

// Moves backward while keeping the current review as history.
export function moveBackward(ctx: AppContext, task: ReviewTaskRecord, newState: ReviewTaskState) {
  if (!backwardMovement(task, newState)) return null
  return transaction(ctx, (txCtx) => {
    archiveCurrentReview(txCtx.db, task)
    const reset = resetForNewReview(txCtx, task)
    return updateReviewTask(txCtx, reset, { state: newState })
  })
}

export function currentIterationNumber(db: Db, task: { id: number }) {
  const row = db.select({ total: count() }).from(reviewIterations).where(eq(reviewIterations.reviewTaskId, task.id)).get()
  return row?.total ?? 0
}

export function hasReviewHistory(db: Db, task: { id: number }) {
  return currentIterationNumber(db, task) > 0
}

export function reviewHistory(db: Db, task: { id: number }) {
  return db
    .select()
    .from(reviewIterations)
    .where(eq(reviewIterations.reviewTaskId, task.id))
    .orderBy(asc(reviewIterations.iterationNumber))
    .all()
}

function latestLogAt(db: Db, taskId: number) {
  const row = db
    .select({ createdAt: agentLogs.createdAt })
    .from(agentLogs)
    .where(eq(agentLogs.reviewTaskId, taskId))
    .orderBy(desc(agentLogs.createdAt))
    .get()
  return row?.createdAt ?? null
}

// Rails matched `arguments LIKE '%<id>%'`, which also hit other ids containing
// the digits; this checks the decoded payload instead.
export function activeJobExistsFor(ctx: AppContext, taskId: number) {
  return ctx.jobs
    .unfinished('ReviewTaskJob')
    .some((job) => job.name === 'ReviewTaskJob' && job.payload.reviewTaskId === taskId)
}

// Recurring: puts in_review tasks with no activity for `timeoutMinutes` back to pending.
export function resetStuckTasks(ctx: AppContext, timeoutMinutes = 10) {
  const threshold = secondsAgo(timeoutMinutes * 60)
  let resetCount = 0
  const candidates = ctx.db
    .select()
    .from(reviewTasks)
    .where(and(tasksInState('in_review'), lt(reviewTasks.startedAt, threshold)))
    .orderBy(asc(reviewTasks.id))
    .all()

  for (const task of candidates) {
    if (activeJobExistsFor(ctx, task.id)) continue
    const lastActivity = latestLogAt(ctx.db, task.id) ?? task.startedAt
    if (lastActivity === null || lastActivity >= threshold) continue

    updateReviewTask(ctx, task, {
      state: 'pending_review',
      startedAt: null,
      worktreePath: null,
      failureReason: `Reset: task was stuck in review for over ${timeoutMinutes} minutes`,
    })
    clearLogs(ctx.db, task)
    resetCount += 1
  }
  return resetCount
}

// Recovers in_review tasks orphaned by a restart (no claimed ReviewTaskJob).
export function recoverOrphanedInReviewTasks(ctx: AppContext, staleSeconds = 60) {
  if (!existsInState(ctx.db, 'in_review')) return 0
  if (claimedReviewJobExists(ctx)) return 0

  const threshold = secondsAgo(staleSeconds)
  let recoveredCount = 0
  for (const task of tasksIn(ctx.db, 'in_review').sort((left, right) => left.id - right.id)) {
    const lastActivity = latestLogAt(ctx.db, task.id) ?? task.startedAt ?? task.updatedAt
    if (lastActivity > threshold) continue

    transaction(ctx, (txCtx) => {
      clearLogs(txCtx.db, task)
      updateReviewTask(txCtx, task, {
        state: 'pending_review',
        startedAt: null,
        worktreePath: null,
        failureReason: 'Reset: orphaned in_review task (no active ReviewTaskJob claim)',
      })
      const pullRequest = findPullRequestUnscoped(txCtx.db, task.pullRequestId)
      if (pullRequest?.reviewStatus === 'in_review') {
        updatePullRequestColumns(txCtx.db, pullRequest.id, { reviewStatus: 'pending_review' })
      }
    })
    recoveredCount += 1
  }
  return recoveredCount
}

// Called on page loads so the queue never stalls.
export function processQueueIfIdle(ctx: AppContext) {
  if (!existsInState(ctx.db, 'queued')) return
  if (anyReviewRunning(ctx)) return
  if (claimedReviewJobExists(ctx)) return
  if (ctx.jobs.hasReady('ProcessReviewQueueJob')) return
  ctx.jobs.enqueue('ProcessReviewQueueJob', {})
}

export function archiveReviewTask(ctx: AppContext, task: ReviewTaskRecord) {
  return updateReviewTask(ctx, task, { archived: true })
}

export function unarchiveReviewTask(ctx: AppContext, task: ReviewTaskRecord) {
  return updateReviewTask(ctx, task, { archived: false })
}

const STATUSES_RESET_ON_DESTROY = ['reviewed_by_me', 'waiting_implementation', 'in_review', 'review_failed']

// `review_task.destroy!`: resets a reviewed PR to pending, removes dependents.
export function destroyReviewTask(ctx: AppContext, task: ReviewTaskRecord) {
  transaction(ctx, ({ db }) => {
    const pullRequest = findPullRequestUnscoped(db, task.pullRequestId)
    if (pullRequest && STATUSES_RESET_ON_DESTROY.includes(pullRequest.reviewStatus ?? '')) {
      updatePullRequestColumns(db, pullRequest.id, { reviewStatus: 'pending_review' })
    }
    db.delete(agentLogs).where(eq(agentLogs.reviewTaskId, task.id)).run()
    db.delete(reviewComments).where(eq(reviewComments.reviewTaskId, task.id)).run()
    db.delete(reviewIterations).where(eq(reviewIterations.reviewTaskId, task.id)).run()
    db.delete(reviewTasks).where(eq(reviewTasks.id, task.id)).run()
  })
}

export function tasksForPullRequests(db: Db, pullRequestIds: number[]) {
  if (pullRequestIds.length === 0) return []
  return db.select().from(reviewTasks).where(inArray(reviewTasks.pullRequestId, pullRequestIds)).all()
}

