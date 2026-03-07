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
    UiEventBroadcaster.sync_completed(Setting.current_repo)
  end

  def broadcast_sync_failed(error_message)
    UiEventBroadcaster.sync_failed(Setting.current_repo, error: error_message)
  end

  def safely_broadcast_sync_failed(error_message)
    broadcast_sync_failed(error_message)
  rescue => e
    Rails.logger.error("Failed to broadcast sync failure: #{e.class} #{e.message}")
  end
end
