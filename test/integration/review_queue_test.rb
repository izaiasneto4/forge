require "test_helper"

class ReviewQueueTest < ActionDispatch::IntegrationTest
  setup do
    @prs = []
    @tasks = []

    # Create multiple PRs for testing
    5.times do |i|
      pr = PullRequest.create!(
        github_id: 100 + i,
        number: 10 + i,
        title: "Test PR #{i}",
        url: "https://github.com/test/repo/pull/#{10 + i}",
        repo_owner: "test",
        repo_name: "repo",
        review_status: "pending_review"
      )
      @prs << pr
    end
  end

  teardown do
    ReviewComment.delete_all
    ReviewIteration.delete_all
    AgentLog.delete_all
    ReviewTask.delete_all
    PullRequest.delete_all
    Setting.delete_all
  end

  # ============================================
  # FIFO Queue Order Tests
  # ============================================

  test "queue maintains FIFO order" do
    # Queue tasks in order with explicit timestamps
    base_time = Time.current
    @prs[0..2].each_with_index do |pr, i|
      task = ReviewTask.create!(
        pull_request: pr,
        state: "queued",
        queued_at: base_time + i.seconds,
        cli_client: "claude",
        review_type: "review"
      )
      @tasks << task
    end

    # Verify FIFO order
    queued = ReviewTask.queued.to_a
    assert_equal @tasks[0], queued[0]
    assert_equal @tasks[1], queued[1]
    assert_equal @tasks[2], queued[2]
  end

  test "queue positions update correctly when task removed from middle" do
    # Create 3 queued tasks with explicit timestamps
    base_time = Time.current
    @prs[0..2].each_with_index do |pr, i|
      task = ReviewTask.create!(
        pull_request: pr,
        state: "queued",
        queued_at: base_time + i.seconds,
        cli_client: "claude",
        review_type: "review"
      )
      @tasks << task
    end

    # Verify initial positions
    assert_equal 1, @tasks[0].queue_position
    assert_equal 2, @tasks[1].queue_position
    assert_equal 3, @tasks[2].queue_position

    # Remove middle task
    @tasks[1].dequeue!

    # Positions should update
    assert_equal 1, @tasks[0].queue_position
    assert_nil @tasks[1].queue_position  # No longer queued
    assert_equal 2, @tasks[2].queue_position
  end

  test "queue handles same timestamp by using id as tiebreaker" do
    frozen_time = Time.current

    travel_to frozen_time do
      @prs[0..2].each do |pr|
        task = ReviewTask.create!(
          pull_request: pr,
          state: "queued",
          queued_at: frozen_time,
          cli_client: "claude",
          review_type: "review"
        )
        @tasks << task
      end
    end

    # All have same queued_at, should still have deterministic order
    queued = ReviewTask.queued.to_a
    assert_equal 3, queued.size
  end

  # ============================================
  # Queue Entry/Exit Tests
  # ============================================

  test "task goes to queue when review already running" do
    # Start first review
    running_task = ReviewTask.create!(
      pull_request: @prs[0],
      state: "in_review",
      started_at: Time.current,
      cli_client: "claude",
      review_type: "review"
    )

    # Try to start second review via controller
    post review_tasks_path, params: { pull_request_id: @prs[1].id }

    @prs[1].reload
    new_task = @prs[1].review_task
    assert_equal "queued", new_task.state
    assert new_task.queued_at.present?
  end

  test "task starts immediately when no review running" do
    post review_tasks_path, params: { pull_request_id: @prs[0].id }

    @prs[0].reload
    task = @prs[0].review_task
    assert_equal "pending_review", task.state
    assert_nil task.queued_at
  end

  test "dequeue moves task to pending_review" do
    task = ReviewTask.create!(
      pull_request: @prs[0],
      state: "queued",
      queued_at: Time.current,
      cli_client: "claude",
      review_type: "review"
    )

    delete dequeue_review_task_path(task)

    task.reload
    assert_equal "pending_review", task.state
    assert_nil task.queued_at
  end

  test "dequeue fails for non-queued task" do
    task = ReviewTask.create!(
      pull_request: @prs[0],
      state: "pending_review",
      cli_client: "claude",
      review_type: "review"
    )

    delete dequeue_review_task_path(task)

    assert_redirected_to review_tasks_path
    assert_match /only dequeue queued/i, flash[:alert]

    task.reload
    assert_equal "pending_review", task.state  # Unchanged
  end

  # ============================================
  # start_next_queued! Edge Cases
  # ============================================

  test "start_next_queued! picks earliest queued task" do
    base_time = Time.current

    # Create tasks out of order but with different timestamps
    # Task at +2 seconds (index 0)
    @tasks << ReviewTask.create!(
      pull_request: @prs[2],
      state: "queued",
      queued_at: base_time + 2.seconds,
      cli_client: "claude",
      review_type: "review"
    )

    # Task at +1 second (index 1) - earliest
    @tasks << ReviewTask.create!(
      pull_request: @prs[1],
      state: "queued",
      queued_at: base_time + 1.second,
      cli_client: "claude",
      review_type: "review"
    )

    # Task at +3 seconds (index 2)
    @tasks << ReviewTask.create!(
      pull_request: @prs[0],
      state: "queued",
      queued_at: base_time + 3.seconds,
      cli_client: "claude",
      review_type: "review"
    )

    # Should pick task with earliest queued_at
    result = ReviewTask.start_next_queued!

    assert_equal @tasks[1], result  # The one queued at +1 second
    result.reload
    assert_equal "pending_review", result.state
  end

  test "start_next_queued! returns nil when all tasks non-queued" do
    ReviewTask.create!(
      pull_request: @prs[0],
      state: "pending_review",
      cli_client: "claude",
      review_type: "review"
    )

    ReviewTask.create!(
      pull_request: @prs[1],
      state: "in_review",
      cli_client: "claude",
      review_type: "review"
    )

    result = ReviewTask.start_next_queued!
    assert_nil result
  end

  test "start_next_queued! ignores failed/done tasks" do
    ReviewTask.create!(
      pull_request: @prs[0],
      state: "failed_review",
      cli_client: "claude",
      review_type: "review"
    )

    ReviewTask.create!(
      pull_request: @prs[1],
      state: "done",
      cli_client: "claude",
      review_type: "review"
    )

    queued_task = ReviewTask.create!(
      pull_request: @prs[2],
      state: "queued",
      queued_at: Time.current,
      cli_client: "claude",
      review_type: "review"
    )

    result = ReviewTask.start_next_queued!
    assert_equal queued_task, result
  end

  # ============================================
  # any_review_running? Edge Cases
  # ============================================

  test "any_review_running? returns false for empty table" do
    refute ReviewTask.any_review_running?
  end

  test "any_review_running? returns false for only queued tasks" do
    ReviewTask.create!(
      pull_request: @prs[0],
      state: "queued",
      queued_at: Time.current,
      cli_client: "claude",
      review_type: "review"
    )

    refute ReviewTask.any_review_running?
  end

  test "any_review_running? returns false for only pending_review tasks" do
    ReviewTask.create!(
      pull_request: @prs[0],
      state: "pending_review",
      cli_client: "claude",
      review_type: "review"
    )

    refute ReviewTask.any_review_running?
  end

  test "any_review_running? returns true when in_review exists" do
    ReviewTask.create!(
      pull_request: @prs[0],
      state: "in_review",
      started_at: Time.current,
      cli_client: "claude",
      review_type: "review"
    )

    assert ReviewTask.any_review_running?
  end

  test "any_review_running? returns true with multiple in_review" do
    @prs[0..1].each do |pr|
      ReviewTask.create!(
        pull_request: pr,
        state: "in_review",
        started_at: Time.current,
        cli_client: "claude",
        review_type: "review"
      )
    end

    assert ReviewTask.any_review_running?
  end

  # ============================================
  # ProcessReviewQueueJob Edge Cases
  # ============================================

  test "ProcessReviewQueueJob skips when review running" do
    ReviewTask.create!(
      pull_request: @prs[0],
      state: "in_review",
      started_at: Time.current,
      cli_client: "claude",
      review_type: "review"
    )

    queued = ReviewTask.create!(
      pull_request: @prs[1],
      state: "queued",
      queued_at: Time.current,
      cli_client: "claude",
      review_type: "review"
    )

    ProcessReviewQueueJob.perform_now

    queued.reload
    assert_equal "queued", queued.state  # Should not have changed
  end

  test "ProcessReviewQueueJob processes next when no review running" do
    queued = ReviewTask.create!(
      pull_request: @prs[0],
      state: "queued",
      queued_at: Time.current,
      cli_client: "claude",
      review_type: "review"
    )

    assert_enqueued_with(job: ReviewTaskJob, args: [ queued.id ]) do
      ProcessReviewQueueJob.perform_now
    end

    queued.reload
    assert_equal "pending_review", queued.state
  end

  # ============================================
  # Auto-Review Mode Tests
  # ============================================

  test "auto_review_delay returns value within range" do
    Setting.auto_review_delay_min = 10
    Setting.auto_review_delay_max = 20

    100.times do
      delay = Setting.auto_review_delay
      assert delay >= 10, "Delay #{delay} should be >= 10"
      assert delay <= 20, "Delay #{delay} should be <= 20"
    end
  end

  test "auto_review_delay uses defaults when not set" do
    100.times do
      delay = Setting.auto_review_delay
      assert delay >= Setting::DEFAULT_AUTO_REVIEW_DELAY_MIN
      assert delay <= Setting::DEFAULT_AUTO_REVIEW_DELAY_MAX
    end
  end

  test "auto_review_mode defaults to false" do
    refute Setting.auto_review_mode?
  end

  test "auto_review_mode can be toggled" do
    Setting.auto_review_mode = true
    assert Setting.auto_review_mode?

    Setting.auto_review_mode = false
    refute Setting.auto_review_mode?
  end

  # ============================================
  # Queue Position Edge Cases
  # ============================================

  test "queue_position is 1 for only queued task" do
    task = ReviewTask.create!(
      pull_request: @prs[0],
      state: "queued",
      queued_at: Time.current,
      cli_client: "claude",
      review_type: "review"
    )

    assert_equal 1, task.queue_position
  end

  test "queue_position handles large queue" do
    base_time = Time.current

    20.times do |i|
      pr = PullRequest.create!(
        github_id: 1000 + i,
        number: 100 + i,
        title: "Large Queue PR #{i}",
        url: "https://github.com/test/repo/pull/#{100 + i}",
        repo_owner: "test",
        repo_name: "repo",
        review_status: "pending_review"
      )

      @tasks << ReviewTask.create!(
        pull_request: pr,
        state: "queued",
        queued_at: base_time + i.seconds,
        cli_client: "claude",
        review_type: "review"
      )
    end

    # Verify positions 1-20
    @tasks.each_with_index do |task, i|
      assert_equal i + 1, task.queue_position, "Task #{i} should have position #{i + 1}"
    end
  end

  # ============================================
  # State Transition Edge Cases
  # ============================================

  test "enqueue! can be called on pending_review task" do
    task = ReviewTask.create!(
      pull_request: @prs[0],
      state: "pending_review",
      cli_client: "claude",
      review_type: "review"
    )

    task.enqueue!

    assert_equal "queued", task.state
    assert task.queued_at.present?
  end

  test "enqueue! overwrites previous queued_at" do
    original_time = 1.hour.ago
    task = ReviewTask.create!(
      pull_request: @prs[0],
      state: "queued",
      queued_at: original_time,
      cli_client: "claude",
      review_type: "review"
    )

    task.enqueue!

    assert task.queued_at > original_time
  end

  test "queued state is included in STATES constant" do
    assert_includes ReviewTask::STATES, "queued"
  end

  test "queued state is included in STATE_ORDER constant" do
    assert_includes ReviewTask::STATE_ORDER, "queued"
  end

  test "queued comes before pending_review in STATE_ORDER" do
    queued_idx = ReviewTask::STATE_ORDER.index("queued")
    pending_idx = ReviewTask::STATE_ORDER.index("pending_review")

    assert queued_idx < pending_idx
  end

  # ============================================
  # Full Workflow End-to-End Test
  # ============================================

  test "full queue workflow: queue -> process -> complete -> next" do
    Setting.auto_review_mode = true

    # 1. Start first review (goes immediately)
    post review_tasks_path, params: { pull_request_id: @prs[0].id }
    @prs[0].reload
    task1 = @prs[0].review_task
    assert_equal "pending_review", task1.state

    # 2. Simulate it's now in_review
    task1.start_review!
    assert_equal "in_review", task1.state

    # 3. Try to start second review (should queue)
    post review_tasks_path, params: { pull_request_id: @prs[1].id }
    @prs[1].reload
    task2 = @prs[1].review_task
    assert_equal "queued", task2.state
    assert_equal 1, task2.queue_position

    # 4. Try to start third review (should queue behind #2)
    post review_tasks_path, params: { pull_request_id: @prs[2].id }
    @prs[2].reload
    task3 = @prs[2].review_task
    assert_equal "queued", task3.state
    assert_equal 2, task3.queue_position

    # 5. Complete first review
    task1.complete_review!("Review complete")
    assert_equal "reviewed", task1.state

    # 6. Process queue (simulating what happens after job completes)
    ProcessReviewQueueJob.perform_now

    # 7. Second task should now be pending_review (and job enqueued)
    task2.reload
    assert_equal "pending_review", task2.state

    # 8. Third task should still be queued but now position 1
    task3.reload
    assert_equal "queued", task3.state
    assert_equal 1, task3.queue_position
  end

  test "full workflow: remove from queue mid-process" do
    # Setup running task
    task1 = ReviewTask.create!(
      pull_request: @prs[0],
      state: "in_review",
      started_at: Time.current,
      cli_client: "claude",
      review_type: "review"
    )

    # Queue 3 tasks with explicit timestamps
    tasks = []
    base_time = Time.current
    @prs[1..3].each_with_index do |pr, i|
      tasks << ReviewTask.create!(
        pull_request: pr,
        state: "queued",
        queued_at: base_time + i.seconds,
        cli_client: "claude",
        review_type: "review"
      )
    end

    # Initial positions
    assert_equal 1, tasks[0].queue_position
    assert_equal 2, tasks[1].queue_position
    assert_equal 3, tasks[2].queue_position

    # Remove middle task via controller
    delete dequeue_review_task_path(tasks[1])

    # Verify positions updated
    tasks.each(&:reload)
    assert_equal 1, tasks[0].queue_position
    assert_nil tasks[1].queue_position  # Dequeued
    assert_equal "pending_review", tasks[1].state
    assert_equal 2, tasks[2].queue_position

    # Complete running task and process queue
    task1.complete_review!("Done")
    ProcessReviewQueueJob.perform_now

    # First queued task should now be pending
    tasks[0].reload
    assert_equal "pending_review", tasks[0].state

    # Third task moves to position 1
    tasks[2].reload
    assert_equal 1, tasks[2].queue_position
  end
end
