// Small helpers that reproduce Ruby/Rails semantics the API contract depends on.

// Rails' `blank?` for the string/nullish values stored in this app.
export function isBlank(value: string | null | undefined): value is null | undefined {
  return value === null || value === undefined || value.trim() === ''
}

export function isPresent(value: string | null | undefined): value is string {
  return !isBlank(value)
}

// Rails `Time#iso8601` in UTC: second precision with a "Z" suffix.
export function iso8601(value: Date): string
export function iso8601(value: Date | null | undefined): string | null
export function iso8601(value: Date | null | undefined): string | null {
  if (!value) return null
  return value.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

// ActiveSupport `String#truncate(length)` with the default "..." omission.
export function truncate(text: string, length: number, omission = '...') {
  if (text.length <= length) return text
  return `${text.slice(0, Math.max(0, length - omission.length))}${omission}`
}

// Ruby `File.basename(path)`: ignores trailing slashes; "/" stays "/".
export function rubyBasename(path: string) {
  const trimmed = path.replace(/\/+$/, '')
  if (trimmed === '') return path.startsWith('/') ? '/' : ''
  return trimmed.slice(trimmed.lastIndexOf('/') + 1)
}

export function secondsBetween(later: Date, earlier: Date) {
  return (later.getTime() - earlier.getTime()) / 1000
}

export function secondsAgo(seconds: number, now = new Date()) {
  return new Date(now.getTime() - seconds * 1000)
}
