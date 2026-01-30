require "open3"
require "digest"

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

  def run_gh_command(*args, timeout: nil)
    options = {}
    options[:chdir] = @repo_path if @repo_path.present? && Dir.exist?(@repo_path)

    if timeout
      stdout, stderr, status = Open3.capture3("gh", *args, **options, timeout: timeout)
    else
      stdout, stderr, status = Open3.capture3("gh", *args, **options)
    end
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

    # Use destroy_all to trigger callbacks and cascade deletes properly
    # This ensures ReviewTask's dependent: :destroy associations (review_comments, review_iterations, agent_logs)
    # are properly cleaned up before deletion, avoiding foreign key constraint violations
    return unless stale_prs.exists?

    stale_count = stale_prs.count
    Rails.logger.info "Removing #{stale_count} stale PR(s) from #{repo_info[:owner]}/#{repo_info[:name]}"

    begin
      # destroy_all triggers ActiveRecord callbacks and handles dependent associations
      stale_prs.destroy_all
      Rails.logger.info "Successfully removed #{stale_count} stale PR(s)"
    rescue ActiveRecord::InvalidForeignKey => e
      Rails.logger.error "Foreign key constraint violation while removing stale PRs: #{e.message}"
      raise Error, "Failed to remove stale PRs due to database constraint violation"
    end
  end

  def get_repo_info
    validated_path = PathValidator.validate(@repo_path)
    return nil unless validated_path && Dir.exist?(validated_path)

    # Brakeman: safe - validated_path is validated by PathValidator and array args prevent shell injection
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



  def extract_github_id(url)
    # Extract PR number and repo from URL for a stable unique ID
    # URL format: https://github.com/owner/repo/pull/123
    if url =~ %r{github\.com/([^/]+)/([^/]+)/pull/(\d+)}
      # Create stable hash from owner/repo/number
      Digest::SHA256.hexdigest("#{$1}/#{$2}/#{$3}").to_i(16) % (2**62)
    else
      # Fallback: use Digest for stable hashing
      Digest::SHA256.hexdigest(url).to_i(16) % (2**62)
    end
  end

  def sync_prs(prs, _default_review_status)
    prs.each do |pr_data|
      pr = PullRequest.find_or_initialize_by(github_id: pr_data[:github_id])
      # Only preserve review_status if PR has an active review_task (user action)
      # Otherwise, update status based on GitHub's current state
      if pr.persisted? && pr.review_task.present?
        pr_data.delete(:review_status)
      end
      pr.assign_attributes(pr_data)
      pr.save!
    end
  end

  def mark_reviewed_by_others
    # Only check PRs that don't have a review task
    # If a user explicitly queued a review, respect that
    pending_prs = PullRequest.pending_review.left_joins(:review_task).where(review_tasks: { id: nil })
    return if pending_prs.empty?

    # Get all open PRs with their review request data
    json = run_gh_command(
      "pr", "list",
      "--json", "number,state,reviewRequests",
      "--limit", "100"
    )

    data = JSON.parse(json)

    # Build map of PR number -> has_my_review_request
    current_username = @username
    pr_status_map = data.each_with_object({}) do |pr, hash|
      my_review_requested = pr["reviewRequests"]&.any? { |req| req["login"] == current_username }
      hash[pr["number"]] = pr["state"] == "OPEN" && my_review_requested
    end

    pending_prs.each do |pr|
      # Only mark as reviewed_by_others if the PR doesn't have my review request
      pr.update!(review_status: "reviewed_by_others") unless pr_status_map[pr.number]
    end
  end
end
