import { describe, expect, it } from 'vitest'
import { getWaitingInfo } from './dateUtils'

describe('getWaitingInfo', () => {
  const now = new Date('2024-03-07T12:00:00Z')

  it('returns null if no date provided', () => {
    expect(getWaitingInfo(null)).toBeNull()
    expect(getWaitingInfo(undefined)).toBeNull()
  })

  it('returns green for recent activity (< 4h)', () => {
    const input = '2024-03-07T11:45:00Z' // 15m ago
    const result = getWaitingInfo(input, now)
    expect(result).toEqual({ label: 'waiting 15m', colorClass: 'linear-badge-green' })
    
    const input2 = '2024-03-07T09:00:00Z' // 3h ago
    const result2 = getWaitingInfo(input2, now)
    expect(result2).toEqual({ label: 'waiting 3h', colorClass: 'linear-badge-green' })
  })

  it('returns yellow for activity between 4h and 24h', () => {
    const input = '2024-03-07T07:00:00Z' // 5h ago
    const result = getWaitingInfo(input, now)
    expect(result).toEqual({ label: 'waiting 5h', colorClass: 'linear-badge-yellow' })

    const input2 = '2024-03-06T13:00:00Z' // 23h ago
    const result2 = getWaitingInfo(input2, now)
    expect(result2).toEqual({ label: 'waiting 23h', colorClass: 'linear-badge-yellow' })
  })

  it('returns red for activity > 24h', () => {
    const input = '2024-03-06T11:00:00Z' // 25h ago (1d ago)
    const result = getWaitingInfo(input, now)
    expect(result).toEqual({ label: 'waiting 1d', colorClass: 'linear-badge-red' })

    const input2 = '2024-03-05T12:00:00Z' // 2d ago
    const result2 = getWaitingInfo(input2, now)
    expect(result2).toEqual({ label: 'waiting 2d', colorClass: 'linear-badge-red' })
  })

  it('handles activity exactly at boundaries', () => {
    const input4h = '2024-03-07T08:00:00Z' // Exactly 4h ago
    const result4h = getWaitingInfo(input4h, now)
    expect(result4h?.colorClass).toBe('linear-badge-yellow')

    const input24h = '2024-03-06T12:00:00Z' // Exactly 24h ago
    const result24h = getWaitingInfo(input24h, now)
    expect(result24h?.colorClass).toBe('linear-badge-red')
  })

  it('handles future activity gracefully (0m ago)', () => {
    const inputFuture = '2024-03-07T12:05:00Z' // 5m in the future
    const resultFuture = getWaitingInfo(inputFuture, now)
    expect(resultFuture).toEqual({ label: 'waiting 0m', colorClass: 'linear-badge-green' })
  })

  it('handles 0ms ago activity', () => {
    const inputNow = '2024-03-07T12:00:00Z'
    const resultNow = getWaitingInfo(inputNow, now)
    expect(resultNow).toEqual({ label: 'waiting 0m', colorClass: 'linear-badge-green' })
  })

  it('handles empty string input', () => {
    expect(getWaitingInfo('')).toBeNull()
  })
})
