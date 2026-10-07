import { describe, expect, test } from 'bun:test'
import {
  dump,
  listResult,
  logsResult,
  reviewResult,
  rubyToS,
  statusResult,
  switchResult,
  syncResult,
} from '../../src/cli/formatter'
import { StringWriter } from './support'

const syncedMessage = 'Synced successfully'
const noPullRequests = 'No pull requests'
const noLogs = 'No logs'

describe('syncResult', () => {
  test('covers skipped and synced', () => {
    const secondsRemaining = 7

    expect(syncResult({ skipped: true, seconds_remaining: secondsRemaining })).toBe(
      `Sync skipped (${secondsRemaining}s remaining)`,
    )
    expect(syncResult({ skipped: false })).toBe(syncedMessage)
  })

  test('uses Ruby truthiness: only nil and false mean not skipped', () => {
    const secondsRemaining = 3

    expect(syncResult({ skipped: 0, seconds_remaining: secondsRemaining })).toBe(
      `Sync skipped (${secondsRemaining}s remaining)`,
    )
    expect(syncResult({ skipped: null })).toBe(syncedMessage)
    expect(syncResult({})).toBe(syncedMessage)
  })
})

describe('reviewResult', () => {
  const taskId = 1

  test('covers queued and non queued', () => {
    const pendingState = 'pending_review'
    const queuedState = 'queued'
    const queuePosition = 2

    expect(reviewResult({ task_id: taskId, state: pendingState, queue_position: null })).toBe(
      `Review task #${taskId} ${pendingState}`,
    )
    expect(reviewResult({ task_id: taskId, state: queuedState, queue_position: queuePosition })).toBe(
      `Review task #${taskId} ${queuedState} (queue position ${queuePosition})`,
    )
  })

  test('shows a zero queue position since 0 is truthy in Ruby', () => {
    const state = 'queued'
    const queuePosition = 0

    expect(reviewResult({ task_id: taskId, state, queue_position: queuePosition })).toBe(
      `Review task #${taskId} ${state} (queue position ${queuePosition})`,
    )
  })
})

describe('statusResult', () => {
  test('includes the repo and counts', () => {
    const repo = 'acme/api'
    const counts = { pending_review: 1, in_review: 2, queued: 3, failed_review: 4 }

    expect(statusResult({ repo, counts })).toBe(
      `repo=${repo} pending=${counts.pending_review} in_review=${counts.in_review} queued=${counts.queued} failed=${counts.failed_review}`,
    )
  })

  test('falls back to none for a missing repo and blanks for missing counts', () => {
    expect(statusResult({ repo: null })).toBe('repo=none pending= in_review= queued= failed=')
  })

  test('raises when counts is present but nil, as Ruby would', () => {
    expect(() => statusResult({ counts: null })).toThrow(TypeError)
  })
})

describe('listResult', () => {
  test('covers empty and non-empty', () => {
    const first = { number: 2, review_status: 'pending_review', repo: 'acme/api', title: 'Fix' }
    const second = { number: 3, review_status: 'in_review', repo: 'acme/web', title: 'Add' }
    const line = (item: typeof first) => `#${item.number} [${item.review_status}] ${item.repo} ${item.title}`

    expect(listResult({ items: [] })).toBe(noPullRequests)
    expect(listResult({ items: [first, second] })).toBe(`${line(first)}\n${line(second)}`)
  })

  test('treats a missing key, an empty hash or an empty string as empty', () => {
    expect(listResult({})).toBe(noPullRequests)
    expect(listResult({ items: {} })).toBe(noPullRequests)
    expect(listResult({ items: '' })).toBe(noPullRequests)
  })

  test('raises for items that cannot be listed', () => {
    expect(() => listResult({ items: null })).toThrow(TypeError)
    expect(() => listResult({ items: { number: 1 } })).toThrow(TypeError)
  })
})

describe('logsResult', () => {
  test('covers empty and non-empty', () => {
    const log = { id: 1, log_type: 'output', message: 'ok' }

    expect(logsResult({ logs: [] })).toBe(noLogs)
    expect(logsResult({ logs: [log] })).toBe(`[${log.id}] ${log.log_type}: ${log.message}`)
  })
})

describe('switchResult', () => {
  test('names the repo and its path', () => {
    const repo = 'acme/api'
    const repoPath = '/tmp/r'

    expect(switchResult({ repo, repo_path: repoPath })).toBe(`Switched to ${repo} (${repoPath})`)
  })
})

describe('dump', () => {
  test('writes text with a trailing newline', () => {
    const text = 'hello'
    const io = new StringWriter()

    dump(false, text, io)

    expect(io.text).toBe(`${text}\n`)
  })

  test('does not double a trailing newline, like IO#puts', () => {
    const text = 'already terminated\n'
    const io = new StringWriter()

    dump(false, text, io)

    expect(io.text).toBe(text)
  })

  test('pretty prints json', () => {
    const payload = { a: 1, nested: { list: [true, null], empty: [] } }
    const io = new StringWriter()

    dump(true, payload, io)

    expect(io.text).toBe(`${JSON.stringify(payload, null, 2)}\n`)
    expect(JSON.parse(io.text)).toEqual(payload)
  })
})

describe('rubyToS', () => {
  test('interpolates like Ruby', () => {
    const number = 12
    const text = 'x'

    expect(rubyToS(null)).toBe('')
    expect(rubyToS(number)).toBe(String(number))
    expect(rubyToS(false)).toBe('false')
    expect(rubyToS([text, null])).toBe(`[${JSON.stringify(text)}, nil]`)
    expect(rubyToS({ [text]: number })).toBe(`{${JSON.stringify(text)} => ${number}}`)
  })
})
