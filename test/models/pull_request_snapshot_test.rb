require "test_helper"

class PullRequestSnapshotTest < ActiveSupport::TestCase
  include ActiveJob::TestHelper

  self.use_transactional_tests = false

  setup do
    clear_enqueued_jobs
    clear_performed_jobs
    ActiveJob::Base.queue_adapter = :test
    ReviewTask.delete_all
    PullRequestSnapshot.delete_all
    PullRequest.unscoped.delete_all

    @pull_request = PullRequest.create!(
      github_id: 123,
      number: 42,
      title: "Snapshot test",
      url: "https://github.com/acme/api/pull/42",
      repo_owner: "acme",
      repo_name: "api",
      review_status: "pending_review",
      head_sha: "head-1",
      base_sha: "base-1",
      additions: 10,
      deletions: 4,
      changed_files: 2
    )
  end

  teardown do
    clear_enqueued_jobs
    clear_performed_jobs
    ReviewTask.delete_all
    PullRequestSnapshot.delete_all
    PullRequest.unscoped.delete_all
  end

  test "activate_for marks snapshot pending and enqueues summary generation once" do
    assert_enqueued_with(job: PullRequestSummaryJob) do
      PullRequestSnapshot.activate_for!(
        pull_request: @pull_request,
        head_sha: "head-1",
        base_sha: "base-1",
        stale_reason: "revision_changed"
      )
    end

    snapshot = @pull_request.reload.current_snapshot
    assert_equal "pending", snapshot.ai_summary_status
  end

  test "enqueue_ai_summary_generation skips duplicate pending and current work" do
    snapshot = PullRequestSnapshot.create!(
      pull_request: @pull_request,
      head_sha: "head-1",
      base_sha: "base-1",
      status: "current",
      ai_summary_status: "pending"
    )

    assert_equal false, snapshot.enqueue_ai_summary_generation!

    snapshot.update!(ai_summary_status: "current")
    assert_equal false, snapshot.enqueue_ai_summary_generation!
    assert_equal 0, enqueued_jobs.size
  end

  test "pull request uses stale summary fallback when current snapshot is still pending" do
    old_snapshot = PullRequestSnapshot.create!(
      pull_request: @pull_request,
      head_sha: "head-1",
      base_sha: "base-1",
      status: "stale",
      ai_summary_status: "current",
      ai_summary_generated_at: Time.current,
      ai_summary_files_changed: 2,
      ai_summary_lines_added: 10,
      ai_summary_lines_removed: 4,
      ai_summary_main_changes: [ "Caching layer added" ],
      ai_summary_risk_areas: [ "Authentication logic" ]
    )

    current_snapshot = PullRequestSnapshot.create!(
      pull_request: @pull_request,
      head_sha: "head-2",
      base_sha: "base-1",
      status: "current",
      ai_summary_status: "pending"
    )

    summary = @pull_request.reload.ai_summary_for_display

    assert_equal "current", summary[:status]
    assert_equal true, summary[:stale]
    assert_equal old_snapshot.id, summary[:snapshot_id]
    assert_not_equal current_snapshot.id, summary[:snapshot_id]
  end
end
