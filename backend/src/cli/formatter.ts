// Port of Forge::Formatter (lib/forge/formatter.rb). API payloads arrive as
// untyped JSON, so field access follows Ruby's Hash semantics: missing keys read
// as nil, only nil/false are falsy, and shapes Ruby would crash on (e.g. `nil["x"]`)
// raise a TypeError instead of being papered over.

export interface Writer {
  write(text: string): unknown
}

export type JsonObject = { [key: string]: unknown }

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function rubyTruthy(value: unknown) {
  return value !== null && value !== undefined && value !== false
}

export function rubyInspect(value: unknown): string {
  if (value === null || value === undefined) return 'nil'
  if (typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(rubyInspect).join(', ')}]`
  if (isJsonObject(value)) {
    const pairs = Object.entries(value).map(([key, item]) => `${JSON.stringify(key)} => ${rubyInspect(item)}`)
    return `{${pairs.join(', ')}}`
  }
  return String(value)
}

// String interpolation (`"#{value}"`): nil renders empty, collections render inspected.
export function rubyToS(value: unknown) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value) || isJsonObject(value)) return rubyInspect(value)
  return String(value)
}

function requireHash(receiver: unknown, key: string): JsonObject {
  if (isJsonObject(receiver)) return receiver
  throw new TypeError(`cannot read ${JSON.stringify(key)} from ${rubyInspect(receiver)}`)
}

// Hash#[]
export function rubyIndex(receiver: unknown, key: string) {
  const hash = requireHash(receiver, key)
  return Object.hasOwn(hash, key) ? hash[key] : null
}

// Hash#fetch(key, default): the default only applies when the key is absent, not when it is nil.
export function rubyFetch(receiver: unknown, key: string, fallback: unknown) {
  const hash = requireHash(receiver, key)
  return Object.hasOwn(hash, key) ? hash[key] : fallback
}

// #empty? works on Array, Hash and String alike; only an Array can then be mapped.
function rubyEmpty(value: unknown) {
  if (Array.isArray(value) || typeof value === 'string') return value.length === 0
  if (isJsonObject(value)) return Object.keys(value).length === 0
  throw new TypeError(`undefined method 'empty?' for ${rubyInspect(value)}`)
}

export function rubyArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  throw new TypeError(`expected an array, got ${rubyInspect(value)}`)
}

// IO#puts: appends a newline unless the text already ends with one.
export function puts(io: Writer, text: string) {
  io.write(text.endsWith('\n') ? text : `${text}\n`)
}

export function dump(jsonMode: boolean, output: unknown, io: Writer) {
  puts(io, jsonMode ? JSON.stringify(output ?? null, null, 2) : rubyToS(output))
}

export function syncResult(result: unknown) {
  if (rubyTruthy(rubyIndex(result, 'skipped'))) {
    return `Sync skipped (${rubyToS(rubyIndex(result, 'seconds_remaining'))}s remaining)`
  }
  return 'Synced successfully'
}

export function reviewResult(result: unknown) {
  const message = `Review task #${rubyToS(rubyIndex(result, 'task_id'))} ${rubyToS(rubyIndex(result, 'state'))}`
  const queuePosition = rubyIndex(result, 'queue_position')
  if (!rubyTruthy(queuePosition)) return message

  return `${message} (queue position ${rubyToS(queuePosition)})`
}

export function statusResult(result: unknown) {
  const counts = rubyFetch(result, 'counts', {})
  const repo = rubyIndex(result, 'repo')
  const count = (key: string) => rubyToS(rubyIndex(counts, key))
  return [
    `repo=${rubyTruthy(repo) ? rubyToS(repo) : 'none'}`,
    `pending=${count('pending_review')}`,
    `in_review=${count('in_review')}`,
    `queued=${count('queued')}`,
    `failed=${count('failed_review')}`,
  ].join(' ')
}

export function listResult(result: unknown) {
  const items = rubyFetch(result, 'items', [])
  if (rubyEmpty(items)) return 'No pull requests'

  return rubyArray(items)
    .map((item) => {
      const field = (key: string) => rubyToS(rubyIndex(item, key))
      return `#${field('number')} [${field('review_status')}] ${field('repo')} ${field('title')}`
    })
    .join('\n')
}

export function logsResult(result: unknown) {
  const logs = rubyFetch(result, 'logs', [])
  if (rubyEmpty(logs)) return 'No logs'

  return rubyArray(logs)
    .map((log) => {
      const field = (key: string) => rubyToS(rubyIndex(log, key))
      return `[${field('id')}] ${field('log_type')}: ${field('message')}`
    })
    .join('\n')
}

export function switchResult(result: unknown) {
  return `Switched to ${rubyToS(rubyIndex(result, 'repo'))} (${rubyToS(rubyIndex(result, 'repo_path'))})`
}
