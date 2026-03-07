require "test_helper"

class PullRequestSummaryServiceTest < ActiveSupport::TestCase
  self.use_transactional_tests = false

  setup do
    ReviewTask.delete_all
    PullRequestSnapshot.delete_all
    PullRequest.unscoped.delete_all

    @pull_request = PullRequest.create!(
      github_id: 123,
      number: 42,
      title: "Summary target",
      url: "https://github.com/acme/api/pull/42",
      repo_owner: "acme",
      repo_name: "api",
      review_status: "pending_review",
      head_sha: "head-1",
      base_sha: "base-1",
      additions: 210,
      deletions: 34,
      changed_files: 6
    )

    @snapshot = PullRequestSnapshot.create!(
      pull_request: @pull_request,
      head_sha: "head-1",
      base_sha: "base-1",
      status: "current",
      ai_summary_status: "pending"
    )
  end

  teardown do
    ReviewTask.delete_all
    PullRequestSnapshot.delete_all
    PullRequest.unscoped.delete_all
  end

  test "generates and stores summary after chunk analysis and consolidation" do
    service = PullRequestSummaryService.new(snapshot: @snapshot, cli_client: "claude")
    large_diff = Array.new(1500, "+cache update\n").join

    service.stubs(:fetch_diff).returns(large_diff)
    service.expects(:run_ai_prompt).times(3).returns(
      <<~TEXT,
        ```json
        {"main_changes":["Caching layer added"],"risk_areas":["Authentication logic"]}
        ```
      TEXT
      <<~TEXT,
        ```json
        {"main_changes":["Auth middleware refactor"],"risk_areas":["Billing calculation"]}
        ```
      TEXT
      <<~TEXT
        ```json
        {"files_changed":6,"lines_added":210,"lines_removed":34,"main_changes":["Caching layer added","Auth middleware refactor"],"risk_areas":["Billing calculation","Authentication logic"]}
        ```
      TEXT
    )

    summary = service.generate!

    @snapshot.reload
    assert_equal "current", @snapshot.ai_summary_status
    assert_equal 6, summary[:files_changed]
    assert_equal [ "Caching layer added", "Auth middleware refactor" ], summary[:main_changes]
    assert_equal [ "Billing calculation", "Authentication logic" ], summary[:risk_areas]
  end

  test "marks snapshot failed when AI output is malformed" do
    service = PullRequestSummaryService.new(snapshot: @snapshot, cli_client: "claude")

    service.stubs(:fetch_diff).returns("+bad change\n")
    service.stubs(:run_ai_prompt).returns("not json")

    assert_raises(PullRequestSummaryService::Error) { service.generate! }

    @snapshot.reload
    assert_equal "failed", @snapshot.ai_summary_status
    assert_match /parse failed/i, @snapshot.ai_summary_failure_reason
  end
end
