require "test_helper"

class Sync::EngineTest < ActiveSupport::TestCase
  self.use_transactional_tests = false

  setup do
    ReviewComment.delete_all
    ReviewIteration.delete_all
    AgentLog.delete_all
    ReviewTask.delete_all
    PullRequestSnapshot.delete_all
    PullRequest.unscoped.delete_all
    SyncState.delete_all
    Setting.delete_all
    RepoSlugResolver.stubs(:from_path).returns("acme/api")
  end

  teardown do
    ReviewComment.delete_all
    ReviewIteration.delete_all
    AgentLog.delete_all
    ReviewTask.delete_all
    PullRequestSnapshot.delete_all
    PullRequest.unscoped.delete_all
    SyncState.delete_all
    Setting.delete_all
  end

  def remote_pr(number:, head_sha:, base_sha: "base-1", requested: false, state: "open", latest_review_state: nil)
    {
      github_id: number,
      number: number,
      title: "PR #{number}",
      description: "Body",
      url: "https://github.com/acme/api/pull/#{number}",
      repo_owner: "acme",
      repo_name: "api",
      author: "alice",
      author_avatar: nil,
      created_at_github: "2026-03-07T10:00:00Z",
      updated_at_github: "2026-03-07T10:05:00Z",
      additions: 10,
      deletions: 4,
      changed_files: 2,
      review_requested_for_me: requested,
      remote_state: state,
      inactive_reason: state == "open" ? nil : state,
      head_sha: head_sha,
      base_sha: base_sha,
      head_ref: "feature",
      base_ref: "main",
      merged_at_github: state == "merged" ? "2026-03-07T10:06:00Z" : nil,
      closed_at_github: state == "closed" ? "2026-03-07T10:06:00Z" : nil,
      latest_review_state: latest_review_state,
      review_decision: nil,
      check_status: "success",
      draft: false
    }
  end

  test "creates a new pull request and current snapshot" do
    adapter = stub(
      repo_slug: "acme/api",
      github_login: "izaias",
      fetch_open_pull_requests: { prs: [ remote_pr(number: 101, head_sha: "head-1", requested: true) ], complete: true }
    )

    result = Sync::Engine.new(repo_path: "/tmp/repo", adapter: adapter).call

    assert_equal false, result[:already_running]
    pull_request = PullRequest.find_by!(number: 101)
    assert_equal "open", pull_request.remote_state
    assert_equal "pending_review", pull_request.review_status
    assert_equal "head-1", pull_request.current_snapshot.head_sha
    assert_equal "succeeded", result.dig(:sync, :status)
  end

  test "marks analysis stale when the reviewable revision changes" do
    pull_request = PullRequest.create!(
      github_id: 202,
      number: 202,
      title: "Existing",
      url: "https://github.com/acme/api/pull/202",
      repo_owner: "acme",
      repo_name: "api",
      review_status: "pending_review",
      head_sha: "head-1",
      base_sha: "base-1"
    )
    old_snapshot = pull_request.current_snapshot_or_create!
    task = pull_request.create_review_task!(
      state: "reviewed",
      review_output: "[]",
      pull_request_snapshot: old_snapshot
    )
    pull_request.update!(review_status: "reviewed_by_me")

    adapter = stub(
      repo_slug: "acme/api",
      github_login: "izaias",
      fetch_open_pull_requests: { prs: [ remote_pr(number: 202, head_sha: "head-2", latest_review_state: "COMMENTED") ], complete: true }
    )

    Sync::Engine.new(repo_path: "/tmp/repo", adapter: adapter).call

    pull_request.reload
    task.reload
    assert_equal "stale", pull_request.analysis_status
    assert_equal "pending_review", pull_request.review_status
    assert_not_equal old_snapshot.id, pull_request.current_snapshot.id
    assert_equal old_snapshot.id, task.pull_request_snapshot_id
  end

  test "classifies missing pull requests via targeted lookup when full fetch is complete" do
    pull_request = PullRequest.create!(
      github_id: 303,
      number: 303,
      title: "Missing",
      url: "https://github.com/acme/api/pull/303",
      repo_owner: "acme",
      repo_name: "api",
      review_status: "pending_review"
    )

    adapter = stub(
      repo_slug: "acme/api",
      github_login: "izaias",
      fetch_open_pull_requests: { prs: [], complete: true }
    )
    adapter.stubs(:fetch_pull_request).with(303).returns(remote_pr(number: 303, head_sha: "head-9", state: "merged"))

    Sync::Engine.new(repo_path: "/tmp/repo", adapter: adapter).call

    pull_request.reload
    assert_equal "merged", pull_request.remote_state
    assert_equal "merged", pull_request.inactive_reason
  end

  test "returns already_running when the scope is locked by another sync" do
    SyncState.create!(
      scope_key: "repo:acme/api",
      repo_owner: "acme",
      repo_name: "api",
      status: "running"
    )

    adapter = mock
    adapter.expects(:fetch_open_pull_requests).never

    result = Sync::Engine.new(repo_path: "/tmp/repo", adapter: adapter).call

    assert_equal true, result[:already_running]
    assert_equal "running", result.dig(:sync, :status)
  end
end
