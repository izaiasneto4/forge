import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test'
import type { Db } from '../../src/db/client'
import { secondsAgo } from '../../src/lib/ruby'
import { SettingStore } from '../../src/models/setting'
import { defaultSyncStatus, POLL_INTERVAL_SECONDS, syncStateForRepoPath, updateSyncState } from '../../src/models/sync-state'
import {
  buildSyncSkippedMessage,
  pullRequestColumns,
  pullRequestTotalCount,
  syncSkippedMessage,
  syncStatusPayload,
} from '../../src/presenters/pull-request-index'
import { createTestContext, type TestContext } from '../support/context'
import { insertPullRequest, insertReviewTask } from '../support/factories'
import { createGitRepository, createTempFolder } from '../support/git'

const hoursAgo = (hours: number) => secondsAgo(hours * 3600)

describe('PullRequestIndexPresenter', () => {
  let ctx: TestContext
  let db: Db
  let settingStore: SettingStore
  let tempFolder: ReturnType<typeof createTempFolder>

  beforeEach(() => {
    ctx = createTestContext()
    db = ctx.db
    settingStore = new SettingStore(db)
    tempFolder = createTempFolder()
  })

  afterEach(() => {
    tempFolder.remove()
    setSystemTime()
  })

  test('columns group only active pull requests by status', async () => {
    const pending = insertPullRequest(db, { updatedAtGithub: hoursAgo(2) })
    insertPullRequest(db, { remoteState: 'merged', inactiveReason: 'merged', updatedAtGithub: hoursAgo(1) })
    const reviewed = insertPullRequest(db, { reviewStatus: 'reviewed_by_me', updatedAtGithub: new Date() })
    insertReviewTask(db, { pullRequestId: reviewed.id, state: 'reviewed' })

    const columns = await pullRequestColumns(ctx, null)

    expect(columns.pending_review.map(({ number }) => number)).toEqual([pending.number])
    expect(columns.reviewed_by_me.map(({ number }) => number)).toEqual([reviewed.number])
    expect(columns.in_review).toEqual([])
  })

  test('columns list the most recently updated pull requests first', async () => {
    const older = insertPullRequest(db, { updatedAtGithub: hoursAgo(3) })
    const newest = insertPullRequest(db, { updatedAtGithub: hoursAgo(1) })
    const middle = insertPullRequest(db, { updatedAtGithub: hoursAgo(2) })

    const columns = await pullRequestColumns(ctx, null)

    expect(columns.pending_review.map(({ id }) => id)).toEqual([newest.id, middle.id, older.id])
  })

  test('columns only include pull requests of the current repo', async () => {
    const repoOwner = 'acme'
    const repoName = 'api'
    const repoPath = createGitRepository(ctx.commands, tempFolder.path, repoName, `${repoOwner}/${repoName}`)
    const own = insertPullRequest(db, { repoOwner, repoName })
    insertPullRequest(db, { repoOwner, repoName: 'web' })

    const columns = await pullRequestColumns(ctx, repoPath)

    expect(columns.pending_review.map(({ id }) => id)).toEqual([own.id])
  })

  test('total_count excludes archived, deleted and inactive pull requests', async () => {
    const visible = [insertPullRequest(db), insertPullRequest(db, { reviewStatus: 'reviewed_by_others' })]
    insertPullRequest(db, { remoteState: 'merged', inactiveReason: 'merged' })
    insertPullRequest(db, { archived: true })
    insertPullRequest(db, { deletedAt: new Date() })

    expect(await pullRequestTotalCount(ctx, null)).toBe(visible.length)
  })

  test('sync_status reflects the sync state of the current repo', async () => {
    const now = new Date()
    setSystemTime(now)
    const elapsedSeconds = 78
    const fetchedCount = 5
    const lastError = 'boom'
    const repoPath = createGitRepository(ctx.commands, tempFolder.path, 'api', 'acme/api')
    settingStore.setCurrentRepo(repoPath)
    const syncState = await syncStateForRepoPath(ctx, repoPath)
    if (!syncState) throw new Error('expected a sync state for the repo')
    updateSyncState(db, syncState, {
      status: 'partial',
      lastSucceededAt: secondsAgo(elapsedSeconds, now),
      lastError,
      fetchedCount,
    })

    const status = await syncStatusPayload(ctx)

    expect(status).toMatchObject({
      status: 'partial',
      last_error: lastError,
      fetched_count: fetchedCount,
      seconds_until_sync_allowed: POLL_INTERVAL_SECONDS - elapsedSeconds,
      sync_needed: false,
    })
  })

  test('sync_status falls back to the idle default without a GitHub repo', async () => {
    expect(await syncStatusPayload(ctx)).toEqual(defaultSyncStatus())
  })

  test('build_sync_skipped_message uses minutes above one minute, rounding up', () => {
    const seconds = 61
    const minutes = 2

    expect(buildSyncSkippedMessage(seconds)).toBe(`Using cached data (next sync available in ${minutes} minutes)`)
  })

  test('build_sync_skipped_message uses seconds for one minute or less', () => {
    const seconds = 30

    expect(buildSyncSkippedMessage(seconds)).toBe(`Using cached data (next sync available in ${seconds} seconds)`)
  })

  test('sync skipped message reads the wait from the current repo sync state', async () => {
    const now = new Date()
    setSystemTime(now)
    const elapsedSeconds = 90
    const repoPath = createGitRepository(ctx.commands, tempFolder.path, 'api', 'acme/api')
    settingStore.setCurrentRepo(repoPath)
    const syncState = await syncStateForRepoPath(ctx, repoPath)
    if (!syncState) throw new Error('expected a sync state for the repo')
    updateSyncState(db, syncState, { status: 'succeeded', lastSucceededAt: secondsAgo(elapsedSeconds, now) })

    expect(await syncSkippedMessage(ctx)).toBe(buildSyncSkippedMessage(POLL_INTERVAL_SECONDS - elapsedSeconds))
  })
})
