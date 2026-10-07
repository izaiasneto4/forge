import { and, asc, desc, eq, gt } from 'drizzle-orm'
import { Elysia } from 'elysia'
import type { AppContext } from '../context'
import { ReviewTaskBoardResponse, ReviewTaskDetailResponse } from '../contracts/ui-payloads'
import { agentLogs } from '../db/schema'
import { ERROR_CODES, ok } from '../http/envelope'
import { castBoolean, idParam, InvalidParamError, mergeParams, parseInteger, presentString, requireStringParam } from '../http/params'
import { isPresent, iso8601 } from '../lib/ruby'
import { findPullRequestUnscoped, updatePullRequest } from '../models/pull-request'
import {
  COMMENT_STATUSES,
  commentsWithIds,
  findReviewComment,
  markCommentsAddressed,
  nextCommentStatus,
  pendingComments,
  updateReviewComment,
  type ReviewCommentRecord,
} from '../models/review-comment'
import {
  anyReviewRunning,
  archiveReviewTask,
  backwardMovement,
  canRetry,
  dequeueReviewTask,
  destroyReviewTask,
  findReviewTask,
  isReviewTaskState,
  markDone,
  markSubmissionFailed,
  markSubmitted,
  markWaitingImplementation,
  moveBackward,
  reloadReviewTask,
  retryReview,
  unarchiveReviewTask,
  updateReviewTask,
  type ReviewTaskRecord,
} from '../models/review-task'
import { pullRequestBoardPayload, reviewTaskBoardPayload, reviewTaskDetailPayload } from '../presenters/ui-payloads'
import { pullRequestUpdated, reviewTaskUpdated } from '../realtime/ui-events'
import { GithubReviewSubmitterError } from '../services/github-review-submitter'
import { renderError, rescueRecordInvalid, type RouteDependencies } from './shared'

async function mutationPayload(ctx: AppContext, task: ReviewTaskRecord, message: string) {
  const fresh = reloadReviewTask(ctx.db, task)
  return ok({
    message,
    detail: await reviewTaskDetailPayload(ctx, fresh),
    review_task_board: await reviewTaskBoardPayload(ctx),
    pull_request_board: await pullRequestBoardPayload(ctx),
  })
}

function pullRequestFor(ctx: AppContext, task: ReviewTaskRecord) {
  const pullRequest = findPullRequestUnscoped(ctx.db, task.pullRequestId)
  if (!pullRequest) renderError(ERROR_CODES.notFound, 'Resource not found', 404)
  return pullRequest
}

function commentIds(value: unknown): number[] {
  const list = Array.isArray(value) ? value : []
  return list.map((id) => idParam(String(id))).filter((id) => id > 0)
}

// ReviewTaskSubmissionsController: picks comments, resolves the event, posts to GitHub.
async function submitReviewTask(deps: RouteDependencies, task: ReviewTaskRecord, params: Record<string, unknown>) {
  const { ctx, services } = deps
  const event = presentString(params, 'event')
  const summary = presentString(params, 'summary')
  const forceEmptySubmission = castBoolean(params.force_empty_submission) === true
  // An explicit list, even an empty one, is exactly what gets sent: the reviewer
  // excluded every finding. Only an omitted list falls back to all pending comments.
  const requestedIds = Array.isArray(params.comment_ids) ? commentIds(params.comment_ids) : null

  const selected: ReviewCommentRecord[] =
    forceEmptySubmission && event === 'APPROVE'
      ? []
      : requestedIds !== null
        ? commentsWithIds(ctx.db, task.id, requestedIds)
        : pendingComments(ctx.db, task.id)

  const allowEmptyApproval = forceEmptySubmission && event === 'APPROVE'
  if (selected.length === 0 && !allowEmptyApproval) {
    renderError(ERROR_CODES.invalidInput, 'No comments selected for submission')
  }

  const blocking = selected.some((comment) => comment.severity === 'critical' || comment.severity === 'major')
  const effectiveEvent = event ?? (blocking ? 'REQUEST_CHANGES' : 'COMMENT')

  let result: unknown
  try {
    result = await services.submitReview(ctx, task, { event: effectiveEvent, summary, comments: selected })
  } catch (error) {
    if (error instanceof GithubReviewSubmitterError) {
      markSubmissionFailed(ctx, task, error.message)
      renderError('submission_failed', error.message)
    }
    throw error
  }

  markCommentsAddressed(ctx.db, selected.map((comment) => comment.id))
  let current = markSubmitted(ctx, task, effectiveEvent)
  const pullRequest = pullRequestFor(ctx, current)

  if (effectiveEvent === 'REQUEST_CHANGES') {
    current = markWaitingImplementation(ctx, current)
    updatePullRequest(ctx, pullRequest, { reviewStatus: 'waiting_implementation' })
  } else if (effectiveEvent === 'APPROVE') {
    current = markDone(ctx, current)
    updatePullRequest(ctx, pullRequest, { reviewStatus: 'reviewed_by_others' })
  } else if (current.state === 'waiting_implementation') {
    current = updateReviewTask(ctx, current, { state: 'reviewed' })
    updatePullRequest(ctx, pullRequest, { reviewStatus: 'reviewed_by_me' })
  } else {
    updatePullRequest(ctx, pullRequest, { reviewStatus: 'reviewed_by_me' })
  }

  return ok({
    message: 'Review submitted successfully to GitHub',
    result,
    detail: await reviewTaskDetailPayload(ctx, current),
    review_task_board: await reviewTaskBoardPayload(ctx),
    pull_request_board: await pullRequestBoardPayload(ctx),
  })
}

export function reviewTaskRoutes(deps: RouteDependencies) {
  const { ctx, queueKick } = deps

  return new Elysia({ name: 'review-task-routes', prefix: '/api/v1' })
    .get(
      '/review_tasks/board',
      async () => {
        queueKick.run(ctx)
        return ok(await reviewTaskBoardPayload(ctx))
      },
      { response: { 200: ReviewTaskBoardResponse } },
    )
    .get('/review_tasks/:id', async ({ params: route }) => ok(await reviewTaskDetailPayload(ctx, findReviewTask(ctx.db, idParam(route.id)))), {
      response: { 200: ReviewTaskDetailResponse },
    })
    .patch('/review_tasks/:id/state', async ({ params: route, query, body }) => {
      const task = findReviewTask(ctx.db, idParam(route.id))
      const params = mergeParams(query, body)
      const newState = requireStringParam(params, 'state')
      const isBackwardMove = params.backward_move === true || params.backward_move === 'true'
      if (!isReviewTaskState(newState)) renderError(ERROR_CODES.invalidInput, 'Invalid state')

      const updated = rescueRecordInvalid(() =>
        isBackwardMove && backwardMovement(task, newState) ? moveBackward(ctx, task, newState) : updateReviewTask(ctx, task, { state: newState }),
      )
      return mutationPayload(ctx, updated ?? task, 'Task state updated')
    })
    .post('/review_tasks/:id/retry', async ({ params: route }) => {
      const task = findReviewTask(ctx.db, idParam(route.id))
      if (task.state !== 'failed_review') renderError(ERROR_CODES.invalidInput, 'Can only retry failed reviews')
      if (!canRetry(task)) renderError(ERROR_CODES.invalidInput, 'Maximum retry attempts reached')
      if (anyReviewRunning(ctx)) renderError('conflict', 'Review already in progress')

      const retried = retryReview(ctx, task)
      ctx.jobs.enqueue('ReviewTaskJob', { reviewTaskId: retried.id, isRetry: true })
      return mutationPayload(ctx, retried, 'Retry initiated')
    })
    .delete('/review_tasks/:id/dequeue', async ({ params: route }) => {
      const task = findReviewTask(ctx.db, idParam(route.id))
      if (task.state !== 'queued') renderError(ERROR_CODES.invalidInput, 'Can only dequeue queued reviews')

      const dequeued = dequeueReviewTask(ctx, task)
      reviewTaskUpdated(ctx.events, dequeued, findPullRequestUnscoped(ctx.db, dequeued.pullRequestId))
      return mutationPayload(ctx, dequeued, 'Review removed from queue')
    })
    .delete('/review_tasks/:id/clear', async ({ params: route }) => {
      const task = findReviewTask(ctx.db, idParam(route.id))
      destroyReviewTask(ctx, task)
      const pullRequest = pullRequestFor(ctx, task)
      const reset = updatePullRequest(ctx, pullRequest, { reviewStatus: 'pending_review' })
      pullRequestUpdated(ctx.events, reset)

      return ok({
        message: 'Review cleared',
        cleared_review_task_id: task.id,
        pull_request_board: await pullRequestBoardPayload(ctx),
        review_task_board: await reviewTaskBoardPayload(ctx),
      })
    })
    .patch('/review_tasks/:id/archive', async ({ params: route }) => {
      const archived = archiveReviewTask(ctx, findReviewTask(ctx.db, idParam(route.id)))
      reviewTaskUpdated(ctx.events, archived, findPullRequestUnscoped(ctx.db, archived.pullRequestId))
      return mutationPayload(ctx, archived, 'Review task archived')
    })
    .patch('/review_tasks/:id/unarchive', async ({ params: route }) => {
      const restored = unarchiveReviewTask(ctx, findReviewTask(ctx.db, idParam(route.id)))
      reviewTaskUpdated(ctx.events, restored, findPullRequestUnscoped(ctx.db, restored.pullRequestId))
      return mutationPayload(ctx, restored, 'Review task restored')
    })
    .post('/review_tasks/:id/submissions', async ({ params: route, query, body }) =>
      submitReviewTask(deps, findReviewTask(ctx.db, idParam(route.id)), mergeParams(query, body)),
    )
    .get('/review_tasks/:id/logs', ({ params: route, query }) => {
      const task = findReviewTask(ctx.db, idParam(route.id))
      const params = mergeParams(query, null)
      let tail: number
      let afterId: number | null
      try {
        tail = parseInteger(params.tail, { defaultValue: 100, min: 1, max: 1000, name: 'tail' })
        afterId = isPresent(presentString(params, 'after_id'))
          ? parseInteger(params.after_id, { defaultValue: 0, min: 1, max: 9_999_999, name: 'after_id' })
          : null
      } catch (error) {
        if (error instanceof InvalidParamError) renderError(ERROR_CODES.invalidInput, error.message)
        throw error
      }

      const logs =
        afterId === null
          ? ctx.db.select().from(agentLogs).where(eq(agentLogs.reviewTaskId, task.id)).orderBy(desc(agentLogs.id)).limit(tail).all().reverse()
          : ctx.db
              .select()
              .from(agentLogs)
              .where(and(eq(agentLogs.reviewTaskId, task.id), gt(agentLogs.id, afterId)))
              .orderBy(asc(agentLogs.id))
              .limit(tail)
              .all()

      return ok({
        task: { id: task.id, state: task.state, pull_request_number: pullRequestFor(ctx, task).number },
        logs: logs.map((log) => ({ id: log.id, created_at: iso8601(log.createdAt), log_type: log.logType, message: log.message })),
      })
    })
    // Without a status the comment cycles pending -> addressed -> dismissed; the
    // frontend passes one to dismiss or restore a finding in a single step.
    .patch('/review_comments/:id/toggle', async ({ params: route, query, body }) => {
      const comment = findReviewComment(ctx.db, idParam(route.id))
      const status = presentString(mergeParams(query, body), 'status') ?? nextCommentStatus(comment.status)
      if (!COMMENT_STATUSES.some((known) => known === status)) renderError(ERROR_CODES.invalidInput, `Unknown status: ${status}`)
      const updated = updateReviewComment(ctx.db, comment, { status })
      return ok({ detail: await reviewTaskDetailPayload(ctx, findReviewTask(ctx.db, updated.reviewTaskId)) })
    })
}

