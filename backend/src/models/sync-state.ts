import { eq } from 'drizzle-orm'
import type { AppContext } from '../context'
import type { Db } from '../db/client'
import { syncStates } from '../db/schema'
import { RecordNotFoundError } from '../lib/errors'
import { isBlank, iso8601, secondsBetween } from '../lib/ruby'
import { slugFromPath } from '../services/repo-slug-resolver'

export type SyncStateRecord = typeof syncStates.$inferSelect
export type SyncStateChanges = Partial<Omit<typeof syncStates.$inferInsert, 'id' | 'createdAt' | 'updatedAt'>>

export const SYNC_STATUSES = ['idle', 'running', 'succeeded', 'partial', 'failed']
export const POLL_INTERVAL_SECONDS = 120

// `SyncState.for_repo_path`: one row per GitHub repo, created on first use.
export async function syncStateForRepoPath(
  { db, commands }: Pick<AppContext, 'db' | 'commands'>,
  repoPath: string | null,
): Promise<SyncStateRecord | null> {
  const slug = await slugFromPath(commands, repoPath)
  if (isBlank(slug)) return null

  const scopeKey = `repo:${slug}`
  const existing = db.select().from(syncStates).where(eq(syncStates.scopeKey, scopeKey)).get()
  if (existing) return existing

  const [owner = '', ...rest] = slug.split('/')
  const now = new Date()
  return db
    .insert(syncStates)
    .values({ scopeKey, repoOwner: owner, repoName: rest.join('/'), createdAt: now, updatedAt: now })
    .onConflictDoNothing({ target: syncStates.scopeKey })
    .returning()
    .get() ?? db.select().from(syncStates).where(eq(syncStates.scopeKey, scopeKey)).get() ?? null
}

export function updateSyncState(db: Db, state: SyncStateRecord, changes: SyncStateChanges) {
  const updated = db
    .update(syncStates)
    .set({ ...changes, updatedAt: new Date() })
    .where(eq(syncStates.id, state.id))
    .returning()
    .get()
  if (!updated) throw new RecordNotFoundError('SyncState', state.id)
  return updated
}

// Failed attempts use the same polling cooldown as successful syncs. Keeping
// this in the persisted state also covers repository setup and page reloads.
function cooldownStartedAt(state: SyncStateRecord) {
  return state.status === 'failed' ? state.lastFinishedAt ?? state.lastSucceededAt : state.lastSucceededAt
}

export function syncNeeded(state: SyncStateRecord, now = new Date()) {
  if (state.status === 'running') return false
  const startedAt = cooldownStartedAt(state)
  if (startedAt === null) return true
  return secondsBetween(now, startedAt) >= POLL_INTERVAL_SECONDS
}

export function secondsUntilSyncAllowed(state: SyncStateRecord, now = new Date()) {
  if (state.status === 'running') return 0
  const startedAt = cooldownStartedAt(state)
  if (startedAt === null) return 0
  return Math.trunc(Math.max(POLL_INTERVAL_SECONDS - secondsBetween(now, startedAt), 0))
}

export function syncStatePayload(state: SyncStateRecord, now = new Date()) {
  return {
    status: state.status,
    running: state.status === 'running',
    last_synced_at: iso8601(state.lastSucceededAt),
    last_started_at: iso8601(state.lastStartedAt),
    last_finished_at: iso8601(state.lastFinishedAt),
    last_succeeded_at: iso8601(state.lastSucceededAt),
    last_error: state.lastError,
    fetched_count: state.fetchedCount,
    created_count: state.createdCount,
    updated_count: state.updatedCount,
    deactivated_count: state.deactivatedCount,
    seconds_until_sync_allowed: secondsUntilSyncAllowed(state, now),
    sync_needed: syncNeeded(state, now),
  }
}

export type SyncStatusPayload = ReturnType<typeof syncStatePayload>

// PullRequestIndexPresenter#default_sync_status (no last_synced_at key, as in Rails).
export function defaultSyncStatus() {
  return {
    status: 'idle',
    running: false,
    last_started_at: null,
    last_finished_at: null,
    last_succeeded_at: null,
    last_error: null,
    fetched_count: 0,
    created_count: 0,
    updated_count: 0,
    deactivated_count: 0,
    seconds_until_sync_allowed: 0,
    sync_needed: false,
  }
}
