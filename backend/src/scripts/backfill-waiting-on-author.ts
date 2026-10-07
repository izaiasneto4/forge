import type { AppContext } from '../context'
import { isPresent } from '../lib/ruby'
import { repoFullName } from '../models/pull-request'
import { SettingStore } from '../models/setting'
import { isDirectory } from '../services/git'
import { GithubCliError, type PullRequestRef } from '../services/github-cli-client'
import {
  runReviewLifecycleBackfill,
  type BackfillGithubClient,
  type BackfillOptions,
  type OutputWriter,
} from '../services/review-lifecycle-backfill'
import { runScript, stdoutWriter } from './script-context'

// rake forge:backfill_waiting_on_author
// Dry-run by default; APPLY=1 persists, LIMIT=n caps the PRs examined.

// Ruby `String#to_i`: leading integer or 0.
function rubyToI(value: string) {
  const match = /^\s*([+-]?\d+(?:_\d+)*)/.exec(value)
  return match?.[1] ? Number.parseInt(match[1].replaceAll('_', ''), 10) : 0
}

export function backfillOptionsFromEnv(env: Record<string, string | undefined>): Required<BackfillOptions> {
  const limit = env.LIMIT === undefined ? null : rubyToI(env.LIMIT)
  return { apply: env.APPLY === '1', limit: limit === 0 ? null : limit }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function loginOf(value: unknown) {
  return isRecord(value) ? value.login : undefined
}

function pullRequestEndpoint(pullRequest: PullRequestRef) {
  return `/repos/${repoFullName(pullRequest)}/pulls/${pullRequest.number ?? ''}`
}

// The two GithubCliService lookups the backfill needs, including its constructor's
// side effects (resolve the gh login and remember it as Setting.github_login).
// Kept local so this script does not depend on the full GitHub CLI port.
export async function createGhReviewStateClient(ctx: AppContext): Promise<BackfillGithubClient> {
  const settings = new SettingStore(ctx.db)
  const repoPath = settings.currentRepo()
  const cwd = isPresent(repoPath) && isDirectory(repoPath) ? repoPath : undefined

  const gh = async (args: string[]) => {
    const result = await ctx.commands.run(['gh', ...args], { cwd })
    if (!result.success) throw new GithubCliError(`GitHub CLI error: ${result.stderr}`)
    return result.stdout
  }

  const username = (await gh(['api', 'user', '--jq', '.login'])).trim()
  if (isPresent(username)) settings.setGithubLogin(username)

  return {
    async reviewRequestedForMe(pullRequest) {
      const payload: unknown = JSON.parse(await gh(['api', pullRequestEndpoint(pullRequest)]))
      const reviewers = isRecord(payload) && Array.isArray(payload.requested_reviewers) ? payload.requested_reviewers : []
      return reviewers.some((reviewer) => loginOf(reviewer) === username)
    },

    async latestMyReviewState(pullRequest) {
      const reviews: unknown = JSON.parse(await gh(['api', `${pullRequestEndpoint(pullRequest)}/reviews`]))
      let latest: { submittedAt: number; state: unknown } | null = null
      for (const review of Array.isArray(reviews) ? reviews : []) {
        if (!isRecord(review) || loginOf(review.user) !== username) continue
        if (typeof review.submitted_at !== 'string' || !isPresent(review.submitted_at)) continue
        const submittedAt = Date.parse(review.submitted_at)
        if (latest === null || submittedAt > latest.submittedAt) latest = { submittedAt, state: review.state }
      }
      return latest !== null && typeof latest.state === 'string' ? latest.state : null
    },
  }
}

export async function backfillWaitingOnAuthor(
  ctx: AppContext,
  github: BackfillGithubClient,
  env: Record<string, string | undefined>,
  output: OutputWriter,
) {
  return runReviewLifecycleBackfill(ctx, github, output, backfillOptionsFromEnv(env))
}

if (import.meta.main) {
  await runScript(async (ctx) => backfillWaitingOnAuthor(ctx, await createGhReviewStateClient(ctx), process.env, stdoutWriter))
}
