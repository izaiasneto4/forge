class FileTriageJob < ApplicationJob
  queue_as :default

  def perform(snapshot_id)
    snapshot = PullRequestSnapshot.find(snapshot_id)
    FileTriageService.new(snapshot: snapshot).generate!
  rescue ActiveRecord::RecordNotFound
    nil
  rescue FileTriageService::Error, JevClient::Error
    nil
  end
end
