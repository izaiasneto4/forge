import type { PullRequestBoardResponse, PullRequestItem, PullRequestReviewTaskSummary, ReviewCommentItem } from '../types/api'

let sequence = 0

export function buildTask(overrides: Partial<PullRequestReviewTaskSummary> = {}): PullRequestReviewTaskSummary {
  sequence += 1
  return {
    id: sequence,
    state: 'reviewed',
    archived: false,
    ai_model: null,
    cli_client: 'claude',
    review_type: 'review',
    retry_count: 0,
    max_retry_attempts: 3,
    can_retry: false,
    queued_at: null,
    queue_position: null,
    started_at: null,
    completed_at: null,
    failure_reason: null,
    submission_status: null,
    submitted_at: null,
    submitted_event: null,
    has_review_history: false,
    current_iteration_number: 1,
    swarm_review: false,
    review_focus: null,
    pending_comment_count: 0,
    pull_request_snapshot_id: null,
    analysis_status: 'current',
    snapshot_current: true,
    ...overrides,
  }
}

export function buildPullRequest(overrides: Partial<PullRequestItem> = {}): PullRequestItem {
  sequence += 1
  return {
    id: sequence,
    number: sequence,
    title: `Pull request ${sequence}`,
    url: `https://github.com/acme/api/pull/${sequence}`,
    author: 'someone',
    author_avatar: null,
    description: null,
    repo_owner: 'acme',
    repo_name: 'api',
    repo_full_name: 'acme/api',
    review_status: 'pending_review',
    archived: false,
    created_at_github: '2026-10-01T10:00:00Z',
    updated_at_github: '2026-10-02T10:00:00Z',
    remote_state: 'open',
    inactive_reason: null,
    snapshot_status: 'current',
    analysis_status: 'current',
    head_sha: null,
    base_sha: null,
    head_ref: 'feature',
    base_ref: 'main',
    latest_review_state: null,
    review_decision: null,
    check_status: null,
    draft: false,
    review_requested_for_me: false,
    lifecycle: 'needs_review',
    has_new_commits: false,
    additions: 10,
    deletions: 2,
    changed_files: 1,
    ai_summary: {
      status: 'none',
      generated_at: null,
      failure_reason: null,
      snapshot_id: null,
      stale: false,
      files_changed: null,
      lines_added: null,
      lines_removed: null,
      main_changes: [],
      risk_areas: [],
    },
    review_task: null,
    ...overrides,
  }
}

export function buildComment(overrides: Partial<ReviewCommentItem> = {}): ReviewCommentItem {
  sequence += 1
  return {
    id: sequence,
    title: `Finding ${sequence}`,
    severity: 'minor',
    status: 'pending',
    body: 'Body',
    body_html: '<p>Body</p>',
    file_path: 'app/models/example.rb',
    line_number: 1,
    location: 'app/models/example.rb:1',
    resolution_note: null,
    actionable: true,
    ...overrides,
  }
}

export function buildBoard(columns: Partial<PullRequestBoardResponse['columns']>): PullRequestBoardResponse {
  return {
    current_repo: { path: '/code/api', slug: 'acme/api', name: 'api' },
    repositories: { repos_folder: '/code', current_repo_path: '/code/api', current_repo_slug: 'acme/api', items: [] },
    settings: { only_requested_reviews: false, current_user_login: 'me' },
    sync_status: {
      status: 'idle',
      running: false,
      last_synced_at: null,
      last_started_at: null,
      last_finished_at: null,
      last_succeeded_at: null,
      last_error: null,
      fetched_count: 0,
      created_count: 0,
      updated_count: 0,
      deactivated_count: 0,
      seconds_until_sync_allowed: 0,
      sync_needed: false,
    },
    counts: { pending_review: 0, in_review: 0, reviewed_by_me: 0, waiting_implementation: 0, reviewed_by_others: 0, review_failed: 0 },
    total_count: 0,
    columns: {
      pending_review: [],
      in_review: [],
      reviewed_by_me: [],
      waiting_implementation: [],
      reviewed_by_others: [],
      review_failed: [],
      ...columns,
    },
  }
}
