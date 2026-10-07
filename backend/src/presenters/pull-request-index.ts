import { and, count, desc } from 'drizzle-orm'
import type { Db } from '../db/client'
import { pullRequests } from '../db/schema'
import { activeRemote, currentRepoCondition, withReviewStatus, type PullRequestRecord, type ReviewStatus } from '../models/pull-request'
import { SettingStore } from '../models/setting'
import { defaultSyncStatus, syncStatePayload, syncStateForRepoPath } from '../models/sync-state'
import { recoverCurrentRepo } from '../services/current-repo-recovery'

// Port of PullRequestIndexPresenter.

export interface PayloadContext {
  db: Db
}

// Routes pass the AppContext; older callers (the settings presenter) pass the Db.
export type PayloadSource = PayloadContext | Db

export function dbOf(source: PayloadSource): Db {
  return 'db' in source ? source.db : source
}

// `CurrentRepoRecoveryService.call || Setting.current_repo`
export async function indexCurrentRepo(db: Db) {
  return (await recoverCurrentRepo(db)) ?? new SettingStore(db).currentRepo()
}

export type PullRequestColumns = Record<ReviewStatus, PullRequestRecord[]>

export async function pullRequestColumns(db: Db, repoPath: string | null): Promise<PullRequestColumns> {
  const repoCondition = await currentRepoCondition(repoPath)
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

export async function pullRequestTotalCount(db: Db, repoPath: string | null) {
  const repoCondition = await currentRepoCondition(repoPath)
  const row = db
    .select({ total: count() })
    .from(pullRequests)
    .where(and(activeRemote, repoCondition))
    .get()
  return row?.total ?? 0
}

export type SyncStatus = ReturnType<typeof syncStatePayload> | ReturnType<typeof defaultSyncStatus>

// PullRequestIndexPresenter#sync_status
export async function syncStatusPayload(source: PayloadSource): Promise<SyncStatus> {
  const db = dbOf(source)
  const state = await syncStateForRepoPath(db, await indexCurrentRepo(db))
  return state ? syncStatePayload(state) : defaultSyncStatus()
}

export function buildSyncSkippedMessage(secondsUntilSyncAllowed: number) {
  const minutes = Math.ceil(secondsUntilSyncAllowed / 60)
  const timeMessage = minutes > 1 ? `${minutes} minutes` : `${secondsUntilSyncAllowed} seconds`
  return `Using cached data (next sync available in ${timeMessage})`
}

// PullRequestIndexPresenter#build_sync_skipped_message
export async function syncSkippedMessage(source: PayloadSource) {
  const status = await syncStatusPayload(source)
  return buildSyncSkippedMessage(status.seconds_until_sync_allowed)
}
