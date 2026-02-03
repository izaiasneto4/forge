class ReviewTask < ApplicationRecord
  STATES = %w[queued pending_review in_review reviewed waiting_implementation done failed_review].freeze
  REVIEW_TYPES = %w[review swarm].freeze
  MAX_RETRY_ATTEMPTS = 3
  BACKOFF_BASE_SECONDS = 2

  # State order for detecting backward movement (lower index = earlier in workflow)
  STATE_ORDER = %w[queued pending_review in_review reviewed waiting_implementation done].freeze

  belongs_to :pull_request
  has_many :agent_logs, dependent: :destroy
  has_many :review_comments, dependent: :destroy
  has_many :review_iterations, dependent: :destroy

  before_destroy :reset_pull_request_status
  after_commit :broadcast_state_change, if: :saved_change_to_state?

  validates :state, inclusion: { in: STATES }
  validates :cli_client, inclusion: { in: Setting::CLI_CLIENTS }
  validates :review_type, inclusion: { in: REVIEW_TYPES }

  scope :queued, -> { where(state: "queued").order(:queued_at) }
  scope :pending_review, -> { where(state: "pending_review") }
  scope :in_review, -> { where(state: "in_review") }
  scope :reviewed, -> { where(state: "reviewed") }
  scope :waiting_implementation, -> { where(state: "waiting_implementation") }
  scope :done, -> { where(state: "done") }
  scope :failed_review, -> { where(state: "failed_review") }

  def queued?
    state == "queued"
  end

  def pending_review?
    state == "pending_review"
  end

  def in_review?
    state == "in_review"
  end

  def reviewed?
    state == "reviewed"
  end

  def waiting_implementation?
    state == "waiting_implementation"
  end

  def done?
    state == "done"
  end

  def failed_review?
    state == "failed_review"
  end

  # Check if task is actively being processed or has pending retries
  def in_progress_or_retrying?
    return true if in_review?
    return true if pending_review? && retry_count > 0
    return true if last_retry_at.present? && last_retry_at > 5.minutes.ago
    false
  end

  def swarm_review?
    review_type == "swarm"
  end

  def enqueue!
    update!(state: "queued", queued_at: Time.current)
  end

  def dequeue!
    update!(state: "pending_review", queued_at: nil)
  end

  def queue_position
    return nil unless queued?
    self.class.queued.where("queued_at < ?", queued_at).count + 1
  end

  def self.any_review_running?
    in_review.exists?
  end

  def self.start_next_queued!
    next_task = queued.first
    return unless next_task

    next_task.dequeue!
    ReviewTaskJob.perform_later(next_task.id)
    next_task
  end

  def start_review!
    update!(state: "in_review", started_at: Time.current)
    if pull_request.pending_review? || pull_request.review_failed?
      pull_request.update!(review_status: "in_review")
    end
  end

  def complete_review!(output)
    update!(state: "reviewed", review_output: output, completed_at: Time.current)
    pull_request.update!(review_status: "reviewed_by_me") if pull_request.pending_review? || pull_request.in_review?
  end

  def mark_waiting_implementation!
    update!(state: "waiting_implementation")
  end

  def mark_done!
    update!(state: "done")
  end

  def mark_failed!(reason)
    record_retry_history(reason, permanent: true)
    update!(
      state: "failed_review",
      failure_reason: reason,
      completed_at: Time.current
    )
    pull_request.update!(review_status: "review_failed")
  end

  def retry_review!
    raise "Cannot retry: not in failed state" unless failed_review?
    raise "Cannot retry: max attempts reached" unless can_retry?

    update!(
      state: "pending_review",
      started_at: nil,
      completed_at: nil,
      worktree_path: nil
    )
    pull_request.update!(review_status: "pending_review")
  end

  def can_retry?
    retry_count < MAX_RETRY_ATTEMPTS
  end

  def retries_exhausted?
    retry_count >= MAX_RETRY_ATTEMPTS
  end

  def increment_retry!(reason)
    record_retry_history(reason)
    update!(
      retry_count: retry_count + 1,
      last_retry_at: Time.current,
      failure_reason: reason
    )
  end

  def reset_retry_state!
    update!(
      retry_count: 0,
      last_retry_at: nil,
      failure_reason: nil,
      retry_history: nil
    )
  end

  def backoff_seconds
    BACKOFF_BASE_SECONDS ** (retry_count + 1)
  end

  def parsed_retry_history
    return [] if retry_history.blank?
    JSON.parse(retry_history)
  rescue JSON::ParserError
    []
  end

  def parsed_review_items
    return [] if review_output.blank?
    ReviewOutputParser.parse(review_output)
  end

  def add_log(message, log_type: "output")
    return if message.blank?
    agent_logs.create!(message: message, log_type: log_type)
  end

  def clear_logs!
    agent_logs.destroy_all
  end

  # Check if moving from current state to new_state is a backward movement
  def backward_movement?(new_state)
    return false if new_state == "failed_review" # Failed is special, not in workflow
    return false unless STATE_ORDER.include?(state) && STATE_ORDER.include?(new_state)

    new_index = STATE_ORDER.index(new_state)
    current_index = STATE_ORDER.index(state)

    new_index < current_index
  end

  # Archive current review data as a new iteration before moving backward
  def archive_current_review!
    return unless review_output.present? || review_comments.any?

    next_iteration = (review_iterations.maximum(:iteration_number) || 0) + 1

    review_iterations.create!(
      iteration_number: next_iteration,
      review_output: review_output,
      cli_client: cli_client,
      review_type: review_type,
      ai_model: ai_model,
      from_state: state,
      to_state: "archived",
      started_at: started_at,
      completed_at: completed_at
    )
  end

  # Clear current review data after archiving
  def reset_for_new_review!
    review_comments.destroy_all
    agent_logs.destroy_all
    update!(
      review_output: nil,
      ai_model: nil,
      started_at: nil,
      completed_at: nil,
      failure_reason: nil,
      retry_count: 0,
      retry_history: nil
    )
  end

  # Move backward with history preservation
  def move_backward!(new_state)
    return false unless backward_movement?(new_state)

    transaction do
      archive_current_review!
      reset_for_new_review!
      update!(state: new_state)
    end

    true
  end

  # Get the current iteration number (0 if no prior iterations)
  def current_iteration_number
    review_iterations.count
  end

  # Get all review iterations in chronological order
  def review_history
    review_iterations.chronological
  end

  # Check if there are prior review iterations
  def has_review_history?
    review_iterations.exists?
  end

  # Detect and reset tasks stuck in in_review state
  # A task is considered stuck if:
  # - It's in "in_review" state
  # - It's been more than `timeout_minutes` since started_at
  # - No agent_logs in the last `timeout_minutes`
  def self.reset_stuck_tasks(timeout_minutes: 10)
    stuck_threshold = timeout_minutes.minutes.ago
    reset_count = 0

    in_review.where("started_at < ?", stuck_threshold).find_each do |task|
      last_log = task.agent_logs.order(created_at: :desc).first
      last_activity = last_log&.created_at || task.started_at

      if last_activity < stuck_threshold
        Rails.logger.info("Resetting stuck review task #{task.id} (last activity: #{last_activity})")
        task.update!(
          state: "pending_review",
          started_at: nil,
          worktree_path: nil,
          failure_reason: "Reset: task was stuck in review for over #{timeout_minutes} minutes"
        )
        task.agent_logs.destroy_all
        reset_count += 1
      end
    end

    reset_count
  end

  private

  def reset_pull_request_status
    # When review_task is destroyed, reset PR to pending_review if it was in a reviewed state
    # This prevents orphaned "reviewed" status without actual review data
    if pull_request&.review_status.in?(%w[reviewed_by_me in_review review_failed])
      pull_request.update_column(:review_status, "pending_review")
    end
  end

  def record_retry_history(reason, permanent: false)
    history = parsed_retry_history
    history << {
      attempt: retry_count + 1,
      reason: reason,
      timestamp: Time.current.iso8601,
      permanent: permanent
    }
    self.retry_history = history.to_json
  end

  def broadcast_state_change
    Rails.logger.info "[ReviewTask##{id}] Broadcasting state change to 'in_review' (previous: #{state_before_last_save}, new: #{state})"

    Turbo::StreamsChannel.broadcast_stream_to(
      "review_tasks_board",
      content: ApplicationController.render(
        partial: "review_tasks/state_change_broadcast",
        locals: { review_task: self }
      )
    )

    Rails.logger.info "[ReviewTask##{id}] Broadcast completed"
  rescue => e
    Rails.logger.error "[ReviewTask##{id}] Broadcast failed: #{e.message}"
    Rails.logger.error e.backtrace.join("\n")
  end
end
