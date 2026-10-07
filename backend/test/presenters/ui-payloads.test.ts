import type { Static } from '@sinclair/typebox'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import type { ReviewTaskDetail } from '../../src/contracts/ui-payloads'
import { iso8601, secondsAgo } from '../../src/lib/ruby'
import { updatePullRequestColumns } from '../../src/models/pull-request'
import { MAX_RETRY_ATTEMPTS } from '../../src/models/review-task'
import { CLI_CLIENTS, SettingStore, VALID_THEME_PREFERENCES } from '../../src/models/setting'
import { defaultSyncStatus } from '../../src/models/sync-state'
import { renderCodeBlock, renderMarkdown } from '../../src/presenters/markdown'
import { formatReviewDuration, severityEmoji } from '../../src/presenters/review-tasks-helper'
import {
  bootstrapPayload,
  currentRepoPayload,
  pullRequestBoardPayload,
  repositoriesPayload,
  reviewTaskBoardPayload,
  reviewTaskDetailPayload,
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

type ContentMode = Static<typeof ReviewTaskDetail>['content_mode']

const repoOwner = 'acme'
const repoName = 'api'
const repoSlug = `${repoOwner}/${repoName}`

function jsonBlock(findings: unknown[]) {
  return `Review notes\n\`\`\`json\n${JSON.stringify(findings)}\n\`\`\`\n`
}

describe('UI payloads', () => {
  let ctx: TestContext
  let settingStore: SettingStore
  let reposFolder: ReturnType<typeof createTempFolder>
  let repoPath: string

  beforeEach(async () => {
    ctx = createTestContext()
    settingStore = new SettingStore(ctx.db)
    reposFolder = createTempFolder()
    repoPath = await createGitRepository(reposFolder.path, repoName, repoSlug)
  })

  afterEach(() => reposFolder.remove())

  // The fixture of Rails' Api::V1::FrontendSurfaceTest.
  function arrangeFrontendSurface() {
    const mainChanges = ['Caching layer added', 'Auth middleware refactor']
    const riskAreas = ['Billing calculation', 'Authentication logic']
    const githubLogin = 'izaias'
    const reviewOutput = '## Summary\n\nLooks mostly good.\n'
    const pullRequest = insertPullRequest(ctx.db, {
      repoOwner,
      repoName,
      title: 'Frontend rewrite',
      author: githubLogin,
      updatedAtGithub: new Date(),
      headSha: 'head-1',
      baseSha: 'base-1',
      additions: 210,
      deletions: 34,
      changedFiles: 6,
    })
    const snapshot = insertSnapshot(ctx.db, {
      pullRequestId: pullRequest.id,
      headSha: 'head-1',
      baseSha: 'base-1',
      aiSummaryStatus: 'current',
      aiSummaryGeneratedAt: new Date(),
      aiSummaryFilesChanged: 6,
      aiSummaryLinesAdded: 210,
      aiSummaryLinesRemoved: 34,
      aiSummaryMainChanges: JSON.stringify(mainChanges),
      aiSummaryRiskAreas: JSON.stringify(riskAreas),
    })
    const reviewTask = insertReviewTask(ctx.db, { pullRequestId: pullRequest.id, state: 'reviewed', cliClient: 'codex', reviewOutput })
    const comment = insertReviewComment(ctx.db, {
      reviewTaskId: reviewTask.id,
      title: 'Guard nil branch',
      body: 'Check the nil branch before dereferencing.',
      filePath: 'app/models/example.rb',
      lineNumber: 12,
      severity: 'major',
      status: 'pending',
    })
    const log = insertAgentLog(ctx.db, { reviewTaskId: reviewTask.id, message: 'Started review', logType: 'status' })

    settingStore.setDefaultCliClient('claude')
    settingStore.setAutoSubmitEnabled(true)
    settingStore.setOnlyRequestedReviews(false)
    settingStore.setThemePreference('dark')
    settingStore.setGithubLogin(githubLogin)
    settingStore.setCurrentRepo(repoPath)
    settingStore.setReposFolder(reposFolder.path)

    return { pullRequest, snapshot, reviewTask, comment, log, mainChanges, riskAreas, githubLogin, reviewOutput }
  }

  describe('currentRepoPayload', () => {
    test('describes the current repo from its git remote, given a context or a database', async () => {
      settingStore.setCurrentRepo(repoPath)
      const expected = { path: repoPath, slug: repoSlug, name: repoName }

      expect(await currentRepoPayload(ctx)).toEqual(expected)
      expect(await currentRepoPayload(ctx.db)).toEqual(expected)
    })

    test('is all null without a current repo', async () => {
      expect(await currentRepoPayload(ctx)).toEqual({ path: null, slug: null, name: null })
    })

    test('names a path with a trailing slash after its directory', async () => {
      const pathWithSlash = `${repoPath}/`
      settingStore.setCurrentRepo(pathWithSlash)

      expect(await currentRepoPayload(ctx)).toEqual({ path: pathWithSlash, slug: repoSlug, name: repoName })
    })
  })

  describe('bootstrapPayload', () => {
    test('returns app info, settings, header counts and sync status', async () => {
      const { githubLogin } = arrangeFrontendSurface()
      const inReview = insertPullRequest(ctx.db, { repoOwner, repoName, reviewStatus: 'in_review' })
      insertReviewTask(ctx.db, { pullRequestId: inReview.id, state: 'in_review' })

      const payload = await bootstrapPayload(ctx)

      expect(payload).toEqual({
        app: { name: 'Forge', cli_clients: [...CLI_CLIENTS], valid_theme_preferences: [...VALID_THEME_PREFERENCES] },
        current_repo: { path: repoPath, slug: repoSlug, name: repoName },
        settings: {
          default_cli_client: 'claude',
          auto_submit_enabled: true,
          only_requested_reviews: false,
          theme_preference: 'dark',
          github_login: githubLogin,
        },
        counts: { pending_review: 1, in_review: 1 },
        sync_status: expect.objectContaining({ status: 'idle', running: false, sync_needed: true }),
      })
    })

    test('uses defaults and the idle sync status when nothing is configured', async () => {
      const payload = await bootstrapPayload(ctx)

      expect(payload.settings).toEqual({
        default_cli_client: 'claude',
        auto_submit_enabled: false,
        only_requested_reviews: true,
        theme_preference: null,
        github_login: null,
      })
      expect(payload.sync_status).toEqual(defaultSyncStatus())
    })

    test('counts against the stored repo even when recovery re-points it', async () => {
      const missingRepo = join(reposFolder.path, 'deleted-checkout')
      settingStore.setReposFolder(reposFolder.path)
      settingStore.setCurrentRepo(missingRepo)
      insertPullRequest(ctx.db, { repoOwner, repoName })
      const emptyCount = 0

      const payload = await bootstrapPayload(ctx)

      expect(payload.current_repo.path).toBe(repoPath)
      expect(payload.counts.pending_review).toBe(emptyCount)
    })
  })

  describe('pullRequestBoardPayload', () => {
    test('returns the columns payload of the frontend surface', async () => {
      const { pullRequest, snapshot, reviewTask, mainChanges, riskAreas, githubLogin } = arrangeFrontendSurface()

      const payload = await pullRequestBoardPayload(ctx)

      expect(payload.columns.pending_review).toHaveLength(1)
      expect(payload.repositories.items).toEqual([{ name: repoName, path: repoPath, branch: expect.any(String), slug: repoSlug, current: true }])
      expect(payload.settings).toEqual({ only_requested_reviews: false, current_user_login: githubLogin })
      expect(payload.counts).toEqual({
        pending_review: 1,
        in_review: 0,
        reviewed_by_me: 0,
        waiting_implementation: 0,
        reviewed_by_others: 0,
        review_failed: 0,
      })
      expect(payload.total_count).toBe(1)
      const [item] = payload.columns.pending_review
      expect(item).toMatchObject({
        id: pullRequest.id,
        number: pullRequest.number,
        title: pullRequest.title,
        repo_full_name: repoSlug,
        review_status: 'pending_review',
        archived: false,
        updated_at_github: iso8601(pullRequest.updatedAtGithub),
        created_at_github: null,
        snapshot_status: 'current',
        analysis_status: 'pending',
        draft: false,
        review_requested_for_me: false,
        ai_summary: {
          status: 'current',
          generated_at: iso8601(snapshot.aiSummaryGeneratedAt),
          failure_reason: null,
          snapshot_id: snapshot.id,
          stale: false,
          files_changed: snapshot.aiSummaryFilesChanged,
          lines_added: snapshot.aiSummaryLinesAdded,
          lines_removed: snapshot.aiSummaryLinesRemoved,
          main_changes: mainChanges,
          risk_areas: riskAreas,
        },
      })
      expect(item?.review_task).toMatchObject({ id: reviewTask.id, state: 'reviewed', cli_client: 'codex', pull_request: null })
    })

    test('falls back to the pull request stats when it has no snapshot', async () => {
      const additions = 12
      const deletions = 3
      const changedFiles = 2
      insertPullRequest(ctx.db, { additions, deletions, changedFiles })

      const payload = await pullRequestBoardPayload(ctx)

      expect(payload.columns.pending_review[0]).toMatchObject({
        snapshot_status: 'missing',
        analysis_status: 'none',
        review_task: null,
        ai_summary: { status: 'none', snapshot_id: null, files_changed: changedFiles, lines_added: additions, lines_removed: deletions, main_changes: [], risk_areas: [] },
      })
    })

    test('counts the in_review column after a status change', async () => {
      const { pullRequest } = arrangeFrontendSurface()
      updatePullRequestColumns(ctx.db, pullRequest.id, { reviewStatus: 'in_review' })

      const payload = await pullRequestBoardPayload(ctx)

      expect(payload.counts.in_review).toBe(1)
      expect(payload.counts.pending_review).toBe(0)
    })

    test('lists no repositories when no repos folder is set', async () => {
      const payload = await pullRequestBoardPayload(ctx)

      expect(payload.repositories).toEqual({ repos_folder: null, current_repo_path: null, current_repo_slug: null, items: [] })
    })
  })

  describe('repositoriesPayload', () => {
    test('lists the repos folder checkouts and flags the current one', async () => {
      const otherName = 'web'
      const otherSlug = `${repoOwner}/${otherName}`
      const otherPath = await createGitRepository(reposFolder.path, otherName, otherSlug)
      settingStore.setReposFolder(reposFolder.path)
      settingStore.setCurrentRepo(repoPath)

      const payload = await repositoriesPayload(ctx)

      expect(payload).toEqual({
        repos_folder: reposFolder.path,
        current_repo_path: repoPath,
        current_repo_slug: repoSlug,
        items: [
          { name: repoName, path: repoPath, branch: expect.any(String), slug: repoSlug, current: true },
          { name: otherName, path: otherPath, branch: expect.any(String), slug: otherSlug, current: false },
        ],
      })
    })
  })

  describe('reviewTaskBoardPayload', () => {
    test('groups tasks by state with their compact pull request', async () => {
      const { pullRequest, reviewTask } = arrangeFrontendSurface()

      const payload = await reviewTaskBoardPayload(ctx)

      expect(payload.current_repo).toEqual({ path: repoPath, slug: repoSlug, name: repoName })
      expect(payload.columns.reviewed).toHaveLength(1)
      expect(payload.counts).toEqual({ queued: 0, pending_review: 0, in_review: 0, reviewed: 1, waiting_implementation: 0, done: 0, failed_review: 0 })
      expect(payload.total_count).toBe(1)
      expect(payload.columns.reviewed[0]).toMatchObject({
        id: reviewTask.id,
        archived: false,
        retry_count: 0,
        max_retry_attempts: MAX_RETRY_ATTEMPTS,
        can_retry: true,
        queue_position: null,
        has_review_history: false,
        current_iteration_number: 0,
        swarm_review: false,
        snapshot_current: true,
        pull_request: {
          id: pullRequest.id,
          number: pullRequest.number,
          title: pullRequest.title,
          author: pullRequest.author,
          repo_name: repoName,
          repo_full_name: repoSlug,
          review_status: 'pending_review',
          remote_state: 'open',
          snapshot_status: 'current',
          additions: pullRequest.additions,
          deletions: pullRequest.deletions,
          changed_files: pullRequest.changedFiles,
        },
      })
    })

    test('lists newest tasks first and skips archived ones', async () => {
      const insertDoneTask = (hoursOld: number, archived = false) =>
        insertReviewTask(ctx.db, { pullRequestId: insertPullRequest(ctx.db).id, state: 'done', archived, createdAt: secondsAgo(hoursOld * 3600) })
      const older = insertDoneTask(3)
      const newer = insertDoneTask(1)
      insertDoneTask(2, true)

      const payload = await reviewTaskBoardPayload(ctx)

      expect(payload.columns.done.map(({ id }) => id)).toEqual([newer.id, older.id])
    })

    test('orders the queue by created_at desc before queued_at, as the Rails relation does', async () => {
      const createdAt = new Date()
      const queuedFirst = insertReviewTask(ctx.db, { pullRequestId: insertPullRequest(ctx.db).id, state: 'queued', createdAt, queuedAt: secondsAgo(60) })
      const queuedSecond = insertReviewTask(ctx.db, { pullRequestId: insertPullRequest(ctx.db).id, state: 'queued', createdAt, queuedAt: secondsAgo(30) })
      const newest = insertReviewTask(ctx.db, {
        pullRequestId: insertPullRequest(ctx.db).id,
        state: 'queued',
        createdAt: new Date(createdAt.getTime() + 1000),
        queuedAt: new Date(),
      })

      const payload = await reviewTaskBoardPayload(ctx)

      expect(payload.columns.queued.map(({ id }) => id)).toEqual([newest.id, queuedFirst.id, queuedSecond.id])
      expect(payload.columns.queued.map(({ queue_position }) => queue_position)).toEqual([3, 1, 2])
    })

    test('flags tasks reviewed against an older snapshot as stale', async () => {
      const pullRequest = insertPullRequest(ctx.db)
      const oldSnapshot = insertSnapshot(ctx.db, { pullRequestId: pullRequest.id, status: 'stale' })
      insertSnapshot(ctx.db, { pullRequestId: pullRequest.id, status: 'current' })
      insertReviewTask(ctx.db, { pullRequestId: pullRequest.id, state: 'reviewed', reviewOutput: 'done', pullRequestSnapshotId: oldSnapshot.id })

      const payload = await reviewTaskBoardPayload(ctx)

      expect(payload.columns.reviewed[0]).toMatchObject({
        pull_request_snapshot_id: oldSnapshot.id,
        analysis_status: 'stale',
        snapshot_current: false,
      })
    })

    test('still renders a task whose pull request was archived (Rails raised here)', async () => {
      const pullRequest = insertPullRequest(ctx.db, { archived: true })
      const task = insertReviewTask(ctx.db, { pullRequestId: pullRequest.id, state: 'done' })

      const payload = await reviewTaskBoardPayload(ctx)

      expect(payload.columns.done[0]).toMatchObject({ id: task.id, pull_request: { id: pullRequest.id } })
    })
  })

  describe('reviewTaskDetailPayload', () => {
    test('returns comments, logs and submission data of the frontend surface', async () => {
      const { reviewTask, comment, log, reviewOutput } = arrangeFrontendSurface()

      const payload = await reviewTaskDetailPayload(ctx, reviewTask)

      expect(payload.content_mode).toBe('comments')
      expect(payload.task).toMatchObject({ id: reviewTask.id, state: 'reviewed' })
      expect(payload.comments).toEqual([
        {
          id: comment.id,
          title: comment.title,
          severity: comment.severity,
          status: comment.status,
          body: comment.body,
          body_html: renderMarkdown(comment.body),
          file_path: comment.filePath,
          line_number: comment.lineNumber,
          location: `${comment.filePath}:${comment.lineNumber}`,
          resolution_note: null,
          actionable: true,
        },
      ])
      expect(payload.live_logs).toEqual([{ id: log.id, log_type: log.logType, message: log.message, created_at: iso8601(log.createdAt) }])
      expect(payload.submission).toEqual({
        auto_submit_enabled: true,
        pending_comment_count: 1,
        severity_counts: { critical: 0, major: 1, minor: 0, suggestion: 0, nitpick: 0 },
        allowed_events: ['COMMENT', 'APPROVE', 'REQUEST_CHANGES'],
      })
      expect(payload.raw_output).toBe(reviewOutput)
      expect(payload.raw_output_html).toBe(renderMarkdown(reviewOutput))
      expect(payload.parsed_review_items).toEqual([])
      expect(payload.review_history).toEqual([])
      expect(payload.meta).toEqual({ formatted_duration: null })
    })

    test('orders comments by severity and counts only pending ones', async () => {
      const task = insertReviewTask(ctx.db, { pullRequestId: insertPullRequest(ctx.db).id, state: 'reviewed' })
      const nitpick = insertReviewComment(ctx.db, { reviewTaskId: task.id, severity: 'nitpick' })
      const critical = insertReviewComment(ctx.db, { reviewTaskId: task.id, severity: 'critical' })
      const addressedMajor = insertReviewComment(ctx.db, { reviewTaskId: task.id, severity: 'major', status: 'addressed', lineNumber: null })
      const pendingComments = [nitpick, critical]

      const payload = await reviewTaskDetailPayload(ctx, task)

      expect(payload.comments.map(({ id }) => id)).toEqual([critical.id, addressedMajor.id, nitpick.id])
      expect(payload.comments[1]).toMatchObject({ status: 'addressed', location: addressedMajor.filePath, actionable: true })
      expect(payload.comments[2]?.actionable).toBe(false)
      expect(payload.submission.pending_comment_count).toBe(pendingComments.length)
      expect(payload.submission.severity_counts).toEqual({ critical: 1, major: 0, minor: 0, suggestion: 0, nitpick: 1 })
    })

    test('presents parsed review findings when the output has a json block', async () => {
      const codeFinding = { title: 'Null guard', severity: 'critical', file: 'app/models/user.rb', lines: '10-12', comment: 'Guard **nil**.', suggested_fix: 'user&.name || "anonymous"' }
      const proseFinding = { severity: 'concern', file: 'Unknown', comment: 'Rename this. It is unclear', suggested_fix: 'Use a clearer name' }
      const reviewOutput = jsonBlock([codeFinding, proseFinding])
      const task = insertReviewTask(ctx.db, { pullRequestId: insertPullRequest(ctx.db).id, state: 'reviewed', reviewOutput })

      const payload = await reviewTaskDetailPayload(ctx, task)

      expect(payload.content_mode).toBe('parsed_review_items')
      expect(payload.parsed_review_items).toEqual([
        {
          title: codeFinding.title,
          severity: 'error',
          severity_emoji: severityEmoji('error'),
          file: codeFinding.file,
          lines: codeFinding.lines,
          location: `${codeFinding.file}:${codeFinding.lines}`,
          comment: codeFinding.comment,
          comment_html: renderMarkdown(codeFinding.comment),
          suggested_fix: codeFinding.suggested_fix,
          suggested_fix_is_code: true,
          suggested_fix_html: renderCodeBlock(codeFinding.suggested_fix, 'ruby'),
        },
        {
          title: 'Rename this',
          severity: 'warning',
          severity_emoji: severityEmoji('warning'),
          file: 'N/A',
          lines: null,
          location: 'N/A',
          comment: proseFinding.comment,
          comment_html: renderMarkdown(proseFinding.comment),
          suggested_fix: proseFinding.suggested_fix,
          suggested_fix_is_code: false,
          suggested_fix_html: renderMarkdown(proseFinding.suggested_fix),
        },
      ])
    })

    test('renders blank finding text as null html', async () => {
      const task = insertReviewTask(ctx.db, {
        pullRequestId: insertPullRequest(ctx.db).id,
        state: 'reviewed',
        reviewOutput: jsonBlock([{ file: 'a.rb', comment: '', suggested_fix: '' }]),
      })

      const payload = await reviewTaskDetailPayload(ctx, task)

      expect(payload.parsed_review_items[0]).toMatchObject({ comment_html: null, suggested_fix: '', suggested_fix_is_code: false, suggested_fix_html: null })
    })

    const contentModeCases: Array<[ContentMode, string, string | null]> = [
      ['raw_output', 'reviewed', 'Plain review text'],
      ['live_logs', 'in_review', null],
      ['live_logs', 'pending_review', null],
      ['empty', 'done', null],
      ['empty', 'failed_review', '   '],
    ]
    test.each(contentModeCases)('uses content mode %p for a %p task with output %p', async (contentMode, state, reviewOutput) => {
      const task = insertReviewTask(ctx.db, { pullRequestId: insertPullRequest(ctx.db).id, state, reviewOutput })

      const payload = await reviewTaskDetailPayload(ctx, task)

      expect(payload.content_mode).toBe(contentMode)
    })

    test('formats the review duration', async () => {
      const durationSeconds = 330
      const startedAt = secondsAgo(durationSeconds)
      const completedAt = new Date(startedAt.getTime() + durationSeconds * 1000)
      const task = insertReviewTask(ctx.db, { pullRequestId: insertPullRequest(ctx.db).id, state: 'reviewed', startedAt, completedAt })

      const payload = await reviewTaskDetailPayload(ctx, task)

      expect(payload.meta.formatted_duration).toBe(formatReviewDuration(startedAt, completedAt))
      expect(payload.task).toMatchObject({ started_at: iso8601(startedAt), completed_at: iso8601(completedAt) })
    })

    test('presents review history in iteration order', async () => {
      const task = insertReviewTask(ctx.db, { pullRequestId: insertPullRequest(ctx.db).id, state: 'pending_review' })
      const startedAt = secondsAgo(120)
      const durationSeconds = 45
      const rawOutput = 'Earlier **review**'
      const second = insertReviewIteration(ctx.db, { reviewTaskId: task.id, iterationNumber: 2, reviewOutput: rawOutput })
      const first = insertReviewIteration(ctx.db, {
        reviewTaskId: task.id,
        iterationNumber: 1,
        reviewOutput: jsonBlock([{ file: 'a.rb', comment: 'Fix it' }]),
        startedAt,
        completedAt: new Date(startedAt.getTime() + durationSeconds * 1000),
      })
      const third = insertReviewIteration(ctx.db, { reviewTaskId: task.id, iterationNumber: 3 })

      const payload = await reviewTaskDetailPayload(ctx, task)

      expect(payload.task).toMatchObject({ has_review_history: true, current_iteration_number: 3 })
      expect(payload.review_history.map(({ id }) => id)).toEqual([first.id, second.id, third.id])
      expect(payload.review_history.map(({ output_mode }) => output_mode)).toEqual(['parsed_review_items', 'raw_output', 'empty'])
      expect(payload.review_history[0]).toMatchObject({ duration_seconds: durationSeconds, started_at: iso8601(startedAt), parsed_review_items: [expect.objectContaining({ file: 'a.rb' })] })
      expect(payload.review_history[1]).toMatchObject({ raw_output: rawOutput, raw_output_html: renderMarkdown(rawOutput), duration_seconds: null })
      expect(payload.review_history[2]).toMatchObject({ raw_output: null, raw_output_html: null })
    })

    test('lists live logs oldest first', async () => {
      const task = insertReviewTask(ctx.db, { pullRequestId: insertPullRequest(ctx.db).id, state: 'in_review' })
      const newer = insertAgentLog(ctx.db, { reviewTaskId: task.id, createdAt: secondsAgo(10) })
      const older = insertAgentLog(ctx.db, { reviewTaskId: task.id, createdAt: secondsAgo(20) })

      const payload = await reviewTaskDetailPayload(ctx, task)

      expect(payload.live_logs.map(({ id }) => id)).toEqual([older.id, newer.id])
    })
  })
})
