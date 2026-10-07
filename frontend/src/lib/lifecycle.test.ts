import { describe, expect, it } from 'vitest'

import { buildBoard, buildComment, buildPullRequest, buildTask } from '../test/factories'
import type { ReviewTaskDetailResponse } from '../types/api'
import {
  belongsToMailbox,
  defaultSelection,
  flattenBoard,
  groupBySeverity,
  inReviewScope,
  mailboxFor,
  orderedIds,
  resolveSelection,
  sectionsFor,
  sortPullRequests,
  suggestedEvent,
} from './lifecycle'

const login = 'me'

describe('mailboxes', () => {
  it('routes each lifecycle to its mailbox', () => {
    const expectations = [
      { item: buildPullRequest({ lifecycle: 'needs_review' }), mailbox: 'inbox' },
      { item: buildPullRequest({ lifecycle: 'ready' }), mailbox: 'inbox' },
      { item: buildPullRequest({ lifecycle: 'failed' }), mailbox: 'inbox' },
      { item: buildPullRequest({ lifecycle: 'queued' }), mailbox: 'reviewing' },
      { item: buildPullRequest({ lifecycle: 'reviewing' }), mailbox: 'reviewing' },
      { item: buildPullRequest({ lifecycle: 'waiting' }), mailbox: 'waiting' },
      { item: buildPullRequest({ lifecycle: 'authored', author: login }), mailbox: 'mine' },
      { item: buildPullRequest({ lifecycle: 'settled' }), mailbox: 'settled' },
    ]

    for (const { item, mailbox } of expectations) {
      expect(mailboxFor(item, login)).toBe(mailbox)
    }
  })

  it('keeps your own pull requests out of the inbox', () => {
    const ownWithFindings = buildPullRequest({ lifecycle: 'ready', author: login.toUpperCase() })

    expect(belongsToMailbox(ownWithFindings, 'inbox', login)).toBe(false)
    expect(belongsToMailbox(ownWithFindings, 'mine', login)).toBe(true)
  })
})

describe('inReviewScope', () => {
  it('hides untouched pull requests nobody asked you to review when scoped', () => {
    const unrequested = buildPullRequest()
    const requested = buildPullRequest({ review_requested_for_me: true })
    const alreadyReviewed = buildPullRequest({ review_task: buildTask() })
    const own = buildPullRequest({ author: login })
    const visibleWhenScoped = [requested, alreadyReviewed, own]

    expect([unrequested, ...visibleWhenScoped].filter((item) => inReviewScope(item, login, true))).toEqual(visibleWhenScoped)
    expect(inReviewScope(unrequested, login, false)).toBe(true)
  })
})

describe('flattenBoard', () => {
  it('merges board columns without duplicates', () => {
    const shared = buildPullRequest()
    const other = buildPullRequest()
    const board = buildBoard({ pending_review: [shared], reviewed_by_me: [shared, other] })

    expect(flattenBoard(board).map((item) => item.id)).toEqual([shared.id, other.id])
  })

  it('includes merged or closed pull requests that were reviewed', () => {
    const open = buildPullRequest()
    const merged = buildPullRequest({ lifecycle: 'settled', remote_state: 'merged', review_task: buildTask() })
    const board = buildBoard({ pending_review: [open] }, [merged])

    expect(flattenBoard(board).map((item) => item.id)).toEqual([open.id, merged.id])
    expect(mailboxFor(merged, login)).toBe('settled')
  })
})

describe('sectionsFor', () => {
  it('orders the inbox by what needs a decision first', () => {
    const open = buildPullRequest({ lifecycle: 'needs_review' })
    const requested = buildPullRequest({ lifecycle: 'needs_review', review_requested_for_me: true })
    const reReview = buildPullRequest({ lifecycle: 'needs_review', has_new_commits: true })
    const failed = buildPullRequest({ lifecycle: 'failed' })
    const ready = buildPullRequest({ lifecycle: 'ready' })
    const expectedOrder = [ready, failed, reReview, requested, open].map((item) => item.id)

    const sections = sectionsFor('inbox', [open, requested, reReview, failed, ready], 'longest_waiting')

    expect(orderedIds(sections)).toEqual(expectedOrder)
    expect(sections.every((section) => section.items.length > 0)).toBe(true)
  })

  it('lists running reviews before the queue in queue order', () => {
    const second = buildPullRequest({ lifecycle: 'queued', review_task: buildTask({ state: 'queued', queue_position: 2 }) })
    const first = buildPullRequest({ lifecycle: 'queued', review_task: buildTask({ state: 'queued', queue_position: 1 }) })
    const running = buildPullRequest({ lifecycle: 'reviewing' })

    const sections = sectionsFor('reviewing', [second, first, running], 'longest_waiting')

    expect(orderedIds(sections)).toEqual([running.id, first.id, second.id])
  })

  it('surfaces waiting pull requests with new commits first', () => {
    const quiet = buildPullRequest({ lifecycle: 'waiting' })
    const updated = buildPullRequest({ lifecycle: 'waiting', has_new_commits: true })

    expect(orderedIds(sectionsFor('waiting', [quiet, updated], 'longest_waiting'))).toEqual([updated.id, quiet.id])
  })
})

describe('sortPullRequests', () => {
  it('sorts by waiting time and diff size', () => {
    const older = buildPullRequest({ updated_at_github: '2026-09-01T00:00:00Z', additions: 500, deletions: 10 })
    const newer = buildPullRequest({ updated_at_github: '2026-10-01T00:00:00Z', additions: 5, deletions: 1 })

    expect(sortPullRequests([newer, older], 'longest_waiting').map((item) => item.id)).toEqual([older.id, newer.id])
    expect(sortPullRequests([older, newer], 'recent_activity').map((item) => item.id)).toEqual([newer.id, older.id])
    expect(sortPullRequests([older, newer], 'smallest_diff').map((item) => item.id)).toEqual([newer.id, older.id])
  })

  it('sorts by creation date and author', () => {
    const first = buildPullRequest({ created_at_github: '2026-08-01T00:00:00Z', author: 'zoe' })
    const second = buildPullRequest({ created_at_github: '2026-09-01T00:00:00Z', author: 'Adam' })

    expect(sortPullRequests([second, first], 'oldest').map((item) => item.id)).toEqual([first.id, second.id])
    expect(sortPullRequests([second, first], 'newest').map((item) => item.id)).toEqual([second.id, first.id])
    expect(sortPullRequests([first, second], 'author').map((item) => item.id)).toEqual([second.id, first.id])
  })
})

describe('review suggestions', () => {
  it('suggests requesting changes when a blocker is pending', () => {
    const comments = [buildComment({ severity: 'major' }), buildComment({ severity: 'nitpick' })]
    expect(suggestedEvent(comments, 'comments')).toBe('REQUEST_CHANGES')
  })

  it('suggests commenting for minor notes and approving when nothing is pending', () => {
    const minorOnly = [buildComment({ severity: 'minor' })]
    const allSent = [buildComment({ severity: 'critical', status: 'addressed' })]

    expect(suggestedEvent(minorOnly, 'comments')).toBe('COMMENT')
    expect(suggestedEvent(allSent, 'comments')).toBe('APPROVE')
  })

  it('never suggests a verdict when the findings were not parsed into comments', () => {
    const unparsedModes: Array<ReviewTaskDetailResponse['content_mode']> = ['raw_output', 'parsed_review_items', 'empty']

    for (const mode of unparsedModes) {
      expect(suggestedEvent([], mode)).toBeNull()
    }
  })

  it('pre-selects pending findings that matter and skips nits', () => {
    const critical = buildComment({ severity: 'critical' })
    const minor = buildComment({ severity: 'minor' })
    const nit = buildComment({ severity: 'nitpick' })
    const sent = buildComment({ severity: 'major', status: 'addressed' })

    expect([...defaultSelection([critical, minor, nit, sent])]).toEqual([critical.id, minor.id])
  })

  it('keeps a stored selection for the same run and drops it after a re-run', () => {
    const critical = buildComment({ severity: 'critical' })
    const minor = buildComment({ severity: 'minor' })
    const excludedEverything = { selected: new Set<number>(), known: new Set([critical.id, minor.id]) }
    const nextRunCritical = buildComment({ severity: 'critical' })

    expect([...resolveSelection(excludedEverything, [critical, minor])]).toEqual([])
    expect([...resolveSelection(excludedEverything, [nextRunCritical])]).toEqual([nextRunCritical.id])
    expect([...resolveSelection(undefined, [critical, minor])]).toEqual([...defaultSelection([critical, minor])])
  })

  it('groups findings by severity in priority order', () => {
    const nit = buildComment({ severity: 'nitpick' })
    const critical = buildComment({ severity: 'critical' })

    expect(groupBySeverity([nit, critical]).map((group) => group.severity)).toEqual(['critical', 'nitpick'])
  })
})
