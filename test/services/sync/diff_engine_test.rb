require "test_helper"

class Sync::DiffEngineTest < ActiveSupport::TestCase
  self.use_transactional_tests = false

  setup do
    ReviewComment.delete_all
    ReviewIteration.delete_all
    AgentLog.delete_all
    ReviewTask.delete_all
    PullRequest.unscoped.delete_all
  end

  teardown do
    ReviewComment.delete_all
    ReviewIteration.delete_all
    AgentLog.delete_all
    ReviewTask.delete_all
    PullRequest.unscoped.delete_all
  end

  def base_attrs(id:, number:, title: "PR", review_status: "pending_review")
    {
      github_id: id,
      number: number,
      title: title,
      description: "Body",
      url: "https://github.com/acme/api/pull/#{number}",
      repo_owner: "acme",
      repo_name: "api",
      author: "alice",
      author_avatar: "https://example.com/a.png",
      created_at_github: "2026-03-04T10:00:00Z",
      updated_at_github: "2026-03-04T10:00:00Z",
      review_status: review_status
    }
  end

  test "returns empty result when fetched prs are blank" do
    result = Sync::DiffEngine.new(fetched_prs: [], repo_path: "/tmp/repo").call

    assert_equal({ to_create: [], to_update: [], to_delete: [] }, result)
  end

  test "returns empty result when repo info cannot be determined" do
    Dir.stubs(:exist?).returns(false)

    result = Sync::DiffEngine.new(fetched_prs: [base_attrs(id: 1, number: 1)], repo_path: "/missing").call

    assert_equal({ to_create: [], to_update: [], to_delete: [] }, result)
  end

  test "classifies creates updates restores and deletes" do
    existing_same = PullRequest.create!(base_attrs(id: 1, number: 1))
    existing_changed = PullRequest.create!(base_attrs(id: 2, number: 2, title: "Old"))
    existing_deleted = PullRequest.create!(base_attrs(id: 3, number: 3))
    existing_deleted.update_column(:deleted_at, 1.day.ago)
    existing_missing = PullRequest.create!(base_attrs(id: 4, number: 4))
    archived = PullRequest.create!(base_attrs(id: 5, number: 5))
    archived.update_column(:archived, true)

    Sync::DiffEngine.any_instance.stubs(:get_repo_info).returns({ owner: "acme", name: "api" })

    fetched = [
      base_attrs(id: 1, number: 1),
      base_attrs(id: 2, number: 2, title: "New"),
      base_attrs(id: 3, number: 3),
      base_attrs(id: 6, number: 6)
    ]

    result = Sync::DiffEngine.new(fetched_prs: fetched, repo_path: "/tmp/repo").call

    assert_equal [6], result[:to_create].map { |attrs| attrs[:github_id] }
    assert_equal [1, 2, 3], result[:to_update].map { |existing, _| existing.github_id }
    assert_equal [4], result[:to_delete].map(&:github_id)
    refute_includes result[:to_delete].map(&:github_id), archived.github_id
    assert_equal false, result[:to_update].find { |existing, _| existing == existing_deleted }[1][:archived]
    assert_nil result[:to_update].find { |existing, _| existing == existing_deleted }[1][:deleted_at]
    assert_equal existing_same.github_id, existing_same.reload.github_id
  end
end
