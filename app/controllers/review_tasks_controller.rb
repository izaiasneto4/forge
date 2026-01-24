class ReviewTasksController < ApplicationController
  before_action :set_review_task, only: %i[show update_state]

  def index
    @review_tasks = ReviewTask.includes(:pull_request).order(created_at: :desc)
    @grouped_tasks = {
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
    @review_task.state = "pending_review"
    @review_task.cli_client = cli_client
    @review_task.review_type = review_type
    @review_task.save!

    ReviewTaskJob.perform_later(@review_task.id)

    respond_to do |format|
      format.html { redirect_to review_tasks_path, notice: "Review started for PR ##{pull_request.number}" }
      format.turbo_stream
    end
  end

  def update_state
    new_state = params[:state]
    is_backward_move = params[:backward_move] == true || params[:backward_move] == "true"

    if ReviewTask::STATES.include?(new_state)
      if is_backward_move && @review_task.backward_movement?(new_state)
        @review_task.move_backward!(new_state)
      else
        @review_task.update!(state: new_state)
      end

      respond_to do |format|
        format.turbo_stream
        format.html { redirect_to review_tasks_path, notice: "Task state updated" }
        format.json { head :ok }
      end
    else
      respond_to do |format|
        format.turbo_stream { head :unprocessable_entity }
        format.html { redirect_to review_tasks_path, alert: "Invalid state" }
        format.json { head :unprocessable_entity }
      end
    end
  end

  private

  def set_review_task
    @review_task = ReviewTask.find(params[:id])
  end
end
