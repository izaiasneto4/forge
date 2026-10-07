import type { RemotePullRequest, RemotePullRequestList, SyncAdapter } from '../../src/services/sync/github-adapter'
import { extractGithubId } from '../../src/services/sync/github-id'

export const fixtureOwner = 'acme'
export const fixtureRepo = 'api'
export const fixtureSlug = `${fixtureOwner}/${fixtureRepo}`

export function pullRequestUrl(number: number, slug = fixtureSlug) {
  return `https://github.com/${slug}/pull/${number}`
}

export function githubIdFor(number: number, slug = fixtureSlug) {
  return extractGithubId(pullRequestUrl(number, slug))
}

// One entry of `gh pr list --json <GithubCliService pr_fields>`.
export function ghListedPullRequest(overrides: { number: number; slug?: string } & Record<string, unknown>) {
  const { number, slug = fixtureSlug, ...fields } = overrides
  return {
    number,
    title: `PR ${number}`,
    body: `Body of ${number}`,
    url: pullRequestUrl(number, slug),
    author: { login: 'alice', avatarUrl: 'https://example.com/alice.png' },
    headRepositoryOwner: { login: slug.split('/')[0] },
    headRefName: `feature-${number}`,
    createdAt: '2026-03-04T10:00:00Z',
    updatedAt: '2026-03-04T11:00:00Z',
    additions: 10,
    deletions: 4,
    changedFiles: 2,
    ...fields,
  }
}

// One `gh pr view/list --json <Sync::GithubAdapter::PR_FIELDS>` payload.
export function ghPullRequest(overrides: { number: number; slug?: string } & Record<string, unknown>) {
  const { number, slug = fixtureSlug, ...fields } = overrides
  return {
    ...ghListedPullRequest({ number, slug }),
    baseRefName: 'main',
    baseRefOid: `base-${number}`,
    headRefOid: `head-${number}`,
    state: 'OPEN',
    mergedAt: null,
    closedAt: null,
    isDraft: false,
    reviewRequests: [],
    latestReviews: [],
    reviewDecision: null,
    statusCheckRollup: [],
    ...fields,
  }
}

export function ghJson(value: unknown) {
  return JSON.stringify(value)
}

// Ruby engine_test's `remote_pr`: what the adapter hands the engine. Like the
// Ruby helper, github_id defaults to the PR number.
export function remotePullRequest(options: {
  number: number
  headSha: string
  baseSha?: string
  requested?: boolean
  state?: 'open' | 'closed' | 'merged'
  latestReviewState?: string | null
  githubId?: bigint
}): RemotePullRequest {
  const state = options.state ?? 'open'
  const closedAt = '2026-03-07T10:06:00Z'
  return {
    github_id: options.githubId ?? BigInt(options.number),
    number: options.number,
    title: `PR ${options.number}`,
    description: 'Body',
    url: pullRequestUrl(options.number),
    repo_owner: fixtureOwner,
    repo_name: fixtureRepo,
    author: 'alice',
    author_avatar: null,
    created_at_github: '2026-03-07T10:00:00Z',
    updated_at_github: '2026-03-07T10:05:00Z',
    additions: 10,
    deletions: 4,
    changed_files: 2,
    review_requested_for_me: options.requested ?? false,
    remote_state: state,
    inactive_reason: state === 'open' ? null : state,
    head_sha: options.headSha,
    base_sha: options.baseSha ?? 'base-1',
    head_ref: 'feature',
    base_ref: 'main',
    merged_at_github: state === 'merged' ? closedAt : null,
    closed_at_github: state === 'closed' ? closedAt : null,
    latest_review_state: options.latestReviewState ?? null,
    review_decision: null,
    check_status: 'success',
    draft: false,
  }
}

// Scripted SyncAdapter (Ruby tests used mocha stubs for the adapter).
export class FakeSyncAdapter implements SyncAdapter {
  readonly openFetches: number[] = []
  readonly lookups: number[] = []
  private readonly singles = new Map<number, RemotePullRequest | null | Error>()

  constructor(
    private readonly openPullRequests: RemotePullRequestList | Error = { prs: [], complete: true },
    readonly repoSlug: string | null = fixtureSlug,
    readonly githubLogin: string | null = 'izaias',
  ) {}

  withPullRequest(number: number, response: RemotePullRequest | null | Error) {
    this.singles.set(number, response)
    return this
  }

  async fetchOpenPullRequests() {
    this.openFetches.push(this.openFetches.length + 1)
    if (this.openPullRequests instanceof Error) throw this.openPullRequests
    return this.openPullRequests
  }

  async fetchPullRequest(number: number) {
    this.lookups.push(number)
    const response = this.singles.get(number)
    if (response === undefined) throw new Error(`FakeSyncAdapter: no response for #${number}`)
    if (response instanceof Error) throw response
    return response
  }
}
