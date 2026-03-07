class PullRequestBroadcaster
  def initialize(pull_request)
    @pull_request = pull_request
  end

  def broadcast_status_change
    previous_status = @pull_request.review_status_before_last_save
    Rails.logger.info "[PullRequest##{@pull_request.id}] Broadcasting status change: #{previous_status} -> #{@pull_request.review_status}"

    UiEventBroadcaster.pull_request_updated(@pull_request, previous_status: previous_status)
  rescue => e
    Rails.logger.error "[PullRequest##{@pull_request.id}] Broadcast failed: #{e.message}"
  end
end
