class Api::V1::PullRequestsController < Api::V1::BaseController
  ALLOWED_STATUSES = %w[pending_review in_review reviewed_by_me reviewed_by_others review_failed all].freeze

  def index
    status = params[:status].presence || "all"
    return render_error("invalid_input", "status is invalid") unless ALLOWED_STATUSES.include?(status)

    limit = parse_integer(params[:limit], default: 50, min: 1, max: 200, name: "limit")

    scope = PullRequest.not_archived.order(updated_at_github: :desc)
    scope = scope.where(review_status: status) unless status == "all"

    items = scope.limit(limit).map do |pr|
      {
        id: pr.id,
        number: pr.number,
        title: pr.title,
        url: pr.url,
        repo: "#{pr.repo_owner}/#{pr.repo_name}",
        review_status: pr.review_status,
        updated_at_github: pr.updated_at_github&.iso8601
      }
    end

    render_ok({ items: items })
  rescue ArgumentError => e
    render_error("invalid_input", e.message)
  end
end
