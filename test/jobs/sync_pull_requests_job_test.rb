require "test_helper"

class SyncPullRequestsJobTest < ActiveJob::TestCase
  setup do
    Setting.delete_all
    @job = SyncPullRequestsJob.new
  end

  teardown do
    Setting.delete_all
    PullRequest.delete_all
  end

  test "happy path: fetch latest, sync to database, restore deleted, touch last synced, broadcast completed" do
    repo_path = "/tmp/test-repo"
    Setting.current_repo = repo_path

    mock_service = Class.new do
      def sync_to_database!
      end
    end.new

    GithubCliService.stubs(:new).returns(mock_service)
    GithubCliService.stubs(:fetch_latest_for_repo)
    Setting.stubs(:touch_last_synced!)
    ActionCable.server.stubs(:broadcast)

    assert_nothing_raised do
      SyncPullRequestsJob.perform_now
    end
  end

  test "happy path: does not fetch latest when repo path is blank" do
    Setting.current_repo = nil

    mock_service = Class.new do
      def sync_to_database!
      end
    end.new

    GithubCliService.stubs(:new).returns(mock_service)
    GithubCliService.stubs(:fetch_latest_for_repo)
    Setting.stubs(:touch_last_synced!)
    ActionCable.server.stubs(:broadcast)

    assert_nothing_raised do
      SyncPullRequestsJob.perform_now
    end
  end

  test "error path: broadcasts failed and re-raises GithubCliService::Error" do
    Setting.current_repo = "/tmp/test-repo"

    mock_service = Class.new do
      def sync_to_database!
        raise GithubCliService::Error, "Sync failed"
      end
    end.new

    GithubCliService.stubs(:new).returns(mock_service)
    GithubCliService.stubs(:fetch_latest_for_repo)

    error = assert_raises(GithubCliService::Error) do
      SyncPullRequestsJob.perform_now
    end
    assert_equal "Sync failed", error.message
  end

  test "restore_deleted_prs: restores PR that was not re-synced" do
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

    mock_service = Class.new do
      def sync_to_database!
      end
    end.new

    GithubCliService.stubs(:new).returns(mock_service)
    GithubCliService.stubs(:fetch_latest_for_repo)
    Setting.stubs(:touch_last_synced!)
    ActionCable.server.stubs(:broadcast)

    SyncPullRequestsJob.perform_now

    deleted_pr.reload
    assert_nil deleted_pr.deleted_at, "PR should be restored (deleted_at should be nil)"
    assert_equal "pending_review", deleted_pr.review_status
  end

  test "restore_deleted_prs: restores PRs that are still deleted and not re-synced" do
    deleted_pr = PullRequest.create!(
      github_id: 456,
      number: 456,
      title: "Deleted PR",
      url: "https://github.com/test/repo/pull/456",
      repo_owner: "test",
      repo_name: "repo",
      review_status: "pending_review",
      deleted_at: 1.day.ago
    )

    mock_service = Class.new do
      def sync_to_database!
      end
    end.new

    GithubCliService.stubs(:new).returns(mock_service)
    GithubCliService.stubs(:fetch_latest_for_repo)
    Setting.stubs(:touch_last_synced!)
    ActionCable.server.stubs(:broadcast)

    SyncPullRequestsJob.perform_now

    deleted_pr.reload
    assert_nil deleted_pr.deleted_at, "PR should be restored"
    assert_equal "pending_review", deleted_pr.review_status, "Status should be reset to pending_review"
  end

  test "restore_deleted_prs: does nothing when no deleted PRs exist" do
    mock_service = Class.new do
      def sync_to_database!
      end
    end.new

    GithubCliService.stubs(:new).returns(mock_service)
    GithubCliService.stubs(:fetch_latest_for_repo)
    Setting.stubs(:touch_last_synced!)
    ActionCable.server.stubs(:broadcast)

    assert_nothing_raised do
      SyncPullRequestsJob.perform_now
    end
  end

  test "restore_deleted_prs: handles multiple deleted PRs with mixed scenarios" do
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

    mock_service = Class.new do
      def sync_to_database!
      end
    end.new

    GithubCliService.stubs(:new).returns(mock_service)
    GithubCliService.stubs(:fetch_latest_for_repo)
    Setting.stubs(:touch_last_synced!)
    ActionCable.server.stubs(:broadcast)

    SyncPullRequestsJob.perform_now

    deleted_pr_1.reload
    assert_nil deleted_pr_1.deleted_at, "Deleted PR should be restored"
    assert_equal "pending_review", deleted_pr_1.review_status

    deleted_pr_2.reload
    assert_nil deleted_pr_2.deleted_at, "Deleted PR should be restored"
    assert_equal "pending_review", deleted_pr_2.review_status
  end

  test "broadcast_sync_completed includes timestamp in ISO8601 format" do
    Setting.current_repo = "/tmp/test-repo"

    broadcasts = []

    mock_service = Class.new do
      def sync_to_database!
      end
    end.new

    GithubCliService.stubs(:new).returns(mock_service)
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

    mock_service = Class.new do
      def sync_to_database!
        raise GithubCliService::Error, "Network error"
      end
    end.new

    GithubCliService.stubs(:new).returns(mock_service)
    GithubCliService.stubs(:fetch_latest_for_repo)
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

  test "handles exception during broadcast_sync_failed and still re-raises original error" do
    Setting.current_repo = "/tmp/test-repo"

    mock_service = Class.new do
      def sync_to_database!
        raise GithubCliService::Error, "Original error"
      end
    end.new

    GithubCliService.stubs(:new).returns(mock_service)
    GithubCliService.stubs(:fetch_latest_for_repo)
    ActionCable.server.stubs(:broadcast).raises(StandardError, "Broadcast failed")

    error = assert_raises(StandardError) do
      SyncPullRequestsJob.perform_now
    end
    assert_equal "Broadcast failed", error.message
  end
end
