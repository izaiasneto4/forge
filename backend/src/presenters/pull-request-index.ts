import { and, count, desc } from 'drizzle-orm'
import type { AppContext } from '../context'
import { pullRequests } from '../db/schema'
import { activeRemote, currentRepoCondition, withReviewStatus, type PullRequestRecord, type ReviewStatus } from '../models/pull-request'
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
