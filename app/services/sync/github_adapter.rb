require "digest"
require "json"
require "open3"

module Sync
  class GithubAdapter
    class Error < StandardError; end

    PR_FETCH_LIMIT = 1000
    PR_FIELDS = %w[
      additions
      author
      baseRefName
      baseRefOid
      body
      changedFiles
      closedAt
      createdAt
      deletions
      headRefName
      headRefOid
      headRepositoryOwner
      isDraft
      latestReviews
      mergedAt
      number
      reviewDecision
      reviewRequests
      state
      statusCheckRollup
      title
      updatedAt
      url
    ].freeze

    attr_reader :github_login, :repo_slug

    def initialize(repo_path:, github_login: nil)
      @repo_path = repo_path
      @repo_slug = RepoSlugResolver.from_path(repo_path)
      @github_login = github_login.presence || fetch_current_user
    end

    def fetch_open_pull_requests
      data = fetch_pr_list(
        "pr", "list",
        "--state", "open",
        "--json", PR_FIELDS.join(","),
        "--limit", PR_FETCH_LIMIT.to_s
      )

      {
        prs: data.map { |pr| parse_pr(pr) },
        complete: data.size < PR_FETCH_LIMIT
      }
    end

    def fetch_pull_request(number)
      json = run_gh_command(
        "pr", "view", number.to_s,
        "--json", PR_FIELDS.join(",")
      )

      parse_pr(JSON.parse(json))
    rescue JSON::ParserError => e
      raise Error, "GitHub response parse failed: #{e.message}"
    rescue Error => e
      return nil if e.message.include?("no pull requests found") || e.message.include?("Could not resolve to a PullRequest")

      raise
    end

    private

    def fetch_current_user
      run_gh_command("api", "user", "--jq", ".login").strip
    end

    def fetch_pr_list(*args)
      json = run_gh_command(*args)
      return [] if json.to_s.strip.empty?

      JSON.parse(json)
    rescue JSON::ParserError => e
      raise Error, "GitHub response parse failed: #{e.message}"
    end

    def parse_pr(pr)
      url = pr["url"].to_s
      url_parts = url.match(%r{github\.com/([^/]+)/([^/]+)/pull/})
      remote_state = extract_remote_state(pr)

      {
        github_id: extract_github_id(url),
        number: pr["number"],
        title: pr["title"],
        description: pr["body"],
        url: url,
        repo_owner: url_parts&.[](1) || pr.dig("headRepositoryOwner", "login"),
        repo_name: url_parts&.[](2),
        author: pr.dig("author", "login"),
        author_avatar: pr.dig("author", "avatarUrl"),
        created_at_github: pr["createdAt"],
        updated_at_github: pr["updatedAt"],
        additions: pr["additions"],
        deletions: pr["deletions"],
        changed_files: pr["changedFiles"],
        review_requested_for_me: review_requested_for_me?(pr["reviewRequests"]),
        remote_state: remote_state,
        inactive_reason: inactive_reason_for(remote_state),
        head_sha: pr["headRefOid"],
        base_sha: pr["baseRefOid"],
        head_ref: pr["headRefName"],
        base_ref: pr["baseRefName"],
        merged_at_github: pr["mergedAt"],
        closed_at_github: pr["closedAt"],
        latest_review_state: latest_review_state_for_me(pr["latestReviews"]),
        review_decision: pr["reviewDecision"],
        check_status: summarize_checks(pr["statusCheckRollup"]),
        draft: pr["isDraft"] == true
      }
    end

    def extract_remote_state(pr)
      state = pr["state"].to_s.upcase
      return "merged" if pr["mergedAt"].present? || state == "MERGED"
      return "closed" if pr["closedAt"].present? || state == "CLOSED"

      "open"
    end

    def inactive_reason_for(remote_state)
      case remote_state
      when "merged" then "merged"
      when "closed" then "closed"
      when "inaccessible" then "inaccessible"
      end
    end

    def review_requested_for_me?(review_requests)
      Array(review_requests).any? do |request|
        request_login(request).to_s.casecmp?(@github_login.to_s)
      end
    end

    def request_login(request)
      request["login"] ||
        request.dig("requestedReviewer", "login") ||
        request.dig("requestedReviewer", "user", "login")
    end

    def latest_review_state_for_me(latest_reviews)
      review = Array(latest_reviews).reverse.find do |entry|
        review_author_login(entry).to_s.casecmp?(@github_login.to_s)
      end

      review&.[]("state")
    end

    def review_author_login(review)
      review.dig("author", "login") ||
        review.dig("author", "author", "login") ||
        review.dig("user", "login")
    end

    def summarize_checks(status_rollup)
      values = Array(status_rollup).map do |entry|
        entry["state"] || entry.dig("context", "state") || entry["conclusion"]
      end.compact.map(&:upcase)

      return nil if values.empty?
      return "failure" if values.any? { |value| %w[FAILURE ERROR TIMED_OUT CANCELLED ACTION_REQUIRED].include?(value) }
      return "pending" if values.any? { |value| %w[PENDING QUEUED IN_PROGRESS EXPECTED WAITING].include?(value) }

      "success"
    end

    def extract_github_id(url)
      if url =~ %r{github\.com/([^/]+)/([^/]+)/pull/(\d+)}
        Digest::SHA256.hexdigest("#{$1}/#{$2}/#{$3}").to_i(16) % (2**62)
      else
        Digest::SHA256.hexdigest(url).to_i(16) % (2**62)
      end
    end

    def run_gh_command(*args)
      options = {}
      options[:chdir] = @repo_path if @repo_path.present? && Dir.exist?(@repo_path)

      stdout, stderr, status = Open3.capture3("gh", *args, **options)
      unless status.success?
        raise Error, stderr.presence || stdout.presence || "GitHub CLI error"
      end

      stdout
    end
  end
end
