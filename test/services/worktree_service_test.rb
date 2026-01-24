require "test_helper"

class WorktreeServiceTest < ActiveSupport::TestCase
  setup do
    @repo_path = "/tmp/test-repo"
    @service = WorktreeService.new(repo_path: @repo_path)
  end

  test "initialize expands repo path" do
    service = WorktreeService.new(repo_path: "~/repo")
    assert_equal File.expand_path("~/repo"), service.instance_variable_get(:@repo_path)
  end

  test "validate_path returns nil for nil input" do
    assert_nil PathValidator.validate(nil)
  end

  test "validate_path returns nil for non-string input" do
    assert_nil PathValidator.validate(123)
    assert_nil PathValidator.validate({})
    assert_nil PathValidator.validate([])
  end

  test "validate_path accepts valid worktree path characters" do
    Dir.mktmpdir do |base|
      worktree_path = File.join(base, "pr-123")
      Dir.mkdir(worktree_path)
      assert_equal Pathname.new(worktree_path).realpath.to_s, PathValidator.validate(worktree_path)
    end
  end

  test "validate_path validates path containment within allowed base" do
    Dir.mktmpdir do |base|
      worktrees_dir = File.join(base, ".forge-worktrees")
      Dir.mkdir(worktrees_dir)
      worktree_path = File.join(worktrees_dir, "pr-123")
      Dir.mkdir(worktree_path)

      assert_equal Pathname.new(worktree_path).realpath.to_s, PathValidator.validate(worktree_path, allowed_base: base)

      outside_path = File.join(base, "..", "outside")
      Dir.mkdir(outside_path) rescue nil
      assert_nil PathValidator.validate(outside_path, allowed_base: base)
    end
  end

  test "validate_path prevents path traversal" do
    Dir.mktmpdir do |base|
      outside_dir = File.join(base, "..", "test-outside")
      begin
        Dir.mkdir(outside_dir)
      rescue Errno::EEXIST
      end

      traversal_path = File.join(base, "..", "test-outside")
      result = PathValidator.validate(traversal_path, allowed_base: base)
      assert_nil result
    end
  end

  test "validate_path prevents symlink traversal" do
    Dir.mktmpdir do |base|
      Dir.mktmpdir do |outside|
        link_path = File.join(base, "malicious-link")
        File.symlink(outside, link_path)

        result = PathValidator.validate(link_path, allowed_base: base)
        assert_nil result
      end
    end
  end

  test "validate_path enforces maximum path length" do
    long_path = "x" * 5000
    assert_nil PathValidator.validate(long_path)
  end
end
