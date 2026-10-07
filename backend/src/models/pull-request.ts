import { and, desc, eq, inArray, isNotNull, isNull, ne, sql, type SQL } from 'drizzle-orm'
import type { CommandRunner } from '../commands/runner'
import type { AppContext } from '../context'
import type { Db } from '../db/client'
import { pullRequestSnapshots, pullRequests, reviewComments, reviewIterations, reviewTasks } from '../db/schema'
import { RecordNotFoundError } from '../lib/errors'
import { literals } from '../lib/literals'
import { isBlank, isPresent, truncate } from '../lib/ruby'
import { pullRequestUpdated, repoFullName } from '../realtime/ui-events'
import { slugFromPath } from '../services/repo-slug-resolver'
import { isSyncModeActive } from '../services/sync-mode'
import { activateSnapshot, aiSummaryPayload, currentSnapshotFor, type AiSummary } from './pull-request-snapshot'
import { changed, hasChanges, Validator } from './record'
import type { ReviewTaskRecord } from './review-task'

export type PullRequestRecord = typeof pullRequests.$inferSelect
export type PullRequestValues = Omit<typeof pullRequests.$inferInsert, 'id' | 'createdAt' | 'updatedAt'>
export type PullRequestChanges = Partial<PullRequestValues>

export const REVIEW_STATUSES = literals(
  'pending_review',
  'in_review',
  'reviewed_by_me',
  'waiting_implementation',
  'reviewed_by_others',
  'review_failed',
)
export const REVIEW_STATUSES_REQUIRING_TASK = ['in_review', 'reviewed_by_me', 'waiting_implementation', 'review_failed']
export const REMOTE_STATES = ['open', 'closed', 'merged', 'inaccessible']
export const INACTIVE_REASONS = ['merged', 'closed', 'out_of_scope', 'inaccessible', 'unknown']

export type ReviewStatus = (typeof REVIEW_STATUSES)[number]

export function isReviewStatus(value: string): value is ReviewStatus {
  return REVIEW_STATUSES.some((status) => status === value)
}

// Scopes. `notArchived` is also the model's default_scope.
export const notDeleted = isNull(pullRequests.deletedAt)
export const notArchived = and(notDeleted, eq(pullRequests.archived, false))
export const archivedScope = and(notDeleted, eq(pullRequests.archived, true))
export const activeRemote = and(notArchived, eq(pullRequests.remoteState, 'open'), isNull(pullRequests.inactiveReason))
export const withReviewStatus = (status: string) => and(activeRemote, eq(pullRequests.reviewStatus, status))

// `PullRequest.for_current_repo(repo_path)`: no repo means every PR; a repo
// without a GitHub remote matches none.
export async function currentRepoCondition(commands: CommandRunner, repoPath: string | null): Promise<SQL | undefined> {
  if (isBlank(repoPath)) return undefined
  const slug = await slugFromPath(commands, repoPath)
  if (isBlank(slug)) return sql`0`
  const [owner = '', ...rest] = slug.split('/')
  return and(eq(pullRequests.repoOwner, owner), eq(pullRequests.repoName, rest.join('/')))
}

export function findPullRequest(db: Db, id: number): PullRequestRecord {
  const record = db.select().from(pullRequests).where(and(eq(pullRequests.id, id), notArchived)).get()
  if (!record) throw new RecordNotFoundError('PullRequest', id)
  return record
}

export function findPullRequestUnscoped(db: Db, id: number) {
  return db.select().from(pullRequests).where(eq(pullRequests.id, id)).get()
}

export function findPullRequestBy(db: Db, condition: SQL | undefined) {
  return db.select().from(pullRequests).where(and(notArchived, condition)).get()
}

export function isActiveRemote(pullRequest: PullRequestRecord) {
  return pullRequest.remoteState === 'open' && isBlank(pullRequest.inactiveReason) && pullRequest.deletedAt === null
}

export function shortDescription(pullRequest: PullRequestRecord) {
  return truncate(pullRequest.description ?? '', 150)
}

export function reviewTaskFor(db: Db, pullRequestId: number): ReviewTaskRecord | undefined {
  return db.select().from(reviewTasks).where(eq(reviewTasks.pullRequestId, pullRequestId)).get()
}

function validate(db: Db, merged: PullRequestValues & { id?: number }) {
  const validator = new Validator()
  validator.presence('Github', merged.githubId)
  validator.presence('Number', merged.number)
  validator.presence('Title', merged.title)
  validator.presence('Url', merged.url)
  validator.presence('Repo owner', merged.repoOwner)
  validator.presence('Repo name', merged.repoName)
  validator.inclusion('Review status', merged.reviewStatus, REVIEW_STATUSES)
  validator.inclusion('Remote state', merged.remoteState ?? 'open', REMOTE_STATES)
  validator.inclusion('Inactive reason', merged.inactiveReason, INACTIVE_REASONS, { allowNil: true })

  // Uniqueness checks exclude the record itself, like Rails' UniquenessValidator.
  const notSelf = merged.id === undefined ? undefined : ne(pullRequests.id, merged.id)
  const otherWithGithubId =
    merged.githubId !== null && merged.githubId !== undefined
      ? db.select({ id: pullRequests.id }).from(pullRequests).where(and(eq(pullRequests.githubId, merged.githubId), notSelf)).get()
      : undefined
  if (otherWithGithubId) validator.add('Github has already been taken')

  if (merged.number !== null && merged.number !== undefined) {
    const sameNumber = db
      .select({ id: pullRequests.id })
      .from(pullRequests)
      .where(
        and(
          eq(pullRequests.number, merged.number),
          merged.repoOwner === null || merged.repoOwner === undefined ? isNull(pullRequests.repoOwner) : eq(pullRequests.repoOwner, merged.repoOwner),
          merged.repoName === null || merged.repoName === undefined ? isNull(pullRequests.repoName) : eq(pullRequests.repoName, merged.repoName),
          notSelf,
        ),
      )
      .get()
    if (sameNumber) validator.add('Number has already been taken')
  }

  // review_status_consistency (skipped while a sync is applying remote state).
  const status = merged.reviewStatus ?? ''
  if (!isSyncModeActive() && REVIEW_STATUSES_REQUIRING_TASK.includes(status)) {
    const hasTask = merged.id !== undefined && reviewTaskFor(db, merged.id) !== undefined
    if (!hasTask) validator.add(`Review status cannot be '${status}' without a review task`)
  }

  validator.assertValid()
}

// `PullRequest.create!`: validates and broadcasts the initial review status.
export function createPullRequest(ctx: AppContext, values: PullRequestValues): PullRequestRecord {
  validate(ctx.db, values)
  const now = new Date()
  const record = ctx.db.insert(pullRequests).values({ ...values, createdAt: now, updatedAt: now }).returning().get()
  pullRequestUpdated(ctx.events, record, null)
  return record
}

// `pull_request.update!(...)`: validates, touches updated_at, and broadcasts
// when review_status changes (the after_commit callback).
export function updatePullRequest(ctx: AppContext, pullRequest: PullRequestRecord, changes: PullRequestChanges): PullRequestRecord {
  if (!hasChanges(pullRequest, changes)) return pullRequest
  validate(ctx.db, { ...pullRequest, ...changes })

  const updated = ctx.db
    .update(pullRequests)
    .set({ ...changes, updatedAt: new Date() })
    .where(eq(pullRequests.id, pullRequest.id))
    .returning()
    .get()
  if (!updated) throw new RecordNotFoundError('PullRequest', pullRequest.id)

  if (changed(pullRequest, changes, 'reviewStatus')) pullRequestUpdated(ctx.events, updated, pullRequest.reviewStatus)
  return updated
}

// `update_column(s)`: raw write, no validation, no updated_at, no callbacks.
export function updatePullRequestColumns(db: Db, id: number, changes: PullRequestChanges) {
  db.update(pullRequests).set(changes).where(eq(pullRequests.id, id)).run()
}

export function archivePullRequest(ctx: AppContext, pullRequest: PullRequestRecord) {
  return updatePullRequest(ctx, pullRequest, { archived: true })
}

export function unarchivePullRequest(ctx: AppContext, pullRequest: PullRequestRecord) {
  return updatePullRequest(ctx, pullRequest, { archived: false })
}

export function softDeletePullRequest(ctx: AppContext, pullRequest: PullRequestRecord) {
  return updatePullRequest(ctx, pullRequest, { deletedAt: new Date() })
}

export function restorePullRequest(ctx: AppContext, pullRequest: PullRequestRecord) {
  return updatePullRequest(ctx, pullRequest, {
    deletedAt: null,
    remoteState: 'open',
    inactiveReason: null,
    reviewStatus: 'pending_review',
  })
}

export function aiSummaryForDisplay(db: Db, pullRequest: PullRequestRecord): AiSummary {
  const snapshot = currentSnapshotFor(db, pullRequest.id)
  const fallback = db
    .select()
    .from(pullRequestSnapshots)
    .where(
      and(
        eq(pullRequestSnapshots.pullRequestId, pullRequest.id),
        eq(pullRequestSnapshots.status, 'stale'),
        eq(pullRequestSnapshots.aiSummaryStatus, 'current'),
      ),
    )
    .orderBy(desc(pullRequestSnapshots.updatedAt))
    .get()

  if (snapshot && snapshot.aiSummaryStatus === 'current') return aiSummaryPayload(snapshot, false)
  if (fallback) return aiSummaryPayload(fallback, true)
  if (snapshot) return aiSummaryPayload(snapshot, false)
  return {
    status: 'none',
    generatedAt: null,
    failureReason: null,
    snapshotId: null,
    stale: false,
    filesChanged: pullRequest.changedFiles,
    linesAdded: pullRequest.additions,
    linesRemoved: pullRequest.deletions,
    mainChanges: [],
    riskAreas: [],
  }
}

export function currentSnapshotOrCreate(ctx: AppContext, pullRequest: PullRequestRecord) {
  if (isBlank(pullRequest.headSha) || isBlank(pullRequest.baseSha)) return undefined
  return activateSnapshot(ctx, {
    pullRequestId: pullRequest.id,
    headSha: pullRequest.headSha,
    baseSha: pullRequest.baseSha,
    staleReason: 'revision_changed',
  })
}

function hasReviewArtifacts(db: Db, task: ReviewTaskRecord) {
  if (isPresent(task.reviewOutput)) return true
  const comment = db.select({ id: reviewComments.id }).from(reviewComments).where(eq(reviewComments.reviewTaskId, task.id)).get()
  if (comment) return true
  const iteration = db.select({ id: reviewIterations.id }).from(reviewIterations).where(eq(reviewIterations.reviewTaskId, task.id)).get()
  return iteration !== undefined
}

export function analysisStatus(db: Db, pullRequest: PullRequestRecord) {
  const task = reviewTaskFor(db, pullRequest.id)
  if (!task) return 'none'
  if (task.state === 'queued' || task.state === 'pending_review' || task.state === 'in_review') return 'pending'

  const snapshot = currentSnapshotFor(db, pullRequest.id)
  if (!snapshot || task.pullRequestSnapshotId === null) return 'pending'

  const hasArtifacts = hasReviewArtifacts(db, task)
  if (hasArtifacts && task.pullRequestSnapshotId !== snapshot.id) return 'stale'
  return hasArtifacts ? 'current' : 'pending'
}

export function snapshotStatus(db: Db, pullRequest: PullRequestRecord) {
  if (!currentSnapshotFor(db, pullRequest.id)) return 'missing'
  if (analysisStatus(db, pullRequest) === 'stale') return 'stale'
  return 'current'
}

// ReviewTask#analysis_stale?
export function reviewTaskAnalysisStale(db: Db, task: ReviewTaskRecord) {
  if (task.pullRequestSnapshotId === null) return false
  const snapshot = currentSnapshotFor(db, task.pullRequestId)
  if (!snapshot) return false
  return task.pullRequestSnapshotId !== snapshot.id
}

// Port of PullRequestStatusClassifier.
export function classifyReviewStatus(db: Db, pullRequest: PullRequestRecord): string | null {
  if (!isActiveRemote(pullRequest)) return pullRequest.reviewStatus

  const task = reviewTaskFor(db, pullRequest.id)
  if (task) {
    if (task.state === 'failed_review') return 'review_failed'
    if (task.state === 'in_review') return 'in_review'
    if (task.state === 'waiting_implementation') return 'waiting_implementation'
    if (task.state === 'queued' || task.state === 'pending_review') return 'pending_review'
    if (reviewTaskAnalysisStale(db, task)) return 'pending_review'
    if (task.state === 'done' && task.submittedEvent === 'APPROVE') return 'reviewed_by_others'
    return 'reviewed_by_me'
  }
  if (pullRequest.reviewRequestedForMe) return 'pending_review'
  if (isPresent(pullRequest.latestReviewState)) return 'reviewed_by_me'
  return 'reviewed_by_others'
}

// `refresh_review_status!`: update_column, so no broadcast.
export function refreshReviewStatus(db: Db, pullRequest: PullRequestRecord) {
  const nextStatus = classifyReviewStatus(db, pullRequest)
  if (nextStatus === pullRequest.reviewStatus) return pullRequest.reviewStatus
  updatePullRequestColumns(db, pullRequest.id, { reviewStatus: nextStatus })
  return nextStatus
}

export function fixOrphanedReviewStates(db: Db) {
  const orphaned = db
    .select({ id: pullRequests.id })
    .from(pullRequests)
    .leftJoin(reviewTasks, eq(reviewTasks.pullRequestId, pullRequests.id))
    .where(
      and(
        notArchived,
        inArray(pullRequests.reviewStatus, ['reviewed_by_me', 'waiting_implementation', 'in_review', 'review_failed']),
        isNull(reviewTasks.id),
      ),
    )
    .all()
  for (const { id } of orphaned) updatePullRequestColumns(db, id, { reviewStatus: 'pending_review' })
  return orphaned.length
}

function pullRequestsWithTasks(db: Db, status: string) {
  return db
    .select({ pullRequest: pullRequests, task: reviewTasks })
    .from(pullRequests)
    .innerJoin(reviewTasks, eq(reviewTasks.pullRequestId, pullRequests.id))
    .where(and(withReviewStatus(status), isNotNull(reviewTasks.id)))
    .orderBy(pullRequests.id)
    .all()
}

// Recurring repair of PR review_status drifting from its ReviewTask state.
export function fixStateMismatches(db: Db) {
  let fixedCount = 0

  for (const { pullRequest, task } of pullRequestsWithTasks(db, 'in_review')) {
    if (task.state === 'in_review') continue
    const target =
      task.state === 'pending_review' || task.state === 'queued'
        ? 'pending_review'
        : task.state === 'waiting_implementation'
          ? 'waiting_implementation'
          : 'reviewed_by_me'
    updatePullRequestColumns(db, pullRequest.id, { reviewStatus: target })
    fixedCount += 1
  }

  for (const { pullRequest, task } of pullRequestsWithTasks(db, 'reviewed_by_me')) {
    if (task.state !== 'in_review' && task.state !== 'pending_review') continue
    updatePullRequestColumns(db, pullRequest.id, { reviewStatus: task.state === 'in_review' ? 'in_review' : 'pending_review' })
    fixedCount += 1
  }

  for (const { pullRequest, task } of pullRequestsWithTasks(db, 'waiting_implementation')) {
    if (task.state === 'waiting_implementation') continue
    const target =
      task.state === 'in_review'
        ? 'in_review'
        : task.state === 'pending_review' || task.state === 'queued'
          ? 'pending_review'
          : 'reviewed_by_me'
    updatePullRequestColumns(db, pullRequest.id, { reviewStatus: target })
    fixedCount += 1
  }

  return fixedCount
}

export { repoFullName }
