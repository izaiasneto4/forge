import type { IconName } from '../components/Icon'
import type { ReviewEvent } from '../types/api'

export type ReviewDepth = 'review' | 'swarm'
export type ReviewLens = 'general' | 'security' | 'performance' | 'api' | 'migrations'

const AGENT_LABELS: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
  opencode: 'OpenCode',
}

export function agentLabel(client: string | null | undefined) {
  if (!client) return 'Agent'
  return AGENT_LABELS[client] ?? client
}

export const DEPTHS: Record<ReviewDepth, { label: string; description: string; icon: IconName }> = {
  review: { label: 'Standard', description: 'One agent, full review', icon: 'eye' },
  swarm: { label: 'Swarm', description: 'Specialist agents, consolidated', icon: 'layers' },
}

export const LENSES: Record<ReviewLens, { label: string; icon: IconName; focus: string | null }> = {
  general: { label: 'General', icon: 'sparkles', focus: null },
  security: { label: 'Security', icon: 'shield', focus: 'Prioritize security: authentication and authorization, injection, secrets, unsafe input handling and data exposure.' },
  performance: { label: 'Performance', icon: 'gauge', focus: 'Prioritize performance: N+1 queries, unbounded loops, missing indexes, memory growth and blocking I/O.' },
  api: { label: 'API contract', icon: 'plug', focus: 'Prioritize the public API contract: breaking changes, serialization differences, status codes and backwards compatibility.' },
  migrations: { label: 'Migrations', icon: 'db', focus: 'Prioritize database migrations: locking, backfills on large tables, reversibility and safe deploy ordering.' },
}

export const EVENTS: Record<ReviewEvent, { label: string; color: string; past: string }> = {
  COMMENT: { label: 'Comment', color: 'var(--blue)', past: 'commented' },
  APPROVE: { label: 'Approve', color: 'var(--green)', past: 'approved' },
  REQUEST_CHANGES: { label: 'Request changes', color: 'var(--orange)', past: 'requested changes' },
}

export function isReviewDepth(value: string): value is ReviewDepth {
  return value === 'review' || value === 'swarm'
}

export function isReviewLens(value: string): value is ReviewLens {
  return Object.keys(LENSES).includes(value)
}

export function isReviewEvent(value: string | null | undefined): value is ReviewEvent {
  return value === 'COMMENT' || value === 'APPROVE' || value === 'REQUEST_CHANGES'
}

export function composeFocus(lens: ReviewLens, text: string) {
  return [LENSES[lens].focus, text.trim()].filter(Boolean).join('\n\n')
}
