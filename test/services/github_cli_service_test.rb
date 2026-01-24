require "test_helper"

class GithubCliServiceTest < ActiveSupport::TestCase
  test "validate_path returns nil for nil input" do
    assert_nil PathValidator.validate(nil)
  end

  test "validate_path returns nil for non-string input" do
    assert_nil PathValidator.validate(123)
    assert_nil PathValidator.validate({})
    assert_nil PathValidator.validate([])
  end

  test "validate_path accepts valid path characters" do
    Dir.mktmpdir do |base|
      assert_equal Pathname.new(base).realpath.to_s, PathValidator.validate(base)

      subdir = File.join(base, "subdir")
      Dir.mkdir(subdir)
      assert_equal Pathname.new(subdir).realpath.to_s, PathValidator.validate(subdir)
    end
  end

  test "validate_path handles empty string" do
    assert_nil PathValidator.validate("")
  end

  test "validate_path handles whitespace only" do
    assert_nil PathValidator.validate("   ")
  end

  test "validate_path validates path containment within allowed base" do
    Dir.mktmpdir do |base|
      Dir.mkdir(File.join(base, "subdir"))
      sub_path = File.join(base, "subdir")

      assert_equal Pathname.new(sub_path).realpath.to_s, PathValidator.validate(sub_path, allowed_base: base)

      outside_path = File.join(base, "..", "outside")
      assert_nil PathValidator.validate(outside_path, allowed_base: base)
    end
  end

  test "get_repo_info returns nil for non-existent path" do
    service = GithubCliService.new(username: "test", repo_path: "/nonexistent/path")
    assert_nil service.send(:get_repo_info)
  end

  test "get_repo_info returns nil for nil repo path" do
    service = GithubCliService.new(username: "test", repo_path: nil)
    assert_nil service.send(:get_repo_info)
  end
end
