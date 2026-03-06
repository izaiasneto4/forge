require "test_helper"

class Api::V1::ReviewTaskLogsControllerTest < ActionDispatch::IntegrationTest
  self.use_transactional_tests = false

  setup do
    ReviewComment.delete_all
    ReviewIteration.delete_all
    AgentLog.delete_all
    ReviewTask.delete_all
    PullRequest.unscoped.delete_all

    pr = PullRequest.create!(
      github_id: 2,
      number: 2,
      title: "A",
      url: "https://github.com/acme/api/pull/2",
      repo_owner: "acme",
      repo_name: "api",
      review_status: "pending_review"
    )
    @task = pr.create_review_task!(state: "pending_review")
    @log1 = @task.agent_logs.create!(log_type: "output", message: "one")
    @log2 = @task.agent_logs.create!(log_type: "error", message: "two")
  end

  test "shows logs" do
    get "/api/v1/review_tasks/#{@task.id}/logs", as: :json

    assert_response :success
    json = JSON.parse(response.body)
    assert_equal true, json["ok"]
    assert_equal 2, json["logs"].size
  end

  test "filters logs after id" do
    get "/api/v1/review_tasks/#{@task.id}/logs", params: { after_id: @log1.id }, as: :json

    assert_response :success
    json = JSON.parse(response.body)
    assert_equal [ @log2.id ], json["logs"].map { |v| v["id"] }
  end

  test "invalid tail rejected" do
    get "/api/v1/review_tasks/#{@task.id}/logs", params: { tail: 0 }, as: :json

    assert_response :unprocessable_entity
  end

  test "missing task returns not found" do
    get "/api/v1/review_tasks/999999/logs", as: :json

    assert_response :not_found
  end
end
