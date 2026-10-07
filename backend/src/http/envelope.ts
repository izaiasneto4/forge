import { Elysia, t, type TSchema } from 'elysia'
import { ParameterMissingError, RecordNotFoundError } from '../lib/errors'
import { logger } from '../lib/logger'
import { InvalidParamError } from './params'

// Mirrors Api::V1::BaseController#render_ok / #render_error.
export function ok<Payload extends object>(payload: Payload): Payload & { ok: true } {
  return { ...payload, ok: true }
}

export function okSchema<Properties extends Record<string, TSchema>>(properties: Properties) {
  return t.Object({ ...properties, ok: t.Literal(true) })
}

export const ERROR_CODES = Object.freeze({
  invalidInput: 'invalid_input',
  notFound: 'not_found',
  internal: 'internal_error',
  upstreamUnavailable: 'upstream_unavailable',
})

const INTERNAL_ERROR_MESSAGE = 'Internal server error'

export const ErrorEnvelope = t.Object({
  ok: t.Literal(false),
  error: t.Object({
    code: t.String(),
    message: t.String(),
    details: t.Optional(t.Unknown()),
  }),
})

// Field is `errorCode`, not `code`: Elysia treats an error's `code` as its own error type.
export class ApiError extends Error {
  constructor(
    readonly errorCode: string,
    message: string,
    readonly status = 422,
    readonly details?: unknown,
  ) {
    super(message)
  }
}

// Domain errors raised by models and param helpers, rendered like BaseController's rescue_from.
function domainErrorResponse(error: unknown, set: { status?: number | string }) {
  if (error instanceof RecordNotFoundError) {
    set.status = 404
    return errorBody(ERROR_CODES.notFound, 'Resource not found')
  }
  if (error instanceof ParameterMissingError || error instanceof InvalidParamError) {
    set.status = 422
    return errorBody(ERROR_CODES.invalidInput, error.message)
  }
  return undefined
}

function errorBody(code: string, message: string, details?: unknown): typeof ErrorEnvelope.static {
  return { ok: false, error: details === undefined ? { code, message } : { code, message, details } }
}

export const errorHandling = new Elysia({ name: 'error-handling' })
  .error({ ApiError })
  .onError({ as: 'global' }, ({ code, error, set }) => {
    switch (code) {
      case 'ApiError':
        set.status = error.status
        return errorBody(error.errorCode, error.message, error.details)
      case 'VALIDATION':
        if (error.type === 'response') {
          set.status = 500
          return errorBody(ERROR_CODES.internal, 'Response did not match its contract')
        }

        set.status = 422
        return errorBody(ERROR_CODES.invalidInput, error.message)
      // Rails answers malformed request bodies with 400 Bad Request.
      case 'PARSE':
        set.status = 400
        return errorBody(ERROR_CODES.invalidInput, error.message)
      case 'NOT_FOUND':
        set.status = 404
        return errorBody(ERROR_CODES.notFound, 'Resource not found')
      default: {
        const domainResponse = domainErrorResponse(error, set)
        if (domainResponse) return domainResponse
        logger.error(`[http] unhandled ${error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error)}`)
        set.status = 500
        return errorBody(ERROR_CODES.internal, INTERNAL_ERROR_MESSAGE)
      }
    }
  })
