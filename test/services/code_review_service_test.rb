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
    ModelDetector.expects(:detect).with("claude").returns("claude-3.7-sonnet")

    service = CodeReviewService.for(
      cli_client: "claude",
      worktree_path: @worktree_path,
      pull_request: @pr
    )

    assert_equal "claude-3.7-sonnet", service.detect_model
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

  test "run_review returns normalized output when command succeeds" do
    service = CodeReviewService.for(
      cli_client: "claude",
      worktree_path: @worktree_path,
      pull_request: @pr
    )
    stdin = stub(close: true)
    stdout = stub(read: "review output")
    stderr = stub(read: "")
    wait_thr = stub(value: stub(success?: true))

    Open3.expects(:popen3).with(*service.send(:cmd_args_for_review), chdir: @worktree_path)
      .returns([stdin, stdout, stderr, wait_thr])

    assert_equal "review output", service.run_review
  end

  test "run_review returns output when command fails but output is present" do
    service = CodeReviewService.for(
      cli_client: "claude",
      worktree_path: @worktree_path,
      pull_request: @pr
    )
    stdin = stub(close: true)
    stdout = stub(read: "partial output")
    stderr = stub(read: "stderr")
    wait_thr = stub(value: stub(success?: false))

    Open3.expects(:popen3).with(*service.send(:cmd_args_for_review), chdir: @worktree_path)
      .returns([stdin, stdout, stderr, wait_thr])
    Rails.logger.expects(:error).with("claude review error: stderr")

    assert_equal "partial output", service.run_review
  end

  test "run_review raises Error when command fails with blank output" do
    service = CodeReviewService.for(
      cli_client: "claude",
      worktree_path: @worktree_path,
      pull_request: @pr
    )
    stdin = stub(close: true)
    stdout = stub(read: "")
    stderr = stub(read: "stderr")
    wait_thr = stub(value: stub(success?: false))

    Open3.expects(:popen3).with(*service.send(:cmd_args_for_review), chdir: @worktree_path)
      .returns([stdin, stdout, stderr, wait_thr])
    Rails.logger.expects(:error).with("claude review error: stderr")

    error = assert_raises(CodeReviewService::Error) do
      service.run_review
    end

    assert_equal "claude review failed: stderr", error.message
  end

  test "run_review_streaming yields each line and returns normalized output" do
    service = CodeReviewService.for(
      cli_client: "claude",
      worktree_path: @worktree_path,
      pull_request: @pr
    )
    stdin = stub(close: true)
    stdout_err = Class.new do
      def each_line
        yield "line 1\n"
        yield "line 2\n"
      end
    end.new
    wait_thr = stub(value: stub(success?: true))
    yielded = []

    Open3.expects(:popen2e).with(*service.send(:cmd_args_for_review), chdir: @worktree_path)
      .yields(stdin, stdout_err, wait_thr)

    result = service.run_review_streaming { |line| yielded << line }

    assert_equal [ "line 1\n", "line 2\n" ], yielded
    assert_equal "line 1\nline 2\n", result
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
    assert_includes prompt, "JSON array wrapped in ```json"
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
    assert_includes prompt, '"comment": "Detailed description of the issue in markdown"'
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

    assert_includes prompt, "JSON array wrapped in ```json"
    assert_includes prompt, '"severity": "error" | "warning" | "info"'
    assert_includes prompt, '"file": "path/to/file.ext"'
    assert_includes prompt, '"lines": "10-20" or "10" or null'
    assert_includes prompt, '"comment": "Detailed description of the issue in markdown"'
    assert_includes prompt, '"suggested_fix": "Code suggestion if applicable, or null"'
  end

  test "swarm_review_prompt includes implementation instructions" do
    service = CodeReviewService.for(
      cli_client: "claude",
      worktree_path: @worktree_path,
      pull_request: @pr,
      review_type: "swarm"
    )

    prompt = service.send(:swarm_review_prompt)

    assert_includes prompt, "Consensus Rules"
    assert_includes prompt, "Merge similar issues across reviewers"
  end

  test "codex command args include output-last-message flag" do
    service = CodeReviewService.for(
      cli_client: "codex",
      worktree_path: @worktree_path,
      pull_request: @pr
    )

    cmd_args = service.send(:cmd_args_for_review)

    assert_includes cmd_args, "--output-last-message"
    assert_includes cmd_args, service.send(:codex_last_message_path)
  end

  test "non-codex command args omit output-last-message flag" do
    service = CodeReviewService.for(
      cli_client: "claude",
      worktree_path: @worktree_path,
      pull_request: @pr
    )

    refute_includes service.send(:cmd_args_for_review), "--output-last-message"
  end

  test "clear_codex_last_message! deletes existing file for codex" do
    service = CodeReviewService.for(
      cli_client: "codex",
      worktree_path: @worktree_path,
      pull_request: @pr
    )
    path = service.send(:codex_last_message_path)
    File.write(path, "old")

    service.send(:clear_codex_last_message!)

    refute File.exist?(path)
  end

  test "clear_codex_last_message! is no-op for non-codex" do
    service = CodeReviewService.for(
      cli_client: "claude",
      worktree_path: @worktree_path,
      pull_request: @pr
    )

    assert_nothing_raised do
      service.send(:clear_codex_last_message!)
    end
  end

  test "normalize_output uses codex last message when available" do
    service = CodeReviewService.for(
      cli_client: "codex",
      worktree_path: @worktree_path,
      pull_request: @pr
    )

    File.write(service.send(:codex_last_message_path), "```json\n[]\n```")
    output = service.send(:normalize_output, "header\nuser\nprompt\n")

    assert_equal "```json\n[]\n```", output
  end

  test "normalize_output falls back to raw output when codex file is blank" do
    service = CodeReviewService.for(
      cli_client: "codex",
      worktree_path: @worktree_path,
      pull_request: @pr
    )
    File.write(service.send(:codex_last_message_path), "")

    assert_equal "raw output", service.send(:normalize_output, "raw output")
  end

  test "normalize_output returns raw output for non-codex" do
    service = CodeReviewService.for(
      cli_client: "claude",
      worktree_path: @worktree_path,
      pull_request: @pr
    )

    assert_equal "raw output", service.send(:normalize_output, "raw output")
  end
end
