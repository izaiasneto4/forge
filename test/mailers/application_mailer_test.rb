require "test_helper"

class ApplicationMailerTest < ActiveSupport::TestCase
  test "inherits from ActionMailer base" do
    assert ApplicationMailer < ActionMailer::Base
  end

  test "uses default from address" do
    assert_equal "from@example.com", ApplicationMailer.default[:from]
  end

  test "uses mailer layout" do
    assert_equal "mailer", ApplicationMailer._layout
  end
end
