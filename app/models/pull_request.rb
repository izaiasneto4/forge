class PullRequest < ApplicationRecord
  REVIEW_STATUSES = %w[pending_review in_review reviewed_by_me waiting_implementation reviewed_by_others review_failed].freeze
  REVIEW_STATUSES_REQUIRING_TASK = %w[in_review reviewed_by_me waiting_implementation review_failed].freeze
  REMOTE_STATES = %w[open closed merged inaccessible].freeze
  INACTIVE_REASONS = %w[merged closed out_of_scope inaccessible unknown].freeze

  has_one :review_task, dependent: :destroy
  has_many :pull_request_snapshots, dependent: :destroy

  after_commit :invalidate_header_cache, on: [ :create, :update, :destroy ]
  after_commit :invalidate_header_cache_on_review_status_change, if: :saved_change_to_review_status?
  after_commit :broadcast_status_change, if: :saved_change_to_review_status?

  validates :github_id, presence: true, uniqueness: true
  validates :number, presence: true, uniqueness: { scope: [ :repo_owner, :repo_name ] }
  validates :title, presence: true
  validates :url, presence: true
  validates :repo_owner, presence: true
  validates :repo_name, presence: true
  validates :review_status, inclusion: { in: REVIEW_STATUSES }
  validates :remote_state, inclusion: { in: REMOTE_STATES }
  validates :inactive_reason, inclusion: { in: INACTIVE_REASONS }, allow_nil: true
  validate :review_status_consistency

  scope :not_deleted, -> { where(deleted_at: nil) }
  scope :deleted, -> { where.not(deleted_at: nil) }
  scope :not_archived, -> { not_deleted.where(archived: false) }
  scope :active_remote, -> { not_archived.where(remote_state: "open", inactive_reason: nil) }
  scope :archived, -> { not_deleted.where(archived: true) }
  scope :pending_review, -> { active_remote.where(review_status: "pending_review") }
  scope :in_review, -> { active_remote.where(review_status: "in_review") }
  scope :reviewed_by_me, -> { active_remote.where(review_status: "reviewed_by_me") }
  scope :waiting_implementation, -> { active_remote.where(review_status: "waiting_implementation") }
  scope :reviewed_by_others, -> { active_remote.where(review_status: "reviewed_by_others") }
  scope :review_failed, -> { active_remote.where(review_status: "review_failed") }

  default_scope { not_archived }

  def self.for_current_repo(repo_path = Setting.current_repo)
    return all if repo_path.blank?

    repo_slug = RepoSlugResolver.from_path(repo_path)
    return none if repo_slug.blank?

    owner, name = repo_slug.split("/", 2)
    where(repo_owner: owner, repo_name: name)
  end

  def pending_review?
    review_status == "pending_review"
  end

  def in_review?
    review_status == "in_review"
  end

  def waiting_implementation?
    review_status == "waiting_implementation"
  end

  def review_failed?
    review_status == "review_failed"
  end

  def repo_full_name
    "#{repo_owner}/#{repo_name}"
  end

  def active_remote?
    remote_state == "open" && inactive_reason.blank? && !deleted?
  end

  def inactive?
    !active_remote?
  end

  def short_description
    description.to_s.truncate(150)
  end

  def soft_delete!
    update!(deleted_at: Time.current)
  end

  def restore!
    update!(deleted_at: nil, remote_state: "open", inactive_reason: nil, review_status: "pending_review")
  end

  def deleted?
    deleted_at.present?
  end

  def archived?
    archived == true
  end

  def current_snapshot
    pull_request_snapshots.find_by(status: "current")
  end

  def ai_summary_for_display
    snapshot = current_snapshot
    fallback_snapshot = pull_request_snapshots.stale.where(ai_summary_status: "current").order(updated_at: :desc).first

    if snapshot&.ai_summary_current?
      snapshot.ai_summary_payload(stale: false)
    elsif fallback_snapshot.present?
      fallback_snapshot.ai_summary_payload(stale: true)
    elsif snapshot.present?
      snapshot.ai_summary_payload(stale: false)
    else
      {
        status: "none",
        generated_at: nil,
        failure_reason: nil,
        snapshot_id: nil,
        stale: false,
        files_changed: changed_files,
        lines_added: additions,
        lines_removed: deletions,
        main_changes: [],
        risk_areas: []
      }
    end
  end

  def current_snapshot_or_create!
    return if head_sha.blank? || base_sha.blank?

    PullRequestSnapshot.activate_for!(
      pull_request: self,
      head_sha: head_sha,
      base_sha: base_sha,
      stale_reason: "revision_changed"
    )
  end

  def snapshot_status
    return "missing" if current_snapshot.blank?
    return "stale" if analysis_status == "stale"

    "current"
  end

  def analysis_status
    task = review_task
    return "none" if task.blank?
    return "pending" if task.queued? || task.pending_review? || task.in_review?

    snapshot = current_snapshot
    return "pending" if snapshot.blank? || task.pull_request_snapshot.blank?

    has_artifacts = task.review_output.present? || task.review_comments.exists? || task.review_iterations.exists?
    return "stale" if has_artifacts && task.pull_request_snapshot_id != snapshot.id

    has_artifacts ? "current" : "pending"
  end

  def refresh_review_status!
    next_status = PullRequestStatusClassifier.call(self)
    return review_status if next_status == review_status

    update_column(:review_status, next_status)
    next_status
  end

  def archive!
    update!(archived: true)
  end

  def unarchive!
    update!(archived: false)
  end

  # Fix orphaned reviewed PRs that have no review_task
  def self.fix_orphaned_review_states
    fixed_count = 0

    # Find PRs in reviewed/in_review/failed states without a review_task
    orphaned = where(review_status: %w[reviewed_by_me waiting_implementation in_review review_failed])
                 .left_joins(:review_task)
                 .where(review_tasks: { id: nil })

    orphaned.find_each do |pr|
      pr.update_column(:review_status, "pending_review")
      fixed_count += 1
    end

    fixed_count
  end

  # Fix state mismatches between PR review_status and ReviewTask state
  def self.fix_state_mismatches
    fixed_count = 0

    # Fix PRs marked as "in_review" but ReviewTask is not
    in_review.includes(:review_task).find_each do |pr|
      next unless pr.review_task.present?

      unless pr.review_task.in_review?
        Rails.logger.info("Fixing state mismatch: PR ##{pr.number} (in_review) with ReviewTask state: #{pr.review_task.state}")
        target_status = case pr.review_task.state
        when "pending_review", "queued"
          "pending_review"
        when "waiting_implementation"
          "waiting_implementation"
        else
          "reviewed_by_me"
        end
        pr.update_column(:review_status, target_status)
        fixed_count += 1
      end
    end

    # Fix PRs marked as "reviewed_by_me" but ReviewTask is not in a reviewed state
    reviewed_by_me.includes(:review_task).find_each do |pr|
      next unless pr.review_task.present?

      if pr.review_task.in_review? || pr.review_task.pending_review?
        Rails.logger.info("Fixing state mismatch: PR ##{pr.number} (reviewed_by_me) with ReviewTask state: #{pr.review_task.state}")
        pr.update_column(:review_status, pr.review_task.in_review? ? "in_review" : "pending_review")
        fixed_count += 1
      end
    end

    # Fix PRs marked as "waiting_implementation" but ReviewTask is not waiting
    waiting_implementation.includes(:review_task).find_each do |pr|
      next unless pr.review_task.present?
      next if pr.review_task.waiting_implementation?

      Rails.logger.info("Fixing state mismatch: PR ##{pr.number} (waiting_implementation) with ReviewTask state: #{pr.review_task.state}")
      target_status = case pr.review_task.state
      when "in_review"
        "in_review"
      when "pending_review", "queued"
        "pending_review"
      else
        "reviewed_by_me"
      end
      pr.update_column(:review_status, target_status)
      fixed_count += 1
    end

    fixed_count
  end

  private

  def invalidate_header_cache
    HeaderPresenter.invalidate_cache(repo_full_name)
  end

  def invalidate_header_cache_on_review_status_change
    invalidate_header_cache
  end

  def broadcast_status_change
    previous_status = review_status_before_last_save
    Rails.logger.info "[PullRequest##{id}] Broadcasting status change: #{previous_status} -> #{review_status}"

    UiEventBroadcaster.pull_request_updated(self, previous_status: previous_status)
  rescue => e
    Rails.logger.error "[PullRequest##{id}] Broadcast failed: #{e.message}"
  end

  def review_status_consistency
    return if SyncMode.active?
    return unless REVIEW_STATUSES_REQUIRING_TASK.include?(review_status)
    return if review_task.present?

    errors.add(:review_status, "cannot be '#{review_status}' without a review task")
  end
end
