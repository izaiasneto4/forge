class Setting < ApplicationRecord
  validates :key, presence: true, uniqueness: true

  REPOS_FOLDER_KEY = "repos_folder".freeze
  CURRENT_REPO_KEY = "current_repo".freeze
  DEFAULT_CLI_CLIENT_KEY = "default_cli_client".freeze
  LAST_SYNCED_AT_KEY = "last_synced_at".freeze
  ONLY_REQUESTED_REVIEWS_KEY = "only_requested_reviews".freeze
  GITHUB_LOGIN_KEY = "github_login".freeze
  AUTO_REVIEW_MODE_KEY = "auto_review_mode".freeze
  AUTO_REVIEW_DELAY_MIN_KEY = "auto_review_delay_min".freeze
  AUTO_REVIEW_DELAY_MAX_KEY = "auto_review_delay_max".freeze
  AUTO_SUBMIT_ENABLED_KEY = "auto_submit_enabled".freeze
  THEME_PREFERENCE_KEY = "theme_preference".freeze

  CLI_CLIENTS = %w[claude codex opencode].freeze
  VALID_THEME_PREFERENCES = %w[light dark].freeze
  DEFAULT_CLI_CLIENT = "claude".freeze
  SYNC_DEBOUNCE_SECONDS = 300 # 5 minutes
  DEFAULT_AUTO_REVIEW_DELAY_MIN = 5
  DEFAULT_AUTO_REVIEW_DELAY_MAX = 30

  # Reads go straight to the DB: the Bun backend writes this table too, and a
  # per-process cache served stale values for up to 30s after those writes.
  def self.fetch(key)
    find_by(key: key)&.value
  end

  def self.repos_folder
    fetch(REPOS_FOLDER_KEY)
  end

  def self.repos_folder=(path)
    setting = find_or_initialize_by(key: REPOS_FOLDER_KEY)
    setting.update!(value: path)
  end

  def self.current_repo
    fetch(CURRENT_REPO_KEY)
  end

  def self.current_repo=(path)
    setting = find_or_initialize_by(key: CURRENT_REPO_KEY)
    setting.update!(value: path)
  end

  def self.default_cli_client
    fetch(DEFAULT_CLI_CLIENT_KEY) || DEFAULT_CLI_CLIENT
  end

  def self.default_cli_client=(client)
    return unless CLI_CLIENTS.include?(client)
    setting = find_or_initialize_by(key: DEFAULT_CLI_CLIENT_KEY)
    setting.update!(value: client)
  end

  def self.last_synced_at
    value = fetch(LAST_SYNCED_AT_KEY)
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

  def self.only_requested_reviews?
    value = fetch(ONLY_REQUESTED_REVIEWS_KEY)
    return true if value.nil?

    value == "true"
  end

  def self.only_requested_reviews=(enabled)
    setting = find_or_initialize_by(key: ONLY_REQUESTED_REVIEWS_KEY)
    setting.update!(value: enabled.to_s)
  end

  def self.github_login
    fetch(GITHUB_LOGIN_KEY)
  end

  def self.github_login=(login)
    setting = find_or_initialize_by(key: GITHUB_LOGIN_KEY)
    setting.update!(value: login)
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
    fetch(AUTO_REVIEW_MODE_KEY) == "true"
  end

  def self.auto_review_mode=(enabled)
    setting = find_or_initialize_by(key: AUTO_REVIEW_MODE_KEY)
    setting.update!(value: enabled.to_s)
  end

  def self.auto_review_delay_min
    parse_delay_value(fetch(AUTO_REVIEW_DELAY_MIN_KEY), default: DEFAULT_AUTO_REVIEW_DELAY_MIN)
  end

  def self.auto_review_delay_min=(seconds)
    setting = find_or_initialize_by(key: AUTO_REVIEW_DELAY_MIN_KEY)
    setting.update!(value: seconds.to_s)
  end

  def self.auto_review_delay_max
    parse_delay_value(fetch(AUTO_REVIEW_DELAY_MAX_KEY), default: DEFAULT_AUTO_REVIEW_DELAY_MAX)
  end

  def self.auto_review_delay_max=(seconds)
    setting = find_or_initialize_by(key: AUTO_REVIEW_DELAY_MAX_KEY)
    setting.update!(value: seconds.to_s)
  end

  def self.auto_review_delay
    lower, upper = [ auto_review_delay_min, auto_review_delay_max ].minmax
    rand(lower..upper)
  end

  def self.auto_submit_enabled?
    fetch(AUTO_SUBMIT_ENABLED_KEY) == "true"
  end

  def self.auto_submit_enabled=(enabled)
    setting = find_or_initialize_by(key: AUTO_SUBMIT_ENABLED_KEY)
    setting.update!(value: enabled.to_s)
  end

  def self.theme_preference
    value = fetch(THEME_PREFERENCE_KEY)
    return nil if value.blank?
    return value if VALID_THEME_PREFERENCES.include?(value)

    nil
  end

  def self.theme_preference=(value)
    return if value.present? && !VALID_THEME_PREFERENCES.include?(value)

    setting = find_or_initialize_by(key: THEME_PREFERENCE_KEY)
    setting.update!(value: value.presence)
  end

  def self.parse_delay_value(value, default:)
    parsed = Integer(value, exception: false)
    return default if parsed.nil? || parsed.negative?
    parsed
  end
  private_class_method :parse_delay_value
end
