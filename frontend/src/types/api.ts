export interface ApiError {
  code: string
  message: string
  details?: unknown
}

export interface SyncStatus {
  last_synced_at: string | null
  seconds_until_sync_allowed: number
  sync_needed: boolean
}

export interface CurrentRepo {
  path: string | null
  slug: string | null
  name: string | null
}

export interface RepositoryItem {
  name: string
  path: string
  branch: string | null
  slug: string | null
  current: boolean
}

export interface RepositoryListResponse {
  repos_folder: string | null
  current_repo_path: string | null
  current_repo_slug: string | null
  items: RepositoryItem[]
}

export type PullRequestStatus =
  | 'pending_review'
  | 'in_review'
  | 'reviewed_by_me'
  | 'waiting_implementation'
  | 'reviewed_by_others'
  | 'review_failed'

export type ReviewTaskState =
  | 'queued'
  | 'pending_review'
  | 'in_review'
  | 'reviewed'
  | 'waiting_implementation'
  | 'done'
  | 'failed_review'

export interface PullRequestReviewTaskSummary {
  id: number
  state: ReviewTaskState
  archived: boolean
  ai_model: string | null
  cli_client: string
  review_type: string
  retry_count: number
  max_retry_attempts: number
  can_retry: boolean
  queued_at: string | null
  queue_position: number | null
  started_at: string | null
  completed_at: string | null
  failure_reason: string | null
  submission_status: string | null
  submitted_at: string | null
  submitted_event: string | null
  has_review_history: boolean
  current_iteration_number: number
  swarm_review: boolean
}

export interface PullRequestItem {
  id: number
  number: number
  title: string
  url: string
  author: string | null
  author_avatar: string | null
  description: string | null
  repo_owner: string
  repo_name: string
  repo_full_name: string
  review_status: PullRequestStatus
  archived: boolean
  created_at_github: string | null
  updated_at_github: string | null
  review_requested_for_me: boolean
  review_task: PullRequestReviewTaskSummary | null
}

export interface PullRequestBoardResponse {
  current_repo: CurrentRepo
  repositories: RepositoryListResponse
  settings: {
    only_requested_reviews: boolean
    current_user_login: string | null
  }
  sync_status: SyncStatus
  counts: Record<PullRequestStatus, number>
  total_count: number
  columns: Record<PullRequestStatus, PullRequestItem[]>
}

export interface CompactPullRequest {
  id: number
  number: number
  title: string
  url: string
  author: string | null
  author_avatar: string | null
  repo_name: string
  repo_full_name: string
  review_status: PullRequestStatus
}

export interface ReviewTaskItem {
  id: number
  state: ReviewTaskState
  archived: boolean
  ai_model: string | null
  cli_client: string
  review_type: string
  retry_count: number
  max_retry_attempts: number
  can_retry: boolean
  queued_at: string | null
  queue_position: number | null
  started_at: string | null
  completed_at: string | null
  failure_reason: string | null
  submission_status: string | null
  submitted_at: string | null
  submitted_event: string | null
  has_review_history: boolean
  current_iteration_number: number
  swarm_review: boolean
  pull_request: CompactPullRequest | null
}

export interface ReviewTaskBoardResponse {
  current_repo: CurrentRepo
  counts: Record<ReviewTaskState, number>
  total_count: number
  columns: Record<ReviewTaskState, ReviewTaskItem[]>
}

export interface ReviewCommentItem {
  id: number
  title: string | null
  severity: 'critical' | 'major' | 'minor' | 'suggestion' | 'nitpick'
  status: 'pending' | 'addressed' | 'dismissed'
  body: string
  body_html: string
  file_path: string
  line_number: number | null
  location: string
  resolution_note: string | null
  actionable: boolean
}

export interface ParsedReviewItem {
  title: string | null
  severity: string
  severity_emoji: string
  file: string | null
  lines: string | null
  location: string
  comment: string | null
  comment_html: string | null
  suggested_fix: string | null
  suggested_fix_is_code: boolean
  suggested_fix_html: string | null
}

export interface ReviewIterationItem {
  id: number
  iteration_number: number
  cli_client: string
  review_type: string
  ai_model: string | null
  from_state: string
  to_state: string
  started_at: string | null
  completed_at: string | null
  duration_seconds: number | null
  parsed_review_items: ParsedReviewItem[]
  raw_output: string | null
  raw_output_html: string | null
  output_mode: 'parsed_review_items' | 'raw_output' | 'empty'
}

export interface AgentLogItem {
  id: number
  log_type: 'output' | 'error' | 'status'
  message: string
  created_at: string
}

export interface ReviewTaskDetailResponse {
  current_repo: CurrentRepo
  task: ReviewTaskItem
  submission: {
    auto_submit_enabled: boolean
    pending_comment_count: number
    severity_counts: Record<'critical' | 'major' | 'minor' | 'suggestion' | 'nitpick', number>
    allowed_events: string[]
  }
  comments: ReviewCommentItem[]
  review_history: ReviewIterationItem[]
  parsed_review_items: ParsedReviewItem[]
  raw_output: string | null
  raw_output_html: string | null
  live_logs: AgentLogItem[]
  content_mode: 'comments' | 'parsed_review_items' | 'raw_output' | 'live_logs' | 'empty'
  meta: {
    formatted_duration: string | null
  }
}

export interface SettingsResponse {
  repos_folder: string | null
  current_repo: CurrentRepo
  default_cli_client: string
  auto_submit_enabled: boolean
  theme_preference: 'light' | 'dark' | null
  cli_clients: string[]
  valid_theme_preferences: Array<'light' | 'dark'>
}

export interface BootstrapResponse {
  app: {
    name: string
    cli_clients: string[]
    valid_theme_preferences: Array<'light' | 'dark'>
  }
  current_repo: CurrentRepo
  settings: {
    default_cli_client: string
    auto_submit_enabled: boolean
    only_requested_reviews: boolean
    theme_preference: 'light' | 'dark' | null
    github_login: string | null
  }
  counts: {
    pending_review: number
    in_review: number
  }
  sync_status: SyncStatus
}

export interface UiMutationResponse {
  message?: string
  board?: PullRequestBoardResponse
  detail?: ReviewTaskDetailResponse
  review_task_board?: ReviewTaskBoardResponse
  pull_request_board?: PullRequestBoardResponse
  repositories?: RepositoryListResponse
  settings?: SettingsResponse
  deleted_count?: number
  cleared_review_task_id?: number
}
