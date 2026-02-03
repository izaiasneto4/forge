require "test_helper"

class ReviewTaskLogsChannelTest < ActionCable::Channel::TestCase
  setup do
    @pr = PullRequest.create!(
      github_id: 123,
      number: 1,
      title: "Test PR",
      url: "https://github.com/test/repo/pull/1",
      repo_owner: "test",
      repo_name: "repo",
      review_status: "pending_review"
    )
    @review_task = ReviewTask.create!(
      pull_request: @pr,
      state: "pending_review"
    )
  end

  test "subscribed streams from correct channel" do
    subscribe review_task_id: @review_task.id.to_s

    assert subscription.confirmed?
    assert_has_stream "review_task_#{@review_task.id}_logs"
  end

  test "subscribed with different review_task_id" do
    task2 = ReviewTask.create!(
      pull_request: @pr,
      state: "in_review"
    )

    subscribe review_task_id: task2.id.to_s

    assert subscription.confirmed?
    assert_has_stream "review_task_#{task2.id}_logs"
  end

  test "unsubscribed stops all streams" do
    subscribe review_task_id: @review_task.id.to_s

    assert subscription.confirmed?

    unsubscribe

    assert_no_streams
  end
end
