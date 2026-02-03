require "test_helper"

class RepoScannerServiceTest < ActiveSupport::TestCase
  setup do
    @base_folder = Dir.mktmpdir
  end

  teardown do
    FileUtils.rm_rf(@base_folder) if Dir.exist?(@base_folder)
  end

  # Base folder missing/blank tests
  test "scan returns empty array when base folder is nil" do
    service = RepoScannerService.new(nil)
    assert_equal [], service.scan
  end

  test "scan returns empty array when base folder is blank" do
    service = RepoScannerService.new("")
    assert_equal [], service.scan
  end

  test "scan returns empty array when base folder is whitespace only" do
    service = RepoScannerService.new("   ")
    assert_equal [], service.scan
  end

  test "scan returns empty array when base folder does not exist" do
    service = RepoScannerService.new("/nonexistent/path")
    assert_equal [], service.scan
  end

  # Dot-entries tests
  test "scan ignores dot entries" do
    FileUtils.mkdir_p(File.join(@base_folder, ".git"))
    FileUtils.mkdir_p(File.join(@base_folder, ".hidden"))
    FileUtils.mkdir_p(File.join(@base_folder, "repo1", ".git"))

    service = RepoScannerService.new(@base_folder)
    repos = service.scan

    assert_equal 1, repos.length
    assert_equal "repo1", repos.first[:name]
  end

  test "scan ignores regular files" do
    FileUtils.touch(File.join(@base_folder, "file.txt"))
    FileUtils.mkdir_p(File.join(@base_folder, "repo1", ".git"))

    service = RepoScannerService.new(@base_folder)
    repos = service.scan

    assert_equal 1, repos.length
    assert_equal "repo1", repos.first[:name]
  end

  # .git detection tests
  test "scan includes only folders with .git directory" do
    FileUtils.mkdir_p(File.join(@base_folder, "repo1", ".git"))
    FileUtils.mkdir_p(File.join(@base_folder, "repo2"))
    FileUtils.mkdir_p(File.join(@base_folder, "repo3", ".git"))

    service = RepoScannerService.new(@base_folder)
    repos = service.scan

    assert_equal 2, repos.length
    repo_names = repos.map { |r| r[:name] }
    assert_includes repo_names, "repo1"
    assert_includes repo_names, "repo3"
    refute_includes repo_names, "repo2"
  end

  test "scan treats .git file as non-git repo" do
    FileUtils.mkdir_p(File.join(@base_folder, "repo1"))
    FileUtils.touch(File.join(@base_folder, "repo1", ".git"))

    service = RepoScannerService.new(@base_folder)
    repos = service.scan

    assert_equal 0, repos.length
  end

  test "scan includes repo when .git directory exists" do
    FileUtils.mkdir_p(File.join(@base_folder, "repo1", ".git"))

    service = RepoScannerService.new(@base_folder)
    repos = service.scan

    assert_equal 1, repos.length
    assert_equal "repo1", repos.first[:name]
  end

  # Sorting tests
  test "scan sorts repos case-insensitively by name" do
    FileUtils.mkdir_p(File.join(@base_folder, "ZebraRepo", ".git"))
    FileUtils.mkdir_p(File.join(@base_folder, "alphaRepo", ".git"))
    FileUtils.mkdir_p(File.join(@base_folder, "middleRepo", ".git"))

    service = RepoScannerService.new(@base_folder)
    repos = service.scan

    assert_equal 3, repos.length
    assert_equal "alphaRepo", repos[0][:name]
    assert_equal "middleRepo", repos[1][:name]
    assert_equal "ZebraRepo", repos[2][:name]
  end

  # Repo structure tests
  test "scan returns correct repo structure with path" do
    repo_path = File.join(@base_folder, "repo1")
    FileUtils.mkdir_p(File.join(repo_path, ".git"))

    service = RepoScannerService.new(@base_folder)
    repos = service.scan

    assert_equal 1, repos.length

    repo = repos.first
    assert_equal "repo1", repo[:name]
    assert_equal repo_path, repo[:path]
    assert_instance_of String, repo[:remote_url]
    assert_instance_of String, repo[:branch]
  end

  test "scan handles multiple repos" do
    FileUtils.mkdir_p(File.join(@base_folder, "repo1", ".git"))
    FileUtils.mkdir_p(File.join(@base_folder, "repo2", ".git"))

    service = RepoScannerService.new(@base_folder)
    repos = service.scan

    assert_equal 2, repos.length

    repo_names = repos.map { |r| r[:name] }
    assert_includes repo_names, "repo1"
    assert_includes repo_names, "repo2"

    repos.each do |repo|
      assert_instance_of String, repo[:remote_url]
      assert_instance_of String, repo[:branch]
      assert repo.key?(:name)
      assert repo.key?(:path)
    end
  end

  # Edge cases
  test "scan handles empty folder" do
    service = RepoScannerService.new(@base_folder)
    assert_equal [], service.scan
  end

  test "scan handles folder with only files" do
    FileUtils.touch(File.join(@base_folder, "file1.txt"))
    FileUtils.touch(File.join(@base_folder, "file2.txt"))

    service = RepoScannerService.new(@base_folder)
    assert_equal [], service.scan
  end

  test "scan handles folder with only dot folders" do
    FileUtils.mkdir_p(File.join(@base_folder, ".git"))
    FileUtils.mkdir_p(File.join(@base_folder, ".hidden"))

    service = RepoScannerService.new(@base_folder)
    assert_equal [], service.scan
  end

  test "scan handles symlinks to non-git directories" do
    FileUtils.mkdir_p(File.join(@base_folder, "repo1", ".git"))

    Dir.mktmpdir do |other_dir|
      link_path = File.join(@base_folder, "link-to-repo")
      File.symlink(other_dir, link_path)

      service = RepoScannerService.new(@base_folder)
      repos = service.scan

      repo_names = repos.map { |r| r[:name] }
      assert_equal [ "repo1" ], repo_names
    end
  end

  # git_repo? private method tests (via scan)
  test "git_repo? returns true when .git directory exists" do
    repo_path = File.join(@base_folder, "repo1")
    FileUtils.mkdir_p(File.join(repo_path, ".git"))

    service = RepoScannerService.new(@base_folder)
    repos = service.scan

    assert_equal 1, repos.length
  end

  test "git_repo? returns false when .git is a file" do
    repo_path = File.join(@base_folder, "repo1")
    FileUtils.mkdir_p(repo_path)
    FileUtils.touch(File.join(repo_path, ".git"))

    service = RepoScannerService.new(@base_folder)
    repos = service.scan

    assert_equal 0, repos.length
  end

  test "git_repo? returns false when .git does not exist" do
    FileUtils.mkdir_p(File.join(@base_folder, "repo1"))

    service = RepoScannerService.new(@base_folder)
    repos = service.scan

    assert_equal 0, repos.length
  end

  # Remote URL and branch structure tests
  test "scan includes remote_url key in repo hash" do
    repo_path = File.join(@base_folder, "repo1")
    FileUtils.mkdir_p(File.join(repo_path, ".git"))

    service = RepoScannerService.new(@base_folder)
    repos = service.scan

    assert_equal 1, repos.length
    assert repos.first.key?(:remote_url)
    assert_instance_of String, repos.first[:remote_url]
  end

  test "scan includes branch key in repo hash" do
    repo_path = File.join(@base_folder, "repo1")
    FileUtils.mkdir_p(File.join(repo_path, ".git"))

    service = RepoScannerService.new(@base_folder)
    repos = service.scan

    assert_equal 1, repos.length
    assert repos.first.key?(:branch)
    assert_instance_of String, repos.first[:branch]
  end
end
