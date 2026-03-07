class SyncPullRequestsJob < ApplicationJob
  queue_as :default

  def perform
    Sync::Engine.new(repo_path: Setting.current_repo).call(trigger: "job")
  rescue GithubCliService::Error, Sync::GithubAdapter::Error => e
    raise
  end
end
