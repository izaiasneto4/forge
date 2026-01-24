class ReviewTaskLogsChannel < ApplicationCable::Channel
  def subscribed
    review_task = ReviewTask.find(params[:review_task_id])
    stream_from "review_task_#{review_task.id}_logs"
  end

  def unsubscribed
    stop_all_streams
  end
end
