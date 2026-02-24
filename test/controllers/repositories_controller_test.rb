require "test_helper"

class RepositoriesControllerTest < ActionDispatch::IntegrationTest
  setup do
    Setting.delete_all
    @repo_path = Dir.mktmpdir
    system("git", "-C", @repo_path, "init", out: File::NULL, err: File::NULL, exception: true)
    system("git", "-C", @repo_path, "remote", "add", "origin", "git@github.com:test/repo.git", out: File::NULL, err: File::NULL, exception: true)
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

  test "switch turbo stream only renders pull requests for selected repo" do
    PullRequest.create!(
      github_id: 910001,
      number: 1,
      title: "Other Repo PR",
      url: "https://github.com/other/backend/pull/1",
      repo_owner: "other",
      repo_name: "backend",
      review_status: "pending_review"
    )
    PullRequest.create!(
      github_id: 910002,
      number: 2,
      title: "Selected Repo PR",
      url: "https://github.com/acme/frontend/pull/2",
      repo_owner: "acme",
      repo_name: "frontend",
      review_status: "pending_review"
    )

    RepoSlugResolver.stubs(:from_path).with(@repo_path).returns("acme/frontend")
    Setting.stubs(:sync_needed?).returns(true)
    GithubCliService.stubs(:fetch_latest_for_repo).returns(nil)
    github_service = Class.new do
      def sync_to_database!; end
    end.new
    GithubCliService.stubs(:new).returns(github_service)
    Setting.stubs(:touch_last_synced!)

    post switch_repositories_path, params: { repo_path: @repo_path }, as: :turbo_stream

    assert_response :success
    assert_includes response.body, "Selected Repo PR"
    refute_includes response.body, "Other Repo PR"
  end

  test "switch turbo stream includes in_review pull requests in columns payload" do
    in_review_pr = PullRequest.create!(
      github_id: 987654,
      number: 654,
      title: "In Review PR",
      url: "https://github.com/test/repo/pull/654",
      repo_owner: "test",
      repo_name: "repo",
      review_status: "pending_review"
    )
    ReviewTask.create!(
      pull_request: in_review_pr,
      state: "in_review",
      cli_client: "claude",
      review_type: "review"
    )
    in_review_pr.update_column(:review_status, "in_review")

    Setting.stubs(:sync_needed?).returns(true)
    GithubCliService.stubs(:fetch_latest_for_repo).returns(nil)
    github_service = Class.new do
      def sync_to_database!; end
    end.new
    GithubCliService.stubs(:new).returns(github_service)
    Setting.stubs(:touch_last_synced!)

    post switch_repositories_path, params: { repo_path: @repo_path }, as: :turbo_stream

    assert_response :success
    assert_includes response.body, "In Review PR"
  end
end
