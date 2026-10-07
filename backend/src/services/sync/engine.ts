import { and, asc, eq, isNull, ne } from 'drizzle-orm'
import type { AppContext } from '../../context'
import type { Db } from '../../db/client'
import { pullRequests, syncStates } from '../../db/schema'
import { isBlank, isPresent } from '../../lib/ruby'
import {
  createPullRequest,
  findPullRequestUnscoped,
  refreshReviewStatus,
  updatePullRequest,
  type PullRequestChanges,
  type PullRequestRecord,
} from '../../models/pull-request'
import { activateSnapshot } from '../../models/pull-request-snapshot'
import { changed, hasChanges, transaction } from '../../models/record'
import { SettingStore } from '../../models/setting'
import { syncStateForRepoPath, syncStatePayload, updateSyncState, type SyncStateRecord, type SyncStatusPayload } from '../../models/sync-state'
import type { Broadcaster } from '../../realtime/broadcaster'
import { pullRequestUpdated, syncCompleted, syncFailed, syncStarted } from '../../realtime/ui-events'
import { createGithubAdapter, SyncAdapterError, type RemotePullRequest, type SyncAdapter } from './github-adapter'
import { findPullRequestByGithubId, githubIdNumber, writeExactGithubId } from './github-id'
import { toPullRequestChanges } from './pull-request-attributes'

export interface SyncCounts {
  fetched: number
  created: number
  updated: number
  deactivated: number
}

// Sync::Engine#call's hash: the perform_sync counts (plus `partial`/`errors`
// when a sync actually ran), whether another sync held the scope, and the
// SyncState payload.
export interface SyncResult extends SyncCounts {
  partial?: boolean
  errors?: string[]
  already_running: boolean
  sync: SyncStatusPayload
}

export interface RunSyncOptions {
  repoPath: string | null
  trigger?: string
  pullRequestNumber?: number | null
  adapter?: SyncAdapter
}

interface PerformResult extends SyncCounts {
  partial: boolean
  errors: string[]
}

type UpsertAction = 'created' | 'updated' | 'noop'

type MissingLookup =
  | { pullRequestId: number; number: number | null; remote: RemotePullRequest | null }
  | { pullRequestId: number; number: number | null; error: string }

const silentEvents: Broadcaster = { broadcast() {} }

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function noRepoResult(): SyncResult {
  return {
    fetched: 0,
    created: 0,
    updated: 0,
    deactivated: 0,
    already_running: false,
    sync: {
      status: 'idle',
      running: false,
      last_synced_at: null,
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
    },
  }
}

function buildResult(syncState: SyncStateRecord, counts: SyncCounts | null, alreadyRunning: boolean): SyncResult {
  const base = counts ?? {
    fetched: syncState.fetchedCount,
    created: syncState.createdCount,
    updated: syncState.updatedCount,
    deactivated: syncState.deactivatedCount,
  }
  return { ...base, already_running: alreadyRunning, sync: syncStatePayload(syncState) }
}

// `sync_state.with_lock { running? ... update!(status: "running") }`: a single
// conditional UPDATE, so two syncs can never both claim the same scope.
function claimSyncState(db: Db, syncState: SyncStateRecord) {
  const now = new Date()
  const claimed = db
    .update(syncStates)
    .set({ status: 'running', lastStartedAt: now, lastFinishedAt: null, lastError: null, updatedAt: now })
    .where(and(eq(syncStates.id, syncState.id), ne(syncStates.status, 'running')))
    .returning()
    .get()
  if (claimed) return { state: claimed, alreadyRunning: false }

  const current = db.select().from(syncStates).where(eq(syncStates.id, syncState.id)).get()
  return { state: current ?? syncState, alreadyRunning: true }
}

function reconcileSnapshot(ctx: AppContext, pullRequest: PullRequestRecord, previousHeadSha: string | null, previousBaseSha: string | null) {
  const headSha = pullRequest.headSha
  const baseSha = pullRequest.baseSha
  if (isBlank(headSha) || isBlank(baseSha)) return

  let staleReason = 'revision_changed'
  if (isPresent(previousHeadSha) && previousHeadSha !== headSha) staleReason = 'head_sha_changed'
  else if (isPresent(previousBaseSha) && previousBaseSha !== baseSha) staleReason = 'base_sha_changed'

  activateSnapshot(ctx, { pullRequestId: pullRequest.id, headSha, baseSha, staleReason })
}

// `upsert_pull_request!`. Rails broadcasts the review status change from
// after_commit, after refresh_review_status! has already rewritten the column,
// so the model call stays silent and the event goes out with the final status.
function upsertPullRequest(ctx: AppContext, attributes: RemotePullRequest): UpsertAction {
  const existing = findPullRequestByGithubId(ctx.db, attributes.github_id)
  const previousStatus = existing?.reviewStatus ?? null

  const assigned: PullRequestChanges = {
    ...toPullRequestChanges(attributes),
    deletedAt: null,
    inactiveReason: attributes.remote_state === 'open' ? null : attributes.inactive_reason,
  }
  if (previousStatus === null) assigned.reviewStatus = 'pending_review'

  const silentCtx = { ...ctx, events: silentEvents }
  let record: PullRequestRecord
  let modified: boolean
  let reviewStatusSaved: boolean
  if (existing) {
    modified = hasChanges(existing, assigned)
    reviewStatusSaved = modified && changed(existing, assigned, 'reviewStatus')
    record = modified ? updatePullRequest(silentCtx, existing, assigned) : existing
  } else {
    record = createPullRequest(silentCtx, { ...assigned, githubId: githubIdNumber(attributes.github_id) })
    writeExactGithubId(ctx.db, record.id, attributes.github_id)
    modified = true
    reviewStatusSaved = true
  }

  reconcileSnapshot(ctx, record, existing?.headSha ?? null, existing?.baseSha ?? null)
  const finalStatus = refreshReviewStatus(ctx.db, record)
  if (reviewStatusSaved) pullRequestUpdated(ctx.events, { ...record, reviewStatus: finalStatus }, previousStatus)

  if (!existing) return 'created'
  if (modified || finalStatus !== previousStatus) return 'updated'
  return 'noop'
}

function splitSlug(repoSlug: string | null) {
  if (repoSlug === null) throw new TypeError("undefined method 'split' for nil")
  const [owner = '', ...rest] = repoSlug.split('/')
  return { owner, name: rest.length > 0 ? rest.join('/') : null }
}

// `active_scope`: open, active, not deleted (archived included) PRs of the adapter's repo.
function activeScope(db: Db, adapter: SyncAdapter) {
  const { owner, name } = splitSlug(adapter.repoSlug)
  return db
    .select()
    .from(pullRequests)
    .where(
      and(
        eq(pullRequests.repoOwner, owner),
        name === null ? isNull(pullRequests.repoName) : eq(pullRequests.repoName, name),
        eq(pullRequests.remoteState, 'open'),
        isNull(pullRequests.inactiveReason),
        isNull(pullRequests.deletedAt),
      ),
    )
    .orderBy(asc(pullRequests.id))
    .all()
}

// The GitHub half of `reconcile_missing_pull_requests!`. Rails fetched these
// inside its transaction; SQLite transactions here are synchronous, so the
// lookups run first and their results are applied in the transaction below.
async function lookUpMissingPullRequests(db: Db, adapter: SyncAdapter, fetchedNumbers: Array<number | null>) {
  const lookups: MissingLookup[] = []
  for (const pullRequest of activeScope(db, adapter)) {
    if (fetchedNumbers.includes(pullRequest.number)) continue
    try {
      const remote = await adapter.fetchPullRequest(pullRequest.number ?? 0)
      lookups.push({ pullRequestId: pullRequest.id, number: pullRequest.number, remote })
    } catch (error) {
      if (!(error instanceof SyncAdapterError)) throw error
      lookups.push({ pullRequestId: pullRequest.id, number: pullRequest.number, error: error.message })
    }
  }
  return lookups
}

function applyMissingLookups(ctx: AppContext, lookups: MissingLookup[]) {
  const errors: string[] = []
  let count = 0

  for (const lookup of lookups) {
    if ('error' in lookup) {
      errors.push(`PR #${lookup.number ?? ''}: ${lookup.error}`)
      continue
    }
    if (lookup.remote) {
      if (upsertPullRequest(ctx, lookup.remote) === 'updated') count += 1
      continue
    }

    const pullRequest = findPullRequestUnscoped(ctx.db, lookup.pullRequestId)
    if (!pullRequest) continue
    updatePullRequest(ctx, pullRequest, {
      remoteState: 'inaccessible',
      inactiveReason: 'inaccessible',
      closedAtGithub: pullRequest.closedAtGithub ?? new Date(),
    })
    count += 1
  }

  return { count, partial: errors.length > 0, errors }
}

async function fetchRemote(adapter: SyncAdapter, pullRequestNumber: number | null) {
  if (pullRequestNumber === null) return adapter.fetchOpenPullRequests()
  // Rails wrapped the single PR in Array(pr), which splats a Hash into
  // [key, value] pairs and crashes the focused sync; this keeps the intent.
  const pullRequest = await adapter.fetchPullRequest(pullRequestNumber)
  return { prs: pullRequest ? [pullRequest] : [], complete: false }
}

async function performSync(ctx: AppContext, adapterFor: () => Promise<SyncAdapter>, pullRequestNumber: number | null): Promise<PerformResult> {
  const adapter = await adapterFor()
  const fetched = await fetchRemote(adapter, pullRequestNumber)
  const fetchedNumbers = fetched.prs.map((pr) => pr.number)
  const reconcile = fetched.complete && pullRequestNumber === null
  const lookups = reconcile ? await lookUpMissingPullRequests(ctx.db, adapter, fetchedNumbers) : []

  return transaction(ctx, (txCtx) => {
    const result: PerformResult = { fetched: 0, created: 0, updated: 0, deactivated: 0, partial: false, errors: [] }

    for (const attributes of fetched.prs) {
      result.fetched += 1
      const action = upsertPullRequest(txCtx, attributes)
      if (action === 'created') result.created += 1
      if (action === 'updated') result.updated += 1
    }

    if (reconcile) {
      const deactivation = applyMissingLookups(txCtx, lookups)
      result.deactivated += deactivation.count
      result.partial ||= deactivation.partial
      result.errors.push(...deactivation.errors)
    }

    return result
  })
}

async function handleFailure(ctx: AppContext, repoPath: string | null, syncState: SyncStateRecord | null, error: unknown): Promise<never> {
  if (syncState) {
    const failed = updateSyncState(ctx.db, syncState, { status: 'failed', lastFinishedAt: new Date(), lastError: errorMessage(error) })
    await syncFailed(ctx.events, repoPath, errorMessage(error), syncStatePayload(failed))
  }
  throw error
}

// `Sync::GithubAdapter.new(repo_path:, github_login: Setting.github_login)`,
// built on first use and remembering the login it resolved.
function lazyAdapter(ctx: AppContext, repoPath: string | null, provided: SyncAdapter | undefined) {
  let adapter = provided
  return async () => {
    if (adapter) return adapter
    const settings = new SettingStore(ctx.db)
    const created = await createGithubAdapter(ctx, { repoPath, githubLogin: settings.githubLogin() })
    if (isPresent(created.githubLogin)) settings.setGithubLogin(created.githubLogin)
    adapter = created
    return created
  }
}

// Port of Sync::Engine#call: syncs the repo's open PRs into the database and
// tracks progress in its SyncState, broadcasting sync.started/completed/failed.
export async function runSync(ctx: AppContext, options: RunSyncOptions): Promise<SyncResult> {
  const repoPath = options.repoPath ?? new SettingStore(ctx.db).currentRepo()
  const trigger = options.trigger ?? 'manual'
  const pullRequestNumber = options.pullRequestNumber ?? null
  let syncState: SyncStateRecord | null = null

  try {
    syncState = await syncStateForRepoPath(ctx.db, repoPath)
    if (!syncState) return noRepoResult()

    const claim = claimSyncState(ctx.db, syncState)
    syncState = claim.state
    if (claim.alreadyRunning) return buildResult(syncState, null, true)

    await syncStarted(ctx.events, repoPath, { ...syncStatePayload(syncState), trigger })

    const result = await performSync(ctx, lazyAdapter(ctx, repoPath, options.adapter), pullRequestNumber)
    const finishedAt = new Date()
    syncState = updateSyncState(ctx.db, syncState, {
      status: result.partial ? 'partial' : 'succeeded',
      lastFinishedAt: finishedAt,
      lastSucceededAt: finishedAt,
      lastError: result.errors.length > 0 ? result.errors.join('\n') : null,
      fetchedCount: result.fetched,
      createdCount: result.created,
      updatedCount: result.updated,
      deactivatedCount: result.deactivated,
    })

    new SettingStore(ctx.db).touchLastSynced()
    await syncCompleted(ctx.events, repoPath, syncStatePayload(syncState))

    return buildResult(syncState, result, false)
  } catch (error) {
    return handleFailure(ctx, repoPath, syncState, error)
  }
}
