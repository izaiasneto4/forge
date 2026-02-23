class Api::V1::SyncsController < Api::V1::BaseController
  def create
    force = parse_boolean(params[:force])

    unless force || Setting.sync_needed?
      return render_ok(
        {
          skipped: true,
          seconds_remaining: Setting.seconds_until_sync_allowed,
          last_synced_at: Setting.last_synced_at&.iso8601
        }
      )
    end

    repo_path = Setting.current_repo
    GithubCliService.fetch_latest_for_repo(repo_path) if repo_path.present?
    GithubCliService.new(repo_path: repo_path).sync_to_database!
    Setting.touch_last_synced!

    render_ok({ skipped: false, last_synced_at: Setting.last_synced_at&.iso8601 })
  rescue ArgumentError => e
    render_error("invalid_input", e.message)
  rescue GithubCliService::Error => e
    render_error("sync_failed", e.message)
  end
end
