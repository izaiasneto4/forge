class PullRequestsController < ApplicationController
  def index
    @current_repo = Setting.current_repo
    @pending_review = PullRequest.pending_review.includes(:review_task).order(updated_at_github: :desc)
    @in_review = PullRequest.in_review.includes(:review_task).order(updated_at_github: :desc)
    @reviewed_by_me = PullRequest.reviewed_by_me.includes(:review_task).order(updated_at_github: :desc)
    @reviewed_by_others = PullRequest.reviewed_by_others.includes(:review_task).order(updated_at_github: :desc)
    @review_failed = PullRequest.review_failed.includes(:review_task).order(updated_at_github: :desc)
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
    pr_ids = params[:pull_request_ids] || []

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

    deleted_count = 0
    ActiveRecord::Base.transaction do
      pull_requests = PullRequest.where(id: pr_ids)
      pull_requests.each do |pr|
        pr.soft_delete!
        deleted_count += 1
      end
    end

    respond_to do |format|
      format.turbo_stream { render_sync_stream(notice: "#{deleted_count} pull requests deleted") }
      format.html { redirect_to pull_requests_path, notice: "#{deleted_count} pull requests deleted" }
      format.json { render json: { deleted_count: deleted_count } }
    end
  rescue => e
    respond_to do |format|
      format.turbo_stream { render_sync_stream(alert: "Failed to delete: #{e.message}") }
      format.html { redirect_to pull_requests_path, alert: "Failed to delete: #{e.message}" }
      format.json { render json: { error: e.message }, status: :unprocessable_entity }
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
    seconds = Setting.seconds_until_sync_allowed
    minutes = (seconds / 60.0).ceil
    time_msg = minutes > 1 ? "#{minutes} minutes" : "#{seconds} seconds"
    notice = "Using cached data (next sync available in #{time_msg})"

    render turbo_stream: [
      turbo_stream.replace("flash-messages", partial: "shared/flash", locals: { notice: notice }),
      turbo_stream.replace("sync-status", partial: "pull_requests/sync_status")
    ]
  end

  def render_sync_stream(notice: nil, alert: nil)
    pending_review = PullRequest.pending_review.includes(:review_task).order(updated_at_github: :desc)
    in_review = PullRequest.in_review.includes(:review_task).order(updated_at_github: :desc)
    reviewed_by_me = PullRequest.reviewed_by_me.includes(:review_task).order(updated_at_github: :desc)
    reviewed_by_others = PullRequest.reviewed_by_others.includes(:review_task).order(updated_at_github: :desc)
    review_failed = PullRequest.review_failed.includes(:review_task).order(updated_at_github: :desc)

    streams = [
      turbo_stream.replace("pr-columns", partial: "pull_requests/columns", locals: {
        pending_review: pending_review,
        in_review: in_review,
        reviewed_by_me: reviewed_by_me,
        reviewed_by_others: reviewed_by_others,
        review_failed: review_failed
      }),
      turbo_stream.update("pr-count", "#{pending_review.count + in_review.count + reviewed_by_me.count + reviewed_by_others.count + review_failed.count} pull requests"),
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
