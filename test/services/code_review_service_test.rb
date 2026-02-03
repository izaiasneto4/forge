require "test_helper"

class CodeReviewServiceTest < ActiveSupport::TestCase
  setup do
    @worktree_path = Dir.mktmpdir
    @pr = PullRequest.new(
      github_id: 12345,
      number: 42,
      title: "Test PR Title",
      description: "Test PR description",
      url: "https://github.com/test/repo/pull/42",
      repo_owner: "test",
      repo_name: "repo",
      review_status: "pending_review"
    )
  end

  teardown do
    FileUtils.rm_rf(@worktree_path) if Dir.exist?(@worktree_path)
  end

  # .for tests
  test ".for creates service with claude client config" do
    service = CodeReviewService.for(
      cli_client: "claude",
      worktree_path: @worktree_path,
      pull_request: @pr
    )

    assert_equal "claude", service.cli_client
    assert_equal "claude", service.instance_variable_get(:@command)
    assert_equal [ "-p" ], service.instance_variable_get(:@args)
    assert_equal "/code-review", service.instance_variable_get(:@skill)
  end

  test ".for creates service with codex client config" do
    service = CodeReviewService.for(
      cli_client: "codex",
      worktree_path: @worktree_path,
      pull_request: @pr
    )

    assert_equal "codex", service.cli_client
    assert_equal "codex", service.instance_variable_get(:@command)
    assert_equal [ "exec" ], service.instance_variable_get(:@args)
    assert_nil service.instance_variable_get(:@skill)
  end

  test ".for creates service with opencode client config" do
    service = CodeReviewService.for(
      cli_client: "opencode",
      worktree_path: @worktree_path,
      pull_request: @pr
    )

    assert_equal "opencode", service.cli_client
    assert_equal "opencode", service.instance_variable_get(:@command)
    assert_equal [ "run" ], service.instance_variable_get(:@args)
    assert_nil service.instance_variable_get(:@skill)
  end

  test ".for defaults to claude for unknown client" do
    service = CodeReviewService.for(
      cli_client: "unknown",
      worktree_path: @worktree_path,
      pull_request: @pr
    )

    assert_equal "claude", service.instance_variable_get(:@command)
  end

  test ".for accepts custom review_type" do
    service = CodeReviewService.for(
      cli_client: "claude",
      worktree_path: @worktree_path,
      pull_request: @pr,
      review_type: "swarm"
    )

    assert_equal "swarm", service.instance_variable_get(:@review_type)
  end

  # detect_model tests
  test "detect_model delegates to ModelDetector" do
    skip "ModelDetector.stub not available in minitest without additional gems"
  end

  # run_review tests
  test "run_review raises Error when worktree does not exist" do
    non_existent_path = "/nonexistent/path"
    service = CodeReviewService.for(
      cli_client: "claude",
      worktree_path: non_existent_path,
      pull_request: @pr
    )

    assert_raises(CodeReviewService::Error) do
      service.run_review
    end
  end

  # review_prompt tests (private)
  test "review_prompt uses standard review prompt for review type" do
    service = CodeReviewService.for(
      cli_client: "claude",
      worktree_path: @worktree_path,
      pull_request: @pr
    )
    prompt = service.send(:review_prompt)

    assert_includes prompt, "Review PR ##{@pr.number}"
    assert_includes prompt, @pr.title
    assert_includes prompt, @pr.description
    assert_includes prompt, "SCOPE CONSTRAINT"
    assert_includes prompt, "ONLY review code that was actually changed"
  end

  test "review_prompt includes skill instruction for claude" do
    service = CodeReviewService.for(
      cli_client: "claude",
      worktree_path: @worktree_path,
      pull_request: @pr
    )
    prompt = service.send(:review_prompt)

    assert_includes prompt, "Run /code-review to analyze"
  end

  test "review_prompt uses swarm review prompt for swarm type" do
    service = CodeReviewService.for(
      cli_client: "claude",
      worktree_path: @worktree_path,
      pull_request: @pr,
      review_type: "swarm"
    )

    prompt = service.send(:review_prompt)

    assert_includes prompt, "Deep Code Review - Multi-Agent Analysis"
    assert_includes prompt, "7 specialized reviewer agents"
    assert_includes prompt, "Security Reviewer"
    assert_includes prompt, "Data Consistency Reviewer"
    assert_includes prompt, "Code Smell Reviewer"
    assert_includes prompt, "Design Pattern Reviewer"
    assert_includes prompt, "Performance Reviewer"
    assert_includes prompt, "Maintainability Reviewer"
    assert_includes prompt, "Regression Reviewer"
    assert_includes prompt, "DEEP_REVIEW_REPORT.md"
  end

  test "standard_review_prompt includes PR information" do
    service = CodeReviewService.for(
      cli_client: "claude",
      worktree_path: @worktree_path,
      pull_request: @pr
    )
    prompt = service.send(:standard_review_prompt)

    assert_includes prompt, "PR ##{@pr.number}: #{@pr.title}"
    assert_includes prompt, @pr.description
  end

  test "standard_review_prompt includes scope constraints" do
    service = CodeReviewService.for(
      cli_client: "claude",
      worktree_path: @worktree_path,
      pull_request: @pr
    )
    prompt = service.send(:standard_review_prompt)

    assert_includes prompt, "IMPORTANT SCOPE CONSTRAINT"
    assert_includes prompt, "Use `gh pr diff` or `git diff`"
    assert_includes prompt, "Do NOT review or comment on files that weren't modified"
    assert_includes prompt, "Only flag issues on lines that were added or modified"
  end

  test "standard_review_prompt includes review focus areas" do
    service = CodeReviewService.for(
      cli_client: "claude",
      worktree_path: @worktree_path,
      pull_request: @pr
    )
    prompt = service.send(:standard_review_prompt)

    assert_includes prompt, "Code quality and best practices"
    assert_includes prompt, "Potential bugs or issues"
    assert_includes prompt, "Security concerns"
    assert_includes prompt, "Performance implications"
  end

  test "standard_review_prompt includes JSON output format" do
    service = CodeReviewService.for(
      cli_client: "claude",
      worktree_path: @worktree_path,
      pull_request: @pr
    )
    prompt = service.send(:standard_review_prompt)

    assert_includes prompt, "JSON array wrapped in ```json"
    assert_includes prompt, '"severity": "error" | "warning" | "info"'
    assert_includes prompt, '"file": "path/to/file.ext"'
    assert_includes prompt, '"lines": "10-20" or "10" or null'
    assert_includes prompt, '"comment": "Description of the issue in markdown"'
    assert_includes prompt, '"suggested_fix": "Code suggestion if applicable, or null"'
  end

  test "standard_review_prompt includes empty array example" do
    service = CodeReviewService.for(
      cli_client: "claude",
      worktree_path: @worktree_path,
      pull_request: @pr
    )
    prompt = service.send(:standard_review_prompt)

    assert_includes prompt, "If no issues found, return an empty array"
  end

  test "swarm_review_prompt includes all 7 reviewers" do
    service = CodeReviewService.for(
      cli_client: "claude",
      worktree_path: @worktree_path,
      pull_request: @pr,
      review_type: "swarm"
    )

    prompt = service.send(:swarm_review_prompt)

    assert_includes prompt, "Security Reviewer"
    assert_includes prompt, "Data Consistency Reviewer"
    assert_includes prompt, "Code Smell Reviewer"
    assert_includes prompt, "Design Pattern Reviewer"
    assert_includes prompt, "Performance Reviewer"
    assert_includes prompt, "Maintainability Reviewer"
    assert_includes prompt, "Regression Reviewer"
  end

  test "swarm_review_prompt includes consensus rules" do
    service = CodeReviewService.for(
      cli_client: "claude",
      worktree_path: @worktree_path,
      pull_request: @pr,
      review_type: "swarm"
    )

    prompt = service.send(:swarm_review_prompt)

    assert_includes prompt, "Consensus Rules"
    assert_includes prompt, "CRITICAL"
    assert_includes prompt, "HIGH"
    assert_includes prompt, "MEDIUM"
    assert_includes prompt, "LOW"
  end

  test "swarm_review_prompt includes report structure" do
    service = CodeReviewService.for(
      cli_client: "claude",
      worktree_path: @worktree_path,
      pull_request: @pr,
      review_type: "swarm"
    )

    prompt = service.send(:swarm_review_prompt)

    assert_includes prompt, "DEEP_REVIEW_REPORT.md"
    assert_includes prompt, "Executive Summary"
    assert_includes prompt, "Critical Issues"
    assert_includes prompt, "High Priority Issues"
    assert_includes prompt, "Medium Priority Issues"
    assert_includes prompt, "Low Priority Issues"
    assert_includes prompt, "Implementation Checklist"
    assert_includes prompt, "Reviewer Agreement Matrix"
  end

  test "swarm_review_prompt includes implementation instructions" do
    service = CodeReviewService.for(
      cli_client: "claude",
      worktree_path: @worktree_path,
      pull_request: @pr,
      review_type: "swarm"
    )

    prompt = service.send(:swarm_review_prompt)

    assert_includes prompt, "Implementation Instructions"
    assert_includes prompt, "Step-by-step instructions"
  end

  test "swarm_review_prompt includes notes for implementation agent" do
    service = CodeReviewService.for(
      cli_client: "claude",
      worktree_path: @worktree_path,
      pull_request: @pr,
      review_type: "swarm"
    )

    prompt = service.send(:swarm_review_prompt)

    assert_includes prompt, "Notes for Implementation Agent"
    assert_includes prompt, "Start with CRITICAL issues"
    assert_includes prompt, "Group related fixes"
  end
end
