import type { AppContext } from '../../context'
import { RecordNotFoundError } from '../../lib/errors'
import { findSnapshot } from '../../models/pull-request-snapshot'
import { generatePullRequestSummary } from '../../services/pull-request-summary'
import type { JobPayload } from '../queue'

// PullRequestSummaryJob: a snapshot deleted before the job runs is a no-op.
export async function pullRequestSummaryJob(ctx: AppContext, payload: JobPayload<'PullRequestSummaryJob'>): Promise<void> {
  try {
    await generatePullRequestSummary(ctx, findSnapshot(ctx.db, payload.snapshotId))
  } catch (error) {
    if (error instanceof RecordNotFoundError) return
    throw error
  }
}
