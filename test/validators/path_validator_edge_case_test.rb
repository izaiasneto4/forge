require "test_helper"

class PathValidatorEdgeCaseTest < ActiveSupport::TestCase
  test "validate returns nil when allowed_base does not exist" do
    Dir.mktmpdir do |base|
      non_existent_base = File.join(base, "non_existent")
      existing_path = File.join(base, "existing")
      Dir.mkdir(existing_path)

      result = PathValidator.validate(existing_path, allowed_base: non_existent_base)
      assert_nil result, "Should return nil when allowed_base does not exist"
    end
  end

  test "validate returns nil when allowed_base realpath fails due to permissions" do
    skip "Skipping permission test - requires elevated permissions"
  end

  test "validate returns nil when path is a symlink pointing to inaccessible location" do
    skip "Skipping permission test - requires elevated permissions"
  end

  test "validate handles circular symlinks gracefully" do
    Dir.mktmpdir do |base|
      link1 = File.join(base, "link1")
      link2 = File.join(base, "link2")

      File.symlink(link2, link1)
      File.symlink(link1, link2)

      result = PathValidator.validate(link1)
      assert_nil result, "Should return nil for circular symlinks"
    end
  end

  test "validate returns nil for path with null bytes" do
    result = PathValidator.validate("test\x00file")
    assert_nil result, "Should return nil for path with null bytes"
  end

  test "validate returns nil for path exceeding MAX_PATH_LENGTH" do
    too_long_path = "x" * 5000
    result = PathValidator.validate(too_long_path)
    assert_nil result, "Should return nil for path exceeding max length"
  end

  test "validate handles unicode in paths" do
    Dir.mktmpdir do |base|
      unicode_path = File.join(base, "日本語-тест")
      Dir.mkdir(unicode_path)

      result = PathValidator.validate(unicode_path)
      assert_not_nil result, "Should handle unicode in paths"
    end
  end

  test "validate returns nil for path with trailing slash pointing to non-existent file" do
    result = PathValidator.validate("/non_existent/")
    assert_nil result, "Should return nil for non-existent path with trailing slash"
  end

  test "validate handles multiple consecutive slashes" do
    Dir.mktmpdir do |base|
      result = PathValidator.validate(File.join(base, "//subdir"))
      assert_nil result, "Should handle multiple consecutive slashes"
    end
  end

  test "validate handles path with only dots" do
    Dir.mktmpdir do |base|
      Dir.chdir(base) do
        result = PathValidator.validate(".")
        assert_not_nil result, "Should handle '.' path"
      end
    end
  end

  test "validate handles path with only dots and slashes" do
    Dir.mktmpdir do |base|
      Dir.chdir(base) do
        result = PathValidator.validate("./.")
        assert_not_nil result, "Should handle './.' path"
      end
    end
  end
end
