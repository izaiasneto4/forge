require "test_helper"

class SyncPullRequestsJobTest < ActiveJob::TestCase
  test "delegates to sync engine with job trigger" do
    Setting.stubs(:current_repo).returns("/tmp/repo")
    Sync::Engine.any_instance.expects(:call).with(trigger: "job").returns(
      fetched: 0,
      created: 0,
      updated: 0,
      deactivated: 0,
      already_running: false,
      sync: { status: "succeeded" }
    )

    assert_nothing_raised do
      SyncPullRequestsJob.perform_now
    end
  end

  test "re-raises sync engine errors" do
    Setting.stubs(:current_repo).returns("/tmp/repo")
    Sync::Engine.any_instance.stubs(:call).raises(Sync::GithubAdapter::Error, "Network error")

    error = assert_raises(Sync::GithubAdapter::Error) do
      SyncPullRequestsJob.perform_now
    end

    assert_equal "Network error", error.message
  end
end
