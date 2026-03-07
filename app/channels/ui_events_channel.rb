class UiEventsChannel < ApplicationCable::Channel
  def subscribed
    stream_from UiEventBroadcaster::STREAM
  end

  def unsubscribed
    stop_all_streams
  end
end
