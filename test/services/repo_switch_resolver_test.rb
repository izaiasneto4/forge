require "test_helper"

class RepoSwitchResolverTest < ActiveSupport::TestCase
  test "returns not_found when folder missing" do
    resolver = RepoSwitchResolver.new(repos_folder: "/tmp/missing-repo-folder-xyz")
    result = resolver.resolve("acme/api")

    assert_equal :not_found, result[:status]
  end

  test "returns not_found when scan returns no match" do
    resolver = RepoSwitchResolver.new(repos_folder: "/tmp")
    RepoScannerService.any_instance.stubs(:scan).returns([ { path: "/tmp/r1", remote_url: "git@github.com:foo/bar.git" } ])

    result = resolver.resolve("acme/api")

    assert_equal :not_found, result[:status]
  end

  test "returns ambiguous when multiple matches" do
    resolver = RepoSwitchResolver.new(repos_folder: "/tmp")
    RepoScannerService.any_instance.stubs(:scan).returns([
      { path: "/tmp/r1", remote_url: "git@github.com:acme/api.git" },
      { path: "/tmp/r2", remote_url: "https://github.com/acme/api.git" }
    ])

    result = resolver.resolve("acme/api")

    assert_equal :ambiguous, result[:status]
    assert_equal 2, result[:paths].size
  end

  test "prefers exact repo directory name over suffixed worktree-style matches" do
    resolver = RepoSwitchResolver.new(repos_folder: "/tmp")
    RepoScannerService.any_instance.stubs(:scan).returns([
      { path: "/tmp/api", remote_url: "git@github.com:acme/api.git" },
      { path: "/tmp/api-pr1790", remote_url: "https://github.com/acme/api.git" }
    ])

    result = resolver.resolve("acme/api")

    assert_equal :ok, result[:status]
    assert_equal "/tmp/api", result[:path]
  end

  test "returns path when exactly one match" do
    resolver = RepoSwitchResolver.new(repos_folder: "/tmp")
    RepoScannerService.any_instance.stubs(:scan).returns([
      { path: "/tmp/r1", remote_url: "git@github.com:acme/api.git" }
    ])

    result = resolver.resolve("acme/api")

    assert_equal :ok, result[:status]
    assert_equal "/tmp/r1", result[:path]
  end
end
