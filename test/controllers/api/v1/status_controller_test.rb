require "test_helper"

class Api::V1::StatusControllerTest < ActionDispatch::IntegrationTest
  test "returns status payload" do
    Setting.stubs(:current_repo).returns(nil)
    Setting.stubs(:last_synced_at).returns(nil)

    get "/api/v1/status", as: :json

    assert_response :success
    json = JSON.parse(response.body)
    assert_equal true, json["ok"]
    assert json.key?("counts")
  end

  test "returns running_task_id and last_synced_at when present" do
    pr = PullRequest.create!(
      github_id: 22,
      number: 22,
      title: "PR",
      url: "https://github.com/acme/api/pull/22",
      repo_owner: "acme",
      repo_name: "api",
      review_status: "pending_review"
    )
    task = pr.create_review_task!(state: "in_review")
    pr.update_column(:review_status, "in_review")
    time = Time.current

    Setting.stubs(:current_repo).returns(nil)
    Setting.stubs(:last_synced_at).returns(time)

    get "/api/v1/status", as: :json

    assert_response :success
    json = JSON.parse(response.body)
    assert_equal task.id, json["running_task_id"]
    assert_equal time.iso8601, json["last_synced_at"]
  end
end
