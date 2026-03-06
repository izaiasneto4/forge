require "test_helper"

class ApplicationJobTest < ActiveSupport::TestCase
  test "inherits from ActiveJob base" do
    assert ApplicationJob < ActiveJob::Base
  end
end
