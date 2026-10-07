import { asc, desc } from 'drizzle-orm'
import type { Db } from '../db/client'
import { reviewTasks } from '../db/schema'
import { RecordNotFoundError } from '../lib/errors'
import { isBlank, isPresent, iso8601 } from '../lib/ruby'
import { agentLogPayload, recentLogs } from '../models/agent-log'
import {
  aiSummaryForDisplay,
  analysisStatus,
  findPullRequestUnscoped,
  repoFullName,
  reviewTaskFor,
  reviewTaskAnalysisStale,
  snapshotStatus,
  type PullRequestRecord,
} from '../models/pull-request'
import type { AiSummary } from '../models/pull-request-snapshot'
import { commentLocation, commentsBySeverity, isActionable, type ReviewCommentRecord } from '../models/review-comment'
import { iterationDurationSeconds, type ReviewIterationRecord } from '../models/review-iteration'
import {
  canRetry,
  currentIterationNumber,
  hasReviewHistory,
  MAX_RETRY_ATTEMPTS,
  queuePosition,
  REVIEW_TASK_STATES,
  reviewHistory,
  SUBMITTED_EVENTS,
  tasksInState,
  type ReviewTaskRecord,
  type ReviewTaskState,
} from '../models/review-task'
import { CLI_CLIENTS, SettingStore, VALID_THEME_PREFERENCES } from '../models/setting'
import { recoverCurrentRepo } from '../services/current-repo-recovery'
import { scanRepositories, type ScannedRepository } from '../services/repo-scanner'
import { slugFromPath, slugFromRemote } from '../services/repo-slug-resolver'
import { parseReviewOutput, type ReviewItem } from '../services/review-output-parser'
import { headerInReviewCount, headerPendingCount, repoDirectoryName } from './header'
import { renderCodeBlock, renderMarkdown } from './markdown'
import { dbOf, indexCurrentRepo, pullRequestColumns, pullRequestTotalCount, syncStatusPayload, type PayloadSource } from './pull-request-index'
import { codeSuggestion, detectLanguageFromFile, formatReviewDuration, severityEmoji } from './review-tasks-helper'

// Port of Api::V1::UiPayloads (Bootstrap, PullRequestBoard, ReviewTaskBoard,
// ReviewTaskDetail, Repositories; Settings lives in ./settings).

export { syncSkippedMessage, syncStatusPayload, type PayloadContext, type PayloadSource } from './pull-request-index'

function markdownHtml(text: string | null) {
  if (isBlank(text)) return null
  return renderMarkdown(text)
}

function codeBlockHtml(text: string, language: string | null) {
  if (isBlank(text)) return null
  return renderCodeBlock(text, language)
}

export async function currentRepoPayload(source: PayloadSource) {
  const repoPath = await indexCurrentRepo(dbOf(source))

  return {
    path: repoPath,
    slug: await slugFromPath(repoPath),
    name: isPresent(repoPath) ? repoDirectoryName(repoPath) : null,
  }
}

// Rails re-ran `git remote get-url origin` per repo; the scan already has it.
function repositoryPayload(repository: ScannedRepository, currentRepoPath: string | null) {
  return {
    name: repository.name,
    path: repository.path,
    branch: repository.branch,
    slug: slugFromRemote(repository.remote_url),
    current: repository.path === currentRepoPath,
  }
}

export async function repositoriesPayload(source: PayloadSource) {
  const db = dbOf(source)
  await recoverCurrentRepo(db)
  const settingStore = new SettingStore(db)
  const reposFolder = settingStore.reposFolder()
  const repositories = isPresent(reposFolder) ? await scanRepositories(reposFolder) : []
  const currentRepoPath = settingStore.currentRepo()

  return {
    repos_folder: reposFolder,
    current_repo_path: currentRepoPath,
    current_repo_slug: await slugFromPath(currentRepoPath),
    items: repositories.map((repository) => repositoryPayload(repository, currentRepoPath)),
  }
}

function aiSummaryPayload(summary: AiSummary) {
  return {
    status: summary.status,
    generated_at: iso8601(summary.generatedAt),
    failure_reason: summary.failureReason,
    snapshot_id: summary.snapshotId,
    stale: summary.stale,
    files_changed: summary.filesChanged,
    lines_added: summary.linesAdded,
    lines_removed: summary.linesRemoved,
    main_changes: summary.mainChanges,
    risk_areas: summary.riskAreas,
  }
}

// Annotated so the literal unions survive in the payload object types (an
// inferred return type would widen to string inside an object literal).
type AnalysisStatus = 'none' | 'pending' | 'current' | 'stale'
type SnapshotStatus = 'missing' | 'current' | 'stale'

function pullRequestAnalysisStatus(db: Db, pullRequest: PullRequestRecord): AnalysisStatus {
  return analysisStatus(db, pullRequest)
}

function pullRequestSnapshotStatus(db: Db, pullRequest: PullRequestRecord): SnapshotStatus {
  return snapshotStatus(db, pullRequest)
}

function taskAnalysisStatus(db: Db, analysisStale: boolean, pullRequest: PullRequestRecord): AnalysisStatus {
  return analysisStale ? 'stale' : analysisStatus(db, pullRequest)
}

export function compactPullRequestPayload(db: Db, pullRequest: PullRequestRecord) {
  return {
    id: pullRequest.id,
    number: pullRequest.number,
    title: pullRequest.title,
    url: pullRequest.url,
    author: pullRequest.author,
    author_avatar: pullRequest.authorAvatar,
    repo_name: pullRequest.repoName,
    repo_full_name: repoFullName(pullRequest),
    review_status: pullRequest.reviewStatus,
    remote_state: pullRequest.remoteState,
    inactive_reason: pullRequest.inactiveReason,
    snapshot_status: pullRequestSnapshotStatus(db, pullRequest),
    analysis_status: pullRequestAnalysisStatus(db, pullRequest),
    additions: pullRequest.additions,
    deletions: pullRequest.deletions,
    changed_files: pullRequest.changedFiles,
  }
}

// Rails loaded `review_task.pull_request` through PullRequest's default scope,
// so a task whose PR was archived or soft-deleted raised NoMethodError (500).
// The PR is loaded unscoped here so such tasks still render.
function pullRequestOfTask(db: Db, task: ReviewTaskRecord) {
  const pullRequest = findPullRequestUnscoped(db, task.pullRequestId)
  if (!pullRequest) throw new RecordNotFoundError('PullRequest', task.pullRequestId)
  return pullRequest
}

export function reviewTaskPayload(db: Db, task: ReviewTaskRecord, options: { includePullRequest?: boolean } = {}) {
  const pullRequest = pullRequestOfTask(db, task)
  const analysisStale = reviewTaskAnalysisStale(db, task)

  return {
    id: task.id,
    state: task.state,
    archived: task.archived,
    ai_model: task.aiModel,
    cli_client: task.cliClient,
    review_type: task.reviewType,
    retry_count: task.retryCount,
    max_retry_attempts: MAX_RETRY_ATTEMPTS,
    can_retry: canRetry(task),
    queued_at: iso8601(task.queuedAt),
    queue_position: queuePosition(db, task),
    started_at: iso8601(task.startedAt),
    completed_at: iso8601(task.completedAt),
    failure_reason: task.failureReason,
    submission_status: task.submissionStatus,
    submitted_at: iso8601(task.submittedAt),
    submitted_event: task.submittedEvent,
    has_review_history: hasReviewHistory(db, task),
    current_iteration_number: currentIterationNumber(db, task),
    swarm_review: task.reviewType === 'swarm',
    pull_request_snapshot_id: task.pullRequestSnapshotId,
    analysis_status: taskAnalysisStatus(db, analysisStale, pullRequest),
    snapshot_current: !analysisStale,
    pull_request: options.includePullRequest === false ? null : compactPullRequestPayload(db, pullRequest),
  }
}

export function pullRequestPayload(db: Db, pullRequest: PullRequestRecord) {
  const reviewTask = reviewTaskFor(db, pullRequest.id)

  return {
    id: pullRequest.id,
    number: pullRequest.number,
    title: pullRequest.title,
    url: pullRequest.url,
    author: pullRequest.author,
    author_avatar: pullRequest.authorAvatar,
    description: pullRequest.description,
    repo_owner: pullRequest.repoOwner,
    repo_name: pullRequest.repoName,
    repo_full_name: repoFullName(pullRequest),
    review_status: pullRequest.reviewStatus,
    archived: pullRequest.archived,
    created_at_github: iso8601(pullRequest.createdAtGithub),
    updated_at_github: iso8601(pullRequest.updatedAtGithub),
    remote_state: pullRequest.remoteState,
    inactive_reason: pullRequest.inactiveReason,
    snapshot_status: pullRequestSnapshotStatus(db, pullRequest),
    analysis_status: pullRequestAnalysisStatus(db, pullRequest),
    head_sha: pullRequest.headSha,
    base_sha: pullRequest.baseSha,
    head_ref: pullRequest.headRef,
    base_ref: pullRequest.baseRef,
    latest_review_state: pullRequest.latestReviewState,
    review_decision: pullRequest.reviewDecision,
    check_status: pullRequest.checkStatus,
    draft: pullRequest.draft,
    additions: pullRequest.additions,
    deletions: pullRequest.deletions,
    changed_files: pullRequest.changedFiles,
    ai_summary: aiSummaryPayload(aiSummaryForDisplay(db, pullRequest)),
    review_requested_for_me: pullRequest.reviewRequestedForMe,
    review_task: reviewTask ? reviewTaskPayload(db, reviewTask, { includePullRequest: false }) : null,
  }
}

export function reviewCommentPayload(comment: ReviewCommentRecord) {
  return {
    id: comment.id,
    title: comment.title,
    severity: comment.severity,
    status: comment.status,
    body: comment.body,
    body_html: markdownHtml(comment.body),
    file_path: comment.filePath,
    line_number: comment.lineNumber,
    location: commentLocation(comment),
    resolution_note: comment.resolutionNote,
    actionable: isActionable(comment),
  }
}

export function parsedReviewItemPayload(item: ReviewItem) {
  const suggestedFixIsCode = codeSuggestion(item.suggestedFix)

  return {
    title: item.title,
    severity: item.severity,
    severity_emoji: severityEmoji(item.severity),
    file: item.file,
    lines: item.lines,
    location: isPresent(item.lines) ? `${item.file}:${item.lines}` : item.file,
    comment: item.comment,
    comment_html: markdownHtml(item.comment),
    suggested_fix: item.suggestedFix,
    suggested_fix_is_code: suggestedFixIsCode,
    suggested_fix_html: suggestedFixIsCode
      ? codeBlockHtml(item.suggestedFix, detectLanguageFromFile(item.file))
      : markdownHtml(item.suggestedFix),
  }
}

type OutputMode = 'parsed_review_items' | 'raw_output' | 'empty'

function outputMode(parsedItems: ReviewItem[], reviewOutput: string | null): OutputMode {
  if (parsedItems.length > 0) return 'parsed_review_items'
  return isPresent(reviewOutput) ? 'raw_output' : 'empty'
}

export function reviewIterationPayload(iteration: ReviewIterationRecord) {
  const parsedItems = parseReviewOutput(iteration.reviewOutput)

  return {
    id: iteration.id,
    iteration_number: iteration.iterationNumber,
    cli_client: iteration.cliClient,
    review_type: iteration.reviewType,
    ai_model: iteration.aiModel,
    from_state: iteration.fromState,
    to_state: iteration.toState,
    started_at: iso8601(iteration.startedAt),
    completed_at: iso8601(iteration.completedAt),
    duration_seconds: iterationDurationSeconds(iteration),
    parsed_review_items: parsedItems.map(parsedReviewItemPayload),
    raw_output: iteration.reviewOutput,
    raw_output_html: markdownHtml(iteration.reviewOutput),
    output_mode: outputMode(parsedItems, iteration.reviewOutput),
  }
}

export async function bootstrapPayload(source: PayloadSource) {
  const db = dbOf(source)
  const settingStore = new SettingStore(db)
  // HeaderPresenter.new captures Setting.current_repo before recovery runs.
  const headerRepo = settingStore.currentRepo()
  const currentRepo = await currentRepoPayload(db)

  return {
    app: {
      name: 'Forge',
      cli_clients: [...CLI_CLIENTS],
      valid_theme_preferences: [...VALID_THEME_PREFERENCES],
    },
    current_repo: currentRepo,
    settings: {
      default_cli_client: settingStore.defaultCliClient(),
      auto_submit_enabled: settingStore.autoSubmitEnabled(),
      only_requested_reviews: settingStore.onlyRequestedReviews(),
      theme_preference: settingStore.themePreference(),
      github_login: settingStore.githubLogin(),
    },
    counts: {
      pending_review: await headerPendingCount(db, headerRepo),
      in_review: await headerInReviewCount(db, headerRepo),
    },
    sync_status: await syncStatusPayload(db),
  }
}

export async function pullRequestBoardPayload(source: PayloadSource) {
  const db = dbOf(source)
  // PullRequestBoard#initialize builds the index presenter (and its repo) first.
  const boardRepo = await indexCurrentRepo(db)
  const columns = await pullRequestColumns(db, boardRepo)
  const settingStore = new SettingStore(db)

  return {
    current_repo: await currentRepoPayload(db),
    repositories: await repositoriesPayload(db),
    settings: {
      only_requested_reviews: settingStore.onlyRequestedReviews(),
      current_user_login: settingStore.githubLogin(),
    },
    sync_status: await syncStatusPayload(db),
    counts: {
      pending_review: columns.pending_review.length,
      in_review: columns.in_review.length,
      reviewed_by_me: columns.reviewed_by_me.length,
      waiting_implementation: columns.waiting_implementation.length,
      reviewed_by_others: columns.reviewed_by_others.length,
      review_failed: columns.review_failed.length,
    },
    total_count: await pullRequestTotalCount(db, boardRepo),
    columns: {
      pending_review: columns.pending_review.map((pullRequest) => pullRequestPayload(db, pullRequest)),
      in_review: columns.in_review.map((pullRequest) => pullRequestPayload(db, pullRequest)),
      reviewed_by_me: columns.reviewed_by_me.map((pullRequest) => pullRequestPayload(db, pullRequest)),
      waiting_implementation: columns.waiting_implementation.map((pullRequest) => pullRequestPayload(db, pullRequest)),
      reviewed_by_others: columns.reviewed_by_others.map((pullRequest) => pullRequestPayload(db, pullRequest)),
      review_failed: columns.review_failed.map((pullRequest) => pullRequestPayload(db, pullRequest)),
    },
  }
}

// `ReviewTask.order(created_at: :desc).queued` keeps both orderings:
// created_at DESC first, then the scope's queued_at ASC.
function boardTasks(db: Db, state: ReviewTaskState) {
  const query = db.select().from(reviewTasks).where(tasksInState(state))
  if (state === 'queued') return query.orderBy(desc(reviewTasks.createdAt), asc(reviewTasks.queuedAt)).all()
  return query.orderBy(desc(reviewTasks.createdAt)).all()
}

export async function reviewTaskBoardPayload(source: PayloadSource) {
  const db = dbOf(source)
  const grouped = {
    queued: boardTasks(db, 'queued'),
    pending_review: boardTasks(db, 'pending_review'),
    in_review: boardTasks(db, 'in_review'),
    reviewed: boardTasks(db, 'reviewed'),
    waiting_implementation: boardTasks(db, 'waiting_implementation'),
    done: boardTasks(db, 'done'),
    failed_review: boardTasks(db, 'failed_review'),
  }
  const toPayload = (task: ReviewTaskRecord) => reviewTaskPayload(db, task)

  return {
    current_repo: await currentRepoPayload(db),
    counts: {
      queued: grouped.queued.length,
      pending_review: grouped.pending_review.length,
      in_review: grouped.in_review.length,
      reviewed: grouped.reviewed.length,
      waiting_implementation: grouped.waiting_implementation.length,
      done: grouped.done.length,
      failed_review: grouped.failed_review.length,
    },
    total_count: REVIEW_TASK_STATES.reduce((total, state) => total + grouped[state].length, 0),
    columns: {
      queued: grouped.queued.map(toPayload),
      pending_review: grouped.pending_review.map(toPayload),
      in_review: grouped.in_review.map(toPayload),
      reviewed: grouped.reviewed.map(toPayload),
      waiting_implementation: grouped.waiting_implementation.map(toPayload),
      done: grouped.done.map(toPayload),
      failed_review: grouped.failed_review.map(toPayload),
    },
  }
}

function submissionPayload(settingStore: SettingStore, comments: ReviewCommentRecord[]) {
  const pendingComments = comments.filter((comment) => comment.status === 'pending')
  const countFor = (severity: string) => pendingComments.filter((comment) => comment.severity === severity).length

  return {
    auto_submit_enabled: settingStore.autoSubmitEnabled(),
    pending_comment_count: pendingComments.length,
    severity_counts: {
      critical: countFor('critical'),
      major: countFor('major'),
      minor: countFor('minor'),
      suggestion: countFor('suggestion'),
      nitpick: countFor('nitpick'),
    },
    allowed_events: [...SUBMITTED_EVENTS],
  }
}

type ContentMode = 'comments' | 'parsed_review_items' | 'raw_output' | 'live_logs' | 'empty'

function contentMode(task: ReviewTaskRecord, comments: ReviewCommentRecord[], parsedItems: ReviewItem[]): ContentMode {
  if (comments.length > 0) return 'comments'
  if (parsedItems.length > 0) return 'parsed_review_items'
  if (isPresent(task.reviewOutput)) return 'raw_output'
  if (task.state === 'in_review' || task.state === 'pending_review') return 'live_logs'
  return 'empty'
}

export async function reviewTaskDetailPayload(source: PayloadSource, task: ReviewTaskRecord) {
  const db = dbOf(source)
  const comments = commentsBySeverity(db, task.id)
  const parsedItems = isBlank(task.reviewOutput) ? [] : parseReviewOutput(task.reviewOutput)
  const logs = recentLogs(db, task.id)

  return {
    current_repo: await currentRepoPayload(db),
    task: reviewTaskPayload(db, task),
    submission: submissionPayload(new SettingStore(db), comments),
    comments: comments.map(reviewCommentPayload),
    review_history: reviewHistory(db, task).map(reviewIterationPayload),
    parsed_review_items: parsedItems.map(parsedReviewItemPayload),
    raw_output: task.reviewOutput,
    raw_output_html: markdownHtml(task.reviewOutput),
    live_logs: logs.map(agentLogPayload),
    content_mode: contentMode(task, comments, parsedItems),
    meta: {
      formatted_duration: formatReviewDuration(task.startedAt, task.completedAt),
    },
  }
}
