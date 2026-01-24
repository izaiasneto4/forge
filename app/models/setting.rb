class Setting < ApplicationRecord
  validates :key, presence: true, uniqueness: true

  REPOS_FOLDER_KEY = "repos_folder".freeze
  CURRENT_REPO_KEY = "current_repo".freeze
  DEFAULT_CLI_CLIENT_KEY = "default_cli_client".freeze
  LAST_SYNCED_AT_KEY = "last_synced_at".freeze

  CLI_CLIENTS = %w[claude codex opencode].freeze
  DEFAULT_CLI_CLIENT = "claude".freeze
  SYNC_DEBOUNCE_SECONDS = 300 # 5 minutes

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
end
