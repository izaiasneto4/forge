require "test_helper"

class ApplicationCable::ConnectionTest < ActiveSupport::TestCase
  test "inherits from action cable base connection" do
    assert ApplicationCable::Connection < ActionCable::Connection::Base
  end
end
