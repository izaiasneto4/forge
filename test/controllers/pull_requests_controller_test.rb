require "test_helper"

class PullRequestsControllerTest < ActionDispatch::IntegrationTest
  setup do
    Setting.delete_all
    @pr1 = PullRequest.create!(
      github_id: 123,
      number: 1,
      title: "Test PR 1",
      url: "https://github.com/test/repo/pull/1",
      repo_owner: "test",
      repo_name: "repo",
      review_status: "pending_review"
    )
    @pr2 = PullRequest.create!(
      github_id: 124,
      number: 2,
      title: "Test PR 2",
      url: "https://github.com/test/repo/pull/2",
      repo_owner: "test",
      repo_name: "repo",
      review_status: "reviewed_by_others"
    )
  end

  test "index returns success" do
    get pull_requests_path
    assert_response :success
  end

  test "sync with force true executes sync" do
    Setting.stubs(:sync_needed?).returns(true)
    GithubCliService.stubs(:fetch_latest_for_repo).returns(nil)
    github_service = Class.new do
      def sync_to_database!; end
    end.new
    GithubCliService.stubs(:new).returns(github_service)
    Setting.stubs(:touch_last_synced!)

    post sync_pull_requests_path, params: { force: "true" }, as: :turbo_stream
    assert_response :success
  end

  test "sync with force false and sync_needed true executes sync" do
    Setting.stubs(:sync_needed?).returns(true)
    GithubCliService.stubs(:fetch_latest_for_repo).returns(nil)
    github_service = Class.new do
      def sync_to_database!; end
    end.new
    GithubCliService.stubs(:new).returns(github_service)
    Setting.stubs(:touch_last_synced!)

    post sync_pull_requests_path, params: { force: "false" }, as: :turbo_stream
    assert_response :success
  end

  test "sync with force false and sync_needed false skips sync" do
    Setting.stubs(:sync_needed?).returns(false)
    Setting.stubs(:seconds_until_sync_allowed).returns(30)
    Setting.stubs(:last_synced_at).returns(nil)

    post sync_pull_requests_path, params: { force: "false" }, as: :turbo_stream
    assert_response :success
    assert_includes response.body, "Using cached data"
  end

  test "sync with HTML response on success" do
    Setting.stubs(:sync_needed?).returns(true)
    GithubCliService.stubs(:fetch_latest_for_repo).returns(nil)
    github_service = Class.new do
      def sync_to_database!; end
    end.new
    GithubCliService.stubs(:new).returns(github_service)
    Setting.stubs(:touch_last_synced!)

    post sync_pull_requests_path, params: { force: "true" }
    assert_redirected_to pull_requests_path
    assert_equal "Synced with GitHub", flash[:notice]
  end

  test "sync with JSON response on success" do
    Setting.stubs(:sync_needed?).returns(true)
    Setting.stubs(:last_synced_at).returns(Time.current)
    GithubCliService.stubs(:fetch_latest_for_repo).returns(nil)
    github_service = Class.new do
      def sync_to_database!; end
    end.new
    GithubCliService.stubs(:new).returns(github_service)
    Setting.stubs(:touch_last_synced!)

    post sync_pull_requests_path, params: { force: "true" }, as: :json
    assert_response :success

    json = JSON.parse(response.body)
    assert_equal false, json["skipped"]
    assert json.key?("last_synced_at")
  end

  test "sync with JSON response on skip" do
    Setting.stubs(:sync_needed?).returns(false)
    Setting.stubs(:seconds_until_sync_allowed).returns(60)
    Setting.stubs(:last_synced_at).returns(Time.current)

    post sync_pull_requests_path, params: { force: "false" }, as: :json
    assert_response :success

    json = JSON.parse(response.body)
    assert_equal true, json["skipped"]
    assert_equal 60, json["seconds_remaining"]
    assert json.key?("last_synced_at")
  end

  test "sync with Turbo Stream on success" do
    Setting.stubs(:sync_needed?).returns(true)
    GithubCliService.stubs(:fetch_latest_for_repo).returns(nil)
    github_service = Class.new do
      def sync_to_database!; end
    end.new
    GithubCliService.stubs(:new).returns(github_service)
    Setting.stubs(:touch_last_synced!)

    post sync_pull_requests_path, params: { force: "true" }, as: :turbo_stream
    assert_response :success
    assert_includes response.body, "pr-columns"
    assert_includes response.body, "Synced with GitHub"
  end

  test "sync with error from GithubCliService" do
    Setting.stubs(:sync_needed?).returns(true)
    GithubCliService.stubs(:fetch_latest_for_repo).returns(nil)
    github_service = Class.new do
      def sync_to_database!
        raise GithubCliService::Error, "GitHub API error"
      end
    end.new
    GithubCliService.stubs(:new).returns(github_service)

    post sync_pull_requests_path, params: { force: "true" }, as: :turbo_stream
    assert_response :success
    assert_includes response.body, "Sync failed: GitHub API error"
  end

  test "sync with HTML response on error" do
    Setting.stubs(:sync_needed?).returns(true)
    GithubCliService.stubs(:fetch_latest_for_repo).returns(nil)
    github_service = Class.new do
      def sync_to_database!
        raise GithubCliService::Error, "GitHub API error"
      end
    end.new
    GithubCliService.stubs(:new).returns(github_service)

    post sync_pull_requests_path, params: { force: "true" }
    assert_redirected_to pull_requests_path
    assert_equal "Sync failed: GitHub API error", flash[:alert]
  end

  test "sync with JSON response on error" do
    Setting.stubs(:sync_needed?).returns(true)
    GithubCliService.stubs(:fetch_latest_for_repo).returns(nil)
    github_service = Class.new do
      def sync_to_database!
        raise GithubCliService::Error, "GitHub API error"
      end
    end.new
    GithubCliService.stubs(:new).returns(github_service)

    post sync_pull_requests_path, params: { force: "true" }, as: :json
    assert_response :unprocessable_entity

    json = JSON.parse(response.body)
    assert_equal "GitHub API error", json["error"]
  end

  test "update_status with valid status" do
    task = ReviewTask.create!(pull_request: @pr1, state: "reviewed")
    patch update_status_pull_request_path(@pr1), params: { review_status: "reviewed_by_me" }, as: :turbo_stream
    assert_response :success
    @pr1.reload
    assert_equal "reviewed_by_me", @pr1.review_status
  end

  test "update_status with HTML response on success" do
    task = ReviewTask.create!(pull_request: @pr1, state: "reviewed")
    patch update_status_pull_request_path(@pr1), params: { review_status: "reviewed_by_me" }
    assert_redirected_to pull_requests_path
    assert_equal "Status updated", flash[:notice]
    @pr1.reload
    assert_equal "reviewed_by_me", @pr1.review_status
  end

  test "update_status with JSON response on success" do
    task = ReviewTask.create!(pull_request: @pr1, state: "reviewed")
    patch update_status_pull_request_path(@pr1), params: { review_status: "reviewed_by_me" }, as: :json
    assert_response :ok
    @pr1.reload
    assert_equal "reviewed_by_me", @pr1.review_status
  end

  test "update_status with invalid status" do
    patch update_status_pull_request_path(@pr1), params: { review_status: "invalid_status" }, as: :turbo_stream
    assert_response :unprocessable_entity
    @pr1.reload
    assert_equal "pending_review", @pr1.review_status
  end

  test "update_status with HTML response on failure" do
    patch update_status_pull_request_path(@pr1), params: { review_status: "invalid_status" }
    assert_redirected_to pull_requests_path
    assert_equal "Failed to update status", flash[:alert]
  end

  test "update_status with JSON response on failure" do
    patch update_status_pull_request_path(@pr1), params: { review_status: "invalid_status" }, as: :json
    assert_response :unprocessable_entity
  end

  test "bulk_destroy with empty ids" do
    delete bulk_destroy_pull_requests_path, params: { pull_request_ids: [] }, as: :html
    assert_redirected_to pull_requests_path
    assert_equal "No pull requests selected", flash[:alert]
  end

  test "bulk_destroy with empty ids JSON response" do
    delete bulk_destroy_pull_requests_path, params: { pull_request_ids: [] }, as: :json
    assert_response :bad_request

    json = JSON.parse(response.body)
    assert_equal "No pull requests selected", json["error"]
  end

  test "bulk_destroy with more than 100 ids" do
    ids = (1..101).to_a
    delete bulk_destroy_pull_requests_path, params: { pull_request_ids: ids }, as: :turbo_stream
    assert_response :bad_request
  end

  test "bulk_destroy with more than 100 ids JSON response" do
    ids = (1..101).to_a
    delete bulk_destroy_pull_requests_path, params: { pull_request_ids: ids }, as: :json
    assert_response :bad_request

    json = JSON.parse(response.body)
    assert_equal "Cannot delete more than 100 pull requests at once", json["error"]
  end

  test "bulk_destroy with valid ids" do
    assert_difference "PullRequest.count", -2 do
      delete bulk_destroy_pull_requests_path, params: { pull_request_ids: [ @pr1.id, @pr2.id ] }, as: :turbo_stream
    end
    assert_response :success
    assert_includes response.body, "2 pull requests deleted"
  end

  test "bulk_destroy with HTML response on success" do
    assert_difference "PullRequest.count", -2 do
      delete bulk_destroy_pull_requests_path, params: { pull_request_ids: [ @pr1.id, @pr2.id ] }
    end
    assert_redirected_to pull_requests_path
    assert_equal "2 pull requests deleted", flash[:notice]
  end

  test "bulk_destroy with JSON response on success" do
    assert_difference "PullRequest.count", -2 do
      delete bulk_destroy_pull_requests_path, params: { pull_request_ids: [ @pr1.id, @pr2.id ] }, as: :json
    end
    assert_response :success

    json = JSON.parse(response.body)
    assert_equal 2, json["deleted_count"]
  end

  test "bulk_destroy soft deletes PRs" do
    delete bulk_destroy_pull_requests_path, params: { pull_request_ids: [ @pr1.id ] }

    @pr1.reload
    assert @pr1.deleted?
    assert_not_nil @pr1.deleted_at
  end

  test "async_sync enqueues SyncPullRequestsJob" do
    assert_enqueued_with(job: SyncPullRequestsJob) do
      post async_sync_pull_requests_path, as: :turbo_stream
    end
    assert_response :success
  end

  test "async_sync with HTML response" do
    assert_enqueued_with(job: SyncPullRequestsJob) do
      post async_sync_pull_requests_path
    end
    assert_redirected_to pull_requests_path
    assert_equal "Sync started in background", flash[:notice]
  end

  test "async_sync with JSON response" do
    assert_enqueued_with(job: SyncPullRequestsJob) do
      post async_sync_pull_requests_path, as: :json
    end
    assert_response :success

    json = JSON.parse(response.body)
    assert_equal "sync_started", json["status"]
  end
end
