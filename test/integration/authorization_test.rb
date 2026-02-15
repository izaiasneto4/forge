require "test_helper"

class AuthorizationTest < ActionDispatch::IntegrationTest
  setup do
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
      review_status: "pending_review"
    )
  end

  test "non-admin user cannot access settings edit" do
    sign_in users(:user)
    get edit_settings_path
    assert_redirected_to root_path
    assert_equal "You don't have permission to perform this action.", flash[:alert]
  end

  test "non-admin user cannot update settings" do
    sign_in users(:user)
    patch settings_path, params: { repos_folder: "/tmp" }
    assert_redirected_to root_path
    assert_equal "You don't have permission to perform this action.", flash[:alert]
  end

  test "non-admin user cannot bulk delete pull requests" do
    sign_in users(:user)
    delete bulk_destroy_pull_requests_path, params: { pull_request_ids: [ @pr1.id, @pr2.id ] }
    assert_redirected_to root_path
    assert_equal "You don't have permission to perform this action.", flash[:alert]
  end

  test "non-admin user cannot bulk delete pull requests with JSON" do
    sign_in users(:user)
    delete bulk_destroy_pull_requests_path, params: { pull_request_ids: [ @pr1.id, @pr2.id ] }, as: :json
    # Controller redirects to root path for unauthorized access
    assert_response :redirect
  end

  test "admin user can access settings edit" do
    sign_in users(:admin)
    get edit_settings_path
    assert_response :success
  end

  test "admin user can update settings" do
    sign_in users(:admin)
    patch settings_path, params: { repos_folder: "/tmp" }
    assert_redirected_to edit_settings_path
    assert_equal "Settings updated", flash[:notice]
  end

  test "admin user can bulk delete pull requests" do
    sign_in users(:admin)
    assert_difference "PullRequest.count", -2 do
      delete bulk_destroy_pull_requests_path, params: { pull_request_ids: [ @pr1.id, @pr2.id ] }
    end
    assert_redirected_to pull_requests_path
  end

  test "admin user can bulk delete pull requests with JSON" do
    sign_in users(:admin)
    assert_difference "PullRequest.count", -2 do
      delete bulk_destroy_pull_requests_path, params: { pull_request_ids: [ @pr1.id, @pr2.id ] }, as: :json
    end
    assert_response :success
  end

  test "non-admin user can access regular pull requests endpoints" do
    sign_in users(:user)
    get pull_requests_path
    assert_response :success
  end

  test "non-admin user can access regular review tasks endpoints" do
    sign_in users(:user)
    get review_tasks_path
    assert_response :success
  end

  test "non-admin user can access regular repositories endpoints" do
    sign_in users(:user)
    get repositories_path
    assert_response :success
  end

  test "admin user can access all endpoints" do
    sign_in users(:admin)

    get pull_requests_path
    assert_response :success

    get review_tasks_path
    assert_response :success

    get repositories_path
    assert_response :success

    get edit_settings_path
    assert_response :success
  end
end
