class ReviewIteration < ApplicationRecord
  belongs_to :review_task

  validates :iteration_number, presence: true, uniqueness: { scope: :review_task_id }
  validates :cli_client, inclusion: { in: Setting::CLI_CLIENTS }
  validates :review_type, inclusion: { in: ReviewTask::REVIEW_TYPES }
  validates :from_state, :to_state, presence: true

  scope :chronological, -> { order(iteration_number: :asc) }
  scope :reverse_chronological, -> { order(iteration_number: :desc) }

  def duration_seconds
    return nil unless started_at && completed_at
    (completed_at - started_at).to_i
  end

  def swarm_review?
    review_type == "swarm"
  end
end
