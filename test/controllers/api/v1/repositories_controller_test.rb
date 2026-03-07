require "test_helper"

class Api::V1::RepositoriesControllerTest < ActionDispatch::IntegrationTest
  test "switches repository when resolver finds path" do
    Setting.stubs(:repos_folder).returns("/tmp")
    Setting.stubs(:current_repo=).returns(nil)
    RepoSwitchResolver.any_instance.stubs(:resolve).returns({ status: :ok, path: "/tmp/repo" })
    Sync::Engine.any_instance.stubs(:call).returns(sync: { status: "succeeded" })

    post "/api/v1/repositories/switch", params: { repo: "acme/api" }, as: :json

    assert_response :created
    json = JSON.parse(response.body)
    assert_equal true, json["ok"]
  end

  test "rejects invalid repo format" do
    post "/api/v1/repositories/switch", params: { repo: "acme" }, as: :json

    assert_response :unprocessable_entity
  end

  test "returns invalid when repo param missing" do
    post "/api/v1/repositories/switch", params: {}, as: :json

    assert_response :unprocessable_entity
    json = JSON.parse(response.body)
    assert_equal "invalid_input", json.dig("error", "code")
  end

  test "returns not found when no local match" do
    Setting.stubs(:repos_folder).returns("/tmp")
    RepoSwitchResolver.any_instance.stubs(:resolve).returns({ status: :not_found, paths: [] })

    post "/api/v1/repositories/switch", params: { repo: "acme/api" }, as: :json

    assert_response :not_found
  end

  test "returns conflict when ambiguous" do
    Setting.stubs(:repos_folder).returns("/tmp")
    RepoSwitchResolver.any_instance.stubs(:resolve).returns({ status: :ambiguous, paths: [ "/tmp/r1", "/tmp/r2" ] })

    post "/api/v1/repositories/switch", params: { repo: "acme/api" }, as: :json

    assert_response :conflict
    json = JSON.parse(response.body)
    assert_equal [ "/tmp/r1", "/tmp/r2" ], json.dig("error", "details", "paths")
  end

  test "returns sync failed when gh sync errors" do
    Setting.stubs(:repos_folder).returns("/tmp")
    Setting.stubs(:current_repo=).returns(nil)
    RepoSwitchResolver.any_instance.stubs(:resolve).returns({ status: :ok, path: "/tmp/repo" })
    Sync::Engine.any_instance.stubs(:call).raises(Sync::GithubAdapter::Error, "boom")

    post "/api/v1/repositories/switch", params: { repo: "acme/api" }, as: :json

    assert_response :unprocessable_entity
    json = JSON.parse(response.body)
    assert_equal "sync_failed", json.dig("error", "code")
  end
end
