class ReviewComment < ApplicationRecord
  SEVERITIES = %w[critical major minor suggestion nitpick].freeze
  STATUSES = %w[pending addressed dismissed].freeze

  belongs_to :review_task

  validates :file_path, presence: true
  validates :body, presence: true
  validates :severity, inclusion: { in: SEVERITIES }
  validates :status, inclusion: { in: STATUSES }

  scope :pending, -> { where(status: "pending") }
  scope :addressed, -> { where(status: "addressed") }
  scope :dismissed, -> { where(status: "dismissed") }
  scope :critical, -> { where(severity: "critical") }
  scope :major, -> { where(severity: "major") }
  scope :minor, -> { where(severity: "minor") }
  scope :suggestions, -> { where(severity: "suggestion") }
  scope :nitpicks, -> { where(severity: "nitpick") }
  scope :actionable, -> { where(severity: %w[critical major minor]) }
  scope :for_file, ->(path) { where(file_path: path) }
  scope :by_severity, -> { order(Arel.sql("CASE severity WHEN 'critical' THEN 1 WHEN 'major' THEN 2 WHEN 'minor' THEN 3 WHEN 'suggestion' THEN 4 WHEN 'nitpick' THEN 5 END")) }

  def pending?
    status == "pending"
  end

  def addressed?
    status == "addressed"
  end

  def dismissed?
    status == "dismissed"
  end

  def critical?
    severity == "critical"
  end

  def major?
    severity == "major"
  end

  def minor?
    severity == "minor"
  end

  def suggestion?
    severity == "suggestion"
  end

  def nitpick?
    severity == "nitpick"
  end

  def actionable?
    %w[critical major minor].include?(severity)
  end

  def mark_addressed!(note = nil)
    update!(status: "addressed", resolution_note: note)
  end

  def mark_dismissed!(note = nil)
    update!(status: "dismissed", resolution_note: note)
  end

  def location
    line_number.present? ? "#{file_path}:#{line_number}" : file_path
  end
end
