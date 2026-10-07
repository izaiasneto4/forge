import type {
  Lifecycle,
  PullRequestBoardResponse,
  PullRequestItem,
  ReviewCommentItem,
  ReviewEvent,
} from '../types/api'

export type MailboxId = 'inbox' | 'reviewing' | 'waiting' | 'mine' | 'settled'
export type SortOption = 'longest_waiting' | 'newest' | 'recent_activity' | 'smallest_diff'
export type Severity = ReviewCommentItem['severity']

export type ListSection = {
  id: string
  label: string | null
  items: PullRequestItem[]
}

export const MAILBOX_IDS: MailboxId[] = ['inbox', 'reviewing', 'waiting', 'mine', 'settled']

export const MAILBOX_LABELS: Record<MailboxId, string> = {
  inbox: 'Inbox',
  reviewing: 'Reviewing',
  waiting: 'Waiting on author',
  mine: 'My pull requests',
  settled: 'Settled',
}

export const SORT_LABELS: Record<SortOption, string> = {
  longest_waiting: 'Longest waiting',
  newest: 'Newest',
  recent_activity: 'Recent activity',
  smallest_diff: 'Smallest diff',
}

export const LIFECYCLE_LABELS: Record<Lifecycle, string> = {
  needs_review: 'Needs review',
  queued: 'Queued',
  reviewing: 'Reviewing',
  ready: 'Ready to send',
  failed: 'Review failed',
  waiting: 'Waiting on author',
  settled: 'Settled',
  authored: 'Your pull request',
}

export const SEVERITY_ORDER: Severity[] = ['critical', 'major', 'minor', 'suggestion', 'nitpick']

export const SEVERITY_LABELS: Record<Severity, string> = {
  critical: 'Critical',
  major: 'Major',
  minor: 'Minor',
  suggestion: 'Suggestion',
  nitpick: 'Nit',
}

const PRESELECTED_SEVERITIES: Severity[] = ['critical', 'major', 'minor']
const INBOX_LIFECYCLES: Lifecycle[] = ['needs_review', 'ready', 'failed']
const REVIEWING_LIFECYCLES: Lifecycle[] = ['queued', 'reviewing']

export function isMailboxId(value: string | undefined): value is MailboxId {
  return MAILBOX_IDS.some((id) => id === value)
}

export function isSortOption(value: string): value is SortOption {
  return Object.keys(SORT_LABELS).includes(value)
}

export function flattenBoard(board: PullRequestBoardResponse) {
  const seen = new Set<number>()
  const items: PullRequestItem[] = []

  for (const column of Object.values(board.columns)) {
    for (const item of column) {
      if (seen.has(item.id)) continue
      seen.add(item.id)
      items.push(item)
    }
  }

  return items
}

export function isAuthoredBy(item: PullRequestItem, login: string | null | undefined) {
  return Boolean(login) && item.author?.toLowerCase() === login?.toLowerCase()
}

// "Only PRs requesting my review" hides untouched PRs from others; anything
// already reviewed or authored stays visible.
export function inReviewScope(item: PullRequestItem, login: string | null | undefined, onlyRequested: boolean) {
  if (!onlyRequested || item.review_requested_for_me || item.review_task) return true
  return isAuthoredBy(item, login)
}

export function belongsToMailbox(item: PullRequestItem, mailbox: MailboxId, login: string | null | undefined) {
  const authored = isAuthoredBy(item, login)

  switch (mailbox) {
    case 'inbox':
      return INBOX_LIFECYCLES.includes(item.lifecycle) && !authored
    case 'reviewing':
      return REVIEWING_LIFECYCLES.includes(item.lifecycle)
    case 'waiting':
      return item.lifecycle === 'waiting'
    case 'mine':
      return authored && item.lifecycle !== 'settled'
    case 'settled':
      return item.lifecycle === 'settled'
  }
}

export function mailboxFor(item: PullRequestItem, login: string | null | undefined): MailboxId {
  return MAILBOX_IDS.find((mailbox) => belongsToMailbox(item, mailbox, login)) ?? 'inbox'
}

function time(value: string | null) {
  return value ? new Date(value).getTime() : 0
}

function diffSize(item: PullRequestItem) {
  return (item.additions ?? 0) + (item.deletions ?? 0)
}

export function sortPullRequests(items: PullRequestItem[], sort: SortOption) {
  const sorted = [...items]

  switch (sort) {
    case 'longest_waiting':
      return sorted.sort((a, b) => time(a.updated_at_github) - time(b.updated_at_github))
    case 'newest':
      return sorted.sort((a, b) => time(b.created_at_github) - time(a.created_at_github))
    case 'recent_activity':
      return sorted.sort((a, b) => time(b.updated_at_github) - time(a.updated_at_github))
    case 'smallest_diff':
      return sorted.sort((a, b) => diffSize(a) - diffSize(b))
  }
}

function section(id: string, label: string | null, items: PullRequestItem[]): ListSection {
  return { id, label, items }
}

export function sectionsFor(mailbox: MailboxId, items: PullRequestItem[], sort: SortOption): ListSection[] {
  const sorted = sortPullRequests(items, sort)
  let sections: ListSection[]

  switch (mailbox) {
    case 'inbox': {
      const fresh = sorted.filter((item) => item.lifecycle === 'needs_review' && !item.has_new_commits)
      sections = [
        section('ready', 'Ready to send', sorted.filter((item) => item.lifecycle === 'ready')),
        section('failed', 'Needs attention', sorted.filter((item) => item.lifecycle === 'failed')),
        section('new_commits', 'New commits since your review', sorted.filter((item) => item.lifecycle === 'needs_review' && item.has_new_commits)),
        section('requested', 'Requested from you', fresh.filter((item) => item.review_requested_for_me)),
        section('open', 'Open in this repository', fresh.filter((item) => !item.review_requested_for_me)),
      ]
      break
    }
    case 'reviewing':
      sections = [
        section('running', 'Running', sorted.filter((item) => item.lifecycle === 'reviewing')),
        section('queued', 'Up next', sorted
          .filter((item) => item.lifecycle === 'queued')
          .sort((a, b) => (a.review_task?.queue_position ?? 0) - (b.review_task?.queue_position ?? 0))),
      ]
      break
    case 'waiting':
      sections = [
        section('new_commits', 'New commits since your review', sorted.filter((item) => item.has_new_commits)),
        section('waiting', 'Waiting', sorted.filter((item) => !item.has_new_commits)),
      ]
      break
    default:
      sections = [section('all', null, sorted)]
  }

  return sections.filter((entry) => entry.items.length > 0)
}

export function orderedIds(sections: ListSection[]) {
  return sections.flatMap((entry) => entry.items.map((item) => item.id))
}

export function pendingComments(comments: ReviewCommentItem[]) {
  return comments.filter((comment) => comment.status === 'pending')
}

export function suggestedEvent(comments: ReviewCommentItem[]): ReviewEvent {
  const pending = pendingComments(comments)
  if (pending.some((comment) => comment.severity === 'critical' || comment.severity === 'major')) return 'REQUEST_CHANGES'
  if (pending.length > 0) return 'COMMENT'
  return 'APPROVE'
}

export function defaultSelection(comments: ReviewCommentItem[]) {
  return new Set(
    pendingComments(comments)
      .filter((comment) => PRESELECTED_SEVERITIES.includes(comment.severity))
      .map((comment) => comment.id),
  )
}

export function groupBySeverity(comments: ReviewCommentItem[]) {
  return SEVERITY_ORDER
    .map((severity) => ({ severity, comments: comments.filter((comment) => comment.severity === severity) }))
    .filter((group) => group.comments.length > 0)
}

export function severityCounts(comments: ReviewCommentItem[]) {
  return SEVERITY_ORDER
    .map((severity) => ({ severity, count: comments.filter((comment) => comment.severity === severity).length }))
    .filter((entry) => entry.count > 0)
}
