require "open3"
require "digest"

module Sync
  class FetchAllPrs
    PR_FETCH_LIMIT = 1000

    def initialize(repo_path:, github_login: nil)
      @repo_path = repo_path
      @github_login = github_login || fetch_current_user
    end

    def call
      fetch_pending_review + fetch_reviewed_by_me
    end

    def call_with_open_prs
      pending = fetch_pending_review
      reviewed = fetch_reviewed_by_me

      requested_ids = pending.map { |pr| pr[:github_id] }.to_set
      reviewed_ids = reviewed.map { |pr| pr[:github_id] }.to_set

      open_prs = fetch_open_prs.reject do |pr|
        reviewed_ids.include?(pr[:github_id]) && !requested_ids.include?(pr[:github_id])
      end

      {
        pending_review: open_prs,
        reviewed_by_me: reviewed.reject { |pr| open_prs.any? { |o| o[:github_id] == pr[:github_id] } }
      }
    end

    private

    def fetch_current_user
      result = run_gh_command("api", "user", "--jq", ".login")
      result.strip
    end

    def fetch_pending_review
      prs = fetch_pr_list(
        "pr", "list",
        "--search", "review-requested:@me",
        "--json", pr_fields,
        "--limit", PR_FETCH_LIMIT.to_s
      )
      prs.map { |pr| pr.merge(review_status: "pending_review") }
    end

    def fetch_reviewed_by_me
      prs = fetch_pr_list(
        "pr", "list",
        "--search", "reviewed-by:@me",
        "--json", pr_fields,
        "--limit", PR_FETCH_LIMIT.to_s
      )
      prs.map { |pr| pr.merge(review_status: "reviewed_by_me") }
    end

    def fetch_open_prs
      fetch_pr_list(
        "pr", "list",
        "--state", "open",
        "--json", pr_fields,
        "--limit", PR_FETCH_LIMIT.to_s
      )
    end

    def fetch_pr_list(*args)
      json = run_gh_command(*args)
      return [] if json.to_s.strip.empty?

      data = JSON.parse(json)
      data.map { |pr| parse_pr(pr) }
    end

    def parse_pr(pr)
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
        updated_at_github: pr["updatedAt"]
      }
    end

    def pr_fields
      "number,title,body,url,author,headRepositoryOwner,headRefName,createdAt,updatedAt"
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
        raise Error, "GitHub CLI error: #{stderr}"
      end
      stdout
    end

    class Error < StandardError; end
  end

  FetchAllPRs = FetchAllPrs
end
