class ProcessReviewQueueJob < ApplicationJob
  queue_as :default

  def perform
    ReviewTask.claim_and_start_next_queued!
  end
end
