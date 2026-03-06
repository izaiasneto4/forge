require "test_helper"

class ReviewTaskBroadcasterTest < ActiveSupport::TestCase
  self.use_transactional_tests = false

  setup do
    ReviewComment.delete_all
    ReviewIteration.delete_all
    AgentLog.delete_all
    ReviewTask.delete_all
    PullRequest.unscoped.delete_all

    pull_request = PullRequest.create!(
      github_id: 999,
      number: 99,
      title: "PR",
      url: "https://github.com/acme/api/pull/99",
      repo_owner: "acme",
      repo_name: "api",
      review_status: "pending_review"
    )
    @review_task = pull_request.create_review_task!(state: "pending_review")
  end

  teardown do
    ReviewComment.delete_all
    ReviewIteration.delete_all
    AgentLog.delete_all
    ReviewTask.delete_all
    PullRequest.unscoped.delete_all
  end

  test "broadcasts state change stream" do
    ApplicationController.stubs(:render).returns("<turbo-stream></turbo-stream>")
    Turbo::StreamsChannel.expects(:broadcast_stream_to).with(
      "review_tasks_board",
      content: "<turbo-stream></turbo-stream>"
    )

    ReviewTaskBroadcaster.new(@review_task).broadcast_state_change
  end

  test "swallows broadcast errors" do
    ApplicationController.stubs(:render).raises(StandardError, "broken")

    assert_nothing_raised do
      ReviewTaskBroadcaster.new(@review_task).broadcast_state_change
    end
  end
end
