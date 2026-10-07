import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, setSystemTime, test } from 'bun:test'
import { eq, sql } from 'drizzle-orm'
import { pullRequests, syncStates } from '../../../src/db/schema'
import { RecordInvalidError } from '../../../src/lib/errors'
import { analysisStatus, currentSnapshotOrCreate, findPullRequestUnscoped, updatePullRequest } from '../../../src/models/pull-request'
import { currentSnapshotFor } from '../../../src/models/pull-request-snapshot'
import { findReviewTask } from '../../../src/models/review-task'
import { SettingStore } from '../../../src/models/setting'
import { STREAMS } from '../../../src/realtime/broadcaster'
import { runSync } from '../../../src/services/sync/engine'
import { SyncAdapterError } from '../../../src/services/sync/github-adapter'
import { createTestContext, type TestContext } from '../../support/context'
import { insertPullRequest, insertReviewTask } from '../../support/factories'
import { createGitRepository, createTempFolder } from '../../support/git'
import {
  FakeSyncAdapter,
  fixtureOwner,
  fixtureRepo,
  fixtureSlug,
  ghJson,
  ghPullRequest,
  githubIdFor,
  remotePullRequest,
} from '../../support/github-fixtures'

const succeeded = 'succeeded'
const failed = 'failed'
const partial = 'partial'
const pendingReview = 'pending_review'
const reviewedByOthers = 'reviewed_by_others'
const openState = 'open'
const inaccessible = 'inaccessible'
const staleAnalysis = 'stale'
const running = 'running'
const idle = 'idle'
const summaryJob = 'PullRequestSummaryJob'

describe('runSync (Sync::Engine)', () => {
  const tempFolder = createTempFolder()
  let repoPath: string
  let unlinkedPath: string
  let ctx: TestContext

  beforeAll(async () => {
    repoPath = await createGitRepository(tempFolder.path, fixtureRepo, fixtureSlug)
    unlinkedPath = `${tempFolder.path}/not-a-repo`
  })

  afterAll(() => tempFolder.remove())

  beforeEach(() => {
    ctx = createTestContext()
    setSystemTime(new Date('2026-03-08T09:00:00Z'))
  })

  afterEach(() => setSystemTime())

  function findByNumber(number: number) {
    return ctx.db.select().from(pullRequests).where(eq(pullRequests.number, number)).get()
  }

  function uiEvents(name: string) {
    return ctx.events.on(STREAMS.uiEvents).filter((message) => message.event === name)
  }

  test('creates a new pull request and current snapshot', async () => {
    const number = 101
    const headSha = 'head-1'
    const adapter = new FakeSyncAdapter({ prs: [remotePullRequest({ number, headSha, requested: true })], complete: true })

    const result = await runSync(ctx, { repoPath, adapter })

    const pullRequest = findByNumber(number)
    expect(result.already_running).toBe(false)
    expect(result.sync.status).toBe(succeeded)
    expect(result.created).toBe(1)
    expect(pullRequest?.remoteState).toBe(openState)
    expect(pullRequest?.reviewStatus).toBe(pendingReview)
    expect(currentSnapshotFor(ctx.db, pullRequest?.id ?? 0)?.headSha).toBe(headSha)
    expect(ctx.jobs.all().map((job) => job.name)).toContain(summaryJob)
  })

  test('marks analysis stale when the reviewable revision changes', async () => {
    const number = 202
    const pullRequest = insertPullRequest(ctx.db, { githubId: number, number, headSha: 'head-1', baseSha: 'base-1' })
    const oldSnapshot = currentSnapshotOrCreate(ctx, pullRequest)
    const task = insertReviewTask(ctx.db, { pullRequestId: pullRequest.id, state: 'reviewed', reviewOutput: '[]', pullRequestSnapshotId: oldSnapshot?.id })
    updatePullRequest(ctx, pullRequest, { reviewStatus: 'reviewed_by_me' })
    const adapter = new FakeSyncAdapter({ prs: [remotePullRequest({ number, headSha: 'head-2', latestReviewState: 'COMMENTED' })], complete: true })

    await runSync(ctx, { repoPath, adapter })

    const reloaded = findPullRequestUnscoped(ctx.db, pullRequest.id)
    expect(reloaded && analysisStatus(ctx.db, reloaded)).toBe(staleAnalysis)
    expect(reloaded?.reviewStatus).toBe(pendingReview)
    expect(currentSnapshotFor(ctx.db, pullRequest.id)?.id).not.toBe(oldSnapshot?.id)
    expect(findReviewTask(ctx.db, task.id).pullRequestSnapshotId).toBe(oldSnapshot?.id ?? null)
  })

  test('classifies missing pull requests via targeted lookup when full fetch is complete', async () => {
    const number = 303
    const remoteState = 'merged'
    const pullRequest = insertPullRequest(ctx.db, { githubId: number, number, title: 'Missing' })
    const adapter = new FakeSyncAdapter({ prs: [], complete: true }).withPullRequest(
      number,
      remotePullRequest({ number, headSha: 'head-9', state: remoteState }),
    )

    const result = await runSync(ctx, { repoPath, adapter })

    const reloaded = findPullRequestUnscoped(ctx.db, pullRequest.id)
    expect(adapter.lookups).toEqual([number])
    expect(reloaded?.remoteState).toBe(remoteState)
    expect(reloaded?.inactiveReason).toBe(remoteState)
    expect(result.deactivated).toBe(1)
  })

  test('returns already_running when the scope is locked by another sync', async () => {
    const now = new Date()
    ctx.db
      .insert(syncStates)
      .values({ scopeKey: `repo:${fixtureSlug}`, repoOwner: fixtureOwner, repoName: fixtureRepo, status: running, createdAt: now, updatedAt: now })
      .run()
    const adapter = new FakeSyncAdapter()

    const result = await runSync(ctx, { repoPath, adapter })

    expect(adapter.openFetches).toEqual([])
    expect(result.already_running).toBe(true)
    expect(result.sync.status).toBe(running)
    expect(ctx.events.messages).toEqual([])
  })

  test('returns the idle result without touching GitHub when the repo has no GitHub remote', async () => {
    const adapter = new FakeSyncAdapter()

    const result = await runSync(ctx, { repoPath: unlinkedPath, adapter })

    expect(adapter.openFetches).toEqual([])
    expect(result).toEqual({
      fetched: 0,
      created: 0,
      updated: 0,
      deactivated: 0,
      already_running: false,
      sync: expect.objectContaining({ status: idle, running: false, last_synced_at: null, sync_needed: false }),
    })
  })

  test('falls back to the current repo setting', async () => {
    new SettingStore(ctx.db).setCurrentRepo(repoPath)
    const adapter = new FakeSyncAdapter()

    const result = await runSync(ctx, { repoPath: null, adapter })

    expect(adapter.openFetches).toHaveLength(1)
    expect(result.sync.status).toBe(succeeded)
  })

  test('broadcasts start and completion, stores counts and touches last_synced_at', async () => {
    const trigger = 'repo_switch'
    const prs = [remotePullRequest({ number: 1, headSha: 'a' }), remotePullRequest({ number: 2, headSha: 'b' })]
    const adapter = new FakeSyncAdapter({ prs, complete: true })

    const result = await runSync(ctx, { repoPath, adapter, trigger })

    const [started] = uiEvents('sync.started')
    const [completed] = uiEvents('sync.completed')
    expect(started).toMatchObject({ repo_path: repoPath, repo: fixtureSlug, sync: { status: running, trigger } })
    expect(completed).toMatchObject({ repo_path: repoPath, repo: fixtureSlug, sync: result.sync })
    expect(result).toMatchObject({ fetched: prs.length, created: prs.length, updated: 0, deactivated: 0, partial: false, errors: [] })
    expect(result.sync).toMatchObject({ fetched_count: prs.length, created_count: prs.length, last_error: null, running: false })
    expect(new SettingStore(ctx.db).lastSyncedAt()).not.toBeNull()
  })

  test('announces new pull requests with their classified review status', async () => {
    const number = 7
    const adapter = new FakeSyncAdapter({ prs: [remotePullRequest({ number, headSha: 'h' })], complete: true })

    await runSync(ctx, { repoPath, adapter })

    const pullRequest = findByNumber(number)
    expect(pullRequest?.reviewStatus).toBe(reviewedByOthers)
    expect(uiEvents('pull_request.updated')).toEqual([
      expect.objectContaining({ pull_request_id: pullRequest?.id, review_status: pullRequest?.reviewStatus, previous_status: null }),
    ])
  })

  test('counts unchanged pull requests as no-ops on the next sync', async () => {
    const adapter = new FakeSyncAdapter({ prs: [remotePullRequest({ number: 8, headSha: 'h', requested: true })], complete: true })
    await runSync(ctx, { repoPath, adapter })

    const second = await runSync(ctx, { repoPath, adapter })

    expect(second).toMatchObject({ fetched: 1, created: 0, updated: 0 })
  })

  test('restores soft-deleted pull requests and counts them as updated', async () => {
    const number = 9
    const pullRequest = insertPullRequest(ctx.db, { githubId: number, number, deletedAt: new Date() })
    const adapter = new FakeSyncAdapter({ prs: [remotePullRequest({ number, headSha: 'h', requested: true })], complete: true })

    const result = await runSync(ctx, { repoPath, adapter })

    expect(result.updated).toBe(1)
    expect(findPullRequestUnscoped(ctx.db, pullRequest.id)?.deletedAt).toBeNull()
  })

  test('marks missing pull requests inaccessible when GitHub no longer returns them', async () => {
    const number = 404
    const pullRequest = insertPullRequest(ctx.db, { githubId: number, number })
    const adapter = new FakeSyncAdapter({ prs: [], complete: true }).withPullRequest(number, null)

    const result = await runSync(ctx, { repoPath, adapter })

    const reloaded = findPullRequestUnscoped(ctx.db, pullRequest.id)
    expect(reloaded).toMatchObject({ remoteState: inaccessible, inactiveReason: inaccessible })
    expect(reloaded?.closedAtGithub).toBeInstanceOf(Date)
    expect(result.deactivated).toBe(1)
  })

  test('skips the missing-PR pass when the open list was truncated', async () => {
    const number = 405
    insertPullRequest(ctx.db, { githubId: number, number })
    const adapter = new FakeSyncAdapter({ prs: [], complete: false })

    await runSync(ctx, { repoPath, adapter })

    expect(adapter.lookups).toEqual([])
  })

  test('reports lookup failures as a partial sync', async () => {
    const failingNumber = 500
    const message = 'HTTP 502'
    insertPullRequest(ctx.db, { githubId: failingNumber, number: failingNumber })
    const adapter = new FakeSyncAdapter({ prs: [], complete: true }).withPullRequest(failingNumber, new SyncAdapterError(message))

    const result = await runSync(ctx, { repoPath, adapter })

    const expectedError = `PR #${failingNumber}: ${message}`
    expect(result).toMatchObject({ partial: true, errors: [expectedError], deactivated: 0 })
    expect(result.sync).toMatchObject({ status: partial, last_error: expectedError })
  })

  test('records the failure, broadcasts it and rethrows', async () => {
    const message = 'Network error'
    const adapter = new FakeSyncAdapter(new SyncAdapterError(message))

    await expect(runSync(ctx, { repoPath, adapter })).rejects.toThrow(message)

    const state = ctx.db.select().from(syncStates).get()
    expect(state).toMatchObject({ status: failed, lastError: message })
    expect(uiEvents('sync.failed')).toEqual([expect.objectContaining({ error: message, sync: expect.objectContaining({ status: failed }) })])
  })

  test('rolls back every write when an upsert fails validation', async () => {
    const orphanNumber = 600
    const newNumber = 601
    insertPullRequest(ctx.db, { githubId: orphanNumber, number: orphanNumber, reviewStatus: 'reviewed_by_me' })
    const adapter = new FakeSyncAdapter({
      prs: [remotePullRequest({ number: newNumber, headSha: 'h' }), remotePullRequest({ number: orphanNumber, headSha: 'h' })],
      complete: true,
    })

    await expect(runSync(ctx, { repoPath, adapter })).rejects.toThrow(RecordInvalidError)

    expect(findByNumber(newNumber)).toBeUndefined()
    expect(uiEvents('pull_request.updated')).toEqual([])
    expect(ctx.db.select().from(syncStates).get()?.status).toBe(failed)
  })

  test('focused sync upserts only the requested pull request', async () => {
    const focusedNumber = 77
    const untouchedNumber = 78
    insertPullRequest(ctx.db, { githubId: untouchedNumber, number: untouchedNumber })
    const adapter = new FakeSyncAdapter().withPullRequest(focusedNumber, remotePullRequest({ number: focusedNumber, headSha: 'h' }))

    const result = await runSync(ctx, { repoPath, adapter, trigger: 'focused_pr', pullRequestNumber: focusedNumber })

    expect(adapter.openFetches).toEqual([])
    expect(adapter.lookups).toEqual([focusedNumber])
    expect(result).toMatchObject({ fetched: 1, created: 1, deactivated: 0 })
    expect(findByNumber(focusedNumber)).toBeDefined()
  })

  test('focused sync of an unknown pull request fetches nothing', async () => {
    const unknownNumber = 79
    const adapter = new FakeSyncAdapter().withPullRequest(unknownNumber, null)

    const result = await runSync(ctx, { repoPath, adapter, pullRequestNumber: unknownNumber })

    expect(result).toMatchObject({ fetched: 0, created: 0 })
  })

  test('builds the gh adapter on demand, remembers the login and keeps exact github ids', async () => {
    const login = 'octocat'
    const number = 31
    ctx.commands.on(['gh', 'api', 'user'], { stdout: `${login}\n` })
    ctx.commands.on(['gh', 'pr', 'list'], { stdout: ghJson([ghPullRequest({ number, reviewRequests: [{ login }] })]) })

    const first = await runSync(ctx, { repoPath })
    const second = await runSync(ctx, { repoPath })

    const stored = ctx.db.select({ githubId: sql<string>`CAST(${pullRequests.githubId} AS TEXT)` }).from(pullRequests).get()
    expect(new SettingStore(ctx.db).githubLogin()).toBe(login)
    expect(first.created).toBe(1)
    expect(second).toMatchObject({ created: 0, updated: 0 })
    expect(stored?.githubId).toBe(githubIdFor(number).toString())
    expect(findByNumber(number)?.reviewRequestedForMe).toBe(true)
    expect(ctx.commands.commandsMatching(['gh', 'pr', 'list']).map(({ options }) => options.cwd)).toEqual([repoPath, repoPath])
  })
})
