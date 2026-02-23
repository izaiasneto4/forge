class Api::V1::ReviewTaskLogsController < Api::V1::BaseController
  def show
    review_task = ReviewTask.find(params[:id])
    tail = parse_integer(params[:tail], default: 100, min: 1, max: 1000, name: "tail")
    after_id = params[:after_id].present? ? parse_integer(params[:after_id], default: 0, min: 1, max: 9_999_999, name: "after_id") : nil

    logs_scope = review_task.agent_logs.order(id: :asc)
    logs = if after_id
      logs_scope.where("id > ?", after_id).limit(tail)
    else
      logs_scope.order(id: :desc).limit(tail).to_a.reverse
    end

    render_ok(
      {
        task: {
          id: review_task.id,
          state: review_task.state,
          pull_request_number: review_task.pull_request.number
        },
        logs: logs.map do |log|
          {
            id: log.id,
            created_at: log.created_at.iso8601,
            log_type: log.log_type,
            message: log.message
          }
        end
      }
    )
  rescue ArgumentError => e
    render_error("invalid_input", e.message)
  end
end
