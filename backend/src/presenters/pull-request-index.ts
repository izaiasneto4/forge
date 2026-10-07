import { and, count, desc, exists, eq, inArray, isNotNull, ne, notInArray, or } from 'drizzle-orm'
import type { AppContext } from '../context'
import { pullRequests, reviewTasks } from '../db/schema'
import { ACTIVE_RUN_STATES } from '../models/review-task'
import { activeRemote, currentRepoCondition, notArchived, withReviewStatus, type PullRequestRecord, type ReviewStatus } from '../models/pull-request'
import { SettingStore } from '../models/setting'
import { defaultSyncStatus, syncStatePayload, syncStateForRepoPath } from '../models/sync-state'
import { recoverCurrentRepo } from '../services/current-repo-recovery'

// Port of PullRequestIndexPresenter.

// What presenters read: the database, and git for the current repo's GitHub slug.
export type PayloadContext = Pick<AppContext, 'db' | 'commands'>

// `CurrentRepoRecoveryService.call || Setting.current_repo`
export async function indexCurrentRepo(ctx: PayloadContext) {
  return (await recoverCurrentRepo(ctx)) ?? new SettingStore(ctx.db).currentRepo()
}

export type PullRequestColumns = Record<ReviewStatus, PullRequestRecord[]>

export async function pullRequestColumns({ db, commands }: PayloadContext, repoPath: string | null): Promise<PullRequestColumns> {
  const repoCondition = await currentRepoCondition(commands, repoPath)
  const column = (status: ReviewStatus) =>
    db
      .select()
      .from(pullRequests)
      .where(and(withReviewStatus(status), repoCondition))
      .orderBy(desc(pullRequests.updatedAtGithub))
      .all()

  return {
    pending_review: column('pending_review'),
    in_review: column('in_review'),
    reviewed_by_me: column('reviewed_by_me'),
    waiting_implementation: column('waiting_implementation'),
    reviewed_by_others: column('reviewed_by_others'),
    review_failed: column('review_failed'),
  }
}

export const SETTLED_REVIEWS_LIMIT = 50

// Reviewed PRs that were merged or closed. The default scope (notArchived)
// already leaves out PRs the user archived or deleted. Reviews still queued or
// running are always included; the limit only trims finished history.
export async function settledReviews({ db, commands }: PayloadContext, repoPath: string | null) {
  const repoCondition = await currentRepoCondition(commands, repoPath)
  const taskIn = (states: string[], include: boolean) =>
    exists(
      db
        .select({ id: reviewTasks.id })
        .from(reviewTasks)
        .where(and(eq(reviewTasks.pullRequestId, pullRequests.id), include ? inArray(reviewTasks.state, states) : notInArray(reviewTasks.state, states))),
    )
  const inactive = or(ne(pullRequests.remoteState, 'open'), isNotNull(pullRequests.inactiveReason))
  const query = (condition: ReturnType<typeof taskIn>) =>
    db.select().from(pullRequests).where(and(notArchived, inactive, condition, repoCondition)).orderBy(desc(pullRequests.updatedAtGithub))

  const activeRuns = query(taskIn([...ACTIVE_RUN_STATES], true)).all()
  const history = query(taskIn([...ACTIVE_RUN_STATES], false)).limit(SETTLED_REVIEWS_LIMIT).all()
  return [...activeRuns, ...history]
}

export async function pullRequestTotalCount({ db, commands }: PayloadContext, repoPath: string | null) {
  const repoCondition = await currentRepoCondition(commands, repoPath)
  const row = db
    .select({ total: count() })
    .from(pullRequests)
    .where(and(activeRemote, repoCondition))
    .get()
  return row?.total ?? 0
}

export type SyncStatus = ReturnType<typeof syncStatePayload> | ReturnType<typeof defaultSyncStatus>

// PullRequestIndexPresenter#sync_status
export async function syncStatusPayload(ctx: PayloadContext): Promise<SyncStatus> {
  const state = await syncStateForRepoPath(ctx, await indexCurrentRepo(ctx))
  return state ? syncStatePayload(state) : defaultSyncStatus()
}

export function buildSyncSkippedMessage(secondsUntilSyncAllowed: number) {
  const minutes = Math.ceil(secondsUntilSyncAllowed / 60)
  const timeMessage = minutes > 1 ? `${minutes} minutes` : `${secondsUntilSyncAllowed} seconds`
  return `Using cached data (next sync available in ${timeMessage})`
}

// PullRequestIndexPresenter#build_sync_skipped_message
export async function syncSkippedMessage(ctx: PayloadContext) {
  const status = await syncStatusPayload(ctx)
  return buildSyncSkippedMessage(status.seconds_until_sync_allowed)
}
