import { describe, expect, test } from 'bun:test'
import {
  AuthenticationError,
  classifyError,
  CliConfigurationError,
  InvalidPullRequestError,
  isPermanentError,
  isTransientError,
  NetworkError,
  PermanentError,
  PermissionError,
  RateLimitError,
  ReviewError,
  ServiceUnavailableError,
  TimeoutError,
  TransientError,
  ValidationError,
  WorktreeError,
} from '../../src/services/review-errors'

describe('ReviewErrors', () => {
  test('Error stores original_error', () => {
    const original = new Error('original message')
    const wrappedMessage = 'wrapped message'

    const error = new ReviewError(wrappedMessage, { originalError: original })

    expect(error.message).toBe(wrappedMessage)
    expect(error.originalError).toBe(original)
  })

  test('Error handles nil original_error', () => {
    const message = 'message'

    const error = new ReviewError(message)

    expect(error.message).toBe(message)
    expect(error.originalError).toBeNull()
  })

  test('TransientError is retryable', () => {
    expect(new TransientError().retryable).toBe(true)
  })

  test('PermanentError is not retryable', () => {
    expect(new PermanentError().retryable).toBe(false)
  })

  test.each([
    ['NetworkError', NetworkError],
    ['TimeoutError', TimeoutError],
    ['ServiceUnavailableError', ServiceUnavailableError],
  ])('%s inherits from TransientError', (_name, ErrorClass) => {
    const error = new ErrorClass()

    expect(error).toBeInstanceOf(TransientError)
    expect(error.retryable).toBe(true)
  })

  test.each([
    ['InvalidPullRequestError', InvalidPullRequestError],
    ['PermissionError', PermissionError],
    ['AuthenticationError', AuthenticationError],
    ['WorktreeError', WorktreeError],
    ['CliConfigurationError', CliConfigurationError],
    ['ValidationError', ValidationError],
  ])('%s inherits from PermanentError', (_name, ErrorClass) => {
    const error = new ErrorClass()

    expect(error).toBeInstanceOf(PermanentError)
    expect(error.retryable).toBe(false)
  })

  test('RateLimitError includes reset_at', () => {
    const resetTime = new Date(Date.now() + 3600_000)
    const message = 'rate limited'

    const error = new RateLimitError(message, { resetAt: resetTime })

    expect(error).toBeInstanceOf(TransientError)
    expect(error.resetAt).toBe(resetTime)
    expect(error.message).toBe(message)
  })

  test('RateLimitError handles nil reset_at', () => {
    expect(new RateLimitError('rate limited').resetAt).toBeNull()
  })

  test('RateLimitError stores original_error', () => {
    const original = new Error('original')
    const resetTime = new Date(Date.now() + 3600_000)

    const error = new RateLimitError('rate limited', { resetAt: resetTime, originalError: original })

    expect(error.originalError).toBe(original)
    expect(error.resetAt).toBe(resetTime)
  })

  test('name is the demodulized class name used in job logs', () => {
    const expectedName = 'NetworkError'

    expect(new NetworkError('boom').name).toBe(expectedName)
  })
})

describe('ErrorClassifier', () => {
  const classifications: Array<[string, new () => ReviewError]> = [
    ['Connection refused', NetworkError],
    ['Connection timed out', NetworkError],
    ['Could not resolve host api.github.com', NetworkError],
    ['Network is unreachable', NetworkError],
    ['Connection reset by peer', NetworkError],
    ['Temporary failure in name resolution', NetworkError],
    ['rate limit exceeded', RateLimitError],
    ['API rate limit exceeded', RateLimitError],
    ['secondary rate limit', RateLimitError],
    ['Operation timeout', TimeoutError],
    ['Request timed out', TimeoutError],
    ['503 Service Unavailable', ServiceUnavailableError],
    ['502 Bad Gateway', ServiceUnavailableError],
    // The timeout pattern matches before the 504 one.
    ['504 Gateway Timeout', TimeoutError],
    ['not found', InvalidPullRequestError],
    ['404 Not Found', InvalidPullRequestError],
    ['pull request #123 is closed', InvalidPullRequestError],
    ['pull request #123 is merged', InvalidPullRequestError],
    ['permission denied', PermissionError],
    ['403 Forbidden', PermissionError],
    ['repository access blocked', PermissionError],
    ['401 Unauthorized', AuthenticationError],
    ['authentication failed', AuthenticationError],
    ['bad credentials', AuthenticationError],
    // "not found" matches before the CLI configuration patterns.
    ['gh: command not found', InvalidPullRequestError],
    ['gh: not found', InvalidPullRequestError],
    ['some unknown error', TransientError],
  ]

  test.each(classifications)('classifies %p as %p', (message, expectedClass) => {
    const result = classifyError(message)

    expect(result).toBeInstanceOf(expectedClass)
    expect(result.message).toBe(message)
  })

  test('classifies connection refused as retryable', () => {
    expect(classifyError('Connection refused').retryable).toBe(true)
  })

  test('unknown errors are retryable', () => {
    expect(classifyError('some unknown error').retryable).toBe(true)
  })

  test('classify stores original_error when passed an Error', () => {
    const originalMessage = 'original error message'
    const original = new Error(originalMessage)

    const result = classifyError(original)

    expect(result.originalError).toBe(original)
    expect(result.message).toBe(originalMessage)
  })

  test.each([[''], [null], [undefined]])('classify treats %p as an unknown transient error', (input) => {
    expect(classifyError(input)).toBeInstanceOf(TransientError)
  })

  test.each([
    ['TypeError', new TypeError('Connection refused')],
    ['RangeError', new RangeError('Invalid argument')],
    ['ReferenceError', new ReferenceError('undefined variable')],
    ['SyntaxError', new SyntaxError('Unexpected token')],
  ])('classifies programming error %s as a permanent ValidationError', (_name, error) => {
    const result = classifyError(error)

    expect(result).toBeInstanceOf(ValidationError)
    expect(result.retryable).toBe(false)
    expect(result.originalError).toBe(error)
  })

  const transientMessages = ['Connection refused', 'API rate limit exceeded', 'Request timed out']
  const permanentMessages = ['not found', '403 Forbidden', '401 Unauthorized']

  test('transient? returns true for transient errors', () => {
    for (const message of transientMessages) expect(isTransientError(message)).toBe(true)
  })

  test('transient? returns false for permanent errors', () => {
    for (const message of permanentMessages) expect(isTransientError(message)).toBe(false)
  })

  test('transient? returns true for unknown errors (safe default)', () => {
    expect(isTransientError('unknown error')).toBe(true)
  })

  test('permanent? returns false for transient errors', () => {
    for (const message of transientMessages) expect(isPermanentError(message)).toBe(false)
  })

  test('permanent? returns true for permanent errors', () => {
    for (const message of permanentMessages) expect(isPermanentError(message)).toBe(true)
  })

  test('permanent? returns false for unknown errors', () => {
    expect(isPermanentError('unknown error')).toBe(false)
  })

  test('transient? and permanent? work with Error objects', () => {
    expect(isTransientError(new Error('Connection refused'))).toBe(true)
    expect(isPermanentError(new Error('not found'))).toBe(true)
  })
})
