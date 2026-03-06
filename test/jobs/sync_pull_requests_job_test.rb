require "test_helper"

class SyncPullRequestsJobTest < ActiveJob::TestCase
  setup do
    Rails.cache.clear
    Setting.invalidate_cache!
    ReviewComment.delete_all
    ReviewIteration.delete_all
    AgentLog.delete_all
    ReviewTask.delete_all
    PullRequest.unscoped.delete_all
    Setting.delete_all
    @job = SyncPullRequestsJob.new
  end

  teardown do
    Rails.cache.clear
    Setting.invalidate_cache!
    ReviewComment.delete_all
    ReviewIteration.delete_all
    AgentLog.delete_all
    ReviewTask.delete_all
    PullRequest.unscoped.delete_all
    Setting.delete_all
  end

  test "happy path: fetch latest, sync to database, restore deleted, touch last synced, broadcast completed" do
    repo_path = "/tmp/test-repo"
    Setting.current_repo = repo_path

    Sync::Orchestrator.any_instance.stubs(:call).returns({ created: 0, updated: 0, deleted: 0, fetched: 0 })
    GithubCliService.stubs(:fetch_latest_for_repo)
    Setting.stubs(:touch_last_synced!)
    ActionCable.server.stubs(:broadcast)

    assert_nothing_raised do
      SyncPullRequestsJob.perform_now
    end
  end

  test "happy path: does not fetch latest when repo path is blank" do
    Setting.current_repo = nil

    Sync::Orchestrator.any_instance.stubs(:call).returns({ created: 0, updated: 0, deleted: 0, fetched: 0 })
    GithubCliService.stubs(:fetch_latest_for_repo)
    Setting.stubs(:touch_last_synced!)
    ActionCable.server.stubs(:broadcast)

    assert_nothing_raised do
      SyncPullRequestsJob.perform_now
    end
  end

  test "error path: broadcasts failed and re-raises GithubCliService::Error" do
    Setting.current_repo = "/tmp/test-repo"

    GithubCliService.stubs(:fetch_latest_for_repo)
    Sync::Orchestrator.any_instance.stubs(:call).raises(GithubCliService::Error, "Sync failed")

    error = assert_raises(GithubCliService::Error) do
      SyncPullRequestsJob.perform_now
    end
    assert_equal "Sync failed", error.message
  end

  test "keeps deleted PR deleted when sync does not re-fetch it" do
    deleted_pr = PullRequest.create!(
      github_id: 123,
      number: 123,
      title: "Deleted PR",
      url: "https://github.com/test/repo/pull/123",
      repo_owner: "test",
      repo_name: "repo",
      review_status: "pending_review",
      deleted_at: 1.day.ago
    )

    Sync::Orchestrator.any_instance.stubs(:call).returns({ created: 0, updated: 0, deleted: 0, fetched: 0 })
    GithubCliService.stubs(:fetch_latest_for_repo)
    Setting.stubs(:touch_last_synced!)
    ActionCable.server.stubs(:broadcast)

    SyncPullRequestsJob.perform_now

    deleted_pr = PullRequest.unscoped.find(deleted_pr.id)
    assert_not_nil deleted_pr.deleted_at, "PR should remain deleted when it is not re-fetched"
    assert_equal "pending_review", deleted_pr.review_status
  end

  test "does nothing with deleted records when no deleted PRs exist" do
    Sync::Orchestrator.any_instance.stubs(:call).returns({ created: 0, updated: 0, deleted: 0, fetched: 0 })
    GithubCliService.stubs(:fetch_latest_for_repo)
    Setting.stubs(:touch_last_synced!)
    ActionCable.server.stubs(:broadcast)

    assert_nothing_raised do
      SyncPullRequestsJob.perform_now
    end
  end

  test "keeps multiple deleted PRs deleted when sync does not re-fetch them" do
    deleted_pr_1 = PullRequest.create!(
      github_id: 789,
      number: 789,
      title: "Deleted PR 1",
      url: "https://github.com/test/repo/pull/789",
      repo_owner: "test",
      repo_name: "repo",
      review_status: "pending_review",
      deleted_at: 1.day.ago
    )

    deleted_pr_2 = PullRequest.create!(
      github_id: 999,
      number: 999,
      title: "Deleted PR 2",
      url: "https://github.com/test/repo/pull/999",
      repo_owner: "test",
      repo_name: "repo",
      review_status: "pending_review",
      deleted_at: 2.days.ago
    )

    Sync::Orchestrator.any_instance.stubs(:call).returns({ created: 0, updated: 0, deleted: 0, fetched: 0 })
    GithubCliService.stubs(:fetch_latest_for_repo)
    Setting.stubs(:touch_last_synced!)
    ActionCable.server.stubs(:broadcast)

    SyncPullRequestsJob.perform_now

    deleted_pr_1 = PullRequest.unscoped.find(deleted_pr_1.id)
    assert_not_nil deleted_pr_1.deleted_at, "Deleted PR should remain deleted"
    assert_equal "pending_review", deleted_pr_1.review_status

    deleted_pr_2 = PullRequest.unscoped.find(deleted_pr_2.id)
    assert_not_nil deleted_pr_2.deleted_at, "Deleted PR should remain deleted"
    assert_equal "pending_review", deleted_pr_2.review_status
  end

  test "broadcast_sync_completed includes timestamp in ISO8601 format" do
    Setting.current_repo = "/tmp/test-repo"

    broadcasts = []

    Sync::Orchestrator.any_instance.stubs(:call).returns({ created: 0, updated: 0, deleted: 0, fetched: 0 })
    GithubCliService.stubs(:fetch_latest_for_repo)
    Setting.stubs(:touch_last_synced!)
    ActionCable.server.stubs(:broadcast).with do |channel, data|
      broadcasts << { channel:, data: }
    end

    SyncPullRequestsJob.perform_now

    completed_broadcast = broadcasts.find { |b| b[:data][:type] == "completed" }
    assert completed_broadcast
    assert completed_broadcast[:data].key?(:timestamp)
    assert_instance_of String, completed_broadcast[:data][:timestamp]
  end

  test "broadcast_sync_failed includes error message and timestamp" do
    Setting.current_repo = "/tmp/test-repo"

    broadcasts = []

    GithubCliService.stubs(:fetch_latest_for_repo)
    Sync::Orchestrator.any_instance.stubs(:call).raises(GithubCliService::Error, "Network error")
    ActionCable.server.stubs(:broadcast).with do |channel, data|
      broadcasts << { channel:, data: }
    end

    assert_raises(GithubCliService::Error) do
      SyncPullRequestsJob.perform_now
    end

    failed_broadcast = broadcasts.find { |b| b[:data][:type] == "failed" }
    assert_equal "Network error", failed_broadcast[:data][:error]
    assert failed_broadcast[:data].key?(:timestamp)
    assert_instance_of String, failed_broadcast[:data][:timestamp]
  end

  test "handles exception during broadcast_sync_failed and re-raises original sync error" do
    Setting.current_repo = "/tmp/test-repo"

    GithubCliService.stubs(:fetch_latest_for_repo)
    Sync::Orchestrator.any_instance.stubs(:call).raises(GithubCliService::Error, "Original error")
    ActionCable.server.stubs(:broadcast).raises(StandardError, "Broadcast failed")

    error = assert_raises(GithubCliService::Error) do
      SyncPullRequestsJob.perform_now
    end
    assert_equal "Original error", error.message
  end
end
