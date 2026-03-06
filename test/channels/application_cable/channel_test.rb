require "test_helper"

class ApplicationCable::ChannelTest < ActiveSupport::TestCase
  test "inherits from action cable base channel" do
    assert ApplicationCable::Channel < ActionCable::Channel::Base
  end
end
