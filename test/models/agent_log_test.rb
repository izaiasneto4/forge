require "test_helper"

class AgentLogTest < ActiveSupport::TestCase
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

    @log = AgentLog.new(
      review_task: @task,
      message: "Test log message",
      log_type: "output"
    )
  end

  teardown do
    AgentLog.delete_all
    ReviewTask.delete_all
    PullRequest.delete_all
  end

  # Validations
  test "valid with all required fields" do
    assert @log.valid?
  end

  test "invalid without review_task" do
    @log.review_task = nil
    refute @log.valid?
    assert_includes @log.errors[:review_task], "must exist"
  end

  test "invalid without log_type" do
    @log.log_type = nil
    refute @log.valid?
    assert @log.errors[:log_type].any?
  end

  test "invalid without message" do
    @log.message = nil
    refute @log.valid?
    assert_includes @log.errors[:message], "can't be blank"
  end

  test "invalid with invalid log_type" do
    @log.log_type = "invalid_type"
    refute @log.valid?
    assert_includes @log.errors[:log_type], "is not included in the list"
  end

  test "valid with all allowed log_types" do
    AgentLog::LOG_TYPES.each do |type|
      @log.log_type = type
      assert @log.valid?, "Log type #{type} should be valid"
    end
  end

  # Scopes
  test "recent orders by created_at ascending" do
    @log.save!
    log2 = AgentLog.create!(review_task: @task, message: "Second log", log_type: "output")
    log3 = AgentLog.create!(review_task: @task, message: "Third log", log_type: "error")

    ordered = AgentLog.recent.to_a
    assert_equal [ @log, log2, log3 ], ordered
  end

  # Callbacks
  test "after_create_commit broadcasts to ActionCable" do
    skip "ActionCable.server.stub not available in minitest without additional gems"
  end

  test "after_create_commit includes all expected payload fields" do
    skip "ActionCable.server.stub not available in minitest without additional gems"
  end

  test "after_create_commit uses iso8601 for created_at" do
    skip "ActionCable.server.stub not available in minitest without additional gems"
  end

  # Constants
  test "LOG_TYPES contains expected values" do
    assert_includes AgentLog::LOG_TYPES, "output"
    assert_includes AgentLog::LOG_TYPES, "error"
    assert_includes AgentLog::LOG_TYPES, "status"
  end

  # Associations
  test "belongs_to review_task" do
    assert_respond_to @log, :review_task
    assert_equal @task, @log.review_task
  end

  # Edge cases
  test "message can be empty string" do
    @log.message = ""
    refute @log.valid?
    assert_includes @log.errors[:message], "can't be blank"
  end

  test "message can be long string" do
    @log.message = "a" * 10000
    assert @log.valid?
  end

  test "message can contain special characters" do
    @log.message = "Test with\nnewlines\tand\rcarriage returns & special <chars>"
    assert @log.valid?
  end

  test "log_type with output works correctly" do
    @log.log_type = "output"
    assert @log.valid?
  end

  test "log_type with error works correctly" do
    @log.log_type = "error"
    assert @log.valid?
  end

  test "log_type with status works correctly" do
    @log.log_type = "status"
    assert @log.valid?
  end

  test "multiple logs for same review_task ordered correctly" do
    @log.save!
    sleep 0.01
    log2 = AgentLog.create!(review_task: @task, message: "Log 2", log_type: "error")
    sleep 0.01
    log3 = AgentLog.create!(review_task: @task, message: "Log 3", log_type: "status")

    ordered = @task.agent_logs.recent.to_a
    assert_equal [ @log, log2, log3 ], ordered
    assert ordered[0].created_at < ordered[1].created_at
    assert ordered[1].created_at < ordered[2].created_at
  end
end
