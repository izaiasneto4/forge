import type { Static, TSchema } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { SettingsResponse } from '../../src/contracts/settings'
import {
  BootstrapResponse,
  PullRequestBoardResponse,
  RepositoriesResponse,
  ReviewTaskBoardResponse,
  ReviewTaskDetailResponse,
  SyncStatus,
} from '../../src/contracts/ui-payloads'
import { ok } from '../../src/http/envelope'
import { secondsAgo } from '../../src/lib/ruby'
import { findReviewTask } from '../../src/models/review-task'
import { SettingStore } from '../../src/models/setting'
import { syncStateForRepoPath, updateSyncState } from '../../src/models/sync-state'
import { settingsPayload } from '../../src/presenters/settings'
import {
  bootstrapPayload,
  pullRequestBoardPayload,
  repositoriesPayload,
  reviewTaskBoardPayload,
  reviewTaskDetailPayload,
  syncStatusPayload,
} from '../../src/presenters/ui-payloads'
import { createTestContext, type TestContext } from '../support/context'
import {
  insertAgentLog,
  insertPullRequest,
  insertReviewComment,
  insertReviewIteration,
  insertReviewTask,
  insertSnapshot,
} from '../support/factories'
import { createGitRepository, createTempFolder } from '../support/git'

const repoOwner = 'acme'
const repoName = 'api'

// Valid against the schema, and the schema lists every key: Elysia strips
// response keys a contract doesn't declare, so a missing one would vanish.
function expectContract(schema: TSchema, payload: unknown) {
  const errors = [...Value.Errors(schema, payload)].map(({ path, message }) => `${path}: ${message}`)
  expect(errors).toEqual([])
  expect(Value.Clean(schema, structuredClone(payload))).toEqual(payload)
}

describe('UI payload contracts', () => {
  let ctx: TestContext
  let reposFolder: ReturnType<typeof createTempFolder>
  let reviewedTaskId: number

  beforeEach(async () => {
    ctx = createTestContext()
    reposFolder = createTempFolder()
    const repoPath = await createGitRepository(reposFolder.path, repoName, `${repoOwner}/${repoName}`)
    const settingStore = new SettingStore(ctx.db)
    settingStore.setReposFolder(reposFolder.path)
    settingStore.setCurrentRepo(repoPath)
    settingStore.setThemePreference('dark')
    settingStore.setGithubLogin('octocat')

    const findings = [{ title: 'Guard', severity: 'error', file: 'app/a.rb', lines: '3', comment: 'Fix **this**', suggested_fix: 'a&.b || c' }]
    const reviewOutput = `\`\`\`json\n${JSON.stringify(findings)}\n\`\`\`\n`
    const startedAt = secondsAgo(600)
    const completedAt = secondsAgo(500)

    const pullRequest = insertPullRequest(ctx.db, { repoOwner, repoName, updatedAtGithub: new Date(), createdAtGithub: new Date(), additions: 1 })
    const oldSnapshot = insertSnapshot(ctx.db, { pullRequestId: pullRequest.id, status: 'stale', aiSummaryStatus: 'current', aiSummaryGeneratedAt: new Date(), aiSummaryMainChanges: JSON.stringify(['x']) })
    insertSnapshot(ctx.db, { pullRequestId: pullRequest.id, status: 'current', aiSummaryStatus: 'failed', aiSummaryFailureReason: 'boom' })
    const reviewedTask = insertReviewTask(ctx.db, {
      pullRequestId: pullRequest.id,
      state: 'reviewed',
      reviewOutput,
      startedAt,
      completedAt,
      submittedAt: completedAt,
      submittedEvent: 'COMMENT',
      pullRequestSnapshotId: oldSnapshot.id,
      aiModel: 'opus',
    })
    reviewedTaskId = reviewedTask.id
    insertReviewComment(ctx.db, { reviewTaskId: reviewedTask.id, severity: 'critical', lineNumber: 4, title: 'Title' })
    insertReviewComment(ctx.db, { reviewTaskId: reviewedTask.id, severity: 'nitpick', status: 'dismissed', resolutionNote: 'meh' })
    insertReviewIteration(ctx.db, { reviewTaskId: reviewedTask.id, iterationNumber: 1, reviewOutput, startedAt, completedAt })
    insertReviewIteration(ctx.db, { reviewTaskId: reviewedTask.id, iterationNumber: 2 })
    insertAgentLog(ctx.db, { reviewTaskId: reviewedTask.id, logType: 'status' })

    const queuedPullRequest = insertPullRequest(ctx.db, { repoOwner, repoName })
    insertReviewTask(ctx.db, { pullRequestId: queuedPullRequest.id, state: 'queued', queuedAt: new Date(), reviewType: 'swarm' })
    insertPullRequest(ctx.db, { repoOwner, repoName, reviewStatus: 'reviewed_by_others', draft: true })
  })

  afterEach(() => reposFolder.remove())

  test('bootstrap', async () => {
    const response: Static<typeof BootstrapResponse> = ok(await bootstrapPayload(ctx))

    expectContract(BootstrapResponse, response)
  })

  test('pull request board', async () => {
    const response: Static<typeof PullRequestBoardResponse> = ok(await pullRequestBoardPayload(ctx))

    expect(response.columns.pending_review.length).toBeGreaterThan(0)
    expect(response.repositories.items.length).toBeGreaterThan(0)
    expectContract(PullRequestBoardResponse, response)
  })

  test('review task board', async () => {
    const response: Static<typeof ReviewTaskBoardResponse> = ok(await reviewTaskBoardPayload(ctx))

    expect(response.total_count).toBeGreaterThan(0)
    expectContract(ReviewTaskBoardResponse, response)
  })

  test('review task detail', async () => {
    const task = findReviewTask(ctx.db, reviewedTaskId)

    const response: Static<typeof ReviewTaskDetailResponse> = ok(await reviewTaskDetailPayload(ctx, task))

    expect(response.parsed_review_items.length).toBeGreaterThan(0)
    expect(response.review_history.length).toBeGreaterThan(0)
    expectContract(ReviewTaskDetailResponse, response)
  })

  test('repositories', async () => {
    const response: Static<typeof RepositoriesResponse> = ok(await repositoriesPayload(ctx))

    expectContract(RepositoriesResponse, response)
  })

  test('settings', async () => {
    const response: Static<typeof SettingsResponse> = ok(await settingsPayload(ctx))

    expectContract(SettingsResponse, response)
  })

  test('sync status, both the default and a stored sync state', async () => {
    const emptyContext = createTestContext()
    const defaultStatus: Static<typeof SyncStatus> = await syncStatusPayload(emptyContext)
    const repoPath = new SettingStore(ctx.db).currentRepo()
    const syncState = await syncStateForRepoPath(ctx.db, repoPath)
    if (!syncState) throw new Error('expected a sync state')
    updateSyncState(ctx.db, syncState, { status: 'failed', lastError: 'boom', lastStartedAt: new Date(), lastFinishedAt: new Date() })
    const storedStatus: Static<typeof SyncStatus> = await syncStatusPayload(ctx)

    expectContract(SyncStatus, defaultStatus)
    expectContract(SyncStatus, storedStatus)
  })
})
