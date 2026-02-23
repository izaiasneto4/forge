class Api::V1::ReviewsController < Api::V1::BaseController
  def create
    pr_url = params.require(:pr_url)
    parsed = PullRequestUrlParser.parse(pr_url)

    if parsed.nil?
      return render_error("invalid_input", "pr_url must be a valid GitHub pull request URL")
    end

    if (current_slug = RepoSlugResolver.from_path(Setting.current_repo)).present? && current_slug != parsed[:repo]
      return render_error("invalid_input", "PR repo #{parsed[:repo]} does not match current repo #{current_slug}")
    end

    pull_request = find_or_sync_pull_request(parsed)
    return render_error("not_found", "Pull request not found after sync", :not_found) if pull_request.nil?

    review_task = pull_request.review_task || pull_request.build_review_task

    if review_task.persisted? && review_task.in_progress_or_retrying?
      return render_error("conflict", "Review already in progress for PR ##{pull_request.number}", :conflict)
    end

    review_task.cli_client = params[:cli_client].presence || Setting.default_cli_client
    review_task.review_type = params[:review_type].presence || "review"

    if ReviewTask.any_review_running?
      review_task.state = "queued"
      review_task.queued_at = Time.current
      review_task.save!

      render_ok(
        {
          task_id: review_task.id,
          state: review_task.state,
          queue_position: review_task.queue_position,
          pull_request_id: pull_request.id
        },
        :created
      )
    else
      review_task.state = "pending_review"
      review_task.save!
      ReviewTaskJob.perform_later(review_task.id)

      render_ok(
        {
          task_id: review_task.id,
          state: review_task.state,
          queue_position: nil,
          pull_request_id: pull_request.id
        },
        :created
      )
    end
  rescue ActiveRecord::RecordInvalid => e
    render_error("invalid_input", e.record.errors.full_messages.join(", "))
  rescue GithubCliService::Error => e
    render_error("sync_failed", e.message)
  end

  private

  def find_or_sync_pull_request(parsed)
    pull_request = PullRequest.find_by(url: parsed[:url])
    return pull_request if pull_request

    repo_path = Setting.current_repo
    GithubCliService.fetch_latest_for_repo(repo_path) if repo_path.present?
    GithubCliService.new(repo_path: repo_path).sync_to_database!
    Setting.touch_last_synced!

    PullRequest.find_by(repo_owner: parsed[:owner], repo_name: parsed[:name], number: parsed[:number])
  end
end
