// The slice of GithubCliService that services outside the sync code depend on.
// src/services/github-cli.ts implements it; tests substitute fakes.
export interface PullRequestRef {
  repoOwner: string | null
  repoName: string | null
  number: number | null
}

export interface PullRequestComment {
  body: string | null
  author: string | null
  created_at: string | null
  path: string | null
  line: number | null
}

export interface GithubCliClient {
  // GET /repos/:owner/:repo/pulls/:number/comments; [] on empty or invalid JSON.
  fetchPrComments(pullRequest: PullRequestRef): Promise<PullRequestComment[]>
  // Whether the authenticated user is among the PR's requested reviewers.
  reviewRequestedForMe(pullRequest: PullRequestRef): Promise<boolean>
  // State of the user's most recently submitted review, or null.
  latestMyReviewState(pullRequest: PullRequestRef): Promise<string | null>
}

// GithubCliService::Error: a failed gh/git invocation.
export class GithubCliError extends Error {}
