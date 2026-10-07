require "test_helper"

class Api::V1::PullRequestsControllerTest < ActionDispatch::IntegrationTest
  self.use_transactional_tests = false

  setup do
    ReviewComment.delete_all
    ReviewIteration.delete_all
    AgentLog.delete_all
    ReviewTask.delete_all
    PullRequestSnapshot.delete_all
    SyncState.delete_all
    Setting.delete_all
    PullRequest.unscoped.delete_all

    PullRequest.create!(
      github_id: 1,
      number: 1,
      title: "A",
      url: "https://github.com/acme/api/pull/1",
      repo_owner: "acme",
      repo_name: "api",
      review_status: "pending_review",
      updated_at_github: Time.current
    )
  end

  teardown do
    ReviewComment.delete_all
    ReviewIteration.delete_all
    AgentLog.delete_all
    ReviewTask.delete_all
    PullRequestSnapshot.delete_all
    SyncState.delete_all
    Setting.delete_all
    PullRequest.unscoped.delete_all
  end

  test "lists pull requests" do
    get "/api/v1/pull_requests", as: :json

    assert_response :success
    json = JSON.parse(response.body)
    assert_equal true, json["ok"]
    assert_equal 1, json["items"].size
  end

  test "lists pull requests with nil updated_at_github" do
    PullRequest.create!(
      github_id: 2,
      number: 2,
      title: "B",
      url: "https://github.com/acme/api/pull/2",
      repo_owner: "acme",
      repo_name: "api",
      review_status: "pending_review",
      updated_at_github: nil
    )

    get "/api/v1/pull_requests", as: :json

    assert_response :success
    json = JSON.parse(response.body)
    item = json["items"].find { |v| v["number"] == 2 }
    assert_nil item["updated_at_github"]
  end

  test "filters by status" do
    get "/api/v1/pull_requests", params: { status: "pending_review" }, as: :json

    assert_response :success
    json = JSON.parse(response.body)
    assert_equal 1, json["items"].size
  end

  test "filters by waiting_implementation status" do
    waiting_pr = PullRequest.create!(
      github_id: 2,
      number: 2,
      title: "Waiting PR",
      url: "https://github.com/acme/api/pull/2",
      repo_owner: "acme",
      repo_name: "api",
      review_status: "pending_review",
      updated_at_github: Time.current
    )
    ReviewTask.create!(pull_request: waiting_pr, state: "waiting_implementation")
    waiting_pr.update!(review_status: "waiting_implementation")

    get "/api/v1/pull_requests", params: { status: "waiting_implementation" }, as: :json

    assert_response :success
    json = JSON.parse(response.body)
    assert_equal [ 2 ], json["items"].map { |item| item["number"] }
  end

  test "rejects invalid status" do
    get "/api/v1/pull_requests", params: { status: "wat" }, as: :json

    assert_response :unprocessable_entity
  end

  test "rejects invalid limit" do
    get "/api/v1/pull_requests", params: { limit: 0 }, as: :json

    assert_response :unprocessable_entity
  end

  test "scopes list to current repo" do
    PullRequest.create!(
      github_id: 2,
      number: 2,
      title: "Other Repo",
      url: "https://github.com/acme/web/pull/2",
      repo_owner: "acme",
      repo_name: "web",
      review_status: "pending_review",
      updated_at_github: Time.current
    )

    Setting.stubs(:current_repo).returns("/tmp/repo")
    RepoSlugResolver.stubs(:from_path).with("/tmp/repo").returns("acme/api")

    get "/api/v1/pull_requests", as: :json

    assert_response :success
    json = JSON.parse(response.body)
    assert_equal [ 1 ], json["items"].map { |item| item["number"] }
  end

  test "review_scope persists preference without syncing github" do
    GithubCliService.expects(:fetch_latest_for_repo).never
    GithubCliService.any_instance.expects(:sync_to_database!).never

    patch "/api/v1/pull_requests/review_scope", params: { requested_to_me_only: true }, as: :json

    assert_response :success
    assert Setting.only_requested_reviews?
    json = JSON.parse(response.body)
    assert_equal true, json["ok"]
    assert_equal true, json.dig("board", "settings", "only_requested_reviews")
  end

  test "board recovers current repo from repos folder when exactly one repo slug matches stored pull requests" do
    Setting.repos_folder = "/tmp/repos"
    Setting.current_repo = nil
    RepoSwitchResolver.any_instance.stubs(:resolve).with("acme/api").returns({ status: :ok, path: "/tmp/repos/api" })
    RepoSlugResolver.stubs(:from_path).with("/tmp/repos/api").returns("acme/api")

    sync_state = SyncState.create!(
      scope_key: "repo:acme/api",
      repo_owner: "acme",
      repo_name: "api",
      status: "succeeded",
      last_succeeded_at: Time.zone.parse("2026-03-07T12:00:00Z")
    )

    get "/api/v1/pull_requests/board", as: :json

    assert_response :success
    json = JSON.parse(response.body)
    assert_equal "/tmp/repos/api", json.dig("current_repo", "path")
    assert_equal "api", json.dig("current_repo", "name")
    assert_equal "succeeded", json.dig("sync_status", "status")
    assert_equal sync_state.last_succeeded_at.iso8601, json.dig("sync_status", "last_synced_at")
    assert_equal "/tmp/repos/api", Setting.current_repo
  end

  test "create_review_task stores the reviewer focus" do
    focus = "Check the migration is safe to run online"
    pull_request = PullRequest.find_by!(number: 1)
    ReviewTask.stubs(:any_review_running?).returns(false)
    ReviewTaskJob.stubs(:perform_later)

    post "/api/v1/pull_requests/#{pull_request.id}/review_task", params: { cli_client: "codex", review_type: "swarm", focus: "  #{focus}  " }, as: :json

    assert_response :created
    json = JSON.parse(response.body)
    assert_equal focus, pull_request.reload.review_task.review_focus
    assert_equal focus, json.dig("detail", "task", "review_focus")
  end

  test "create_review_task clears a previous focus when none is given" do
    pull_request = PullRequest.find_by!(number: 1)
    pull_request.create_review_task!(state: "reviewed", review_focus: "Old focus")
    ReviewTask.stubs(:any_review_running?).returns(false)
    ReviewTaskJob.stubs(:perform_later)

    post "/api/v1/pull_requests/#{pull_request.id}/review_task", as: :json

    assert_response :created
    assert_nil pull_request.reload.review_task.review_focus
  end

  test "create_review_task moves the previous run into history before re-reviewing" do
    previous_output = "Earlier findings"
    pull_request = PullRequest.find_by!(number: 1)
    task = pull_request.create_review_task!(state: "reviewed", review_output: previous_output)
    task.review_comments.create!(file_path: "app/a.rb", body: "Stale blocker", severity: "critical", status: "pending")
    ReviewTask.stubs(:any_review_running?).returns(false)
    ReviewTaskJob.stubs(:perform_later)

    post "/api/v1/pull_requests/#{pull_request.id}/review_task", as: :json

    assert_response :created
    task.reload
    assert_empty task.review_comments
    assert_nil task.review_output
    assert_equal [ previous_output ], task.review_iterations.map(&:review_output)
  end

  test "unarchive restores an archived pull request" do
    pull_request = PullRequest.find_by!(number: 1)
    pull_request.archive!

    patch "/api/v1/pull_requests/#{pull_request.id}/unarchive", as: :json

    assert_response :success
    refute PullRequest.unscoped.find(pull_request.id).archived?
  end

  test "a rejected re-review keeps the previous findings" do
    previous_output = "Earlier findings"
    pull_request = PullRequest.find_by!(number: 1)
    task = pull_request.create_review_task!(state: "reviewed", review_output: previous_output)
    comment = task.review_comments.create!(file_path: "app/a.rb", body: "Still relevant", severity: "major", status: "pending")
    ReviewTask.stubs(:any_review_running?).returns(false)
    ReviewTaskJob.expects(:perform_later).never

    post "/api/v1/pull_requests/#{pull_request.id}/review_task", params: { cli_client: "not-a-client" }, as: :json

    assert_response :unprocessable_entity
    task.reload
    assert_equal [ comment.id ], task.review_comments.map(&:id)
    assert_equal previous_output, task.review_output
    assert_empty task.review_iterations
  end

  test "re-reviewing an archived task brings it back" do
    pull_request = PullRequest.find_by!(number: 1)
    task = pull_request.create_review_task!(state: "reviewed", archived: true)
    ReviewTask.stubs(:any_review_running?).returns(false)
    ReviewTaskJob.stubs(:perform_later)

    post "/api/v1/pull_requests/#{pull_request.id}/review_task", as: :json

    assert_response :created
    refute task.reload.archived?
  end

  test "bulk_destroy archives deleted pull requests so their reviews stay hidden" do
    pull_request = PullRequest.find_by!(number: 1)

    delete "/api/v1/pull_requests/bulk_destroy", params: { pull_request_ids: [ pull_request.id ] }, as: :json

    assert_response :success
    deleted = PullRequest.unscoped.find(pull_request.id)
    assert deleted.deleted?
    assert deleted.archived?
  end
end

