class ReviewTasksController < ApplicationController
  before_action :set_review_task, only: %i[show update_state retry dequeue]

  def index
    @review_tasks = ReviewTask.includes(:pull_request).order(created_at: :desc)
    @grouped_tasks = {
      queued: @review_tasks.queued,
      pending_review: @review_tasks.pending_review,
      in_review: @review_tasks.in_review,
      reviewed: @review_tasks.reviewed,
      waiting_implementation: @review_tasks.waiting_implementation,
      done: @review_tasks.done,
      failed_review: @review_tasks.failed_review
    }
  end

  def show
    respond_to do |format|
      format.html
      format.turbo_stream
    end
  end

  def create
    pull_request = PullRequest.find(params[:pull_request_id])
    cli_client = params[:cli_client].presence || Setting.default_cli_client
    review_type = params[:review_type].presence || "review"

    @review_task = pull_request.review_task || pull_request.build_review_task

    # Don't reset task if it's already being processed or has pending retries
    if @review_task.persisted? && @review_task.in_progress_or_retrying?
      return respond_to do |format|
        format.html { redirect_to review_tasks_path, alert: "Review already in progress for PR ##{pull_request.number}" }
        format.turbo_stream { head :unprocessable_entity }
      end
    end

    @review_task.cli_client = cli_client
    @review_task.review_type = review_type

    if ReviewTask.any_review_running?
      @review_task.state = "queued"
      @review_task.queued_at = Time.current
      @review_task.save!
      queue_position = @review_task.queue_position

      respond_to do |format|
        format.html { redirect_to review_tasks_path, notice: "Review queued (##{queue_position}) for PR ##{pull_request.number}" }
        format.turbo_stream
      end
    else
      @review_task.state = "pending_review"
      @review_task.save!
      ReviewTaskJob.perform_later(@review_task.id)

      respond_to do |format|
        format.html { redirect_to review_tasks_path, notice: "Review started for PR ##{pull_request.number}" }
        format.turbo_stream
      end
    end
  end

  def update_state
    new_state = params[:state]
    is_backward_move = params[:backward_move] == true || params[:backward_move] == "true"

    Rails.logger.info "[ReviewTasksController#update_state] Task ##{@review_task.id}: #{@review_task.state} → #{new_state}"

    if ReviewTask::STATES.include?(new_state)
      if is_backward_move && @review_task.backward_movement?(new_state)
        @review_task.move_backward!(new_state)
      else
        @review_task.update!(state: new_state)
      end

      Rails.logger.info "[ReviewTasksController#update_state] State updated successfully, rendering turbo_stream"

      respond_to do |format|
        format.turbo_stream
        format.html { redirect_to review_tasks_path, notice: "Task state updated" }
        format.json { head :ok }
      end
    else
      Rails.logger.error "[ReviewTasksController#update_state] Invalid state: #{new_state}"
      respond_to do |format|
        format.turbo_stream { head :unprocessable_entity }
        format.html { redirect_to review_tasks_path, alert: "Invalid state" }
        format.json { head :unprocessable_entity }
      end
    end
  end

  def retry
    unless @review_task.failed_review?
      return respond_to do |format|
        format.html { redirect_to review_tasks_path, alert: "Can only retry failed reviews" }
        format.turbo_stream { head :unprocessable_entity }
        format.json { render json: { error: "Can only retry failed reviews" }, status: :unprocessable_entity }
      end
    end

    unless @review_task.can_retry?
      return respond_to do |format|
        format.html { redirect_to review_tasks_path, alert: "Maximum retry attempts (#{ReviewTask::MAX_RETRY_ATTEMPTS}) reached" }
        format.turbo_stream { head :unprocessable_entity }
        format.json { render json: { error: "Maximum retry attempts reached" }, status: :unprocessable_entity }
      end
    end

    @review_task.retry_review!
    ReviewTaskJob.perform_later(@review_task.id, is_retry: true)

    respond_to do |format|
      format.html { redirect_to review_tasks_path, notice: "Retry initiated for PR ##{@review_task.pull_request.number}" }
      format.turbo_stream
      format.json { render json: { success: true, state: @review_task.state }, status: :ok }
    end
  end

  def dequeue
    unless @review_task.queued?
      return respond_to do |format|
        format.html { redirect_to review_tasks_path, alert: "Can only dequeue queued reviews" }
        format.turbo_stream { head :unprocessable_entity }
      end
    end

    @review_task.dequeue!

    respond_to do |format|
      format.html { redirect_to review_tasks_path, notice: "Review removed from queue" }
      format.turbo_stream
    end
  end

  private

  def set_review_task
    @review_task = ReviewTask.find(params[:id])
  end
end
