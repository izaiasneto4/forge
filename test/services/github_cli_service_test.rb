require "test_helper"

class GithubCliServiceTest < ActiveSupport::TestCase
  setup do
    @service = GithubCliService.new
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

  test "validate_path accepts valid path characters" do
    assert_equal "/path/to/repo", @service.send(:validate_path, "/path/to/repo")
    assert_equal "/path/with-dash", @service.send(:validate_path, "/path/with-dash")
    assert_equal "/path/with_underscore", @service.send(:validate_path, "/path/with_underscore")
    assert_equal "/path/with.dot", @service.send(:validate_path, "/path/with.dot")
    assert_equal File.expand_path("relative/path"), @service.send(:validate_path, "relative/path")
    assert_equal File.expand_path("~/path"), @service.send(:validate_path, "~/path")
  end

  test "validate_path returns nil for path with invalid characters" do
    assert_nil @service.send(:validate_path, "/path with spaces")
    assert_nil @service.send(:validate_path, "/path@symbol")
    assert_nil @service.send(:validate_path, "/path#hash")
    assert_nil @service.send(:validate_path, "/path%percent")
    assert_nil @service.send(:validate_path, "/path*asterisk")
    assert_nil @service.send(:validate_path, "/path?question")
  end

  test "validate_path handles empty string" do
    # Empty string should be rejected
    assert_nil @service.send(:validate_path, "")
  end

  test "validate_path handles whitespace only" do
    assert_nil @service.send(:validate_path, "   ")
  end

  test "validate_path returns nil for path with newlines" do
    assert_nil @service.send(:validate_path, "/path\nwith\nnewlines")
  end

  test "validate_path accepts paths with numbers" do
    assert_equal "/path123/456", @service.send(:validate_path, "/path123/456")
  end

  test "get_repo_info returns nil for non-existent path" do
    service = GithubCliService.new(repo_path: "/nonexistent/path")
    assert_nil service.send(:get_repo_info)
  end

  test "get_repo_info returns nil for nil repo path" do
    service = GithubCliService.new(repo_path: nil)
    assert_nil service.send(:get_repo_info)
  end
end
