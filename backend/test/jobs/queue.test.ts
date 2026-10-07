import { describe, expect, setSystemTime, afterEach, test } from 'bun:test'
import { decodeJob, JOB_STATES, JobQueue } from '../../src/jobs/queue'
import { createTestDatabase } from '../support/database'

describe('JobQueue', () => {
  afterEach(() => setSystemTime())

  test('claims due jobs oldest first and only once', () => {
    const queue = new JobQueue(createTestDatabase())
    const first = queue.enqueue('PullRequestSummaryJob', { snapshotId: 1 })
    const second = queue.enqueue('ProcessReviewQueueJob', {})

    const claimedFirst = queue.claimNext()
    const claimedSecond = queue.claimNext()

    expect(claimedFirst?.id).toBe(first.id)
    expect(claimedSecond?.id).toBe(second.id)
    expect(queue.claimNext()).toBeUndefined()
  })

  test('holds scheduled jobs until their run time', () => {
    const queue = new JobQueue(createTestDatabase())
    const waitSeconds = 4
    const now = new Date('2026-10-07T10:00:00Z')
    setSystemTime(now)
    queue.enqueue('ReviewTaskJob', { reviewTaskId: 1, isRetry: true }, { waitSeconds })

    expect(queue.claimNext(now)).toBeUndefined()
    expect(queue.hasReady('ReviewTaskJob', now)).toBe(false)
    expect(queue.claimNext(new Date(now.getTime() + waitSeconds * 1000))).toBeDefined()
  })

  test('tracks claimed, finished and failed jobs', () => {
    const queue = new JobQueue(createTestDatabase())
    const errorMessage = 'boom'
    queue.enqueue('ReviewTaskJob', { reviewTaskId: 7, isRetry: false })
    const claimed = queue.claimNext()
    if (!claimed) throw new Error('expected a claimed job')

    expect(queue.hasClaimed('ReviewTaskJob')).toBe(true)
    queue.fail(claimed.id, errorMessage)

    expect(queue.hasClaimed('ReviewTaskJob')).toBe(false)
    expect(queue.all()[0]).toMatchObject({ state: JOB_STATES.failed, error: errorMessage })
  })

  test('releases jobs claimed by a previous process', () => {
    const queue = new JobQueue(createTestDatabase())
    queue.enqueue('SyncPullRequestsJob', {})
    queue.claimNext()

    const released = queue.releaseClaimed()

    expect(released).toBe(1)
    expect(queue.claimNext()).toBeDefined()
  })

  test('decodes payloads per job type and reports unfinished review jobs', () => {
    const queue = new JobQueue(createTestDatabase())
    const reviewTaskId = 12
    queue.enqueue('ReviewTaskJob', { reviewTaskId, isRetry: false })

    const [unfinished] = queue.unfinished('ReviewTaskJob')

    expect(unfinished).toMatchObject({ name: 'ReviewTaskJob', payload: { reviewTaskId, isRetry: false } })
  })

  test('rejects a stored job whose payload does not match its type', () => {
    const queue = new JobQueue(createTestDatabase())
    const stored = queue.enqueue('PullRequestSummaryJob', { snapshotId: 3 })

    expect(() => decodeJob({ ...stored, payload: JSON.stringify({ snapshotId: 'three' }) })).toThrow()
  })
})
