import { describe, expect, it } from 'vitest'

import { elapsedClock, formatDuration, pluralize, relativeAge, relativeAgo, staleness } from './format'

const now = Date.parse('2026-10-06T12:00:00Z')
const minutesAgo = (minutes: number) => new Date(now - minutes * 60_000).toISOString()

describe('format', () => {
  it('formats compact relative ages', () => {
    const cases: Array<[number, string]> = [
      [0, 'just now'],
      [5, '5m'],
      [180, '3h'],
      [3 * 24 * 60, '3d'],
    ]

    for (const [minutes, expected] of cases) {
      expect(relativeAge(minutesAgo(minutes), now)).toBe(expected)
    }
    expect(relativeAgo(minutesAgo(5), now)).toBe(`${relativeAge(minutesAgo(5), now)} ago`)
    expect(relativeAge(null, now)).toBe('')
  })

  it('flags pull requests that have waited too long', () => {
    const day = 24 * 60

    expect(staleness(minutesAgo(day), now)).toBe('fresh')
    expect(staleness(minutesAgo(3 * day), now)).toBe('stale')
    expect(staleness(minutesAgo(6 * day), now)).toBe('rotten')
  })

  it('formats elapsed time and durations', () => {
    const seconds = 95

    expect(elapsedClock(new Date(now - seconds * 1000).toISOString(), now)).toBe('1:35')
    expect(formatDuration(seconds)).toBe('1m 35s')
    expect(formatDuration(120)).toBe('2m')
    expect(formatDuration(null)).toBeNull()
  })

  it('pluralizes counts', () => {
    expect(pluralize(1, 'finding')).toBe('1 finding')
    expect(pluralize(3, 'finding')).toBe('3 findings')
  })
})
