import type { AppContext } from '../context'
import { ApiError, ERROR_CODES } from '../http/envelope'
import { RecordInvalidError } from '../lib/errors'
import { processQueueIfIdle, recoverOrphanedInReviewTasks, type ReviewTaskRecord } from '../models/review-task'
import type { ReviewCommentRecord } from '../models/review-comment'
import type { SyncResult } from '../services/sync/engine'

// Services routes call that reach outside the process (GitHub, AI CLIs, the
// OS folder dialog). Injected so route tests can substitute fakes.
export interface ApiServices {
  runSync(ctx: AppContext, options: { repoPath: string | null; trigger: string; pullRequestNumber?: number | null }): Promise<SyncResult>
  submitReview(
    ctx: AppContext,
    task: ReviewTaskRecord,
    options: { event: string; summary: string | null; comments: ReviewCommentRecord[] },
  ): Promise<unknown>
  pickFolder(ctx: AppContext, prompt: string): Promise<string | null>
}

export interface RouteDependencies {
  ctx: AppContext
  services: ApiServices
  queueKick: QueueKick
}

// `process_queue_if_needed`: at most once a minute (Rails.cache key shared by
// the pull request and review task controllers), recover orphans and kick the queue.
export class QueueKick {
  static readonly INTERVAL_MS = 60_000
  private lastRunAt = 0

  run(ctx: AppContext, now = Date.now()) {
    if (now - this.lastRunAt < QueueKick.INTERVAL_MS) return
    recoverOrphanedInReviewTasks(ctx)
    processQueueIfIdle(ctx)
    this.lastRunAt = now
  }
}

export function renderError(code: string, message: string, status = 422, details?: unknown): never {
  throw new ApiError(code, message, status, details)
}

// Controllers that rescue RecordInvalid render its full messages as invalid_input.
export function rescueRecordInvalid<Result>(work: () => Result, status = 422): Result {
  try {
    return work()
  } catch (error) {
    if (error instanceof RecordInvalidError) renderError(ERROR_CODES.invalidInput, error.fullMessages.join(', '), status)
    throw error
  }
}

export async function rescueRecordInvalidAsync<Result>(work: () => Promise<Result>, status = 422): Promise<Result> {
  try {
    return await work()
  } catch (error) {
    if (error instanceof RecordInvalidError) renderError(ERROR_CODES.invalidInput, error.fullMessages.join(', '), status)
    throw error
  }
}
