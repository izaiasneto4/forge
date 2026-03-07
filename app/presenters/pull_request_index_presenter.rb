class PullRequestIndexPresenter
  attr_reader :current_repo

  def initialize
    @current_repo = Setting.current_repo
  end

  def columns
    base_scope = PullRequest.for_current_repo(current_repo)

    {
      pending_review: base_scope.pending_review.includes(:pull_request_snapshots, review_task: [ :review_comments, :review_iterations ]).order(updated_at_github: :desc),
      in_review: base_scope.in_review.includes(:pull_request_snapshots, review_task: [ :review_comments, :review_iterations ]).order(updated_at_github: :desc),
      reviewed_by_me: base_scope.reviewed_by_me.includes(:pull_request_snapshots, review_task: [ :review_comments, :review_iterations ]).order(updated_at_github: :desc),
      waiting_implementation: base_scope.waiting_implementation.includes(:pull_request_snapshots, review_task: [ :review_comments, :review_iterations ]).order(updated_at_github: :desc),
      reviewed_by_others: base_scope.reviewed_by_others.includes(:pull_request_snapshots, review_task: [ :review_comments, :review_iterations ]).order(updated_at_github: :desc),
      review_failed: base_scope.review_failed.includes(:pull_request_snapshots, review_task: [ :review_comments, :review_iterations ]).order(updated_at_github: :desc)
    }
  end

  def total_count
    @total_count ||= PullRequest.for_current_repo(current_repo).active_remote.count
  end

  def sync_status
    current_sync_state&.payload || default_sync_status
  end

  def build_sync_skipped_message
    seconds = sync_status[:seconds_until_sync_allowed]
    minutes = (seconds / 60.0).ceil
    time_msg = minutes > 1 ? "#{minutes} minutes" : "#{seconds} seconds"
    "Using cached data (next sync available in #{time_msg})"
  end

  private

  def current_sync_state
    @current_sync_state ||= SyncState.for_repo_path(current_repo)
  end

  def default_sync_status
    {
      status: "idle",
      running: false,
      last_started_at: nil,
      last_finished_at: nil,
      last_succeeded_at: nil,
      last_error: nil,
      fetched_count: 0,
      created_count: 0,
      updated_count: 0,
      deactivated_count: 0,
      seconds_until_sync_allowed: 0,
      sync_needed: false
    }
  end
end
