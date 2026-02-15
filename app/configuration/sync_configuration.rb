class SyncConfiguration
  DEBOUNCE_SECONDS = 300 # 5 minutes
  KEY = "last_synced_at".freeze

  def last_synced_at
    value = Setting.find_by(key: KEY)&.value
    Time.parse(value) if value.present?
  rescue ArgumentError
    nil
  end

  def last_synced_at=(time)
    setting = Setting.find_or_initialize_by(key: KEY)
    setting.update!(value: time&.iso8601)
  end

  def touch!
    self.last_synced_at = Time.current
  end

  def sync_needed?
    last = last_synced_at
    last.nil? || Time.current - last >= DEBOUNCE_SECONDS
  end

  def seconds_until_sync_allowed
    last = last_synced_at
    return 0 if last.nil?

    remaining = DEBOUNCE_SECONDS - (Time.current - last)
    remaining.clamp(0, Float::INFINITY).to_i
  end
end
