import { describe, expect, test } from 'bun:test'
import { syncStates } from '../../src/db/schema'
import { syncStatePayload, type SyncStateChanges } from '../../src/models/sync-state'
import { createTestContext } from '../support/context'

function buildState(changes: SyncStateChanges = {}) {
  const ctx = createTestContext()
  const now = new Date('2026-10-08T12:00:00Z')
  return ctx.db.insert(syncStates).values({
    scopeKey: 'repo:acme/api',
    createdAt: now,
    updatedAt: now,
    ...changes,
  }).returning().get()
}

describe('syncStatePayload', () => {
  test.each([null, new Date('2026-10-08T10:00:00Z')])('backs off a failed sync with last success %p', (lastSucceededAt) => {
    const lastFinishedAt = new Date('2026-10-08T12:00:00Z')
    const state = buildState({ status: 'failed', lastFinishedAt, lastSucceededAt })
    const beforeRetry = new Date('2026-10-08T12:01:59Z')
    const retryAt = new Date('2026-10-08T12:02:00Z')

    const waiting = syncStatePayload(state, beforeRetry)
    const ready = syncStatePayload(state, retryAt)

    expect(waiting.sync_needed).toBe(false)
    expect(waiting.seconds_until_sync_allowed).toBe(1)
    expect(waiting.last_succeeded_at).toBe(lastSucceededAt?.toISOString().replace('.000Z', 'Z') ?? null)
    expect(ready.sync_needed).toBe(true)
    expect(ready.seconds_until_sync_allowed).toBe(0)
  })

  test('keeps the existing successful sync cadence', () => {
    const lastSucceededAt = new Date('2026-10-08T12:00:00Z')
    const state = buildState({ status: 'succeeded', lastSucceededAt })
    const beforeRetry = new Date('2026-10-08T12:01:00Z')
    const retryAt = new Date('2026-10-08T12:02:00Z')

    expect(syncStatePayload(state, beforeRetry)).toMatchObject({ sync_needed: false, seconds_until_sync_allowed: 60 })
    expect(syncStatePayload(state, retryAt)).toMatchObject({ sync_needed: true, seconds_until_sync_allowed: 0 })
  })

  test('allows an initial sync immediately', () => {
    const state = buildState()
    const now = new Date('2026-10-08T12:00:00Z')

    expect(syncStatePayload(state, now)).toMatchObject({ sync_needed: true, seconds_until_sync_allowed: 0 })
  })

  test('does not request another sync while one is running', () => {
    const state = buildState({ status: 'running' })
    const now = new Date('2026-10-08T12:00:00Z')

    expect(syncStatePayload(state, now)).toMatchObject({ sync_needed: false, seconds_until_sync_allowed: 0 })
  })
})
