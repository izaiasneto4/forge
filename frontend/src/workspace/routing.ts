import { isMailboxId, type MailboxId } from '../lib/lifecycle'

export type SettingsTab = 'general' | 'agents' | 'repositories' | 'github' | 'shortcuts'

export type Route =
  | { kind: 'mailbox'; mailbox: MailboxId; id: number | null }
  | { kind: 'new' }
  | { kind: 'task'; taskId: number }
  | { kind: 'settings'; tab: SettingsTab }

const DEFAULT_ROUTE: Route = { kind: 'mailbox', mailbox: 'inbox', id: null }

function parseId(value: string | undefined) {
  if (!value || !/^\d+$/.test(value)) return null
  return Number(value)
}

export function parseRoute(pathname: string): Route {
  const [first, second] = pathname.split('/').filter(Boolean)

  if (!first) return DEFAULT_ROUTE
  if (first === 'new') return { kind: 'new' }
  if (first === 'settings') return { kind: 'settings', tab: 'general' }
  if (first === 'repositories') return { kind: 'settings', tab: 'repositories' }

  if (first === 'review_tasks') {
    const taskId = parseId(second)
    return taskId === null ? { kind: 'mailbox', mailbox: 'reviewing', id: null } : { kind: 'task', taskId }
  }

  if (isMailboxId(first)) return { kind: 'mailbox', mailbox: first, id: parseId(second) }

  return DEFAULT_ROUTE
}

export function mailboxPath(mailbox: MailboxId, id?: number | null) {
  return id ? `/${mailbox}/${id}` : `/${mailbox}`
}
