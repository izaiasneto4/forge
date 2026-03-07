require "test_helper"

class PullRequestIndexPresenterTest < ActiveSupport::TestCase
  self.use_transactional_tests = false

  setup do
    Rails.cache.clear
    ReviewComment.delete_all
    ReviewIteration.delete_all
    AgentLog.delete_all
    ReviewTask.delete_all
    PullRequestSnapshot.delete_all
    PullRequest.unscoped.delete_all
    SyncState.delete_all
    Setting.delete_all
    Setting.current_repo = nil
  end

  teardown do
    Rails.cache.clear
    ReviewComment.delete_all
    ReviewIteration.delete_all
    AgentLog.delete_all
    ReviewTask.delete_all
    PullRequestSnapshot.delete_all
    PullRequest.unscoped.delete_all
    SyncState.delete_all
    Setting.delete_all
  end

  test "columns groups only active pull requests by status" do
    PullRequest.create!(
      github_id: 1,
      number: 1,
      title: "Pending",
      url: "https://github.com/acme/api/pull/1",
      repo_owner: "acme",
      repo_name: "api",
      review_status: "pending_review",
      updated_at_github: 2.hours.ago
    )
    PullRequest.create!(
      github_id: 2,
      number: 2,
      title: "Inactive",
      url: "https://github.com/acme/api/pull/2",
      repo_owner: "acme",
      repo_name: "api",
      review_status: "pending_review",
      remote_state: "merged",
      inactive_reason: "merged",
      updated_at_github: 1.hour.ago
    )
    PullRequest.create!(
      github_id: 3,
      number: 3,
      title: "Reviewed",
      url: "https://github.com/acme/api/pull/3",
      repo_owner: "acme",
      repo_name: "api",
      review_status: "pending_review",
      updated_at_github: Time.current
    ).tap do |pull_request|
      pull_request.create_review_task!(state: "reviewed")
      pull_request.update!(review_status: "reviewed_by_me")
    end

    columns = PullRequestIndexPresenter.new.columns

    assert_equal [ 1 ], columns[:pending_review].map(&:number)
    assert_equal [ 3 ], columns[:reviewed_by_me].map(&:number)
    assert_empty columns[:in_review]
  end

  test "total_count excludes archived and inactive pull requests" do
    PullRequest.create!(
      github_id: 3,
      number: 3,
      title: "Visible",
      url: "https://github.com/acme/api/pull/3",
      repo_owner: "acme",
      repo_name: "api",
      review_status: "pending_review"
    )
    PullRequest.create!(
      github_id: 4,
      number: 4,
      title: "Merged",
      url: "https://github.com/acme/api/pull/4",
      repo_owner: "acme",
      repo_name: "api",
      review_status: "pending_review",
      remote_state: "merged",
      inactive_reason: "merged"
    )
    archived = PullRequest.create!(
      github_id: 5,
      number: 5,
      title: "Archived",
      url: "https://github.com/acme/api/pull/5",
      repo_owner: "acme",
      repo_name: "api",
      review_status: "pending_review"
    )
    archived.archive!

    assert_equal 1, PullRequestIndexPresenter.new.total_count
  end

  test "sync_status reflects repo scoped sync state" do
    Setting.stubs(:current_repo).returns("/tmp/repo")
    SyncState.stubs(:for_repo_path).with("/tmp/repo").returns(
      stub(payload: {
        status: "partial",
        running: false,
        last_synced_at: "2026-03-07T12:00:00Z",
        last_started_at: "2026-03-07T12:00:00Z",
        last_finished_at: "2026-03-07T12:01:00Z",
        last_succeeded_at: "2026-03-07T12:00:00Z",
        last_error: "boom",
        fetched_count: 5,
        created_count: 1,
        updated_count: 2,
        deactivated_count: 1,
        seconds_until_sync_allowed: 42,
        sync_needed: false
      })
    )

    status = PullRequestIndexPresenter.new.sync_status

    assert_equal "partial", status[:status]
    assert_equal 42, status[:seconds_until_sync_allowed]
    assert_equal false, status[:sync_needed]
  end

  test "build_sync_skipped_message uses minutes for larger values" do
    presenter = PullRequestIndexPresenter.new
    presenter.stubs(:sync_status).returns({ seconds_until_sync_allowed: 61 })

    assert_equal "Using cached data (next sync available in 2 minutes)", presenter.build_sync_skipped_message
  end

  test "build_sync_skipped_message uses seconds for one minute or less" do
    presenter = PullRequestIndexPresenter.new
    presenter.stubs(:sync_status).returns({ seconds_until_sync_allowed: 30 })

    assert_equal "Using cached data (next sync available in 30 seconds)", presenter.build_sync_skipped_message
  end
end
