class SyncPullRequestsJob < ApplicationJob
  queue_as :default

  def perform
    github_service = GithubCliService.new

    # Fetch latest from git repo
    repo_path = Setting.current_repo
    GithubCliService.fetch_latest_for_repo(repo_path) if repo_path.present?

    # Sync PRs from GitHub - this handles create/update
    github_service.sync_to_database!

    # Restore any deleted PRs that were re-synced
    restore_deleted_prs

    # Update last synced timestamp
    Setting.touch_last_synced!

    broadcast_sync_completed
  rescue GithubCliService::Error => e
    broadcast_sync_failed(e.message)
    raise
  end

  private

  def restore_deleted_prs
    # Find deleted PRs that have been re-synced (they now exist in the main scope)
    deleted_pr_ids = PullRequest.unscoped.deleted.pluck(:github_id)
    return if deleted_pr_ids.empty?

    # For each deleted PR, if it exists in the current (not deleted) scope, it was re-synced
    PullRequest.unscoped.deleted.find_each do |deleted_pr|
      # Check if this PR was re-fetched from GitHub
      current_pr = PullRequest.unscoped.not_deleted.find_by(github_id: deleted_pr.github_id)

      if current_pr
        # Update the re-synced PR to pending_review status
        current_pr.update!(review_status: "pending_review")

        # Actually delete the soft-deleted duplicate record
        deleted_pr.update_column(:deleted_at, Time.current)
      else
        # If PR is still deleted and wasn't re-fetched, restore it to pending_review
        deleted_pr.restore!
      end
    end
  end

  def broadcast_sync_completed
    ActionCable.server.broadcast(
      "pull_requests_sync",
      {
        type: "completed",
        timestamp: Time.current.iso8601
      }
    )
  end

  def broadcast_sync_failed(error_message)
    ActionCable.server.broadcast(
      "pull_requests_sync",
      {
        type: "failed",
        error: error_message,
        timestamp: Time.current.iso8601
      }
    )
  end
end
