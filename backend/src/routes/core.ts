import { and, asc, count, eq } from 'drizzle-orm'
import { Elysia } from 'elysia'
import type { AppContext } from '../context'
import { pullRequests, reviewTasks } from '../db/schema'
import { ERROR_CODES, ok } from '../http/envelope'
import { InvalidParamError, mergeParams, parseBoolean, presentString, requireStringParam } from '../http/params'
import { isPresent, iso8601 } from '../lib/ruby'
import { findPullRequestBy, withReviewStatus } from '../models/pull-request'
import { processQueueIfIdle, recoverOrphanedInReviewTasks, tasksInState } from '../models/review-task'
import { SettingStore } from '../models/setting'
import { syncNeeded, syncStateForRepoPath, syncStatePayload, secondsUntilSyncAllowed } from '../models/sync-state'
import { BootstrapResponse } from '../contracts/ui-payloads'
import { bootstrapPayload, syncStatusPayload } from '../presenters/ui-payloads'
import { GithubCliError } from '../services/github-cli-client'
import { parsePullRequestUrl } from '../services/pull-request-url-parser'
import { slugFromPath } from '../services/repo-slug-resolver'
import { SyncAdapterError } from '../services/sync/github-adapter'
import { startOrQueueReview } from './pull-requests'
import { renderError, rescueRecordInvalid, type RouteDependencies } from './shared'

function countWhere(ctx: AppContext, table: typeof pullRequests | typeof reviewTasks, condition: ReturnType<typeof and>) {
  return ctx.db.select({ total: count() }).from(table).where(condition).get()?.total ?? 0
}

function rescueSync(error: unknown): never {
  if (error instanceof InvalidParamError) renderError(ERROR_CODES.invalidInput, error.message)
  if (error instanceof GithubCliError || error instanceof SyncAdapterError) renderError('sync_failed', error.message)
  throw error
}

export function coreRoutes({ ctx, services }: RouteDependencies) {
  const settings = new SettingStore(ctx.db)

  return new Elysia({ name: 'core-routes', prefix: '/api/v1' })
    .get('/bootstrap', async () => ok(await bootstrapPayload(ctx)), { response: { 200: BootstrapResponse } })
    // StatusController#index: also nudges the review queue on every poll.
    .get('/status', async () => {
      recoverOrphanedInReviewTasks(ctx)
      processQueueIfIdle(ctx)

      const running = ctx.db.select({ id: reviewTasks.id }).from(reviewTasks).where(tasksInState('in_review')).orderBy(asc(reviewTasks.id)).get()
      const currentRepo = settings.currentRepo()
      const syncState = await syncStateForRepoPath(ctx, currentRepo)

      return ok({
        repo: await slugFromPath(ctx.commands, currentRepo),
        counts: {
          pending_review: countWhere(ctx, pullRequests, withReviewStatus('pending_review')),
          in_review: countWhere(ctx, pullRequests, withReviewStatus('in_review')),
          queued: countWhere(ctx, reviewTasks, tasksInState('queued')),
          failed_review: countWhere(ctx, reviewTasks, tasksInState('failed_review')),
        },
        running_task_id: running?.id ?? null,
        last_synced_at: iso8601(syncState?.lastSucceededAt),
        sync_status: await syncStatusPayload(ctx),
      })
    })
    // SyncsController#create (used by the CLI).
    .post('/sync', async ({ query, body }) => {
      try {
        const force = parseBoolean(mergeParams(query, body).force)
        const syncState = await syncStateForRepoPath(ctx, settings.currentRepo())

        if (!force && syncState && !syncNeeded(syncState)) {
          return ok({
            skipped: true,
            sync: syncStatePayload(syncState),
            seconds_remaining: secondsUntilSyncAllowed(syncState),
            last_synced_at: iso8601(syncState.lastSucceededAt),
          })
        }

        const result = await services.runSync(ctx, { repoPath: settings.currentRepo(), trigger: 'manual' })
        return ok({
          skipped: false,
          already_running: result.already_running,
          sync: result.sync,
          last_synced_at: result.sync.last_succeeded_at,
        })
      } catch (error) {
        rescueSync(error)
      }
    })
    // ReviewsController#create: start a review from a PR URL (used by the CLI).
    .post('/reviews', async ({ query, body, set }) => {
      const params = mergeParams(query, body)
      const parsed = parsePullRequestUrl(requireStringParam(params, 'pr_url'))
      if (!parsed) renderError(ERROR_CODES.invalidInput, 'pr_url must be a valid GitHub pull request URL')

      const currentSlug = await slugFromPath(ctx.commands, settings.currentRepo())
      if (isPresent(currentSlug) && currentSlug !== parsed.repo) {
        renderError(ERROR_CODES.invalidInput, `PR repo ${parsed.repo} does not match current repo ${currentSlug}`)
      }

      try {
        let pullRequest = findPullRequestBy(ctx.db, eq(pullRequests.url, parsed.url))
        if (!pullRequest) {
          await services.runSync(ctx, { repoPath: settings.currentRepo(), trigger: 'focused_pr', pullRequestNumber: parsed.number })
          pullRequest = findPullRequestBy(
            ctx.db,
            and(eq(pullRequests.repoOwner, parsed.owner), eq(pullRequests.repoName, parsed.name), eq(pullRequests.number, parsed.number)),
          )
        }
        if (!pullRequest) renderError(ERROR_CODES.notFound, 'Pull request not found after sync', 404)

        const found = pullRequest
        const { task, queuePosition } = rescueRecordInvalid(
          () =>
            startOrQueueReview(ctx, found.id, {
              cliClient: presentString(params, 'cli_client') ?? settings.defaultCliClient(),
              reviewType: presentString(params, 'review_type') ?? 'review',
            }),
          422,
        )

        set.status = 201
        return ok({ task_id: task.id, state: task.state, queue_position: queuePosition, pull_request_id: found.id })
      } catch (error) {
        rescueSync(error)
      }
    })
}
