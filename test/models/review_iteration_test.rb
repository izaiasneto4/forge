require "test_helper"

class ReviewIterationTest < ActiveSupport::TestCase
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

    @task = ReviewTask.create!(
      pull_request: @pr,
      state: "reviewed",
      cli_client: "claude",
      review_type: "review"
    )

    @iteration = ReviewIteration.new(
      review_task: @task,
      iteration_number: 1,
      from_state: "in_review",
      to_state: "archived",
      cli_client: "claude",
      review_type: "review"
    )
  end

  teardown do
    ReviewIteration.delete_all
    ReviewTask.delete_all
    PullRequest.delete_all
  end

  # Validations
  test "valid with all required fields" do
    assert @iteration.valid?
  end

  test "invalid without iteration_number" do
    @iteration.iteration_number = nil
    refute @iteration.valid?
    assert_includes @iteration.errors[:iteration_number], "can't be blank"
  end

  test "invalid without from_state" do
    @iteration.from_state = nil
    refute @iteration.valid?
    assert_includes @iteration.errors[:from_state], "can't be blank"
  end

  test "invalid without to_state" do
    @iteration.to_state = nil
    refute @iteration.valid?
    assert_includes @iteration.errors[:to_state], "can't be blank"
  end

  test "invalid with invalid cli_client" do
    @iteration.cli_client = "invalid_client"
    refute @iteration.valid?
    assert_includes @iteration.errors[:cli_client], "is not included in the list"
  end

  test "invalid with invalid review_type" do
    @iteration.review_type = "invalid_type"
    refute @iteration.valid?
    assert_includes @iteration.errors[:review_type], "is not included in the list"
  end

  test "valid with all allowed cli_clients" do
    Setting::CLI_CLIENTS.each do |client|
      @iteration.cli_client = client
      assert @iteration.valid?, "CLI client #{client} should be valid"
    end
  end

  test "valid with all allowed review_types" do
    ReviewTask::REVIEW_TYPES.each do |type|
      @iteration.review_type = type
      assert @iteration.valid?, "Review type #{type} should be valid"
    end
  end

  test "iteration_number uniqueness scoped to review_task" do
    @iteration.save!
    duplicate = @iteration.dup

    refute duplicate.valid?
    assert_includes duplicate.errors[:iteration_number], "has already been taken"
  end

  test "iteration_number can be same across different review_tasks" do
    @iteration.save!

    task2 = ReviewTask.create!(
      pull_request: @pr,
      state: "reviewed",
      cli_client: "claude",
      review_type: "review"
    )

    iteration2 = ReviewIteration.new(
      review_task: task2,
      iteration_number: 1,
      from_state: "in_review",
      to_state: "archived",
      cli_client: "claude",
      review_type: "review"
    )

    assert iteration2.valid?
  end

  # Scopes
  test "chronological orders by iteration_number ascending" do
    @iteration.save!
    iteration3 = ReviewIteration.create!(
      review_task: @task,
      iteration_number: 3,
      from_state: "reviewed",
      to_state: "archived",
      cli_client: "claude",
      review_type: "review"
    )
    iteration2 = ReviewIteration.create!(
      review_task: @task,
      iteration_number: 2,
      from_state: "in_review",
      to_state: "archived",
      cli_client: "claude",
      review_type: "review"
    )

    ordered = @task.review_iterations.chronological.to_a
    assert_equal [ @iteration, iteration2, iteration3 ], ordered
  end

  test "reverse_chronological orders by iteration_number descending" do
    @iteration.save!
    iteration2 = ReviewIteration.create!(
      review_task: @task,
      iteration_number: 2,
      from_state: "in_review",
      to_state: "archived",
      cli_client: "claude",
      review_type: "review"
    )
    iteration3 = ReviewIteration.create!(
      review_task: @task,
      iteration_number: 3,
      from_state: "reviewed",
      to_state: "archived",
      cli_client: "claude",
      review_type: "review"
    )

    ordered = @task.review_iterations.reverse_chronological.to_a
    assert_equal [ iteration3, iteration2, @iteration ], ordered
  end

  # Methods
  test "duration_seconds returns nil when started_at is nil" do
    @iteration.started_at = nil
    @iteration.completed_at = Time.current

    assert_nil @iteration.duration_seconds
  end

  test "duration_seconds returns nil when completed_at is nil" do
    @iteration.started_at = 1.hour.ago
    @iteration.completed_at = nil

    assert_nil @iteration.duration_seconds
  end

  test "duration_seconds returns nil when both timestamps are nil" do
    @iteration.started_at = nil
    @iteration.completed_at = nil

    assert_nil @iteration.duration_seconds
  end

  test "duration_seconds returns integer seconds" do
    @iteration.started_at = 5.minutes.ago
    @iteration.completed_at = Time.current

    assert_equal 300, @iteration.duration_seconds
  end

  test "duration_seconds rounds down to seconds" do
    @iteration.started_at = (5.minutes.ago - 1.5.seconds)
    @iteration.completed_at = Time.current

    assert_equal 301, @iteration.duration_seconds
  end

  test "duration_seconds handles short durations" do
    @iteration.started_at = 0.5.seconds.ago
    @iteration.completed_at = Time.current

    assert_equal 0, @iteration.duration_seconds
  end

  test "duration_seconds handles long durations" do
    @iteration.started_at = 2.hours.ago + 30.minutes
    @iteration.completed_at = Time.current

    assert_equal 5400, @iteration.duration_seconds
  end

  test "swarm_review? returns true when review_type is swarm" do
    @iteration.review_type = "swarm"
    assert @iteration.swarm_review?
  end

  test "swarm_review? returns false when review_type is review" do
    @iteration.review_type = "review"
    refute @iteration.swarm_review?
  end
end
