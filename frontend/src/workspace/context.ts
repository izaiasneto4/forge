import { createContext, useContext } from 'react'

import type { ReviewDepth, ReviewLens } from '../lib/agents'
import type { ListSection, MailboxId, SortOption } from '../lib/lifecycle'
import type {
  BootstrapResponse,
  PullRequestBoardResponse,
  PullRequestItem,
  ReviewCommentItem,
  ReviewEvent,
} from '../types/api'
import type { Route, SettingsTab } from './routing'

export type InspectorTab = 'activity' | 'log' | 'history'

export type Draft = {
  text: string
  lens: ReviewLens
  depth: ReviewDepth | null
  client: string | null
  event: ReviewEvent | null
  summary: string
}

export type StartReviewInput = {
  client: string
  depth: ReviewDepth
  focus: string
}

export type SubmitInput = {
  event: ReviewEvent
  summary: string
  commentIds: number[]
}

export type ConfirmOptions = {
  title: string
  message: string
  confirmLabel: string
}

export type WorkspaceActions = {
  startReview: (item: PullRequestItem, input: StartReviewInput) => Promise<void>
  startReviewFromUrl: (url: string, input: StartReviewInput) => Promise<void>
  reviewAllRequested: () => Promise<void>
  dequeue: (item: PullRequestItem) => Promise<void>
  archive: (item: PullRequestItem) => Promise<void>
  remove: (item: PullRequestItem) => Promise<void>
  setFindingStatus: (taskId: number, commentId: number, status: ReviewCommentItem['status']) => Promise<void>
  submit: (item: PullRequestItem, input: SubmitInput) => Promise<void>
  sync: (force?: boolean) => Promise<void>
  switchRepo: (slug: string) => Promise<void>
  setOnlyRequested: (value: boolean) => Promise<void>
  clearReview: (item: PullRequestItem) => Promise<void>
  markDone: (item: PullRequestItem) => Promise<void>
}

export type WorkspaceValue = {
  bootstrap: BootstrapResponse | undefined
  board: PullRequestBoardResponse | undefined
  boardLoading: boolean
  boardError: unknown
  items: PullRequestItem[]
  login: string | null
  route: Route
  mailbox: MailboxId
  selected: PullRequestItem | null
  sections: ListSection[]
  counts: Record<MailboxId, number>
  anyReviewing: boolean
  requestedCount: number
  sort: SortOption
  setSort: (sort: SortOption) => void
  collapsedSections: Set<string>
  toggleSection: (id: string) => void
  sidebarOpen: boolean
  toggleSidebar: () => void
  inspectorOpen: boolean
  inspectorTab: InspectorTab
  openInspector: (tab?: InspectorTab) => void
  toggleInspector: () => void
  paletteOpen: boolean
  setPaletteOpen: (open: boolean) => void
  settingsTab: SettingsTab | null
  openSettings: (tab?: SettingsTab) => void
  closeSettings: () => void
  goToMailbox: (mailbox: MailboxId) => void
  openPullRequest: (id: number) => void
  openNew: () => void
  moveSelection: (delta: number) => void
  draftFor: (id: number) => Draft
  updateDraft: (id: number, patch: Partial<Draft>) => void
  selectionFor: (taskId: number, comments: ReviewCommentItem[]) => Set<number>
  setSelection: (taskId: number, comments: ReviewCommentItem[], ids: Set<number>) => void
  focusedFinding: number | null
  setFocusedFinding: (id: number | null) => void
  actions: WorkspaceActions
  pending: { sync: boolean; start: boolean; submit: boolean }
  confirm: (options: ConfirmOptions) => Promise<boolean>
  defaultClient: string
  cliClients: string[]
}

export const WorkspaceContext = createContext<WorkspaceValue | null>(null)

export function useWorkspace() {
  const value = useContext(WorkspaceContext)
  if (!value) throw new Error('useWorkspace must be used within WorkspaceProvider')
  return value
}
