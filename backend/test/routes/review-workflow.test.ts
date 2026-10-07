import { beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { reviewComments, reviewIterations } from '../../src/db/schema'
import { findReviewTask, MAX_RETRY_ATTEMPTS, updateReviewTask } from '../../src/models/review-task'
import { SETTLED_REVIEWS_LIMIT } from '../../src/presenters/pull-request-index'
import type { ApiServices } from '../../src/routes/shared'
import { createTestApp } from '../support/app'
import { createTestContext, type TestContext } from '../support/context'
import { insertPullRequest, insertReviewComment, insertReviewTask, insertSnapshot } from '../support/factories'

// The redesigned frontend's workflow: one lifecycle per PR, review focus,
// re-runs that start clean, and submissions that send exactly what was included.

const origin = 'http://localhost'

type Json = Record<string, unknown>

function isJson(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function dig(value: unknown, ...path: Array<string | number>): unknown {
  let current = value
  for (const key of path) {
    if (Array.isArray(current) && typeof key === 'number') current = current[key]
    else if (isJson(current) && typeof key === 'string') current = current[key]
    else return undefined
  }
  return current
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

let ctx: TestContext
let services: Partial<ApiServices>

async function call(method: string, path: string, body?: unknown) {
  const app = createTestApp(ctx, services)
  const init: RequestInit = { method, headers: { 'content-type': 'application/json', host: 'localhost' } }
  if (body !== undefined) init.body = JSON.stringify(body)
  const response = await app.handle(new Request(`${origin}${path}`, init))
  const json: unknown = await response.json()
  return { status: response.status, json }
}

function commentsOf(taskId: number) {
  return ctx.db.select().from(reviewComments).where(eq(reviewComments.reviewTaskId, taskId)).all()
}

function iterationsOf(taskId: number) {
  return ctx.db.select().from(reviewIterations).where(eq(reviewIterations.reviewTaskId, taskId)).all()
}

function boardItem(board: unknown, pullRequestId: number) {
  const columns = dig(board, 'columns')
  const items = isJson(columns) ? Object.values(columns).flatMap(list) : []
  return items.find((item) => dig(item, 'id') === pullRequestId)
}

beforeEach(() => {
  ctx = createTestContext()
  services = {}
})

describe('starting a review', () => {
  test('stores the trimmed focus and clears it when a later run has none', async () => {
    const focus = 'check the migration is safe to run online'
    const pullRequest = insertPullRequest(ctx.db)

    const first = await call('POST', `/api/v1/pull_requests/${pullRequest.id}/review_task`, { focus: `  ${focus}  ` })
    const taskId = Number(dig(first.json, 'detail', 'task', 'id'))
    const firstFocus = findReviewTask(ctx.db, taskId).reviewFocus
    const job = ctx.jobs.claimNext()
    if (!job) throw new Error('Expected the first review job')
    ctx.jobs.finish(job)
    updateReviewTask(ctx, findReviewTask(ctx.db, taskId), { state: 'reviewed' })
    const second = await call('POST', `/api/v1/pull_requests/${pullRequest.id}/review_task`, { focus: '   ' })

    expect(first.status).toBe(201)
    expect(dig(first.json, 'detail', 'task', 'review_focus')).toBe(focus)
    expect(firstFocus).toBe(focus)
    expect(second.status).toBe(201)
    expect(findReviewTask(ctx.db, taskId).reviewFocus).toBeNull()
  })

  test('rejects a duplicate start while the same review job is waiting', async () => {
    const focus = 'check migrations'
    const pullRequest = insertPullRequest(ctx.db)
    const first = await call('POST', `/api/v1/pull_requests/${pullRequest.id}/review_task`, { focus })
    const taskId = Number(dig(first.json, 'detail', 'task', 'id'))
    const originalJobs = ctx.jobs.unfinished('ReviewTaskJob')

    const duplicate = await call('POST', `/api/v1/pull_requests/${pullRequest.id}/review_task`, { cli_client: 'codex', focus: 'replace the focus' })

    expect(duplicate.status).toBe(409)
    expect(dig(duplicate.json, 'error', 'code')).toBe('conflict')
    expect(findReviewTask(ctx.db, taskId)).toMatchObject({ state: 'pending_review', reviewFocus: focus })
    expect(ctx.jobs.unfinished('ReviewTaskJob')).toEqual(originalJobs)
  })

  test('rejects a duplicate start while the same task is queued', async () => {
    insertReviewTask(ctx.db, { pullRequestId: insertPullRequest(ctx.db).id, state: 'in_review' })
    const focus = 'check migrations'
    const pullRequest = insertPullRequest(ctx.db)
    const first = await call('POST', `/api/v1/pull_requests/${pullRequest.id}/review_task`, { focus })
    const taskId = Number(dig(first.json, 'detail', 'task', 'id'))
    const originalTask = findReviewTask(ctx.db, taskId)

    const duplicate = await call('POST', `/api/v1/pull_requests/${pullRequest.id}/review_task`, { focus: 'replace the focus' })

    expect(duplicate.status).toBe(409)
    expect(findReviewTask(ctx.db, taskId)).toEqual(originalTask)
    expect(ctx.jobs.unfinished('ReviewTaskJob')).toEqual([])
  })

  test('allows a pending task to start when it has no waiting job', async () => {
    const pullRequest = insertPullRequest(ctx.db)
    const task = insertReviewTask(ctx.db, { pullRequestId: pullRequest.id, state: 'pending_review' })

    const { status } = await call('POST', `/api/v1/pull_requests/${pullRequest.id}/review_task`)

    expect(status).toBe(201)
    expect(ctx.jobs.unfinished('ReviewTaskJob').map((job) => job.payload)).toEqual([{ reviewTaskId: task.id, isRetry: false }])
  })

  test('a re-review moves the previous findings into history and starts with a fresh retry budget', async () => {
    const previousOutput = 'Earlier findings'
    const pullRequest = insertPullRequest(ctx.db)
    const task = insertReviewTask(ctx.db, { pullRequestId: pullRequest.id, state: 'reviewed', reviewOutput: previousOutput, retryCount: MAX_RETRY_ATTEMPTS })
    insertReviewComment(ctx.db, { reviewTaskId: task.id, severity: 'critical' })

    const { status } = await call('POST', `/api/v1/pull_requests/${pullRequest.id}/review_task`)

    expect(status).toBe(201)
    expect(commentsOf(task.id)).toEqual([])
    expect(iterationsOf(task.id).map((iteration) => iteration.reviewOutput)).toEqual([previousOutput])
    expect(findReviewTask(ctx.db, task.id)).toMatchObject({ reviewOutput: null, retryCount: 0, state: 'pending_review' })
  })

  test('a rejected re-review keeps the previous findings and enqueues nothing', async () => {
    const previousOutput = 'Earlier findings'
    const pullRequest = insertPullRequest(ctx.db)
    const task = insertReviewTask(ctx.db, { pullRequestId: pullRequest.id, state: 'reviewed', reviewOutput: previousOutput })
    const comment = insertReviewComment(ctx.db, { reviewTaskId: task.id, severity: 'major' })

    const { status } = await call('POST', `/api/v1/pull_requests/${pullRequest.id}/review_task`, { cli_client: 'not-a-client' })

    expect(status).toBe(422)
    expect(commentsOf(task.id).map((kept) => kept.id)).toEqual([comment.id])
    expect(iterationsOf(task.id)).toEqual([])
    expect(findReviewTask(ctx.db, task.id).reviewOutput).toBe(previousOutput)
    expect(ctx.jobs.unfinished('ReviewTaskJob')).toEqual([])
  })

  test('re-reviewing an archived task brings it back', async () => {
    const pullRequest = insertPullRequest(ctx.db)
    const task = insertReviewTask(ctx.db, { pullRequestId: pullRequest.id, state: 'reviewed', archived: true })

    await call('POST', `/api/v1/pull_requests/${pullRequest.id}/review_task`)

    expect(findReviewTask(ctx.db, task.id).archived).toBe(false)
  })

  test('a failed review can be started again right after its last automatic retry', async () => {
    const pullRequest = insertPullRequest(ctx.db)
    insertReviewTask(ctx.db, { pullRequestId: pullRequest.id, state: 'failed_review', lastRetryAt: new Date(), retryCount: MAX_RETRY_ATTEMPTS })

    const { status } = await call('POST', `/api/v1/pull_requests/${pullRequest.id}/review_task`)

    expect(status).toBe(201)
  })

  test('a second start waits behind a review job that has not started yet', async () => {
    const first = insertPullRequest(ctx.db)
    const second = insertPullRequest(ctx.db)

    await call('POST', `/api/v1/pull_requests/${first.id}/review_task`)
    const queued = await call('POST', `/api/v1/pull_requests/${second.id}/review_task`)

    expect(dig(queued.json, 'detail', 'task', 'state')).toBe('queued')
    expect(ctx.jobs.unfinished('ReviewTaskJob')).toHaveLength(1)
  })
})

describe('submitting a review', () => {
  test('an explicit empty approval can include a summary without sending findings', async () => {
    const summary = 'Checked the changes; ready to merge.'
    const task = insertReviewTask(ctx.db, { pullRequestId: insertPullRequest(ctx.db).id, state: 'reviewed' })
    const pending = insertReviewComment(ctx.db, { reviewTaskId: task.id, severity: 'major' })
    const submitted: Array<{ event: string; summary: string | null; commentIds: number[] }> = []
    services.submitReview = async (_ctx, _task, options) => {
      submitted.push({ event: options.event, summary: options.summary, commentIds: options.comments.map((comment) => comment.id) })
      return {}
    }

    const { status } = await call('POST', `/api/v1/review_tasks/${task.id}/submissions`, { event: 'APPROVE', summary, comment_ids: [], force_empty_submission: true })

    expect(status).toBe(200)
    expect(submitted).toEqual([{ event: 'APPROVE', summary, commentIds: [] }])
    expect(findReviewTask(ctx.db, task.id)).toMatchObject({ state: 'done', submissionStatus: 'submitted', submittedEvent: 'APPROVE' })
    expect(commentsOf(task.id).map((comment) => [comment.id, comment.status])).toEqual([[pending.id, 'pending']])
  })

  test('an explicitly empty selection submits nothing, even with a summary', async () => {
    const task = insertReviewTask(ctx.db, { pullRequestId: insertPullRequest(ctx.db).id, state: 'reviewed' })
    const pending = insertReviewComment(ctx.db, { reviewTaskId: task.id, severity: 'major' })
    const submitted: number[][] = []
    services.submitReview = async (_ctx, _task, options) => {
      submitted.push(options.comments.map((comment) => comment.id))
      return {}
    }

    const { status } = await call('POST', `/api/v1/review_tasks/${task.id}/submissions`, { event: 'COMMENT', summary: 'Looks fine', comment_ids: [] })

    expect(status).toBe(422)
    expect(submitted).toEqual([])
    expect(commentsOf(task.id).map((comment) => [comment.id, comment.status])).toEqual([[pending.id, 'pending']])
  })

  test('only the selected comments are sent', async () => {
    const task = insertReviewTask(ctx.db, { pullRequestId: insertPullRequest(ctx.db).id, state: 'reviewed' })
    const included = insertReviewComment(ctx.db, { reviewTaskId: task.id, severity: 'major' })
    const excluded = insertReviewComment(ctx.db, { reviewTaskId: task.id, severity: 'minor' })
    const submitted: number[][] = []
    services.submitReview = async (_ctx, _task, options) => {
      submitted.push(options.comments.map((comment) => comment.id))
      return {}
    }

    await call('POST', `/api/v1/review_tasks/${task.id}/submissions`, { event: 'COMMENT', comment_ids: [included.id] })

    expect(submitted).toEqual([[included.id]])
    expect(commentsOf(task.id).find((comment) => comment.id === excluded.id)?.status).toBe('pending')
  })
})

describe('review comment status', () => {
  test('accepts an explicit status to dismiss and restore a finding', async () => {
    const dismissed = 'dismissed'
    const pending = 'pending'
    const task = insertReviewTask(ctx.db, { pullRequestId: insertPullRequest(ctx.db).id, state: 'reviewed' })
    const comment = insertReviewComment(ctx.db, { reviewTaskId: task.id })

    const dismiss = await call('PATCH', `/api/v1/review_comments/${comment.id}/toggle`, { status: dismissed })
    const restore = await call('PATCH', `/api/v1/review_comments/${comment.id}/toggle`, { status: pending })

    expect(dig(dismiss.json, 'detail', 'comments', 0, 'status')).toBe(dismissed)
    expect(dig(restore.json, 'detail', 'comments', 0, 'status')).toBe(pending)
  })

  test('rejects unknown statuses', async () => {
    const task = insertReviewTask(ctx.db, { pullRequestId: insertPullRequest(ctx.db).id, state: 'reviewed' })
    const comment = insertReviewComment(ctx.db, { reviewTaskId: task.id })

    const { status } = await call('PATCH', `/api/v1/review_comments/${comment.id}/toggle`, { status: 'bogus' })

    expect(status).toBe(422)
    expect(commentsOf(task.id)[0]?.status).toBe(comment.status)
  })
})

describe('payloads for the redesigned frontend', () => {
  test('the board carries each pull request lifecycle, new-commit flag and task details', async () => {
    const focus = 'retries'
    const open = insertPullRequest(ctx.db)
    const ready = insertPullRequest(ctx.db, { reviewStatus: 'reviewed_by_me' })
    const reviewSnapshot = insertSnapshot(ctx.db, { pullRequestId: ready.id, status: 'stale' })
    insertSnapshot(ctx.db, { pullRequestId: ready.id, status: 'current' })
    const task = insertReviewTask(ctx.db, { pullRequestId: ready.id, state: 'reviewed', reviewFocus: focus, pullRequestSnapshotId: reviewSnapshot.id })
    insertReviewComment(ctx.db, { reviewTaskId: task.id })
    insertReviewComment(ctx.db, { reviewTaskId: task.id, status: 'addressed' })

    const board = await call('GET', '/api/v1/pull_requests/board')

    expect(dig(boardItem(board.json, open.id), 'lifecycle')).toBe('needs_review')
    expect(dig(boardItem(board.json, ready.id), 'lifecycle')).toBe('ready')
    expect(dig(boardItem(board.json, ready.id), 'has_new_commits')).toBe(true)
    expect(dig(boardItem(board.json, ready.id), 'review_task', 'review_focus')).toBe(focus)
    expect(dig(boardItem(board.json, ready.id), 'review_task', 'pending_comment_count')).toBe(1)
  })

  test('merged pull requests that were reviewed are listed as settled reviews', async () => {
    const merged = insertPullRequest(ctx.db, { remoteState: 'merged', inactiveReason: 'merged' })
    insertReviewTask(ctx.db, { pullRequestId: merged.id, state: 'reviewed' })
    insertPullRequest(ctx.db, { remoteState: 'merged', inactiveReason: 'merged' })

    const board = await call('GET', '/api/v1/pull_requests/board')

    expect(list(dig(board.json, 'settled_reviews')).map((item) => [dig(item, 'id'), dig(item, 'lifecycle')])).toEqual([[merged.id, 'settled']])
  })

  test('reviews still running on closed pull requests are listed beyond the settled history limit', async () => {
    const running = insertPullRequest(ctx.db, { remoteState: 'closed', inactiveReason: 'closed', updatedAtGithub: new Date('2020-01-01T00:00:00Z') })
    insertReviewTask(ctx.db, { pullRequestId: running.id, state: 'in_review' })
    for (let index = 0; index < SETTLED_REVIEWS_LIMIT; index += 1) {
      const finished = insertPullRequest(ctx.db, { remoteState: 'merged', inactiveReason: 'merged', updatedAtGithub: new Date() })
      insertReviewTask(ctx.db, { pullRequestId: finished.id, state: 'done' })
    }

    const board = await call('GET', '/api/v1/pull_requests/board')
    const settled = list(dig(board.json, 'settled_reviews'))

    expect(settled).toHaveLength(SETTLED_REVIEWS_LIMIT + 1)
    expect(dig(settled.find((item) => dig(item, 'id') === running.id), 'lifecycle')).toBe('reviewing')
  })

  test('the task detail includes the full pull request, even when it is not on the board', async () => {
    const merged = insertPullRequest(ctx.db, { remoteState: 'merged', inactiveReason: 'merged', deletedAt: new Date() })
    const task = insertReviewTask(ctx.db, { pullRequestId: merged.id, state: 'reviewed' })

    const detail = await call('GET', `/api/v1/review_tasks/${task.id}`)

    expect(detail.status).toBe(200)
    expect(dig(detail.json, 'pull_request', 'id')).toBe(merged.id)
    expect(dig(detail.json, 'pull_request', 'lifecycle')).toBe('settled')
  })

  test('a pending task reads as reviewing only while its job is waiting', async () => {
    const pullRequest = insertPullRequest(ctx.db)
    const task = insertReviewTask(ctx.db, { pullRequestId: pullRequest.id, state: 'pending_review' })

    const withoutJob = await call('GET', '/api/v1/pull_requests/board')
    ctx.jobs.enqueue('ReviewTaskJob', { reviewTaskId: task.id, isRetry: false })
    const withJob = await call('GET', '/api/v1/pull_requests/board')

    expect(dig(boardItem(withoutJob.json, pullRequest.id), 'lifecycle')).toBe('needs_review')
    expect(dig(boardItem(withJob.json, pullRequest.id), 'lifecycle')).toBe('reviewing')
  })
})
