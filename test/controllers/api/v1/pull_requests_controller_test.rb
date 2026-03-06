require "test_helper"

class Api::V1::PullRequestsControllerTest < ActionDispatch::IntegrationTest
  self.use_transactional_tests = false

  setup do
    ReviewComment.delete_all
    ReviewIteration.delete_all
    AgentLog.delete_all
    ReviewTask.delete_all
    PullRequest.unscoped.delete_all

    PullRequest.create!(
      github_id: 1,
      number: 1,
      title: "A",
      url: "https://github.com/acme/api/pull/1",
      repo_owner: "acme",
      repo_name: "api",
      review_status: "pending_review",
      updated_at_github: Time.current
    )
  end

  test "lists pull requests" do
    get "/api/v1/pull_requests", as: :json

    assert_response :success
    json = JSON.parse(response.body)
    assert_equal true, json["ok"]
    assert_equal 1, json["items"].size
  end

  test "lists pull requests with nil updated_at_github" do
    PullRequest.create!(
      github_id: 2,
      number: 2,
      title: "B",
      url: "https://github.com/acme/api/pull/2",
      repo_owner: "acme",
      repo_name: "api",
      review_status: "pending_review",
      updated_at_github: nil
    )

    get "/api/v1/pull_requests", as: :json

    assert_response :success
    json = JSON.parse(response.body)
    item = json["items"].find { |v| v["number"] == 2 }
    assert_nil item["updated_at_github"]
  end

  test "filters by status" do
    get "/api/v1/pull_requests", params: { status: "pending_review" }, as: :json

    assert_response :success
    json = JSON.parse(response.body)
    assert_equal 1, json["items"].size
  end

  test "filters by waiting_implementation status" do
    waiting_pr = PullRequest.create!(
      github_id: 2,
      number: 2,
      title: "Waiting PR",
      url: "https://github.com/acme/api/pull/2",
      repo_owner: "acme",
      repo_name: "api",
      review_status: "pending_review",
      updated_at_github: Time.current
    )
    ReviewTask.create!(pull_request: waiting_pr, state: "waiting_implementation")
    waiting_pr.update!(review_status: "waiting_implementation")

    get "/api/v1/pull_requests", params: { status: "waiting_implementation" }, as: :json

    assert_response :success
    json = JSON.parse(response.body)
    assert_equal [ 2 ], json["items"].map { |item| item["number"] }
  end

  test "rejects invalid status" do
    get "/api/v1/pull_requests", params: { status: "wat" }, as: :json

    assert_response :unprocessable_entity
  end

  test "rejects invalid limit" do
    get "/api/v1/pull_requests", params: { limit: 0 }, as: :json

    assert_response :unprocessable_entity
  end

  test "scopes list to current repo" do
    PullRequest.create!(
      github_id: 2,
      number: 2,
      title: "Other Repo",
      url: "https://github.com/acme/web/pull/2",
      repo_owner: "acme",
      repo_name: "web",
      review_status: "pending_review",
      updated_at_github: Time.current
    )

    Setting.stubs(:current_repo).returns("/tmp/repo")
    RepoSlugResolver.stubs(:from_path).with("/tmp/repo").returns("acme/api")

    get "/api/v1/pull_requests", as: :json

    assert_response :success
    json = JSON.parse(response.body)
    assert_equal [ 1 ], json["items"].map { |item| item["number"] }
  end
end
