require "test_helper"

class RepoSlugResolverTest < ActiveSupport::TestCase
  test "from_remote parses ssh and https" do
    assert_equal "acme/api", RepoSlugResolver.from_remote("git@github.com:acme/api.git")
    assert_equal "acme/api", RepoSlugResolver.from_remote("https://github.com/acme/api.git")
  end

  test "from_remote returns nil when invalid" do
    assert_nil RepoSlugResolver.from_remote(nil)
    assert_nil RepoSlugResolver.from_remote("git@gitlab.com:acme/api.git")
  end

  test "from_path returns nil for blank or missing path" do
    assert_nil RepoSlugResolver.from_path(nil)
    assert_nil RepoSlugResolver.from_path("/tmp/missing-repo-xyz")
  end

  test "from_path returns slug when git remote command succeeds" do
    Dir.mktmpdir do |dir|
      Open3.stubs(:capture2).returns([ "git@github.com:acme/api.git\n", stub(success?: true) ])
      assert_equal "acme/api", RepoSlugResolver.from_path(dir)
    end
  end

  test "from_path returns nil when git command fails" do
    Dir.mktmpdir do |dir|
      Open3.stubs(:capture2).returns([ "", stub(success?: false) ])
      assert_nil RepoSlugResolver.from_path(dir)
    end
  end

  test "from_path returns nil when git command raises" do
    Dir.mktmpdir do |dir|
      Open3.stubs(:capture2).raises(StandardError, "boom")
      assert_nil RepoSlugResolver.from_path(dir)
    end
  end
end
