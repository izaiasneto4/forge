require "test_helper"

class Api::V1::StatusControllerTest < ActionDispatch::IntegrationTest
  self.use_transactional_tests = false

  setup do
    ReviewComment.delete_all
    ReviewIteration.delete_all
    AgentLog.delete_all
    ReviewTask.delete_all
    PullRequest.unscoped.delete_all
  end

  test "returns status payload" do
    Setting.stubs(:current_repo).returns(nil)
    SyncState.stubs(:for_repo_path).with(nil).returns(nil)

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
    Setting.stubs(:current_repo).returns(nil)
    SyncState.stubs(:for_repo_path).with(nil).returns(
      stub(
        last_succeeded_at: Time.zone.parse("2026-03-07T02:37:53Z"),
        payload: { status: "succeeded" }
      )
    )

    get "/api/v1/status", as: :json

    assert_response :success
    json = JSON.parse(response.body)
    assert_equal task.id, json["running_task_id"]
    assert_equal "2026-03-07T02:37:53Z", json["last_synced_at"]
  end
end
