import { and, eq } from 'drizzle-orm'
import type { AppContext } from '../../context'
import { pullRequests } from '../../db/schema'
import { isPresent } from '../../lib/ruby'
import type { PullRequestRecord } from '../../models/pull-request'
import { isDirectory } from '../git'
import { exactGithubIdColumn } from './github-id'
import { rubyTimeToString, type PullRequestAttributes } from './pull-request-attributes'

export interface PullRequestDiff {
  to_create: PullRequestAttributes[]
  to_update: Array<[PullRequestRecord, PullRequestAttributes]>
  to_delete: PullRequestRecord[]
}

interface RepoInfo {
  owner: string
  name: string
}

const GITHUB_REMOTE = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/m

function emptyResult(): PullRequestDiff {
  return { to_create: [], to_update: [], to_delete: [] }
}

// SYNCED_FIELDS. The *_at_github comparison is Rails' `existing&.to_s != fetched`:
// "2026-03-04 10:00:00 UTC" never equals gh's "2026-03-04T10:00:00Z", so a PR
// with GitHub timestamps always counts as changed.
function pullRequestChanged(existing: PullRequestRecord, fetched: PullRequestAttributes) {
  const comparisons: Array<[unknown, unknown]> = [
    [existing.title, fetched.title],
    [existing.description, fetched.description],
    [existing.url, fetched.url],
    [existing.author, fetched.author],
    [existing.authorAvatar, fetched.author_avatar],
    [rubyTimeToString(existing.createdAtGithub), fetched.created_at_github],
    [rubyTimeToString(existing.updatedAtGithub), fetched.updated_at_github],
    [existing.reviewStatus, fetched.review_status],
    [existing.reviewRequestedForMe, fetched.review_requested_for_me],
  ]
  return comparisons.some(([existingValue, fetchedValue]) => existingValue !== (fetchedValue ?? null))
}

// Port of Sync::DiffEngine: sorts fetched PR attributes into creates, updates
// (including restores of soft-deleted rows) and soft-deletes for one repo.
export class DiffEngine {
  private repoInfo: RepoInfo | null | undefined

  constructor(
    private readonly ctx: AppContext,
    private readonly options: { fetchedPrs: PullRequestAttributes[]; repoPath: string | null },
  ) {}

  async call(): Promise<PullRequestDiff> {
    const { fetchedPrs } = this.options
    if (fetchedPrs.length === 0) return emptyResult()

    const repoInfo = await this.getRepoInfo()
    if (!repoInfo) return emptyResult()

    const existingByGithubId = this.existingPullRequests(repoInfo)
    const fetchedIds = new Set(fetchedPrs.map((pr) => pr.github_id.toString()))
    const result = emptyResult()

    for (const fetched of fetchedPrs) {
      const existing = existingByGithubId.get(fetched.github_id.toString())
      if (!existing) result.to_create.push(fetched)
      else if (existing.deletedAt !== null) result.to_update.push([existing, { ...fetched, deleted_at: null, archived: false }])
      else if (pullRequestChanged(existing, fetched)) result.to_update.push([existing, fetched])
    }

    for (const [githubId, pullRequest] of existingByGithubId) {
      if (pullRequest.deletedAt !== null || pullRequest.archived) continue
      if (!fetchedIds.has(githubId)) result.to_delete.push(pullRequest)
    }

    return result
  }

  // `get_repo_info`, memoized; any failure means "unknown repo".
  async getRepoInfo(): Promise<RepoInfo | null> {
    if (this.repoInfo !== undefined) return this.repoInfo
    this.repoInfo = await this.resolveRepoInfo().catch(() => null)
    return this.repoInfo
  }

  private async resolveRepoInfo(): Promise<RepoInfo | null> {
    const { repoPath } = this.options
    if (!isPresent(repoPath) || !isDirectory(repoPath)) return null

    const result = await this.ctx.commands.run(['git', '-C', repoPath, 'remote', 'get-url', 'origin'])
    if (!result.success) return null

    const remote = result.stdout.trim()
    if (remote === '') return null

    const match = GITHUB_REMOTE.exec(remote)
    if (!match?.[1] || !match[2]) return null
    return { owner: match[1], name: match[2] }
  }

  // `PullRequest.unscoped.where(repo).index_by(&:github_id)`, keyed by the exact id.
  private existingPullRequests(repoInfo: RepoInfo) {
    const rows = this.ctx.db
      .select({ record: pullRequests, githubId: exactGithubIdColumn })
      .from(pullRequests)
      .where(and(eq(pullRequests.repoOwner, repoInfo.owner), eq(pullRequests.repoName, repoInfo.name)))
      .all()

    const byGithubId = new Map<string, PullRequestRecord>()
    for (const { record, githubId } of rows) byGithubId.set(githubId ?? '', record)
    return byGithubId
  }
}
