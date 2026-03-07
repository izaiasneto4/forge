import type { PullRequestBoardResponse, PullRequestStatus } from '../types/api'

export type SortOption = 'oldest' | 'newest' | 'smallest_diff' | 'repo' | 'author' | 'recent_activity'

type FilterOptions = {
  board: PullRequestBoardResponse
  search: string
  stateFilter: 'all' | PullRequestStatus
  showOwnPrs: boolean
  requestedToMeOnly: boolean
  sortBy: SortOption
}

export function filterPullRequestColumns({
  board,
  search,
  stateFilter,
  showOwnPrs,
  requestedToMeOnly,
  sortBy,
}: FilterOptions): PullRequestBoardResponse['columns'] {
  const login = board.settings.current_user_login?.toLowerCase()
  const query = search.trim().toLowerCase()
  const next = {} as PullRequestBoardResponse['columns']

  for (const [columnKey, items] of Object.entries(board.columns) as Array<[PullRequestStatus, PullRequestBoardResponse['columns'][PullRequestStatus]]>) {
    const filtered = items.filter((item) => {
      const matchesSearch = !query || item.title.toLowerCase().includes(query) || item.repo_full_name.toLowerCase().includes(query)
      const matchesState = stateFilter === 'all' || item.review_status === stateFilter
      const matchesOwnPr = showOwnPrs || !login || item.author?.toLowerCase() !== login
      const matchesRequested = !requestedToMeOnly || item.review_requested_for_me

      return matchesSearch && matchesState && matchesOwnPr && matchesRequested
    })

    next[columnKey] = filtered.sort((a, b) => {
      switch (sortBy) {
        case 'oldest':
          return new Date(a.created_at_github || 0).getTime() - new Date(b.created_at_github || 0).getTime()
        case 'newest':
          return new Date(b.created_at_github || 0).getTime() - new Date(a.created_at_github || 0).getTime()
        case 'recent_activity':
        case 'smallest_diff': // Fallback to recent activity since additions/deletions aren't available
          return new Date(b.updated_at_github || 0).getTime() - new Date(a.updated_at_github || 0).getTime()
        case 'repo':
          return a.repo_name.localeCompare(b.repo_name)
        case 'author':
          return (a.author || '').localeCompare(b.author || '')
        default:
          return 0
      }
    })
  }

  return next
}
