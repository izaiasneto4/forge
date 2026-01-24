class AgentLog < ApplicationRecord
  LOG_TYPES = %w[output error status].freeze

  belongs_to :review_task

  validates :log_type, inclusion: { in: LOG_TYPES }
  validates :message, presence: true

  scope :recent, -> { order(created_at: :asc) }

  after_create_commit :broadcast_to_review_task

  private

  def broadcast_to_review_task
    ActionCable.server.broadcast(
      "review_task_#{review_task_id}_logs",
      {
        id: id,
        log_type: log_type,
        message: message,
        created_at: created_at.iso8601
      }
    )
  end
end
