class SyncPullRequestsJob < ApplicationJob
  queue_as :default

  def perform
    repo_path = Setting.current_repo

    GithubCliService.fetch_latest_for_repo(repo_path) if repo_path.present?

    Sync::Orchestrator.new(repo_path: repo_path).call

    Setting.touch_last_synced!

    broadcast_sync_completed
  rescue GithubCliService::Error, Sync::FetchAllPrs::Error => e
    safely_broadcast_sync_failed(e.message)
    raise
  end

  private

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

  def safely_broadcast_sync_failed(error_message)
    broadcast_sync_failed(error_message)
  rescue => e
    Rails.logger.error("Failed to broadcast sync failure: #{e.class} #{e.message}")
  end
end
