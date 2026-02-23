require "test_helper"

class Api::V1::SyncsControllerTest < ActionDispatch::IntegrationTest
  test "returns skipped when debounce blocks sync" do
    Setting.stubs(:sync_needed?).returns(false)
    Setting.stubs(:seconds_until_sync_allowed).returns(50)
    Setting.stubs(:last_synced_at).returns(Time.current)

    post "/api/v1/sync", params: { force: false }, as: :json

    assert_response :success
    json = JSON.parse(response.body)
    assert_equal true, json["ok"]
    assert_equal true, json["skipped"]
    assert_equal 50, json["seconds_remaining"]
  end

  test "returns skipped with nil last_synced_at" do
    Setting.stubs(:sync_needed?).returns(false)
    Setting.stubs(:seconds_until_sync_allowed).returns(50)
    Setting.stubs(:last_synced_at).returns(nil)

    post "/api/v1/sync", params: { force: false }, as: :json

    assert_response :success
    json = JSON.parse(response.body)
    assert_nil json["last_synced_at"]
  end

  test "syncs when force true" do
    Setting.stubs(:sync_needed?).returns(false)
    Setting.stubs(:current_repo).returns(nil)
    Setting.stubs(:touch_last_synced!)
    Setting.stubs(:last_synced_at).returns(Time.current)
    GithubCliService.stubs(:fetch_latest_for_repo).returns(nil)
    GithubCliService.any_instance.stubs(:sync_to_database!).returns(nil)

    post "/api/v1/sync", params: { force: true }, as: :json

    assert_response :success
    json = JSON.parse(response.body)
    assert_equal true, json["ok"]
    assert_equal false, json["skipped"]
  end

  test "syncs with current repo path and nil last_synced_at" do
    Setting.stubs(:sync_needed?).returns(true)
    Setting.stubs(:current_repo).returns("/tmp/repo")
    Setting.stubs(:touch_last_synced!)
    Setting.stubs(:last_synced_at).returns(nil)
    GithubCliService.expects(:fetch_latest_for_repo).with("/tmp/repo")
    GithubCliService.any_instance.stubs(:sync_to_database!).returns(nil)

    post "/api/v1/sync", params: { force: false }, as: :json

    assert_response :success
    json = JSON.parse(response.body)
    assert_nil json["last_synced_at"]
  end

  test "returns invalid_input for malformed boolean" do
    post "/api/v1/sync", params: { force: "maybe" }, as: :json

    assert_response :unprocessable_entity
    json = JSON.parse(response.body)
    assert_equal false, json["ok"]
    assert_equal "invalid_input", json.dig("error", "code")
  end

  test "returns sync_failed on gh error" do
    Setting.stubs(:sync_needed?).returns(true)
    Setting.stubs(:current_repo).returns(nil)
    GithubCliService.any_instance.stubs(:sync_to_database!).raises(GithubCliService::Error, "boom")

    post "/api/v1/sync", params: { force: false }, as: :json

    assert_response :unprocessable_entity
    json = JSON.parse(response.body)
    assert_equal "sync_failed", json.dig("error", "code")
  end
end
