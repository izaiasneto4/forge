class PullRequestFileTriage < ApplicationRecord
  ROLES = %w[
    entrypoint
    domain_logic
    persistence
    api_contract
    test
    config
    chore
    generated
  ].freeze

  ROLE_WHY = {
    "entrypoint" => "Likely entrypoint for the change — orient here first.",
    "domain_logic" => "Core domain logic for what this PR is building.",
    "persistence" => "Touches data/storage paths where regressions stick.",
    "api_contract" => "Changes an interface callers depend on.",
    "test" => "Shows intended behavior; useful after reading production code.",
    "config" => "Config/wiring that can change runtime behavior.",
    "chore" => "Low-signal churn unless it hides a real behavior change.",
    "generated" => "Generated or lockfile noise — skip unless score is high."
  }.freeze

  belongs_to :pull_request_snapshot

  validates :path, presence: true
  validates :role, inclusion: { in: ROLES }
  validates :path, uniqueness: { scope: :pull_request_snapshot_id }

  scope :ranked, -> { order(priority: :desc, path: :asc) }
  scope :scored, -> { where(skipped: false) }
  scope :skipped_files, -> { where(skipped: true) }

  def self.budget_file_count(minutes)
    case minutes.to_i
    when 0..5 then 3
    when 6..15 then 5
    when 16..30 then 8
    else 10
    end
  end

  def self.shortlist_for(snapshot, budget_minutes:)
    limit = budget_file_count(budget_minutes)
    files = snapshot.pull_request_file_triages.scored.ranked.to_a
    pick_diverse(files, limit)
  end

  def self.pick_diverse(files, limit)
    return files.first(limit) if files.size <= limit

    selected = []
    seen_roles = {}

    files.each do |file|
      break if selected.size >= limit
      next if seen_roles[file.role]

      selected << file
      seen_roles[file.role] = true
    end

    remaining = files - selected
    while selected.size < limit && remaining.any?
      selected << remaining.shift
    end

    selected
  end

  def ensure_why!
    return why if why.present?

    ROLE_WHY.fetch(role, ROLE_WHY["chore"])
  end

  def as_api_json
    {
      path: path,
      status: status,
      additions: additions,
      deletions: deletions,
      role: role,
      core_score: core_score.round(2),
      risk_score: risk_score.round(2),
      must_read_p: must_read_p.round(2),
      priority: priority.round(2),
      confidence: confidence.round(2),
      skipped: skipped,
      skip_reason: skip_reason,
      why: ensure_why!,
      rank: rank
    }
  end
end
