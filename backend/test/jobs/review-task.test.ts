import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { RunOptions } from '../../src/commands/runner'
import { reviewTaskJob, type ReviewJobDependencies } from '../../src/jobs/handlers/review-task'
import { truncate } from '../../src/lib/ruby'
import { recentLogs } from '../../src/models/agent-log'
import { findPullRequestUnscoped, type PullRequestRecord } from '../../src/models/pull-request'
import { commentsBySeverity } from '../../src/models/review-comment'
import { addLog, backoffSeconds, findReviewTask, incrementRetry, MAX_RETRY_ATTEMPTS, updateReviewTask, type ReviewTaskRecord } from '../../src/models/review-task'
import { SettingStore } from '../../src/models/setting'
import { STREAMS } from '../../src/realtime/broadcaster'
import type { GithubCliClient } from '../../src/services/github-cli-client'
import { AuthenticationError, NetworkError } from '../../src/services/review-errors'
import { WORKTREES_DIR, WorktreeNetworkError } from '../../src/services/worktree'
import { createTestContext, type TestContext } from '../support/context'
import { insertPullRequest, insertReviewTask } from '../support/factories'
import { createGitRepository, createTempFolder, stubGitRepository } from '../support/git'

const ENV_KEYS = ['HOME', 'ANTHROPIC_MODEL', 'CLAUDE_MODEL']
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))

const aiModel = 'claude-3.5-sonnet'
const reviewOutput = 'Review output line 1\nReview output line 2\n'
const reviewLines = ['Review output line 1', 'Review output line 2']

let ctx: TestContext
let repo: ReturnType<typeof createTempFolder>
let home: ReturnType<typeof createTempFolder>
let pullRequest: PullRequestRecord
let task: ReviewTaskRecord
let worktreePath: string

const githubClient: GithubCliClient = {
  fetchPrComments: async () => [],
  reviewRequestedForMe: async () => false,
  latestMyReviewState: async () => null,
}
const deps: ReviewJobDependencies = { githubClientFor: async () => githubClient }

function restoreEnv() {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

// gh/git succeed; `git worktree add` creates the directory like git would.
function scriptWorktree() {
  ctx.commands.on(['gh', 'pr', 'view'], { stdout: JSON.stringify({ headRefName: 'feature/test' }) })
  ctx.commands.on(['git', '-C', repo.path, 'fetch'], { success: true })
  ctx.commands.on(['git', '-C', repo.path, 'worktree', 'add'], (command) => {
    const path = command[5]
    if (path !== undefined) mkdirSync(path, { recursive: true })
    return { success: true }
  })
  ctx.commands.on(['git', '-C', repo.path, 'worktree', 'remove'], { success: true })
}

function scriptReview(handler: string | ((command: string[], options: RunOptions) => { stdout: string })) {
  ctx.commands.on(['claude', '-p'], typeof handler === 'string' ? { stdout: handler } : handler)
}

function failReviewWith(error: Error) {
  scriptReview(() => {
    throw error
  })
}

function failWorktreeWith(error: Error) {
  ctx.commands.on(['gh', 'pr', 'view'], { stdout: JSON.stringify({ headRefName: 'feature/test' }) })
  ctx.commands.on(['git', '-C', repo.path, 'fetch'], { success: true })
  ctx.commands.on(['git', '-C', repo.path, 'worktree', 'add'], () => {
    throw error
  })
}

function run(isRetry = false) {
  return reviewTaskJob(ctx, { reviewTaskId: task.id, isRetry }, deps)
}

function reloaded() {
  return findReviewTask(ctx.db, task.id)
}

function logMessages() {
  return recentLogs(ctx.db, task.id).map((log) => log.message ?? '')
}

function logStream() {
  return ctx.events.on(STREAMS.reviewTaskLogs(task.id))
}

function cleanupCalls() {
  return ctx.commands.commandsMatching(['git', '-C', repo.path, 'worktree', 'remove', '--force'])
}

function enqueuedJobs(name: string) {
  return ctx.jobs.all().filter((job) => job.name === name)
}

beforeEach(() => {
  ctx = createTestContext()
  repo = createTempFolder()
  home = createTempFolder()
  process.env.HOME = home.path
  process.env.ANTHROPIC_MODEL = aiModel
  delete process.env.CLAUDE_MODEL

  new SettingStore(ctx.db).setCurrentRepo(repo.path)
  pullRequest = insertPullRequest(ctx.db, { title: 'Test PR', reviewStatus: 'pending_review' })
  task = insertReviewTask(ctx.db, { pullRequestId: pullRequest.id, state: 'pending_review', cliClient: 'claude', reviewType: 'review' })
  worktreePath = join(repo.path, WORKTREES_DIR, `pr-${pullRequest.number}`)
})

afterEach(() => {
  restoreEnv()
  repo.remove()
  home.remove()
})

describe('reviewTaskJob happy path', () => {
  test('builds the worktree, stores the model, streams output, completes and cleans up', async () => {
    scriptWorktree()
    scriptReview(reviewOutput)

    await run()

    const reviewed = reloaded()
    expect(reviewed).toMatchObject({ state: 'reviewed', aiModel, retryCount: 0, reviewOutput, worktreePath })
    expect(reviewed.startedAt).not.toBeNull()
    expect(reviewed.completedAt).not.toBeNull()
    expect(findPullRequestUnscoped(ctx.db, pullRequest.id)?.reviewStatus).toBe('reviewed_by_me')
    expect(logMessages()).toEqual([
      'Starting review...',
      'Fetching PR from GitHub...',
      `Worktree ready at ${worktreePath}`,
      `Using model: ${aiModel}`,
      'Running claude review...',
      ...reviewLines,
      'Review completed!',
    ])
    expect(cleanupCalls()).toHaveLength(1)
    expect(enqueuedJobs('ProcessReviewQueueJob')).toHaveLength(1)
  })

  test('runs the CLI inside the worktree with the review prompt', async () => {
    scriptWorktree()
    scriptReview(reviewOutput)

    await run()

    const [reviewCall] = ctx.commands.commandsMatching(['claude', '-p'])
    expect(reviewCall?.options.cwd).toBe(worktreePath)
    expect(reviewCall?.command[2]).toContain(`Review PR #${pullRequest.number}: ${pullRequest.title}`)
  })

  test('does not clear logs or reset retry state on retry', async () => {
    const existingLog = 'Existing log'
    const retryCount = 1
    addLog(ctx, task, existingLog, 'status')
    task = incrementRetry(ctx, task, 'Previous error')
    scriptWorktree()
    scriptReview(reviewOutput)

    await run(true)

    expect(logMessages()).toContain(existingLog)
    expect(reloaded()).toMatchObject({ state: 'reviewed', retryCount })
  })

  test('clears logs and resets retry state on initial attempt', async () => {
    const oldLog = 'Old log'
    addLog(ctx, task, oldLog, 'status')
    task = incrementRetry(ctx, task, 'Previous error')
    scriptWorktree()
    scriptReview(reviewOutput)

    await run(false)

    expect(logMessages()).not.toContain(oldLog)
    expect(reloaded()).toMatchObject({ state: 'reviewed', retryCount: 0, failureReason: null, retryHistory: null, lastRetryAt: null })
  })

  test('creates and logs review comments', async () => {
    const finding = { severity: 'warning', file: 'app/models/user.rb', lines: '12', comment: 'May be nil', suggested_fix: null }
    scriptWorktree()
    scriptReview(`Summary\n\`\`\`json\n${JSON.stringify([finding])}\n\`\`\`\n`)

    await run()

    expect(commentsBySeverity(ctx.db, task.id)).toEqual([expect.objectContaining({ filePath: finding.file, body: finding.comment })])
    expect(logMessages()).toContain('Created 1 review comments')
  })

  test('does not log a comment count when there are no findings', async () => {
    scriptWorktree()
    scriptReview(reviewOutput)

    await run()

    expect(logMessages().some((message) => message.startsWith('Created'))).toBe(false)
  })
})

describe('reviewTaskJob validation errors', () => {
  test('fails the review for blank output', async () => {
    scriptWorktree()
    scriptReview('')

    await run()

    const failed = reloaded()
    expect(failed.state).toBe('failed_review')
    expect(failed.failureReason).toBe('Review failed (permanent failure): Review produced empty output')
  })

  test('fails the review for truncated error output', async () => {
    scriptWorktree()
    scriptReview('Error:\nError:\nError:\nError:\n')

    await run()

    const failed = reloaded()
    expect(failed.state).toBe('failed_review')
    expect(failed.failureReason).toBe('Review failed (permanent failure): Review produced truncated error output')
    expect(findPullRequestUnscoped(ctx.db, pullRequest.id)?.reviewStatus).toBe('review_failed')
  })

  test('accepts output mentioning "Error:" once it has five lines', async () => {
    const output = 'Error: handling looks fine\nline 2\nline 3\nline 4\nline 5\n'
    scriptWorktree()
    scriptReview(output)

    await run()

    expect(reloaded()).toMatchObject({ state: 'reviewed', reviewOutput: output })
  })
})

describe('reviewTaskJob transient errors', () => {
  test('a worktree NetworkError schedules a retry with backoff', async () => {
    const message = 'Network failure'
    failWorktreeWith(new WorktreeNetworkError(message))

    await run()

    const backoff = backoffSeconds(reloaded())
    expect(reloaded()).toMatchObject({ state: 'pending_review', retryCount: 1, failureReason: message })
    expect(logMessages()).toContain(`Network error: ${message}`)
    expect(logMessages()).toContain(`Scheduling retry 1/${MAX_RETRY_ATTEMPTS} in ${backoff}s...`)
    const [retryJob] = enqueuedJobs('ReviewTaskJob')
    expect(retryJob && JSON.parse(retryJob.payload)).toEqual({ reviewTaskId: task.id, isRetry: true })
    expect(retryJob && retryJob.runAt.getTime() - retryJob.createdAt.getTime()).toBe(backoff * 1000)
    expect(enqueuedJobs('ProcessReviewQueueJob')).toHaveLength(1)
  })

  test('a ReviewErrors::TransientError schedules a retry logged with its class name', async () => {
    const message = 'Rate limited'
    scriptWorktree()
    failReviewWith(new NetworkError(message))

    await run()

    expect(reloaded().retryCount).toBe(1)
    expect(logMessages()).toContain(`NetworkError: ${message}`)
  })

  test('marks failed when max retries exhausted', async () => {
    const message = 'Network failure'
    task = updateReviewTask(ctx, task, { retryCount: MAX_RETRY_ATTEMPTS })
    failWorktreeWith(new WorktreeNetworkError(message))

    await run()

    expect(reloaded()).toMatchObject({
      state: 'failed_review',
      retryCount: MAX_RETRY_ATTEMPTS,
      failureReason: `Review failed (after ${MAX_RETRY_ATTEMPTS} retries): ${message}`,
    })
    expect(enqueuedJobs('ReviewTaskJob')).toEqual([])
  })
})

describe('reviewTaskJob permanent and unknown errors', () => {
  test('a permanent error marks failed immediately', async () => {
    const message = 'Bad credentials'
    scriptWorktree()
    failReviewWith(new AuthenticationError(message))

    await run()

    expect(reloaded()).toMatchObject({ state: 'failed_review', retryCount: 0, failureReason: `Review failed (permanent failure): ${message}` })
    expect(logMessages()).toEqual(
      expect.arrayContaining([`Permanent error: ${message}`, 'This error cannot be resolved by retrying']),
    )
    expect(enqueuedJobs('ReviewTaskJob')).toEqual([])
  })

  test('an unknown retryable error schedules a retry', async () => {
    const message = 'Something flaky'
    scriptWorktree()
    failReviewWith(new Error(message))

    await run()

    expect(reloaded().retryCount).toBe(1)
    expect(logMessages()).toContain(`Error (will retry): ${message}`)
    expect(enqueuedJobs('ReviewTaskJob')).toHaveLength(1)
  })

  test('an unknown error marks failed when retries are exhausted', async () => {
    const message = 'Unknown error'
    task = updateReviewTask(ctx, task, { retryCount: MAX_RETRY_ATTEMPTS })
    scriptWorktree()
    failReviewWith(new Error(message))

    await run()

    expect(reloaded()).toMatchObject({ state: 'failed_review', failureReason: `Review failed (retries exhausted): ${message}` })
    expect(logMessages()).toContain(`Error: ${message}`)
  })

  test('a programming error marks failed immediately as non-retryable', async () => {
    const message = 'Invalid argument'
    scriptWorktree()
    failReviewWith(new TypeError(message))

    await run()

    expect(reloaded()).toMatchObject({ state: 'failed_review', retryCount: 0, failureReason: `Review failed (non-retryable): ${message}` })
  })
})

describe('reviewTaskJob cleanup', () => {
  test('cleans up the worktree when worktree_path is present', async () => {
    scriptWorktree()
    scriptReview(reviewOutput)

    await run()

    expect(cleanupCalls().map((call) => call.command.at(-1))).toEqual([worktreePath])
  })

  test('cleans up the worktree even when an error occurs', async () => {
    scriptWorktree()
    failReviewWith(new Error('Test error'))

    await run()

    expect(cleanupCalls()).toHaveLength(1)
    expect(enqueuedJobs('ProcessReviewQueueJob')).toHaveLength(1)
  })

  test('does not clean up when the worktree was never created', async () => {
    failWorktreeWith(new WorktreeNetworkError('Network failure'))

    await run()

    expect(cleanupCalls()).toEqual([])
    expect(enqueuedJobs('ProcessReviewQueueJob')).toHaveLength(1)
  })

  test('returns early without touching anything when the repo path is blank', async () => {
    new SettingStore(ctx.db).setCurrentRepo(null)

    await run()

    expect(reloaded().state).toBe('pending_review')
    expect(ctx.commands.calls).toEqual([])
    expect(logMessages()).toEqual([])
    expect(ctx.jobs.all()).toEqual([])
  })
})

describe('reviewTaskJob broadcasts', () => {
  test('broadcasts preparing at start', async () => {
    scriptWorktree()
    scriptReview(reviewOutput)

    await run()

    expect(logStream()).toContainEqual({ type: 'preparing', review_task_id: task.id, state: 'pending_review' })
  })

  test('streams each log line to the task stream', async () => {
    scriptWorktree()
    scriptReview(reviewOutput)

    await run()

    const streamedMessages = logStream().map((message) => message.message)
    for (const line of reviewLines) expect(streamedMessages).toContain(line)
  })

  test('broadcasts completion on success', async () => {
    scriptWorktree()
    scriptReview(reviewOutput)

    await run()

    expect(logStream()).toContainEqual({ type: 'completed', review_task_id: task.id, state: 'reviewed' })
    expect(ctx.events.on(STREAMS.reviewNotifications)).toEqual([
      { type: 'review_completed', review_task_id: task.id, pr_number: pullRequest.number, pr_title: pullRequest.title, reason: null },
    ])
  })

  test('broadcasts failure with the truncated reason', async () => {
    const message = `Bad credentials ${'x'.repeat(150)}`
    scriptWorktree()
    failReviewWith(new AuthenticationError(message))

    await run()

    const failureReason = `Review failed (permanent failure): ${message}`
    expect(logStream()).toContainEqual({ type: 'failed', review_task_id: task.id, state: 'failed_review' })
    expect(ctx.events.on(STREAMS.reviewNotifications)).toEqual([
      { type: 'review_failed', review_task_id: task.id, pr_number: pullRequest.number, pr_title: pullRequest.title, reason: truncate(failureReason, 100) },
    ])
  })

  test('broadcasts retry scheduled with backoff info', async () => {
    failWorktreeWith(new WorktreeNetworkError('Network failure'))

    await run()

    const retried = reloaded()
    expect(logStream()).toContainEqual({
      type: 'retry_scheduled',
      review_task_id: task.id,
      retry_count: retried.retryCount,
      max_retries: MAX_RETRY_ATTEMPTS,
      backoff_seconds: backoffSeconds(retried),
    })
    expect(retried.retryCount).toBe(1)
  })
})

describe('reviewTaskJob logging', () => {
  test('logs model detection when known', async () => {
    scriptWorktree()
    scriptReview(reviewOutput)

    await run()

    expect(logMessages()).toContain(`Using model: ${aiModel}`)
  })

  test('does not log the model when unknown', async () => {
    task = updateReviewTask(ctx, task, { cliClient: 'codex' })
    scriptWorktree()
    ctx.commands.on(['codex', 'exec'], { stdout: reviewOutput })

    await run()

    expect(reloaded().aiModel).toBe('unknown')
    expect(logMessages().some((message) => message.includes('Using model:'))).toBe(false)
    expect(logMessages()).toContain('Running codex review...')
  })

  test('logs retry info on retry attempt', async () => {
    task = updateReviewTask(ctx, task, { retryCount: 1 })
    scriptWorktree()
    scriptReview(reviewOutput)

    await run(true)

    expect(logMessages()[0]).toBe(`Retry attempt 2/${MAX_RETRY_ATTEMPTS}...`)
  })

  test('logs starting info on initial attempt', async () => {
    scriptWorktree()
    scriptReview(reviewOutput)

    await run(false)

    expect(logMessages()[0]).toBe('Starting review...')
  })
})

describe('reviewTaskJob lookups', () => {
  test('raises when the task does not exist', async () => {
    const missingId = task.id + 1000

    await expect(reviewTaskJob(ctx, { reviewTaskId: missingId, isRetry: false }, deps)).rejects.toThrow(`'id'=${missingId}`)
  })
})

describe('reviewTaskJob review context', () => {
  test('passes the reviewer focus into the prompt', async () => {
    const focus = 'check the migration is safe to run online'
    task = updateReviewTask(ctx, task, { reviewFocus: focus })
    const prompts: string[] = []
    scriptWorktree()
    scriptReview((command) => {
      prompts.push(command.join(' '))
      return { stdout: reviewOutput }
    })

    await run()

    expect(prompts.some((prompt) => prompt.includes(`## Reviewer Focus`) && prompt.includes(focus))).toBe(true)
  })

  test('reviews a pull request from another repository in that repository\'s checkout', async () => {
    const reposFolder = createTempFolder()
    try {
      stubGitRepository(ctx.commands, repo.path, 'acme/web')
      const otherCheckout = createGitRepository(ctx.commands, reposFolder.path, 'api', `${pullRequest.repoOwner}/${pullRequest.repoName}`)
      new SettingStore(ctx.db).setReposFolder(reposFolder.path)
      ctx.commands.on(['gh', 'pr', 'view'], { stdout: JSON.stringify({ headRefName: 'feature/test' }) })
      ctx.commands.on(['git', '-C', otherCheckout, 'fetch'], { success: true })
      ctx.commands.on(['git', '-C', otherCheckout, 'worktree', 'add'], (command) => {
        const path = command[5]
        if (path !== undefined) mkdirSync(path, { recursive: true })
        return { success: true }
      })
      ctx.commands.on(['git', '-C', otherCheckout, 'worktree', 'remove'], { success: true })
      scriptReview(reviewOutput)

      await run()

      expect(reloaded().state).toBe('reviewed')
      expect(ctx.commands.commandsMatching(['git', '-C', otherCheckout, 'fetch']).length).toBeGreaterThan(0)
      expect(ctx.commands.commandsMatching(['git', '-C', repo.path, 'fetch'])).toEqual([])
    } finally {
      reposFolder.remove()
    }
  })

  test('fails clearly when the pull request\'s repository has no local checkout', async () => {
    const failed = 'failed_review'
    stubGitRepository(ctx.commands, repo.path, 'acme/web')

    await run()

    const reviewed = reloaded()
    expect(reviewed.state).toBe(failed)
    expect(reviewed.failureReason).toContain(`${pullRequest.repoOwner}/${pullRequest.repoName}`)
    expect(ctx.commands.commandsMatching(['gh', 'pr', 'view'])).toEqual([])
    expect(enqueuedJobs('ProcessReviewQueueJob')).toHaveLength(1)
  })
})
