class SyncState < ApplicationRecord
  STATUSES = %w[idle running succeeded partial failed].freeze
  POLL_INTERVAL_SECONDS = 120

  validates :scope_key, presence: true, uniqueness: true
  validates :status, inclusion: { in: STATUSES }

  def self.for_repo_path(repo_path)
    slug = RepoSlugResolver.from_path(repo_path)
    return nil if slug.blank?

    owner, name = slug.split("/", 2)
    find_or_create_by!(scope_key: "repo:#{slug}") do |state|
      state.repo_owner = owner
      state.repo_name = name
    end
  end

  def running?
    status == "running"
  end

  def sync_needed?
    return false if running?
    return true if last_succeeded_at.nil?

    Time.current - last_succeeded_at >= POLL_INTERVAL_SECONDS
  end

  def seconds_until_sync_allowed
    return 0 if last_succeeded_at.nil?
    return 0 if running?

    remaining = POLL_INTERVAL_SECONDS - (Time.current - last_succeeded_at)
    remaining.clamp(0, Float::INFINITY).to_i
  end

  def payload
    {
      status: status,
      running: running?,
      last_synced_at: last_succeeded_at&.iso8601,
      last_started_at: last_started_at&.iso8601,
      last_finished_at: last_finished_at&.iso8601,
      last_succeeded_at: last_succeeded_at&.iso8601,
      last_error: last_error,
      fetched_count: fetched_count,
      created_count: created_count,
      updated_count: updated_count,
      deactivated_count: deactivated_count,
      seconds_until_sync_allowed: seconds_until_sync_allowed,
      sync_needed: sync_needed?
    }
  end
end
