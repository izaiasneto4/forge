import { DrizzleError, and, eq, inArray, isNull } from 'drizzle-orm'
import { SQLiteError } from 'bun:sqlite'
import type { AppContext } from '../context'
import { pullRequests, reviewTasks } from '../db/schema'
import { RecordInvalidError, RecordNotFoundError } from '../lib/errors'
import { logger } from '../lib/logger'
import { isBlank, isPresent } from '../lib/ruby'
import {
  createPullRequest,
  notArchived,
  repoFullName,
  reviewTaskFor,
  updatePullRequest,
  withReviewStatus,
} from '../models/pull-request'
import { moveBackward, updateReviewTask, type ReviewTaskRecord } from '../models/review-task'
import { SettingStore } from '../models/setting'
import { GithubCliError, type GithubCliClient, type PullRequestComment, type PullRequestRef } from './github-cli-client'
import { isDirectory } from './git'
import { validatePath } from './path-validator'
import { runSync, type SyncResult } from './sync/engine'
import { SyncAdapterError } from './sync/github-adapter'
import { exactGithubIdColumn, extractGithubId, findPullRequestByGithubId, githubIdNumber, writeExactGithubId } from './sync/github-id'
import {
  annotateReviewRequests,
  dig,
  integerOrNull,
  isPresentValue,
  parseJson,
  parseListedPullRequest,
  stringOrNull,
  toPullRequestChanges,
  type ListedPullRequest,
  type PullRequestAttributes,
} from './sync/pull-request-attributes'

export const PR_FETCH_LIMIT = 1000
const PR_FIELDS = 'number,title,body,url,author,headRepositoryOwner,headRefName,createdAt,updatedAt,additions,deletions,changedFiles'
const RESETTABLE_TASK_STATES = ['reviewed', 'waiting_implementation', 'done']
const GITHUB_REMOTE = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/m

export interface PullRequestListFetch {
  prs: ListedPullRequest[]
  complete: boolean
}

export interface PullRequestsNeedingAttention {
  pending_review: ListedPullRequest[]
  reviewed_by_me: ListedPullRequest[]
  open_prs_complete: boolean
}

export interface FetchedPullRequestIds {
  pending_review: Array<{ github_id: bigint }>
  reviewed_by_me: Array<{ github_id: bigint }>
}

export interface RepoInfo {
  owner: string
  name: string
}

// ActiveRecord::ActiveRecordError: what sync_to_database! rewraps besides adapter errors.
function isDatabaseError(error: unknown): error is Error {
  return (
    error instanceof RecordInvalidError ||
    error instanceof RecordNotFoundError ||
    error instanceof SQLiteError ||
    error instanceof DrizzleError
  )
}

function gitFailureMessage(result: { stdout: string; stderr: string }) {
  if (isPresent(result.stderr)) return result.stderr.trim()
  if (isPresent(result.stdout)) return result.stdout.trim()
  return 'unknown error'
}

async function runGh(ctx: AppContext, repoPath: string | null, args: string[], timeoutSeconds?: number) {
  const cwd = isPresent(repoPath) && isDirectory(repoPath) ? repoPath : undefined
  const timeoutMs = timeoutSeconds === undefined ? undefined : timeoutSeconds * 1000
  const result = await ctx.commands.run(['gh', ...args], { cwd, timeoutMs })
  if (!result.success) throw new GithubCliError(`GitHub CLI error: ${result.stderr}`)
  return result.stdout
}

function pullRequestPath(pullRequest: PullRequestRef) {
  return `/repos/${repoFullName(pullRequest)}/pulls/${pullRequest.number ?? ''}`
}

function toComment(comment: unknown): PullRequestComment {
  return {
    body: stringOrNull(dig(comment, 'body')),
    author: stringOrNull(dig(comment, 'user', 'login')),
    created_at: stringOrNull(dig(comment, 'created_at')),
    path: stringOrNull(dig(comment, 'path')),
    line: integerOrNull(dig(comment, 'line')),
  }
}

// Port of GithubCliService: the `gh`-backed GitHub client, scoped to a repo
// checkout and the authenticated user.
export class GithubCli implements GithubCliClient {
  constructor(
    private readonly ctx: AppContext,
    readonly username: string,
    readonly repoPath: string | null,
  ) {}

  async fetchReviewRequests(): Promise<ListedPullRequest[]> {
    const fetched = await this.fetchPrList(
      ['pr', 'list', '--search', 'review-requested:@me', '--json', this.prFields(), '--limit', String(PR_FETCH_LIMIT)],
      'pending_review',
    )
    return fetched.prs
  }

  async fetchReviewedByMe(): Promise<ListedPullRequest[]> {
    const fetched = await this.fetchPrList(
      ['pr', 'list', '--search', 'reviewed-by:@me', '--json', this.prFields(), '--limit', String(PR_FETCH_LIMIT)],
      'reviewed_by_me',
    )
    return fetched.prs
  }

  async fetchOpenPullRequests(): Promise<ListedPullRequest[]> {
    return (await this.fetchOpenPullRequestsWithMetadata()).prs
  }

  fetchOpenPullRequestsWithMetadata(): Promise<PullRequestListFetch> {
    return this.fetchPrList(['pr', 'list', '--state', 'open', '--json', this.prFields(), '--limit', String(PR_FETCH_LIMIT)], 'pending_review')
  }

  async fetchAllPrsNeedingAttention(): Promise<PullRequestsNeedingAttention> {
    const reviewRequests = await this.fetchReviewRequests()
    const reviewedByMe = await this.fetchReviewedByMe()
    const openFetch = await this.fetchOpenPullRequestsWithMetadata()

    const requestedIds = new Set(reviewRequests.map((pr) => pr.github_id))
    const reviewedIds = new Set(reviewedByMe.map((pr) => pr.github_id))
    const openPrs = this.annotateReviewRequests(openFetch.prs, requestedIds)
    const reviewed = this.annotateReviewRequests(reviewedByMe, requestedIds)

    // Keep PRs in pending when review has been requested again.
    const pending = openPrs.filter((pr) => !(reviewedIds.has(pr.github_id) && !requestedIds.has(pr.github_id)))
    const pendingIds = new Set(pending.map((pr) => pr.github_id))

    return {
      pending_review: pending,
      reviewed_by_me: reviewed.filter((pr) => !pendingIds.has(pr.github_id)),
      open_prs_complete: openFetch.complete,
    }
  }

  async syncToDatabase(): Promise<SyncResult> {
    try {
      return await runSync(this.ctx, { repoPath: this.repoPath })
    } catch (error) {
      if (error instanceof SyncAdapterError || isDatabaseError(error)) throw new GithubCliError(error.message)
      throw error
    }
  }

  async latestMyReviewState(pullRequest: PullRequestRef): Promise<string | null> {
    const reviews: unknown = parseJson(await this.runGhCommand(['api', `${pullRequestPath(pullRequest)}/reviews`]))
    const mine = (Array.isArray(reviews) ? reviews : []).filter(
      (review) => dig(review, 'user', 'login') === this.username && isPresentValue(dig(review, 'submitted_at')),
    )

    let latest: unknown
    let latestTime = Number.NEGATIVE_INFINITY
    for (const review of mine) {
      const submittedAt = new Date(String(dig(review, 'submitted_at'))).getTime()
      if (latest === undefined || submittedAt > latestTime) {
        latest = review
        latestTime = submittedAt
      }
    }
    return latest === undefined ? null : stringOrNull(dig(latest, 'state'))
  }

  async reviewRequestedForMe(pullRequest: PullRequestRef): Promise<boolean> {
    const payload: unknown = parseJson(await this.runGhCommand(['api', pullRequestPath(pullRequest)]))
    const requestedReviewers = dig(payload, 'requested_reviewers')
    return Array.isArray(requestedReviewers) && requestedReviewers.some((reviewer) => dig(reviewer, 'login') === this.username)
  }

  async fetchPrComments(pullRequest: PullRequestRef): Promise<PullRequestComment[]> {
    const json = await this.runGhCommand(['api', `${pullRequestPath(pullRequest)}/comments`])
    if (json.trim() === '') return []

    let comments: unknown
    try {
      comments = parseJson(json)
    } catch {
      return []
    }
    return Array.isArray(comments) ? comments.map(toComment) : []
  }

  // Rails kept the following private; they are public here so tests can drive them.

  prFields() {
    return PR_FIELDS
  }

  runGhCommand(args: string[], options: { timeout?: number } = {}) {
    return runGh(this.ctx, this.repoPath, args, options.timeout)
  }

  parsePrs(json: string, reviewStatus: string): ListedPullRequest[] {
    return this.parsePrData(this.parsePrPayload(json), reviewStatus)
  }

  extractGithubId(url: string | null | undefined) {
    return extractGithubId(url ?? '')
  }

  annotateReviewRequests(prs: ListedPullRequest[], requestedIds: Set<bigint>) {
    return annotateReviewRequests(prs, requestedIds)
  }

  shouldReconcileStalePrs(fetched: { open_prs_complete?: boolean }) {
    return isPresent(this.repoPath) && fetched.open_prs_complete === true
  }

  // Soft-deletes this repo's PRs that GitHub no longer returned.
  async removeStalePrs(fetched: FetchedPullRequestIds) {
    if (!isPresent(this.repoPath)) return

    const repoInfo = await this.getRepoInfo()
    if (!repoInfo) return

    const fetchedIds = new Set([...fetched.pending_review, ...fetched.reviewed_by_me].map((pr) => pr.github_id.toString()))
    const staleIds = this.ctx.db
      .select({ id: pullRequests.id, githubId: exactGithubIdColumn })
      .from(pullRequests)
      .where(and(notArchived, eq(pullRequests.repoOwner, repoInfo.owner), eq(pullRequests.repoName, repoInfo.name)))
      .all()
      // `where.not(github_id: ids)`: SQL NOT IN never matches NULL, but an empty list matches everything.
      .filter(({ githubId }) => (fetchedIds.size === 0 ? true : githubId !== null && !fetchedIds.has(githubId)))
      .map(({ id }) => id)
    if (staleIds.length === 0) return

    const repo = `${repoInfo.owner}/${repoInfo.name}`
    logger.info(`Removing ${staleIds.length} stale PR(s) from ${repo}`)
    const now = new Date()
    this.ctx.db.update(pullRequests).set({ deletedAt: now, updatedAt: now }).where(inArray(pullRequests.id, staleIds)).run()
    logger.info(`Successfully soft-deleted ${staleIds.length} stale PR(s)`)
  }

  async getRepoInfo(): Promise<RepoInfo | null> {
    try {
      const validatedPath = validatePath(this.repoPath)
      if (validatedPath === null || !isDirectory(validatedPath)) return null

      const result = await this.ctx.commands.run(['git', '-C', validatedPath, 'remote', 'get-url', 'origin'])
      if (!result.success) return null

      const remote = result.stdout.trim()
      if (remote === '') return null

      const match = GITHUB_REMOTE.exec(remote)
      if (!match?.[1] || !match[2]) return null
      return { owner: match[1], name: match[2] }
    } catch {
      return null
    }
  }

  syncPrs(prs: PullRequestAttributes[], defaultReviewStatus: string) {
    for (const pr of prs) this.syncPr(pr, defaultReviewStatus)
  }

  // Marks pending PRs without a task whose review was not requested from me.
  async markReviewedByOthers() {
    if (!new SettingStore(this.ctx.db).onlyRequestedReviews()) return

    const pendingPrs = this.ctx.db
      .select({ pullRequest: pullRequests })
      .from(pullRequests)
      .leftJoin(reviewTasks, eq(reviewTasks.pullRequestId, pullRequests.id))
      .where(and(withReviewStatus('pending_review'), isNull(reviewTasks.id)))
      .all()
      .map(({ pullRequest }) => pullRequest)
    if (pendingPrs.length === 0) return

    const json = await this.runGhCommand(['pr', 'list', '--json', 'number,state,reviewRequests', '--limit', String(PR_FETCH_LIMIT)])
    const data: unknown = parseJson(json)

    const requestedOfMe = new Map<unknown, boolean>()
    for (const pr of Array.isArray(data) ? data : []) {
      const reviewRequests = dig(pr, 'reviewRequests')
      const myReviewRequested = Array.isArray(reviewRequests) && reviewRequests.some((request) => dig(request, 'login') === this.username)
      requestedOfMe.set(dig(pr, 'number'), dig(pr, 'state') === 'OPEN' && myReviewRequested)
    }

    for (const pullRequest of pendingPrs) {
      if (!requestedOfMe.get(pullRequest.number)) updatePullRequest(this.ctx, pullRequest, { reviewStatus: 'reviewed_by_others' })
    }
  }

  private async fetchPrList(args: string[], reviewStatus: string): Promise<PullRequestListFetch> {
    const data = this.parsePrPayload(await this.runGhCommand(args))
    return { prs: this.parsePrData(data, reviewStatus), complete: data.length < PR_FETCH_LIMIT }
  }

  private parsePrPayload(json: string): unknown[] {
    if (json.trim() === '') return []
    const data: unknown = parseJson(json)
    return Array.isArray(data) ? data : []
  }

  private parsePrData(data: unknown[], reviewStatus: string): ListedPullRequest[] {
    return data.map((pr) => ({ ...parseListedPullRequest(pr, reviewStatus === 'pending_review'), review_status: reviewStatus }))
  }

  private syncPr(pr: PullRequestAttributes, defaultReviewStatus: string) {
    const existing = findPullRequestByGithubId(this.ctx.db, pr.github_id)
    const task = existing ? reviewTaskFor(this.ctx.db, existing.id) : undefined

    let syncedStatus = pr.review_status ?? defaultReviewStatus
    const attributes: PullRequestAttributes = { ...pr, archived: false, deleted_at: null }

    // reviewed_by_me requires a local ReviewTask; keep external reviews visible in pending.
    if (syncedStatus === 'reviewed_by_me' && !task) {
      attributes.review_status = 'pending_review'
      syncedStatus = 'pending_review'
    }

    if (task && syncedStatus === 'pending_review' && RESETTABLE_TASK_STATES.includes(task.state)) {
      this.resetForRerequest(task)
      attributes.review_status = 'pending_review'
    } else if (existing && task) {
      delete attributes.review_status
    }

    const changes = toPullRequestChanges(attributes)
    if (!existing) {
      const record = createPullRequest(this.ctx, { ...changes, githubId: githubIdNumber(pr.github_id) })
      writeExactGithubId(this.ctx.db, record.id, pr.github_id)
      return
    }
    updatePullRequest(this.ctx, existing, changes)
  }

  private resetForRerequest(task: ReviewTaskRecord) {
    const movedBack = moveBackward(this.ctx, task, 'pending_review') ?? task
    updateReviewTask(this.ctx, movedBack, { submissionStatus: 'pending_submission', submittedAt: null })
  }
}

// `GithubCliService.new(username:, repo_path:)`. The login lookup runs before
// the repo path is known, so it never runs inside the checkout (as in Rails).
export async function createGithubCli(
  ctx: AppContext,
  options: { username?: string | null; repoPath?: string | null } = {},
): Promise<GithubCli> {
  const settings = new SettingStore(ctx.db)
  const username = options.username ?? (await runGh(ctx, null, ['api', 'user', '--jq', '.login'])).trim()
  const repoPath = options.repoPath ?? settings.currentRepo()
  if (isPresent(username)) settings.setGithubLogin(username)
  return new GithubCli(ctx, username, repoPath)
}

// GithubCliService.fetch_latest_for_repo: fast-forwards a local checkout.
export async function fetchLatestForRepo(ctx: AppContext, repoPath: string | null | undefined) {
  if (isBlank(repoPath) || !isDirectory(repoPath)) return

  const fetched = await ctx.commands.run(['git', '-C', repoPath, 'fetch', 'origin'])
  if (!fetched.success) throw new GithubCliError(`git fetch failed: ${gitFailureMessage(fetched)}`)

  const pulled = await ctx.commands.run(['git', '-C', repoPath, 'pull', '--ff-only'])
  if (!pulled.success) throw new GithubCliError(`git pull failed: ${gitFailureMessage(pulled)}`)
}
