require "test_helper"

class PullRequestIndexPresenterTest < ActiveSupport::TestCase
  setup do
    ReviewTask.delete_all
    PullRequest.unscoped.delete_all
    Setting.current_repo = nil
  end

  teardown do
    ReviewTask.delete_all
    PullRequest.unscoped.delete_all
  end

  test "columns groups pull requests by status" do
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
      title: "Reviewed",
      url: "https://github.com/acme/api/pull/2",
      repo_owner: "acme",
      repo_name: "api",
      review_status: "pending_review",
      updated_at_github: 1.hour.ago
    ).tap do |pull_request|
      pull_request.create_review_task!(state: "reviewed")
      pull_request.update!(review_status: "reviewed_by_me")
    end

    columns = PullRequestIndexPresenter.new.columns

    assert_equal [ 1 ], columns[:pending_review].map(&:number)
    assert_equal [ 2 ], columns[:reviewed_by_me].map(&:number)
    assert_empty columns[:in_review]
  end

  test "total_count excludes archived" do
    PullRequest.create!(
      github_id: 3,
      number: 3,
      title: "Visible",
      url: "https://github.com/acme/api/pull/3",
      repo_owner: "acme",
      repo_name: "api",
      review_status: "pending_review"
    )
    archived = PullRequest.create!(
      github_id: 4,
      number: 4,
      title: "Archived",
      url: "https://github.com/acme/api/pull/4",
      repo_owner: "acme",
      repo_name: "api",
      review_status: "pending_review"
    )
    archived.archive!

    assert_equal 1, PullRequestIndexPresenter.new.total_count
  end

  test "sync_status reflects setting values" do
    now = Time.current
    Setting.stubs(:last_synced_at).returns(now)
    Setting.stubs(:seconds_until_sync_allowed).returns(42)
    Setting.stubs(:sync_needed?).returns(false)

    status = PullRequestIndexPresenter.new.sync_status

    assert_equal now, status[:last_synced_at]
    assert_equal 42, status[:seconds_until_sync_allowed]
    assert_equal false, status[:sync_needed]
  end

  test "build_sync_skipped_message uses minutes for larger values" do
    Setting.stubs(:seconds_until_sync_allowed).returns(61)

    assert_equal "Using cached data (next sync available in 2 minutes)", PullRequestIndexPresenter.new.build_sync_skipped_message
  end

  test "build_sync_skipped_message uses seconds for one minute or less" do
    Setting.stubs(:seconds_until_sync_allowed).returns(30)

    assert_equal "Using cached data (next sync available in 30 seconds)", PullRequestIndexPresenter.new.build_sync_skipped_message
  end
end
