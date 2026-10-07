require "test_helper"

class PullRequestFileTriageTest < ActiveSupport::TestCase
  self.use_transactional_tests = false

  setup do
    PullRequestFileTriage.delete_all
    PullRequestSnapshot.delete_all
    PullRequest.unscoped.delete_all

    @pull_request = PullRequest.create!(
      github_id: 777,
      number: 9,
      title: "Triage shortlist",
      url: "https://github.com/acme/api/pull/9",
      repo_owner: "acme",
      repo_name: "api",
      review_status: "pending_review",
      head_sha: "h",
      base_sha: "b"
    )

    @snapshot = PullRequestSnapshot.create!(
      pull_request: @pull_request,
      head_sha: "h",
      base_sha: "b",
      status: "current",
      file_triage_status: "current"
    )
  end

  teardown do
    PullRequestFileTriage.delete_all
    PullRequestSnapshot.delete_all
    PullRequest.unscoped.delete_all
  end

  test "budget_file_count maps minutes to shortlist size" do
    assert_equal 3, PullRequestFileTriage.budget_file_count(5)
    assert_equal 5, PullRequestFileTriage.budget_file_count(15)
    assert_equal 8, PullRequestFileTriage.budget_file_count(30)
    assert_equal 10, PullRequestFileTriage.budget_file_count(60)
  end

  test "shortlist_for prefers role diversity" do
    create_file!("a.rb", role: "test", priority: 5.0)
    create_file!("b.rb", role: "test", priority: 4.9)
    create_file!("c.rb", role: "test", priority: 4.8)
    create_file!("d.rb", role: "domain_logic", priority: 4.7)
    create_file!("e.rb", role: "entrypoint", priority: 4.6)

    shortlist = PullRequestFileTriage.shortlist_for(@snapshot, budget_minutes: 5)
    roles = shortlist.map(&:role)

    assert_equal 3, shortlist.size
    assert_includes roles, "domain_logic"
    assert_includes roles, "entrypoint"
  end

  private

  def create_file!(path, role:, priority:)
    @snapshot.pull_request_file_triages.create!(
      path: path,
      status: "modified",
      role: role,
      core_score: priority,
      risk_score: priority,
      must_read_p: 0.5,
      priority: priority,
      confidence: 0.8,
      skipped: false,
      why: "test"
    )
  end
end
