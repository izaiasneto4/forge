// Port of ReviewErrors: transient (retryable) vs permanent review failures,
// plus ErrorClassifier, which guesses the kind from an arbitrary error.
export class ReviewError extends Error {
  readonly originalError: unknown

  constructor(message?: string, options: { originalError?: unknown } = {}) {
    super(message ?? new.target.name)
    // Ruby's `e.class.name.demodulize`, used in job logs ("NetworkError: ...").
    this.name = new.target.name
    this.originalError = options.originalError ?? null
  }
}

export class TransientError extends ReviewError {
  get retryable() {
    return true
  }
}

export class PermanentError extends ReviewError {
  get retryable() {
    return false
  }
}

export class NetworkError extends TransientError {}

export class RateLimitError extends TransientError {
  readonly resetAt: Date | null

  constructor(message?: string, options: { resetAt?: Date | null; originalError?: unknown } = {}) {
    super(message, { originalError: options.originalError })
    this.resetAt = options.resetAt ?? null
  }
}

export class TimeoutError extends TransientError {}
export class ServiceUnavailableError extends TransientError {}

export class InvalidPullRequestError extends PermanentError {}
export class PermissionError extends PermanentError {}
export class AuthenticationError extends PermanentError {}
export class WorktreeError extends PermanentError {}
export class CliConfigurationError extends PermanentError {}
export class ValidationError extends PermanentError {}

type ClassifiedErrorClass = new (message?: string, options?: { originalError?: unknown }) => TransientError | PermanentError

const TRANSIENT_PATTERNS: Array<{ pattern: RegExp; errorClass: ClassifiedErrorClass }> = [
  { pattern: /Connection refused/i, errorClass: NetworkError },
  { pattern: /Connection timed out/i, errorClass: NetworkError },
  { pattern: /Could not resolve host/i, errorClass: NetworkError },
  { pattern: /Network is unreachable/i, errorClass: NetworkError },
  { pattern: /Connection reset by peer/i, errorClass: NetworkError },
  { pattern: /Temporary failure in name resolution/i, errorClass: NetworkError },
  { pattern: /rate limit/i, errorClass: RateLimitError },
  { pattern: /API rate limit exceeded/i, errorClass: RateLimitError },
  { pattern: /secondary rate limit/i, errorClass: RateLimitError },
  { pattern: /timeout/i, errorClass: TimeoutError },
  { pattern: /timed out/i, errorClass: TimeoutError },
  { pattern: /503.*Service Unavailable/i, errorClass: ServiceUnavailableError },
  { pattern: /502.*Bad Gateway/i, errorClass: ServiceUnavailableError },
  { pattern: /504.*Gateway Timeout/i, errorClass: ServiceUnavailableError },
]

const PERMANENT_PATTERNS: Array<{ pattern: RegExp; errorClass: ClassifiedErrorClass }> = [
  { pattern: /not found|404/i, errorClass: InvalidPullRequestError },
  { pattern: /pull request.*closed/i, errorClass: InvalidPullRequestError },
  { pattern: /pull request.*merged/i, errorClass: InvalidPullRequestError },
  { pattern: /permission denied/i, errorClass: PermissionError },
  { pattern: /403.*Forbidden/i, errorClass: PermissionError },
  { pattern: /repository access blocked/i, errorClass: PermissionError },
  { pattern: /401.*Unauthorized/i, errorClass: AuthenticationError },
  { pattern: /authentication failed/i, errorClass: AuthenticationError },
  { pattern: /bad credentials/i, errorClass: AuthenticationError },
  { pattern: /command not found/i, errorClass: CliConfigurationError },
  { pattern: /gh:.*not found/i, errorClass: CliConfigurationError },
]

// Ruby's ArgumentError/TypeError/NoMethodError/NameError/LoadError/SyntaxError:
// programming errors a retry won't fix.
const PERMANENT_EXCEPTION_TYPES = [TypeError, RangeError, ReferenceError, SyntaxError]

function messageOf(errorOrMessage: unknown) {
  if (errorOrMessage instanceof Error) return errorOrMessage.message
  if (errorOrMessage === null || errorOrMessage === undefined) return ''
  return String(errorOrMessage)
}

export function classifyError(errorOrMessage: unknown): TransientError | PermanentError {
  const message = messageOf(errorOrMessage)
  const originalError = errorOrMessage instanceof Error ? errorOrMessage : null

  if (originalError && PERMANENT_EXCEPTION_TYPES.some((type) => originalError instanceof type)) {
    return new ValidationError(message, { originalError })
  }

  const match = TRANSIENT_PATTERNS.find(({ pattern }) => pattern.test(message)) ?? PERMANENT_PATTERNS.find(({ pattern }) => pattern.test(message))
  if (match) return new match.errorClass(message, { originalError })

  // Unknown errors default to transient: retrying is the safer bet.
  return new TransientError(message, { originalError })
}

export function isTransientError(errorOrMessage: unknown) {
  return classifyError(errorOrMessage).retryable
}

export function isPermanentError(errorOrMessage: unknown) {
  return !isTransientError(errorOrMessage)
}
