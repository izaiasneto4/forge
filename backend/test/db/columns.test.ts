import { describe, expect, test } from 'bun:test'
import { formatRailsDatetime, parseRailsDatetime } from '../../src/db/columns'

describe('rails datetime column', () => {
  test('parses Rails microsecond timestamps as UTC, truncating to milliseconds', () => {
    const date = '2026-10-06'
    const time = '14:05:09'
    const milliseconds = '123'

    const parsed = parseRailsDatetime(`${date} ${time}.${milliseconds}456`)

    expect(parsed.toISOString()).toBe(`${date}T${time}.${milliseconds}Z`)
  })

  test('parses timestamps without a fractional part', () => {
    const date = '2026-10-06'
    const time = '14:05:09'

    const parsed = parseRailsDatetime(`${date} ${time}`)

    expect(parsed.toISOString()).toBe(`${date}T${time}.000Z`)
  })

  test('formats like Rails: microseconds when present, no fraction when zero', () => {
    const date = '2026-10-06'
    const time = '14:05:09'
    const milliseconds = '120'

    const withFraction = new Date(`${date}T${time}.${milliseconds}Z`)
    const withoutFraction = new Date(`${date}T${time}.000Z`)

    expect(formatRailsDatetime(withFraction)).toBe(`${date} ${time}.${milliseconds}000`)
    expect(formatRailsDatetime(withoutFraction)).toBe(`${date} ${time}`)
  })

  test('round-trips through the Rails text format', () => {
    const original = new Date()

    expect(parseRailsDatetime(formatRailsDatetime(original))).toEqual(original)
  })

  test('rejects unknown formats', () => {
    const isoTimestamp = new Date().toISOString()

    expect(() => parseRailsDatetime(isoTimestamp)).toThrow()
  })
})
