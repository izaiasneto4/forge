import { and, desc, eq, inArray } from 'drizzle-orm'
import { Elysia } from 'elysia'
import { PullRequestBoardResponse } from '../contracts/ui-payloads'
import { pullRequests } from '../db/schema'
import { ERROR_CODES, ok } from '../http/envelope'
import { idParam, InvalidParamError, mergeParams, parseBoolean, parseInteger, presentString, requireStringParam } from '../http/params'
import { iso8601 } from '../lib/ruby'
import {
  activeRemote,
  archivePullRequest,
  currentRepoCondition,
  currentSnapshotOrCreate,
  findPullRequest,
  notArchived,
  reviewTaskFor,
  updatePullRequest,
} from '../models/pull-request'
import { transaction } from '../models/record'
import {
  anyReviewRunning,
  createReviewTask,
  inProgressOrRetrying,
  prepareNewRun,
  queuePosition,
  reviewTaskIdsWithPendingJob,
  updateReviewTask,
  type ReviewTaskChanges,
  type ReviewTaskRecord,
} from '../models/review-task'
import { SettingStore } from '../models/setting'
import { syncStateForRepoPath, syncNeeded, syncStatePayload } from '../models/sync-state'
import { pullRequestBoardPayload, reviewTaskBoardPayload, reviewTaskDetailPayload, syncSkippedMessage } from '../presenters/ui-payloads'
import { broadcastUiEvent, pullRequestUpdated } from '../realtime/ui-events'
import { GithubCliError } from '../services/github-cli-client'
import { SyncAdapterError } from '../services/sync/github-adapter'
import type { AppContext } from '../context'
import { renderError, rescueRecordInvalid, type RouteDependencies } from './shared'

const ALLOWED_STATUSES = ['pending_review', 'in_review', 'reviewed_by_me', 'waiting_implementation', 'reviewed_by_others', 'review_failed', 'all']
const BULK_DESTROY_LIMIT = 100

function invalidInput(error: unknown): never {
  if (error instanceof InvalidParamError) renderError(ERROR_CODES.invalidInput, error.message)
  throw error
}

function syncFailed(error: unknown): never {
  if (error instanceof GithubCliError || error instanceof SyncAdapterError) renderError('sync_failed', error.message)
  throw error
}

export interface StartReviewOptions {
  cliClient: string
  reviewType: string
  // The reviewer's free-text focus for the prompt; blank clears an earlier one.
  focus: string | null
}

// `params[:focus].to_s.strip.presence`
export function focusParam(params: Record<string, unknown>) {
  return presentString(params, 'focus')?.trim() ?? null
}

// Shared by PullRequestsController#create_review_task and ReviewsController#create:
// queue behind a running review, otherwise start a ReviewTaskJob right away.
// One transaction, so a rejected request (say, an unknown cli_client) leaves the
// previous run's findings in place instead of half-reset.
// The task is read inside the transaction so two servers sharing the database
// can't both pass the conflict check and reset each other's run.
export function startOrQueueReview(ctx: AppContext, pullRequestId: number, options: StartReviewOptions) {
  const pullRequest = findPullRequest(ctx.db, pullRequestId)

  return transaction(ctx, (txCtx) => {
    const existing = reviewTaskFor(txCtx.db, pullRequest.id)
    if (existing && (inProgressOrRetrying(existing) || existing.state === 'queued' || reviewTaskIdsWithPendingJob(txCtx.jobs).has(existing.id))) {
      renderError('conflict', `Review already in progress for PR #${pullRequest.number}`, 409)
    }

    const snapshot = currentSnapshotOrCreate(txCtx, pullRequest)
    const queued = anyReviewRunning(txCtx)
    const changes: ReviewTaskChanges = {
      cliClient: options.cliClient,
      reviewType: options.reviewType,
      reviewFocus: options.focus,
      pullRequestSnapshotId: snapshot?.id ?? null,
      // A run started on a task archived through the old UI or the API must show up again.
      archived: false,
      state: queued ? 'queued' : 'pending_review',
      ...(queued ? { queuedAt: new Date() } : {}),
    }

    const task: ReviewTaskRecord = existing
      ? updateReviewTask(txCtx, prepareNewRun(txCtx, existing), changes)
      : createReviewTask(txCtx, { pullRequestId: pullRequest.id, ...changes })

    if (!queued) txCtx.jobs.enqueue('ReviewTaskJob', { reviewTaskId: task.id, isRetry: false })
    return { pullRequest, task, queued, queuePosition: queued ? queuePosition(txCtx.db, task) : null }
  })
}

export function pullRequestRoutes({ ctx, services, queueKick }: RouteDependencies) {
  const settings = new SettingStore(ctx.db)

  return new Elysia({ name: 'pull-request-routes', prefix: '/api/v1/pull_requests' })
    .get('', async ({ query }) => {
      const params = mergeParams(query, null)
      const status = presentString(params, 'status') ?? 'all'
      if (!ALLOWED_STATUSES.includes(status)) renderError(ERROR_CODES.invalidInput, 'status is invalid')

      let limit: number
      try {
        limit = parseInteger(params.limit, { defaultValue: 50, min: 1, max: 200, name: 'limit' })
      } catch (error) {
        invalidInput(error)
      }

      const repoCondition = await currentRepoCondition(ctx.commands, settings.currentRepo())
      const items = ctx.db
        .select()
        .from(pullRequests)
        .where(and(repoCondition, activeRemote, status === 'all' ? undefined : eq(pullRequests.reviewStatus, status)))
        .orderBy(desc(pullRequests.updatedAtGithub))
        .limit(limit)
        .all()
        .map((pr) => ({
          id: pr.id,
          number: pr.number,
          title: pr.title,
          url: pr.url,
          repo: `${pr.repoOwner ?? ''}/${pr.repoName ?? ''}`,
          review_status: pr.reviewStatus,
          updated_at_github: iso8601(pr.updatedAtGithub),
        }))

      return ok({ items })
    })
    .get(
      '/board',
      async () => {
        queueKick.run(ctx)
        return ok(await pullRequestBoardPayload(ctx))
      },
      { response: { 200: PullRequestBoardResponse } },
    )
    .post('/sync', async ({ query, body }) => {
      const params = mergeParams(query, body)
      let force: boolean
      try {
        force = parseBoolean(params.force)
      } catch (error) {
        invalidInput(error)
      }

      const syncState = await syncStateForRepoPath(ctx, settings.currentRepo())
      if (!force && syncState && !syncNeeded(syncState)) {
        return ok({
          message: await syncSkippedMessage(ctx),
          sync: syncStatePayload(syncState),
          already_running: false,
          board: await pullRequestBoardPayload(ctx),
        })
      }

      try {
        const result = await services.runSync(ctx, { repoPath: settings.currentRepo(), trigger: 'manual' })
        return ok({
          message: result.already_running ? 'Sync already running' : 'Synced with GitHub',
          sync: result.sync,
          already_running: result.already_running,
          board: await pullRequestBoardPayload(ctx),
        })
      } catch (error) {
        syncFailed(error)
      }
    })
    .patch('/review_scope', async ({ query, body }) => {
      const params = mergeParams(query, body)
      let onlyRequested: boolean
      try {
        onlyRequested = parseBoolean(params.requested_to_me_only)
      } catch (error) {
        invalidInput(error)
      }
      settings.setOnlyRequestedReviews(onlyRequested)

      const modeLabel = onlyRequested ? 'requested to me only' : 'all open PRs'
      return ok({ message: `Review scope updated: ${modeLabel}`, board: await pullRequestBoardPayload(ctx) })
    })
    .delete('/bulk_destroy', async ({ query, body, set }) => {
      const params = mergeParams(query, body)
      const raw = params.pull_request_ids
      const ids = (Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw])
        .map((id) => String(id))
        .filter((id) => id.trim() !== '')
      if (ids.length === 0) renderError(ERROR_CODES.invalidInput, 'No pull requests selected', 400)
      if (ids.length > BULK_DESTROY_LIMIT) {
        renderError(ERROR_CODES.invalidInput, `Cannot delete more than ${BULK_DESTROY_LIMIT} pull requests at once`, 400)
      }

      const now = new Date()
      const numericIds = ids.map(idParam)
      const deletedCount = ctx.db
        .update(pullRequests)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(notArchived, inArray(pullRequests.id, numericIds)))
        .returning({ id: pullRequests.id })
        .all().length
      broadcastUiEvent(ctx.events, 'pull_request.bulk_deleted', { pull_request_ids: ids })

      set.status = 200
      return ok({ message: `${deletedCount} pull requests deleted`, deleted_count: deletedCount, board: await pullRequestBoardPayload(ctx) })
    })
    .patch('/:id/status', async ({ params: route, query, body }) => {
      const pullRequest = findPullRequest(ctx.db, idParam(route.id))
      const reviewStatus = requireStringParam(mergeParams(query, body), 'review_status')
      const previousStatus = pullRequest.reviewStatus
      const updated = rescueRecordInvalid(() => updatePullRequest(ctx, pullRequest, { reviewStatus }))
      pullRequestUpdated(ctx.events, updated, previousStatus)

      return ok({ message: 'Status updated', board: await pullRequestBoardPayload(ctx) })
    })
    .patch('/:id/archive', async ({ params: route }) => {
      const archived = archivePullRequest(ctx, findPullRequest(ctx.db, idParam(route.id)))
      pullRequestUpdated(ctx.events, archived)
      return ok({ message: 'Pull request archived', board: await pullRequestBoardPayload(ctx) })
    })
    // Rails looked the PR up through the not-archived default scope, so this
    // always 404ed; restoring needs to see archived (not deleted) PRs.
    .patch('/:id/unarchive', async ({ params: route }) => {
      const id = idParam(route.id)
      const pullRequest = ctx.db.select().from(pullRequests).where(eq(pullRequests.id, id)).get()
      if (!pullRequest || pullRequest.deletedAt !== null) renderError(ERROR_CODES.notFound, 'Resource not found', 404)
      const restored = updatePullRequest(ctx, pullRequest, { archived: false })
      pullRequestUpdated(ctx.events, restored)
      return ok({ message: 'Pull request restored', board: await pullRequestBoardPayload(ctx) })
    })
    .post('/:id/review_task', async ({ params: route, query, body, set }) => {
      queueKick.run(ctx)
      const params = mergeParams(query, body)
      const { task, queued, queuePosition: position, pullRequest } = rescueRecordInvalid(() =>
        startOrQueueReview(ctx, idParam(route.id), {
          cliClient: presentString(params, 'cli_client') ?? settings.defaultCliClient(),
          reviewType: presentString(params, 'review_type') ?? 'review',
          focus: focusParam(params),
        }),
      )
      const message = queued
        ? `Review queued (#${position}) for PR #${pullRequest.number}`
        : `Review started for PR #${pullRequest.number}`

      set.status = 201
      return ok({
        message,
        detail: await reviewTaskDetailPayload(ctx, task),
        review_task_board: await reviewTaskBoardPayload(ctx),
        pull_request_board: await pullRequestBoardPayload(ctx),
      })
    })
}
