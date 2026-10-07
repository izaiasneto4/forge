import type { AppContext } from '../../context'
import { isPresent } from '../../lib/ruby'
import { isDirectory } from '../git'
import { annotateReviewRequests, parseJson, parseListedPullRequest, type ListedPullRequest } from './pull-request-attributes'

// Sync::FetchAllPrs::Error
export class FetchAllPrsError extends Error {}

export const PR_FETCH_LIMIT = 1000
const PR_FIELDS = 'number,title,body,url,author,headRepositoryOwner,headRefName,createdAt,updatedAt,additions,deletions,changedFiles'

export interface OpenPullRequestsByStatus {
  pending_review: ListedPullRequest[]
  reviewed_by_me: ListedPullRequest[]
}

async function runGh(ctx: AppContext, repoPath: string | null, args: string[]) {
  const cwd = isPresent(repoPath) && isDirectory(repoPath) ? repoPath : undefined
  const result = await ctx.commands.run(['gh', ...args], { cwd })
  if (!result.success) throw new FetchAllPrsError(`GitHub CLI error: ${result.stderr}`)
  return result.stdout
}

function idsOf(prs: ListedPullRequest[]) {
  return new Set(prs.map((pr) => pr.github_id))
}

// Port of Sync::FetchAllPrs: the review-requested / reviewed-by-me / open PR
// lists the older sync flow combined.
export class FetchAllPrs {
  constructor(
    private readonly ctx: AppContext,
    readonly repoPath: string | null,
    readonly githubLogin: string,
  ) {}

  async call(): Promise<ListedPullRequest[]> {
    const requested = await this.fetchPendingReview()
    const reviewed = await this.fetchReviewedByMe()
    return [...requested, ...annotateReviewRequests(reviewed, idsOf(requested))]
  }

  async callWithOpenPrs(): Promise<OpenPullRequestsByStatus> {
    const pending = await this.fetchPendingReview()
    const reviewed = await this.fetchReviewedByMe()
    const requestedIds = idsOf(pending)
    const reviewedIds = idsOf(reviewed)

    const openPrs = annotateReviewRequests(await this.fetchOpenPrs(), requestedIds).filter(
      (pr) => !(reviewedIds.has(pr.github_id) && !requestedIds.has(pr.github_id)),
    )
    const openIds = idsOf(openPrs)

    return {
      pending_review: openPrs,
      reviewed_by_me: annotateReviewRequests(reviewed, requestedIds).filter((pr) => !openIds.has(pr.github_id)),
    }
  }

  parsePr(pr: unknown): ListedPullRequest {
    return parseListedPullRequest(pr, false)
  }

  runGhCommand(args: string[]) {
    return runGh(this.ctx, this.repoPath, args)
  }

  private async fetchPendingReview() {
    const prs = await this.fetchPrList(['pr', 'list', '--search', 'review-requested:@me', '--json', PR_FIELDS, '--limit', String(PR_FETCH_LIMIT)])
    return prs.map((pr) => ({ ...pr, review_status: 'pending_review' }))
  }

  private async fetchReviewedByMe() {
    const prs = await this.fetchPrList(['pr', 'list', '--search', 'reviewed-by:@me', '--json', PR_FIELDS, '--limit', String(PR_FETCH_LIMIT)])
    return prs.map((pr) => ({ ...pr, review_status: 'reviewed_by_me' }))
  }

  private fetchOpenPrs() {
    return this.fetchPrList(['pr', 'list', '--state', 'open', '--json', PR_FIELDS, '--limit', String(PR_FETCH_LIMIT)])
  }

  private async fetchPrList(args: string[]) {
    const json = await this.runGhCommand(args)
    if (json.trim() === '') return []
    const data = parseJson(json)
    return Array.isArray(data) ? data.map((pr) => this.parsePr(pr)) : []
  }
}

// `Sync::FetchAllPrs.new(repo_path:, github_login:)`; asks gh for the login when none is given.
export async function createFetchAllPrs(ctx: AppContext, options: { repoPath: string | null; githubLogin?: string | null }) {
  const githubLogin = options.githubLogin ?? (await runGh(ctx, options.repoPath, ['api', 'user', '--jq', '.login'])).trim()
  return new FetchAllPrs(ctx, options.repoPath, githubLogin)
}
