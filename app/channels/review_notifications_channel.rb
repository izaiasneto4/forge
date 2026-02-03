class ReviewNotificationsChannel < ApplicationCable::Channel
  def subscribed
    stream_from "review_notifications"
  end

  def unsubscribed
    # Any cleanup needed when channel is unsubscribed
  end
end
