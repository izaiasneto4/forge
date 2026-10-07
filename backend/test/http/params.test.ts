import { describe, expect, test } from 'bun:test'
import { ParameterMissingError } from '../../src/lib/errors'
import { castBoolean, idParam, InvalidParamError, mergeParams, parseBoolean, parseInteger, requireParam } from '../../src/http/params'

describe('params', () => {
  test('merges query and JSON body like Rails params', () => {
    const query = { status: 'all', limit: '10' }
    const body = { limit: 20 }

    expect(mergeParams(query, body)).toEqual({ status: query.status, limit: body.limit })
    expect(mergeParams(query, null)).toEqual(query)
  })

  test.each([true, 'true', '1', 1])('parse_boolean treats %p as true', (value) => {
    expect(parseBoolean(value)).toBe(true)
  })

  test.each([false, 'false', '0', 0, null, undefined])('parse_boolean treats %p as false', (value) => {
    expect(parseBoolean(value)).toBe(false)
  })

  test('parse_boolean rejects anything else with the Rails message', () => {
    const value = 'yes'

    expect(() => parseBoolean(value)).toThrow(new InvalidParamError(`Invalid boolean value: "${value}"`))
  })

  test('parse_integer applies defaults and range checks', () => {
    const options = { defaultValue: 50, min: 1, max: 200, name: 'limit' }
    const rangeError = `${options.name} must be between ${options.min} and ${options.max}`

    expect(parseInteger(undefined, options)).toBe(options.defaultValue)
    expect(parseInteger('25', options)).toBe(25)
    expect(() => parseInteger('abc', options)).toThrow(rangeError)
    expect(() => parseInteger(String(options.max + 1), options)).toThrow(rangeError)
  })

  test('require refuses missing and blank values but accepts false', () => {
    expect(() => requireParam({}, 'repo')).toThrow(ParameterMissingError)
    expect(() => requireParam({ repo: '  ' }, 'repo')).toThrow(ParameterMissingError)
    expect(requireParam({ flag: false }, 'flag')).toBe(false)
  })

  test('casts booleans like ActiveModel', () => {
    expect([castBoolean('false'), castBoolean('0'), castBoolean('off'), castBoolean(false)]).toEqual([false, false, false, false])
    expect([castBoolean('true'), castBoolean('yes'), castBoolean(true)]).toEqual([true, true, true])
    expect(castBoolean(undefined)).toBeNull()
  })

  test('reads route ids the way ActiveRecord casts them', () => {
    expect(idParam('12')).toBe(12)
    expect(idParam('12abc')).toBe(12)
    expect(idParam('abc')).toBe(0)
  })
})
