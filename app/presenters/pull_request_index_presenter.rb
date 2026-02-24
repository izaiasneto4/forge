class PullRequestIndexPresenter
  attr_reader :current_repo

  def initialize
    @current_repo = Setting.current_repo
  end

  def columns
    base_scope = PullRequest.for_current_repo(current_repo)

    {
      pending_review: base_scope.pending_review.includes(:review_task).order(updated_at_github: :desc),
      in_review: base_scope.in_review.includes(:review_task).order(updated_at_github: :desc),
      reviewed_by_me: base_scope.reviewed_by_me.includes(:review_task).order(updated_at_github: :desc),
      waiting_implementation: base_scope.waiting_implementation.includes(:review_task).order(updated_at_github: :desc),
      reviewed_by_others: base_scope.reviewed_by_others.includes(:review_task).order(updated_at_github: :desc),
      review_failed: base_scope.review_failed.includes(:review_task).order(updated_at_github: :desc)
    }
  end

  def total_count
    columns.values.sum(&:count)
  end

  def sync_status
    {
      last_synced_at: Setting.last_synced_at,
      seconds_until_sync_allowed: Setting.seconds_until_sync_allowed,
      sync_needed: Setting.sync_needed?
    }
  end

  def build_sync_skipped_message
    seconds = Setting.seconds_until_sync_allowed
    minutes = (seconds / 60.0).ceil
    time_msg = minutes > 1 ? "#{minutes} minutes" : "#{seconds} seconds"
    "Using cached data (next sync available in #{time_msg})"
  end
end
