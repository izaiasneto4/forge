class ReviewCommentsController < ApplicationController
  before_action :set_review_comment, only: %i[toggle]
  before_action :set_review_task, only: %i[submit]

  # PATCH /review_comments/:id/toggle
  # Toggles the status of a review comment through the status cycle:
  # pending -> addressed -> dismissed -> pending
  def toggle
    new_status = next_status(@review_comment.status)
    @review_comment.update!(status: new_status)

    respond_to do |format|
      format.html { redirect_back fallback_location: review_task_path(@review_comment.review_task) }
      format.turbo_stream
      format.json { render json: { status: @review_comment.status } }
    end
  end

  # POST /review_tasks/:review_task_id/review_comments/submit
  # Submits selected review comments to GitHub as a PR review
  def submit
    event = submit_params[:event].presence
    summary = submit_params[:summary].presence
    comment_ids = submit_params[:comment_ids]

    # If comment_ids provided, only submit those; otherwise fall back to all pending
    @selected_comments = if comment_ids.present?
      @review_task.review_comments.where(id: comment_ids)
    else
      @review_task.review_comments.pending
    end

    if @selected_comments.empty?
      respond_to do |format|
        format.html do
          redirect_to review_task_path(@review_task),
                      alert: "No comments selected for submission"
        end
        format.turbo_stream do
          @success = false
          @error = "No comments selected for submission"
        end
        format.json { render json: { success: false, error: "No comments selected" }, status: :unprocessable_entity }
      end
      return
    end

    submitter = GithubReviewSubmitter.new(review_task: @review_task)

    begin
      result = submitter.submit_review(event: event, summary: summary, comments: @selected_comments)

      # Mark submitted comments as addressed
      @selected_comments.update_all(status: "addressed")

      # Track submission status
      @review_task.mark_submitted!

      respond_to do |format|
        format.html do
          redirect_to review_task_path(@review_task),
                      notice: "Review submitted successfully to GitHub"
        end
        format.turbo_stream { @success = true }
        format.json { render json: { success: true, result: result } }
      end
    rescue GithubReviewSubmitter::Error => e
      # Track submission failure
      @review_task.mark_submission_failed!(e.message)

      respond_to do |format|
        format.html do
          redirect_to review_task_path(@review_task),
                      alert: "Failed to submit review: #{e.message}"
        end
        format.turbo_stream do
          @success = false
          @error = e.message
        end
        format.json { render json: { success: false, error: e.message }, status: :unprocessable_entity }
      end
    end
  end

  private

  def set_review_comment
    @review_comment = ReviewComment.find(params[:id])
  end

  def set_review_task
    @review_task = ReviewTask.find(params[:review_task_id])
  end

  def submit_params
    params.permit(:event, :summary, comment_ids: [])
  end

  # Cycles through statuses: pending -> addressed -> dismissed -> pending
  def next_status(current_status)
    case current_status
    when "pending" then "addressed"
    when "addressed" then "dismissed"
    when "dismissed" then "pending"
    else "pending"
    end
  end
end
