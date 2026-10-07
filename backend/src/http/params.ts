import { ParameterMissingError } from '../lib/errors'

// Rails merges query string and JSON body into `params`.
export type Params = Record<string, unknown>

export function mergeParams(query: Record<string, unknown>, body: unknown): Params {
  const bodyParams: Params = typeof body === 'object' && body !== null && !Array.isArray(body) ? { ...body } : {}
  return { ...query, ...bodyParams }
}

// Raised where Rails raised ArgumentError; controllers render it as invalid_input.
export class InvalidParamError extends Error {}

function inspect(value: unknown) {
  if (value === null || value === undefined) return 'nil'
  if (typeof value === 'string') return JSON.stringify(value)
  return String(value)
}

export function isBlankParam(value: unknown) {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim() === ''
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'object') return Object.keys(value).length === 0
  return false
}

// `params.require(name)`: present (or literally false) values only.
export function requireParam(params: Params, name: string): unknown {
  const value = params[name]
  if (value !== false && isBlankParam(value)) throw new ParameterMissingError(name)
  return value
}

export function requireStringParam(params: Params, name: string) {
  return String(requireParam(params, name))
}

// `params[:x].presence` for string params.
export function presentString(params: Params, name: string) {
  const value = params[name]
  if (value === null || value === undefined) return null
  const text = typeof value === 'string' ? value : String(value)
  return text.trim() === '' ? null : text
}

// Api::V1::BaseController#parse_boolean.
export function parseBoolean(value: unknown) {
  if (value === true || value === 'true' || value === '1' || value === 1) return true
  if (value === false || value === 'false' || value === '0' || value === 0 || value === null || value === undefined) return false
  throw new InvalidParamError(`Invalid boolean value: ${inspect(value)}`)
}

// ActiveModel::Type::Boolean#cast: false for "", "0", "f", "false", "off" (any case); nil stays nil.
export function castBoolean(value: unknown): boolean | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'string') return !['0', 'f', 'false', 'off'].includes(value.toLowerCase())
  return value !== false && value !== 0
}

function rubyInteger(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!/^[+-]?\d+(_\d+)*$/.test(trimmed)) return null
  return Number.parseInt(trimmed.replaceAll('_', ''), 10)
}

// Api::V1::BaseController#parse_integer.
export function parseInteger(value: unknown, options: { defaultValue: number; min: number; max: number; name: string }) {
  if (isBlankParam(value)) return options.defaultValue
  const parsed = rubyInteger(value)
  if (parsed === null || parsed < options.min || parsed > options.max) {
    throw new InvalidParamError(`${options.name} must be between ${options.min} and ${options.max}`)
  }
  return parsed
}

// Route ids: Rails' `find(params[:id])` casts "12abc" to 12 and a non-number to 0 (not found).
export function idParam(value: string) {
  const match = /^\s*(\d+)/.exec(value)
  return match?.[1] === undefined ? 0 : Number.parseInt(match[1], 10)
}
