require "open3"
require "digest"

class GithubCliService
  class Error < StandardError; end
  PR_FETCH_LIMIT = 1000

  def initialize(username: nil, repo_path: nil)
    @username = username || fetch_current_user
    @repo_path = repo_path || Setting.current_repo
    Setting.github_login = @username if @username.present?
  end

  def fetch_review_requests
    fetch_pr_list(
      "pr", "list",
      "--search", "review-requested:@me",
      "--json", pr_fields,
      "--limit", PR_FETCH_LIMIT.to_s,
      review_status: "pending_review"
    )[:prs]
  end

  def fetch_reviewed_by_me
    fetch_pr_list(
      "pr", "list",
      "--search", "reviewed-by:@me",
      "--json", pr_fields,
      "--limit", PR_FETCH_LIMIT.to_s,
      review_status: "reviewed_by_me"
    )[:prs]
  end

  def fetch_open_pull_requests
    fetch_open_pull_requests_with_metadata[:prs]
  end

  def fetch_open_pull_requests_with_metadata
    fetch_pr_list(
      "pr", "list",
      "--state", "open",
      "--json", pr_fields,
      "--limit", PR_FETCH_LIMIT.to_s,
      review_status: "pending_review"
    )
  end

  def fetch_all_prs_needing_attention
    review_requests = fetch_review_requests
    reviewed = fetch_reviewed_by_me
    only_requested = Setting.only_requested_reviews?
    open_fetch = only_requested ? { prs: review_requests, complete: false } : fetch_open_pull_requests_with_metadata
    open_prs = open_fetch[:prs]

    requested_ids = review_requests.map { |pr| pr[:github_id] }.to_set
    reviewed_ids = reviewed.map { |pr| pr[:github_id] }.to_set

    # Keep PRs in pending when review has been requested again.
    pending = open_prs.reject do |pr|
      reviewed_ids.include?(pr[:github_id]) && !requested_ids.include?(pr[:github_id])
    end
    pending_ids = pending.map { |pr| pr[:github_id] }.to_set
    reviewed_only = reviewed.reject { |pr| pending_ids.include?(pr[:github_id]) }

    {
      pending_review: pending,
      reviewed_by_me: reviewed_only,
      open_prs_complete: open_fetch[:complete]
    }
  end

  def sync_to_database!
    prs = fetch_all_prs_needing_attention

    ActiveRecord::Base.transaction do
      sync_prs(prs[:pending_review], "pending_review")
      sync_prs(prs[:reviewed_by_me], "reviewed_by_me")
      remove_stale_prs(prs) if should_reconcile_stale_prs?(prs)
      mark_reviewed_by_others
    end
  end

  def latest_my_review_state(pull_request)
    json = run_gh_command("api", "/repos/#{pull_request.repo_full_name}/pulls/#{pull_request.number}/reviews")
    reviews = JSON.parse(json)

    my_reviews = reviews.select do |review|
      review.dig("user", "login") == @username && review["submitted_at"].present?
    end
    return nil if my_reviews.empty?

    latest = my_reviews.max_by { |review| Time.zone.parse(review["submitted_at"]) }
    latest["state"]
  end

  def review_requested_for_me?(pull_request)
    json = run_gh_command("api", "/repos/#{pull_request.repo_full_name}/pulls/#{pull_request.number}")
    payload = JSON.parse(json)
    requested_reviewers = payload["requested_reviewers"] || []

    requested_reviewers.any? { |reviewer| reviewer["login"] == @username }
  end

  def fetch_pr_comments(pull_request)
    json = run_gh_command(
      "api",
      "/repos/#{pull_request.repo_full_name}/pulls/#{pull_request.number}/comments"
    )
    return [] if json.strip.empty?

    comments = JSON.parse(json)
    comments.map do |c|
      {
        body: c["body"],
        author: c.dig("user", "login"),
        created_at: c["created_at"],
        path: c["path"],
        line: c["line"]
      }
    end
  rescue JSON::ParserError
    []
  end

  def self.fetch_latest_for_repo(repo_path)
    return unless repo_path.present? && Dir.exist?(repo_path)

    stdout, stderr, status = Open3.capture3("git", "-C", repo_path, "fetch", "origin")
    unless status.success?
      message = stderr.presence || stdout.presence || "unknown error"
      raise Error, "git fetch failed: #{message.strip}"
    end

    stdout, stderr, status = Open3.capture3("git", "-C", repo_path, "pull", "--ff-only")
    unless status.success?
      message = stderr.presence || stdout.presence || "unknown error"
      raise Error, "git pull failed: #{message.strip}"
    end
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

    # Soft-delete stale records to avoid destructive data loss and preserve review history.
    return unless stale_prs.exists?

    stale_count = stale_prs.count
    Rails.logger.info "Removing #{stale_count} stale PR(s) from #{repo_info[:owner]}/#{repo_info[:name]}"

    stale_prs.update_all(deleted_at: Time.current, updated_at: Time.current)
    Rails.logger.info "Successfully soft-deleted #{stale_count} stale PR(s)"
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
    parse_pr_data(parse_pr_payload(json), review_status)
  end

  def fetch_pr_list(*args, review_status:)
    json = run_gh_command(*args)
    data = parse_pr_payload(json)
    {
      prs: parse_pr_data(data, review_status),
      complete: data.size < PR_FETCH_LIMIT
    }
  end

  def parse_pr_payload(json)
    return [] if json.to_s.strip.empty?

    JSON.parse(json)
  end

  def parse_pr_data(data, review_status)
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



  def should_reconcile_stale_prs?(fetched_prs)
    return false unless @repo_path.present?
    return false if Setting.only_requested_reviews?

    fetched_prs[:open_prs_complete] == true
  end


  def extract_github_id(url)
    url = url.to_s

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

  def sync_prs(prs, default_review_status)
    prs.each do |pr_data|
      pr = PullRequest.unscoped.find_or_initialize_by(github_id: pr_data[:github_id])

      synced_status = pr_data[:review_status] || default_review_status
      attrs = pr_data.dup
      attrs[:archived] = false
      attrs[:deleted_at] = nil

      # reviewed_by_me requires a local ReviewTask; keep external reviews visible in pending.
      if synced_status == "reviewed_by_me" && pr.review_task.blank?
        attrs[:review_status] = "pending_review"
        synced_status = "pending_review"
      end

      if should_reset_for_rerequest?(pr, synced_status)
        reset_for_rerequest!(pr)
        attrs[:review_status] = "pending_review"
      elsif pr.persisted? && pr.review_task.present?
        attrs.delete(:review_status)
      end

      pr.assign_attributes(attrs)
      pr.save!
    end
  end

  def should_reset_for_rerequest?(pull_request, synced_status)
    return false unless synced_status == "pending_review"

    task = pull_request.review_task
    return false unless task.present?

    %w[reviewed waiting_implementation done].include?(task.state)
  end

  def reset_for_rerequest!(pull_request)
    task = pull_request.review_task
    return unless task.present?

    task.move_backward!("pending_review")
    task.update!(submission_status: "pending_submission", submitted_at: nil)
  end

  def mark_reviewed_by_others
    return unless Setting.only_requested_reviews?

    # Only check PRs that don't have a review task
    # If a user explicitly queued a review, respect that
    pending_prs = PullRequest.pending_review.left_joins(:review_task).where(review_tasks: { id: nil })
    return if pending_prs.empty?

    # Get all open PRs with their review request data
    json = run_gh_command(
      "pr", "list",
      "--json", "number,state,reviewRequests",
      "--limit", PR_FETCH_LIMIT.to_s
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
