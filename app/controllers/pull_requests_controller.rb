class PullRequestsController < ApplicationController
  def index
    ReviewTask.recover_orphaned_in_review_tasks!
    ReviewTask.process_queue_if_idle!
    @presenter = PullRequestIndexPresenter.new
    @current_repo = @presenter.current_repo
    @pending_review = @presenter.columns[:pending_review]
    @in_review = @presenter.columns[:in_review]
    @reviewed_by_me = @presenter.columns[:reviewed_by_me]
    @reviewed_by_others = @presenter.columns[:reviewed_by_others]
    @review_failed = @presenter.columns[:review_failed]
  end

  def sync
    force = params[:force] == "true" || params[:force] == "1"

    unless force || Setting.sync_needed?
      respond_to do |format|
        format.turbo_stream { render_sync_skipped_stream }
        format.html { redirect_to pull_requests_path, notice: "Using cached data" }
        format.json { render json: { skipped: true, seconds_remaining: Setting.seconds_until_sync_allowed, last_synced_at: Setting.last_synced_at&.iso8601 } }
      end
      return
    end

    repo_path = Setting.current_repo
    GithubCliService.fetch_latest_for_repo(repo_path) if repo_path.present?
    GithubCliService.new(repo_path: repo_path).sync_to_database!
    Setting.touch_last_synced!

    respond_to do |format|
      format.turbo_stream { render_sync_stream(notice: "Synced with GitHub") }
      format.html { redirect_to pull_requests_path, notice: "Synced with GitHub" }
      format.json { render json: { skipped: false, last_synced_at: Setting.last_synced_at&.iso8601 } }
    end
  rescue GithubCliService::Error => e
    respond_to do |format|
      format.turbo_stream { render_sync_stream(alert: "Sync failed: #{e.message}") }
      format.html { redirect_to pull_requests_path, alert: "Sync failed: #{e.message}" }
      format.json { render json: { error: e.message }, status: :unprocessable_entity }
    end
  end

  def update_status
    @pull_request = PullRequest.find(params[:id])
    if @pull_request.update(review_status: params[:review_status])
      respond_to do |format|
        format.turbo_stream
        format.html { redirect_to pull_requests_path, notice: "Status updated" }
        format.json { head :ok }
      end
    else
      respond_to do |format|
        format.turbo_stream { head :unprocessable_entity }
        format.html { redirect_to pull_requests_path, alert: "Failed to update status" }
        format.json { head :unprocessable_entity }
      end
    end
  end

  def bulk_destroy
    pr_ids = Array(params[:pull_request_ids]).reject(&:blank?)

    if pr_ids.empty?
      respond_to do |format|
        format.turbo_stream { head :bad_request }
        format.html { redirect_to pull_requests_path, alert: "No pull requests selected" }
        format.json { render json: { error: "No pull requests selected" }, status: :bad_request }
      end
      return
    end

    # Limit to 100 items for performance
    if pr_ids.size > 100
      respond_to do |format|
        format.turbo_stream { head :bad_request }
        format.html { redirect_to pull_requests_path, alert: "Cannot delete more than 100 pull requests at once" }
        format.json { render json: { error: "Cannot delete more than 100 pull requests at once" }, status: :bad_request }
      end
      return
    end

    ActiveRecord::Base.transaction do
      pull_requests = PullRequest.where(id: pr_ids)
      pull_requests.each(&:soft_delete!)
    end

    respond_to do |format|
      format.turbo_stream { render_sync_stream(notice: "#{pr_ids.size} pull requests deleted") }
      format.html { redirect_to pull_requests_path, notice: "#{pr_ids.size} pull requests deleted" }
      format.json { render json: { deleted_count: pr_ids.size } }
    end
  rescue => e
    respond_to do |format|
      format.turbo_stream { render_sync_stream(alert: "Failed to delete: #{e.message}") }
      format.html { redirect_to pull_requests_path, alert: "Failed to delete: #{e.message}" }
      format.json { render json: { error: e.message }, status: :unprocessable_entity }
    end
  end

  def archive
    @pull_request = PullRequest.find(params[:id])
    @pull_request.archive!

    respond_to do |format|
      format.turbo_stream
      format.html { redirect_to pull_requests_path, notice: "Pull request archived" }
    end
  end

  def unarchive
    @pull_request = PullRequest.find(params[:id])
    @pull_request.unarchive!

    respond_to do |format|
      format.turbo_stream
      format.html { redirect_to pull_requests_path, notice: "Pull request restored" }
    end
  end

  def async_sync
    SyncPullRequestsJob.perform_later

    respond_to do |format|
      format.turbo_stream { render turbo_stream: turbo_stream.replace("flash-messages", partial: "shared/flash", locals: { notice: "Sync started in background" }) }
      format.html { redirect_to pull_requests_path, notice: "Sync started in background" }
      format.json { render json: { status: "sync_started" } }
    end
  end

  private

  def render_sync_skipped_stream
    notice = PullRequestIndexPresenter.new.build_sync_skipped_message

    render turbo_stream: [
      turbo_stream.replace("flash-messages", partial: "shared/flash", locals: { notice: notice }),
      turbo_stream.replace("sync-status", partial: "pull_requests/sync_status")
    ]
  end

  def render_sync_stream(notice: nil, alert: nil)
    presenter = PullRequestIndexPresenter.new
    columns = presenter.columns

    streams = [
      turbo_stream.replace("pr-columns", partial: "pull_requests/columns", locals: columns),
      turbo_stream.update("pr-count", "#{presenter.total_count} pull requests"),
      turbo_stream.replace("sync-status", partial: "pull_requests/sync_status")
    ]

    if notice
      streams << turbo_stream.replace("flash-messages", partial: "shared/flash", locals: { notice: notice })
    elsif alert
      streams << turbo_stream.replace("flash-messages", partial: "shared/flash", locals: { alert: alert })
    end

    render turbo_stream: streams
  end
end
