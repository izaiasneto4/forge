class Api::V1::SyncsController < Api::V1::BaseController
  def create
    force = parse_boolean(params[:force])
    sync_state = SyncState.for_repo_path(Setting.current_repo)

    unless force || sync_state.nil? || sync_state.sync_needed?
      return render_ok(
        {
          skipped: true,
          sync: sync_state&.payload,
          seconds_remaining: sync_state&.seconds_until_sync_allowed || 0,
          last_synced_at: sync_state&.last_succeeded_at&.iso8601
        }
      )
    end

    result = Sync::Engine.new(repo_path: Setting.current_repo).call(trigger: "manual")

    render_ok({
      skipped: false,
      already_running: result[:already_running],
      sync: result[:sync],
      last_synced_at: result.dig(:sync, :last_succeeded_at)
    })
  rescue ArgumentError => e
    render_error("invalid_input", e.message)
  rescue GithubCliService::Error, Sync::GithubAdapter::Error => e
    render_error("sync_failed", e.message)
  end
end
