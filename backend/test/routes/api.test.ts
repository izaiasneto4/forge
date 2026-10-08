import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { pullRequests, reviewComments, reviewTasks, syncStates } from '../../src/db/schema'
import { DEFAULT_ALLOWED_HOSTS } from '../../src/http/host-authorization'
import { findPullRequest } from '../../src/models/pull-request'
import { findReviewTask } from '../../src/models/review-task'
import { SETTING_KEYS, SettingStore } from '../../src/models/setting'
import { STREAMS } from '../../src/realtime/broadcaster'
import type { ApiServices } from '../../src/routes/shared'
import type { SyncStatusPayload } from '../../src/models/sync-state'
import { DEFAULT_FOLDER_PROMPT, REPOSITORY_FOLDER_PROMPT } from '../../src/services/folder-picker'
import type { SyncResult } from '../../src/services/sync/engine'
import { SyncAdapterError } from '../../src/services/sync/github-adapter'
import { createTestApp } from '../support/app'
import { createTestContext, type TestContext } from '../support/context'
import { insertAgentLog, insertPullRequest, insertReviewComment, insertReviewTask, insertSnapshot } from '../support/factories'
import { createGitRepository, createTempFolder } from '../support/git'

const origin = 'http://localhost'
const owner = 'acme'
const repoName = 'api'
const slug = `${owner}/${repoName}`

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

function syncResult(sync: Partial<SyncStatusPayload> = {}, alreadyRunning = false): SyncResult {
  return {
    fetched: 0,
    created: 0,
    updated: 0,
    deactivated: 0,
    already_running: alreadyRunning,
    sync: {
      status: 'succeeded',
      running: false,
      last_synced_at: null,
      last_started_at: null,
      last_finished_at: null,
      last_succeeded_at: null,
      last_error: null,
      fetched_count: 0,
      created_count: 0,
      updated_count: 0,
      deactivated_count: 0,
      seconds_until_sync_allowed: 0,
      sync_needed: false,
      ...sync,
    },
  }
}

describe('API routes', () => {
  let ctx: TestContext
  let services: Partial<ApiServices>
  let tempFolder: ReturnType<typeof createTempFolder>

  beforeEach(() => {
    ctx = createTestContext()
    services = {}
    tempFolder = createTempFolder()
  })

  afterEach(() => tempFolder.remove())

  async function call(method: string, path: string, body?: unknown) {
    const app = createTestApp(ctx, services)
    const init: RequestInit = { method, headers: { 'content-type': 'application/json', host: 'localhost' } }
    if (body !== undefined) init.body = JSON.stringify(body)
    const response = await app.handle(new Request(`${origin}${path}`, init))
    const json: unknown = await response.json()
    return { status: response.status, json }
  }

  async function useCurrentRepo(repoSlug = slug) {
    const repoPath = createGitRepository(ctx.commands, tempFolder.path, repoSlug.split('/')[1] ?? repoName, repoSlug)
    new SettingStore(ctx.db).setCurrentRepo(repoPath)
    return repoPath
  }

  describe('pull requests', () => {
    test('lists active pull requests for the current repo, filtered by status', async () => {
      await useCurrentRepo()
      const listed = insertPullRequest(ctx.db, { repoOwner: owner, repoName, updatedAtGithub: new Date() })
      const withoutTimestamp = insertPullRequest(ctx.db, { repoOwner: owner, repoName, updatedAtGithub: null })
      insertPullRequest(ctx.db, { repoOwner: owner, repoName: 'web' })
      const waiting = insertPullRequest(ctx.db, { repoOwner: owner, repoName, reviewStatus: 'waiting_implementation' })

      const all = await call('GET', '/api/v1/pull_requests')
      const filtered = await call('GET', '/api/v1/pull_requests?status=waiting_implementation')

      expect(all.status).toBe(200)
      const numbers = list(dig(all.json, 'items')).map((item) => dig(item, 'number'))
      expect(numbers).toEqual(expect.arrayContaining([listed.number, withoutTimestamp.number, waiting.number]))
      expect(numbers).toHaveLength(3)
      expect(dig(filtered.json, 'items', 0, 'number')).toBe(waiting.number)
      const nullTimestamp = list(dig(all.json, 'items')).find((item) => dig(item, 'number') === withoutTimestamp.number)
      expect(dig(nullTimestamp, 'updated_at_github')).toBeNull()
    })

    test.each(['status=wat', 'limit=0'])('rejects %p', async (queryString) => {
      const { status, json } = await call('GET', `/api/v1/pull_requests?${queryString}`)

      expect(status).toBe(422)
      expect(dig(json, 'error', 'code')).toBe('invalid_input')
    })

    test('review_scope stores the preference without syncing', async () => {
      const { status, json } = await call('PATCH', '/api/v1/pull_requests/review_scope', { requested_to_me_only: true })

      expect(status).toBe(200)
      expect(new SettingStore(ctx.db).onlyRequestedReviews()).toBe(true)
      expect(dig(json, 'board', 'settings', 'only_requested_reviews')).toBe(true)
      expect(dig(json, 'message')).toBe('Review scope updated: requested to me only')
    })

    test('board recovers the current repo from the repos folder', async () => {
      const repoPath = createGitRepository(ctx.commands, tempFolder.path, repoName, slug)
      const settings = new SettingStore(ctx.db)
      settings.setReposFolder(tempFolder.path)
      insertPullRequest(ctx.db, { repoOwner: owner, repoName })
      const lastSucceededAt = new Date('2026-03-07T12:00:00Z')
      const now = new Date()
      ctx.db.insert(syncStates).values({ scopeKey: `repo:${slug}`, repoOwner: owner, repoName, status: 'succeeded', lastSucceededAt, createdAt: now, updatedAt: now }).run()

      const { status, json } = await call('GET', '/api/v1/pull_requests/board')

      expect(status).toBe(200)
      expect(dig(json, 'current_repo', 'path')).toBe(repoPath)
      expect(dig(json, 'current_repo', 'name')).toBe(repoName)
      expect(dig(json, 'sync_status', 'status')).toBe('succeeded')
      expect(dig(json, 'sync_status', 'last_synced_at')).toBe('2026-03-07T12:00:00Z')
      expect(settings.currentRepo()).toBe(repoPath)
    })

    test('status updates validate, broadcast and return the board', async () => {
      const pullRequest = insertPullRequest(ctx.db)
      insertReviewTask(ctx.db, { pullRequestId: pullRequest.id, state: 'reviewed' })
      const nextStatus = 'in_review'

      const { status, json } = await call('PATCH', `/api/v1/pull_requests/${pullRequest.id}/status`, { review_status: nextStatus })
      const invalid = await call('PATCH', `/api/v1/pull_requests/${pullRequest.id}/status`, { review_status: 'nope' })

      expect(status).toBe(200)
      expect(dig(json, 'message')).toBe('Status updated')
      expect(dig(json, 'board', 'counts', nextStatus)).toBe(1)
      expect(ctx.events.on(STREAMS.uiEvents).filter((event) => event.event === 'pull_request.updated')).toHaveLength(2)
      expect(invalid.status).toBe(422)
      expect(dig(invalid.json, 'error', 'message')).toBe('Review status is not included in the list')
    })

    test('archive hides a pull request and unarchive restores it', async () => {
      const pullRequest = insertPullRequest(ctx.db)

      const archived = await call('PATCH', `/api/v1/pull_requests/${pullRequest.id}/archive`)
      const restored = await call('PATCH', `/api/v1/pull_requests/${pullRequest.id}/unarchive`)

      expect(dig(archived.json, 'message')).toBe('Pull request archived')
      expect(dig(restored.json, 'message')).toBe('Pull request restored')
      expect(findPullRequest(ctx.db, pullRequest.id).archived).toBe(false)
    })

    test('bulk destroy soft-deletes selected pull requests', async () => {
      const first = insertPullRequest(ctx.db)
      const second = insertPullRequest(ctx.db)
      const ids = [String(first.id), String(second.id)]

      const { json } = await call('DELETE', '/api/v1/pull_requests/bulk_destroy', { pull_request_ids: ids })
      const empty = await call('DELETE', '/api/v1/pull_requests/bulk_destroy', { pull_request_ids: [] })

      expect(dig(json, 'deleted_count')).toBe(ids.length)
      expect(ctx.db.select().from(pullRequests).where(eq(pullRequests.id, first.id)).get()?.deletedAt).not.toBeNull()
      expect(ctx.events.on(STREAMS.uiEvents)).toContainEqual(expect.objectContaining({ event: 'pull_request.bulk_deleted', pull_request_ids: ids }))
      expect(empty.status).toBe(400)
    })

    test('starting a review creates a task and its job, or queues behind a running review', async () => {
      const pullRequest = insertPullRequest(ctx.db, { headSha: 'head', baseSha: 'base' })
      const runningTask = insertReviewTask(ctx.db, { pullRequestId: insertPullRequest(ctx.db).id, state: 'in_review' })

      const queued = await call('POST', `/api/v1/pull_requests/${pullRequest.id}/review_task`, { cli_client: 'codex' })
      ctx.db.update(reviewTasks).set({ state: 'done' }).where(eq(reviewTasks.id, runningTask.id)).run()
      const other = insertPullRequest(ctx.db)
      const started = await call('POST', `/api/v1/pull_requests/${other.id}/review_task`)

      expect(queued.status).toBe(201)
      expect(dig(queued.json, 'message')).toBe(`Review queued (#1) for PR #${pullRequest.number}`)
      expect(dig(queued.json, 'detail', 'task', 'cli_client')).toBe('codex')
      expect(dig(started.json, 'message')).toBe(`Review started for PR #${other.number}`)
      expect(ctx.jobs.unfinished('ReviewTaskJob')).toHaveLength(1)
    })

    test('refuses to start a second review while one is in progress', async () => {
      const pullRequest = insertPullRequest(ctx.db)
      insertReviewTask(ctx.db, { pullRequestId: pullRequest.id, state: 'in_review' })

      const { status, json } = await call('POST', `/api/v1/pull_requests/${pullRequest.id}/review_task`)

      expect(status).toBe(409)
      expect(dig(json, 'error', 'code')).toBe('conflict')
    })

    test('manual sync runs the engine unless the last sync is fresh', async () => {
      await useCurrentRepo()
      const lastSucceededAt = '2026-03-07T12:00:00Z'
      services.runSync = async () => syncResult({ last_succeeded_at: lastSucceededAt })

      const forced = await call('POST', '/api/v1/pull_requests/sync', { force: true })
      const now = new Date()
      ctx.db.insert(syncStates).values({ scopeKey: `repo:${slug}`, repoOwner: owner, repoName, status: 'succeeded', lastSucceededAt: now, createdAt: now, updatedAt: now }).onConflictDoNothing().run()
      ctx.db.update(syncStates).set({ status: 'succeeded', lastSucceededAt: now }).run()
      const skipped = await call('POST', '/api/v1/pull_requests/sync', { force: false })

      expect(dig(forced.json, 'message')).toBe('Synced with GitHub')
      expect(dig(forced.json, 'sync', 'last_succeeded_at')).toBe(lastSucceededAt)
      expect(String(dig(skipped.json, 'message'))).toStartWith('Using cached data')
    })

    test('a failing sync is reported as sync_failed', async () => {
      const failure = 'gh exploded'
      services.runSync = async () => {
        throw new SyncAdapterError(failure)
      }

      const { status, json } = await call('POST', '/api/v1/pull_requests/sync', { force: true })

      expect(status).toBe(422)
      expect(dig(json, 'error')).toEqual({ code: 'sync_failed', message: failure })
    })
  })

  describe('review tasks', () => {
    test('board and detail return structured payloads', async () => {
      const pullRequest = insertPullRequest(ctx.db)
      const task = insertReviewTask(ctx.db, { pullRequestId: pullRequest.id, state: 'reviewed', reviewOutput: '## Summary\n\nLooks good.' })
      insertReviewComment(ctx.db, { reviewTaskId: task.id, severity: 'major' })
      insertAgentLog(ctx.db, { reviewTaskId: task.id, logType: 'status', message: 'Started review' })

      const board = await call('GET', '/api/v1/review_tasks/board')
      const detail = await call('GET', `/api/v1/review_tasks/${task.id}`)

      expect(dig(board.json, 'columns', 'reviewed')).toHaveLength(1)
      expect(dig(detail.json, 'content_mode')).toBe('comments')
      expect(dig(detail.json, 'comments')).toHaveLength(1)
      expect(dig(detail.json, 'live_logs')).toHaveLength(1)
    })

    test('state changes validate and backward moves keep history', async () => {
      const task = insertReviewTask(ctx.db, { pullRequestId: insertPullRequest(ctx.db).id, state: 'reviewed', reviewOutput: 'done' })

      const invalid = await call('PATCH', `/api/v1/review_tasks/${task.id}/state`, { state: 'bogus' })
      const moved = await call('PATCH', `/api/v1/review_tasks/${task.id}/state`, { state: 'pending_review', backward_move: true })

      expect(invalid.status).toBe(422)
      expect(dig(invalid.json, 'error', 'message')).toBe('Invalid state')
      expect(dig(moved.json, 'detail', 'task', 'state')).toBe('pending_review')
      expect(dig(moved.json, 'detail', 'task', 'has_review_history')).toBe(true)
    })

    test('retry only applies to failed tasks and starts a retry job', async () => {
      const pullRequest = insertPullRequest(ctx.db, { reviewStatus: 'review_failed' })
      const task = insertReviewTask(ctx.db, { pullRequestId: pullRequest.id, state: 'failed_review' })
      const notFailed = insertReviewTask(ctx.db, { pullRequestId: insertPullRequest(ctx.db).id, state: 'reviewed' })

      const retried = await call('POST', `/api/v1/review_tasks/${task.id}/retry`)
      const refused = await call('POST', `/api/v1/review_tasks/${notFailed.id}/retry`)

      expect(dig(retried.json, 'message')).toBe('Retry initiated')
      expect(ctx.jobs.unfinished('ReviewTaskJob')).toEqual([expect.objectContaining({ payload: { reviewTaskId: task.id, isRetry: true } })])
      expect(findPullRequest(ctx.db, pullRequest.id).reviewStatus).toBe('pending_review')
      expect(refused.status).toBe(422)
      expect(dig(refused.json, 'error', 'message')).toBe('Can only retry failed reviews')
    })

    test('dequeue, archive and unarchive', async () => {
      const task = insertReviewTask(ctx.db, { pullRequestId: insertPullRequest(ctx.db).id, state: 'queued', queuedAt: new Date() })

      const dequeued = await call('DELETE', `/api/v1/review_tasks/${task.id}/dequeue`)
      const again = await call('DELETE', `/api/v1/review_tasks/${task.id}/dequeue`)
      const archived = await call('PATCH', `/api/v1/review_tasks/${task.id}/archive`)
      const restored = await call('PATCH', `/api/v1/review_tasks/${task.id}/unarchive`)

      expect(dig(dequeued.json, 'message')).toBe('Review removed from queue')
      expect(again.status).toBe(422)
      expect(dig(archived.json, 'message')).toBe('Review task archived')
      expect(dig(restored.json, 'message')).toBe('Review task restored')
      expect(findReviewTask(ctx.db, task.id)).toMatchObject({ state: 'pending_review', archived: false })
    })

    test('clear destroys the task and resets the pull request', async () => {
      const pullRequest = insertPullRequest(ctx.db, { reviewStatus: 'reviewed_by_me' })
      const task = insertReviewTask(ctx.db, { pullRequestId: pullRequest.id, state: 'reviewed' })

      const { json } = await call('DELETE', `/api/v1/review_tasks/${task.id}/clear`)

      expect(dig(json, 'cleared_review_task_id')).toBe(task.id)
      expect(findPullRequest(ctx.db, pullRequest.id).reviewStatus).toBe('pending_review')
    })

    test('submissions post selected comments and move the lifecycle forward', async () => {
      const pullRequest = insertPullRequest(ctx.db, { reviewStatus: 'reviewed_by_me' })
      const task = insertReviewTask(ctx.db, { pullRequestId: pullRequest.id, state: 'reviewed' })
      const blocking = insertReviewComment(ctx.db, { reviewTaskId: task.id, severity: 'critical' })
      const submitted: string[] = []
      const githubResult = { review_id: 77 }
      services.submitReview = async (_ctx, _task, options) => {
        submitted.push(options.event)
        return githubResult
      }

      const { status, json } = await call('POST', `/api/v1/review_tasks/${task.id}/submissions`, { comment_ids: [blocking.id] })

      expect(status).toBe(200)
      expect(submitted).toEqual(['REQUEST_CHANGES'])
      expect(dig(json, 'result')).toEqual(githubResult)
      expect(findReviewTask(ctx.db, task.id)).toMatchObject({ state: 'waiting_implementation', submissionStatus: 'submitted', submittedEvent: 'REQUEST_CHANGES' })
      expect(findPullRequest(ctx.db, pullRequest.id).reviewStatus).toBe('waiting_implementation')
      expect(ctx.db.select().from(reviewComments).where(eq(reviewComments.id, blocking.id)).get()?.status).toBe('addressed')
    })

    test('submitting nothing is refused unless it is an empty approval', async () => {
      const task = insertReviewTask(ctx.db, { pullRequestId: insertPullRequest(ctx.db).id, state: 'reviewed' })

      const { status, json } = await call('POST', `/api/v1/review_tasks/${task.id}/submissions`, {})

      expect(status).toBe(422)
      expect(dig(json, 'error', 'message')).toBe('No comments selected for submission')
    })

    test('logs support tail and after_id', async () => {
      const task = insertReviewTask(ctx.db, { pullRequestId: insertPullRequest(ctx.db).id })
      const first = insertAgentLog(ctx.db, { reviewTaskId: task.id, message: 'one' })
      const second = insertAgentLog(ctx.db, { reviewTaskId: task.id, message: 'two', logType: 'error' })

      const all = await call('GET', `/api/v1/review_tasks/${task.id}/logs`)
      const after = await call('GET', `/api/v1/review_tasks/${task.id}/logs?after_id=${first.id}`)
      const badTail = await call('GET', `/api/v1/review_tasks/${task.id}/logs?tail=0`)
      const missing = await call('GET', '/api/v1/review_tasks/999999/logs')

      expect(dig(all.json, 'logs')).toHaveLength(2)
      expect(list(dig(after.json, 'logs')).map((log) => dig(log, 'id'))).toEqual([second.id])
      expect(badTail.status).toBe(422)
      expect(missing.status).toBe(404)
      expect(dig(missing.json, 'error')).toEqual({ code: 'not_found', message: 'Resource not found' })
    })

    test('comment toggle cycles status and returns the detail', async () => {
      const task = insertReviewTask(ctx.db, { pullRequestId: insertPullRequest(ctx.db).id, state: 'reviewed' })
      const comment = insertReviewComment(ctx.db, { reviewTaskId: task.id })

      const { json } = await call('PATCH', `/api/v1/review_comments/${comment.id}/toggle`)

      expect(dig(json, 'detail', 'comments', 0, 'status')).toBe('addressed')
    })
  })

  describe('reviews (CLI)', () => {
    test('starts or queues a review from a pull request URL', async () => {
      const pullRequest = insertPullRequest(ctx.db)

      const { status, json } = await call('POST', '/api/v1/reviews', { pr_url: pullRequest.url })

      expect(status).toBe(201)
      expect(json).toMatchObject({ ok: true, state: 'pending_review', queue_position: null, pull_request_id: pullRequest.id })
    })

    test.each([
      [{ pr_url: 'bad-url' }, 422, 'invalid_input'],
      [{}, 422, 'invalid_input'],
    ])('rejects %p', async (body, expectedStatus, code) => {
      const { status, json } = await call('POST', '/api/v1/reviews', body)

      expect(status).toBe(expectedStatus)
      expect(dig(json, 'error', 'code')).toBe(code)
    })

    test('syncs the focused pull request when unknown, then reports not found', async () => {
      const requested: Array<number | null | undefined> = []
      const prNumber = 99999
      services.runSync = async (_ctx, options) => {
        requested.push(options.pullRequestNumber)
        return syncResult()
      }

      const { status } = await call('POST', '/api/v1/reviews', { pr_url: `https://github.com/${slug}/pull/${prNumber}` })

      expect(status).toBe(404)
      expect(requested).toEqual([prNumber])
    })

    test('rejects a pull request from another repo than the current one', async () => {
      await useCurrentRepo('foo/bar')
      const pullRequest = insertPullRequest(ctx.db)

      const { status, json } = await call('POST', '/api/v1/reviews', { pr_url: pullRequest.url })

      expect(status).toBe(422)
      expect(dig(json, 'error', 'message')).toBe(`PR repo ${slug} does not match current repo foo/bar`)
    })

    test('reports invalid task attributes', async () => {
      const pullRequest = insertPullRequest(ctx.db)

      const { status, json } = await call('POST', '/api/v1/reviews', { pr_url: pullRequest.url, cli_client: 'invalid-client' })

      expect(status).toBe(422)
      expect(dig(json, 'error', 'code')).toBe('invalid_input')
    })
  })

  describe('sync (CLI), status, bootstrap', () => {
    test('sync validates its boolean and reports results', async () => {
      const lastSucceededAt = '2026-03-07T12:00:00Z'
      services.runSync = async () => syncResult({ last_succeeded_at: lastSucceededAt })

      const malformed = await call('POST', '/api/v1/sync', { force: 'maybe' })
      const ran = await call('POST', '/api/v1/sync', { force: false })

      expect(malformed.status).toBe(422)
      expect(ran.json).toMatchObject({ skipped: false, already_running: false, last_synced_at: lastSucceededAt })
    })

    test('status reports counts and the running task', async () => {
      const running = insertReviewTask(ctx.db, { pullRequestId: insertPullRequest(ctx.db, { reviewStatus: 'in_review' }).id, state: 'in_review', startedAt: new Date() })
      insertPullRequest(ctx.db)

      const { json } = await call('GET', '/api/v1/status')

      expect(json).toMatchObject({ ok: true, counts: { pending_review: 1, in_review: 1, queued: 0, failed_review: 0 }, running_task_id: running.id })
    })

    test('bootstrap includes app info and settings', async () => {
      const settings = new SettingStore(ctx.db)
      settings.setThemePreference('dark')
      settings.write(SETTING_KEYS.githubLogin, 'izaias')

      const { json } = await call('GET', '/api/v1/bootstrap')

      expect(dig(json, 'app', 'name')).toBe('Ordem')
      expect(dig(json, 'settings', 'theme_preference')).toBe('dark')
      expect(dig(json, 'settings', 'github_login')).toBe('izaias')
    })
  })

  describe('repositories and settings', () => {
    test('switching validates the slug and reports resolver outcomes', async () => {
      new SettingStore(ctx.db).setReposFolder(tempFolder.path)
      createGitRepository(ctx.commands, tempFolder.path, 'one', 'acme/dup')
      createGitRepository(ctx.commands, tempFolder.path, 'two', 'acme/dup')

      const badFormat = await call('POST', '/api/v1/repositories/switch', { repo: 'acme' })
      const missing = await call('POST', '/api/v1/repositories/switch', {})
      const notFound = await call('POST', '/api/v1/repositories/switch', { repo: 'acme/nothing' })
      const ambiguous = await call('POST', '/api/v1/repositories/switch', { repo: 'acme/dup' })

      expect(badFormat.status).toBe(422)
      expect(dig(missing.json, 'error', 'code')).toBe('invalid_input')
      expect(notFound.status).toBe(404)
      expect(ambiguous.status).toBe(409)
      expect(dig(ambiguous.json, 'error', 'details', 'paths')).toHaveLength(2)
    })

    test('switching sets the current repo and syncs it', async () => {
      new SettingStore(ctx.db).setReposFolder(tempFolder.path)
      const repoPath = createGitRepository(ctx.commands, tempFolder.path, repoName, slug)
      const triggers: string[] = []
      services.runSync = async (_ctx, options) => {
        triggers.push(options.trigger)
        return syncResult()
      }

      const { status, json } = await call('POST', '/api/v1/repositories/switch', { repo: slug })

      expect(status).toBe(201)
      expect(dig(json, 'message')).toBe(`Switched to ${repoName} and synced`)
      expect(new SettingStore(ctx.db).currentRepo()).toBe(repoPath)
      expect(triggers).toEqual(['repo_switch'])
    })

    test('a sync failure after switching is reported', async () => {
      new SettingStore(ctx.db).setReposFolder(tempFolder.path)
      createGitRepository(ctx.commands, tempFolder.path, repoName, slug)
      services.runSync = async () => {
        throw new SyncAdapterError('boom')
      }

      const { status, json } = await call('POST', '/api/v1/repositories/switch', { repo: slug })

      expect(status).toBe(422)
      expect(dig(json, 'error', 'message')).toBe('Switched repo but sync failed: boom')
    })

    test('adding a checkout tracks it, lists its siblings and syncs it', async () => {
      const repoPath = createGitRepository(ctx.commands, tempFolder.path, repoName, slug)
      const syncedPaths: Array<string | null> = []
      const triggers: string[] = []
      services.runSync = async (_ctx, options) => {
        syncedPaths.push(options.repoPath)
        triggers.push(options.trigger)
        return syncResult()
      }

      const { status, json } = await call('POST', '/api/v1/repositories', { path: repoPath })

      const settingStore = new SettingStore(ctx.db)
      expect(status).toBe(201)
      expect(dig(json, 'message')).toBe(`Added ${repoName} and synced`)
      expect(dig(json, 'board', 'current_repo', 'slug')).toBe(slug)
      expect(settingStore.currentRepo()).toBe(repoPath)
      expect(settingStore.reposFolder()).toBe(tempFolder.path)
      expect(syncedPaths).toEqual([repoPath])
      expect(triggers).toEqual(['repo_add'])
    })

    test('adding a folder of several checkouts keeps it as the repos folder for picking', async () => {
      const slugs = [slug, `${owner}/web`]
      for (const repoSlug of slugs) createGitRepository(ctx.commands, tempFolder.path, repoSlug.split('/')[1] ?? repoSlug, repoSlug)

      const { status, json } = await call('POST', '/api/v1/repositories', { path: tempFolder.path })

      const settingStore = new SettingStore(ctx.db)
      expect(status).toBe(200)
      expect(dig(json, 'synced')).toBe(false)
      expect(list(dig(json, 'repositories', 'items'))).toHaveLength(slugs.length)
      expect(settingStore.reposFolder()).toBe(tempFolder.path)
      expect(settingStore.currentRepo()).toBeNull()
    })

    test('adding rejects folders that hold no GitHub checkout', async () => {
      const missingPath = `${tempFolder.path}/missing`

      const missing = await call('POST', '/api/v1/repositories', { path: missingPath })
      const empty = await call('POST', '/api/v1/repositories', { path: tempFolder.path })
      const blank = await call('POST', '/api/v1/repositories', {})

      expect(missing.status).toBe(422)
      expect(dig(missing.json, 'error', 'message')).toBe(`${missingPath} is not a folder`)
      expect(empty.status).toBe(422)
      expect(dig(empty.json, 'error', 'message')).toBe(`No GitHub repositories found in ${tempFolder.path}`)
      expect(dig(blank.json, 'error', 'code')).toBe('invalid_input')
      expect(new SettingStore(ctx.db).currentRepo()).toBeNull()
    })

    test('a sync failure after adding is reported', async () => {
      const repoPath = createGitRepository(ctx.commands, tempFolder.path, repoName, slug)
      const failure = 'gh auth required'
      services.runSync = async () => {
        throw new SyncAdapterError(failure)
      }

      const { status, json } = await call('POST', '/api/v1/repositories', { path: repoPath })

      expect(status).toBe(422)
      expect(dig(json, 'error', 'message')).toBe(`Added repo but sync failed: ${failure}`)
      expect(new SettingStore(ctx.db).currentRepo()).toBe(repoPath)
    })

    test('picking a repository folder uses the repository prompt', async () => {
      const prompts: string[] = []
      services.pickFolder = async (_ctx, prompt) => {
        prompts.push(prompt)
        return null
      }

      await call('POST', '/api/v1/settings/pick_folder', { purpose: 'repository' })
      await call('POST', '/api/v1/settings/pick_folder')

      expect(prompts).toEqual([REPOSITORY_FOLDER_PROMPT, DEFAULT_FOLDER_PROMPT])
    })

    test('settings update, theme and folder picking', async () => {
      const pickedFolder = '/Users/me/projects'
      services.pickFolder = async () => pickedFolder

      const updated = await call('PATCH', '/api/v1/settings', { repos_folder: tempFolder.path, default_cli_client: 'codex', auto_submit_enabled: false })
      const badFolder = await call('PATCH', '/api/v1/settings', { repos_folder: '/definitely/missing' })
      const theme = await call('PATCH', '/api/v1/settings/theme', { theme_preference: 'light' })
      const badTheme = await call('PATCH', '/api/v1/settings/theme', { theme_preference: 'invalid' })
      const picked = await call('POST', '/api/v1/settings/pick_folder')

      expect(dig(updated.json, 'settings', 'default_cli_client')).toBe('codex')
      expect(dig(updated.json, 'settings', 'repos_folder')).toBe(tempFolder.path)
      expect(badFolder.status).toBe(422)
      expect(dig(theme.json, 'settings', 'theme_preference')).toBe('light')
      expect(badTheme.status).toBe(422)
      expect(dig(picked.json, 'path')).toBe(pickedFolder)
    })
  })

  test('blocks requests for unknown hosts', async () => {
    const app = createTestApp(ctx, services, { allowedHosts: DEFAULT_ALLOWED_HOSTS })

    const response = await app.handle(new Request(`${origin}/api/v1/status`, { headers: { host: 'attacker.example' } }))

    expect(response.status).toBe(403)
  })

  test('snapshot-backed pull requests expose their AI summary on the board', async () => {
    const pullRequest = insertPullRequest(ctx.db, { headSha: 'head', baseSha: 'base' })
    const mainChanges = ['Caching layer added']
    insertSnapshot(ctx.db, { pullRequestId: pullRequest.id, headSha: 'head', baseSha: 'base', aiSummaryStatus: 'current', aiSummaryMainChanges: JSON.stringify(mainChanges) })

    const { json } = await call('GET', '/api/v1/pull_requests/board')

    expect(dig(json, 'columns', 'pending_review', 0, 'ai_summary', 'main_changes')).toEqual(mainChanges)
  })
})
