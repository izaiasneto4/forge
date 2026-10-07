import { and, asc, eq } from 'drizzle-orm'
import type { AppContext } from '../context'
import { pullRequests, reviewTasks } from '../db/schema'
import { updatePullRequest, withReviewStatus, type PullRequestRecord } from '../models/pull-request'
import { transaction } from '../models/record'
import { moveBackward, updateReviewTask, type ReviewTaskRecord } from '../models/review-task'
import type { GithubCliClient } from './github-cli-client'

// Port of ReviewLifecycleBackfillService: re-derives the lifecycle state of
// submitted reviews from GitHub's review history (dry-run unless `apply`).

// GitHub review state -> the event Ordem records as `submitted_event`.
export const EVENT_MAP = new Map([
  ['CHANGES_REQUESTED', 'REQUEST_CHANGES'],
  ['APPROVED', 'APPROVE'],
  ['COMMENTED', 'COMMENT'],
])

export type BackfillGithubClient = Pick<GithubCliClient, 'reviewRequestedForMe' | 'latestMyReviewState'>

// Where progress lines go (`$stdout` in the rake task).
export interface OutputWriter {
  puts(line: string): void
}

export interface BackfillOptions {
  apply?: boolean
  limit?: number | null
}

export interface BackfillSummary {
  processed: number
  updated: number
  skipped: number
  failed: number
  mode: 'apply' | 'dry-run'
}

type PlannedAction =
  | { type: 'noop'; reason: string }
  | { type: 'reset_to_pending'; reason: string }
  | { type: 'move_to_waiting' | 'normalize_reviewed'; reason: string; submittedEvent: string }

interface Candidate {
  pullRequest: PullRequestRecord
  task: ReviewTaskRecord
}

// Rails' `find_each` ignores the scope's `updated_at DESC` order and walks by id,
// so a LIMIT keeps the lowest ids, not the most recently updated.
function candidates(ctx: AppContext, limit: number | null): Candidate[] {
  const query = ctx.db
    .select({ pullRequest: pullRequests, task: reviewTasks })
    .from(pullRequests)
    .innerJoin(reviewTasks, eq(reviewTasks.pullRequestId, pullRequests.id))
    .where(and(withReviewStatus('reviewed_by_me'), eq(reviewTasks.state, 'reviewed'), eq(reviewTasks.submissionStatus, 'submitted')))
    .orderBy(asc(pullRequests.id))
  return limit === null ? query.all() : query.limit(limit).all()
}

function errorClass(error: unknown) {
  return error instanceof Error ? error.constructor.name : typeof error
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

async function planAction(github: BackfillGithubClient, pullRequest: PullRequestRecord): Promise<PlannedAction> {
  try {
    if (await github.reviewRequestedForMe(pullRequest)) return { type: 'reset_to_pending', reason: 'review requested again' }

    const latestState = await github.latestMyReviewState(pullRequest)
    const submittedEvent = latestState === null ? undefined : EVENT_MAP.get(latestState)
    if (submittedEvent === undefined) {
      return { type: 'noop', reason: `no mappable latest review state (${latestState ?? 'none'})` }
    }

    const type = submittedEvent === 'REQUEST_CHANGES' ? 'move_to_waiting' : 'normalize_reviewed'
    return { type, submittedEvent, reason: `latest review state ${latestState}` }
  } catch (error) {
    return { type: 'noop', reason: `github lookup failed: ${errorClass(error)}` }
  }
}

function applyAction(ctx: AppContext, { pullRequest, task }: Candidate, action: PlannedAction) {
  transaction(ctx, (txCtx) => {
    switch (action.type) {
      case 'reset_to_pending': {
        const reset = moveBackward(txCtx, task, 'pending_review') ?? task
        updateReviewTask(txCtx, reset, { submissionStatus: 'pending_submission', submittedAt: null, submittedEvent: null })
        updatePullRequest(txCtx, pullRequest, { reviewStatus: 'pending_review' })
        return
      }
      case 'move_to_waiting':
        updateReviewTask(txCtx, task, { state: 'waiting_implementation', submittedEvent: action.submittedEvent })
        updatePullRequest(txCtx, pullRequest, { reviewStatus: 'waiting_implementation' })
        return
      case 'normalize_reviewed':
        updateReviewTask(txCtx, task, { state: 'reviewed', submittedEvent: action.submittedEvent })
        if (pullRequest.reviewStatus !== 'reviewed_by_me') updatePullRequest(txCtx, pullRequest, { reviewStatus: 'reviewed_by_me' })
        return
      case 'noop':
        return
    }
  })
}

function formatLine(pullRequest: PullRequestRecord, action: PlannedAction, prefix: string) {
  return `#${pullRequest.number ?? ''} ${prefix}: ${action.type} (${action.reason})`
}

// `ReviewLifecycleBackfillService#run`.
export async function runReviewLifecycleBackfill(
  ctx: AppContext,
  github: BackfillGithubClient,
  output: OutputWriter,
  options: BackfillOptions = {},
): Promise<BackfillSummary> {
  const apply = options.apply ?? false
  const rows = candidates(ctx, options.limit ?? null)
  let processed = 0
  let updated = 0
  let skipped = 0
  let failed = 0

  output.puts(`Backfill ${apply ? 'apply' : 'dry-run'} mode. candidates=${rows.length}`)

  for (const candidate of rows) {
    processed += 1
    const action = await planAction(github, candidate.pullRequest)

    if (action.type === 'noop') {
      skipped += 1
      output.puts(formatLine(candidate.pullRequest, action, 'skip'))
      continue
    }

    output.puts(formatLine(candidate.pullRequest, action, apply ? 'apply' : 'plan'))
    if (!apply) continue

    try {
      applyAction(ctx, candidate, action)
      updated += 1
    } catch (error) {
      failed += 1
      output.puts(`ERROR #${candidate.pullRequest.number ?? ''}: ${errorClass(error)} ${errorText(error)}`)
    }
  }

  const summary: BackfillSummary = { processed, updated, skipped, failed, mode: apply ? 'apply' : 'dry-run' }
  output.puts(`Summary: ${JSON.stringify(summary)}`)
  return summary
}
