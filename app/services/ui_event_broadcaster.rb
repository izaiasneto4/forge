class UiEventBroadcaster
  STREAM = "ui_events".freeze

  class << self
    def broadcast(event, payload = {})
      ActionCable.server.broadcast(
        STREAM,
        payload.merge(
          event: event,
          timestamp: Time.current.iso8601
        )
      )
    end

    def pull_request_updated(pull_request, previous_status: nil)
      broadcast(
        "pull_request.updated",
        pull_request_id: pull_request.id,
        review_status: pull_request.review_status,
        previous_status: previous_status,
        repo: pull_request.repo_full_name
      )
    end

    def review_task_updated(review_task, previous_state: nil)
      broadcast(
        "review_task.updated",
        review_task_id: review_task.id,
        state: review_task.state,
        previous_state: previous_state,
        pull_request_id: review_task.pull_request_id,
        repo: review_task.pull_request&.repo_full_name
      )
    end

    def sync_completed(repo_path)
      broadcast(
        "sync.completed",
        repo_path: repo_path,
        repo: RepoSlugResolver.from_path(repo_path)
      )
    end

    def sync_failed(repo_path, error:)
      broadcast(
        "sync.failed",
        repo_path: repo_path,
        repo: RepoSlugResolver.from_path(repo_path),
        error: error
      )
    end
  end
end
