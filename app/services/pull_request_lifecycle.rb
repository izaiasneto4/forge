# Collapses PullRequest#review_status and ReviewTask#state into the single
# lifecycle the UI organizes around (inbox, reviewing, waiting, settled).
class PullRequestLifecycle
  STATES = %w[needs_review queued reviewing ready failed waiting settled authored].freeze

  def self.call(pull_request, github_login: Setting.github_login)
    new(pull_request, github_login: github_login).call
  end

  def initialize(pull_request, github_login:)
    @pull_request = pull_request
    @github_login = github_login
  end

  def call
    return "settled" if @pull_request.inactive?
    return task_lifecycle if task.present?
    return "authored" if authored_by_me?
    return "settled" if @pull_request.review_status == "reviewed_by_me"

    "needs_review"
  end

  def new_commits?
    task.present? && task.analysis_stale?
  end

  private

  def task
    @task ||= @pull_request.review_task
  end

  def authored_by_me?
    @github_login.present? && @pull_request.author.to_s.casecmp?(@github_login)
  end

  def task_lifecycle
    return "settled" if task.archived?

    case task.state
    when "queued" then "queued"
    when "in_review" then "reviewing"
    when "pending_review" then task.review_job_pending? ? "reviewing" : "needs_review"
    when "failed_review" then "failed"
    when "waiting_implementation" then "waiting"
    when "done" then new_commits? ? "needs_review" : "settled"
    else reviewed_lifecycle
    end
  end

  def reviewed_lifecycle
    return "ready" unless task.submitted?

    new_commits? ? "needs_review" : "settled"
  end
end
