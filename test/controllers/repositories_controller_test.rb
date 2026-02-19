require "test_helper"

class RepositoriesControllerTest < ActionDispatch::IntegrationTest
  setup do
    Setting.delete_all
    @repo_path = Dir.mktmpdir
    @repo_name = File.basename(@repo_path)
  end

  teardown do
    FileUtils.rm_rf(@repo_path) if Dir.exist?(@repo_path)
  end

  test "index when repos_folder is set" do
    Setting.repos_folder = @repo_path

    get repositories_path

    assert_response :success
  end

  test "index when repos_folder is not set" do
    get repositories_path

    assert_response :success
  end

  test "index sets current_repo" do
    Setting.current_repo = @repo_path

    get repositories_path

    assert_response :success
  end

  test "list renders partial with repositories" do
    Setting.repos_folder = @repo_path
    Setting.current_repo = @repo_path

    get list_repositories_path

    assert_response :success
  end

  test "list when repos_folder is blank" do
    Setting.repos_folder = ""

    get list_repositories_path

    assert_response :success
  end

  test "switch with valid repo path" do
    Setting.stubs(:sync_needed?).returns(true)
    GithubCliService.stubs(:fetch_latest_for_repo).returns(nil)
    github_service = Class.new do
      def sync_to_database!; end
    end.new
    GithubCliService.stubs(:new).returns(github_service)
    Setting.stubs(:touch_last_synced!)

    post switch_repositories_path, params: { repo_path: @repo_path }, as: :turbo_stream

    assert_response :success
    assert_equal @repo_path, Setting.current_repo
  end

  test "switch with HTML response on success" do
    Setting.stubs(:sync_needed?).returns(true)
    GithubCliService.stubs(:fetch_latest_for_repo).returns(nil)
    github_service = Class.new do
      def sync_to_database!; end
    end.new
    GithubCliService.stubs(:new).returns(github_service)
    Setting.stubs(:touch_last_synced!)

    post switch_repositories_path, params: { repo_path: @repo_path }

    assert_redirected_to pull_requests_path
    assert_equal "Switched to #{@repo_name} and synced", flash[:notice]
    assert_equal @repo_path, Setting.current_repo
  end

  test "switch with invalid repo path" do
    post switch_repositories_path, params: { repo_path: "/nonexistent/path" }, as: :turbo_stream

    assert_response :success
    assert_includes response.body, "Invalid repository path"
  end

  test "switch with HTML response on invalid path" do
    post switch_repositories_path, params: { repo_path: "/nonexistent/path" }

    assert_redirected_to repositories_path
    assert_equal "Invalid repository path", flash[:alert]
  end

  test "switch with blank repo path" do
    post switch_repositories_path, params: { repo_path: "" }, as: :turbo_stream

    assert_response :success
    assert_includes response.body, "Invalid repository path"
  end

  test "switch with nil repo path" do
    post switch_repositories_path, params: { repo_path: nil }, as: :turbo_stream

    assert_response :success
    assert_includes response.body, "Invalid repository path"
  end

  test "switch with error from GithubCliService" do
    Setting.stubs(:sync_needed?).returns(true)
    GithubCliService.stubs(:fetch_latest_for_repo).returns(nil)
    github_service = Class.new do
      def sync_to_database!
        raise GithubCliService::Error, "GitHub API error"
      end
    end.new
    GithubCliService.stubs(:new).returns(github_service)
    Setting.stubs(:touch_last_synced!)

    post switch_repositories_path, params: { repo_path: @repo_path }, as: :turbo_stream

    assert_response :success
    assert_includes response.body, "Sync failed: GitHub API error"
  end

  test "switch with error from GithubCliService HTML response" do
    Setting.stubs(:sync_needed?).returns(true)
    GithubCliService.stubs(:fetch_latest_for_repo).returns(nil)
    github_service = Class.new do
      def sync_to_database!
        raise GithubCliService::Error, "GitHub API error"
      end
    end.new
    GithubCliService.stubs(:new).returns(github_service)
    Setting.stubs(:touch_last_synced!)

    post switch_repositories_path, params: { repo_path: @repo_path }

    assert_redirected_to pull_requests_path
    assert_equal "Switched repo but sync failed: GitHub API error", flash[:alert]
  end

  test "switch updates Setting.current_repo even on sync error" do
    Setting.stubs(:sync_needed?).returns(true)
    GithubCliService.stubs(:fetch_latest_for_repo).returns(nil)
    github_service = Class.new do
      def sync_to_database!
        raise GithubCliService::Error, "GitHub API error"
      end
    end.new
    GithubCliService.stubs(:new).returns(github_service)
    Setting.stubs(:touch_last_synced!)

    post switch_repositories_path, params: { repo_path: @repo_path }

    assert_equal @repo_path, Setting.current_repo
  end
end
