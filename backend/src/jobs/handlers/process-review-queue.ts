import type { AppContext } from '../../context'
import { claimAndStartNextQueued } from '../../models/review-task'

// Port of ProcessReviewQueueJob: starts the oldest queued review when idle.
export async function processReviewQueueJob(ctx: AppContext): Promise<void> {
  claimAndStartNextQueued(ctx)
}
