require "test_helper"

class PullRequestLifecycleTest < ActiveSupport::TestCase
  setup do
    @github_login = "izaias"
    @sequence = 0
  end

  test "inactive pull requests are settled" do
    expected = "settled"
    pull_request = create_pull_request(remote_state: "merged", inactive_reason: "merged")

    assert_equal expected, lifecycle_for(pull_request)
  end

  test "pull requests authored by the current user without a task are authored" do
    expected = "authored"
    pull_request = create_pull_request(author: @github_login.upcase)

    assert_equal expected, lifecycle_for(pull_request)
  end

  test "authorship is ignored when no github login is configured" do
    expected = "needs_review"
    pull_request = create_pull_request(author: @github_login)

    assert_equal expected, PullRequestLifecycle.new(pull_request, github_login: nil).call
  end

  test "pull requests already reviewed on github without a task are settled" do
    expected = "settled"
    pull_request = SyncMode.with_active { create_pull_request(review_status: "reviewed_by_me") }

    assert_equal expected, lifecycle_for(pull_request)
  end

  test "open pull requests without a task need review" do
    expected = "needs_review"
    pull_request = create_pull_request

    assert_equal expected, lifecycle_for(pull_request)
  end

  test "task states map onto the lifecycle" do
    expectations = {
      "queued" => "queued",
      "pending_review" => "reviewing",
      "in_review" => "reviewing",
      "failed_review" => "failed",
      "waiting_implementation" => "waiting",
      "done" => "settled"
    }

    expectations.each do |task_state, expected|
      pull_request = create_pull_request
      pull_request.create_review_task!(state: task_state)

      assert_equal expected, lifecycle_for(pull_request), "task state #{task_state}"
    end
  end

  test "archived tasks are settled" do
    expected = "settled"
    pull_request = create_pull_request
    pull_request.create_review_task!(state: "reviewed", archived: true)

    assert_equal expected, lifecycle_for(pull_request)
  end

  test "reviewed tasks are ready until submitted" do
    ready = "ready"
    settled = "settled"
    pull_request = create_pull_request
    task = pull_request.create_review_task!(state: "reviewed")

    assert_equal ready, lifecycle_for(pull_request)

    task.mark_submitted!(event: "COMMENT")

    assert_equal settled, lifecycle_for(pull_request.reload)
  end

  test "new commits after a submitted review send the pull request back to needs review" do
    expected = "needs_review"
    pull_request = create_pull_request
    task = pull_request.create_review_task!(state: "reviewed", pull_request_snapshot: stale_snapshot_for(pull_request))
    task.mark_submitted!(event: "COMMENT")

    lifecycle = PullRequestLifecycle.new(pull_request.reload, github_login: @github_login)

    assert_equal expected, lifecycle.call
    assert lifecycle.new_commits?
  end

  test "new commits after an approved review send the pull request back to needs review" do
    expected = "needs_review"
    pull_request = create_pull_request
    pull_request.create_review_task!(state: "done", pull_request_snapshot: stale_snapshot_for(pull_request))

    assert_equal expected, lifecycle_for(pull_request.reload)
  end

  test "new commits keep waiting pull requests in waiting and flag them" do
    expected = "waiting"
    pull_request = create_pull_request
    pull_request.create_review_task!(state: "waiting_implementation", pull_request_snapshot: stale_snapshot_for(pull_request))

    lifecycle = PullRequestLifecycle.new(pull_request.reload, github_login: @github_login)

    assert_equal expected, lifecycle.call
    assert lifecycle.new_commits?
  end

  test "pull requests without a task have no new commits" do
    pull_request = create_pull_request

    assert_not PullRequestLifecycle.new(pull_request, github_login: @github_login).new_commits?
  end

  test ".call reads the github login from settings" do
    expected = "authored"
    Setting.github_login = @github_login
    pull_request = create_pull_request(author: @github_login)

    assert_equal expected, PullRequestLifecycle.call(pull_request)
  end

  private

  def lifecycle_for(pull_request)
    PullRequestLifecycle.call(pull_request, github_login: @github_login)
  end

  def create_pull_request(**attributes)
    @sequence += 1
    owner = "acme"
    name = "api"

    PullRequest.create!(
      {
        github_id: 9_000 + @sequence,
        number: @sequence,
        title: "Lifecycle #{@sequence}",
        url: "https://github.com/#{owner}/#{name}/pull/#{@sequence}",
        repo_owner: owner,
        repo_name: name,
        review_status: "pending_review",
        author: "someone-else"
      }.merge(attributes)
    )
  end

  def stale_snapshot_for(pull_request)
    reviewed_head = "reviewed-head"
    latest_head = "latest-head"
    base = "base"

    reviewed = PullRequestSnapshot.create!(pull_request: pull_request, head_sha: reviewed_head, base_sha: base, status: "stale")
    PullRequestSnapshot.create!(pull_request: pull_request, head_sha: latest_head, base_sha: base, status: "current")
    reviewed
  end
end
