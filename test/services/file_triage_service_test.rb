require "test_helper"
require "json"

class FileTriageServiceTest < ActiveSupport::TestCase
  self.use_transactional_tests = false

  setup do
    ReviewComment.delete_all
    ReviewIteration.delete_all
    AgentLog.delete_all
    ReviewTask.delete_all
    PullRequestFileTriage.delete_all
    PullRequestSnapshot.delete_all
    PullRequest.unscoped.delete_all

    @pull_request = PullRequest.create!(
      github_id: 501,
      number: 88,
      title: "Add charge retry",
      url: "https://github.com/acme/api/pull/88",
      repo_owner: "acme",
      repo_name: "api",
      review_status: "pending_review",
      head_sha: "head-triage",
      base_sha: "base-triage",
      description: "Retries failed charges",
      additions: 50,
      deletions: 10,
      changed_files: 3
    )

    @snapshot = PullRequestSnapshot.create!(
      pull_request: @pull_request,
      head_sha: "head-triage",
      base_sha: "base-triage",
      status: "current",
      file_triage_status: "pending"
    )
  end

  teardown do
    ReviewComment.delete_all
    ReviewIteration.delete_all
    AgentLog.delete_all
    ReviewTask.delete_all
    PullRequestFileTriage.delete_all
    PullRequestSnapshot.delete_all
    PullRequest.unscoped.delete_all
  end

  test "scores files with jev and stores ranked triage rows" do
    jev = mock
    jev.stubs(:configured?).returns(true)
    jev.expects(:decide).twice.returns(jev_response(role: "domain_logic", core: 3.2, risk: 2.8, must_read: 0.8))

    service = FileTriageService.new(snapshot: @snapshot, jev_client: jev)
    service.stubs(:fetch_changed_files).returns(
      [
        { path: "app/services/billing/charge.rb", status: "modified", additions: 40, deletions: 5, patch: "+retry" },
        { path: "app/models/charge.rb", status: "modified", additions: 10, deletions: 2, patch: "+status" }
      ]
    )

    records = service.generate!

    @snapshot.reload
    assert_equal "current", @snapshot.file_triage_status
    assert_equal 2, records.size
    assert_equal 2, @snapshot.pull_request_file_triages.scored.count
    assert_equal 1, @snapshot.pull_request_file_triages.where(rank: 1).count
    assert_includes %w[domain_logic], @snapshot.pull_request_file_triages.first.role
  end

  test "skips lockfiles without calling jev" do
    jev = mock
    jev.stubs(:configured?).returns(true)
    jev.expects(:decide).never

    service = FileTriageService.new(snapshot: @snapshot, jev_client: jev)
    service.stubs(:fetch_changed_files).returns(
      [
        { path: "package-lock.json", status: "modified", additions: 1000, deletions: 900, patch: "" }
      ]
    )

    service.generate!

    row = @snapshot.pull_request_file_triages.find_by!(path: "package-lock.json")
    assert_equal true, row.skipped
    assert_equal "lockfile", row.skip_reason
  end

  test "marks snapshot failed when jev is not configured" do
    jev = mock
    jev.stubs(:configured?).returns(false)

    service = FileTriageService.new(snapshot: @snapshot, jev_client: jev)

    assert_raises(FileTriageService::Error) { service.generate! }

    @snapshot.reload
    assert_equal "failed", @snapshot.file_triage_status
    assert_match /OPENROUTER_API_KEY/i, @snapshot.file_triage_failure_reason
  end

  private

  def jev_response(role:, core:, risk:, must_read:)
    {
      "answers" => {
        "core_to_change" => { "type" => "score", "score" => core, "confidence" => 0.8 },
        "regression_risk" => { "type" => "score", "score" => risk, "confidence" => 0.7 },
        "role" => { "type" => "choice", "choice" => role, "confidence" => 0.9 },
        "must_read_by_hand" => { "type" => "noul", "noul" => must_read }
      }
    }
  end
end
