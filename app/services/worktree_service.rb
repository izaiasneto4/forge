require "open3"
require "fileutils"

class WorktreeService
  class Error < StandardError; end
  class NetworkError < Error; end

  WORKTREES_DIR = ".forge-worktrees"
  MAX_RETRIES = 3
  RETRY_DELAY = 2

  TRANSIENT_ERROR_PATTERNS = [
    /Connection refused/i,
    /Connection timed out/i,
    /Could not resolve host/i,
    /Network is unreachable/i,
    /Connection reset by peer/i,
    /Temporary failure in name resolution/i
  ].freeze

  def initialize(repo_path:)
    @repo_path = File.expand_path(repo_path)
    @worktrees_base = File.join(@repo_path, WORKTREES_DIR)
  end

  def create_for_pr(pull_request)
    branch_name = fetch_pr_branch(pull_request)
    worktree_name = "pr-#{pull_request.number}"
    worktree_path = File.join(@worktrees_base, worktree_name)

    FileUtils.mkdir_p(@worktrees_base)

    if Dir.exist?(worktree_path)
      cleanup_worktree(worktree_path)
    end

    fetch_pr_ref(pull_request)
    create_worktree(worktree_path, branch_name, pull_request)

    worktree_path
  end

  def cleanup_worktree(worktree_path)
    return unless worktree_path.present?

    stdout, stderr, status = Open3.capture3("git", "-C", @repo_path, "worktree", "remove", "--force", worktree_path)
    Rails.logger.warn("Worktree cleanup warning: #{stderr}") unless status.success?

    FileUtils.rm_rf(worktree_path) if Dir.exist?(worktree_path)
  end

  def cleanup_all
    Open3.capture3("git", "-C", @repo_path, "worktree", "prune")
    FileUtils.rm_rf(@worktrees_base) if Dir.exist?(@worktrees_base)
  end

  private

  def fetch_pr_branch(pull_request)
    stdout, _stderr, status = Open3.capture3(
      "gh", "pr", "view", pull_request.number.to_s, "--json", "headRefName",
      chdir: @repo_path
    )
    return "pr-#{pull_request.number}" unless status.success?

    data = JSON.parse(stdout)
    data["headRefName"]
  rescue
    "pr-#{pull_request.number}"
  end

  def fetch_pr_ref(pull_request)
    with_retry("fetch PR ##{pull_request.number}") do
      stdout, stderr, status = Open3.capture3(
        "gh", "pr", "checkout", pull_request.number.to_s, "--detach",
        chdir: @repo_path
      )
      raise Error, "Failed to fetch PR: #{stderr}" unless status.success?

      Open3.capture3("git", "-C", @repo_path, "checkout", "-")
    end
  end

  def with_retry(operation, retries: MAX_RETRIES, delay: RETRY_DELAY)
    attempts = 0
    begin
      attempts += 1
      yield
    rescue Error => e
      if transient_error?(e.message) && attempts < retries
        Rails.logger.warn("Transient network error during #{operation}, attempt #{attempts}/#{retries}: #{e.message}")
        sleep(delay * attempts)
        retry
      end
      raise NetworkError, "#{e.message} (after #{attempts} attempts)" if transient_error?(e.message)
      raise
    end
  end

  def transient_error?(message)
    TRANSIENT_ERROR_PATTERNS.any? { |pattern| message.match?(pattern) }
  end

  def validate_path(path)
    return nil unless path.is_a?(String)

    # Ensure path doesn't contain shell metacharacters or dangerous patterns
    return nil if path =~ /[;&|`$()<>]/
    return nil unless path =~ %r{\A[A-Za-z0-9_\-./]+\z}

    path
  end

  def validate_branch_name(branch_name)
    return nil unless branch_name.is_a?(String)

    # Branch names are typically safe but let's validate
    return nil if branch_name =~ /[;&|`$()<> ]/
    return nil unless branch_name =~ %r{\A[A-Za-z0-9_\-./]+\z}

    branch_name
  end

  def create_worktree(worktree_path, branch_name, pull_request)
    validated_worktree = validate_path(worktree_path)
    validated_branch = validate_branch_name(branch_name)

    raise Error, "Invalid worktree path" unless validated_worktree
    raise Error, "Invalid branch name" unless validated_branch

    branch_ref = "forge-review-pr-#{pull_request.number}"
    remote_ref = "origin/#{validated_branch}"

    stdout, stderr, status = Open3.capture3(
      "git", "-C", @repo_path, "worktree", "add", validated_worktree, "-b", branch_ref, remote_ref
    )

    unless status.success?
      stdout, stderr, status = Open3.capture3(
        "git", "-C", @repo_path, "worktree", "add", validated_worktree, "FETCH_HEAD"
      )
      raise Error, "Failed to create worktree: #{stderr}" unless status.success?
    end
  end
end
