import { logger } from '../lib/logger'
import { decodeJob, type DecodedJob, type JobPayload, type JobQueue, type JobRecord } from './queue'

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
}

// In-process replacement for `bin/jobs`.
export function startJobWorker(queue: JobQueue, handlers: JobHandlers, options: JobWorkerOptions = {}) {
  const concurrency = options.concurrency ?? 3
  const pollIntervalMs = options.pollIntervalMs ?? 100
  const active = new Set<Promise<void>>()
  let running = true

  const released = queue.releaseClaimed()
  if (released > 0) logger.info(`[jobs] released ${released} job(s) claimed before restart`)

  const loop = async () => {
    while (running) {
      const job = active.size < concurrency ? queue.claimNext() : undefined
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
    async stop() {
      running = false
      await looping
      await Promise.all(active)
    },
  }
}
