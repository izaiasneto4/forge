require "test_helper"

class SyncConfigurationTest < ActiveSupport::TestCase
  setup do
    Setting.delete_all
    @config = SyncConfiguration.new
  end

  test "last_synced_at defaults to nil" do
    assert_nil @config.last_synced_at
  end

  test "last_synced_at ignores invalid values" do
    Setting.create!(key: SyncConfiguration::KEY, value: "not-a-time")

    assert_nil @config.last_synced_at
  end

  test "last_synced_at persists iso8601" do
    time = Time.current.change(usec: 0)
    @config.last_synced_at = time

    assert_equal time.iso8601, Setting.find_by(key: SyncConfiguration::KEY).value
    assert_equal time, @config.last_synced_at
  end

  test "touch sets current time" do
    now = Time.zone.parse("2026-03-04 10:00:00")
    Time.stubs(:current).returns(now)
    begin
      @config.touch!
    ensure
      Time.unstub(:current)
    end

    assert_equal now, @config.last_synced_at
  end

  test "sync_needed is true when never synced" do
    assert @config.sync_needed?
  end

  test "sync_needed is false before debounce window expires" do
    @config.last_synced_at = Time.current - 60

    refute @config.sync_needed?
  end

  test "seconds_until_sync_allowed returns zero when never synced" do
    assert_equal 0, @config.seconds_until_sync_allowed
  end

  test "seconds_until_sync_allowed is clamped" do
    @config.last_synced_at = Time.current - 60

    assert_operator @config.seconds_until_sync_allowed, :>, 0
  end
end
