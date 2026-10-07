import type { AppContext } from '../../context'
import { RecordNotFoundError } from '../../lib/errors'
import { logger } from '../../lib/logger'
import { isBlank, isPresent, truncate } from '../../lib/ruby'
import { findPullRequestUnscoped, type PullRequestRecord } from '../../models/pull-request'
import {
  addLog,
  backoffSeconds,
  canRetry,
  clearLogs,
  completeReview,
  findReviewTask,
  incrementRetry,
  markFailed,
  MAX_RETRY_ATTEMPTS,
  resetRetryState,
  startReview,
  updateReviewTask,
  type ReviewTaskRecord,
} from '../../models/review-task'
import { SettingStore } from '../../models/setting'
import { STREAMS } from '../../realtime/broadcaster'
import { repoFullName } from '../../realtime/ui-events'
import { CodeReviewService } from '../../services/code-review'
import type { GithubCliClient } from '../../services/github-cli-client'
import { UNKNOWN_MODEL } from '../../services/model-detector'
import { resolveRepoSlug } from '../../services/repo-switch-resolver'
import { slugFromPath } from '../../services/repo-slug-resolver'
import { persistCommentsForReviewTask } from '../../services/review-comment-builder'
import { classifyError, PermanentError, TransientError, ValidationError } from '../../services/review-errors'
import { WorktreeNetworkError, WorktreeService } from '../../services/worktree'

// Port of ReviewTaskJob: builds a worktree for the PR, runs the AI review CLI,
// stores the output and comments, and retries transient failures with backoff.
export interface ReviewJobDependencies {
  githubClientFor(repoPath: string): Promise<GithubCliClient>
}

export interface ReviewTaskJobPayload {
  reviewTaskId: number
  isRetry: boolean
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

// Ruby String#chomp: one trailing line ending.
function chomp(line: string) {
  return line.replace(/\r?\n$|\r$/, '')
}

// Ruby String#lines.size
function lineCount(text: string) {
  return text.split(/(?<=\n)/).filter((line) => line !== '').length
}

// `review_task.pull_request`. Rails' default scope would hide an archived PR
// and crash mid-job; the models in this port load it unscoped.
function pullRequestOf(ctx: AppContext, task: ReviewTaskRecord) {
  const pullRequest = findPullRequestUnscoped(ctx.db, task.pullRequestId)
  if (!pullRequest) throw new RecordNotFoundError('PullRequest', task.pullRequestId)
  return pullRequest
}

function validateReviewOutput(output: string) {
  if (isBlank(output)) throw new ValidationError('Review produced empty output')

  // A short output mentioning "Error:" is a failed run, not a review.
  if (output.includes('Error:') && lineCount(output) < 5) {
    throw new ValidationError('Review produced truncated error output')
  }
}

function broadcastPreparing(ctx: AppContext, task: ReviewTaskRecord) {
  ctx.events.broadcast(STREAMS.reviewTaskLogs(task.id), { type: 'preparing', review_task_id: task.id, state: task.state })
}

function broadcastCompletion(ctx: AppContext, task: ReviewTaskRecord, pullRequest: PullRequestRecord, failed = false) {
  // Task detail page.
  ctx.events.broadcast(STREAMS.reviewTaskLogs(task.id), {
    type: failed ? 'failed' : 'completed',
    review_task_id: task.id,
    state: task.state,
  })

  // Global toast notifications. The task id lets a click open this exact review:
  // PR numbers are only unique per repository.
  ctx.events.broadcast(STREAMS.reviewNotifications, {
    type: failed ? 'review_failed' : 'review_completed',
    review_task_id: task.id,
    pr_number: pullRequest.number,
    pr_title: pullRequest.title,
    reason: failed && task.failureReason !== null ? truncate(task.failureReason, 100) : null,
  })
}

function broadcastRetryScheduled(ctx: AppContext, task: ReviewTaskRecord, backoff: number) {
  ctx.events.broadcast(STREAMS.reviewTaskLogs(task.id), {
    type: 'retry_scheduled',
    review_task_id: task.id,
    retry_count: task.retryCount,
    max_retries: MAX_RETRY_ATTEMPTS,
    backoff_seconds: backoff,
  })
}

function logRetryInfo(ctx: AppContext, task: ReviewTaskRecord, isRetry: boolean) {
  if (isRetry) {
    addLog(ctx, task, `Retry attempt ${task.retryCount + 1}/${MAX_RETRY_ATTEMPTS}...`, 'status')
  } else {
    addLog(ctx, task, 'Starting review...', 'status')
  }
}

function scheduleRetry(ctx: AppContext, task: ReviewTaskRecord, error: unknown) {
  const retried = incrementRetry(ctx, task, errorMessage(error))
  const backoff = backoffSeconds(retried)

  addLog(ctx, retried, `Scheduling retry ${retried.retryCount}/${MAX_RETRY_ATTEMPTS} in ${backoff}s...`, 'status')
  broadcastRetryScheduled(ctx, retried, backoff)

  ctx.jobs.enqueue('ReviewTaskJob', { reviewTaskId: retried.id, isRetry: true }, { waitSeconds: backoff })
  return retried
}

function finalizeAsFailed(ctx: AppContext, task: ReviewTaskRecord, pullRequest: PullRequestRecord, error: unknown, context: string) {
  const failureMessage = `Review failed (${context}): ${errorMessage(error)}`
  addLog(ctx, task, failureMessage, 'error')
  const failed = markFailed(ctx, task, failureMessage)
  broadcastCompletion(ctx, failed, pullRequest, true)
  return failed
}

function handleTransientError(ctx: AppContext, task: ReviewTaskRecord, pullRequest: PullRequestRecord, error: unknown, errorType: string) {
  const message = errorMessage(error)
  logger.error(`Review task ${task.id} ${errorType}: ${message}`)
  addLog(ctx, task, `${errorType}: ${message}`, 'error')

  if (canRetry(task)) return scheduleRetry(ctx, task, error)
  return finalizeAsFailed(ctx, task, pullRequest, error, `after ${task.retryCount} retries`)
}

function handlePermanentError(ctx: AppContext, task: ReviewTaskRecord, pullRequest: PullRequestRecord, error: unknown) {
  const message = errorMessage(error)
  logger.error(`Review task ${task.id} permanent failure: ${message}`)
  addLog(ctx, task, `Permanent error: ${message}`, 'error')
  addLog(ctx, task, 'This error cannot be resolved by retrying', 'error')

  return finalizeAsFailed(ctx, task, pullRequest, error, 'permanent failure')
}

function handleUnknownError(ctx: AppContext, task: ReviewTaskRecord, pullRequest: PullRequestRecord, error: unknown) {
  const message = errorMessage(error)
  logger.error(`Review task ${task.id} unknown error: ${message}`)

  const classified = classifyError(error)
  if (classified.retryable && canRetry(task)) {
    addLog(ctx, task, `Error (will retry): ${message}`, 'error')
    return scheduleRetry(ctx, task, error)
  }

  addLog(ctx, task, `Error: ${message}`, 'error')
  return finalizeAsFailed(ctx, task, pullRequest, error, classified.retryable ? 'retries exhausted' : 'non-retryable')
}

function handleFailure(ctx: AppContext, task: ReviewTaskRecord, pullRequest: PullRequestRecord, error: unknown) {
  if (error instanceof WorktreeNetworkError) return handleTransientError(ctx, task, pullRequest, error, 'Network error')
  if (error instanceof TransientError) return handleTransientError(ctx, task, pullRequest, error, error.name)
  if (error instanceof PermanentError) return handlePermanentError(ctx, task, pullRequest, error)
  return handleUnknownError(ctx, task, pullRequest, error)
}

// The selected repository can change while a review waits in the queue, and PR
// numbers are only unique per repository, so always check out the PR's own one.
// Without a selected repository it is looked up in the repositories folder.
// Null when no local checkout of it exists there.
async function checkoutFor(ctx: AppContext, pullRequest: PullRequestRecord, currentRepo: string | null) {
  const slug = repoFullName(pullRequest)
  if (isPresent(currentRepo)) {
    const currentSlug = await slugFromPath(ctx.commands, currentRepo)
    if (currentSlug === null || currentSlug.toLowerCase() === slug.toLowerCase()) return currentRepo
  }

  const resolution = await resolveRepoSlug(ctx.commands, new SettingStore(ctx.db).reposFolder(), slug, { ignoreCase: true })
  return resolution.status === 'ok' ? resolution.path : null
}

export async function reviewTaskJob(ctx: AppContext, payload: ReviewTaskJobPayload, deps: ReviewJobDependencies): Promise<void> {
  const { reviewTaskId, isRetry } = payload
  let task = findReviewTask(ctx.db, reviewTaskId)
  const pullRequest = pullRequestOf(ctx, task)
  // A missing checkout fails the task instead of leaving it in pending_review,
  // which would block the queue behind it.
  const repoPath = await checkoutFor(ctx, pullRequest, new SettingStore(ctx.db).currentRepo())
  if (repoPath === null) {
    handlePermanentError(ctx, task, pullRequest, new PermanentError(`No local checkout of ${repoFullName(pullRequest)} in the repositories folder`))
    ctx.jobs.enqueue('ProcessReviewQueueJob', {})
    return
  }

  // Fresh runs start with an empty log; retries keep the earlier attempts'.
  if (!isRetry) clearLogs(ctx.db, task)

  logRetryInfo(ctx, task, isRetry)
  broadcastPreparing(ctx, task)

  const worktreeService = new WorktreeService(ctx, repoPath)

  try {
    addLog(ctx, task, 'Fetching PR from GitHub...', 'status')
    const worktreePath = await worktreeService.createForPr(pullRequest)
    task = updateReviewTask(ctx, task, { worktreePath })
    addLog(ctx, task, `Worktree ready at ${worktreePath}`, 'status')

    // in_review only once the worktree exists.
    task = startReview(ctx, task)

    const reviewService = await CodeReviewService.for(ctx, {
      cliClient: task.cliClient,
      worktreePath,
      pullRequest,
      reviewType: task.reviewType,
      focus: task.reviewFocus,
      githubClientFor: (path) => deps.githubClientFor(path),
    })

    const detectedModel = reviewService.detectModel()
    task = updateReviewTask(ctx, task, { aiModel: detectedModel })
    if (detectedModel !== UNKNOWN_MODEL) addLog(ctx, task, `Using model: ${detectedModel}`, 'status')

    addLog(ctx, task, `Running ${task.cliClient} review...`, 'status')

    const outputBuffer: string[] = []
    const normalizedOutput = await reviewService.runReviewStreaming((line) => {
      outputBuffer.push(line)
      const trimmed = chomp(line)
      if (isPresent(trimmed)) addLog(ctx, task, trimmed, 'output')
    })
    const fullOutput = isBlank(normalizedOutput) ? outputBuffer.join('') : normalizedOutput

    validateReviewOutput(fullOutput)

    addLog(ctx, task, 'Review completed!', 'status')
    // A successful retry keeps its retry history; only fresh runs reset it.
    if (!isRetry) task = resetRetryState(ctx, task)
    task = completeReview(ctx, task, fullOutput)

    const comments = persistCommentsForReviewTask(ctx, task)
    if (comments.length > 0) addLog(ctx, task, `Created ${comments.length} review comments`, 'status')

    broadcastCompletion(ctx, task, pullRequest)
  } catch (error) {
    task = handleFailure(ctx, task, pullRequest, error)
  } finally {
    if (isPresent(task.worktreePath)) await worktreeService.cleanupWorktree(task.worktreePath)
    ctx.jobs.enqueue('ProcessReviewQueueJob', {})
  }
}
