require "test_helper"

class Sync::OrchestratorTest < ActiveSupport::TestCase
  test "call delegates to sync engine inside sync mode" do
    result = {
      fetched: 1,
      created: 0,
      updated: 1,
      deactivated: 0,
      already_running: false,
      sync: { status: "succeeded" }
    }

    Sync::Engine.any_instance.expects(:call).returns(result)

    assert_equal result, Sync::Orchestrator.new(repo_path: "/tmp/repo").call
    assert_equal false, SyncMode.active?
  end
end
