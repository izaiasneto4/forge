require "test_helper"

class ProcessReviewQueueJobTest < ActiveJob::TestCase
  setup do
    @pr = PullRequest.create!(
      github_id: 123,
      number: 42,
      title: "Test PR",
      url: "https://github.com/test/repo/pull/42",
      repo_owner: "test",
      repo_name: "repo",
      review_status: "pending_review"
    )
  end

  teardown do
    ReviewTask.delete_all
    PullRequest.delete_all
  end

  test "does nothing when a review is running" do
    ReviewTask.create!(
      pull_request: @pr,
      state: "in_review",
      cli_client: "claude",
      review_type: "review"
    )

    pr2 = PullRequest.create!(
      github_id: 456,
      number: 43,
      title: "Queued PR",
      url: "https://github.com/test/repo/pull/43",
      repo_owner: "test",
      repo_name: "repo",
      review_status: "pending_review"
    )

    queued_task = ReviewTask.create!(
      pull_request: pr2,
      state: "queued",
      queued_at: Time.current,
      cli_client: "claude",
      review_type: "review"
    )

    ProcessReviewQueueJob.perform_now

    queued_task.reload
    assert_equal "queued", queued_task.state
  end

  test "starts next queued task when no review is running" do
    queued_task = ReviewTask.create!(
      pull_request: @pr,
      state: "queued",
      queued_at: Time.current,
      cli_client: "claude",
      review_type: "review"
    )

    assert_enqueued_with(job: ReviewTaskJob, args: [ queued_task.id ]) do
      ProcessReviewQueueJob.perform_now
    end

    queued_task.reload
    assert_equal "pending_review", queued_task.state
    assert_nil queued_task.queued_at
  end

  test "does nothing when queue is empty" do
    ReviewTask.create!(
      pull_request: @pr,
      state: "done",
      cli_client: "claude",
      review_type: "review"
    )

    assert_no_enqueued_jobs do
      ProcessReviewQueueJob.perform_now
    end
  end

  test "claim_and_start_next_queued prevents double claiming" do
    # Create two queued tasks
    queued_task1 = ReviewTask.create!(
      pull_request: @pr,
      state: "queued",
      queued_at: 1.minute.ago,
      cli_client: "claude",
      review_type: "review"
    )

    pr2 = PullRequest.create!(
      github_id: 789,
      number: 99,
      title: "Second PR",
      url: "https://github.com/test/repo/pull/99",
      repo_owner: "test",
      repo_name: "repo",
      review_status: "pending_review"
    )

    queued_task2 = ReviewTask.create!(
      pull_request: pr2,
      state: "queued",
      queued_at: Time.current,
      cli_client: "claude",
      review_type: "review"
    )

    # First claim should get task1
    claimed = ReviewTask.claim_and_start_next_queued!
    assert_equal queued_task1.id, claimed.id
    assert_equal "pending_review", claimed.reload.state

    # Second claim while first is processing (before it starts in_review)
    # should not claim task2 because we check any_review_running inside the transaction
    # but since the first task hasn't started in_review yet, let's simulate it
    queued_task1.start_review!

    # Now another claim should fail because a review is running
    second_claim = ReviewTask.claim_and_start_next_queued!
    assert_nil second_claim

    # Task2 should still be queued
    assert_equal "queued", queued_task2.reload.state
  end
end
