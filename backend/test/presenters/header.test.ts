import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Db } from '../../src/db/client'
import { headerInReviewCount, headerPendingCount, headerRepoName } from '../../src/presenters/header'
import { createTestContext, type TestContext } from '../support/context'
import { insertPullRequest, insertReviewTask } from '../support/factories'
import { createGitRepository, createTempFolder } from '../support/git'

const noRepoSelected = 'No repository selected'

describe('headerRepoName', () => {
  test.each([null, ''])('reports no repository for %p', (currentRepo) => {
    expect(headerRepoName(currentRepo)).toBe(noRepoSelected)
  })

  test.each(['/path/to/repo', '/path/to/repo/', '/path/to/repo///'])('uses the directory name of %p', (currentRepo) => {
    const directoryName = 'repo'

    expect(headerRepoName(currentRepo)).toBe(directoryName)
  })

  test('keeps dots in the directory name', () => {
    const directoryName = 'my.repo'

    expect(headerRepoName(`/path/to/${directoryName}`)).toBe(directoryName)
  })
})

describe('header counts', () => {
  let ctx: TestContext
  let db: Db
  let tempFolder: ReturnType<typeof createTempFolder>

  beforeEach(() => {
    ctx = createTestContext()
    db = ctx.db
    tempFolder = createTempFolder()
  })

  afterEach(() => tempFolder.remove())

  function insertInReviewPullRequest(attributes: Parameters<typeof insertPullRequest>[1] = {}) {
    const pullRequest = insertPullRequest(db, { ...attributes, reviewStatus: 'in_review' })
    insertReviewTask(db, { pullRequestId: pullRequest.id, state: 'in_review' })
    return pullRequest
  }

  test('are zero without pull requests', async () => {
    const emptyCount = 0

    expect(await headerPendingCount(ctx, null)).toBe(emptyCount)
    expect(await headerInReviewCount(ctx, null)).toBe(emptyCount)
  })

  test('count pending and in-review pull requests across repos when none is selected', async () => {
    const pendingPullRequests = [insertPullRequest(db), insertPullRequest(db, { repoName: 'web' })]
    const inReviewPullRequests = [insertInReviewPullRequest(), insertInReviewPullRequest()]

    expect(await headerPendingCount(ctx, null)).toBe(pendingPullRequests.length)
    expect(await headerInReviewCount(ctx, null)).toBe(inReviewPullRequests.length)
  })

  test('reflect new pull requests immediately (no cache to invalidate)', async () => {
    const countBefore = await headerPendingCount(ctx, null)
    insertPullRequest(db)

    expect(await headerPendingCount(ctx, null)).toBe(countBefore + 1)
  })

  test('exclude soft-deleted, archived and inactive pull requests', async () => {
    const visible = [insertPullRequest(db)]
    insertPullRequest(db, { deletedAt: new Date() })
    insertPullRequest(db, { archived: true })
    insertPullRequest(db, { remoteState: 'merged', inactiveReason: 'merged' })

    expect(await headerPendingCount(ctx, null)).toBe(visible.length)
  })

  test('only count pull requests of the selected repo', async () => {
    const repoOwner = 'acme'
    const repoName = 'api'
    const repoPath = createGitRepository(ctx.commands, tempFolder.path, repoName, `${repoOwner}/${repoName}`)
    const ownPending = [insertPullRequest(db, { repoOwner, repoName })]
    const ownInReview = [insertInReviewPullRequest({ repoOwner, repoName })]
    insertPullRequest(db, { repoOwner, repoName: 'web' })
    insertInReviewPullRequest({ repoOwner: 'other', repoName })

    expect(await headerPendingCount(ctx, repoPath)).toBe(ownPending.length)
    expect(await headerInReviewCount(ctx, repoPath)).toBe(ownInReview.length)
  })

  test('are zero for a selected repo without a GitHub remote', async () => {
    const emptyCount = 0
    insertPullRequest(db)

    expect(await headerPendingCount(ctx, tempFolder.path)).toBe(emptyCount)
  })
})
