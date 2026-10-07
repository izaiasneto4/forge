import type { AppContext } from '../context'
import { CodeReviewError, CodeReviewService, type GithubClientFactory, type ReviewPullRequest } from './code-review'

// Port of the deprecated ClaudeReviewService; prefer
// `CodeReviewService.for(ctx, { cliClient: 'claude', ... })`.
export const ClaudeReviewError = CodeReviewError

export interface ReviewRunner {
  runReview(): Promise<string>
  runReviewStreaming(onLine?: (line: string) => void): Promise<string>
}

export class ClaudeReviewService {
  static async create(
    ctx: Pick<AppContext, 'commands'>,
    options: { worktreePath: string; pullRequest: ReviewPullRequest; githubClientFor: GithubClientFactory },
  ) {
    return new ClaudeReviewService(await CodeReviewService.for(ctx, { ...options, cliClient: 'claude' }))
  }

  constructor(readonly service: ReviewRunner) {}

  runReview() {
    return this.service.runReview()
  }

  runReviewStreaming(onLine?: (line: string) => void) {
    return this.service.runReviewStreaming(onLine)
  }
}
