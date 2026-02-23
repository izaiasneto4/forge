require "test_helper"

class Api::V1::ReviewsControllerTest < ActionDispatch::IntegrationTest
  setup do
    @pr = PullRequest.create!(
      github_id: 999,
      number: 9,
      title: "PR",
      url: "https://github.com/acme/api/pull/9",
      repo_owner: "acme",
      repo_name: "api",
      review_status: "pending_review"
    )
    Setting.default_cli_client = "claude"
  end

  test "creates pending review when no other running" do
    ReviewTask.stubs(:any_review_running?).returns(false)

    assert_enqueued_with(job: ReviewTaskJob) do
      post "/api/v1/reviews", params: { pr_url: @pr.url }, as: :json
    end

    assert_response :created
    json = JSON.parse(response.body)
    assert_equal true, json["ok"]
    assert_equal "pending_review", json["state"]
  end

  test "queues review when another review running" do
    ReviewTask.stubs(:any_review_running?).returns(true)

    post "/api/v1/reviews", params: { pr_url: @pr.url }, as: :json

    assert_response :created
    json = JSON.parse(response.body)
    assert_equal "queued", json["state"]
    assert json["queue_position"].present?
  end

  test "returns invalid for bad pr url" do
    post "/api/v1/reviews", params: { pr_url: "bad-url" }, as: :json

    assert_response :unprocessable_entity
    json = JSON.parse(response.body)
    assert_equal "invalid_input", json.dig("error", "code")
  end

  test "returns invalid_input when missing pr_url param" do
    post "/api/v1/reviews", params: {}, as: :json

    assert_response :unprocessable_entity
    json = JSON.parse(response.body)
    assert_equal "invalid_input", json.dig("error", "code")
  end

  test "returns not_found when missing after sync" do
    GithubCliService.any_instance.stubs(:sync_to_database!).returns(nil)
    GithubCliService.stubs(:fetch_latest_for_repo).returns(nil)

    post "/api/v1/reviews", params: { pr_url: "https://github.com/acme/api/pull/99999" }, as: :json

    assert_response :not_found
    json = JSON.parse(response.body)
    assert_equal "not_found", json.dig("error", "code")
  end

  test "returns conflict when task already in progress" do
    task = @pr.create_review_task!(state: "in_review")

    post "/api/v1/reviews", params: { pr_url: @pr.url }, as: :json

    assert_response :conflict
    json = JSON.parse(response.body)
    assert_equal "conflict", json.dig("error", "code")
  end

  test "returns invalid_input on invalid review task attributes" do
    ReviewTask.stubs(:any_review_running?).returns(false)

    post "/api/v1/reviews", params: { pr_url: @pr.url, cli_client: "invalid-client" }, as: :json

    assert_response :unprocessable_entity
    json = JSON.parse(response.body)
    assert_equal "invalid_input", json.dig("error", "code")
  end

  test "returns invalid when current repo mismatch" do
    Setting.stubs(:current_repo).returns("/tmp/repo")
    RepoSlugResolver.stubs(:from_path).returns("foo/bar")

    post "/api/v1/reviews", params: { pr_url: @pr.url }, as: :json

    assert_response :unprocessable_entity
    json = JSON.parse(response.body)
    assert_equal "invalid_input", json.dig("error", "code")
  end

  test "returns sync_failed when sync raises error" do
    @pr.destroy!
    Setting.stubs(:current_repo).returns("/tmp/repo")
    RepoSlugResolver.stubs(:from_path).returns(nil)
    GithubCliService.stubs(:fetch_latest_for_repo).returns(nil)
    GithubCliService.any_instance.stubs(:sync_to_database!).raises(GithubCliService::Error, "sync failed")

    post "/api/v1/reviews", params: { pr_url: "https://github.com/acme/api/pull/9" }, as: :json

    assert_response :unprocessable_entity
    json = JSON.parse(response.body)
    assert_equal "sync_failed", json.dig("error", "code")
  end

  test "calls fetch latest when current repo present on sync path" do
    @pr.destroy!
    Setting.stubs(:current_repo).returns("/tmp/repo")
    RepoSlugResolver.stubs(:from_path).returns(nil)
    GithubCliService.expects(:fetch_latest_for_repo).with("/tmp/repo")
    GithubCliService.any_instance.stubs(:sync_to_database!).returns(nil)

    post "/api/v1/reviews", params: { pr_url: "https://github.com/acme/api/pull/9" }, as: :json

    assert_response :not_found
  end
end
