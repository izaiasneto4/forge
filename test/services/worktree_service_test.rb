require "test_helper"

class WorktreeServiceTest < ActiveSupport::TestCase
  setup do
    @repo_path = "/tmp/test-repo"
    @service = WorktreeService.new(repo_path: @repo_path)
  end

  test "validate_path returns nil for nil input" do
    assert_nil @service.send(:validate_path, nil)
  end

  test "validate_path returns nil for non-string input" do
    assert_nil @service.send(:validate_path, 123)
    assert_nil @service.send(:validate_path, {})
    assert_nil @service.send(:validate_path, [])
  end

  test "validate_path returns nil for path with shell metacharacters" do
    assert_nil @service.send(:validate_path, "path; rm -rf /")
    assert_nil @service.send(:validate_path, "path & echo pwned")
    assert_nil @service.send(:validate_path, "path| cat /etc/passwd")
    assert_nil @service.send(:validate_path, "path`whoami`")
    assert_nil @service.send(:validate_path, "path$(id)")
    assert_nil @service.send(:validate_path, "path; command")
    assert_nil @service.send(:validate_path, "path&& command")
    assert_nil @service.send(:validate_path, "path|| command")
    assert_nil @service.send(:validate_path, "path\ncommand")
    assert_nil @service.send(:validate_path, "path$(cmd)")
    assert_nil @service.send(:validate_path, "path`cmd`")
    assert_nil @service.send(:validate_path, "path$()")
    assert_nil @service.send(:validate_path, "path<test")
    assert_nil @service.send(:validate_path, "path>test")
  end

  test "validate_path accepts valid worktree path characters" do
    assert_equal "/path/to/worktree", @service.send(:validate_path, "/path/to/worktree")
    assert_equal "/path/with-dash", @service.send(:validate_path, "/path/with-dash")
    assert_equal "/path/with_underscore", @service.send(:validate_path, "/path/with_underscore")
    assert_equal "/path/with.dot", @service.send(:validate_path, "/path/with.dot")
    assert_equal ".forge-worktrees/pr-123", @service.send(:validate_path, ".forge-worktrees/pr-123")
  end

  test "validate_path returns nil for path with invalid characters" do
    assert_nil @service.send(:validate_path, "/path with spaces")
    assert_nil @service.send(:validate_path, "/path@symbol")
    assert_nil @service.send(:validate_path, "/path#hash")
    assert_nil @service.send(:validate_path, "/path%percent")
    assert_nil @service.send(:validate_path, "/path*asterisk")
    assert_nil @service.send(:validate_path, "/path?question")
  end

  test "validate_branch_name returns nil for nil input" do
    assert_nil @service.send(:validate_branch_name, nil)
  end

  test "validate_branch_name returns nil for non-string input" do
    assert_nil @service.send(:validate_branch_name, 123)
    assert_nil @service.send(:validate_branch_name, {})
    assert_nil @service.send(:validate_branch_name, [])
  end

  test "validate_branch_name returns nil for branch name with shell metacharacters" do
    assert_nil @service.send(:validate_branch_name, "branch; rm -rf /")
    assert_nil @service.send(:validate_branch_name, "branch & echo pwned")
    assert_nil @service.send(:validate_branch_name, "branch| cat /etc/passwd")
    assert_nil @service.send(:validate_branch_name, "branch`whoami`")
    assert_nil @service.send(:validate_branch_name, "branch$(id)")
    assert_nil @service.send(:validate_branch_name, "branch; command")
    assert_nil @service.send(:validate_branch_name, "branch&& command")
    assert_nil @service.send(:validate_branch_name, "branch|| command")
    assert_nil @service.send(:validate_branch_name, "branch\ncommand")
    assert_nil @service.send(:validate_branch_name, "branch$(cmd)")
    assert_nil @service.send(:validate_branch_name, "branch`cmd`")
    assert_nil @service.send(:validate_branch_name, "branch$()")
    assert_nil @service.send(:validate_branch_name, "branch<test")
    assert_nil @service.send(:validate_branch_name, "branch>test")
  end

  test "validate_branch_name returns nil for branch name with spaces" do
    assert_nil @service.send(:validate_branch_name, "branch with spaces")
  end

  test "validate_branch_name accepts valid branch name characters" do
    assert_equal "feature-branch", @service.send(:validate_branch_name, "feature-branch")
    assert_equal "feature_branch", @service.send(:validate_branch_name, "feature_branch")
    assert_equal "feature.branch", @service.send(:validate_branch_name, "feature.branch")
    assert_equal "feature/branch", @service.send(:validate_branch_name, "feature/branch")
    assert_equal "pr-123", @service.send(:validate_branch_name, "pr-123")
    assert_equal "123-branch", @service.send(:validate_branch_name, "123-branch")
    assert_equal "main", @service.send(:validate_branch_name, "main")
    assert_equal "develop", @service.send(:validate_branch_name, "develop")
  end

  test "validate_branch_name handles empty string" do
    assert_nil @service.send(:validate_branch_name, "")
  end

  test "validate_branch_name handles whitespace only" do
    assert_nil @service.send(:validate_branch_name, "   ")
  end

  test "validate_branch_name returns nil for branch name with newlines" do
    assert_nil @service.send(:validate_branch_name, "branch\nwith\nnewlines")
  end

  test "validate_branch_name rejects branch names with invalid special chars" do
    assert_nil @service.send(:validate_branch_name, "feature@team")
    assert_nil @service.send(:validate_branch_name, "feature#123")
  end

  test "initialize expands repo path" do
    service = WorktreeService.new(repo_path: "~/repo")
    assert_equal File.expand_path("~/repo"), service.instance_variable_get(:@repo_path)
  end
end
