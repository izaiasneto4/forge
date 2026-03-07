class PullRequestSummaryJob < ApplicationJob
  queue_as :default

  def perform(snapshot_id)
    snapshot = PullRequestSnapshot.find(snapshot_id)
    PullRequestSummaryService.new(snapshot: snapshot).generate!
  rescue ActiveRecord::RecordNotFound
    nil
  end
end
