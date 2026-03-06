require "test_helper"

class PullRequestBroadcasterTest < ActiveSupport::TestCase
  setup do
    @pull_request = PullRequest.create!(
      github_id: 123,
      number: 12,
      title: "PR",
      url: "https://github.com/acme/api/pull/12",
      repo_owner: "acme",
      repo_name: "api",
      review_status: "pending_review"
    )
  end

  test "broadcasts status change stream" do
    @pull_request.review_status = "reviewed_by_me"
    @pull_request.stubs(:review_status_before_last_save).returns("pending_review")

    ApplicationController.stubs(:render).returns("<turbo-stream></turbo-stream>")
    Turbo::StreamsChannel.expects(:broadcast_stream_to).with(
      "pull_requests_board",
      content: "<turbo-stream></turbo-stream>"
    )

    PullRequestBroadcaster.new(@pull_request).broadcast_status_change
  end

  test "swallows broadcast errors" do
    ApplicationController.stubs(:render).raises(StandardError, "broken")

    assert_nothing_raised do
      PullRequestBroadcaster.new(@pull_request).broadcast_status_change
    end
  end
end
