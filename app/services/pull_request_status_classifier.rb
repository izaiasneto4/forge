class PullRequestStatusClassifier
  def self.call(pull_request)
    new(pull_request).call
  end

  def initialize(pull_request)
    @pull_request = pull_request
  end

  def call
    return @pull_request.review_status if @pull_request.inactive?

    return task_status if task.present?
    return "pending_review" if @pull_request.review_requested_for_me?
    return "reviewed_by_me" if @pull_request.latest_review_state.present?

    "reviewed_by_others"
  end

  private

  def task
    @task ||= @pull_request.review_task
  end

  def task_status
    return "review_failed" if task.failed_review?
    return "in_review" if task.in_review?
    return "waiting_implementation" if task.waiting_implementation?
    return "pending_review" if task.queued? || task.pending_review?

    if task.analysis_stale?
      "pending_review"
    elsif task.done? && task.submitted_event == "APPROVE"
      "reviewed_by_others"
    else
      "reviewed_by_me"
    end
  end
end
