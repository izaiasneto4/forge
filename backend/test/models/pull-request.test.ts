import { describe, expect, test } from 'bun:test'
import { RecordInvalidError } from '../../src/lib/errors'
import {
  analysisStatus,
  classifyReviewStatus,
  createPullRequest,
  findPullRequest,
  fixStateMismatches,
  snapshotStatus,
  updatePullRequest,
  updatePullRequestColumns,
} from '../../src/models/pull-request'
import { STREAMS } from '../../src/realtime/broadcaster'
import { withSyncMode } from '../../src/services/sync-mode'
import { createTestContext } from '../support/context'
import { insertPullRequest, insertReviewTask, insertSnapshot } from '../support/factories'

describe('PullRequest model', () => {
  test('broadcasts review status changes with the previous status', () => {
    const ctx = createTestContext()
    const previousStatus = 'pending_review'
    const nextStatus = 'reviewed_by_others'
    const pullRequest = insertPullRequest(ctx.db, { reviewStatus: previousStatus })

    updatePullRequest(ctx, pullRequest, { reviewStatus: nextStatus })

    expect(ctx.events.on(STREAMS.uiEvents)).toEqual([
      expect.objectContaining({
        event: 'pull_request.updated',
        pull_request_id: pullRequest.id,
        review_status: nextStatus,
        previous_status: previousStatus,
        repo: `${pullRequest.repoOwner}/${pullRequest.repoName}`,
      }),
    ])
  })

  test('does not broadcast other changes, raw column writes, or no-op updates', () => {
    const ctx = createTestContext()
    const pullRequest = insertPullRequest(ctx.db)

    updatePullRequest(ctx, pullRequest, { title: 'Renamed' })
    updatePullRequest(ctx, pullRequest, { reviewStatus: pullRequest.reviewStatus })
    updatePullRequestColumns(ctx.db, pullRequest.id, { reviewStatus: 'reviewed_by_others' })

    expect(ctx.events.messages).toEqual([])
  })

  test('refuses review statuses that need a review task, except during sync', () => {
    const ctx = createTestContext()
    const statusRequiringTask = 'in_review'
    const pullRequest = insertPullRequest(ctx.db)

    expect(() => updatePullRequest(ctx, pullRequest, { reviewStatus: statusRequiringTask })).toThrow(RecordInvalidError)
    const synced = withSyncMode(() => updatePullRequest(ctx, pullRequest, { reviewStatus: statusRequiringTask }))

    expect(synced.reviewStatus).toBe(statusRequiringTask)
  })

  test('creates with validation and announces the new pull request', () => {
    const ctx = createTestContext()
    const values = { githubId: 501, number: 501, title: 'Add cache', url: 'https://github.com/acme/api/pull/501', repoOwner: 'acme', repoName: 'api', reviewStatus: 'pending_review' }

    const created = createPullRequest(ctx, values)

    expect(ctx.events.on(STREAMS.uiEvents)).toEqual([expect.objectContaining({ pull_request_id: created.id, previous_status: null })])
    expect(() => createPullRequest(ctx, values)).toThrow('Github has already been taken')
  })

  test('hides archived pull requests from the default scope', () => {
    const ctx = createTestContext()
    const archived = insertPullRequest(ctx.db, { archived: true })

    expect(() => findPullRequest(ctx.db, archived.id)).toThrow()
  })

  test('derives analysis and snapshot status from the review task and snapshots', () => {
    const ctx = createTestContext()
    const pullRequest = insertPullRequest(ctx.db)
    const oldSnapshot = insertSnapshot(ctx.db, { pullRequestId: pullRequest.id, status: 'stale' })
    insertSnapshot(ctx.db, { pullRequestId: pullRequest.id })
    insertReviewTask(ctx.db, { pullRequestId: pullRequest.id, state: 'reviewed', reviewOutput: 'LGTM', pullRequestSnapshotId: oldSnapshot.id })

    expect(analysisStatus(ctx.db, pullRequest)).toBe('stale')
    expect(snapshotStatus(ctx.db, pullRequest)).toBe('stale')
  })

  test('classifies review status from the task, request flag and latest review', () => {
    const ctx = createTestContext()
    const requested = insertPullRequest(ctx.db, { reviewRequestedForMe: true })
    const reviewedByMe = insertPullRequest(ctx.db, { latestReviewState: 'APPROVED' })
    const withFailedTask = insertPullRequest(ctx.db)
    insertReviewTask(ctx.db, { pullRequestId: withFailedTask.id, state: 'failed_review' })

    expect(classifyReviewStatus(ctx.db, requested)).toBe('pending_review')
    expect(classifyReviewStatus(ctx.db, reviewedByMe)).toBe('reviewed_by_me')
    expect(classifyReviewStatus(ctx.db, withFailedTask)).toBe('review_failed')
  })

  test('repairs review statuses that drifted from their task state', () => {
    const ctx = createTestContext()
    const pullRequest = insertPullRequest(ctx.db, { reviewStatus: 'in_review' })
    insertReviewTask(ctx.db, { pullRequestId: pullRequest.id, state: 'waiting_implementation' })

    const fixedCount = fixStateMismatches(ctx.db)

    expect(fixedCount).toBe(1)
    expect(findPullRequest(ctx.db, pullRequest.id).reviewStatus).toBe('waiting_implementation')
  })
})

describe('PullRequest uniqueness', () => {
  test('rejects a duplicate even when the record itself matches first', () => {
    const ctx = createTestContext()
    const original = insertPullRequest(ctx.db)
    const duplicate = insertPullRequest(ctx.db, { githubId: original.githubId, number: (original.number ?? 0) + 1000 })

    expect(() => updatePullRequest(ctx, original, { title: 'Renamed' })).toThrow('Github has already been taken')
    expect(() => updatePullRequest(ctx, duplicate, { title: 'Renamed too' })).toThrow('Github has already been taken')
  })
})
