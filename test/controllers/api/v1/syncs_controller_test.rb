require "test_helper"

class Api::V1::SyncsControllerTest < ActionDispatch::IntegrationTest
  test "returns skipped when repo sync state is still fresh" do
    sync_state = stub(
      sync_needed?: false,
      seconds_until_sync_allowed: 50,
      last_succeeded_at: Time.zone.parse("2026-03-07T12:00:00Z"),
      payload: { status: "succeeded" }
    )

    Setting.stubs(:current_repo).returns("/tmp/repo")
    SyncState.stubs(:for_repo_path).with("/tmp/repo").returns(sync_state)

    post "/api/v1/sync", params: { force: false }, as: :json

    assert_response :success
    json = JSON.parse(response.body)
    assert_equal true, json["ok"]
    assert_equal true, json["skipped"]
    assert_equal 50, json["seconds_remaining"]
    assert_equal "succeeded", json.dig("sync", "status")
  end

  test "runs sync engine and returns repo scoped sync payload" do
    Setting.stubs(:current_repo).returns("/tmp/repo")
    SyncState.stubs(:for_repo_path).with("/tmp/repo").returns(stub(sync_needed?: true))
    Sync::Engine.any_instance.expects(:call).with(trigger: "manual").returns(
      already_running: false,
      sync: { status: "succeeded", last_succeeded_at: "2026-03-07T12:00:00Z" }
    )

    post "/api/v1/sync", params: { force: false }, as: :json

    assert_response :success
    json = JSON.parse(response.body)
    assert_equal false, json["skipped"]
    assert_equal false, json["already_running"]
    assert_equal "succeeded", json.dig("sync", "status")
    assert_equal "2026-03-07T12:00:00Z", json["last_synced_at"]
  end

  test "returns invalid_input for malformed boolean" do
    post "/api/v1/sync", params: { force: "maybe" }, as: :json

    assert_response :unprocessable_entity
    json = JSON.parse(response.body)
    assert_equal false, json["ok"]
    assert_equal "invalid_input", json.dig("error", "code")
  end

  test "returns sync_failed on engine error" do
    Setting.stubs(:current_repo).returns("/tmp/repo")
    SyncState.stubs(:for_repo_path).with("/tmp/repo").returns(stub(sync_needed?: true))
    Sync::Engine.any_instance.stubs(:call).raises(Sync::GithubAdapter::Error, "boom")

    post "/api/v1/sync", params: { force: false }, as: :json

    assert_response :unprocessable_entity
    json = JSON.parse(response.body)
    assert_equal "sync_failed", json.dig("error", "code")
  end
end
