class Api::V1::ReviewTaskSubmissionsController < Api::V1::BaseController
  before_action :set_review_task

  def create
    event = submit_params[:event].presence
    summary = submit_params[:summary].presence
    comment_ids = submit_params[:comment_ids]
    force_empty_submission = ActiveModel::Type::Boolean.new.cast(submit_params[:force_empty_submission])

    selected_comments = selected_comments_for_submission(comment_ids, event, force_empty_submission)

    if selected_comments.empty? && !allow_empty_approval_submission?(event, summary, force_empty_submission)
      return render_error("invalid_input", "No comments selected for submission", :unprocessable_entity)
    end

    effective_event = resolve_review_event(event, selected_comments)
    submitter = GithubReviewSubmitter.new(review_task: @review_task)
    result = submitter.submit_review(event: effective_event, summary: summary, comments: selected_comments)

    selected_comments.update_all(status: "addressed")
    @review_task.mark_submitted!(event: effective_event)
    transition_review_lifecycle!(effective_event)

    render_ok(
      {
        message: "Review submitted successfully to GitHub",
        result: result,
        detail: Api::V1::UiPayloads::ReviewTaskDetail.new(@review_task).as_json,
        review_task_board: Api::V1::UiPayloads::ReviewTaskBoard.new.as_json,
        pull_request_board: Api::V1::UiPayloads::PullRequestBoard.new.as_json
      }
    )
  rescue GithubReviewSubmitter::Error => e
    @review_task.mark_submission_failed!(e.message)
    render_error("submission_failed", e.message, :unprocessable_entity)
  end

  private

  def set_review_task
    @review_task = ReviewTask.find(params[:id])
  end

  def submit_params
    params.permit(:event, :summary, :force_empty_submission, comment_ids: [])
  end

  def resolve_review_event(explicit_event, comments)
    return explicit_event if explicit_event.present?
    return "REQUEST_CHANGES" if comments.any? { |comment| comment.critical? || comment.major? }

    "COMMENT"
  end

  def selected_comments_for_submission(comment_ids, event, force_empty_submission)
    return @review_task.review_comments.none if force_empty_submission && event == "APPROVE"
    return @review_task.review_comments.where(id: comment_ids) if comment_ids.present?

    @review_task.review_comments.pending
  end

  def allow_empty_approval_submission?(event, summary, force_empty_submission)
    force_empty_submission && event == "APPROVE" && summary.blank?
  end

  def transition_review_lifecycle!(effective_event)
    if effective_event == "REQUEST_CHANGES"
      @review_task.mark_waiting_implementation!
      @review_task.pull_request.update!(review_status: "waiting_implementation")
    elsif effective_event == "APPROVE"
      @review_task.mark_done!
      @review_task.pull_request.update!(review_status: "reviewed_by_others")
    elsif @review_task.waiting_implementation?
      @review_task.update!(state: "reviewed")
      @review_task.pull_request.update!(review_status: "reviewed_by_me")
    else
      @review_task.pull_request.update!(review_status: "reviewed_by_me")
    end
  end
end
