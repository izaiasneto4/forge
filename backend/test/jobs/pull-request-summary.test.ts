import { beforeEach, describe, expect, test } from 'bun:test'
import { pullRequestSummaryJob } from '../../src/jobs/handlers/pull-request-summary'
import { findSnapshot, type PullRequestSnapshotRecord } from '../../src/models/pull-request-snapshot'
import { createTestContext, type TestContext } from '../support/context'
import { insertPullRequest, insertSnapshot } from '../support/factories'

let ctx: TestContext
let snapshot: PullRequestSnapshotRecord

beforeEach(() => {
  ctx = createTestContext()
  const pullRequest = insertPullRequest(ctx.db)
  snapshot = insertSnapshot(ctx.db, { pullRequestId: pullRequest.id, aiSummaryStatus: 'pending' })
})

describe('pullRequestSummaryJob', () => {
  test('generates the summary for the snapshot', async () => {
    const mainChanges = ['Adds caching']
    ctx.commands.on(['gh', 'pr', 'diff'], { stdout: '+x\n' })
    ctx.commands.on(['claude', '-p'], { stdout: JSON.stringify({ main_changes: mainChanges }) })

    await pullRequestSummaryJob(ctx, { snapshotId: snapshot.id })

    expect(findSnapshot(ctx.db, snapshot.id).aiSummaryStatus).toBe('current')
  })

  test('is a no-op when the snapshot no longer exists', async () => {
    const missingSnapshotId = snapshot.id + 1000

    await pullRequestSummaryJob(ctx, { snapshotId: missingSnapshotId })

    expect(ctx.commands.calls).toHaveLength(0)
  })

  test('re-raises generation failures after marking the snapshot failed', async () => {
    const stderr = 'gh exploded'
    ctx.commands.on(['gh', 'pr', 'diff'], { success: false, stderr })

    await expect(pullRequestSummaryJob(ctx, { snapshotId: snapshot.id })).rejects.toThrow(stderr)

    expect(findSnapshot(ctx.db, snapshot.id).aiSummaryStatus).toBe('failed')
  })
})
