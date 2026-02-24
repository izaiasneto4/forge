class RepositoriesController < ApplicationController
  def index
    @repos_folder = Setting.repos_folder
    @current_repo = Setting.current_repo
    @repositories = load_repositories
  end

  def list
    @repos_folder = Setting.repos_folder
    @current_repo = Setting.current_repo
    @repositories = load_repositories

    render partial: "repositories/dropdown_list", locals: {
      repositories: @repositories,
      current_repo: @current_repo,
      repos_folder: @repos_folder
    }
  end

  def switch
    repo_path = params[:repo_path]

    unless repo_path.present? && Dir.exist?(repo_path)
      respond_to do |format|
        format.turbo_stream { render_error_stream("Invalid repository path") }
        format.html { redirect_to repositories_path, alert: "Invalid repository path" }
      end
      return
    end

    Setting.current_repo = repo_path

    # Fetch latest changes for the repo
    GithubCliService.fetch_latest_for_repo(repo_path)

    # Sync PRs from GitHub
    GithubCliService.new(repo_path: repo_path).sync_to_database!
    Setting.touch_last_synced!

    respond_to do |format|
      format.turbo_stream { render_pr_stream(notice: "Switched to #{File.basename(repo_path)} and synced") }
      format.html { redirect_to pull_requests_path, notice: "Switched to #{File.basename(repo_path)} and synced" }
    end
  rescue GithubCliService::Error => e
    respond_to do |format|
      format.turbo_stream { render_pr_stream(alert: "Switched to #{File.basename(repo_path)} but sync failed: #{e.message}") }
      format.html { redirect_to pull_requests_path, alert: "Switched repo but sync failed: #{e.message}" }
    end
  end

  private

  def load_repositories
    return [] unless Setting.repos_folder.present?

    RepoScannerService.new(Setting.repos_folder).scan
  end

  def render_pr_stream(notice: nil, alert: nil)
    current_repo = Setting.current_repo
    repos_folder = Setting.repos_folder
    repositories = load_repositories
    presenter = PullRequestIndexPresenter.new
    columns = presenter.columns

    streams = [
      turbo_stream.update("repo-selector-current-repo-name", partial: "repositories/current_repo_name", locals: { current_repo: current_repo }),
      turbo_stream.replace("repo-selector-dropdown-list", partial: "repositories/dropdown_list", locals: {
        repositories: repositories,
        current_repo: current_repo,
        repos_folder: repos_folder
      }),
      turbo_stream.replace("pr-columns", partial: "pull_requests/columns", locals: {
        pending_review: columns[:pending_review],
        in_review: columns[:in_review],
        reviewed_by_me: columns[:reviewed_by_me],
        waiting_implementation: columns[:waiting_implementation],
        reviewed_by_others: columns[:reviewed_by_others],
        review_failed: columns[:review_failed]
      }),
      turbo_stream.update("pr-count", "#{presenter.total_count} pull requests"),
      turbo_stream.replace("sync-status", partial: "pull_requests/sync_status")
    ]

    if notice.present?
      streams << turbo_stream.replace("flash-messages", partial: "shared/flash", locals: { notice: notice })
    elsif alert.present?
      streams << turbo_stream.replace("flash-messages", partial: "shared/flash", locals: { alert: alert })
    end

    render turbo_stream: streams
  end

  def render_error_stream(message)
    render turbo_stream: turbo_stream.replace("flash-messages", partial: "shared/flash", locals: { alert: message })
  end
end
