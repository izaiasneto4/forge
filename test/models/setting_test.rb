require "test_helper"

class SettingTest < ActiveSupport::TestCase
  setup do
    Setting.delete_all
  end

  teardown do
    Setting.delete_all
  end

  # Validations
  test "valid with key present" do
    setting = Setting.new(key: "test_key", value: "test_value")
    assert setting.valid?
  end

  test "invalid without key" do
    setting = Setting.new(key: nil, value: "test_value")
    refute setting.valid?
    assert_includes setting.errors[:key], "can't be blank"
  end

  test "key must be unique" do
    Setting.create!(key: "test_key", value: "value1")
    duplicate = Setting.new(key: "test_key", value: "value2")

    refute duplicate.valid?
    assert_includes duplicate.errors[:key], "has already been taken"
  end

  # Class methods - repos_folder
  test "repos_folder returns nil when not set" do
    assert_nil Setting.repos_folder
  end

  test "repos_folder returns value when set" do
    Setting.create!(key: Setting::REPOS_FOLDER_KEY, value: "/path/to/repos")
    assert_equal "/path/to/repos", Setting.repos_folder
  end

  test "repos_folder= creates new setting when not exists" do
    Setting.repos_folder = "/new/path"
    assert_equal "/new/path", Setting.repos_folder
  end

  test "repos_folder= updates existing setting" do
    Setting.create!(key: Setting::REPOS_FOLDER_KEY, value: "/old/path")
    Setting.repos_folder = "/new/path"
    assert_equal "/new/path", Setting.repos_folder
  end

  test "repos_folder= accepts nil" do
    Setting.create!(key: Setting::REPOS_FOLDER_KEY, value: "/old/path")
    Setting.repos_folder = nil
    assert_nil Setting.repos_folder
  end

  # Class methods - current_repo
  test "current_repo returns nil when not set" do
    assert_nil Setting.current_repo
  end

  test "current_repo returns value when set" do
    Setting.create!(key: Setting::CURRENT_REPO_KEY, value: "/path/to/repo")
    assert_equal "/path/to/repo", Setting.current_repo
  end

  test "current_repo= creates new setting when not exists" do
    Setting.current_repo = "/new/repo"
    assert_equal "/new/repo", Setting.current_repo
  end

  test "current_repo= updates existing setting" do
    Setting.create!(key: Setting::CURRENT_REPO_KEY, value: "/old/repo")
    Setting.current_repo = "/new/repo"
    assert_equal "/new/repo", Setting.current_repo
  end

  test "current_repo= accepts nil" do
    Setting.create!(key: Setting::CURRENT_REPO_KEY, value: "/old/repo")
    Setting.current_repo = nil
    assert_nil Setting.current_repo
  end

  # Class methods - default_cli_client
  test "default_cli_client returns DEFAULT_CLI_CLIENT when not set" do
    assert_equal Setting::DEFAULT_CLI_CLIENT, Setting.default_cli_client
  end

  test "default_cli_client returns custom value when set" do
    Setting.create!(key: Setting::DEFAULT_CLI_CLIENT_KEY, value: "codex")
    assert_equal "codex", Setting.default_cli_client
  end

  test "default_cli_client= creates new setting with valid client" do
    Setting.default_cli_client = "codex"
    assert_equal "codex", Setting.default_cli_client
  end

  test "default_cli_client= updates existing setting with valid client" do
    Setting.create!(key: Setting::DEFAULT_CLI_CLIENT_KEY, value: "claude")
    Setting.default_cli_client = "opencode"
    assert_equal "opencode", Setting.default_cli_client
  end

  test "default_cli_client= ignores invalid value" do
    Setting.default_cli_client = "invalid_client"
    assert_equal Setting::DEFAULT_CLI_CLIENT, Setting.default_cli_client
  end

  test "default_cli_client= accepts nil" do
    Setting.create!(key: Setting::DEFAULT_CLI_CLIENT_KEY, value: "codex")
    Setting.default_cli_client = nil
    # nil is not in CLI_CLIENTS, so it should not change the value
    assert_equal "codex", Setting.default_cli_client
  end

  test "default_cli_client= works with all valid CLI_CLIENTS" do
    Setting::CLI_CLIENTS.each do |client|
      Setting.delete_all
      Setting.default_cli_client = client
      assert_equal client, Setting.default_cli_client
    end
  end

  # Class methods - last_synced_at
  test "last_synced_at returns nil when not set" do
    assert_nil Setting.last_synced_at
  end

  test "last_synced_at returns Time when set with valid ISO8601" do
    time = Time.current
    Setting.create!(key: Setting::LAST_SYNCED_AT_KEY, value: time.iso8601)
    assert_in_delta time.to_i, Setting.last_synced_at.to_i, 1
  end

  test "last_synced_at returns nil for invalid ISO8601" do
    Setting.create!(key: Setting::LAST_SYNCED_AT_KEY, value: "not a time")
    assert_nil Setting.last_synced_at
  end

  test "last_synced_at= creates new setting with Time" do
    time = Time.current
    Setting.last_synced_at = time
    assert_in_delta time.to_i, Setting.last_synced_at.to_i, 1
  end

  test "last_synced_at= updates existing setting with Time" do
    old_time = 1.hour.ago
    Setting.create!(key: Setting::LAST_SYNCED_AT_KEY, value: old_time.iso8601)

    new_time = Time.current
    Setting.last_synced_at = new_time
    assert_in_delta new_time.to_i, Setting.last_synced_at.to_i, 1
  end

  test "last_synced_at= accepts nil" do
    Setting.create!(key: Setting::LAST_SYNCED_AT_KEY, value: Time.current.iso8601)
    Setting.last_synced_at = nil
    assert_nil Setting.last_synced_at
  end

  # Class methods - touch_last_synced!
  test "touch_last_synced! updates last_synced_at to current time" do
    old_time = 1.hour.ago
    Setting.create!(key: Setting::LAST_SYNCED_AT_KEY, value: old_time.iso8601)

    Setting.touch_last_synced!
    assert_in_delta Time.current.to_i, Setting.last_synced_at.to_i, 1
  end

  test "touch_last_synced! creates setting when not exists" do
    Setting.touch_last_synced!
    assert Setting.last_synced_at.present?
    assert_in_delta Time.current.to_i, Setting.last_synced_at.to_i, 1
  end

  # Class methods - sync_needed?
  test "sync_needed? returns true when last_synced_at is nil" do
    assert Setting.sync_needed?
  end

  test "sync_needed? returns true when last sync was older than debounce" do
    Setting.create!(key: Setting::LAST_SYNCED_AT_KEY, value: (Setting::SYNC_DEBOUNCE_SECONDS + 60).seconds.ago.iso8601)
    assert Setting.sync_needed?
  end

  test "sync_needed? returns false when last sync was within debounce" do
    Setting.create!(key: Setting::LAST_SYNCED_AT_KEY, value: (Setting::SYNC_DEBOUNCE_SECONDS - 60).seconds.ago.iso8601)
    refute Setting.sync_needed?
  end

  test "sync_needed? returns true when last sync was exactly debounce ago" do
    Setting.create!(key: Setting::LAST_SYNCED_AT_KEY, value: Setting::SYNC_DEBOUNCE_SECONDS.seconds.ago.iso8601)
    assert Setting.sync_needed?
  end

  # Class methods - seconds_until_sync_allowed
  test "seconds_until_sync_allowed returns 0 when last_synced_at is nil" do
    assert_equal 0, Setting.seconds_until_sync_allowed
  end

  test "seconds_until_sync_allowed returns 0 when debounce has passed" do
    Setting.create!(key: Setting::LAST_SYNCED_AT_KEY, value: (Setting::SYNC_DEBOUNCE_SECONDS + 60).seconds.ago.iso8601)
    assert_equal 0, Setting.seconds_until_sync_allowed
  end

  test "seconds_until_sync_allowed returns remaining time when within debounce" do
    Setting.create!(key: Setting::LAST_SYNCED_AT_KEY, value: (Setting::SYNC_DEBOUNCE_SECONDS - 60).seconds.ago.iso8601)
    result = Setting.seconds_until_sync_allowed
    assert result > 0
    assert result <= 60
  end

  test "seconds_until_sync_allowed returns integer" do
    Setting.create!(key: Setting::LAST_SYNCED_AT_KEY, value: (Setting::SYNC_DEBOUNCE_SECONDS - 30.5).seconds.ago.iso8601)
    assert_kind_of Integer, Setting.seconds_until_sync_allowed
  end

  # Constants
  test "CLI_CLIENTS contains expected values" do
    assert_includes Setting::CLI_CLIENTS, "claude"
    assert_includes Setting::CLI_CLIENTS, "codex"
    assert_includes Setting::CLI_CLIENTS, "opencode"
  end

  test "REPOS_FOLDER_KEY is repos_folder" do
    assert_equal "repos_folder", Setting::REPOS_FOLDER_KEY
  end

  test "CURRENT_REPO_KEY is current_repo" do
    assert_equal "current_repo", Setting::CURRENT_REPO_KEY
  end

  test "DEFAULT_CLI_CLIENT_KEY is default_cli_client" do
    assert_equal "default_cli_client", Setting::DEFAULT_CLI_CLIENT_KEY
  end

  test "LAST_SYNCED_AT_KEY is last_synced_at" do
    assert_equal "last_synced_at", Setting::LAST_SYNCED_AT_KEY
  end

  test "DEFAULT_CLI_CLIENT is claude" do
    assert_equal "claude", Setting::DEFAULT_CLI_CLIENT
  end

  test "SYNC_DEBOUNCE_SECONDS is 300" do
    assert_equal 300, Setting::SYNC_DEBOUNCE_SECONDS
  end

  # Edge cases
  test "handles multiple settings simultaneously" do
    Setting.repos_folder = "/repos"
    Setting.current_repo = "/current"
    Setting.default_cli_client = "codex"
    Setting.last_synced_at = Time.current

    assert_equal "/repos", Setting.repos_folder
    assert_equal "/current", Setting.current_repo
    assert_equal "codex", Setting.default_cli_client
    assert Setting.last_synced_at.present?
  end

  test "value field accepts empty string" do
    Setting.create!(key: "test_key", value: "")
    setting = Setting.find_by(key: "test_key")
    assert_equal "", setting.value
  end

  test "deletes setting when setting to nil" do
    Setting.create!(key: Setting::REPOS_FOLDER_KEY, value: "/path")
    Setting.repos_folder = nil
    # When set to nil, the value is set to nil, not deleted
    result = Setting.find_by(key: Setting::REPOS_FOLDER_KEY)
    assert result.present?
    assert_nil result.value
  end

  # Auto-review settings
  test "auto_review_mode? returns false when not set" do
    refute Setting.auto_review_mode?
  end

  test "auto_review_mode? returns true when set to true" do
    Setting.create!(key: Setting::AUTO_REVIEW_MODE_KEY, value: "true")
    assert Setting.auto_review_mode?
  end

  test "auto_review_mode? returns false when set to false" do
    Setting.create!(key: Setting::AUTO_REVIEW_MODE_KEY, value: "false")
    refute Setting.auto_review_mode?
  end

  test "auto_review_mode= sets value as string" do
    Setting.auto_review_mode = true
    assert Setting.auto_review_mode?

    Setting.auto_review_mode = false
    refute Setting.auto_review_mode?
  end

  test "auto_review_delay_min returns default when not set" do
    assert_equal Setting::DEFAULT_AUTO_REVIEW_DELAY_MIN, Setting.auto_review_delay_min
  end

  test "auto_review_delay_min returns custom value when set" do
    Setting.create!(key: Setting::AUTO_REVIEW_DELAY_MIN_KEY, value: "10")
    assert_equal 10, Setting.auto_review_delay_min
  end

  test "auto_review_delay_min= sets value as string" do
    Setting.auto_review_delay_min = 15
    assert_equal 15, Setting.auto_review_delay_min
  end

  test "auto_review_delay_max returns default when not set" do
    assert_equal Setting::DEFAULT_AUTO_REVIEW_DELAY_MAX, Setting.auto_review_delay_max
  end

  test "auto_review_delay_max returns custom value when set" do
    Setting.create!(key: Setting::AUTO_REVIEW_DELAY_MAX_KEY, value: "60")
    assert_equal 60, Setting.auto_review_delay_max
  end

  test "auto_review_delay_max= sets value as string" do
    Setting.auto_review_delay_max = 45
    assert_equal 45, Setting.auto_review_delay_max
  end

  test "auto_review_delay returns value in range" do
    Setting.auto_review_delay_min = 5
    Setting.auto_review_delay_max = 30

    100.times do
      delay = Setting.auto_review_delay
      assert delay >= 5
      assert delay <= 30
    end
  end

  # Auto-submit settings
  test "auto_submit_enabled? returns false when not set" do
    refute Setting.auto_submit_enabled?
  end

  test "auto_submit_enabled? returns true when set to true" do
    Setting.create!(key: Setting::AUTO_SUBMIT_ENABLED_KEY, value: "true")
    assert Setting.auto_submit_enabled?
  end

  test "auto_submit_enabled? returns false when set to false" do
    Setting.create!(key: Setting::AUTO_SUBMIT_ENABLED_KEY, value: "false")
    refute Setting.auto_submit_enabled?
  end

  test "auto_submit_enabled= sets value as string" do
    Setting.auto_submit_enabled = true
    assert Setting.auto_submit_enabled?

    Setting.auto_submit_enabled = false
    refute Setting.auto_submit_enabled?
  end
end
