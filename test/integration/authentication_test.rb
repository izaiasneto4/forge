require "test_helper"

class AuthenticationTest < ActionDispatch::IntegrationTest
  test "unauthenticated user is redirected to sign in" do
    get pull_requests_path
    assert_redirected_to new_user_session_path
  end

  test "unauthenticated user cannot access settings" do
    get edit_settings_path
    assert_redirected_to new_user_session_path
  end

  test "unauthenticated user cannot access review tasks" do
    get review_tasks_path
    assert_redirected_to new_user_session_path
  end

  test "unauthenticated user cannot access repositories" do
    get repositories_path
    assert_redirected_to new_user_session_path
  end

  test "unauthenticated user cannot create review task" do
    post review_tasks_path, params: { pull_request_id: 1 }
    assert_redirected_to new_user_session_path
  end

  test "unauthenticated user cannot update review task state" do
    patch update_state_review_task_path(1), params: { state: "in_review" }
    assert_redirected_to new_user_session_path
  end

  test "unauthenticated user cannot bulk delete pull requests" do
    delete bulk_destroy_pull_requests_path, params: { pull_request_ids: [ 1, 2 ] }
    assert_redirected_to new_user_session_path
  end

  test "unauthenticated user cannot update settings" do
    patch settings_path, params: { repos_folder: "/tmp" }
    assert_redirected_to new_user_session_path
  end

  test "authenticated user can access pull requests" do
    sign_in users(:user)
    get pull_requests_path
    assert_response :success
  end

  test "authenticated user can access review tasks" do
    sign_in users(:user)
    get review_tasks_path
    assert_response :success
  end

  test "authenticated user can access repositories" do
    sign_in users(:user)
    get repositories_path
    assert_response :success
  end

  test "authenticated user can create review task" do
    sign_in users(:user)
    pr = PullRequest.create!(
      github_id: 123,
      number: 1,
      title: "Test PR",
      url: "https://github.com/test/repo/pull/1",
      repo_owner: "test",
      repo_name: "repo",
      review_status: "pending_review"
    )
    post review_tasks_path, params: { pull_request_id: pr.id }
    assert_response :redirect
  end
end
