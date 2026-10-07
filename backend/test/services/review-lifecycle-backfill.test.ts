import { beforeEach, describe, expect, test } from 'bun:test'
import { findPullRequest } from '../../src/models/pull-request'
import { currentIterationNumber, findReviewTask } from '../../src/models/review-task'
import type { PullRequestRef } from '../../src/services/github-cli-client'
import { GithubCliError } from '../../src/services/github-cli-client'
import {
  runReviewLifecycleBackfill,
  type BackfillGithubClient,
  type OutputWriter,
} from '../../src/services/review-lifecycle-backfill'
import { createTestContext, type TestContext } from '../support/context'
import { insertPullRequest, insertReviewComment, insertReviewTask } from '../support/factories'

class FakeGithub implements BackfillGithubClient {
  readonly lookups: number[] = []

  constructor(
    private readonly requested: Map<number, boolean>,
    private readonly latest: Map<number, string | null>,
    private readonly failing = new Set<number>(),
  ) {}

  async reviewRequestedForMe(pullRequest: PullRequestRef) {
    const number = pullRequest.number ?? 0
    this.lookups.push(number)
    if (this.failing.has(number)) throw new GithubCliError('GitHub CLI error: boom')
    return this.requested.get(number) ?? false
  }

  async latestMyReviewState(pullRequest: PullRequestRef) {
    return this.latest.get(pullRequest.number ?? 0) ?? null
  }
}

class RecordingOutput implements OutputWriter {
  readonly lines: string[] = []

  puts(line: string) {
    this.lines.push(line)
  }

  get text() {
    return this.lines.join('\n')
  }
}

let ctx: TestContext

beforeEach(() => {
  ctx = createTestContext()
})

function createSubmittedReview(number: number, options: { withOutput?: boolean } = {}) {
  const pullRequest = insertPullRequest(ctx.db, {
    githubId: number,
    number,
    title: `PR ${number}`,
    repoOwner: 'test',
    repoName: 'repo',
    reviewStatus: 'reviewed_by_me',
  })
  const task = insertReviewTask(ctx.db, {
    pullRequestId: pullRequest.id,
    state: 'reviewed',
    submissionStatus: 'submitted',
    submittedAt: new Date(),
    reviewOutput: options.withOutput ? 'prior output' : null,
  })
  if (options.withOutput) {
    insertReviewComment(ctx.db, { reviewTaskId: task.id, body: 'Prior comment', filePath: 'app/services/foo.rb', severity: 'major' })
  }
  return { pullRequest, task }
}

function github(number: number, options: { requested?: boolean; latest?: string | null; failing?: boolean }) {
  return new FakeGithub(
    new Map([[number, options.requested ?? false]]),
    new Map([[number, options.latest ?? null]]),
    new Set(options.failing ? [number] : []),
  )
}

describe('runReviewLifecycleBackfill', () => {
  test('dry-run plans the waiting transition without persisting', async () => {
    const number = 401
    const { pullRequest, task } = createSubmittedReview(number)
    const output = new RecordingOutput()

    const result = await runReviewLifecycleBackfill(ctx, github(number, { latest: 'CHANGES_REQUESTED' }), output, { apply: false })

    expect(result).toEqual({ processed: 1, updated: 0, skipped: 0, failed: 0, mode: 'dry-run' })
    expect(findReviewTask(ctx.db, task.id).state).toBe(task.state)
    expect(findPullRequest(ctx.db, pullRequest.id).reviewStatus).toBe(pullRequest.reviewStatus)
    expect(output.text).toContain(`#${number} plan: move_to_waiting (latest review state CHANGES_REQUESTED)`)
  })

  test('apply moves a changes-requested review to waiting_implementation', async () => {
    const number = 402
    const { pullRequest, task } = createSubmittedReview(number)

    const result = await runReviewLifecycleBackfill(ctx, github(number, { latest: 'CHANGES_REQUESTED' }), new RecordingOutput(), {
      apply: true,
    })

    const reloadedTask = findReviewTask(ctx.db, task.id)
    expect(result.updated).toBe(1)
    expect(reloadedTask.state).toBe('waiting_implementation')
    expect(reloadedTask.submittedEvent).toBe('REQUEST_CHANGES')
    expect(findPullRequest(ctx.db, pullRequest.id).reviewStatus).toBe('waiting_implementation')
  })

  test('apply resets to pending when the review is requested again', async () => {
    const number = 403
    const { pullRequest, task } = createSubmittedReview(number, { withOutput: true })

    const result = await runReviewLifecycleBackfill(
      ctx,
      github(number, { requested: true, latest: 'CHANGES_REQUESTED' }),
      new RecordingOutput(),
      { apply: true },
    )

    const reloadedTask = findReviewTask(ctx.db, task.id)
    expect(result.updated).toBe(1)
    expect(reloadedTask.state).toBe('pending_review')
    expect(reloadedTask.submissionStatus).toBe('pending_submission')
    expect(reloadedTask.submittedAt).toBeNull()
    expect(reloadedTask.submittedEvent).toBeNull()
    expect(currentIterationNumber(ctx.db, task)).toBe(1)
    expect(findPullRequest(ctx.db, pullRequest.id).reviewStatus).toBe('pending_review')
  })

  test('apply normalizes the submitted event for approvals', async () => {
    const number = 404
    const { pullRequest, task } = createSubmittedReview(number)

    await runReviewLifecycleBackfill(ctx, github(number, { latest: 'APPROVED' }), new RecordingOutput(), { apply: true })

    const reloadedTask = findReviewTask(ctx.db, task.id)
    expect(reloadedTask.state).toBe('reviewed')
    expect(reloadedTask.submittedEvent).toBe('APPROVE')
    expect(findPullRequest(ctx.db, pullRequest.id).reviewStatus).toBe('reviewed_by_me')
  })

  test.each([null, 'DISMISSED'])('skips when the latest review state is %p', async (latest) => {
    const number = 405
    createSubmittedReview(number)
    const output = new RecordingOutput()

    const result = await runReviewLifecycleBackfill(ctx, github(number, { latest }), output, { apply: true })

    expect(result).toMatchObject({ processed: 1, skipped: 1, updated: 0 })
    expect(output.text).toContain(`#${number} skip: noop (no mappable latest review state (${latest ?? 'none'}))`)
  })

  test('skips when the GitHub lookup fails', async () => {
    const number = 406
    createSubmittedReview(number)
    const output = new RecordingOutput()

    const result = await runReviewLifecycleBackfill(ctx, github(number, { failing: true }), output, { apply: true })

    expect(result.skipped).toBe(1)
    expect(output.text).toContain(`#${number} skip: noop (github lookup failed: ${GithubCliError.name})`)
  })

  test('counts a failed update, logs it, and rolls the task change back', async () => {
    const number = 407
    // A raw duplicate github_id makes the PR's `update!` validation fail.
    insertPullRequest(ctx.db, { githubId: number })
    const { task } = createSubmittedReview(number)
    const output = new RecordingOutput()

    const result = await runReviewLifecycleBackfill(ctx, github(number, { latest: 'CHANGES_REQUESTED' }), output, { apply: true })

    expect(result).toMatchObject({ processed: 1, updated: 0, failed: 1 })
    expect(output.lines).toContain(`ERROR #${number}: RecordInvalidError Validation failed: Github has already been taken`)
    expect(findReviewTask(ctx.db, task.id).state).toBe(task.state)
    expect(ctx.events.messages).toHaveLength(0)
  })

  test('only considers active reviewed_by_me PRs with a submitted, reviewed task', async () => {
    const eligible = createSubmittedReview(410)
    const notSubmitted = insertPullRequest(ctx.db, { reviewStatus: 'reviewed_by_me' })
    insertReviewTask(ctx.db, { pullRequestId: notSubmitted.id, state: 'reviewed', submissionStatus: 'pending_submission' })
    const archived = insertPullRequest(ctx.db, { reviewStatus: 'reviewed_by_me', archived: true })
    insertReviewTask(ctx.db, { pullRequestId: archived.id, state: 'reviewed', submissionStatus: 'submitted' })
    const closed = insertPullRequest(ctx.db, { reviewStatus: 'reviewed_by_me', remoteState: 'closed' })
    insertReviewTask(ctx.db, { pullRequestId: closed.id, state: 'reviewed', submissionStatus: 'submitted' })
    const fake = github(eligible.pullRequest.number ?? 0, { latest: 'COMMENTED' })

    const result = await runReviewLifecycleBackfill(ctx, fake, new RecordingOutput())

    expect(result.processed).toBe(1)
    expect(fake.lookups).toEqual([eligible.pullRequest.number ?? 0])
  })

  test('limit keeps the lowest ids, as Rails find_each does', async () => {
    const numbers = [420, 421, 422]
    for (const number of numbers) createSubmittedReview(number)
    const limit = 2
    const fake = new FakeGithub(new Map(), new Map())
    const output = new RecordingOutput()

    const result = await runReviewLifecycleBackfill(ctx, fake, output, { limit })

    expect(result.processed).toBe(limit)
    expect(fake.lookups).toEqual(numbers.slice(0, limit))
    expect(output.lines[0]).toBe(`Backfill dry-run mode. candidates=${limit}`)
  })

  test('prints a JSON summary line', async () => {
    const output = new RecordingOutput()

    const result = await runReviewLifecycleBackfill(ctx, new FakeGithub(new Map(), new Map()), output, { apply: true })

    expect(output.lines).toEqual(['Backfill apply mode. candidates=0', `Summary: ${JSON.stringify(result)}`])
  })
})
