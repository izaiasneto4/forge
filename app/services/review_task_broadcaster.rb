class ReviewTaskBroadcaster
  def initialize(review_task)
    @review_task = review_task
  end

  def broadcast_state_change
    Rails.logger.info "[ReviewTask##{@review_task.id}] Broadcasting state change to '#{@review_task.state}' (previous: #{@review_task.state_before_last_save}, new: #{@review_task.state})"

    Turbo::StreamsChannel.broadcast_stream_to(
      "review_tasks_board",
      content: ApplicationController.render(
        partial: "review_tasks/state_change_broadcast",
        locals: { review_task: @review_task }
      )
    )

    Rails.logger.info "[ReviewTask##{@review_task.id}] Broadcast completed"
  rescue => e
    Rails.logger.error "[ReviewTask##{@review_task.id}] Broadcast failed: #{e.message}"
    Rails.logger.error e.backtrace.join("\n")
  end
end
