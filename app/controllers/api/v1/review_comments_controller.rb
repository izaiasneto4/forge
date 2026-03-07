class Api::V1::ReviewCommentsController < Api::V1::BaseController
  before_action :set_review_comment

  def toggle
    @review_comment.update!(status: next_status(@review_comment.status))

    render_ok(
      {
        detail: Api::V1::UiPayloads::ReviewTaskDetail.new(@review_comment.review_task).as_json
      }
    )
  end

  private

  def set_review_comment
    @review_comment = ReviewComment.find(params[:id])
  end

  def next_status(current_status)
    case current_status
    when "pending" then "addressed"
    when "addressed" then "dismissed"
    when "dismissed" then "pending"
    else "pending"
    end
  end
end
