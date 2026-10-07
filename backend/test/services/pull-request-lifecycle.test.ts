import { beforeEach, describe, expect, test } from 'bun:test'
import type { PullRequestRecord } from '../../src/models/pull-request'
import type { ReviewTaskRecord } from '../../src/models/review-task'
import { hasNewCommits, pullRequestLifecycle, type Lifecycle, type LifecycleInputs } from '../../src/services/pull-request-lifecycle'
import { createTestContext, type TestContext } from '../support/context'
import { insertPullRequest, insertReviewTask } from '../support/factories'

const githubLogin = 'izaias'

let ctx: TestContext

function inputs(pullRequest: PullRequestRecord, overrides: Partial<LifecycleInputs> = {}): LifecycleInputs {
  return { pullRequest, task: undefined, githubLogin, analysisStale: false, reviewJobPending: false, ...overrides }
}

function withTask(attributes: Partial<ReviewTaskRecord>, overrides: Partial<LifecycleInputs> = {}) {
  const pullRequest = insertPullRequest(ctx.db, { author: 'someone-else' })
  const task = insertReviewTask(ctx.db, { pullRequestId: pullRequest.id, ...attributes })
  return inputs(pullRequest, { task, ...overrides })
}

beforeEach(() => {
  ctx = createTestContext()
})

describe('pullRequestLifecycle without a review task', () => {
  test('inactive pull requests are settled', () => {
    const expected = 'settled'
    const merged = insertPullRequest(ctx.db, { remoteState: 'merged', inactiveReason: 'merged' })
    const deleted = insertPullRequest(ctx.db, { deletedAt: new Date() })

    expect(pullRequestLifecycle(inputs(merged))).toBe(expected)
    expect(pullRequestLifecycle(inputs(deleted))).toBe(expected)
  })

  test('your own pull requests are authored, case-insensitively', () => {
    const expected = 'authored'
    const own = insertPullRequest(ctx.db, { author: githubLogin.toUpperCase() })

    expect(pullRequestLifecycle(inputs(own))).toBe(expected)
  })

  test('authorship is ignored without a GitHub login', () => {
    const expected = 'needs_review'
    const own = insertPullRequest(ctx.db, { author: githubLogin })

    expect(pullRequestLifecycle(inputs(own, { githubLogin: null }))).toBe(expected)
  })

  test('pull requests already reviewed on GitHub are settled, others need review', () => {
    const reviewedOnGithub = insertPullRequest(ctx.db, { author: 'someone-else', reviewStatus: 'reviewed_by_me' })
    const open = insertPullRequest(ctx.db, { author: 'someone-else' })

    expect(pullRequestLifecycle(inputs(reviewedOnGithub))).toBe('settled')
    expect(pullRequestLifecycle(inputs(open))).toBe('needs_review')
  })
})

describe('pullRequestLifecycle with a review task', () => {
  test('task states map onto the lifecycle', () => {
    const expectations: Array<{ state: string; lifecycle: Lifecycle }> = [
      { state: 'queued', lifecycle: 'queued' },
      { state: 'in_review', lifecycle: 'reviewing' },
      { state: 'failed_review', lifecycle: 'failed' },
      { state: 'waiting_implementation', lifecycle: 'waiting' },
      { state: 'done', lifecycle: 'settled' },
    ]

    for (const { state, lifecycle } of expectations) {
      expect(pullRequestLifecycle(withTask({ state }))).toBe(lifecycle)
    }
  })

  test('a pending task is reviewing only while its job is waiting or running', () => {
    const pending = { state: 'pending_review' }

    expect(pullRequestLifecycle(withTask(pending, { reviewJobPending: true }))).toBe('reviewing')
    expect(pullRequestLifecycle(withTask(pending, { reviewJobPending: false }))).toBe('needs_review')
  })

  test('archived tasks are settled', () => {
    const expected = 'settled'

    expect(pullRequestLifecycle(withTask({ state: 'reviewed', archived: true }))).toBe(expected)
  })

  test('reviewed tasks are ready until submitted', () => {
    const reviewed = { state: 'reviewed' }

    expect(pullRequestLifecycle(withTask(reviewed))).toBe('ready')
    expect(pullRequestLifecycle(withTask({ ...reviewed, submissionStatus: 'submitted' }))).toBe('settled')
  })

  test('new commits after a submitted or approved review send the pull request back to needs review', () => {
    const expected = 'needs_review'
    const submitted = withTask({ state: 'reviewed', submissionStatus: 'submitted' }, { analysisStale: true })
    const approved = withTask({ state: 'done' }, { analysisStale: true })

    expect(pullRequestLifecycle(submitted)).toBe(expected)
    expect(pullRequestLifecycle(approved)).toBe(expected)
    expect(hasNewCommits(submitted)).toBe(true)
  })

  test('new commits only count when there is a review to compare against', () => {
    const pullRequest = insertPullRequest(ctx.db)

    expect(hasNewCommits(inputs(pullRequest, { analysisStale: true }))).toBe(false)
  })
})
