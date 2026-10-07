import type { AppContext } from '../../context'
import { isPresent } from '../../lib/ruby'
import { isDirectory } from '../git'
import { slugFromPath } from '../repo-slug-resolver'
import { extractGithubId } from './github-id'
import {
  dig,
  firstTruthy,
  integerOrNull,
  isJsonObject,
  isPresentValue,
  parseJson,
  repoFromUrl,
  rubyToString,
  stringOrNull,
  toArray,
  type JsonObject,
} from './pull-request-attributes'

// Sync::GithubAdapter::Error: gh failed or returned something unparsable.
export class SyncAdapterError extends Error {}

export const PR_FETCH_LIMIT = 1000
export const PR_FIELDS = [
  'additions',
  'author',
  'baseRefName',
  'baseRefOid',
  'body',
  'changedFiles',
  'closedAt',
  'createdAt',
  'deletions',
  'headRefName',
  'headRefOid',
  'headRepositoryOwner',
  'isDraft',
  'latestReviews',
  'mergedAt',
  'number',
  'reviewDecision',
  'reviewRequests',
  'state',
  'statusCheckRollup',
  'title',
  'updatedAt',
  'url',
]

// One PR as Sync::GithubAdapter#parse_pr shapes it.
export interface RemotePullRequest {
  github_id: bigint
  number: number | null
  title: string | null
  description: string | null
  url: string
  repo_owner: string | null
  repo_name: string | null
  author: string | null
  author_avatar: string | null
  created_at_github: string | null
  updated_at_github: string | null
  additions: number | null
  deletions: number | null
  changed_files: number | null
  review_requested_for_me: boolean
  remote_state: string
  inactive_reason: string | null
  head_sha: string | null
  base_sha: string | null
  head_ref: string | null
  base_ref: string | null
  merged_at_github: string | null
  closed_at_github: string | null
  latest_review_state: string | null
  review_decision: string | null
  check_status: string | null
  draft: boolean
}

export interface RemotePullRequestList {
  prs: RemotePullRequest[]
  complete: boolean
}

// What Sync::Engine needs from GitHub; tests substitute fakes.
export interface SyncAdapter {
  readonly repoSlug: string | null
  readonly githubLogin: string | null
  fetchOpenPullRequests(): Promise<RemotePullRequestList>
  fetchPullRequest(number: number): Promise<RemotePullRequest | null>
}

const FAILED_CHECK_STATES = ['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED']
const PENDING_CHECK_STATES = ['PENDING', 'QUEUED', 'IN_PROGRESS', 'EXPECTED', 'WAITING']
const NOT_FOUND_MESSAGES = ['no pull requests found', 'Could not resolve to a PullRequest']

function sameLogin(login: unknown, githubLogin: string) {
  return rubyToString(login).toLowerCase() === githubLogin.toLowerCase()
}

function requestLogin(request: unknown) {
  return firstTruthy(dig(request, 'login'), dig(request, 'requestedReviewer', 'login'), dig(request, 'requestedReviewer', 'user', 'login'))
}

function reviewAuthorLogin(review: unknown) {
  return firstTruthy(dig(review, 'author', 'login'), dig(review, 'author', 'author', 'login'), dig(review, 'user', 'login'))
}

function extractRemoteState(pr: JsonObject) {
  const state = rubyToString(pr.state).toUpperCase()
  if (isPresentValue(pr.mergedAt) || state === 'MERGED') return 'merged'
  if (isPresentValue(pr.closedAt) || state === 'CLOSED') return 'closed'
  return 'open'
}

function inactiveReasonFor(remoteState: string) {
  if (remoteState === 'merged' || remoteState === 'closed' || remoteState === 'inaccessible') return remoteState
  return null
}

function summarizeChecks(statusRollup: unknown) {
  const values = toArray(statusRollup)
    .map((entry) => firstTruthy(dig(entry, 'state'), dig(entry, 'context', 'state'), dig(entry, 'conclusion')))
    .filter((value) => value !== null && value !== undefined && value !== false)
    .map((value) => rubyToString(value).toUpperCase())

  if (values.length === 0) return null
  if (values.some((value) => FAILED_CHECK_STATES.includes(value))) return 'failure'
  if (values.some((value) => PENDING_CHECK_STATES.includes(value))) return 'pending'
  return 'success'
}

function parseFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return new SyncAdapterError(`GitHub response parse failed: ${message}`)
}

async function runGh(ctx: AppContext, repoPath: string | null, args: string[]) {
  const cwd = isPresent(repoPath) && isDirectory(repoPath) ? repoPath : undefined
  const result = await ctx.commands.run(['gh', ...args], { cwd })
  if (!result.success) {
    const message = isPresent(result.stderr) ? result.stderr : isPresent(result.stdout) ? result.stdout : 'GitHub CLI error'
    throw new SyncAdapterError(message)
  }
  return result.stdout
}

// Port of Sync::GithubAdapter: reads one repo's PRs through `gh` and normalizes them.
export class GithubAdapter implements SyncAdapter {
  constructor(
    private readonly ctx: AppContext,
    private readonly repoPath: string | null,
    readonly repoSlug: string | null,
    readonly githubLogin: string,
  ) {}

  async fetchOpenPullRequests(): Promise<RemotePullRequestList> {
    const data = await this.fetchPrList(['pr', 'list', '--state', 'open', '--json', PR_FIELDS.join(','), '--limit', String(PR_FETCH_LIMIT)])
    return { prs: data.map((pr) => this.parsePullRequest(pr)), complete: data.length < PR_FETCH_LIMIT }
  }

  async fetchPullRequest(number: number): Promise<RemotePullRequest | null> {
    let json: string
    try {
      json = await runGh(this.ctx, this.repoPath, ['pr', 'view', String(number), '--json', PR_FIELDS.join(',')])
    } catch (error) {
      if (error instanceof SyncAdapterError && NOT_FOUND_MESSAGES.some((text) => error.message.includes(text))) return null
      throw error
    }

    let data: unknown
    try {
      data = parseJson(json)
    } catch (error) {
      throw parseFailure(error)
    }
    if (!isJsonObject(data)) throw parseFailure('expected a JSON object')
    return this.parsePullRequest(data)
  }

  parsePullRequest(pr: unknown): RemotePullRequest {
    const fields = isJsonObject(pr) ? pr : {}
    const url = rubyToString(fields.url)
    const remoteState = extractRemoteState(fields)

    return {
      github_id: extractGithubId(url),
      number: integerOrNull(fields.number),
      title: stringOrNull(fields.title),
      description: stringOrNull(fields.body),
      url,
      ...repoFromUrl(url, dig(fields, 'headRepositoryOwner', 'login')),
      author: stringOrNull(dig(fields, 'author', 'login')),
      author_avatar: stringOrNull(dig(fields, 'author', 'avatarUrl')),
      created_at_github: stringOrNull(fields.createdAt),
      updated_at_github: stringOrNull(fields.updatedAt),
      additions: integerOrNull(fields.additions),
      deletions: integerOrNull(fields.deletions),
      changed_files: integerOrNull(fields.changedFiles),
      review_requested_for_me: this.reviewRequestedForMe(fields.reviewRequests),
      remote_state: remoteState,
      inactive_reason: inactiveReasonFor(remoteState),
      head_sha: stringOrNull(fields.headRefOid),
      base_sha: stringOrNull(fields.baseRefOid),
      head_ref: stringOrNull(fields.headRefName),
      base_ref: stringOrNull(fields.baseRefName),
      merged_at_github: stringOrNull(fields.mergedAt),
      closed_at_github: stringOrNull(fields.closedAt),
      latest_review_state: this.latestReviewStateForMe(fields.latestReviews),
      review_decision: stringOrNull(fields.reviewDecision),
      check_status: summarizeChecks(fields.statusCheckRollup),
      draft: fields.isDraft === true,
    }
  }

  private async fetchPrList(args: string[]) {
    const json = await runGh(this.ctx, this.repoPath, args)
    if (json.trim() === '') return []

    let data: unknown
    try {
      data = parseJson(json)
    } catch (error) {
      throw parseFailure(error)
    }
    if (!Array.isArray(data)) throw parseFailure('expected a JSON array')
    return data
  }

  private reviewRequestedForMe(reviewRequests: unknown) {
    return toArray(reviewRequests).some((request) => sameLogin(requestLogin(request), this.githubLogin))
  }

  private latestReviewStateForMe(latestReviews: unknown) {
    const review = [...toArray(latestReviews)]
      .reverse()
      .find((entry) => sameLogin(reviewAuthorLogin(entry), this.githubLogin))
    return stringOrNull(dig(review, 'state'))
  }
}

// `Sync::GithubAdapter.new(repo_path:, github_login:)`: resolves the repo slug and,
// when no login is known, asks gh for the authenticated user.
export async function createGithubAdapter(
  ctx: AppContext,
  options: { repoPath: string | null; githubLogin?: string | null },
): Promise<GithubAdapter> {
  const repoSlug = await slugFromPath(ctx.commands, options.repoPath)
  const githubLogin = isPresent(options.githubLogin)
    ? options.githubLogin
    : (await runGh(ctx, options.repoPath, ['api', 'user', '--jq', '.login'])).trim()
  return new GithubAdapter(ctx, options.repoPath, repoSlug, githubLogin)
}
