require "test_helper"

class ReposConfigurationTest < ActiveSupport::TestCase
  setup do
    Setting.delete_all
    @config = ReposConfiguration.new
  end

  test "folder defaults to nil" do
    assert_nil @config.folder
  end

  test "folder persists configured path" do
    @config.folder = "/tmp/repos"

    assert_equal "/tmp/repos", @config.folder
    assert_equal "/tmp/repos", Setting.find_by(key: ReposConfiguration::KEY).value
  end
end
