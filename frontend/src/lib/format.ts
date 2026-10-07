import type { PullRequestItem } from '../types/api'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export type Staleness = 'fresh' | 'stale' | 'rotten'

function timestamp(value: string | null | undefined) {
  if (!value) return null
  const parsed = new Date(value).getTime()
  return Number.isNaN(parsed) ? null : parsed
}

export function relativeAge(value: string | null | undefined, now: number = Date.now()) {
  const time = timestamp(value)
  if (time === null) return ''

  const elapsed = Math.max(0, now - time)
  if (elapsed < 45_000) return 'just now'
  if (elapsed < HOUR) return `${Math.round(elapsed / MINUTE)}m`
  if (elapsed < DAY) return `${Math.round(elapsed / HOUR)}h`
  return `${Math.round(elapsed / DAY)}d`
}

export function relativeAgo(value: string | null | undefined, now: number = Date.now()) {
  const age = relativeAge(value, now)
  if (!age || age === 'just now') return age
  return `${age} ago`
}

export function staleness(value: string | null | undefined, now: number = Date.now()): Staleness {
  const time = timestamp(value)
  if (time === null) return 'fresh'

  const days = (now - time) / DAY
  if (days > 5) return 'rotten'
  if (days > 2.5) return 'stale'
  return 'fresh'
}

export function elapsedClock(value: string | null | undefined, now: number = Date.now()) {
  const time = timestamp(value)
  if (time === null) return '0:00'

  const seconds = Math.max(0, Math.floor((now - time) / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export function formatDuration(seconds: number | null | undefined) {
  if (seconds == null) return null
  if (seconds < 60) return `${Math.round(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  return rest ? `${minutes}m ${String(rest).padStart(2, '0')}s` : `${minutes}m`
}

export function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`
}

export function formatCount(value: number | null | undefined) {
  return (value ?? 0).toLocaleString('en-US')
}

export function mergeVerb(remoteState: PullRequestItem['remote_state'], authored: boolean) {
  if (remoteState === 'merged') return 'merged into'
  if (remoteState === 'closed') return 'wanted to merge into'
  return authored ? 'want to merge into' : 'wants to merge into'
}
