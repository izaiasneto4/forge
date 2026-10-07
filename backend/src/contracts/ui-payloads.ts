import { t, type TSchema } from 'elysia'
import { okSchema } from '../http/envelope'

// Response contracts for Api::V1::UiPayloads, mirroring frontend/src/types/api.ts.
// Every key the presenters emit must be listed: Elysia drops unknown response
// keys. Free-text DB columns (states, statuses, severities) stay `String` and
// DB-nullable columns stay nullable, so data Rails would serialize never turns
// into a contract violation.

const NullableString = t.Nullable(t.String())
const NullableInteger = t.Nullable(t.Integer())
const Timestamp = NullableString

export const ThemePreference = t.Union([t.Literal('light'), t.Literal('dark')])

export const AnalysisStatus = t.Union([t.Literal('none'), t.Literal('pending'), t.Literal('current'), t.Literal('stale')])
export const SnapshotStatus = t.Union([t.Literal('missing'), t.Literal('current'), t.Literal('stale')])
export const Lifecycle = t.Union([
  t.Literal('needs_review'),
  t.Literal('queued'),
  t.Literal('reviewing'),
  t.Literal('ready'),
  t.Literal('failed'),
  t.Literal('waiting'),
  t.Literal('settled'),
  t.Literal('authored'),
])

export const CurrentRepo = t.Object({
  path: NullableString,
  slug: NullableString,
  name: NullableString,
})

// SyncState#payload; the default status (no sync state yet) has no last_synced_at.
export const SyncStatus = t.Object({
  status: t.String(),
  running: t.Boolean(),
  last_synced_at: t.Optional(Timestamp),
  last_started_at: Timestamp,
  last_finished_at: Timestamp,
  last_succeeded_at: Timestamp,
  last_error: NullableString,
  fetched_count: t.Integer(),
  created_count: t.Integer(),
  updated_count: t.Integer(),
  deactivated_count: t.Integer(),
  seconds_until_sync_allowed: t.Integer(),
  sync_needed: t.Boolean(),
})

export const RepositoryItem = t.Object({
  name: t.String(),
  path: t.String(),
  branch: NullableString,
  slug: NullableString,
  current: t.Boolean(),
})

export const Repositories = t.Object({
  repos_folder: NullableString,
  current_repo_path: NullableString,
  current_repo_slug: NullableString,
  items: t.Array(RepositoryItem),
})

export const CompactPullRequest = t.Object({
  id: t.Integer(),
  number: NullableInteger,
  title: NullableString,
  url: NullableString,
  author: NullableString,
  author_avatar: NullableString,
  repo_name: NullableString,
  repo_full_name: t.String(),
  review_status: NullableString,
  remote_state: t.String(),
  inactive_reason: NullableString,
  snapshot_status: SnapshotStatus,
  analysis_status: AnalysisStatus,
  additions: NullableInteger,
  deletions: NullableInteger,
  changed_files: NullableInteger,
})

export const ReviewTaskItem = t.Object({
  id: t.Integer(),
  state: t.String(),
  archived: t.Boolean(),
  ai_model: NullableString,
  cli_client: t.String(),
  review_type: t.String(),
  retry_count: t.Integer(),
  max_retry_attempts: t.Integer(),
  can_retry: t.Boolean(),
  queued_at: Timestamp,
  queue_position: NullableInteger,
  started_at: Timestamp,
  completed_at: Timestamp,
  failure_reason: NullableString,
  submission_status: NullableString,
  submitted_at: Timestamp,
  submitted_event: NullableString,
  has_review_history: t.Boolean(),
  current_iteration_number: t.Integer(),
  swarm_review: t.Boolean(),
  review_focus: NullableString,
  pending_comment_count: t.Integer(),
  pull_request_snapshot_id: NullableInteger,
  analysis_status: AnalysisStatus,
  snapshot_current: t.Boolean(),
  pull_request: t.Nullable(CompactPullRequest),
})

export const AiSummary = t.Object({
  status: t.String(),
  generated_at: Timestamp,
  failure_reason: NullableString,
  snapshot_id: NullableInteger,
  stale: t.Boolean(),
  files_changed: NullableInteger,
  lines_added: NullableInteger,
  lines_removed: NullableInteger,
  main_changes: t.Array(t.String()),
  risk_areas: t.Array(t.String()),
})

export const PullRequestItem = t.Object({
  id: t.Integer(),
  number: NullableInteger,
  title: NullableString,
  url: NullableString,
  author: NullableString,
  author_avatar: NullableString,
  description: NullableString,
  repo_owner: NullableString,
  repo_name: NullableString,
  repo_full_name: t.String(),
  review_status: NullableString,
  archived: t.Boolean(),
  created_at_github: Timestamp,
  updated_at_github: Timestamp,
  remote_state: t.String(),
  inactive_reason: NullableString,
  snapshot_status: SnapshotStatus,
  analysis_status: AnalysisStatus,
  head_sha: NullableString,
  base_sha: NullableString,
  head_ref: NullableString,
  base_ref: NullableString,
  latest_review_state: NullableString,
  review_decision: NullableString,
  check_status: NullableString,
  draft: t.Boolean(),
  additions: NullableInteger,
  deletions: NullableInteger,
  changed_files: NullableInteger,
  ai_summary: AiSummary,
  review_requested_for_me: t.Boolean(),
  lifecycle: Lifecycle,
  has_new_commits: t.Boolean(),
  review_task: t.Nullable(ReviewTaskItem),
})

function byPullRequestStatus<Schema extends TSchema>(schema: Schema) {
  return t.Object({
    pending_review: schema,
    in_review: schema,
    reviewed_by_me: schema,
    waiting_implementation: schema,
    reviewed_by_others: schema,
    review_failed: schema,
  })
}

function byReviewTaskState<Schema extends TSchema>(schema: Schema) {
  return t.Object({
    queued: schema,
    pending_review: schema,
    in_review: schema,
    reviewed: schema,
    waiting_implementation: schema,
    done: schema,
    failed_review: schema,
  })
}

export const PullRequestBoard = t.Object({
  current_repo: CurrentRepo,
  repositories: Repositories,
  settings: t.Object({
    only_requested_reviews: t.Boolean(),
    current_user_login: NullableString,
  }),
  sync_status: SyncStatus,
  counts: byPullRequestStatus(t.Integer()),
  total_count: t.Integer(),
  columns: byPullRequestStatus(t.Array(PullRequestItem)),
  settled_reviews: t.Array(PullRequestItem),
})

export const ReviewTaskBoard = t.Object({
  current_repo: CurrentRepo,
  counts: byReviewTaskState(t.Integer()),
  total_count: t.Integer(),
  columns: byReviewTaskState(t.Array(ReviewTaskItem)),
})

export const ReviewCommentItem = t.Object({
  id: t.Integer(),
  title: NullableString,
  severity: t.String(),
  status: t.String(),
  body: t.String(),
  body_html: NullableString,
  file_path: t.String(),
  line_number: NullableInteger,
  location: t.String(),
  resolution_note: NullableString,
  actionable: t.Boolean(),
})

export const ParsedReviewItem = t.Object({
  title: NullableString,
  severity: t.String(),
  severity_emoji: t.String(),
  file: NullableString,
  lines: NullableString,
  location: t.String(),
  comment: NullableString,
  comment_html: NullableString,
  suggested_fix: NullableString,
  suggested_fix_is_code: t.Boolean(),
  suggested_fix_html: NullableString,
})

export const ReviewIterationItem = t.Object({
  id: t.Integer(),
  iteration_number: t.Integer(),
  cli_client: t.String(),
  review_type: t.String(),
  ai_model: NullableString,
  from_state: t.String(),
  to_state: t.String(),
  started_at: Timestamp,
  completed_at: Timestamp,
  duration_seconds: NullableInteger,
  parsed_review_items: t.Array(ParsedReviewItem),
  raw_output: NullableString,
  raw_output_html: NullableString,
  output_mode: t.Union([t.Literal('parsed_review_items'), t.Literal('raw_output'), t.Literal('empty')]),
})

export const AgentLogItem = t.Object({
  id: t.Integer(),
  log_type: t.String(),
  message: NullableString,
  created_at: t.String(),
})

const SeverityCounts = t.Object({
  critical: t.Integer(),
  major: t.Integer(),
  minor: t.Integer(),
  suggestion: t.Integer(),
  nitpick: t.Integer(),
})

export const ReviewTaskDetail = t.Object({
  current_repo: CurrentRepo,
  task: ReviewTaskItem,
  pull_request: PullRequestItem,
  submission: t.Object({
    auto_submit_enabled: t.Boolean(),
    pending_comment_count: t.Integer(),
    severity_counts: SeverityCounts,
    allowed_events: t.Array(t.String()),
  }),
  comments: t.Array(ReviewCommentItem),
  review_history: t.Array(ReviewIterationItem),
  parsed_review_items: t.Array(ParsedReviewItem),
  raw_output: NullableString,
  raw_output_html: NullableString,
  live_logs: t.Array(AgentLogItem),
  content_mode: t.Union([
    t.Literal('comments'),
    t.Literal('parsed_review_items'),
    t.Literal('raw_output'),
    t.Literal('live_logs'),
    t.Literal('empty'),
  ]),
  meta: t.Object({
    formatted_duration: NullableString,
  }),
})

export const Bootstrap = t.Object({
  app: t.Object({
    name: t.String(),
    cli_clients: t.Array(t.String()),
    valid_theme_preferences: t.Array(ThemePreference),
  }),
  current_repo: CurrentRepo,
  settings: t.Object({
    default_cli_client: t.String(),
    auto_submit_enabled: t.Boolean(),
    only_requested_reviews: t.Boolean(),
    theme_preference: t.Nullable(ThemePreference),
    github_login: NullableString,
  }),
  counts: t.Object({
    pending_review: t.Integer(),
    in_review: t.Integer(),
  }),
  sync_status: SyncStatus,
})

export const BootstrapResponse = okSchema(Bootstrap.properties)
export const PullRequestBoardResponse = okSchema(PullRequestBoard.properties)
export const ReviewTaskBoardResponse = okSchema(ReviewTaskBoard.properties)
export const ReviewTaskDetailResponse = okSchema(ReviewTaskDetail.properties)
export const RepositoriesResponse = okSchema(Repositories.properties)
