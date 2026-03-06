require "test_helper"

class ReviewNotificationsChannelTest < ActionCable::Channel::TestCase
  test "subscribed streams from review notifications channel" do
    subscribe

    assert subscription.confirmed?
    assert_has_stream "review_notifications"
  end

  test "unsubscribed is a no-op" do
    subscribe

    assert_nothing_raised do
      subscription.unsubscribed
    end
  end
end
