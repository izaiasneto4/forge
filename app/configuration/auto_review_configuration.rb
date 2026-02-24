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
    parse_delay_value(Setting.find_by(key: DELAY_MIN_KEY)&.value, default: DEFAULT_DELAY_MIN)
  end

  def delay_min=(seconds)
    setting = Setting.find_or_initialize_by(key: DELAY_MIN_KEY)
    setting.update!(value: seconds.to_s)
  end

  def delay_max
    parse_delay_value(Setting.find_by(key: DELAY_MAX_KEY)&.value, default: DEFAULT_DELAY_MAX)
  end

  def delay_max=(seconds)
    setting = Setting.find_or_initialize_by(key: DELAY_MAX_KEY)
    setting.update!(value: seconds.to_s)
  end

  def delay
    lower, upper = [ delay_min, delay_max ].minmax
    rand(lower..upper)
  end

  def auto_submit_enabled?
    Setting.find_by(key: AUTO_SUBMIT_KEY)&.value == "true"
  end

  def auto_submit_enabled=(enabled)
    setting = Setting.find_or_initialize_by(key: AUTO_SUBMIT_KEY)
    setting.update!(value: enabled.to_s)
  end

  private

  def parse_delay_value(value, default:)
    parsed = Integer(value, exception: false)
    return default if parsed.nil? || parsed.negative?
    parsed
  end
end
