import { hostname } from 'node:os'
import { logger } from '../lib/logger'
import {
  decodeJob,
  type DecodedJob,
  type JobPayload,
  type JobQueue,
  type JobRecord,
  type JobWorkerIdentity,
  type JobWorkerRecord,
} from './queue'

export interface JobHandlers {
  ReviewTaskJob(payload: JobPayload<'ReviewTaskJob'>): Promise<void>
  ProcessReviewQueueJob(payload: JobPayload<'ProcessReviewQueueJob'>): Promise<void>
  PullRequestSummaryJob(payload: JobPayload<'PullRequestSummaryJob'>): Promise<void>
  SyncPullRequestsJob(payload: JobPayload<'SyncPullRequestsJob'>): Promise<void>
}

function dispatch(job: DecodedJob, handlers: JobHandlers) {
  switch (job.name) {
    case 'ReviewTaskJob':
      return handlers.ReviewTaskJob(job.payload)
    case 'ProcessReviewQueueJob':
      return handlers.ProcessReviewQueueJob(job.payload)
    case 'PullRequestSummaryJob':
      return handlers.PullRequestSummaryJob(job.payload)
    case 'SyncPullRequestsJob':
      return handlers.SyncPullRequestsJob(job.payload)
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

// Runs one claimed job. Like ActiveJob without retry_on, a raised error marks
// the job failed; jobs that need retries (ReviewTaskJob) schedule them itself.
export async function runJob(queue: JobQueue, record: JobRecord, handlers: JobHandlers) {
  try {
    await dispatch(decodeJob(record), handlers)
    queue.finish(record.id)
  } catch (error) {
    logger.error(`[jobs] ${record.name}#${record.id} failed: ${errorMessage(error)}`)
    queue.fail(record.id, errorMessage(error))
  }
}

// Runs every job that is due right now, one at a time. Used by tests and scripts.
export async function drainJobs(queue: JobQueue, handlers: JobHandlers, now = () => new Date()) {
  let ran = 0
  for (let job = queue.claimNext(now()); job; job = queue.claimNext(now())) {
    await runJob(queue, job, handlers)
    ran += 1
  }
  return ran
}

export interface JobWorkerOptions {
  // Solid Queue ran 3 worker threads in one process.
  concurrency?: number
  pollIntervalMs?: number
  // Solid Queue's process_heartbeat_interval and process_alive_threshold.
  heartbeatIntervalMs?: number
  aliveThresholdMs?: number
  // How long stop() waits for running jobs before handing them back to the queue.
  shutdownTimeoutMs?: number
}

const HEARTBEAT_INTERVAL_MS = 60_000
const ALIVE_THRESHOLD_MS = 5 * 60_000

function processRunning(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM: the process exists but belongs to another user.
    return error instanceof Error && 'code' in error && error.code === 'EPERM'
  }
}

// A worker is dead once it misses heartbeats for the alive threshold. On this
// host a crash shows sooner: its pid is gone, or it is our own pid from an
// earlier run. Kamal and Docker give every container its own hostname, so pids
// are only compared within one host.
function isDead(worker: JobWorkerRecord, self: JobWorkerIdentity, now: Date, aliveThresholdMs: number) {
  if (now.getTime() - worker.heartbeatAt.getTime() > aliveThresholdMs) return true
  if (worker.hostname !== self.hostname) return false
  return worker.pid === self.pid || !processRunning(worker.pid)
}

function releaseJobsOfDeadWorkers(queue: JobQueue, self: JobWorkerIdentity, aliveThresholdMs: number) {
  const now = new Date()
  for (const worker of queue.workers()) {
    if (worker.id !== self.id && isDead(worker, self, now, aliveThresholdMs)) queue.deregisterWorker(worker.id, now)
  }
  const released = queue.releaseOrphaned(now)
  if (released > 0) logger.info(`[jobs] released ${released} job(s) claimed by stopped workers`)
}

// In-process replacement for `bin/jobs`. Several servers may share the database
// (a rolling deploy), so a worker only takes back jobs whose worker is gone.
export function startJobWorker(queue: JobQueue, handlers: JobHandlers, options: JobWorkerOptions = {}) {
  const concurrency = options.concurrency ?? 3
  const pollIntervalMs = options.pollIntervalMs ?? 100
  const aliveThresholdMs = options.aliveThresholdMs ?? ALIVE_THRESHOLD_MS
  const self: JobWorkerIdentity = { id: crypto.randomUUID(), hostname: hostname(), pid: process.pid }
  const active = new Set<Promise<void>>()
  let running = true

  queue.registerWorker(self)
  releaseJobsOfDeadWorkers(queue, self, aliveThresholdMs)

  const heartbeat = setInterval(() => {
    try {
      if (!queue.heartbeat(self.id)) queue.registerWorker(self)
      releaseJobsOfDeadWorkers(queue, self, aliveThresholdMs)
    } catch (error) {
      logger.error(`[jobs] heartbeat failed: ${errorMessage(error)}`)
    }
  }, options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS)

  const loop = async () => {
    while (running) {
      const job = active.size < concurrency ? queue.claimNext(new Date(), self.id) : undefined
      if (!job) {
        await Bun.sleep(pollIntervalMs)
        continue
      }
      const execution = runJob(queue, job, handlers).finally(() => active.delete(execution))
      active.add(execution)
    }
  }
  const looping = loop()

  return {
    id: self.id,
    async stop() {
      running = false
      clearInterval(heartbeat)
      await looping
      const finished = Promise.all(active)
      const { shutdownTimeoutMs } = options
      await (shutdownTimeoutMs === undefined ? finished : Promise.race([finished, Bun.sleep(shutdownTimeoutMs)]))
      queue.deregisterWorker(self.id)
    },
  }
}
