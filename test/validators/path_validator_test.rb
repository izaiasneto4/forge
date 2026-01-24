require "test_helper"

class PathValidatorTest < ActiveSupport::TestCase
  test "validate returns nil for nil input" do
    assert_nil PathValidator.validate(nil)
  end

  test "validate returns nil for non-string input" do
    assert_nil PathValidator.validate(123)
    assert_nil PathValidator.validate({})
    assert_nil PathValidator.validate([])
    assert_nil PathValidator.validate(:symbol)
  end

  test "validate returns nil for empty string" do
    assert_nil PathValidator.validate("")
  end

  test "validate returns nil for whitespace only" do
    assert_nil PathValidator.validate("   ")
    assert_nil PathValidator.validate("\t")
    assert_nil PathValidator.validate("\n")
  end

  test "validate returns nil for path exceeding maximum length" do
    long_path = "x" * 5000
    assert_nil PathValidator.validate(long_path)
  end

  test "validate returns nil for non-existent path" do
    assert_nil PathValidator.validate("/this/path/does/not/exist")
  end

  test "validate resolves symlinks" do
    Dir.mktmpdir do |base|
      Dir.mkdir(File.join(base, "target"))
      link_path = File.join(base, "link")
      File.symlink(File.join(base, "target"), link_path)

      result = PathValidator.validate(link_path)
      assert_equal Pathname.new(link_path).realpath.to_s, result
    end
  end

  test "validate accepts valid existing path" do
    Dir.mktmpdir do |base|
      result = PathValidator.validate(base)
      assert_equal Pathname.new(base).realpath.to_s, result
    end
  end

  test "validate accepts valid path with allowed_base when within base" do
    Dir.mktmpdir do |base|
      subdir = File.join(base, "subdir")
      Dir.mkdir(subdir)

      result = PathValidator.validate(subdir, allowed_base: base)
      assert_equal Pathname.new(subdir).realpath.to_s, result
    end
  end

  test "validate returns nil for path outside allowed_base" do
    Dir.mktmpdir do |base|
      Dir.mktmpdir do |outside|
        result = PathValidator.validate(outside, allowed_base: base)
        assert_nil result
      end
    end
  end

  test "validate returns nil for path traversal outside allowed_base" do
    Dir.mktmpdir do |base|
      Dir.mktmpdir do |outside|
        traversal_path = File.join(base, "..", File.basename(outside))
        result = PathValidator.validate(traversal_path, allowed_base: base)
        assert_nil result
      end
    end
  end

  test "validate returns nil for symlink to outside allowed_base" do
    Dir.mktmpdir do |base|
      Dir.mktmpdir do |outside|
        link_path = File.join(base, "link")
        File.symlink(outside, link_path)

        result = PathValidator.validate(link_path, allowed_base: base)
        assert_nil result
      end
    end
  end

  test "validate accepts base path itself" do
    Dir.mktmpdir do |base|
      result = PathValidator.validate(base, allowed_base: base)
      assert_equal Pathname.new(base).realpath.to_s, result
    end
  end

  test "validate handles relative paths" do
    Dir.mktmpdir do |base|
      Dir.chdir(base) do
        subdir = "subdir"
        Dir.mkdir(subdir)

        result = PathValidator.validate(subdir)
        expected = Pathname.new(subdir).realpath.to_s
        assert_equal expected, result
      end
    end
  end

  test "validate prevents path traversal using .." do
    Dir.mktmpdir do |base|
      Dir.mkdir(File.join(base, "subdir"))
      traversal_path = File.join(base, "subdir", "..", "..")
      result = PathValidator.validate(traversal_path, allowed_base: base)
      assert_nil result
    end
  end
end
