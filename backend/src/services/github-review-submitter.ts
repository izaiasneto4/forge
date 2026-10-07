import { eq } from 'drizzle-orm'
import type { AppContext } from '../context'
import { pullRequests } from '../db/schema'
import { RecordNotFoundError } from '../lib/errors'
import { logger } from '../lib/logger'
import { isPresent } from '../lib/ruby'
import { findPullRequestBy, repoFullName, type PullRequestRecord } from '../models/pull-request'
import { pendingComments, type ReviewCommentRecord } from '../models/review-comment'
import type { ReviewTaskRecord } from '../models/review-task'
import { SettingStore } from '../models/setting'
import { isDirectory } from './git'

// Port of GithubReviewSubmitter: posts Ordem review comments to GitHub through `gh api`.

// GithubReviewSubmitter::Error, the base the submissions endpoint rescues.
export class GithubReviewSubmitterError extends Error {}

export class NoCommentsSelectedError extends GithubReviewSubmitterError {
  constructor(message = 'No comments selected for submission') {
    super(message)
  }
}

function clockTime(time: Date) {
  return [time.getHours(), time.getMinutes(), time.getSeconds()].map((part) => String(part).padStart(2, '0')).join(':')
}

export class RateLimitError extends GithubReviewSubmitterError {
  constructor(readonly resetAt: Date | null = null) {
    super(resetAt ? `GitHub API rate limit exceeded. Try again after ${clockTime(resetAt)}` : 'GitHub API rate limit exceeded')
  }
}

export class AuthenticationError extends GithubReviewSubmitterError {
  constructor(message = 'GitHub authentication failed. Please check your credentials.') {
    super(message)
  }
}

export class NotFoundError extends GithubReviewSubmitterError {
  constructor(resource = 'Resource') {
    super(`${resource} not found. It may have been deleted or you may not have access.`)
  }
}

export class StaleDiffError extends GithubReviewSubmitterError {
  constructor(filePath: string | null = null) {
    const location = filePath ? ` (${filePath})` : ''
    super(`The code has changed since this review was generated${location}. Some comments may reference outdated line numbers.`)
  }
}

export class SubmissionBlockedError extends GithubReviewSubmitterError {
  constructor(message = 'Review submission is blocked. Check branch protection rules or PR status.') {
    super(message)
  }
}

export const EVENTS = ['APPROVE', 'REQUEST_CHANGES', 'COMMENT']

export interface ReviewCommentPayload {
  path: string
  body: string
  line?: number
  side?: 'RIGHT'
}

export interface SingleCommentPayload {
  body: string
  commit_id: string | null
  path: string
  line?: number
  side?: 'RIGHT'
}

export interface ReviewPayload {
  event: string
  body?: string
  comments?: ReviewCommentPayload[]
}

export interface SubmitterOptions {
  // Defaults to Setting.current_repo; gh runs there when it is an existing directory.
  repoPath?: string | null
}

// What `GithubReviewSubmitter.new(review_task:)` captures.
interface Submitter {
  ctx: AppContext
  pullRequest: PullRequestRecord
  cwd: string | undefined
}

type CommentFields = Pick<ReviewCommentRecord, 'body' | 'filePath' | 'lineNumber' | 'severity'>

function buildSubmitter(ctx: AppContext, reviewTask: ReviewTaskRecord, options: SubmitterOptions): Submitter {
  // `review_task.pull_request` honours PullRequest's default scope (not archived/deleted).
  const pullRequest = findPullRequestBy(ctx.db, eq(pullRequests.id, reviewTask.pullRequestId))
  if (!pullRequest) throw new RecordNotFoundError('PullRequest', reviewTask.pullRequestId)

  const repoPath = options.repoPath ?? new SettingStore(ctx.db).currentRepo()
  const cwd = isPresent(repoPath) && isDirectory(repoPath) ? repoPath : undefined
  return { ctx, pullRequest, cwd }
}

function pullRequestPath(submitter: Submitter) {
  return `/repos/${repoFullName(submitter.pullRequest)}`
}

function pullRequestNumber(submitter: Submitter) {
  return String(submitter.pullRequest.number ?? '')
}

export function validateEvent(event: string) {
  if (!EVENTS.includes(event)) {
    throw new GithubReviewSubmitterError(`Invalid review event: ${event}. Must be one of: ${EVENTS.join(', ')}`)
  }
}

export function severityEmoji(severity: string) {
  switch (severity) {
    case 'critical':
      return ':rotating_light:'
    case 'major':
      return ':warning:'
    case 'minor':
      return ':information_source:'
    case 'suggestion':
      return ':bulb:'
    case 'nitpick':
      return ':mag:'
    default:
      return ':speech_balloon:'
  }
}

export function severityBadge(severity: string) {
  switch (severity) {
    case 'critical':
      return '**:rotating_light: Critical**'
    case 'major':
      return '**:warning: Major**'
    case 'minor':
      return '**:information_source: Minor**'
    case 'suggestion':
      return '**:bulb: Suggestion**'
    case 'nitpick':
      return '**:mag: Nitpick**'
    default:
      return '**Comment**'
  }
}

// Ruby `String#capitalize`.
function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase()
}

// `group_by(&:severity).transform_values(&:count)`: first-seen order.
function countBySeverity(comments: CommentFields[]) {
  const counts = new Map<string, number>()
  for (const comment of comments) counts.set(comment.severity, (counts.get(comment.severity) ?? 0) + 1)
  return counts
}

export function buildReviewBody(comments: CommentFields[], customSummary: string | null = null) {
  if (isPresent(customSummary)) return customSummary

  const parts = ['## Code Review Summary\n', `Found **${comments.length}** issues:\n`]
  for (const [severity, count] of countBySeverity(comments)) {
    parts.push(`- ${severityEmoji(severity)} **${capitalize(severity)}**: ${count}`)
  }
  parts.push('\n---\n', '_Review generated by Ordem_')
  return parts.join('\n')
}

export function determineEvent(comments: CommentFields[]) {
  return comments.some((comment) => comment.severity === 'critical' || comment.severity === 'major') ? 'REQUEST_CHANGES' : 'COMMENT'
}

function formatCommentBody(comment: CommentFields) {
  return `${severityBadge(comment.severity)}\n\n${comment.body}`
}

// GitHub takes `line` (+ `side`) for a single-line comment; omitted for file-level ones.
function linePosition(comment: CommentFields): { line?: number; side?: 'RIGHT' } {
  return comment.lineNumber === null ? {} : { line: comment.lineNumber, side: 'RIGHT' }
}

export function buildCommentPayload(comment: CommentFields): ReviewCommentPayload {
  return { path: comment.filePath, body: formatCommentBody(comment), ...linePosition(comment) }
}

export function buildReviewComments(comments: CommentFields[]) {
  return comments
    .filter((comment) => isPresent(comment.filePath) && comment.filePath.trim().toUpperCase() !== 'N/A')
    .map(buildCommentPayload)
}

export function formatUserFriendlyError(message: string) {
  let readable = message.replace(/[ \t\r\n\f\v]+/g, ' ').trim()
  const characters = Array.from(readable)
  if (characters.length > 200) readable = `${characters.slice(0, 197).join('')}...`
  return `GitHub API error: ${readable}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseObject(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

// `return JSON.parse(...) rescue {}` only rescues the parse: an unparseable
// stderr falls through to stdout rather than returning {}.
export function parseErrorBody(stderr: string, stdout: string | null): Record<string, unknown> {
  const jsonStart = stderr.indexOf('{')
  if (jsonStart !== -1) {
    const fromStderr = parseObject(stderr.slice(jsonStart))
    if (fromStderr) return fromStderr
  }
  if (isPresent(stdout) && stdout.includes('{')) {
    const fromStdout = parseObject(stdout)
    if (fromStdout) return fromStdout
  }
  return {}
}

// Ruby `Time.parse` of an offset-less timestamp: local time.
function parseLocalTime(timestamp: string) {
  const parsed = new Date(timestamp.replace(/\s/, 'T'))
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function extractRateLimitReset(stderr: string, now = new Date()): Date | null {
  const timestamp = /reset(?:s)?\s+(?:at\s+)?(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2})/i.exec(stderr)?.[1]
  if (timestamp !== undefined) return parseLocalTime(timestamp)

  const seconds = /(\d+)\s*(?:seconds?|secs?)\s*(?:remaining|until)/i.exec(stderr)?.[1]
  if (seconds !== undefined) return new Date(now.getTime() + Number.parseInt(seconds, 10) * 1000)

  return null
}

export function extractFileFromError(errorBody: Record<string, unknown>): string | null {
  const errors = errorBody.errors
  if (!Array.isArray(errors)) return null
  for (const error of errors) {
    if (isRecord(error) && typeof error.field === 'string' && error.field.includes('/')) return error.field
  }
  return null
}

export function parseApiError(stderr: string, stdout: string | null = null): GithubReviewSubmitterError {
  const errorBody = parseErrorBody(stderr, stdout)
  const errorMessage = typeof errorBody.message === 'string' ? errorBody.message : stderr

  if (stderr.includes('rate limit') || errorMessage.toLowerCase().includes('rate limit')) {
    return new RateLimitError(extractRateLimitReset(stderr))
  }

  if (
    stderr.includes('401') ||
    errorMessage.includes('Bad credentials') ||
    errorMessage.includes('authentication') ||
    stderr.includes('gh auth login')
  ) {
    return new AuthenticationError()
  }

  if (stderr.includes('404') || errorMessage.includes('Not Found')) {
    return new NotFoundError('Pull request or repository')
  }

  if (
    errorMessage.includes('position') ||
    errorMessage.includes('diff') ||
    (errorMessage.includes('line') && errorMessage.includes('does not exist'))
  ) {
    return new StaleDiffError(extractFileFromError(errorBody))
  }

  if (
    stderr.includes('403') ||
    errorMessage.includes('permission') ||
    errorMessage.includes('protected branch') ||
    errorMessage.includes('blocked')
  ) {
    return new SubmissionBlockedError(errorMessage)
  }

  return new GithubReviewSubmitterError(formatUserFriendlyError(errorMessage))
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

// `gh api` with the JSON payload on stdin. Empty output is {}.
async function runGhApi(submitter: Submitter, method: string, endpoint: string, payload: object): Promise<unknown> {
  const command = [
    'gh',
    'api',
    '--method',
    method,
    '-H',
    'Accept: application/vnd.github+json',
    '-H',
    'X-GitHub-Api-Version: 2022-11-28',
    endpoint,
    '--input',
    '-',
  ]
  const result = await submitter.ctx.commands.run(command, { cwd: submitter.cwd, input: JSON.stringify(payload) })

  if (!result.success) {
    logger.error(`GithubReviewSubmitter: API error - ${result.stderr}`)
    throw parseApiError(result.stderr, result.stdout)
  }

  if (result.stdout.trim() === '') return {}
  try {
    const parsed: unknown = JSON.parse(result.stdout)
    return parsed
  } catch (error) {
    logger.error(`GithubReviewSubmitter: Failed to parse response - ${errorText(error)}`)
    throw new GithubReviewSubmitterError(`Failed to parse GitHub API response: ${errorText(error)}`)
  }
}

async function runGhCommand(submitter: Submitter, args: string[]) {
  const result = await submitter.ctx.commands.run(['gh', ...args], { cwd: submitter.cwd })
  if (!result.success) throw new GithubReviewSubmitterError(`GitHub CLI error: ${result.stderr}`)
  return result.stdout
}

async function fetchLatestCommitSha(submitter: Submitter) {
  const json = await runGhCommand(submitter, [
    'pr',
    'view',
    pullRequestNumber(submitter),
    '--repo',
    repoFullName(submitter.pullRequest),
    '--json',
    'headRefOid',
  ])
  const data: unknown = JSON.parse(json)
  return isRecord(data) && typeof data.headRefOid === 'string' ? data.headRefOid : null
}

async function submitToGithub(submitter: Submitter, body: string | null, event: string, comments: ReviewCommentPayload[]) {
  const payload: ReviewPayload = { event }
  if (isPresent(body)) payload.body = body
  if (comments.length > 0) payload.comments = comments

  const response = await runGhApi(submitter, 'POST', `${pullRequestPath(submitter)}/pulls/${pullRequestNumber(submitter)}/reviews`, payload)

  logger.info(
    `GithubReviewSubmitter: Submitted review to PR #${pullRequestNumber(submitter)} with event=${event}, comments=${comments.length}`,
  )
  return response
}

// Ruby `event || "COMMENT"` / `summary || default`: only nil falls back, so `??`.
function submitEmptyReview(submitter: Submitter, event: string | null, summary: string | null) {
  const reviewEvent = event ?? 'COMMENT'
  const reviewBody = reviewEvent === 'APPROVE' && !isPresent(summary) ? null : (summary ?? 'Review completed with no actionable comments.')
  return submitToGithub(submitter, reviewBody, reviewEvent, [])
}

export interface SubmitReviewOptions extends SubmitterOptions {
  event?: string | null
  summary?: string | null
  // null/undefined means every pending comment; an empty array submits none.
  comments?: ReviewCommentRecord[] | null
}

// `GithubReviewSubmitter#submit_review`: resolves to the parsed GitHub API response.
export async function submitReview(ctx: AppContext, reviewTask: ReviewTaskRecord, options: SubmitReviewOptions = {}): Promise<unknown> {
  const event = options.event ?? null
  const summary = options.summary ?? null
  if (isPresent(event)) validateEvent(event)

  const submitter = buildSubmitter(ctx, reviewTask, options)
  const comments = options.comments ?? pendingComments(ctx.db, reviewTask.id)
  if (comments.length === 0) return submitEmptyReview(submitter, event, summary)

  const reviewBody = buildReviewBody(comments, summary)
  const reviewEvent = event ?? determineEvent(comments)
  return submitToGithub(submitter, reviewBody, reviewEvent, buildReviewComments(comments))
}

export async function buildSingleCommentPayload(
  ctx: AppContext,
  reviewTask: ReviewTaskRecord,
  comment: CommentFields,
  options: SubmitterOptions = {},
): Promise<SingleCommentPayload> {
  return singleCommentPayload(buildSubmitter(ctx, reviewTask, options), comment)
}

async function singleCommentPayload(submitter: Submitter, comment: CommentFields): Promise<SingleCommentPayload> {
  return {
    body: formatCommentBody(comment),
    commit_id: await fetchLatestCommitSha(submitter),
    path: comment.filePath,
    ...linePosition(comment),
  }
}

// `submit_single_comment`: one comment on a file/line of the PR's head commit.
export async function submitSingleComment(
  ctx: AppContext,
  reviewTask: ReviewTaskRecord,
  comment: CommentFields,
  options: SubmitterOptions = {},
): Promise<unknown> {
  const submitter = buildSubmitter(ctx, reviewTask, options)
  const payload = await singleCommentPayload(submitter, comment)
  return runGhApi(submitter, 'POST', `${pullRequestPath(submitter)}/pulls/${pullRequestNumber(submitter)}/comments`, payload)
}

// `submit_general_comment`: a conversation comment not attached to code.
export async function submitGeneralComment(
  ctx: AppContext,
  reviewTask: ReviewTaskRecord,
  body: string,
  options: SubmitterOptions = {},
): Promise<unknown> {
  const submitter = buildSubmitter(ctx, reviewTask, options)
  return runGhApi(submitter, 'POST', `${pullRequestPath(submitter)}/issues/${pullRequestNumber(submitter)}/comments`, { body })
}

// `run_gh_api` exposed for tests that exercise response parsing directly.
export async function runGithubApi(
  ctx: AppContext,
  reviewTask: ReviewTaskRecord,
  request: { method: string; endpoint: string; payload: object },
  options: SubmitterOptions = {},
): Promise<unknown> {
  return runGhApi(buildSubmitter(ctx, reviewTask, options), request.method, request.endpoint, request.payload)
}
