class PullRequest < ApplicationRecord
  REVIEW_STATUSES = %w[pending_review in_review reviewed_by_me reviewed_by_others review_failed].freeze

  has_one :review_task, dependent: :destroy

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
  scope :pending_review, -> { not_deleted.where(review_status: "pending_review") }
  scope :in_review, -> { not_deleted.where(review_status: "in_review") }
  scope :reviewed_by_me, -> { not_deleted.where(review_status: "reviewed_by_me") }
  scope :reviewed_by_others, -> { not_deleted.where(review_status: "reviewed_by_others") }
  scope :review_failed, -> { not_deleted.where(review_status: "review_failed") }

  default_scope { not_deleted }

  def pending_review?
    review_status == "pending_review"
  end

  def in_review?
    review_status == "in_review"
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

  # Fix orphaned reviewed PRs that have no review_task
  def self.fix_orphaned_review_states
    fixed_count = 0

    # Find PRs in reviewed/in_review/failed states without a review_task
    orphaned = where(review_status: %w[reviewed_by_me in_review review_failed])
                 .left_joins(:review_task)
                 .where(review_tasks: { id: nil })

    orphaned.find_each do |pr|
      pr.update_column(:review_status, "pending_review")
      fixed_count += 1
    end

    fixed_count
  end

  private

  def review_status_consistency
    # Ensure reviewed_by_me status requires an actual reviewed review_task
    if review_status == "reviewed_by_me"
      if review_task.nil?
        errors.add(:review_status, "cannot be 'reviewed_by_me' without a review task")
      elsif !review_task.reviewed? && !review_task.waiting_implementation? && !review_task.done?
        errors.add(:review_status, "cannot be 'reviewed_by_me' when review task is not completed")
      end
    end

    # Ensure in_review status requires an active review_task
    if review_status == "in_review" && review_task.nil?
      errors.add(:review_status, "cannot be 'in_review' without a review task")
    end

    # Ensure review_failed status requires a failed review_task
    if review_status == "review_failed"
      if review_task.nil?
        errors.add(:review_status, "cannot be 'review_failed' without a review task")
      elsif !review_task.failed_review?
        errors.add(:review_status, "cannot be 'review_failed' when review task has not failed")
      end
    end
  end
end
