require "test_helper"

class ApplicationControllerTest < ActionDispatch::IntegrationTest
  setup do
    @user = users(:user)
    sign_in @user
  end

  test "set_header_presenter runs on pull_requests index" do
    get pull_requests_path
    assert_response :success
  end

  test "set_header_presenter runs on repositories index" do
    get repositories_path
    assert_response :success
  end

  test "set_header_presenter runs on review_tasks index" do
    get review_tasks_path
    assert_response :success
  end

  test "set_header_presenter runs on review_task show" do
    pr = PullRequest.create!(
      github_id: 123,
      number: 1,
      title: "Test PR",
      url: "https://github.com/test/repo/pull/1",
      repo_owner: "test",
      repo_name: "repo",
      review_status: "pending_review"
    )
    task = ReviewTask.create!(
      pull_request: pr,
      state: "pending_review"
    )

    get review_task_path(task)
    assert_response :success
  end
end
