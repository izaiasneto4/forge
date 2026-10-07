import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { and, asc, eq, inArray, isNull, lte, notInArray, or } from 'drizzle-orm'
import type { Db } from '../db/client'
import { jobWorkers, jobs } from '../db/schema'

// Replaces Solid Queue. Jobs persist in the `jobs` table so queued work survives
// restarts; an in-process worker per server (see worker.ts) claims and runs them.
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
export type JobWorkerRecord = typeof jobWorkers.$inferSelect
export type JobWorkerIdentity = Pick<JobWorkerRecord, 'id' | 'hostname' | 'pid'>

export const JOB_STATES = Object.freeze({
  ready: 'ready',
  claimed: 'claimed',
  finished: 'finished',
  failed: 'failed',
})

export class InvalidJobError extends Error {}

function claimHeldBy(job: JobRecord) {
  const holder = job.claimedBy === null ? isNull(jobs.claimedBy) : eq(jobs.claimedBy, job.claimedBy)
  return and(eq(jobs.id, job.id), eq(jobs.state, JOB_STATES.claimed), holder)
}

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
  claimNext(now = new Date(), claimedBy: string | null = null): JobRecord | undefined {
    const candidate = this.db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.state, JOB_STATES.ready), lte(jobs.runAt, now)))
      .orderBy(asc(jobs.runAt), asc(jobs.id))
      .get()
    if (!candidate) return undefined

    return this.db
      .update(jobs)
      .set({ state: JOB_STATES.claimed, claimedAt: now, claimedBy, updatedAt: now })
      .where(and(eq(jobs.id, candidate.id), eq(jobs.state, JOB_STATES.ready)))
      .returning()
      .get()
  }

  // Only the holder of the claim records the outcome, so a handler still running
  // after its job was taken back can't overwrite the next run's result.
  finish(job: JobRecord) {
    const now = new Date()
    this.db.update(jobs).set({ state: JOB_STATES.finished, finishedAt: now, updatedAt: now }).where(claimHeldBy(job)).run()
  }

  fail(job: JobRecord, error: string) {
    const now = new Date()
    this.db.update(jobs).set({ state: JOB_STATES.failed, error, finishedAt: now, updatedAt: now }).where(claimHeldBy(job)).run()
  }

  // Solid Queue's process registry: each worker heartbeats, so another server
  // sharing the database can tell a live worker's claimed jobs from a dead one's.
  registerWorker(worker: JobWorkerIdentity, now = new Date()) {
    this.db.insert(jobWorkers).values({ ...worker, heartbeatAt: now, createdAt: now }).run()
  }

  // False when the worker's row is gone, e.g. pruned after it missed heartbeats.
  heartbeat(workerId: string, now = new Date()) {
    const touched = this.db
      .update(jobWorkers)
      .set({ heartbeatAt: now })
      .where(eq(jobWorkers.id, workerId))
      .returning({ id: jobWorkers.id })
      .all()
    return touched.length > 0
  }

  workers(): JobWorkerRecord[] {
    return this.db.select().from(jobWorkers).orderBy(asc(jobWorkers.createdAt)).all()
  }

  // Jobs the worker still holds become orphaned; releaseOrphaned hands them back.
  deregisterWorker(workerId: string) {
    this.db.delete(jobWorkers).where(eq(jobWorkers.id, workerId)).run()
  }

  // Claimed jobs with no registered worker behind them: the worker was
  // deregistered, or the job was claimed outside a worker (drainJobs) or by a
  // build that predates worker registration.
  releaseOrphaned(now = new Date()) {
    const registeredWorkerIds = this.db.select({ id: jobWorkers.id }).from(jobWorkers)
    return this.db
      .update(jobs)
      .set({ state: JOB_STATES.ready, claimedAt: null, claimedBy: null, updatedAt: now })
      .where(and(eq(jobs.state, JOB_STATES.claimed), or(isNull(jobs.claimedBy), notInArray(jobs.claimedBy, registeredWorkerIds))))
      .returning({ id: jobs.id })
      .all().length
  }

  hasClaimed(name: JobName) {
    return this.exists(name, [JOB_STATES.claimed])
  }

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
