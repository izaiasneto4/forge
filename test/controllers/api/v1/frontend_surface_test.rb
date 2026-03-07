require "test_helper"

class Api::V1::FrontendSurfaceTest < ActionDispatch::IntegrationTest
  self.use_transactional_tests = false

  setup do
    ReviewComment.delete_all
    ReviewIteration.delete_all
    AgentLog.delete_all
    ReviewTask.delete_all
    PullRequest.unscoped.delete_all
    Setting.delete_all

    @pull_request = PullRequest.create!(
      github_id: 101,
      number: 17,
      title: "Frontend rewrite",
      url: "https://github.com/acme/api/pull/17",
      repo_owner: "acme",
      repo_name: "api",
      review_status: "pending_review",
      author: "izaias",
      updated_at_github: Time.current
    )

    @review_task = @pull_request.create_review_task!(
      state: "reviewed",
      cli_client: "codex",
      review_output: <<~TEXT
        ## Summary

        Looks mostly good.
      TEXT
    )

    @review_comment = @review_task.review_comments.create!(
      title: "Guard nil branch",
      body: "Check the nil branch before dereferencing.",
      file_path: "app/models/example.rb",
      line_number: 12,
      severity: "major",
      status: "pending"
    )

    @review_task.agent_logs.create!(message: "Started review", log_type: "status")

    Setting.default_cli_client = "claude"
    Setting.auto_submit_enabled = true
    Setting.only_requested_reviews = false
    Setting.theme_preference = "dark"
    Setting.github_login = "izaias"
    Setting.current_repo = "/tmp/acme-api"
    Setting.repos_folder = "/tmp"
    RepoSlugResolver.stubs(:from_path).returns("acme/api")
  end

  teardown do
    ReviewComment.delete_all
    ReviewIteration.delete_all
    AgentLog.delete_all
    ReviewTask.delete_all
    PullRequest.unscoped.delete_all
    Setting.delete_all
  end

  test "bootstrap returns app settings envelope" do
    get "/api/v1/bootstrap", as: :json

    assert_response :success
    json = JSON.parse(response.body)

    assert_equal true, json["ok"]
    assert_equal "Forge", json.dig("app", "name")
    assert_equal "claude", json.dig("settings", "default_cli_client")
    assert_equal "dark", json.dig("settings", "theme_preference")
  end

  test "pull request board returns columns payload" do
    RepoScannerService.any_instance.stubs(:scan).returns([ { name: "api", path: "/tmp/acme-api", branch: "main" } ])

    get "/api/v1/pull_requests/board", as: :json

    assert_response :success
    json = JSON.parse(response.body)

    assert_equal true, json["ok"]
    assert_equal 1, json.dig("columns", "pending_review").size
    assert_equal "api", json.dig("repositories", "items", 0, "name")
  end

  test "review task board and detail return structured payloads" do
    get "/api/v1/review_tasks/board", as: :json

    assert_response :success
    board = JSON.parse(response.body)
    assert_equal 1, board.dig("columns", "reviewed").size

    get "/api/v1/review_tasks/#{@review_task.id}", as: :json

    assert_response :success
    detail = JSON.parse(response.body)
    assert_equal true, detail["ok"]
    assert_equal "comments", detail["content_mode"]
    assert_equal 1, detail["comments"].size
    assert_equal 1, detail["live_logs"].size
  end

  test "status and comment mutations return refreshed payloads" do
    patch "/api/v1/pull_requests/#{@pull_request.id}/status", params: { review_status: "in_review" }, as: :json

    assert_response :success
    json = JSON.parse(response.body)
    assert_equal "Status updated", json["message"]
    assert_equal 1, json.dig("board", "counts", "in_review")

    patch "/api/v1/review_comments/#{@review_comment.id}/toggle", as: :json

    assert_response :success
    json = JSON.parse(response.body)
    assert_equal true, json["ok"]
    assert_equal "addressed", json.dig("detail", "comments", 0, "status")
  end

  test "settings show and update use the api envelope" do
    get "/api/v1/settings", as: :json

    assert_response :success
    json = JSON.parse(response.body)
    assert_equal "claude", json["default_cli_client"]

    patch "/api/v1/settings", params: {
      repos_folder: "/tmp",
      default_cli_client: "codex",
      auto_submit_enabled: false
    }, as: :json

    assert_response :success
    json = JSON.parse(response.body)
    assert_equal true, json["ok"]
    assert_equal "codex", json.dig("settings", "default_cli_client")
  end
end
