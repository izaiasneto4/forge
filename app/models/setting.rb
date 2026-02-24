class Setting < ApplicationRecord
  validates :key, presence: true, uniqueness: true

  REPOS_FOLDER_KEY = "repos_folder".freeze
  CURRENT_REPO_KEY = "current_repo".freeze
  DEFAULT_CLI_CLIENT_KEY = "default_cli_client".freeze
  LAST_SYNCED_AT_KEY = "last_synced_at".freeze
  ONLY_REQUESTED_REVIEWS_KEY = "only_requested_reviews".freeze
  AUTO_REVIEW_MODE_KEY = "auto_review_mode".freeze
  AUTO_REVIEW_DELAY_MIN_KEY = "auto_review_delay_min".freeze
  AUTO_REVIEW_DELAY_MAX_KEY = "auto_review_delay_max".freeze
  AUTO_SUBMIT_ENABLED_KEY = "auto_submit_enabled".freeze

  CLI_CLIENTS = %w[claude codex opencode].freeze
  DEFAULT_CLI_CLIENT = "claude".freeze
  SYNC_DEBOUNCE_SECONDS = 300 # 5 minutes
  DEFAULT_AUTO_REVIEW_DELAY_MIN = 5
  DEFAULT_AUTO_REVIEW_DELAY_MAX = 30

  CACHE_TTL = 30.seconds

  cattr_accessor :cache_enabled, default: true

  def self.fetch(key)
    return yield unless cache_enabled

    cache_key = "setting/#{key}"
    Rails.cache.fetch(cache_key, expires_in: CACHE_TTL) do
      find_by(key: key)&.value
    end
  end

  def self.write(key, value)
    Rails.cache.write("setting/#{key}", value, expires_in: CACHE_TTL)
  end

  def self.invalidate_cache!(key = nil)
    if key
      Rails.cache.delete("setting/#{key}")
    else
      Rails.cache.delete_matched("setting/*")
    end
  end

  def self.repos_folder
    fetch(REPOS_FOLDER_KEY) { super }
  end

  def self.repos_folder=(path)
    invalidate_cache!(REPOS_FOLDER_KEY)
    setting = find_or_initialize_by(key: REPOS_FOLDER_KEY)
    setting.update!(value: path)
  end

  def self.current_repo
    fetch(CURRENT_REPO_KEY) { super }
  end

  def self.current_repo=(path)
    invalidate_cache!(CURRENT_REPO_KEY)
    setting = find_or_initialize_by(key: CURRENT_REPO_KEY)
    setting.update!(value: path)
  end

  def self.default_cli_client
    fetch(DEFAULT_CLI_CLIENT_KEY) { super } || DEFAULT_CLI_CLIENT
  end

  def self.default_cli_client=(client)
    return unless CLI_CLIENTS.include?(client)
    invalidate_cache!(DEFAULT_CLI_CLIENT_KEY)
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
    invalidate_cache!(LAST_SYNCED_AT_KEY)
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
    invalidate_cache!(ONLY_REQUESTED_REVIEWS_KEY)
    setting = find_or_initialize_by(key: ONLY_REQUESTED_REVIEWS_KEY)
    setting.update!(value: enabled.to_s)
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
    fetch(AUTO_REVIEW_MODE_KEY) { super } == "true"
  end

  def self.auto_review_mode=(enabled)
    invalidate_cache!(AUTO_REVIEW_MODE_KEY)
    setting = find_or_initialize_by(key: AUTO_REVIEW_MODE_KEY)
    setting.update!(value: enabled.to_s)
  end

  def self.auto_review_delay_min
    parse_delay_value(fetch(AUTO_REVIEW_DELAY_MIN_KEY), default: DEFAULT_AUTO_REVIEW_DELAY_MIN)
  end

  def self.auto_review_delay_min=(seconds)
    invalidate_cache!(AUTO_REVIEW_DELAY_MIN_KEY)
    setting = find_or_initialize_by(key: AUTO_REVIEW_DELAY_MIN_KEY)
    setting.update!(value: seconds.to_s)
  end

  def self.auto_review_delay_max
    parse_delay_value(fetch(AUTO_REVIEW_DELAY_MAX_KEY), default: DEFAULT_AUTO_REVIEW_DELAY_MAX)
  end

  def self.auto_review_delay_max=(seconds)
    invalidate_cache!(AUTO_REVIEW_DELAY_MAX_KEY)
    setting = find_or_initialize_by(key: AUTO_REVIEW_DELAY_MAX_KEY)
    setting.update!(value: seconds.to_s)
  end

  def self.auto_review_delay
    lower, upper = [ auto_review_delay_min, auto_review_delay_max ].minmax
    rand(lower..upper)
  end

  def self.auto_submit_enabled?
    fetch(AUTO_SUBMIT_ENABLED_KEY) { super } == "true"
  end

  def self.auto_submit_enabled=(enabled)
    invalidate_cache!(AUTO_SUBMIT_ENABLED_KEY)
    setting = find_or_initialize_by(key: AUTO_SUBMIT_ENABLED_KEY)
    setting.update!(value: enabled.to_s)
  end

  def self.parse_delay_value(value, default:)
    parsed = Integer(value, exception: false)
    return default if parsed.nil? || parsed.negative?
    parsed
  end
  private_class_method :parse_delay_value
end
