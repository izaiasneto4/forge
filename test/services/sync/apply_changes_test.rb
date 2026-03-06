require "test_helper"

class Sync::ApplyChangesTest < ActiveSupport::TestCase
  self.use_transactional_tests = false

  setup do
    ReviewTask.delete_all
    PullRequest.unscoped.delete_all
  end

  teardown do
    ReviewTask.delete_all
    PullRequest.unscoped.delete_all
  end

  def base_attrs(id:, number:, title: "PR")
    {
      github_id: id,
      number: number,
      title: title,
      url: "https://github.com/acme/api/pull/#{number}",
      repo_owner: "acme",
      repo_name: "api",
      review_status: "pending_review"
    }
  end

  test "returns nil when there are no changes" do
    result = Sync::ApplyChanges.new(
      changes: { to_create: [], to_update: [], to_delete: [] }
    ).call

    assert_nil result
  end

  test "creates updates and soft deletes pull requests" do
    existing = PullRequest.create!(base_attrs(id: 1, number: 1, title: "Old"))
    deleted = PullRequest.create!(base_attrs(id: 2, number: 2))

    result = Sync::ApplyChanges.new(
      changes: {
        to_create: [ base_attrs(id: 3, number: 3) ],
        to_update: [ [ existing, base_attrs(id: 1, number: 1, title: "New") ] ],
        to_delete: [ deleted ]
      }
    ).call

    assert_equal({ created: 1, updated: 1, deleted: 1 }, result)
    assert_equal "New", existing.reload.title
    assert PullRequest.exists?(github_id: 3)
    assert PullRequest.unscoped.find(deleted.id).deleted_at.present?
  end
end
