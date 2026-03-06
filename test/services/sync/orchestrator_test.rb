require "test_helper"

class Sync::OrchestratorTest < ActiveSupport::TestCase
  test "call uses requested review list when requested only mode is enabled" do
    fetch_service = mock
    fetch_service.stubs(:call).returns([ { github_id: 1 } ])

    Sync::FetchAllPrs.stubs(:new).returns(fetch_service)
    Sync::DiffEngine.expects(:new).with(fetched_prs: [ { github_id: 1 } ], repo_path: "/tmp/repo").returns(stub(call: { to_create: [], to_update: [], to_delete: [] }))
    Sync::ApplyChanges.expects(:new).with(changes: { to_create: [], to_update: [], to_delete: [] }).returns(stub(call: { created: 0, updated: 0, deleted: 0 }))
    Setting.stubs(:only_requested_reviews?).returns(true)
    Setting.stubs(:github_login).returns("alice")

    result = Sync::Orchestrator.new(repo_path: "/tmp/repo").call

    assert_equal({ fetched: 1, created: 0, updated: 0, deleted: 0 }, result)
  end

  test "call combines open and reviewed lists when requested only mode is disabled" do
    fetch_service = mock
    fetch_service.stubs(:call).returns([ { github_id: 1 } ])
    fetch_service.stubs(:call_with_open_prs).returns(
      pending_review: [ { github_id: 2 } ],
      reviewed_by_me: [ { github_id: 3 } ]
    )

    Sync::FetchAllPrs.stubs(:new).returns(fetch_service)
    Sync::DiffEngine.expects(:new).with(fetched_prs: [ { github_id: 2 }, { github_id: 3 } ], repo_path: "/tmp/repo").returns(stub(call: { to_create: [], to_update: [], to_delete: [] }))
    Sync::ApplyChanges.expects(:new).with(changes: { to_create: [], to_update: [], to_delete: [] }).returns(stub(call: { created: 1, updated: 2, deleted: 3 }))
    Setting.stubs(:only_requested_reviews?).returns(false)
    Setting.stubs(:github_login).returns("alice")

    result = Sync::Orchestrator.new(repo_path: "/tmp/repo").call

    assert_equal({ fetched: 2, created: 1, updated: 2, deleted: 3 }, result)
  end

  test "call updates github login when service resolves one" do
    fetch_service = Sync::FetchAllPrs.allocate
    fetch_service.instance_variable_set(:@github_login, "resolved-user")
    fetch_service.stubs(:call).returns([])

    Sync::FetchAllPrs.stubs(:new).returns(fetch_service)
    Sync::DiffEngine.stubs(:new).returns(stub(call: { to_create: [], to_update: [], to_delete: [] }))
    Sync::ApplyChanges.stubs(:new).returns(stub(call: { created: 0, updated: 0, deleted: 0 }))
    Setting.stubs(:only_requested_reviews?).returns(true)
    Setting.stubs(:github_login).returns(nil)
    Setting.expects(:github_login=).with("resolved-user")

    Sync::Orchestrator.new(repo_path: "/tmp/repo").call
  end
end
