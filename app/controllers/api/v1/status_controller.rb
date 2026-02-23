class Api::V1::StatusController < Api::V1::BaseController
  def index
    ReviewTask.recover_orphaned_in_review_tasks!
    ReviewTask.process_queue_if_idle!

    running = ReviewTask.in_review.order(:id).first

    render_ok(
      {
        repo: RepoSlugResolver.from_path(Setting.current_repo),
        counts: {
          pending_review: PullRequest.pending_review.count,
          in_review: PullRequest.in_review.count,
          queued: ReviewTask.queued.count,
          failed_review: ReviewTask.failed_review.count
        },
        running_task_id: running&.id,
        last_synced_at: Setting.last_synced_at&.iso8601
      }
    )
  end
end
