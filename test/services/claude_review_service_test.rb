require "test_helper"

class ClaudeReviewServiceTest < ActiveSupport::TestCase
  setup do
    @worktree_path = "/tmp/test-worktree"
    @pull_request = PullRequest.new(
      github_id: 123,
      number: 456,
      title: "Test PR",
      description: "Test description",
      url: "https://github.com/test/repo/pull/456",
      repo_owner: "test",
      repo_name: "repo",
      review_status: "pending_review"
    )
  end

  test "delegates to CodeReviewService.for with cli_client: 'claude'" do
    service = ClaudeReviewService.new(
      worktree_path: @worktree_path,
      pull_request: @pull_request
    )

    internal_service = service.instance_variable_get(:@service)
    assert_kind_of CodeReviewService, internal_service
  end

  test "run_review delegates to CodeReviewService" do
    run_review_called = false

    internal_service_mock = Class.new do
      define_method(:run_review) do
        run_review_called = true
        "review output"
      end
    end.new

    service = ClaudeReviewService.new(
      worktree_path: @worktree_path,
      pull_request: @pull_request
    )

    service.instance_variable_set(:@service, internal_service_mock)
    result = service.run_review

    assert run_review_called
    assert_equal "review output", result
  end

  test "run_review_streaming delegates to CodeReviewService" do
    block_called = false
    collected_lines = []

    internal_service_mock = Class.new do
      define_method(:run_review_streaming) do |&block|
        block.call("line 1")
        block.call("line 2")
        block.call("line 3")
        block_called = true
      end
    end.new

    service = ClaudeReviewService.new(
      worktree_path: @worktree_path,
      pull_request: @pull_request
    )

    service.instance_variable_set(:@service, internal_service_mock)
    service.run_review_streaming do |line|
      collected_lines << line
    end

    assert block_called
    assert_equal [ "line 1", "line 2", "line 3" ], collected_lines
  end

  test "run_review_streaming works without block" do
    run_review_streaming_called = false

    internal_service_mock = Class.new do
      define_method(:run_review_streaming) do
        run_review_streaming_called = true
        nil
      end
    end.new

    service = ClaudeReviewService.new(
      worktree_path: @worktree_path,
      pull_request: @pull_request
    )

    service.instance_variable_set(:@service, internal_service_mock)
    service.run_review_streaming
    assert run_review_streaming_called
  end

  test "Error is aliased from CodeReviewService::Error" do
    assert_equal CodeReviewService::Error, ClaudeReviewService::Error
  end

  test "initializes with required parameters" do
    service = ClaudeReviewService.new(
      worktree_path: @worktree_path,
      pull_request: @pull_request
    )

    internal_service = service.instance_variable_get(:@service)
    assert_kind_of CodeReviewService, internal_service
  end

  test "multiple calls to run_review use same service instance" do
    call_count = 0

    internal_service_mock = Class.new do
      define_method(:run_review) do
        call_count += 1
        "output"
      end
    end.new

    service = ClaudeReviewService.new(
      worktree_path: @worktree_path,
      pull_request: @pull_request
    )

    service.instance_variable_set(:@service, internal_service_mock)
    service.run_review
    service.run_review
    assert_equal 2, call_count
  end

  test "multiple calls to run_review_streaming use same service instance" do
    call_count = 0

    internal_service_mock = Class.new do
      define_method(:run_review_streaming) do |&block|
        call_count += 1
        block.call if block
      end
    end.new

    service = ClaudeReviewService.new(
      worktree_path: @worktree_path,
      pull_request: @pull_request
    )

    service.instance_variable_set(:@service, internal_service_mock)
    service.run_review_streaming
    service.run_review_streaming
    assert_equal 2, call_count
  end
end
