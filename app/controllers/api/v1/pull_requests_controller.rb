class Api::V1::PullRequestsController < Api::V1::BaseController
  ALLOWED_STATUSES = %w[pending_review in_review reviewed_by_me waiting_implementation reviewed_by_others review_failed all].freeze
  QUEUE_PROCESS_INTERVAL = 60.seconds

  def index
    status = params[:status].presence || "all"
    return render_error("invalid_input", "status is invalid") unless ALLOWED_STATUSES.include?(status)

    limit = parse_integer(params[:limit], default: 50, min: 1, max: 200, name: "limit")

    scope = PullRequest.for_current_repo(Setting.current_repo).not_archived.order(updated_at_github: :desc)
    scope = scope.where(review_status: status) unless status == "all"

    items = scope.limit(limit).map do |pr|
      {
        id: pr.id,
        number: pr.number,
        title: pr.title,
        url: pr.url,
        repo: "#{pr.repo_owner}/#{pr.repo_name}",
        review_status: pr.review_status,
        updated_at_github: pr.updated_at_github&.iso8601
      }
    end

    render_ok({ items: items })
  rescue ArgumentError => e
    render_error("invalid_input", e.message)
  end

  def board
    process_queue_if_needed
    render_ok(Api::V1::UiPayloads::PullRequestBoard.new.as_json)
  end

  def sync
    force = parse_boolean(params[:force])

    unless force || Setting.sync_needed?
      return render_ok(
        {
          message: PullRequestIndexPresenter.new.build_sync_skipped_message,
          board: Api::V1::UiPayloads::PullRequestBoard.new.as_json
        }
      )
    end

    repo_path = Setting.current_repo
    refresh_error = refresh_local_repo(repo_path)
    GithubCliService.new(repo_path: repo_path).sync_to_database!
    Setting.touch_last_synced!

    message = "Synced with GitHub"
    message += " (local repo refresh skipped)" if refresh_error.present?

    render_ok(
      {
        message: message,
        board: Api::V1::UiPayloads::PullRequestBoard.new.as_json
      }
    )
  rescue ArgumentError => e
    render_error("invalid_input", e.message)
  rescue GithubCliService::Error => e
    render_error("sync_failed", e.message)
  end

  def review_scope
    only_requested = parse_boolean(params[:requested_to_me_only])
    Setting.only_requested_reviews = only_requested

    repo_path = Setting.current_repo
    refresh_error = refresh_local_repo(repo_path)
    GithubCliService.new(repo_path: repo_path).sync_to_database!
    Setting.touch_last_synced!

    mode_label = only_requested ? "requested to me only" : "all open PRs"
    message = "Review scope updated: #{mode_label}"
    message += " (local repo refresh skipped)" if refresh_error.present?

    render_ok(
      {
        message: message,
        board: Api::V1::UiPayloads::PullRequestBoard.new.as_json
      }
    )
  rescue ArgumentError => e
    render_error("invalid_input", e.message)
  rescue GithubCliService::Error => e
    render_error("sync_failed", e.message)
  end

  def update_status
    pull_request = PullRequest.find(params[:id])
    previous_status = pull_request.review_status
    pull_request.update!(review_status: params.require(:review_status))
    UiEventBroadcaster.pull_request_updated(pull_request, previous_status: previous_status)

    render_ok(
      {
        message: "Status updated",
        board: Api::V1::UiPayloads::PullRequestBoard.new.as_json
      }
    )
  rescue ActiveRecord::RecordInvalid => e
    render_error("invalid_input", e.record.errors.full_messages.join(", "), :unprocessable_entity)
  end

  def archive
    pull_request = PullRequest.find(params[:id])
    pull_request.archive!
    UiEventBroadcaster.pull_request_updated(pull_request)

    render_ok(
      {
        message: "Pull request archived",
        board: Api::V1::UiPayloads::PullRequestBoard.new.as_json
      }
    )
  end

  def unarchive
    pull_request = PullRequest.find(params[:id])
    pull_request.unarchive!
    UiEventBroadcaster.pull_request_updated(pull_request)

    render_ok(
      {
        message: "Pull request restored",
        board: Api::V1::UiPayloads::PullRequestBoard.new.as_json
      }
    )
  end

  def bulk_destroy
    pr_ids = Array(params[:pull_request_ids]).reject(&:blank?)
    return render_error("invalid_input", "No pull requests selected", :bad_request) if pr_ids.empty?
    return render_error("invalid_input", "Cannot delete more than 100 pull requests at once", :bad_request) if pr_ids.size > 100

    deleted_count = PullRequest.where(id: pr_ids).update_all(deleted_at: Time.current, updated_at: Time.current)
    UiEventBroadcaster.broadcast("pull_request.bulk_deleted", pull_request_ids: pr_ids)

    render_ok(
      {
        message: "#{deleted_count} pull requests deleted",
        deleted_count: deleted_count,
        board: Api::V1::UiPayloads::PullRequestBoard.new.as_json
      }
    )
  rescue StandardError => e
    render_error("invalid_input", e.message, :unprocessable_entity)
  end

  def create_review_task
    process_queue_if_needed
    pull_request = PullRequest.find(params[:id])
    cli_client = params[:cli_client].presence || Setting.default_cli_client
    review_type = params[:review_type].presence || "review"

    review_task = pull_request.review_task || pull_request.build_review_task

    if review_task.persisted? && review_task.in_progress_or_retrying?
      return render_error("conflict", "Review already in progress for PR ##{pull_request.number}", :conflict)
    end

    review_task.cli_client = cli_client
    review_task.review_type = review_type

    if ReviewTask.any_review_running?
      review_task.state = "queued"
      review_task.queued_at = Time.current
      review_task.save!
      message = "Review queued (##{review_task.queue_position}) for PR ##{pull_request.number}"
    else
      review_task.state = "pending_review"
      review_task.save!
      ReviewTaskJob.perform_later(review_task.id)
      message = "Review started for PR ##{pull_request.number}"
    end

    render_ok(
      {
        message: message,
        detail: Api::V1::UiPayloads::ReviewTaskDetail.new(review_task).as_json,
        review_task_board: Api::V1::UiPayloads::ReviewTaskBoard.new.as_json,
        pull_request_board: Api::V1::UiPayloads::PullRequestBoard.new.as_json
      },
      :created
    )
  rescue ActiveRecord::RecordInvalid => e
    render_error("invalid_input", e.record.errors.full_messages.join(", "), :unprocessable_entity)
  end

  private

  def process_queue_if_needed
    return if Rails.cache.fetch("review_task_queue_processed", expires_in: QUEUE_PROCESS_INTERVAL) { false }

    ReviewTask.recover_orphaned_in_review_tasks!
    ReviewTask.process_queue_if_idle!
    Rails.cache.write("review_task_queue_processed", true, expires_in: QUEUE_PROCESS_INTERVAL)
  end

  def refresh_local_repo(repo_path)
    return if repo_path.blank?

    GithubCliService.fetch_latest_for_repo(repo_path)
    nil
  rescue GithubCliService::Error => e
    Rails.logger.warn("Local repo refresh skipped for #{repo_path}: #{e.message}")
    e.message
  end
end
