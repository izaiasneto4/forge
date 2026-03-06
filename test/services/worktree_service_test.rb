require "test_helper"

class WorktreeServiceTest < ActiveSupport::TestCase
  setup do
    @repo_path = Dir.mktmpdir
    @service = WorktreeService.new(repo_path: @repo_path)
    @pr = PullRequest.new(
      github_id: 12345,
      number: 42,
      title: "Test PR",
      url: "https://github.com/test/repo/pull/42",
      repo_owner: "test",
      repo_name: "repo",
      review_status: "pending_review"
    )
  end

  teardown do
    FileUtils.rm_rf(@repo_path) if Dir.exist?(@repo_path)
  end

  def status(success)
    stub(success?: success)
  end

  # initialize tests
  test "initialize expands repo path" do
    service = WorktreeService.new(repo_path: "~/repo")
    assert_equal File.expand_path("~/repo"), service.instance_variable_get(:@repo_path)
  end

  test "initialize sets worktrees_base path" do
    worktrees_base = @service.instance_variable_get(:@worktrees_base)
    expected = File.join(@repo_path, ".forge-worktrees")
    assert_equal expected, worktrees_base
  end

  # cleanup_worktree tests
  test "cleanup_worktree does nothing when path is nil" do
    assert_nothing_raised do
      @service.cleanup_worktree(nil)
    end
  end

  test "cleanup_worktree does nothing when path is blank" do
    assert_nothing_raised do
      @service.cleanup_worktree("  ")
    end
  end

  # transient_error? tests
  test "transient_error? matches connection refused" do
    assert @service.send(:transient_error?, "Connection refused")
  end

  test "transient_error? matches connection timed out" do
    assert @service.send(:transient_error?, "Connection timed out")
  end

  test "transient_error? matches could not resolve host" do
    assert @service.send(:transient_error?, "Could not resolve host")
  end

  test "transient_error? matches network unreachable" do
    assert @service.send(:transient_error?, "Network is unreachable")
  end

  test "transient_error? matches connection reset by peer" do
    assert @service.send(:transient_error?, "Connection reset by peer")
  end

  test "transient_error? matches temporary failure in name resolution" do
    assert @service.send(:transient_error?, "Temporary failure in name resolution")
  end

  test "transient_error? returns false for non-transient errors" do
    refute @service.send(:transient_error?, "Authentication failed")
    refute @service.send(:transient_error?, "File not found")
  end

  # with_retry tests (simplified, without Open3 stub)
  test "with_retry succeeds immediately" do
    attempts = 0

    result = @service.send(:with_retry, "test op") do
      attempts += 1
      "success"
    end

    assert_equal 1, attempts
    assert_equal "success", result
  end

  test "with_retry retries transient errors" do
    attempts = 0

    result = @service.send(:with_retry, "test op") do
      attempts += 1
      raise WorktreeService::Error, "Connection timed out" if attempts < 2
      "success"
    end

    assert_equal 2, attempts
    assert_equal "success", result
  end

  test "with_retry raises NetworkError after max retries" do
    attempts = 0

    assert_raises(WorktreeService::NetworkError) do
      @service.send(:with_retry, "test op", retries: 2) do
        attempts += 1
        raise WorktreeService::Error, "Connection refused"
      end
    end

    assert_equal 2, attempts
  end

  test "with_retry raises non-transient errors immediately" do
    attempts = 0

    assert_raises(WorktreeService::Error) do
      @service.send(:with_retry, "test op") do
        attempts += 1
        raise WorktreeService::Error, "Invalid credentials"
      end
    end

    assert_equal 1, attempts
  end

  test "create_for_pr creates worktree successfully" do
    worktree_path = File.join(@repo_path, ".forge-worktrees", "pr-42")

    @service.expects(:fetch_pr_branch).with(@pr).returns("feature/test")
    @service.expects(:fetch_pr_ref).with(@pr)
    @service.expects(:create_worktree).with(worktree_path, "feature/test", @pr)

    assert_equal worktree_path, @service.create_for_pr(@pr)
  end

  test "create_for_pr creates worktrees_base directory" do
    worktrees_base = File.join(@repo_path, ".forge-worktrees")

    FileUtils.expects(:mkdir_p).with(worktrees_base)
    @service.expects(:fetch_pr_branch).with(@pr).returns("feature/test")
    @service.expects(:fetch_pr_ref).with(@pr)
    @service.expects(:create_worktree).with(File.join(worktrees_base, "pr-42"), "feature/test", @pr)

    @service.create_for_pr(@pr)
  end

  test "create_for_pr cleans up existing worktree" do
    worktree_path = File.join(@repo_path, ".forge-worktrees", "pr-42")
    FileUtils.mkdir_p(worktree_path)

    @service.expects(:fetch_pr_branch).with(@pr).returns("feature/test")
    @service.expects(:cleanup_worktree).with(worktree_path)
    @service.expects(:fetch_pr_ref).with(@pr)
    @service.expects(:create_worktree).with(worktree_path, "feature/test", @pr)

    @service.create_for_pr(@pr)
  end

  test "create_for_pr uses fallback branch name when gh fails" do
    worktree_path = File.join(@repo_path, ".forge-worktrees", "pr-42")

    Open3.expects(:capture3).with(
      "gh", "pr", "view", "42", "--json", "headRefName",
      chdir: @repo_path
    ).returns(["", "boom", status(false)])

    @service.expects(:fetch_pr_ref).with(@pr)
    @service.expects(:create_worktree).with(worktree_path, "pr-42", @pr)

    @service.create_for_pr(@pr)
  end

  test "cleanup_worktree removes via git and rm_rf" do
    worktree_path = File.join(@repo_path, ".forge-worktrees", "pr-42")
    FileUtils.mkdir_p(worktree_path)

    FileUtils.stubs(:rm_rf)
    Open3.expects(:capture3).with(
      "git", "-C", @repo_path, "worktree", "remove", "--force", worktree_path
    ).returns(["", "", status(true)])
    FileUtils.expects(:rm_rf).with(worktree_path)

    @service.cleanup_worktree(worktree_path)
  end

  test "cleanup_worktree warns when git remove fails but still removes directory" do
    worktree_path = File.join(@repo_path, ".forge-worktrees", "pr-42")
    FileUtils.mkdir_p(worktree_path)

    FileUtils.stubs(:rm_rf)
    Open3.expects(:capture3).with(
      "git", "-C", @repo_path, "worktree", "remove", "--force", worktree_path
    ).returns(["", "fatal", status(false)])
    Rails.logger.expects(:warn).with("Worktree cleanup warning: fatal")
    FileUtils.expects(:rm_rf).with(worktree_path)

    @service.cleanup_worktree(worktree_path)
  end

  test "cleanup_all prunes worktrees and removes base directory" do
    worktrees_base = File.join(@repo_path, ".forge-worktrees")
    FileUtils.mkdir_p(worktrees_base)

    FileUtils.stubs(:rm_rf)
    Open3.expects(:capture3).with("git", "-C", @repo_path, "worktree", "prune")
    FileUtils.expects(:rm_rf).with(worktrees_base)

    @service.cleanup_all
  end

  test "cleanup_all works when worktrees_base does not exist" do
    worktrees_base = File.join(@repo_path, ".forge-worktrees")

    FileUtils.stubs(:rm_rf)
    Open3.expects(:capture3).with("git", "-C", @repo_path, "worktree", "prune")
    FileUtils.expects(:rm_rf).with(worktrees_base).never

    @service.cleanup_all
  end

  test "fetch_pr_branch returns branch name from gh" do
    Open3.expects(:capture3).with(
      "gh", "pr", "view", "42", "--json", "headRefName",
      chdir: @repo_path
    ).returns([{"headRefName":"feature/test"}.to_json, "", status(true)])

    assert_equal "feature/test", @service.send(:fetch_pr_branch, @pr)
  end

  test "fetch_pr_branch falls back to pr-N on gh error" do
    Open3.expects(:capture3).with(
      "gh", "pr", "view", "42", "--json", "headRefName",
      chdir: @repo_path
    ).returns(["", "boom", status(false)])

    assert_equal "pr-42", @service.send(:fetch_pr_branch, @pr)
  end

  test "fetch_pr_branch falls back to pr-N on invalid JSON" do
    Open3.expects(:capture3).with(
      "gh", "pr", "view", "42", "--json", "headRefName",
      chdir: @repo_path
    ).returns(["{bad json", "", status(true)])

    assert_equal "pr-42", @service.send(:fetch_pr_branch, @pr)
  end

  test "fetch_pr_ref fetches PR successfully" do
    success = stub(success?: true)

    Open3.expects(:capture3).with(
      "git", "-C", @repo_path, "fetch", "origin", "pull/42/head"
    ).returns([ "", "", success ])

    @service.send(:fetch_pr_ref, @pr)
  end

  test "fetch_pr_ref does not checkout or switch branches" do
    success = stub(success?: true)

    Open3.expects(:capture3).with(
      "git", "-C", @repo_path, "fetch", "origin", "pull/42/head"
    ).returns([ "", "", success ])
    Open3.expects(:capture3).with(
      "gh", "pr", "checkout", anything, anything,
      chdir: @repo_path
    ).never
    Open3.expects(:capture3).with(
      "git", "-C", @repo_path, "checkout", "-"
    ).never

    @service.send(:fetch_pr_ref, @pr)
  end

  test "fetch_pr_ref raises Error for invalid PR number" do
    @pr.number = "not-a-number"

    Open3.expects(:capture3).never

    error = assert_raises(WorktreeService::Error) do
      @service.send(:fetch_pr_ref, @pr)
    end
    assert_includes error.message, "Invalid PR number"
  end

  test "fetch_pr_ref retries on transient network errors" do
    transient = status(false)
    success = status(true)
    sequence = sequence("fetch pr retry")

    Open3.expects(:capture3).with(
      "git", "-C", @repo_path, "fetch", "origin", "pull/42/head"
    ).in_sequence(sequence).returns(["", "Connection timed out", transient])
    Open3.expects(:capture3).with(
      "git", "-C", @repo_path, "fetch", "origin", "pull/42/head"
    ).in_sequence(sequence).returns(["", "", success])
    Rails.logger.expects(:warn).with(regexp_matches(/Transient network error during fetch PR #42, attempt 1\/3/))
    @service.expects(:sleep).with(2)

    assert_nothing_raised do
      @service.send(:fetch_pr_ref, @pr)
    end
  end

  test "fetch_pr_ref raises NetworkError after max retries on transient errors" do
    transient = status(false)

    Open3.expects(:capture3).with(
      "git", "-C", @repo_path, "fetch", "origin", "pull/42/head"
    ).times(3).returns(["", "Connection refused", transient])
    Rails.logger.expects(:warn).times(2)
    @service.expects(:sleep).with(2)
    @service.expects(:sleep).with(4)

    error = assert_raises(WorktreeService::NetworkError) do
      @service.send(:fetch_pr_ref, @pr)
    end

    assert_includes error.message, "Connection refused"
    assert_includes error.message, "after 3 attempts"
  end

  test "fetch_pr_ref raises Error on non-transient errors immediately" do
    Open3.expects(:capture3).with(
      "git", "-C", @repo_path, "fetch", "origin", "pull/42/head"
    ).returns(["", "Authentication failed", status(false)])
    @service.expects(:sleep).never

    error = assert_raises(WorktreeService::Error) do
      @service.send(:fetch_pr_ref, @pr)
    end

    assert_equal "Failed to fetch PR: Authentication failed", error.message
  end

  test "create_worktree creates worktree with branch" do
    worktree_path = File.join(@repo_path, ".forge-worktrees", "pr-42")

    PathValidator.expects(:validate_new_path).with(worktree_path, allowed_base: @repo_path).returns(worktree_path)
    Open3.expects(:capture3).with(
      "git", "-C", @repo_path, "worktree", "add", worktree_path, "-b", "forge-review-pr-42", "origin/feature/test"
    ).returns(["", "", status(true)])

    assert_nothing_raised do
      @service.send(:create_worktree, worktree_path, "feature/test", @pr)
    end
  end

  test "create_worktree falls back to FETCH_HEAD when branch add fails" do
    worktree_path = File.join(@repo_path, ".forge-worktrees", "pr-42")

    PathValidator.expects(:validate_new_path).with(worktree_path, allowed_base: @repo_path).returns(worktree_path)
    Open3.expects(:capture3).with(
      "git", "-C", @repo_path, "worktree", "add", worktree_path, "-b", "forge-review-pr-42", "origin/feature/test"
    ).returns(["", "missing branch", status(false)])
    Open3.expects(:capture3).with(
      "git", "-C", @repo_path, "worktree", "add", worktree_path, "FETCH_HEAD"
    ).returns(["", "", status(true)])

    assert_nothing_raised do
      @service.send(:create_worktree, worktree_path, "feature/test", @pr)
    end
  end

  test "create_worktree raises Error when FETCH_HEAD also fails" do
    worktree_path = File.join(@repo_path, ".forge-worktrees", "pr-42")

    PathValidator.expects(:validate_new_path).with(worktree_path, allowed_base: @repo_path).returns(worktree_path)
    Open3.expects(:capture3).with(
      "git", "-C", @repo_path, "worktree", "add", worktree_path, "-b", "forge-review-pr-42", "origin/feature/test"
    ).returns(["", "missing branch", status(false)])
    Open3.expects(:capture3).with(
      "git", "-C", @repo_path, "worktree", "add", worktree_path, "FETCH_HEAD"
    ).returns(["", "still broken", status(false)])

    error = assert_raises(WorktreeService::Error) do
      @service.send(:create_worktree, worktree_path, "feature/test", @pr)
    end

    assert_equal "Failed to create worktree: still broken", error.message
  end

  test "create_worktree raises Error when path validation fails" do
    worktree_path = File.join(@repo_path, ".forge-worktrees", "pr-42")

    PathValidator.expects(:validate_new_path).with(worktree_path, allowed_base: @repo_path).returns(nil)
    Open3.expects(:capture3).never

    error = assert_raises(WorktreeService::Error) do
      @service.send(:create_worktree, worktree_path, "feature/test", @pr)
    end

    assert_equal "Invalid worktree path", error.message
  end
end
