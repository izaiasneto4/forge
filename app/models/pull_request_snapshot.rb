class PullRequestSnapshot < ApplicationRecord
  STATUSES = %w[current stale].freeze
  AI_SUMMARY_STATUSES = %w[none pending current failed].freeze

  belongs_to :pull_request
  has_many :review_tasks, dependent: :nullify

  validates :head_sha, :base_sha, presence: true
  validates :status, inclusion: { in: STATUSES }
  validates :ai_summary_status, inclusion: { in: AI_SUMMARY_STATUSES }
  validates :head_sha, uniqueness: { scope: [ :pull_request_id, :base_sha ] }

  serialize :ai_summary_main_changes, coder: JSON, type: Array
  serialize :ai_summary_risk_areas, coder: JSON, type: Array

  scope :current, -> { where(status: "current") }
  scope :stale, -> { where(status: "stale") }

  def self.activate_for!(pull_request:, head_sha:, base_sha:, stale_reason:)
    snapshot = nil

    transaction do
      snapshot = find_or_initialize_by(
        pull_request: pull_request,
        head_sha: head_sha,
        base_sha: base_sha
      )

      previous_current_ids = pull_request.pull_request_snapshots.current.where.not(id: snapshot.id).pluck(:id)
      if previous_current_ids.any?
        where(id: previous_current_ids).update_all(
          status: "stale",
          stale_reason: stale_reason,
          updated_at: Time.current
        )
      end

      snapshot.status = "current"
      snapshot.stale_reason = nil
      snapshot.synced_at = Time.current
      snapshot.save!
      snapshot
    end

    snapshot&.enqueue_ai_summary_generation!
    snapshot
  end

  def ai_summary_pending?
    ai_summary_status == "pending"
  end

  def ai_summary_current?
    ai_summary_status == "current"
  end

  def ai_summary_failed?
    ai_summary_status == "failed"
  end

  def ai_summary_payload(stale: false)
    {
      status: ai_summary_status,
      generated_at: ai_summary_generated_at,
      failure_reason: ai_summary_failure_reason,
      snapshot_id: id,
      stale: stale,
      files_changed: ai_summary_files_changed,
      lines_added: ai_summary_lines_added,
      lines_removed: ai_summary_lines_removed,
      main_changes: Array(ai_summary_main_changes),
      risk_areas: Array(ai_summary_risk_areas)
    }
  end

  def enqueue_ai_summary_generation!
    with_lock do
      return false if ai_summary_pending? || ai_summary_current?

      update!(
        ai_summary_status: "pending",
        ai_summary_failure_reason: nil
      )
    end

    PullRequestSummaryJob.perform_later(id)
    true
  end

  def store_ai_summary!(summary)
    update!(
      ai_summary_status: "current",
      ai_summary_generated_at: Time.current,
      ai_summary_failure_reason: nil,
      ai_summary_files_changed: summary[:files_changed],
      ai_summary_lines_added: summary[:lines_added],
      ai_summary_lines_removed: summary[:lines_removed],
      ai_summary_main_changes: summary[:main_changes],
      ai_summary_risk_areas: summary[:risk_areas]
    )
  end

  def mark_ai_summary_failed!(reason)
    update!(
      ai_summary_status: "failed",
      ai_summary_failure_reason: reason,
      ai_summary_generated_at: nil
    )
  end
end
