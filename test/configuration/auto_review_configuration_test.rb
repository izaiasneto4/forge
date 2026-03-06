require "test_helper"

class AutoReviewConfigurationTest < ActiveSupport::TestCase
  setup do
    Setting.delete_all
    @config = AutoReviewConfiguration.new
  end

  test "mode_enabled defaults to false" do
    refute @config.mode_enabled?
  end

  test "mode_enabled persists boolean string" do
    @config.mode_enabled = true

    assert @config.mode_enabled?
    assert_equal "true", Setting.find_by(key: AutoReviewConfiguration::MODE_KEY).value
  end

  test "delay min and max use defaults for invalid values" do
    Setting.create!(key: AutoReviewConfiguration::DELAY_MIN_KEY, value: "-1")
    Setting.create!(key: AutoReviewConfiguration::DELAY_MAX_KEY, value: "wat")

    assert_equal AutoReviewConfiguration::DEFAULT_DELAY_MIN, @config.delay_min
    assert_equal AutoReviewConfiguration::DEFAULT_DELAY_MAX, @config.delay_max
  end

  test "delay min and max persist values" do
    @config.delay_min = 8
    @config.delay_max = 13

    assert_equal 8, @config.delay_min
    assert_equal 13, @config.delay_max
  end

  test "delay uses sorted range" do
    @config.delay_min = 20
    @config.delay_max = 10

    Kernel.srand(1234)
    value = @config.delay

    assert_operator value, :>=, 10
    assert_operator value, :<=, 20
  end

  test "auto submit defaults to false" do
    refute @config.auto_submit_enabled?
  end

  test "auto submit persists boolean string" do
    @config.auto_submit_enabled = true

    assert @config.auto_submit_enabled?
    assert_equal "true", Setting.find_by(key: AutoReviewConfiguration::AUTO_SUBMIT_KEY).value
  end
end
