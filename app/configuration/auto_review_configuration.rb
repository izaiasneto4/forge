class AutoReviewConfiguration
  DEFAULT_DELAY_MIN = 5
  DEFAULT_DELAY_MAX = 30

  MODE_KEY = "auto_review_mode".freeze
  DELAY_MIN_KEY = "auto_review_delay_min".freeze
  DELAY_MAX_KEY = "auto_review_delay_max".freeze
  AUTO_SUBMIT_KEY = "auto_submit_enabled".freeze

  def mode_enabled?
    Setting.find_by(key: MODE_KEY)&.value == "true"
  end

  def mode_enabled=(enabled)
    setting = Setting.find_or_initialize_by(key: MODE_KEY)
    setting.update!(value: enabled.to_s)
  end

  def delay_min
    Setting.find_by(key: DELAY_MIN_KEY)&.value&.to_i || DEFAULT_DELAY_MIN
  end

  def delay_min=(seconds)
    setting = Setting.find_or_initialize_by(key: DELAY_MIN_KEY)
    setting.update!(value: seconds.to_s)
  end

  def delay_max
    Setting.find_by(key: DELAY_MAX_KEY)&.value&.to_i || DEFAULT_DELAY_MAX
  end

  def delay_max=(seconds)
    setting = Setting.find_or_initialize_by(key: DELAY_MAX_KEY)
    setting.update!(value: seconds.to_s)
  end

  def delay
    min = delay_min
    max = delay_max
    rand(min..max)
  end

  def auto_submit_enabled?
    Setting.find_by(key: AUTO_SUBMIT_KEY)&.value == "true"
  end

  def auto_submit_enabled=(enabled)
    setting = Setting.find_or_initialize_by(key: AUTO_SUBMIT_KEY)
    setting.update!(value: enabled.to_s)
  end
end
