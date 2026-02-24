class PullRequest < ApplicationRecord
  REVIEW_STATUSES = %w[pending_review in_review reviewed_by_me waiting_implementation reviewed_by_others review_failed].freeze

  has_one :review_task, dependent: :destroy

  after_commit :invalidate_header_cache, on: [ :create, :update, :destroy ]
  after_commit :invalidate_header_cache_on_review_status_change, if: :saved_change_to_review_status?
  after_commit :broadcast_status_change, if: :saved_change_to_review_status?

  validates :github_id, presence: true, uniqueness: true
  validates :number, presence: true
  validates :title, presence: true
  validates :url, presence: true
  validates :repo_owner, presence: true
  validates :repo_name, presence: true
  validates :review_status, inclusion: { in: REVIEW_STATUSES }
  validate :review_status_consistency

  scope :not_deleted, -> { where(deleted_at: nil) }
  scope :deleted, -> { where.not(deleted_at: nil) }
  scope :not_archived, -> { not_deleted.where(archived: false) }
  scope :archived, -> { not_deleted.where(archived: true) }
  scope :pending_review, -> { not_archived.where(review_status: "pending_review") }
  scope :in_review, -> { not_archived.where(review_status: "in_review") }
  scope :reviewed_by_me, -> { not_archived.where(review_status: "reviewed_by_me") }
  scope :waiting_implementation, -> { not_archived.where(review_status: "waiting_implementation") }
  scope :reviewed_by_others, -> { not_archived.where(review_status: "reviewed_by_others") }
  scope :review_failed, -> { not_archived.where(review_status: "review_failed") }

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

  def short_description
    description.to_s.truncate(150)
  end

  def soft_delete!
    update!(deleted_at: Time.current)
  end

  def restore!
    update!(deleted_at: nil, review_status: "pending_review")
  end

  def deleted?
    deleted_at.present?
  end

  def archived?
    archived == true
  end

  def archive!
    update!(archived: true)
  end

  def unarchive!
    update!(archived: false)
  end

  def soft_delete!
    update!(deleted_at: Time.current)
  end

  def restore!
    update!(deleted_at: nil, review_status: "pending_review")
  end

  def deleted?
    deleted_at.present?
  end

  def archived?
    archived == true
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

    Turbo::StreamsChannel.broadcast_stream_to(
      "pull_requests_board",
      content: ApplicationController.render(
        partial: "pull_requests/status_change_broadcast",
        locals: { pull_request: self, previous_status: previous_status }
      )
    )
  rescue => e
    Rails.logger.error "[PullRequest##{id}] Broadcast failed: #{e.message}"
  end

  def review_status_consistency
    # Ensure reviewed_by_me status requires an actual reviewed review_task
    if review_status == "reviewed_by_me"
      if review_task.nil?
        errors.add(:review_status, "cannot be 'reviewed_by_me' without a review task")
      elsif !review_task.reviewed? && !review_task.waiting_implementation? && !review_task.done?
        errors.add(:review_status, "cannot be 'reviewed_by_me' when review task is not completed")
      end
    end

    # Ensure in_review status matches ReviewTask state
    if review_status == "in_review"
      if review_task.nil?
        errors.add(:review_status, "cannot be 'in_review' without a review task")
      elsif !review_task.in_review?
        errors.add(:review_status, "cannot be 'in_review' when review task is in #{review_task.state} state")
      end
    end

    # Ensure review_failed status requires a failed review_task
    if review_status == "review_failed"
      if review_task.nil?
        errors.add(:review_status, "cannot be 'review_failed' without a review task")
      elsif !review_task.failed_review?
        errors.add(:review_status, "cannot be 'review_failed' when review task has not failed")
      end
    end

    # Ensure waiting_implementation status matches ReviewTask state
    if review_status == "waiting_implementation"
      if review_task.nil?
        errors.add(:review_status, "cannot be 'waiting_implementation' without a review task")
      elsif !review_task.waiting_implementation?
        errors.add(:review_status, "cannot be 'waiting_implementation' when review task is in #{review_task.state} state")
      end
    end
  end
end
