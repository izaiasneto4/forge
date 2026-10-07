import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { and, asc, eq, inArray, lte } from 'drizzle-orm'
import type { Db } from '../db/client'
import { jobs } from '../db/schema'

// Replaces Solid Queue. Jobs persist in the `jobs` table so queued work survives
// restarts; one in-process worker (see worker.ts) claims and runs them.
export const JOB_PAYLOAD_SCHEMAS = {
  ReviewTaskJob: Type.Object({ reviewTaskId: Type.Integer(), isRetry: Type.Boolean() }),
  ProcessReviewQueueJob: Type.Object({}),
  PullRequestSummaryJob: Type.Object({ snapshotId: Type.Integer() }),
  SyncPullRequestsJob: Type.Object({}),
}

export type JobName = keyof typeof JOB_PAYLOAD_SCHEMAS
export type JobPayload<Name extends JobName> = Static<(typeof JOB_PAYLOAD_SCHEMAS)[Name]>

export type DecodedJob =
  | { id: number; name: 'ReviewTaskJob'; payload: JobPayload<'ReviewTaskJob'> }
  | { id: number; name: 'ProcessReviewQueueJob'; payload: JobPayload<'ProcessReviewQueueJob'> }
  | { id: number; name: 'PullRequestSummaryJob'; payload: JobPayload<'PullRequestSummaryJob'> }
  | { id: number; name: 'SyncPullRequestsJob'; payload: JobPayload<'SyncPullRequestsJob'> }

export type JobRecord = typeof jobs.$inferSelect

export const JOB_STATES = {
  ready: 'ready',
  claimed: 'claimed',
  finished: 'finished',
  failed: 'failed',
} as const

export class InvalidJobError extends Error {}

export function decodeJob(record: JobRecord): DecodedJob {
  const payload: unknown = JSON.parse(record.payload)
  const { id, name } = record
  switch (name) {
    case 'ReviewTaskJob':
      if (Value.Check(JOB_PAYLOAD_SCHEMAS.ReviewTaskJob, payload)) return { id, name, payload }
      break
    case 'ProcessReviewQueueJob':
      if (Value.Check(JOB_PAYLOAD_SCHEMAS.ProcessReviewQueueJob, payload)) return { id, name, payload }
      break
    case 'PullRequestSummaryJob':
      if (Value.Check(JOB_PAYLOAD_SCHEMAS.PullRequestSummaryJob, payload)) return { id, name, payload }
      break
    case 'SyncPullRequestsJob':
      if (Value.Check(JOB_PAYLOAD_SCHEMAS.SyncPullRequestsJob, payload)) return { id, name, payload }
      break
  }
  throw new InvalidJobError(`Job ${id} has an unknown name or invalid payload: ${name} ${record.payload}`)
}

export class JobQueue {
  constructor(private readonly db: Db) {}

  // ActiveJob `perform_later` / `set(wait:).perform_later`.
  enqueue<Name extends JobName>(name: Name, payload: JobPayload<Name>, options: { waitSeconds?: number } = {}) {
    const now = new Date()
    const runAt = new Date(now.getTime() + (options.waitSeconds ?? 0) * 1000)
    return this.db
      .insert(jobs)
      .values({ name, payload: JSON.stringify(payload), state: JOB_STATES.ready, runAt, createdAt: now, updatedAt: now })
      .returning()
      .get()
  }

  // Atomically claims the oldest due job. SQLite serializes writers, so the
  // conditional UPDATE guarantees a job is claimed at most once.
  claimNext(now = new Date()): JobRecord | undefined {
    const candidate = this.db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.state, JOB_STATES.ready), lte(jobs.runAt, now)))
      .orderBy(asc(jobs.runAt), asc(jobs.id))
      .get()
    if (!candidate) return undefined

    return this.db
      .update(jobs)
      .set({ state: JOB_STATES.claimed, claimedAt: now, updatedAt: now })
      .where(and(eq(jobs.id, candidate.id), eq(jobs.state, JOB_STATES.ready)))
      .returning()
      .get()
  }

  finish(id: number) {
    const now = new Date()
    this.db.update(jobs).set({ state: JOB_STATES.finished, finishedAt: now, updatedAt: now }).where(eq(jobs.id, id)).run()
  }

  fail(id: number, error: string) {
    const now = new Date()
    this.db.update(jobs).set({ state: JOB_STATES.failed, error, finishedAt: now, updatedAt: now }).where(eq(jobs.id, id)).run()
  }

  // Solid Queue releases a dead process's claimed executions back to ready.
  releaseClaimed() {
    const now = new Date()
    return this.db
      .update(jobs)
      .set({ state: JOB_STATES.ready, claimedAt: null, updatedAt: now })
      .where(eq(jobs.state, JOB_STATES.claimed))
      .returning({ id: jobs.id })
      .all().length
  }

  // SolidQueue::ClaimedExecution joined on class_name.
  hasClaimed(name: JobName) {
    return this.exists(name, [JOB_STATES.claimed])
  }

  // SolidQueue::ReadyExecution: due now and not yet claimed.
  hasReady(name: JobName, now = new Date()) {
    const row = this.db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.name, name), eq(jobs.state, JOB_STATES.ready), lte(jobs.runAt, now)))
      .get()
    return row !== undefined
  }

  // Jobs not yet run or still running, including scheduled retries.
  unfinished<Name extends JobName>(name: Name): DecodedJob[] {
    return this.db
      .select()
      .from(jobs)
      .where(and(eq(jobs.name, name), inArray(jobs.state, [JOB_STATES.ready, JOB_STATES.claimed])))
      .all()
      .map(decodeJob)
  }

  all(): JobRecord[] {
    return this.db.select().from(jobs).orderBy(asc(jobs.id)).all()
  }

  private exists(name: JobName, states: string[]) {
    const row = this.db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.name, name), inArray(jobs.state, states)))
      .get()
    return row !== undefined
  }
}
