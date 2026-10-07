import { describe, expect, test } from 'bun:test'
import { hostname } from 'node:os'
import { JOB_STATES } from '../../src/jobs/queue'
import { drainJobs, startJobWorker, type JobHandlers } from '../../src/jobs/worker'
import { createTestContext } from '../support/context'

function recordingHandlers(overrides: Partial<JobHandlers> = {}) {
  const calls: string[] = []
  const handlers: JobHandlers = {
    ReviewTaskJob: async (payload) => {
      calls.push(`review:${payload.reviewTaskId}`)
    },
    ProcessReviewQueueJob: async () => {
      calls.push('process')
    },
    PullRequestSummaryJob: async (payload) => {
      calls.push(`summary:${payload.snapshotId}`)
    },
    SyncPullRequestsJob: async () => {
      calls.push('sync')
    },
    ...overrides,
  }
  return { calls, handlers }
}

describe('job worker', () => {
  test('runs due jobs in order and marks them finished', async () => {
    const ctx = createTestContext()
    const reviewTaskId = 4
    const { calls, handlers } = recordingHandlers()
    ctx.jobs.enqueue('ReviewTaskJob', { reviewTaskId, isRetry: false })
    ctx.jobs.enqueue('ProcessReviewQueueJob', {})

    const ran = await drainJobs(ctx.jobs, handlers)

    expect(ran).toBe(2)
    expect(calls).toEqual([`review:${reviewTaskId}`, 'process'])
    expect(ctx.jobs.all().map((job) => job.state)).toEqual([JOB_STATES.finished, JOB_STATES.finished])
  })

  test('marks a job failed when its handler throws, and keeps going', async () => {
    const ctx = createTestContext()
    const failure = 'gh exploded'
    const { calls, handlers } = recordingHandlers({
      SyncPullRequestsJob: async () => {
        throw new Error(failure)
      },
    })
    ctx.jobs.enqueue('SyncPullRequestsJob', {})
    ctx.jobs.enqueue('ProcessReviewQueueJob', {})

    await drainJobs(ctx.jobs, handlers)

    expect(ctx.jobs.all()[0]).toMatchObject({ state: JOB_STATES.failed, error: `Error: ${failure}` })
    expect(calls).toEqual(['process'])
  })

  test('the background worker picks up jobs enqueued after it starts and stops cleanly', async () => {
    const ctx = createTestContext()
    const done = Promise.withResolvers<void>()
    const { handlers } = recordingHandlers({
      ProcessReviewQueueJob: async () => {
        done.resolve()
      },
    })
    const worker = startJobWorker(ctx.jobs, handlers, { pollIntervalMs: 5 })

    ctx.jobs.enqueue('ProcessReviewQueueJob', {})
    await done.promise
    await worker.stop()

    expect(ctx.jobs.all()[0]?.state).toBe(JOB_STATES.finished)
  })

  test('re-queues jobs a previous process had claimed', async () => {
    const ctx = createTestContext()
    const { handlers } = recordingHandlers()
    ctx.jobs.enqueue('ProcessReviewQueueJob', {})
    ctx.jobs.claimNext()

    const worker = startJobWorker(ctx.jobs, handlers, { pollIntervalMs: 5 })
    await Bun.sleep(50)
    await worker.stop()

    expect(ctx.jobs.all()[0]?.state).toBe(JOB_STATES.finished)
  })

  test('leaves jobs claimed by a live worker on another server alone', async () => {
    const ctx = createTestContext()
    const { calls, handlers } = recordingHandlers()
    const otherServerWorker = { id: crypto.randomUUID(), hostname: `${hostname()}-other`, pid: process.pid }
    ctx.jobs.registerWorker(otherServerWorker)
    ctx.jobs.enqueue('ProcessReviewQueueJob', {})
    ctx.jobs.claimNext(new Date(), otherServerWorker.id)

    const worker = startJobWorker(ctx.jobs, handlers, { pollIntervalMs: 5 })
    await Bun.sleep(50)
    await worker.stop()

    expect(calls).toEqual([])
    expect(ctx.jobs.all()[0]).toMatchObject({ state: JOB_STATES.claimed, claimedBy: otherServerWorker.id })
  })

  test('re-queues jobs of a worker that stopped heartbeating', async () => {
    const ctx = createTestContext()
    const { handlers } = recordingHandlers()
    const aliveThresholdMs = 1000
    const silentWorker = { id: crypto.randomUUID(), hostname: `${hostname()}-other`, pid: process.pid }
    ctx.jobs.registerWorker(silentWorker, new Date(Date.now() - aliveThresholdMs - 1))
    ctx.jobs.enqueue('ProcessReviewQueueJob', {})
    ctx.jobs.claimNext(new Date(), silentWorker.id)

    const worker = startJobWorker(ctx.jobs, handlers, { pollIntervalMs: 5, aliveThresholdMs })
    await Bun.sleep(50)
    await worker.stop()

    expect(ctx.jobs.all()[0]?.state).toBe(JOB_STATES.finished)
    expect(ctx.jobs.workers()).toEqual([])
  })

  test('re-queues jobs of a crashed process on this host without waiting for the alive threshold', async () => {
    const ctx = createTestContext()
    const { handlers } = recordingHandlers()
    const exitedPid = Bun.spawnSync(['true']).pid
    const crashedWorker = { id: crypto.randomUUID(), hostname: hostname(), pid: exitedPid }
    ctx.jobs.registerWorker(crashedWorker)
    ctx.jobs.enqueue('ProcessReviewQueueJob', {})
    ctx.jobs.claimNext(new Date(), crashedWorker.id)

    const worker = startJobWorker(ctx.jobs, handlers, { pollIntervalMs: 5 })
    await Bun.sleep(50)
    await worker.stop()

    expect(ctx.jobs.all()[0]?.state).toBe(JOB_STATES.finished)
  })

  test('heartbeats while running and deregisters on stop', async () => {
    const ctx = createTestContext()
    const { handlers } = recordingHandlers()
    const heartbeatIntervalMs = 10

    const worker = startJobWorker(ctx.jobs, handlers, { pollIntervalMs: 5, heartbeatIntervalMs })
    const [registered] = ctx.jobs.workers()
    await Bun.sleep(heartbeatIntervalMs * 5)
    const [afterHeartbeats] = ctx.jobs.workers()
    await worker.stop()

    expect(registered?.id).toBe(worker.id)
    expect(afterHeartbeats?.heartbeatAt.getTime()).toBeGreaterThan(registered?.heartbeatAt.getTime() ?? Number.POSITIVE_INFINITY)
    expect(ctx.jobs.workers()).toEqual([])
  })

  test('hands a job still running at the shutdown timeout back to the queue', async () => {
    const ctx = createTestContext()
    const jobStarted = Promise.withResolvers<void>()
    const jobAllowedToFinish = Promise.withResolvers<void>()
    const { handlers } = recordingHandlers({
      ProcessReviewQueueJob: async () => {
        jobStarted.resolve()
        await jobAllowedToFinish.promise
      },
    })
    const worker = startJobWorker(ctx.jobs, handlers, { pollIntervalMs: 5, shutdownTimeoutMs: 20 })
    ctx.jobs.enqueue('ProcessReviewQueueJob', {})
    await jobStarted.promise

    await worker.stop()

    expect(ctx.jobs.all()[0]).toMatchObject({ state: JOB_STATES.ready, claimedBy: null })
    expect(ctx.jobs.workers()).toEqual([])
    jobAllowedToFinish.resolve()
  })
})
