require "test_helper"

class ReviewErrorsTest < ActiveSupport::TestCase
  test "Error stores original_error" do
    original = StandardError.new("original message")
    error = ReviewErrors::Error.new("wrapped message", original_error: original)

    assert_equal "wrapped message", error.message
    assert_equal original, error.original_error
  end

  test "Error handles nil original_error" do
    error = ReviewErrors::Error.new("message")

    assert_equal "message", error.message
    assert_nil error.original_error
  end

  test "TransientError is retryable" do
    error = ReviewErrors::TransientError.new

    assert error.retryable?
  end

  test "PermanentError is not retryable" do
    error = ReviewErrors::PermanentError.new

    refute error.retryable?
  end

  test "NetworkError inherits from TransientError" do
    error = ReviewErrors::NetworkError.new

    assert_kind_of ReviewErrors::TransientError, error
    assert error.retryable?
  end

  test "TimeoutError inherits from TransientError" do
    error = ReviewErrors::TimeoutError.new

    assert_kind_of ReviewErrors::TransientError, error
    assert error.retryable?
  end

  test "ServiceUnavailableError inherits from TransientError" do
    error = ReviewErrors::ServiceUnavailableError.new

    assert_kind_of ReviewErrors::TransientError, error
    assert error.retryable?
  end

  test "InvalidPullRequestError inherits from PermanentError" do
    error = ReviewErrors::InvalidPullRequestError.new

    assert_kind_of ReviewErrors::PermanentError, error
    refute error.retryable?
  end

  test "PermissionError inherits from PermanentError" do
    error = ReviewErrors::PermissionError.new

    assert_kind_of ReviewErrors::PermanentError, error
    refute error.retryable?
  end

  test "AuthenticationError inherits from PermanentError" do
    error = ReviewErrors::AuthenticationError.new

    assert_kind_of ReviewErrors::PermanentError, error
    refute error.retryable?
  end

  test "WorktreeError inherits from PermanentError" do
    error = ReviewErrors::WorktreeError.new

    assert_kind_of ReviewErrors::PermanentError, error
    refute error.retryable?
  end

  test "CliConfigurationError inherits from PermanentError" do
    error = ReviewErrors::CliConfigurationError.new

    assert_kind_of ReviewErrors::PermanentError, error
    refute error.retryable?
  end

  test "ValidationError inherits from PermanentError" do
    error = ReviewErrors::ValidationError.new

    assert_kind_of ReviewErrors::PermanentError, error
    refute error.retryable?
  end

  test "RateLimitError includes reset_at" do
    reset_time = Time.now + 3600
    error = ReviewErrors::RateLimitError.new("rate limited", reset_at: reset_time)

    assert_kind_of ReviewErrors::TransientError, error
    assert_equal reset_time, error.reset_at
    assert_equal "rate limited", error.message
  end

  test "RateLimitError handles nil reset_at" do
    error = ReviewErrors::RateLimitError.new("rate limited")

    assert_nil error.reset_at
  end

  test "RateLimitError stores original_error" do
    original = StandardError.new("original")
    reset_time = Time.now + 3600
    error = ReviewErrors::RateLimitError.new("rate limited", reset_at: reset_time, original_error: original)

    assert_equal original, error.original_error
    assert_equal reset_time, error.reset_at
  end
end

class ReviewErrorsErrorClassifierTest < ActiveSupport::TestCase
  test "classifies connection refused as NetworkError" do
    result = ReviewErrors::ErrorClassifier.classify("Connection refused")

    assert_kind_of ReviewErrors::NetworkError, result
    assert result.retryable?
  end

  test "classifies connection timed out as NetworkError" do
    result = ReviewErrors::ErrorClassifier.classify("Connection timed out")

    assert_kind_of ReviewErrors::NetworkError, result
  end

  test "classifies could not resolve host as NetworkError" do
    result = ReviewErrors::ErrorClassifier.classify("Could not resolve host api.github.com")

    assert_kind_of ReviewErrors::NetworkError, result
  end

  test "classifies network unreachable as NetworkError" do
    result = ReviewErrors::ErrorClassifier.classify("Network is unreachable")

    assert_kind_of ReviewErrors::NetworkError, result
  end

  test "classifies connection reset by peer as NetworkError" do
    result = ReviewErrors::ErrorClassifier.classify("Connection reset by peer")

    assert_kind_of ReviewErrors::NetworkError, result
  end

  test "classifies temporary failure in name resolution as NetworkError" do
    result = ReviewErrors::ErrorClassifier.classify("Temporary failure in name resolution")

    assert_kind_of ReviewErrors::NetworkError, result
  end

  test "classifies rate limit as RateLimitError" do
    result = ReviewErrors::ErrorClassifier.classify("rate limit exceeded")

    assert_kind_of ReviewErrors::RateLimitError, result
  end

  test "classifies API rate limit exceeded as RateLimitError" do
    result = ReviewErrors::ErrorClassifier.classify("API rate limit exceeded")

    assert_kind_of ReviewErrors::RateLimitError, result
  end

  test "classifies secondary rate limit as RateLimitError" do
    result = ReviewErrors::ErrorClassifier.classify("secondary rate limit")

    assert_kind_of ReviewErrors::RateLimitError, result
  end

  test "classifies timeout as TimeoutError" do
    result = ReviewErrors::ErrorClassifier.classify("Operation timeout")

    assert_kind_of ReviewErrors::TimeoutError, result
  end

  test "classifies timed out as TimeoutError" do
    result = ReviewErrors::ErrorClassifier.classify("Request timed out")

    assert_kind_of ReviewErrors::TimeoutError, result
  end

  test "classifies 503 Service Unavailable as ServiceUnavailableError" do
    result = ReviewErrors::ErrorClassifier.classify("503 Service Unavailable")

    assert_kind_of ReviewErrors::ServiceUnavailableError, result
  end

  test "classifies 502 Bad Gateway as ServiceUnavailableError" do
    result = ReviewErrors::ErrorClassifier.classify("502 Bad Gateway")

    assert_kind_of ReviewErrors::ServiceUnavailableError, result
  end

  test "classifies 504 Gateway Timeout as TimeoutError (timeout pattern matches first)" do
    result = ReviewErrors::ErrorClassifier.classify("504 Gateway Timeout")

    assert_kind_of ReviewErrors::TimeoutError, result
  end

  test "classifies not found or 404 as InvalidPullRequestError" do
    result = ReviewErrors::ErrorClassifier.classify("not found")

    assert_kind_of ReviewErrors::InvalidPullRequestError, result
  end

  test "classifies 404 as InvalidPullRequestError" do
    result = ReviewErrors::ErrorClassifier.classify("404 Not Found")

    assert_kind_of ReviewErrors::InvalidPullRequestError, result
  end

  test "classifies pull request closed as InvalidPullRequestError" do
    result = ReviewErrors::ErrorClassifier.classify("pull request #123 is closed")

    assert_kind_of ReviewErrors::InvalidPullRequestError, result
  end

  test "classifies pull request merged as InvalidPullRequestError" do
    result = ReviewErrors::ErrorClassifier.classify("pull request #123 is merged")

    assert_kind_of ReviewErrors::InvalidPullRequestError, result
  end

  test "classifies permission denied as PermissionError" do
    result = ReviewErrors::ErrorClassifier.classify("permission denied")

    assert_kind_of ReviewErrors::PermissionError, result
  end

  test "classifies 403 Forbidden as PermissionError" do
    result = ReviewErrors::ErrorClassifier.classify("403 Forbidden")

    assert_kind_of ReviewErrors::PermissionError, result
  end

  test "classifies repository access blocked as PermissionError" do
    result = ReviewErrors::ErrorClassifier.classify("repository access blocked")

    assert_kind_of ReviewErrors::PermissionError, result
  end

  test "classifies 401 Unauthorized as AuthenticationError" do
    result = ReviewErrors::ErrorClassifier.classify("401 Unauthorized")

    assert_kind_of ReviewErrors::AuthenticationError, result
  end

  test "classifies authentication failed as AuthenticationError" do
    result = ReviewErrors::ErrorClassifier.classify("authentication failed")

    assert_kind_of ReviewErrors::AuthenticationError, result
  end

  test "classifies bad credentials as AuthenticationError" do
    result = ReviewErrors::ErrorClassifier.classify("bad credentials")

    assert_kind_of ReviewErrors::AuthenticationError, result
  end

  test "classifies gh: command not found as InvalidPullRequestError (not found pattern matches first)" do
    result = ReviewErrors::ErrorClassifier.classify("gh: command not found")

    assert_kind_of ReviewErrors::InvalidPullRequestError, result
  end

  test "classifies gh: not found as InvalidPullRequestError (not found pattern matches first)" do
    result = ReviewErrors::ErrorClassifier.classify("gh: not found")

    assert_kind_of ReviewErrors::InvalidPullRequestError, result
  end

  test "classifies unknown errors as TransientError" do
    result = ReviewErrors::ErrorClassifier.classify("some unknown error")

    assert_kind_of ReviewErrors::TransientError, result
    assert result.retryable?
  end

  test "classify stores original_error when passed Exception" do
    original = StandardError.new("original error message")
    result = ReviewErrors::ErrorClassifier.classify(original)

    assert_equal original, result.original_error
    assert_equal "original error message", result.message
  end

  test "classify handles empty string" do
    result = ReviewErrors::ErrorClassifier.classify("")

    assert_kind_of ReviewErrors::TransientError, result
  end

  test "classify handles nil input" do
    result = ReviewErrors::ErrorClassifier.classify(nil)

    assert_kind_of ReviewErrors::TransientError, result
  end

  test "transient? returns true for transient errors" do
    assert ReviewErrors::ErrorClassifier.transient?("Connection refused")
    assert ReviewErrors::ErrorClassifier.transient?("API rate limit exceeded")
    assert ReviewErrors::ErrorClassifier.transient?("Request timed out")
  end

  test "transient? returns false for permanent errors" do
    refute ReviewErrors::ErrorClassifier.transient?("not found")
    refute ReviewErrors::ErrorClassifier.transient?("403 Forbidden")
    refute ReviewErrors::ErrorClassifier.transient?("401 Unauthorized")
  end

  test "transient? returns true for unknown errors (safe default)" do
    assert ReviewErrors::ErrorClassifier.transient?("unknown error")
  end

  test "permanent? returns false for transient errors" do
    refute ReviewErrors::ErrorClassifier.permanent?("Connection refused")
    refute ReviewErrors::ErrorClassifier.permanent?("API rate limit exceeded")
  end

  test "permanent? returns true for permanent errors" do
    assert ReviewErrors::ErrorClassifier.permanent?("not found")
    assert ReviewErrors::ErrorClassifier.permanent?("403 Forbidden")
    assert ReviewErrors::ErrorClassifier.permanent?("401 Unauthorized")
  end

  test "permanent? returns false for unknown errors" do
    refute ReviewErrors::ErrorClassifier.permanent?("unknown error")
  end

  test "transient? works with Exception objects" do
    error = StandardError.new("Connection refused")

    assert ReviewErrors::ErrorClassifier.transient?(error)
  end

  test "permanent? works with Exception objects" do
    error = StandardError.new("not found")

    assert ReviewErrors::ErrorClassifier.permanent?(error)
  end
end
