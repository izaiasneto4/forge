import { and, eq, ne } from 'drizzle-orm'
import type { AppContext } from '../context'
import type { Db } from '../db/client'
import { pullRequestSnapshots } from '../db/schema'
import { RecordNotFoundError } from '../lib/errors'
import { transaction, Validator } from './record'

export type PullRequestSnapshotRecord = typeof pullRequestSnapshots.$inferSelect

export const SNAPSHOT_STATUSES = ['current', 'stale']
export const AI_SUMMARY_STATUSES = ['none', 'pending', 'current', 'failed']

export interface AiSummary {
  status: string
  generatedAt: Date | null
  failureReason: string | null
  snapshotId: number | null
  stale: boolean
  filesChanged: number | null
  linesAdded: number | null
  linesRemoved: number | null
  mainChanges: string[]
  riskAreas: string[]
}

export interface StoredAiSummary {
  filesChanged: number | null
  linesAdded: number | null
  linesRemoved: number | null
  mainChanges: string[]
  riskAreas: string[]
}

// `serialize ..., coder: JSON, type: Array`: nil reads back as [].
export function parseStringArray(value: string | null): string[] {
  if (value === null || value === '') return []
  const parsed: unknown = JSON.parse(value)
  if (!Array.isArray(parsed)) return []
  return parsed.map((item) => String(item))
}

export function findSnapshot(db: Db, id: number) {
  const record = db.select().from(pullRequestSnapshots).where(eq(pullRequestSnapshots.id, id)).get()
  if (!record) throw new RecordNotFoundError('PullRequestSnapshot', id)
  return record
}

export function currentSnapshotFor(db: Db, pullRequestId: number) {
  return db
    .select()
    .from(pullRequestSnapshots)
    .where(and(eq(pullRequestSnapshots.pullRequestId, pullRequestId), eq(pullRequestSnapshots.status, 'current')))
    .get()
}

export function aiSummaryPayload(snapshot: PullRequestSnapshotRecord, stale: boolean): AiSummary {
  return {
    status: snapshot.aiSummaryStatus,
    generatedAt: snapshot.aiSummaryGeneratedAt,
    failureReason: snapshot.aiSummaryFailureReason,
    snapshotId: snapshot.id,
    stale,
    filesChanged: snapshot.aiSummaryFilesChanged,
    linesAdded: snapshot.aiSummaryLinesAdded,
    linesRemoved: snapshot.aiSummaryLinesRemoved,
    mainChanges: parseStringArray(snapshot.aiSummaryMainChanges),
    riskAreas: parseStringArray(snapshot.aiSummaryRiskAreas),
  }
}

function validate(values: { headSha: string; baseSha: string; status: string; aiSummaryStatus: string }) {
  const validator = new Validator()
  validator.presence('Head sha', values.headSha)
  validator.presence('Base sha', values.baseSha)
  validator.inclusion('Status', values.status, SNAPSHOT_STATUSES)
  validator.inclusion('Ai summary status', values.aiSummaryStatus, AI_SUMMARY_STATUSES)
  validator.assertValid()
}

// `PullRequestSnapshot.activate_for!`: makes (head, base) the PR's only current
// snapshot, staling the others, then queues an AI summary for it.
export function activateSnapshot(
  ctx: AppContext,
  options: { pullRequestId: number; headSha: string; baseSha: string; staleReason: string },
): PullRequestSnapshotRecord {
  const snapshot = transaction(ctx, ({ db }) => {
    const now = new Date()
    const existing = db
      .select()
      .from(pullRequestSnapshots)
      .where(
        and(
          eq(pullRequestSnapshots.pullRequestId, options.pullRequestId),
          eq(pullRequestSnapshots.headSha, options.headSha),
          eq(pullRequestSnapshots.baseSha, options.baseSha),
        ),
      )
      .get()

    db.update(pullRequestSnapshots)
      .set({ status: 'stale', staleReason: options.staleReason, updatedAt: now })
      .where(
        and(
          eq(pullRequestSnapshots.pullRequestId, options.pullRequestId),
          eq(pullRequestSnapshots.status, 'current'),
          existing ? ne(pullRequestSnapshots.id, existing.id) : undefined,
        ),
      )
      .run()

    if (existing) {
      validate({ ...existing, status: 'current' })
      const updated = db
        .update(pullRequestSnapshots)
        .set({ status: 'current', staleReason: null, syncedAt: now, updatedAt: now })
        .where(eq(pullRequestSnapshots.id, existing.id))
        .returning()
        .get()
      if (!updated) throw new RecordNotFoundError('PullRequestSnapshot', existing.id)
      return updated
    }

    validate({ headSha: options.headSha, baseSha: options.baseSha, status: 'current', aiSummaryStatus: 'none' })
    return db
      .insert(pullRequestSnapshots)
      .values({
        pullRequestId: options.pullRequestId,
        headSha: options.headSha,
        baseSha: options.baseSha,
        status: 'current',
        staleReason: null,
        syncedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get()
  })

  enqueueAiSummaryGeneration(ctx, snapshot)
  return snapshot
}

// Queues PullRequestSummaryJob unless a summary is pending or already current.
export function enqueueAiSummaryGeneration(ctx: AppContext, snapshot: PullRequestSnapshotRecord) {
  const queued = transaction(ctx, ({ db }) => {
    const fresh = findSnapshot(db, snapshot.id)
    if (fresh.aiSummaryStatus === 'pending' || fresh.aiSummaryStatus === 'current') return false
    db.update(pullRequestSnapshots)
      .set({ aiSummaryStatus: 'pending', aiSummaryFailureReason: null, updatedAt: new Date() })
      .where(eq(pullRequestSnapshots.id, snapshot.id))
      .run()
    return true
  })

  if (queued) ctx.jobs.enqueue('PullRequestSummaryJob', { snapshotId: snapshot.id })
  return queued
}

export function storeAiSummary(db: Db, snapshot: PullRequestSnapshotRecord, summary: StoredAiSummary) {
  const now = new Date()
  db.update(pullRequestSnapshots)
    .set({
      aiSummaryStatus: 'current',
      aiSummaryGeneratedAt: now,
      aiSummaryFailureReason: null,
      aiSummaryFilesChanged: summary.filesChanged,
      aiSummaryLinesAdded: summary.linesAdded,
      aiSummaryLinesRemoved: summary.linesRemoved,
      aiSummaryMainChanges: JSON.stringify(summary.mainChanges),
      aiSummaryRiskAreas: JSON.stringify(summary.riskAreas),
      updatedAt: now,
    })
    .where(eq(pullRequestSnapshots.id, snapshot.id))
    .run()
}

export function markAiSummaryFailed(db: Db, snapshot: PullRequestSnapshotRecord, reason: string) {
  db.update(pullRequestSnapshots)
    .set({ aiSummaryStatus: 'failed', aiSummaryFailureReason: reason, aiSummaryGeneratedAt: null, updatedAt: new Date() })
    .where(eq(pullRequestSnapshots.id, snapshot.id))
    .run()
}
