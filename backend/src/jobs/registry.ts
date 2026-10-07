import type { AppContext } from '../context'
import { createGithubCli } from '../services/github-cli'
import { processReviewQueueJob } from './handlers/process-review-queue'
import { pullRequestSummaryJob } from './handlers/pull-request-summary'
import { reviewTaskJob } from './handlers/review-task'
import { syncPullRequestsJob } from './handlers/sync-pull-requests'
import type { JobHandlers } from './worker'

export function jobHandlers(ctx: AppContext): JobHandlers {
  return {
    ReviewTaskJob: (payload) => reviewTaskJob(ctx, payload, { githubClientFor: (repoPath) => createGithubCli(ctx, { repoPath }) }),
    ProcessReviewQueueJob: () => processReviewQueueJob(ctx),
    PullRequestSummaryJob: (payload) => pullRequestSummaryJob(ctx, payload),
    SyncPullRequestsJob: () => syncPullRequestsJob(ctx),
  }
}
