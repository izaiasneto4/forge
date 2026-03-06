class SyncMode
  THREAD_KEY = :forge_sync_mode_active

  class << self
    def active?
      Thread.current[THREAD_KEY] == true
    end

    def with_active
      previous = Thread.current[THREAD_KEY]
      Thread.current[THREAD_KEY] = true
      yield
    ensure
      Thread.current[THREAD_KEY] = previous
    end
  end
end
