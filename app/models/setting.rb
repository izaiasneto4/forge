class Setting < ApplicationRecord
  validates :key, presence: true, uniqueness: true

  REPOS_FOLDER_KEY = "repos_folder".freeze
  CURRENT_REPO_KEY = "current_repo".freeze
  DEFAULT_CLI_CLIENT_KEY = "default_cli_client".freeze
  LAST_SYNCED_AT_KEY = "last_synced_at".freeze
  AUTO_REVIEW_MODE_KEY = "auto_review_mode".freeze
  AUTO_REVIEW_DELAY_MIN_KEY = "auto_review_delay_min".freeze
  AUTO_REVIEW_DELAY_MAX_KEY = "auto_review_delay_max".freeze

  CLI_CLIENTS = %w[claude codex opencode].freeze
  DEFAULT_CLI_CLIENT = "claude".freeze
  SYNC_DEBOUNCE_SECONDS = 300 # 5 minutes
  DEFAULT_AUTO_REVIEW_DELAY_MIN = 5
  DEFAULT_AUTO_REVIEW_DELAY_MAX = 30

  def self.repos_folder
    find_by(key: REPOS_FOLDER_KEY)&.value
  end

  def self.repos_folder=(path)
    setting = find_or_initialize_by(key: REPOS_FOLDER_KEY)
    setting.update!(value: path)
  end

  def self.current_repo
    find_by(key: CURRENT_REPO_KEY)&.value
  end

  def self.current_repo=(path)
    setting = find_or_initialize_by(key: CURRENT_REPO_KEY)
    setting.update!(value: path)
  end

  def self.default_cli_client
    find_by(key: DEFAULT_CLI_CLIENT_KEY)&.value || DEFAULT_CLI_CLIENT
  end

  def self.default_cli_client=(client)
    return unless CLI_CLIENTS.include?(client)
    setting = find_or_initialize_by(key: DEFAULT_CLI_CLIENT_KEY)
    setting.update!(value: client)
  end

  def self.last_synced_at
    value = find_by(key: LAST_SYNCED_AT_KEY)&.value
    Time.parse(value) if value.present?
  rescue ArgumentError
    nil
  end

  def self.last_synced_at=(time)
    setting = find_or_initialize_by(key: LAST_SYNCED_AT_KEY)
    setting.update!(value: time&.iso8601)
  end

  def self.touch_last_synced!
    self.last_synced_at = Time.current
  end

  def self.sync_needed?
    last = last_synced_at
    return true if last.nil?
    Time.current - last >= SYNC_DEBOUNCE_SECONDS
  end

  def self.seconds_until_sync_allowed
    last = last_synced_at
    return 0 if last.nil?
    remaining = SYNC_DEBOUNCE_SECONDS - (Time.current - last)
    [ remaining, 0 ].max.to_i
  end

  def self.auto_review_mode?
    find_by(key: AUTO_REVIEW_MODE_KEY)&.value == "true"
  end

  def self.auto_review_mode=(enabled)
    setting = find_or_initialize_by(key: AUTO_REVIEW_MODE_KEY)
    setting.update!(value: enabled.to_s)
  end

  def self.auto_review_delay_min
    find_by(key: AUTO_REVIEW_DELAY_MIN_KEY)&.value&.to_i || DEFAULT_AUTO_REVIEW_DELAY_MIN
  end

  def self.auto_review_delay_min=(seconds)
    setting = find_or_initialize_by(key: AUTO_REVIEW_DELAY_MIN_KEY)
    setting.update!(value: seconds.to_s)
  end

  def self.auto_review_delay_max
    find_by(key: AUTO_REVIEW_DELAY_MAX_KEY)&.value&.to_i || DEFAULT_AUTO_REVIEW_DELAY_MAX
  end

  def self.auto_review_delay_max=(seconds)
    setting = find_or_initialize_by(key: AUTO_REVIEW_DELAY_MAX_KEY)
    setting.update!(value: seconds.to_s)
  end

  def self.auto_review_delay
    min = auto_review_delay_min
    max = auto_review_delay_max
    rand(min..max)
  end
end
