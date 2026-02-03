class ProcessReviewQueueJob < ApplicationJob
  queue_as :default

  def perform
    return if ReviewTask.any_review_running?

    ReviewTask.start_next_queued!
  end
end
