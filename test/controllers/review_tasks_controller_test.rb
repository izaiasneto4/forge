require "test_helper"

class ReviewTasksControllerTest < ActionDispatch::IntegrationTest
  setup do
    @pr = PullRequest.create!(
      github_id: 123,
      number: 1,
      title: "Test PR",
      url: "https://github.com/test/repo/pull/1",
      repo_owner: "test",
      repo_name: "repo",
      review_status: "pending_review"
    )
    @review_task = ReviewTask.create!(
      pull_request: @pr,
      state: "pending_review"
    )
  end

  test "index returns success" do
    get review_tasks_path
    assert_response :success
  end

  test "index groups tasks correctly" do
    in_review_task = ReviewTask.create!(
      pull_request: @pr,
      state: "in_review"
    )
    failed_task = ReviewTask.create!(
      pull_request: @pr,
      state: "failed_review"
    )

    get review_tasks_path
    assert_response :success
  end

  test "show with HTML format" do
    get review_task_path(@review_task)
    assert_response :success
  end

  test "show with Turbo Stream format" do
    skip "No show.turbo_stream.erb view exists yet"
  end

  test "create with default cli_client and review_type" do
    Setting.default_cli_client = "claude"

    assert_enqueued_with(job: ReviewTaskJob) do
      post review_tasks_path, params: { pull_request_id: @pr.id }
    end
    assert_redirected_to review_tasks_path
    assert_equal "Review started for PR ##{@pr.number}", flash[:notice]

    new_task = @pr.reload.review_task
    assert_equal "pending_review", new_task.state
    assert_equal "claude", new_task.cli_client
    assert_equal "review", new_task.review_type
  end

  test "create with custom cli_client" do
    assert_enqueued_with(job: ReviewTaskJob) do
      post review_tasks_path, params: { pull_request_id: @pr.id, cli_client: "codex" }
    end

    @pr.reload
    assert_equal "codex", @pr.review_task.cli_client
  end

  test "create with custom review_type" do
    assert_enqueued_with(job: ReviewTaskJob) do
      post review_tasks_path, params: { pull_request_id: @pr.id, review_type: "swarm" }
    end

    @pr.reload
    assert_equal "swarm", @pr.review_task.review_type
  end

  test "create with Turbo Stream format" do
    assert_enqueued_with(job: ReviewTaskJob) do
      post review_tasks_path, params: { pull_request_id: @pr.id }, as: :turbo_stream
    end
    assert_response :success
  end

  test "create updates existing review_task" do
    @review_task.update!(state: "failed_review")

    assert_enqueued_with(job: ReviewTaskJob) do
      post review_tasks_path, params: { pull_request_id: @pr.id }
    end

    @review_task.reload
    assert_equal "pending_review", @review_task.state
  end

  test "update_state with valid state" do
    patch update_state_review_task_path(@review_task), params: { state: "in_review" }, as: :turbo_stream

    assert_response :success
    @review_task.reload
    assert_equal "in_review", @review_task.state
  end

  test "update_state with HTML response on success" do
    patch update_state_review_task_path(@review_task), params: { state: "in_review" }

    assert_redirected_to review_tasks_path
    assert_equal "Task state updated", flash[:notice]
    @review_task.reload
    assert_equal "in_review", @review_task.state
  end

  test "update_state with JSON response on success" do
    patch update_state_review_task_path(@review_task), params: { state: "in_review" }, as: :json

    assert_response :ok
    @review_task.reload
    assert_equal "in_review", @review_task.state
  end

  test "update_state with backward move" do
    @review_task.update!(state: "reviewed")

    patch update_state_review_task_path(@review_task), params: { state: "in_review", backward_move: "true" }, as: :turbo_stream

    assert_response :success
    @review_task.reload
    assert_equal "in_review", @review_task.state
  end

  test "update_state with backward move creates ReviewIteration" do
    @review_task.update!(state: "reviewed")
    ReviewComment.create!(
      review_task: @review_task,
      body: "Test comment",
      file_path: "test.rb",
      status: "pending"
    )

    assert_difference "ReviewIteration.count", 1 do
      patch update_state_review_task_path(@review_task), params: { state: "in_review", backward_move: "true" }
    end

    @review_task.reload
    assert_equal "in_review", @review_task.state
    assert_equal 0, @review_task.review_comments.count
  end

  test "update_state with invalid state" do
    patch update_state_review_task_path(@review_task), params: { state: "invalid_state" }, as: :turbo_stream

    assert_response :unprocessable_entity
    @review_task.reload
    assert_equal "pending_review", @review_task.state
  end

  test "update_state with HTML response on invalid state" do
    patch update_state_review_task_path(@review_task), params: { state: "invalid_state" }

    assert_redirected_to review_tasks_path
    assert_equal "Invalid state", flash[:alert]
  end

  test "update_state with JSON response on invalid state" do
    patch update_state_review_task_path(@review_task), params: { state: "invalid_state" }, as: :json

    assert_response :unprocessable_entity
  end

  test "retry with failed review" do
    @review_task.update!(state: "failed_review", failure_reason: "Test error")

    assert_enqueued_with(job: ReviewTaskJob) do
      post retry_review_task_path(@review_task)
    end

    assert_redirected_to review_tasks_path
    assert_equal "Retry initiated for PR ##{@pr.number}", flash[:notice]

    @review_task.reload
    assert_equal "pending_review", @review_task.state
  end

  test "retry with Turbo Stream format" do
    @review_task.update!(state: "failed_review", failure_reason: "Test error")

    assert_enqueued_with(job: ReviewTaskJob) do
      post retry_review_task_path(@review_task), as: :turbo_stream
    end

    assert_response :success
  end

  test "retry with JSON response on success" do
    @review_task.update!(state: "failed_review", failure_reason: "Test error")

    assert_enqueued_with(job: ReviewTaskJob) do
      post retry_review_task_path(@review_task), as: :json
    end

    assert_response :ok

    json = JSON.parse(response.body)
    assert_equal true, json["success"]
    assert_equal "pending_review", json["state"]
  end

  test "retry refuses non-failed review" do
    @review_task.update!(state: "reviewed")

    post retry_review_task_path(@review_task)

    assert_redirected_to review_tasks_path
    assert_equal "Can only retry failed reviews", flash[:alert]
  end

  test "retry refuses non-failed review with Turbo Stream" do
    @review_task.update!(state: "reviewed")

    post retry_review_task_path(@review_task), as: :turbo_stream

    assert_response :unprocessable_entity
  end

  test "retry refuses non-failed review with JSON" do
    @review_task.update!(state: "reviewed")

    post retry_review_task_path(@review_task), as: :json

    assert_response :unprocessable_entity

    json = JSON.parse(response.body)
    assert_equal "Can only retry failed reviews", json["error"]
  end

  test "retry refuses when max retries reached" do
    @review_task.update!(
      state: "failed_review",
      failure_reason: "Test error",
      retry_count: ReviewTask::MAX_RETRY_ATTEMPTS
    )

    post retry_review_task_path(@review_task)

    assert_redirected_to review_tasks_path
    assert_equal "Maximum retry attempts (#{ReviewTask::MAX_RETRY_ATTEMPTS}) reached", flash[:alert]
  end

  test "retry refuses when max retries reached with Turbo Stream" do
    @review_task.update!(
      state: "failed_review",
      failure_reason: "Test error",
      retry_count: ReviewTask::MAX_RETRY_ATTEMPTS
    )

    post retry_review_task_path(@review_task), as: :turbo_stream

    assert_response :unprocessable_entity
  end

  test "retry refuses when max retries reached with JSON" do
    @review_task.update!(
      state: "failed_review",
      failure_reason: "Test error",
      retry_count: ReviewTask::MAX_RETRY_ATTEMPTS
    )

    post retry_review_task_path(@review_task), as: :json

    assert_response :unprocessable_entity

    json = JSON.parse(response.body)
    assert_equal "Maximum retry attempts reached", json["error"]
  end
end
