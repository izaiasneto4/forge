import type { PullRequestChanges } from '../../models/pull-request'
import { extractGithubId } from './github-id'

// Helpers for reading `gh --json` output with Ruby's lenient Hash semantics.
export type JsonObject = Record<string, unknown>

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseJson(text: string): unknown {
  return JSON.parse(text)
}

// Hash#dig: nil as soon as a step is missing.
export function dig(value: unknown, ...keys: string[]): unknown {
  let current = value
  for (const key of keys) {
    if (!isJsonObject(current)) return undefined
    current = current[key]
  }
  return current
}

function rubyTruthy(value: unknown) {
  return value !== null && value !== undefined && value !== false
}

// `a || b || c`: the first value that isn't nil/false ("" counts as truthy).
export function firstTruthy(...values: unknown[]): unknown {
  return values.find(rubyTruthy) ?? values[values.length - 1]
}

// Kernel#Array for the JSON values gh returns.
export function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (value === null || value === undefined) return []
  return [value]
}

// Object#to_s for JSON scalars.
export function rubyToString(value: unknown) {
  if (value === null || value === undefined) return ''
  return typeof value === 'string' ? value : String(value)
}

// Object#present? for JSON values.
export function isPresentValue(value: unknown) {
  if (!rubyTruthy(value)) return false
  if (typeof value === 'string') return value.trim() !== ''
  if (Array.isArray(value)) return value.length > 0
  if (isJsonObject(value)) return Object.keys(value).length > 0
  return true
}

export function stringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null
  return rubyToString(value)
}

export function integerOrNull(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : null
  if (typeof value === 'string' && /^\s*[+-]?\d+\s*$/.test(value)) return Number.parseInt(value, 10)
  return null
}

// Attribute hashes the sync code passes around, keyed like the Rails hashes.
export interface PullRequestAttributes {
  github_id: bigint
  number?: number | null
  title?: string | null
  description?: string | null
  url?: string | null
  repo_owner?: string | null
  repo_name?: string | null
  author?: string | null
  author_avatar?: string | null
  created_at_github?: string | null
  updated_at_github?: string | null
  additions?: number | null
  deletions?: number | null
  changed_files?: number | null
  review_requested_for_me?: boolean
  review_status?: string | null
  remote_state?: string
  inactive_reason?: string | null
  head_sha?: string | null
  base_sha?: string | null
  head_ref?: string | null
  base_ref?: string | null
  merged_at_github?: string | null
  closed_at_github?: string | null
  latest_review_state?: string | null
  review_decision?: string | null
  check_status?: string | null
  draft?: boolean
  archived?: boolean
  deleted_at?: Date | null
}

// GithubCliService#parse_pr_data / Sync::FetchAllPrs#parse_pr output.
export interface ListedPullRequest {
  github_id: bigint
  number: number | null
  title: string | null
  description: string | null
  url: string | null
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
  review_status?: string
}

const URL_REPO_PARTS = /github\.com\/([^/]+)\/([^/]+)\/pull\//

export function repoFromUrl(url: string, fallbackOwner: unknown) {
  const match = URL_REPO_PARTS.exec(url)
  return {
    repo_owner: match?.[1] ?? stringOrNull(fallbackOwner),
    repo_name: match?.[2] ?? null,
  }
}

// The fields both list parsers read from `gh pr list --json`.
export function parseListedPullRequest(pr: unknown, reviewRequestedForMe: boolean): ListedPullRequest {
  const url = dig(pr, 'url')
  return {
    github_id: extractGithubId(rubyToString(url)),
    number: integerOrNull(dig(pr, 'number')),
    title: stringOrNull(dig(pr, 'title')),
    description: stringOrNull(dig(pr, 'body')),
    url: stringOrNull(url),
    ...repoFromUrl(rubyToString(url), dig(pr, 'headRepositoryOwner', 'login')),
    author: stringOrNull(dig(pr, 'author', 'login')),
    author_avatar: stringOrNull(dig(pr, 'author', 'avatarUrl')),
    created_at_github: stringOrNull(dig(pr, 'createdAt')),
    updated_at_github: stringOrNull(dig(pr, 'updatedAt')),
    additions: integerOrNull(dig(pr, 'additions')),
    deletions: integerOrNull(dig(pr, 'deletions')),
    changed_files: integerOrNull(dig(pr, 'changedFiles')),
    review_requested_for_me: reviewRequestedForMe,
  }
}

export function annotateReviewRequests<Attributes extends { github_id: bigint }>(prs: Attributes[], requestedIds: Set<bigint>) {
  return prs.map((pr) => ({ ...pr, review_requested_for_me: requestedIds.has(pr.github_id) }))
}

// ActiveRecord's datetime cast of the ISO strings gh returns; unparsable -> nil.
function castTime(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

// ActiveSupport::TimeWithZone#to_s in UTC: "2026-03-04 10:00:00 UTC".
export function rubyTimeToString(value: Date | null) {
  if (value === null) return null
  return `${value.toISOString().slice(0, 19).replace('T', ' ')} UTC`
}

function assign<Key extends keyof PullRequestChanges>(target: PullRequestChanges, key: Key, value: PullRequestChanges[Key] | undefined) {
  if (value !== undefined) target[key] = value
}

// `assign_attributes(attrs)` minus github_id, which callers write exactly (see github-id.ts).
export function toPullRequestChanges(attributes: Omit<PullRequestAttributes, 'github_id'>): PullRequestChanges {
  const changes: PullRequestChanges = {}
  assign(changes, 'number', attributes.number)
  assign(changes, 'title', attributes.title)
  assign(changes, 'description', attributes.description)
  assign(changes, 'url', attributes.url)
  assign(changes, 'repoOwner', attributes.repo_owner)
  assign(changes, 'repoName', attributes.repo_name)
  assign(changes, 'author', attributes.author)
  assign(changes, 'authorAvatar', attributes.author_avatar)
  assign(changes, 'createdAtGithub', castTime(attributes.created_at_github))
  assign(changes, 'updatedAtGithub', castTime(attributes.updated_at_github))
  assign(changes, 'additions', attributes.additions)
  assign(changes, 'deletions', attributes.deletions)
  assign(changes, 'changedFiles', attributes.changed_files)
  assign(changes, 'reviewRequestedForMe', attributes.review_requested_for_me)
  assign(changes, 'reviewStatus', attributes.review_status)
  assign(changes, 'remoteState', attributes.remote_state)
  assign(changes, 'inactiveReason', attributes.inactive_reason)
  assign(changes, 'headSha', attributes.head_sha)
  assign(changes, 'baseSha', attributes.base_sha)
  assign(changes, 'headRef', attributes.head_ref)
  assign(changes, 'baseRef', attributes.base_ref)
  assign(changes, 'mergedAtGithub', castTime(attributes.merged_at_github))
  assign(changes, 'closedAtGithub', castTime(attributes.closed_at_github))
  assign(changes, 'latestReviewState', attributes.latest_review_state)
  assign(changes, 'reviewDecision', attributes.review_decision)
  assign(changes, 'checkStatus', attributes.check_status)
  assign(changes, 'draft', attributes.draft)
  assign(changes, 'archived', attributes.archived)
  assign(changes, 'deletedAt', attributes.deleted_at)
  return changes
}
