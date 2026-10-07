import { describe, expect, test } from 'bun:test'
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
})
