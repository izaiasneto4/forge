import { describe, expect, it } from 'vitest'

import type { PullRequestBoardResponse } from '../types/api'
import { filterPullRequestColumns } from './pullRequestFilters'

function buildBoard(): PullRequestBoardResponse {
  return {
    current_repo: { path: '/tmp/repo', slug: 'acme/api', name: 'api' },
    repositories: {
      repos_folder: '/tmp',
      current_repo_path: '/tmp/repo',
      current_repo_slug: 'acme/api',
      items: [],
    },
    settings: {
      only_requested_reviews: false,
      current_user_login: 'izaias',
    },
    sync_status: {
      status: 'idle',
      running: false,
      last_synced_at: null,
      last_started_at: null,
      last_finished_at: null,
      last_succeeded_at: null,
      last_error: null,
      fetched_count: 0,
      created_count: 0,
      updated_count: 0,
      deactivated_count: 0,
      seconds_until_sync_allowed: 0,
      sync_needed: false,
    },
    counts: {
      pending_review: 2,
      in_review: 0,
      reviewed_by_me: 0,
      waiting_implementation: 0,
      reviewed_by_others: 0,
      review_failed: 0,
    },
    total_count: 2,
    columns: {
      pending_review: [
        {
          id: 1,
          number: 101,
          title: 'Requested review',
          url: 'https://github.com/acme/api/pull/101',
          author: 'alice',
          author_avatar: null,
          description: null,
          repo_owner: 'acme',
          repo_name: 'api',
          repo_full_name: 'acme/api',
          review_status: 'pending_review',
          archived: false,
          created_at_github: null,
          updated_at_github: null,
          remote_state: 'open',
          inactive_reason: null,
          snapshot_status: 'missing',
          analysis_status: 'none',
          head_sha: null,
          base_sha: null,
          head_ref: null,
          base_ref: null,
          latest_review_state: null,
          review_decision: null,
          check_status: null,
          draft: false,
          review_requested_for_me: true,
          additions: 10,
          deletions: 5,
          changed_files: 2,
          review_task: null,
        },
        {
          id: 2,
          number: 102,
          title: 'Unrequested review',
          url: 'https://github.com/acme/api/pull/102',
          author: 'bob',
          author_avatar: null,
          description: null,
          repo_owner: 'acme',
          repo_name: 'api',
          repo_full_name: 'acme/api',
          review_status: 'pending_review',
          archived: false,
          created_at_github: null,
          updated_at_github: null,
          remote_state: 'open',
          inactive_reason: null,
          snapshot_status: 'missing',
          analysis_status: 'none',
          head_sha: null,
          base_sha: null,
          head_ref: null,
          base_ref: null,
          latest_review_state: null,
          review_decision: null,
          check_status: null,
          draft: false,
          review_requested_for_me: false,
          additions: 2,
          deletions: 2,
          changed_files: 1,
          review_task: null,
        },
      ],
      in_review: [],
      reviewed_by_me: [],
      waiting_implementation: [],
      reviewed_by_others: [],
      review_failed: [],
    },
  }
}

describe('filterPullRequestColumns', () => {
  it('filters requested-only in memory without changing the source board', () => {
    const board = buildBoard()

    const filtered = filterPullRequestColumns({
      board,
      search: '',
      stateFilter: 'all',
      showOwnPrs: true,
      requestedToMeOnly: true,
      sortBy: 'oldest',
    })

    expect(filtered.pending_review).toHaveLength(1)
    expect(filtered.pending_review[0]?.number).toBe(101)
    expect(board.columns.pending_review).toHaveLength(2)
  })
})
