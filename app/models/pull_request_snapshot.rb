class PullRequestSnapshot < ApplicationRecord
  STATUSES = %w[current stale].freeze

  belongs_to :pull_request
  has_many :review_tasks, dependent: :nullify

  validates :head_sha, :base_sha, presence: true
  validates :status, inclusion: { in: STATUSES }
  validates :head_sha, uniqueness: { scope: [ :pull_request_id, :base_sha ] }

  scope :current, -> { where(status: "current") }
  scope :stale, -> { where(status: "stale") }

  def self.activate_for!(pull_request:, head_sha:, base_sha:, stale_reason:)
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
  end
end
