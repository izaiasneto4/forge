# Error hierarchy for PR review operations
# Distinguishes between transient (retryable) and permanent failures
module ReviewErrors
  class Error < StandardError
    attr_reader :original_error

    def initialize(message = nil, original_error: nil)
      @original_error = original_error
      super(message)
    end
  end

  # Transient errors that may succeed on retry
  class TransientError < Error
    def retryable? = true
  end

  # Permanent errors that will not succeed on retry
  class PermanentError < Error
    def retryable? = false
  end

  # Network-related transient failures
  class NetworkError < TransientError; end

  # Rate limiting from GitHub or CLI tools
  class RateLimitError < TransientError
    attr_reader :reset_at

    def initialize(message = nil, reset_at: nil, original_error: nil)
      @reset_at = reset_at
      super(message, original_error: original_error)
    end
  end

  # CLI tool execution timeout
  class TimeoutError < TransientError; end

  # Temporary service unavailability
  class ServiceUnavailableError < TransientError; end

  # Invalid PR (closed, merged, deleted)
  class InvalidPullRequestError < PermanentError; end

  # Permission errors (no access to repo)
  class PermissionError < PermanentError; end

  # Authentication failures
  class AuthenticationError < PermanentError; end

  # Worktree/git operation failures that can't be recovered
  class WorktreeError < PermanentError; end

  # CLI tool not found or misconfigured
  class CliConfigurationError < PermanentError; end

  # Validation failures (missing required data)
  class ValidationError < PermanentError; end

  # Parser for detecting error types from exception messages
  module ErrorClassifier
    TRANSIENT_PATTERNS = [
      { pattern: /Connection refused/i, error_class: NetworkError },
      { pattern: /Connection timed out/i, error_class: NetworkError },
      { pattern: /Could not resolve host/i, error_class: NetworkError },
      { pattern: /Network is unreachable/i, error_class: NetworkError },
      { pattern: /Connection reset by peer/i, error_class: NetworkError },
      { pattern: /Temporary failure in name resolution/i, error_class: NetworkError },
      { pattern: /rate limit/i, error_class: RateLimitError },
      { pattern: /API rate limit exceeded/i, error_class: RateLimitError },
      { pattern: /secondary rate limit/i, error_class: RateLimitError },
      { pattern: /timeout/i, error_class: TimeoutError },
      { pattern: /timed out/i, error_class: TimeoutError },
      { pattern: /503.*Service Unavailable/i, error_class: ServiceUnavailableError },
      { pattern: /502.*Bad Gateway/i, error_class: ServiceUnavailableError },
      { pattern: /504.*Gateway Timeout/i, error_class: ServiceUnavailableError }
    ].freeze

    PERMANENT_PATTERNS = [
      { pattern: /not found|404/i, error_class: InvalidPullRequestError },
      { pattern: /pull request.*closed/i, error_class: InvalidPullRequestError },
      { pattern: /pull request.*merged/i, error_class: InvalidPullRequestError },
      { pattern: /permission denied/i, error_class: PermissionError },
      { pattern: /403.*Forbidden/i, error_class: PermissionError },
      { pattern: /repository access blocked/i, error_class: PermissionError },
      { pattern: /401.*Unauthorized/i, error_class: AuthenticationError },
      { pattern: /authentication failed/i, error_class: AuthenticationError },
      { pattern: /bad credentials/i, error_class: AuthenticationError },
      { pattern: /command not found/i, error_class: CliConfigurationError },
      { pattern: /gh:.*not found/i, error_class: CliConfigurationError }
    ].freeze

    # Exception types that indicate programming errors (won't be fixed by retry)
    PERMANENT_EXCEPTION_TYPES = [
      ArgumentError,
      TypeError,
      NoMethodError,
      NameError,
      LoadError,
      SyntaxError
    ].freeze

    def self.classify(error_or_message)
      message = error_or_message.is_a?(Exception) ? error_or_message.message : error_or_message.to_s
      original = error_or_message.is_a?(Exception) ? error_or_message : nil

      # Check for permanent exception types first (programming errors)
      if original && PERMANENT_EXCEPTION_TYPES.any? { |type| original.is_a?(type) }
        return ValidationError.new(message, original_error: original)
      end

      # Check for transient errors by message pattern
      TRANSIENT_PATTERNS.each do |entry|
        if message.match?(entry[:pattern])
          return entry[:error_class].new(message, original_error: original)
        end
      end

      # Check for permanent errors by message pattern
      PERMANENT_PATTERNS.each do |entry|
        if message.match?(entry[:pattern])
          return entry[:error_class].new(message, original_error: original)
        end
      end

      # Default to transient for unknown errors (safer to retry)
      TransientError.new(message, original_error: original)
    end

    def self.transient?(error_or_message)
      classify(error_or_message).retryable?
    end

    def self.permanent?(error_or_message)
      !transient?(error_or_message)
    end
  end
end
