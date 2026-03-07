module Sync
  class Orchestrator
    def initialize(repo_path: nil)
      @repo_path = repo_path || Setting.current_repo
    end

    def call
      SyncMode.with_active do
        perform_sync
      end
    end

    private

    def perform_sync
      fetched_prs = fetch_all_prs.call_with_open_prs
      fetched_prs = fetched_prs[:pending_review] + fetched_prs[:reviewed_by_me]

      diff_result = DiffEngine.new(fetched_prs: fetched_prs, repo_path: @repo_path).call

      apply_result = ApplyChanges.new(changes: diff_result).call

      {
        fetched: fetched_prs.size,
        created: apply_result[:created],
        updated: apply_result[:updated],
        deleted: apply_result[:deleted]
      }
    end

    private

    def fetch_all_prs
      @fetch_all_prs ||= begin
        service = FetchAllPrs.new(
          repo_path: @repo_path,
          github_login: Setting.github_login
        )
        Setting.github_login = service.instance_variable_get(:@github_login) if service.instance_variable_get(:@github_login).present?
        service
      end
    end
  end
end
