class Api::V1::ReviewTasksController < Api::V1::BaseController
  QUEUE_PROCESS_INTERVAL = 60.seconds

  before_action :set_review_task, only: %i[show update_state retry dequeue clear archive unarchive]

  def board
    process_queue_if_needed
    render_ok(Api::V1::UiPayloads::ReviewTaskBoard.new.as_json)
  end

  def show
    render_ok(Api::V1::UiPayloads::ReviewTaskDetail.new(@review_task).as_json)
  end

  def update_state
    new_state = params.require(:state)
    is_backward_move = params[:backward_move] == true || params[:backward_move] == "true"

    unless ReviewTask::STATES.include?(new_state)
      return render_error("invalid_input", "Invalid state", :unprocessable_entity)
    end

    if is_backward_move && @review_task.backward_movement?(new_state)
      @review_task.move_backward!(new_state)
    else
      @review_task.update!(state: new_state)
    end

    render_ok(mutation_payload(task: @review_task, message: "Task state updated"))
  rescue ActiveRecord::RecordInvalid => e
    render_error("invalid_input", e.record.errors.full_messages.join(", "), :unprocessable_entity)
  end

  def retry
    return render_error("invalid_input", "Can only retry failed reviews", :unprocessable_entity) unless @review_task.failed_review?
    return render_error("invalid_input", "Maximum retry attempts reached", :unprocessable_entity) unless @review_task.can_retry?
    return render_error("conflict", "Review already in progress", :unprocessable_entity) if ReviewTask.any_review_running?

    @review_task.retry_review!
    ReviewTaskJob.perform_later(@review_task.id, is_retry: true)

    render_ok(mutation_payload(task: @review_task, message: "Retry initiated"))
  end

  def dequeue
    return render_error("invalid_input", "Can only dequeue queued reviews", :unprocessable_entity) unless @review_task.queued?

    @review_task.dequeue!
    UiEventBroadcaster.review_task_updated(@review_task)

    render_ok(mutation_payload(task: @review_task, message: "Review removed from queue"))
  end

  def clear
    pull_request = @review_task.pull_request
    @review_task.destroy!
    pull_request.update!(review_status: "pending_review")
    UiEventBroadcaster.pull_request_updated(pull_request)

    render_ok(
      {
        message: "Review cleared",
        cleared_review_task_id: @review_task.id,
        pull_request_board: Api::V1::UiPayloads::PullRequestBoard.new.as_json,
        review_task_board: Api::V1::UiPayloads::ReviewTaskBoard.new.as_json
      }
    )
  end

  def archive
    @review_task.archive!
    UiEventBroadcaster.review_task_updated(@review_task)
    render_ok(mutation_payload(task: @review_task, message: "Review task archived"))
  end

  def unarchive
    @review_task.unarchive!
    UiEventBroadcaster.review_task_updated(@review_task)
    render_ok(mutation_payload(task: @review_task, message: "Review task restored"))
  end

  private

  def mutation_payload(task:, message:)
    {
      message: message,
      detail: Api::V1::UiPayloads::ReviewTaskDetail.new(task).as_json,
      review_task_board: Api::V1::UiPayloads::ReviewTaskBoard.new.as_json,
      pull_request_board: Api::V1::UiPayloads::PullRequestBoard.new.as_json
    }
  end

  def process_queue_if_needed
    return if Rails.cache.fetch("review_task_queue_processed", expires_in: QUEUE_PROCESS_INTERVAL) { false }

    ReviewTask.recover_orphaned_in_review_tasks!
    ReviewTask.process_queue_if_idle!
    Rails.cache.write("review_task_queue_processed", true, expires_in: QUEUE_PROCESS_INTERVAL)
  end

  def set_review_task
    @review_task = ReviewTask.find(params[:id])
  end
end
