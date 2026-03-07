module Sync
  class Engine
    def initialize(repo_path: nil, adapter: nil)
      @repo_path = repo_path || Setting.current_repo
      @adapter = adapter
    end

    def call(trigger: "manual", pull_request_number: nil)
      sync_state = SyncState.for_repo_path(@repo_path)
      return no_repo_result unless sync_state

      already_running = false

      sync_state.with_lock do
        if sync_state.running?
          already_running = true
        else
          sync_state.update!(
            status: "running",
            last_started_at: Time.current,
            last_finished_at: nil,
            last_error: nil
          )
        end
      end

      return build_result(sync_state, already_running: true) if already_running

      UiEventBroadcaster.sync_started(@repo_path, sync: sync_state.payload.merge(trigger: trigger))

      result = perform_sync(pull_request_number: pull_request_number)
      final_status = result[:partial] ? "partial" : "succeeded"

      sync_state.update!(
        status: final_status,
        last_finished_at: Time.current,
        last_succeeded_at: Time.current,
        last_error: result[:errors].presence&.join("\n"),
        fetched_count: result[:fetched],
        created_count: result[:created],
        updated_count: result[:updated],
        deactivated_count: result[:deactivated]
      )

      Setting.touch_last_synced!
      UiEventBroadcaster.sync_completed(@repo_path, sync: sync_state.payload)

      build_result(sync_state, result)
    rescue StandardError => e
      handle_failure(sync_state, e)
    end

    private

    def perform_sync(pull_request_number:)
      fetched = if pull_request_number.present?
        pr = adapter.fetch_pull_request(pull_request_number)
        { prs: Array(pr), complete: false }
      else
        adapter.fetch_open_pull_requests
      end

      result = {
        fetched: 0,
        created: 0,
        updated: 0,
        deactivated: 0,
        partial: false,
        errors: []
      }

      fetched_numbers = []

      ActiveRecord::Base.transaction do
        fetched[:prs].each do |attrs|
          next if attrs.blank?

          fetched_numbers << attrs[:number]
          result[:fetched] += 1
          action = upsert_pull_request!(attrs)
          result[:created] += 1 if action == :created
          result[:updated] += 1 if action == :updated
        end

        if fetched[:complete] && pull_request_number.blank?
          deactivation_result = reconcile_missing_pull_requests!(fetched_numbers)
          result[:deactivated] += deactivation_result[:count]
          result[:partial] ||= deactivation_result[:partial]
          result[:errors].concat(deactivation_result[:errors])
        end
      end

      result
    end

    def upsert_pull_request!(attrs)
      pull_request = PullRequest.unscoped.find_or_initialize_by(github_id: attrs[:github_id])
      previous_head_sha = pull_request.head_sha
      previous_base_sha = pull_request.base_sha
      previous_status = pull_request.review_status
      created = pull_request.new_record?

      pull_request.assign_attributes(attrs.except(:inactive_reason))
      pull_request.deleted_at = nil
      pull_request.inactive_reason = attrs[:remote_state] == "open" ? nil : attrs[:inactive_reason]
      pull_request.review_status ||= "pending_review"

      changed = pull_request.changed?
      pull_request.save! if created || changed

      reconcile_snapshot!(pull_request, previous_head_sha: previous_head_sha, previous_base_sha: previous_base_sha)
      pull_request.refresh_review_status!

      return :created if created
      return :updated if changed || pull_request.review_status != previous_status

      :noop
    end

    def reconcile_snapshot!(pull_request, previous_head_sha:, previous_base_sha:)
      return if pull_request.head_sha.blank? || pull_request.base_sha.blank?

      stale_reason =
        if previous_head_sha.present? && previous_head_sha != pull_request.head_sha
          "head_sha_changed"
        elsif previous_base_sha.present? && previous_base_sha != pull_request.base_sha
          "base_sha_changed"
        else
          "revision_changed"
        end

      PullRequestSnapshot.activate_for!(
        pull_request: pull_request,
        head_sha: pull_request.head_sha,
        base_sha: pull_request.base_sha,
        stale_reason: stale_reason
      )
    end

    def reconcile_missing_pull_requests!(fetched_numbers)
      errors = []
      count = 0

      active_scope.find_each do |pull_request|
        next if fetched_numbers.include?(pull_request.number)

        begin
          remote = adapter.fetch_pull_request(pull_request.number)
          if remote.present?
            action = upsert_pull_request!(remote)
            count += 1 if action == :updated
          else
            pull_request.update!(
              remote_state: "inaccessible",
              inactive_reason: "inaccessible",
              closed_at_github: pull_request.closed_at_github || Time.current
            )
            count += 1
          end
        rescue Sync::GithubAdapter::Error => e
          errors << "PR ##{pull_request.number}: #{e.message}"
        end
      end

      {
        count: count,
        partial: errors.any?,
        errors: errors
      }
    end

    def active_scope
      owner, name = adapter.repo_slug.split("/", 2)
      PullRequest.unscoped.where(
        repo_owner: owner,
        repo_name: name,
        remote_state: "open",
        inactive_reason: nil,
        deleted_at: nil
      )
    end

    def adapter
      @adapter ||= Sync::GithubAdapter.new(
        repo_path: @repo_path,
        github_login: Setting.github_login
      ).tap do |github_adapter|
        Setting.github_login = github_adapter.github_login if github_adapter.github_login.present?
      end
    end

    def build_result(sync_state, result = nil, already_running: false)
      counts = result || {
        fetched: sync_state.fetched_count,
        created: sync_state.created_count,
        updated: sync_state.updated_count,
        deactivated: sync_state.deactivated_count
      }

      counts.merge(
        already_running: already_running,
        sync: sync_state.payload
      )
    end

    def handle_failure(sync_state, error)
      if sync_state.present?
        sync_state.update!(
          status: "failed",
          last_finished_at: Time.current,
          last_error: error.message
        )
        UiEventBroadcaster.sync_failed(@repo_path, error: error.message, sync: sync_state.payload)
      end

      raise error
    end

    def no_repo_result
      {
        fetched: 0,
        created: 0,
        updated: 0,
        deactivated: 0,
        already_running: false,
        sync: {
          status: "idle",
          running: false,
          last_synced_at: nil,
          last_started_at: nil,
          last_finished_at: nil,
          last_succeeded_at: nil,
          last_error: nil,
          fetched_count: 0,
          created_count: 0,
          updated_count: 0,
          deactivated_count: 0,
          seconds_until_sync_allowed: 0,
          sync_needed: false
        }
      }
    end
  end
end
