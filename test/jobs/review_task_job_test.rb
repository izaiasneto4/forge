require "test_helper"

class ReviewTaskJobTest < ActiveJob::TestCase
  self.use_transactional_tests = false

  setup do
    ReviewComment.delete_all
    ReviewIteration.delete_all
    AgentLog.delete_all
    ReviewTask.delete_all
    Setting.delete_all
    PullRequest.unscoped.delete_all

    Setting.current_repo = "/tmp/test-repo"
    Setting.default_cli_client = "claude"

    @pull_request = PullRequest.create!(
      github_id: 123,
      number: 123,
      title: "Test PR",
      url: "https://github.com/test/repo/pull/123",
      repo_owner: "test",
      repo_name: "repo",
      review_status: "pending_review"
    )

    @review_task = ReviewTask.create!(
      pull_request: @pull_request,
      state: "pending_review",
      cli_client: "claude",
      review_type: "review"
    )

    @worktree_path = "/tmp/test-worktree"
    @output = "Review output line 1\nReview output line 2"
    @ai_model = "claude-3.5-sonnet"
  end

  teardown do
    Setting.delete_all
    ReviewComment.delete_all
    ReviewIteration.delete_all
    AgentLog.delete_all
    ReviewTask.delete_all
    PullRequest.unscoped.delete_all
  end

  test "happy path: clears logs, builds worktree, starts review, stores model, streams output, validates, completes, creates comments, broadcasts" do
    worktree_path = "/tmp/worktree-pr-123"

    mock_worktree = Class.new do
      def initialize(*)
      end

      def create_for_pr(pr)
        "/tmp/worktree-pr-123"
      end

      def cleanup_worktree(path)
      end
    end.new

    mock_review = Class.new do
      def initialize(*)
      end

      def detect_model
        "claude-3.5-sonnet"
      end

      def run_review_streaming(&block)
        block.call("Review output line 1\n")
        block.call("Review output line 2\n")
      end
    end.new

    WorktreeService.stubs(:new).returns(mock_worktree)
    CodeReviewService.stubs(:for).returns(mock_review)
    ReviewCommentBuilder.stubs(:persist_for_review_task).returns([])
    ActionCable.server.stubs(:broadcast)

    ReviewTaskJob.perform_now(@review_task.id)

    @review_task.reload
    assert_equal "reviewed", @review_task.state
    assert_equal "claude-3.5-sonnet", @review_task.ai_model
    assert_equal 0, @review_task.retry_count
  end

  test "happy path: does not clear logs or reset retry state on retry" do
    @review_task.add_log("Existing log", log_type: "status")
    @review_task.update!(retry_count: 1)

    mock_worktree = Class.new do
      def initialize(*)
      end

      def create_for_pr(pr)
        "/tmp/worktree-pr-123"
      end

      def cleanup_worktree(path)
      end
    end.new

    mock_review = Class.new do
      def initialize(*)
      end

      def detect_model
        "claude-3.5-sonnet"
      end

      def run_review_streaming(&block)
        block.call("Review output\n")
      end
    end.new

    WorktreeService.stubs(:new).returns(mock_worktree)
    CodeReviewService.stubs(:for).returns(mock_review)
    ReviewCommentBuilder.stubs(:persist_for_review_task).returns([])
    ActionCable.server.stubs(:broadcast)

    ReviewTaskJob.perform_now(@review_task.id, is_retry: true)

    @review_task.reload
    # On retry, existing logs should be preserved (not cleared)
    assert @review_task.agent_logs.any? { |log| log.message == "Existing log" }, "Existing log should be preserved"
    assert_equal 1, @review_task.retry_count, "Retry count should be preserved"
  end

  test "happy path: clears logs and resets retry state on initial attempt" do
    @review_task.add_log("Old log", log_type: "status")
    @review_task.increment_retry!("Previous error")

    mock_worktree = Class.new do
      def initialize(*)
      end

      def create_for_pr(pr)
        "/tmp/worktree-pr-123"
      end

      def cleanup_worktree(path)
      end
    end.new

    mock_review = Class.new do
      def initialize(*)
      end

      def detect_model
        "claude-3.5-sonnet"
      end

      def run_review_streaming(&block)
        block.call("Review output\n")
      end
    end.new

    WorktreeService.stubs(:new).returns(mock_worktree)
    CodeReviewService.stubs(:for).returns(mock_review)
    ReviewCommentBuilder.stubs(:persist_for_review_task).returns([])
    ActionCable.server.stubs(:broadcast)

    ReviewTaskJob.perform_now(@review_task.id, is_retry: false)

    @review_task.reload
    refute @review_task.agent_logs.any? { |log| log.message == "Old log" }, "Old logs should be cleared"
    assert_equal 0, @review_task.retry_count, "Retry count should be reset to 0"
    assert_nil @review_task.failure_reason, "Failure reason should be cleared"
    assert_equal "reviewed", @review_task.state, "Task should be in reviewed state"
  end

  test "validation error: raises ValidationError for blank output" do
    mock_worktree = Class.new do
      def initialize(*)
      end

      def create_for_pr(pr)
        "/tmp/worktree-pr-123"
      end

      def cleanup_worktree(path)
      end
    end.new

    mock_review = Class.new do
      def initialize(*)
      end

      def detect_model
        "claude-3.5-sonnet"
      end

      def run_review_streaming(&block)
        block.call("")
        block.call("")
      end
    end.new

    WorktreeService.stubs(:new).returns(mock_worktree)
    CodeReviewService.stubs(:for).returns(mock_review)
    ActionCable.server.stubs(:broadcast)

    ReviewTaskJob.perform_now(@review_task.id)

    @review_task.reload
    assert_equal "failed_review", @review_task.state
    assert_match /empty output/, @review_task.failure_reason
  end

  test "validation error: classifies truncated error output with Error classifier" do
    mock_worktree = Class.new do
      def initialize(*)
      end

      def create_for_pr(pr)
        "/tmp/worktree-pr-123"
      end

      def cleanup_worktree(path)
      end
    end.new

    mock_review = Class.new do
      def initialize(*)
      end

      def detect_model
        "claude-3.5-sonnet"
      end

      def run_review_streaming(&block)
        block.call("Error:")
        block.call("Error:")
        block.call("Error:")
        block.call("Error:")
      end
    end.new

    WorktreeService.stubs(:new).returns(mock_worktree)
    CodeReviewService.stubs(:for).returns(mock_review)
    ActionCable.server.stubs(:broadcast)

    ReviewTaskJob.perform_now(@review_task.id)

    @review_task.reload
    assert_equal "failed_review", @review_task.state
  end

  test "transient error: WorktreeService::NetworkError schedules retry" do
    mock_worktree = Class.new do
      def initialize(*)
      end

      def create_for_pr(pr)
        raise WorktreeService::NetworkError, "Network failure"
      end

      def cleanup_worktree(path)
      end
    end.new

    mock_review = Class.new do
      def initialize(*)
      end

      def detect_model
        "claude-3.5-sonnet"
      end

      def run_review_streaming(&block)
        raise ReviewErrors::NetworkError, "Rate limited"
      end
    end.new

    WorktreeService.stubs(:new).returns(mock_worktree)
    CodeReviewService.stubs(:for).returns(mock_review)
    ActionCable.server.stubs(:broadcast)

    ReviewTaskJob.perform_now(@review_task.id)

    @review_task.reload
    assert_equal 1, @review_task.retry_count
  end

  test "transient error: ReviewErrors::TransientError schedules retry" do
    mock_worktree = Class.new do
      def initialize(*)
      end

      def create_for_pr(pr)
        "/tmp/worktree-pr-123"
      end

      def cleanup_worktree(path)
      end
    end.new

    mock_review = Class.new do
      def initialize(*)
      end

      def detect_model
        "claude-3.5-sonnet"
      end

      def run_review_streaming(&block)
        raise ReviewErrors::NetworkError, "Rate limited"
      end
    end.new

    WorktreeService.stubs(:new).returns(mock_worktree)
    CodeReviewService.stubs(:for).returns(mock_review)
    ActionCable.server.stubs(:broadcast)

    ReviewTaskJob.perform_now(@review_task.id)

    @review_task.reload
    assert_equal 1, @review_task.retry_count
  end

  test "transient error: marks failed when max retries exhausted" do
    @review_task.update!(retry_count: 3)

    mock_worktree = Class.new do
      def initialize(*)
      end

      def create_for_pr(pr)
        raise WorktreeService::NetworkError, "Network failure"
      end

      def cleanup_worktree(path)
      end
    end.new

    WorktreeService.stubs(:new).returns(mock_worktree)
    ActionCable.server.stubs(:broadcast)

    ReviewTaskJob.perform_now(@review_task.id)

    @review_task.reload
    assert_equal "failed_review", @review_task.state
    assert_equal 3, @review_task.retry_count
  end

  test "permanent error: marks failed immediately" do
    mock_worktree = Class.new do
      def initialize(*)
      end

      def create_for_pr(pr)
        "/tmp/worktree-pr-123"
      end

      def cleanup_worktree(path)
      end
    end.new

    mock_review = Class.new do
      def initialize(*)
      end

      def detect_model
        "claude-3.5-sonnet"
      end

      def run_review_streaming(&block)
        raise ReviewErrors::AuthenticationError, "Bad credentials"
      end
    end.new

    WorktreeService.stubs(:new).returns(mock_worktree)
    CodeReviewService.stubs(:for).returns(mock_review)
    ActionCable.server.stubs(:broadcast)

    ReviewTaskJob.perform_now(@review_task.id)

    @review_task.reload
    assert_equal "failed_review", @review_task.state
    assert_equal 0, @review_task.retry_count
  end

  test "unknown error: marks failed when retries exhausted for retryable error" do
    @review_task.update!(retry_count: 3)

    mock_worktree = Class.new do
      def initialize(*)
      end

      def create_for_pr(pr)
        "/tmp/worktree-pr-123"
      end

      def cleanup_worktree(path)
      end
    end.new

    mock_review = Class.new do
      def initialize(*)
      end

      def detect_model
        "claude-3.5-sonnet"
      end

      def run_review_streaming(&block)
        raise StandardError, "Unknown error"
      end
    end.new

    WorktreeService.stubs(:new).returns(mock_worktree)
    CodeReviewService.stubs(:for).returns(mock_review)
    ActionCable.server.stubs(:broadcast)

    ReviewTaskJob.perform_now(@review_task.id)

    @review_task.reload
    assert_equal "failed_review", @review_task.state
  end

  test "unknown error: marks failed immediately for non-retryable error" do
    mock_worktree = Class.new do
      def initialize(*)
      end

      def create_for_pr(pr)
        "/tmp/worktree-pr-123"
      end

      def cleanup_worktree(path)
      end
    end.new

    mock_review = Class.new do
      def initialize(*)
      end

      def detect_model
        "claude-3.5-sonnet"
      end

      def run_review_streaming(&block)
        raise ArgumentError, "Invalid argument"
      end
    end.new

    WorktreeService.stubs(:new).returns(mock_worktree)
    CodeReviewService.stubs(:for).returns(mock_review)
    ActionCable.server.stubs(:broadcast)

    ReviewTaskJob.perform_now(@review_task.id)

    @review_task.reload
    assert_equal "failed_review", @review_task.state
  end

  test "ensure block: cleans up worktree when worktree_path present" do
    mock_worktree = Class.new do
      def initialize(*)
      end

      def create_for_pr(pr)
        "/tmp/worktree-pr-123"
      end

      def cleanup_worktree(path)
        @cleanup_called = true
      end

      attr_accessor :cleanup_called
    end.new

    mock_review = Class.new do
      def initialize(*)
      end

      def detect_model
        "claude-3.5-sonnet"
      end

      def run_review_streaming(&block)
        block.call("Review output\n")
      end
    end.new

    WorktreeService.stubs(:new).returns(mock_worktree)
    CodeReviewService.stubs(:for).returns(mock_review)
    ReviewCommentBuilder.stubs(:persist_for_review_task).returns([])
    ActionCable.server.stubs(:broadcast)

    ReviewTaskJob.perform_now(@review_task.id)

    assert mock_worktree.cleanup_called, "Worktree cleanup should be called"
  end

  test "ensure block: does not clean up worktree when worktree_path is nil" do
    mock_worktree = Class.new do
      def initialize(*)
      end

      def create_for_pr(pr)
        raise "Should not reach here"
      end

      def cleanup_worktree(path)
        raise "Should not be called"
      end
    end.new

    Setting.stubs(:current_repo).returns(nil)

    ReviewTaskJob.perform_now(@review_task.id)

    @review_task.reload
    assert_equal "pending_review", @review_task.state
  end

  test "ensure block: cleans up worktree even when error occurs" do
    mock_worktree = Class.new do
      def initialize(*)
      end

      def create_for_pr(pr)
        "/tmp/worktree-pr-123"
      end

      def cleanup_worktree(path)
        @cleanup_called = true
      end

      attr_accessor :cleanup_called
    end.new

    mock_review = Class.new do
      def initialize(*)
      end

      def detect_model
        "claude-3.5-sonnet"
      end

      def run_review_streaming(&block)
        raise StandardError, "Test error"
      end
    end.new

    WorktreeService.stubs(:new).returns(mock_worktree)
    CodeReviewService.stubs(:for).returns(mock_review)
    ActionCable.server.stubs(:broadcast)

    ReviewTaskJob.perform_now(@review_task.id)

    assert mock_worktree.cleanup_called, "Worktree cleanup should be called even on error"
  end

  test "broadcasts preparing at start" do
    mock_worktree = Class.new do
      def initialize(*)
      end

      def create_for_pr(pr)
        "/tmp/worktree-pr-123"
      end

      def cleanup_worktree(path)
      end
    end.new

    mock_review = Class.new do
      def initialize(*)
      end

      def detect_model
        "claude-3.5-sonnet"
      end

      def run_review_streaming(&block)
        block.call("Review output\n")
      end
    end.new

    broadcasts = []
    WorktreeService.stubs(:new).returns(mock_worktree)
    CodeReviewService.stubs(:for).returns(mock_review)
    ReviewCommentBuilder.stubs(:persist_for_review_task).returns([])
    ActionCable.server.stubs(:broadcast).with do |channel, data|
      broadcasts << { channel:, data: }
    end

    ReviewTaskJob.perform_now(@review_task.id)

    preparing_call = broadcasts.find { |b| b[:data][:type] == "preparing" }
    assert preparing_call, "Should broadcast preparing event"
  end

  test "broadcasts completion on success" do
    mock_worktree = Class.new do
      def initialize(*)
      end

      def create_for_pr(pr)
        "/tmp/worktree-pr-123"
      end

      def cleanup_worktree(path)
      end
    end.new

    mock_review = Class.new do
      def initialize(*)
      end

      def detect_model
        "claude-3.5-sonnet"
      end

      def run_review_streaming(&block)
        block.call("Review output\n")
      end
    end.new

    broadcasts = []
    WorktreeService.stubs(:new).returns(mock_worktree)
    CodeReviewService.stubs(:for).returns(mock_review)
    ReviewCommentBuilder.stubs(:persist_for_review_task).returns([])

    ActionCable.server.stubs(:broadcast).with do |channel, data|
      broadcasts << { channel: channel, data: data.dup }
      true  # Return true so stub matches
    end

    ReviewTaskJob.perform_now(@review_task.id)

    completed_call = broadcasts.find { |c| c[:data].is_a?(Hash) && c[:data][:type] == "completed" }
    assert completed_call, "Should broadcast completed event"
    assert_equal "reviewed", completed_call[:data][:state]
  end

  test "broadcasts retry scheduled with backoff info" do
    broadcasts = []

    mock_worktree = Class.new do
      def initialize(*)
      end

      def create_for_pr(pr)
        raise WorktreeService::NetworkError, "Network failure"
      end

      def cleanup_worktree(path)
      end
    end.new

    WorktreeService.stubs(:new).returns(mock_worktree)
    ActionCable.server.stubs(:broadcast).with do |channel, data|
      broadcasts << { channel:, data: }
    end

    ReviewTaskJob.perform_now(@review_task.id)

    retry_call = broadcasts.find { |b| b[:data][:type] == "retry_scheduled" }
    assert retry_call, "Should broadcast retry_scheduled event"
    assert_equal 1, retry_call[:data][:retry_count]
    assert_equal ReviewTask::MAX_RETRY_ATTEMPTS, retry_call[:data][:max_retries]
    assert retry_call[:data].key?(:backoff_seconds)
  end

  test "creates and logs review comments" do
    mock_worktree = Class.new do
      def initialize(*)
      end

      def create_for_pr(pr)
        "/tmp/worktree-pr-123"
      end

      def cleanup_worktree(path)
      end
    end.new

    mock_review = Class.new do
      def initialize(*)
      end

      def detect_model
        "claude-3.5-sonnet"
      end

      def run_review_streaming(&block)
        block.call("Review output\n")
      end
    end.new

    WorktreeService.stubs(:new).returns(mock_worktree)
    CodeReviewService.stubs(:for).returns(mock_review)
    ActionCable.server.stubs(:broadcast)

    persist_called = false
    ReviewCommentBuilder.stubs(:persist_for_review_task).with do |task|
      persist_called = true
      task.review_comments.create!(
        file_path: "test.rb",
        body: "Test comment",
        severity: "minor",
        status: "pending"
      )
      true
    end

    ReviewTaskJob.perform_now(@review_task.id)

    assert persist_called, "ReviewCommentBuilder.persist_for_review_task should be called"
    @review_task.reload
    assert_equal 1, @review_task.review_comments.count
  end

  test "logs model detection when not unknown" do
    mock_worktree = Class.new do
      def initialize(*)
      end

      def create_for_pr(pr)
        "/tmp/worktree-pr-123"
      end

      def cleanup_worktree(path)
      end
    end.new

    mock_review = Class.new do
      def initialize(*)
      end

      def detect_model
        "claude-3.5-sonnet"
      end

      def run_review_streaming(&block)
        block.call("Review output\n")
      end
    end.new

    WorktreeService.stubs(:new).returns(mock_worktree)
    CodeReviewService.stubs(:for).returns(mock_review)
    ReviewCommentBuilder.stubs(:persist_for_review_task).returns([])
    ActionCable.server.stubs(:broadcast)

    ReviewTaskJob.perform_now(@review_task.id)

    @review_task.reload
    model_log = @review_task.agent_logs.find { |log| log.message.include?("Using model:") }
    assert model_log, "Should log model when known"
  end

  test "logs model detection when unknown" do
    mock_worktree = Class.new do
      def initialize(*)
      end

      def create_for_pr(pr)
        "/tmp/worktree-pr-123"
      end

      def cleanup_worktree(path)
      end
    end.new

    mock_review = Class.new do
      def initialize(*)
      end

      def detect_model
        "unknown"
      end

      def run_review_streaming(&block)
        block.call("Review output\n")
      end
    end.new

    WorktreeService.stubs(:new).returns(mock_worktree)
    CodeReviewService.stubs(:for).returns(mock_review)
    ReviewCommentBuilder.stubs(:persist_for_review_task).returns([])
    ActionCable.server.stubs(:broadcast)

    ReviewTaskJob.perform_now(@review_task.id)

    @review_task.reload
    model_log = @review_task.agent_logs.find { |log| log.message.include?("Using model:") }
    refute model_log, "Should not log model when unknown"
  end

  test "returns early when repo path is blank" do
    Setting.stubs(:current_repo).returns(nil)

    mock_worktree = Class.new do
      def initialize(*)
      end

      def create_for_pr(pr)
        raise "Should not be called"
      end

      def cleanup_worktree(path)
      end
    end.new

    WorktreeService.stubs(:new).returns(mock_worktree)
    ActionCable.server.stubs(:broadcast)

    ReviewTaskJob.perform_now(@review_task.id)

    @review_task.reload
    assert_equal "pending_review", @review_task.state
  end

  test "logs retry info on retry attempt" do
    @review_task.update!(retry_count: 1)

    mock_worktree = Class.new do
      def initialize(*)
      end

      def create_for_pr(pr)
        "/tmp/worktree-pr-123"
      end

      def cleanup_worktree(path)
      end
    end.new

    mock_review = Class.new do
      def initialize(*)
      end

      def detect_model
        "claude-3.5-sonnet"
      end

      def run_review_streaming(&block)
        block.call("Review output\n")
      end
    end.new

    WorktreeService.stubs(:new).returns(mock_worktree)
    CodeReviewService.stubs(:for).returns(mock_review)
    ReviewCommentBuilder.stubs(:persist_for_review_task).returns([])
    ActionCable.server.stubs(:broadcast)

    ReviewTaskJob.perform_now(@review_task.id, is_retry: true)

    @review_task.reload
    retry_log = @review_task.agent_logs.find { |log| log.message.include?("Retry attempt") }
    assert retry_log, "Should log retry attempt"
  end

  test "logs starting info on initial attempt" do
    mock_worktree = Class.new do
      def initialize(*)
      end

      def create_for_pr(pr)
        "/tmp/worktree-pr-123"
      end

      def cleanup_worktree(path)
      end
    end.new

    mock_review = Class.new do
      def initialize(*)
      end

      def detect_model
        "claude-3.5-sonnet"
      end

      def run_review_streaming(&block)
        block.call("Review output\n")
      end
    end.new

    WorktreeService.stubs(:new).returns(mock_worktree)
    CodeReviewService.stubs(:for).returns(mock_review)
    ReviewCommentBuilder.stubs(:persist_for_review_task).returns([])
    ActionCable.server.stubs(:broadcast)

    ReviewTaskJob.perform_now(@review_task.id, is_retry: false)

    @review_task.reload
    starting_log = @review_task.agent_logs.find { |log| log.message.include?("Starting review") }
    assert starting_log, "Should log starting info"
  end
end
