import { describe, expect, setSystemTime, afterEach, test } from 'bun:test'
import { hostname } from 'node:os'
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
    queue.fail(claimed, errorMessage)

    expect(queue.hasClaimed('ReviewTaskJob')).toBe(false)
    expect(queue.all()[0]).toMatchObject({ state: JOB_STATES.failed, error: errorMessage })
  })

  test('releases claimed jobs whose worker is not registered, and keeps the rest claimed', () => {
    const queue = new JobQueue(createTestDatabase())
    const registeredWorker = { id: crypto.randomUUID(), hostname: hostname(), pid: process.pid }
    const unregisteredWorkerId = crypto.randomUUID()
    queue.registerWorker(registeredWorker)
    const orphaned = queue.enqueue('SyncPullRequestsJob', {})
    const owned = queue.enqueue('ProcessReviewQueueJob', {})
    const claimedWithoutWorker = queue.enqueue('PullRequestSummaryJob', { snapshotId: 1 })
    queue.claimNext(new Date(), unregisteredWorkerId)
    queue.claimNext(new Date(), registeredWorker.id)
    queue.claimNext()

    const released = queue.releaseOrphaned()

    const statesById = new Map(queue.all().map((job) => [job.id, job.state]))
    expect(released).toBe(2)
    expect(statesById.get(orphaned.id)).toBe(JOB_STATES.ready)
    expect(statesById.get(claimedWithoutWorker.id)).toBe(JOB_STATES.ready)
    expect(statesById.get(owned.id)).toBe(JOB_STATES.claimed)
  })

  test('jobs a deregistered worker still holds stay claimed until released as orphans', () => {
    const queue = new JobQueue(createTestDatabase())
    const worker = { id: crypto.randomUUID(), hostname: hostname(), pid: process.pid }
    queue.registerWorker(worker)
    queue.enqueue('SyncPullRequestsJob', {})
    queue.claimNext(new Date(), worker.id)

    queue.deregisterWorker(worker.id)
    const stateAfterDeregistering = queue.all()[0]?.state
    const released = queue.releaseOrphaned()

    expect(stateAfterDeregistering).toBe(JOB_STATES.claimed)
    expect(released).toBe(1)
    expect(queue.all()[0]).toMatchObject({ state: JOB_STATES.ready, claimedBy: null })
    expect(queue.workers()).toEqual([])
  })

  test('only the worker holding the claim records the outcome', () => {
    const queue = new JobQueue(createTestDatabase())
    const stoppedWorker = { id: crypto.randomUUID(), hostname: hostname(), pid: process.pid }
    const nextWorker = { id: crypto.randomUUID(), hostname: hostname(), pid: process.pid }
    queue.registerWorker(stoppedWorker)
    queue.registerWorker(nextWorker)
    queue.enqueue('SyncPullRequestsJob', {})
    const staleClaim = queue.claimNext(new Date(), stoppedWorker.id)
    queue.deregisterWorker(stoppedWorker.id)
    queue.releaseOrphaned()
    const currentClaim = queue.claimNext(new Date(), nextWorker.id)
    if (!staleClaim || !currentClaim) throw new Error('expected both claims')

    const staleError = 'stale handler failed'

    queue.finish(staleClaim)
    queue.fail(staleClaim, staleError)
    const afterStaleOutcomes = queue.all()[0]
    queue.finish(currentClaim)

    expect(afterStaleOutcomes).toMatchObject({ state: JOB_STATES.claimed, claimedBy: nextWorker.id, error: null })
    expect(queue.all()[0]?.state).toBe(JOB_STATES.finished)
  })

  test('heartbeat reports whether the worker is still registered', () => {
    const queue = new JobQueue(createTestDatabase())
    const worker = { id: crypto.randomUUID(), hostname: hostname(), pid: process.pid }
    const registeredAt = new Date('2026-10-07T12:00:00Z')
    const beatAt = new Date(registeredAt.getTime() + 60_000)
    queue.registerWorker(worker, registeredAt)

    const stillRegistered = queue.heartbeat(worker.id, beatAt)
    queue.deregisterWorker(worker.id)
    const afterDeregistering = queue.heartbeat(worker.id, beatAt)

    expect(stillRegistered).toBe(true)
    expect(afterDeregistering).toBe(false)
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
