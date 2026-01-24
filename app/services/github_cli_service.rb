require "open3"

class GithubCliService
  class Error < StandardError; end

  def initialize(username: nil, repo_path: nil)
    @username = username || fetch_current_user
    @repo_path = repo_path || Setting.current_repo
  end

  def fetch_review_requests
    json = run_gh_command("pr", "list", "--search", "review-requested:@me", "--json", pr_fields, "--limit", "100")
    parse_prs(json, "pending_review")
  end

  def fetch_reviewed_by_me
    json = run_gh_command("pr", "list", "--search", "reviewed-by:@me", "--json", pr_fields, "--limit", "100")
    parse_prs(json, "reviewed_by_me")
  end

  def fetch_all_prs_needing_attention
    review_requests = fetch_review_requests
    reviewed = fetch_reviewed_by_me

    # PRs I've already reviewed should not appear in pending
    reviewed_ids = reviewed.map { |pr| pr[:github_id] }.to_set
    pending = review_requests.reject { |pr| reviewed_ids.include?(pr[:github_id]) }

    {
      pending_review: pending,
      reviewed_by_me: reviewed
    }
  end

  def sync_to_database!
    prs = fetch_all_prs_needing_attention

    ActiveRecord::Base.transaction do
      sync_prs(prs[:pending_review], "pending_review")
      sync_prs(prs[:reviewed_by_me], "reviewed_by_me")
      remove_stale_prs(prs) if @repo_path.present?
      mark_reviewed_by_others
    end
  end

  def self.fetch_latest_for_repo(repo_path)
    return unless repo_path.present? && Dir.exist?(repo_path)

    # Fetch latest from remote
    system("git", "-C", repo_path, "fetch", "origin", out: File::NULL, err: File::NULL)
    # Pull if we're on a branch tracking remote
    system("git", "-C", repo_path, "pull", "--ff-only", out: File::NULL, err: File::NULL)
  end

  private

  def fetch_current_user
    result = run_gh_command("api", "user", "--jq", ".login")
    result.strip
  end

  def pr_fields
    "number,title,body,url,author,headRepositoryOwner,headRefName,createdAt,updatedAt"
  end

  def run_gh_command(*args)
    options = {}
    options[:chdir] = @repo_path if @repo_path.present? && Dir.exist?(@repo_path)

    stdout, stderr, status = Open3.capture3("gh", *args, **options)
    raise Error, "GitHub CLI error: #{stderr}" unless status.success?
    stdout
  end

  def remove_stale_prs(fetched_prs)
    # Only remove PRs that no longer exist on GitHub (closed/merged)
    # Preserve user-set review_status and review tasks
    return unless @repo_path.present?

    repo_info = get_repo_info
    return unless repo_info

    # Get all github_ids from fetched PRs
    fetched_ids = (fetched_prs[:pending_review] + fetched_prs[:reviewed_by_me])
                    .map { |pr| pr[:github_id] }
                    .to_set

    # Find PRs in database for this repo that weren't in the fetch
    stale_prs = PullRequest.where(repo_owner: repo_info[:owner], repo_name: repo_info[:name])
                           .where.not(github_id: fetched_ids)

    # Delete review tasks first, then the PRs
    stale_pr_ids = stale_prs.pluck(:id)
    if stale_pr_ids.any?
      ReviewTask.where(pull_request_id: stale_pr_ids).delete_all
      stale_prs.delete_all
    end
  end

  def get_repo_info
    validated_path = validate_path(@repo_path)
    return nil unless validated_path && Dir.exist?(validated_path)

    remote, status = Open3.capture2("git", "-C", validated_path, "remote", "get-url", "origin")
    return nil unless status.success?

    remote = remote.strip
    return nil if remote.empty?

    # Parse GitHub URL: git@github.com:owner/repo.git or https://github.com/owner/repo.git
    if remote =~ %r{github\.com[:/]([^/]+)/([^/]+?)(?:\.git)?$}
      { owner: $1, name: $2 }
    else
      nil
    end
  rescue
    nil
  end

  def parse_prs(json, review_status)
    return [] if json.strip.empty?

    data = JSON.parse(json)
    data.map do |pr|
      # Extract repo info from URL: https://github.com/owner/repo/pull/123
      url_parts = pr["url"].to_s.match(%r{github\.com/([^/]+)/([^/]+)/pull/})
      {
        github_id: extract_github_id(pr["url"]),
        number: pr["number"],
        title: pr["title"],
        description: pr["body"],
        url: pr["url"],
        repo_owner: url_parts&.[](1) || pr.dig("headRepositoryOwner", "login"),
        repo_name: url_parts&.[](2),
        author: pr.dig("author", "login"),
        author_avatar: pr.dig("author", "avatarUrl"),
        created_at_github: pr["createdAt"],
        updated_at_github: pr["updatedAt"],
        review_status: review_status
      }
    end
  end

  def validate_path(path)
    return nil unless path.is_a?(String)
    return nil if path.empty?

    expanded_path = File.expand_path(path)

    # Ensure path doesn't contain shell metacharacters or dangerous patterns
    return nil if expanded_path =~ /[;&|`$()<>]/
    return nil unless expanded_path =~ %r{\A[A-Za-z0-9_\-./]+\z}

    expanded_path
  end

  def extract_github_id(url)
    # Extract a unique ID from the URL (using hash as pseudo-ID)
    url.hash.abs
  end

  def sync_prs(prs, _default_review_status)
    prs.each do |pr_data|
      pr = PullRequest.find_or_initialize_by(github_id: pr_data[:github_id])
      # Preserve existing review_status - user may have manually moved the PR
      pr_data.delete(:review_status) if pr.persisted?
      pr.assign_attributes(pr_data)
      pr.save!
    end
  end

  def mark_reviewed_by_others
    # PRs that were pending but no longer appear in review requests
    # and haven't been reviewed by me - mark as reviewed by others
    PullRequest.pending_review.find_each do |pr|
      # Check if this PR still needs review
      unless pr_still_needs_review?(pr)
        pr.update!(review_status: "reviewed_by_others")
      end
    end
  end

  def pr_still_needs_review?(pr)
    # Simple check - if the PR is still open and has review requested
    json = run_gh_command(
      "pr", "view", pr.number.to_s,
      "--repo", pr.repo_full_name,
      "--json", "reviewRequests,state"
    )
    data = JSON.parse(json)
    data["state"] == "OPEN" && data["reviewRequests"]&.any?
  rescue Error
    false
  end
end
