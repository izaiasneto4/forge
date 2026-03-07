import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { PullRequestSummaryPanel } from './PullRequestSummaryPanel'

describe('PullRequestSummaryPanel', () => {
  it('renders current summary metrics and lists', () => {
    render(
      <PullRequestSummaryPanel
        summary={{
          status: 'current',
          generated_at: '2026-03-07T12:00:00Z',
          failure_reason: null,
          snapshot_id: 12,
          stale: false,
          files_changed: 6,
          lines_added: 210,
          lines_removed: 34,
          main_changes: ['Caching layer added', 'Auth middleware refactor'],
          risk_areas: ['Billing calculation', 'Authentication logic'],
        }}
      />,
    )

    expect(screen.getByText('PR Summary')).toBeTruthy()
    expect(screen.getByText('6')).toBeTruthy()
    expect(screen.getByText('210')).toBeTruthy()
    expect(screen.getByText('34')).toBeTruthy()
    expect(screen.getByText(/Caching layer added/)).toBeTruthy()
    expect(screen.getByText(/Authentication logic/)).toBeTruthy()
  })

  it('renders pending state without blocking UI copy', () => {
    render(
      <PullRequestSummaryPanel
        summary={{
          status: 'pending',
          generated_at: null,
          failure_reason: null,
          snapshot_id: 12,
          stale: false,
          files_changed: 6,
          lines_added: 210,
          lines_removed: 34,
          main_changes: [],
          risk_areas: [],
        }}
      />,
    )

    expect(screen.getByText('Generating')).toBeTruthy()
    expect(screen.getByText(/Review can start now/i)).toBeTruthy()
  })

  it('renders stale summary badge and note', () => {
    render(
      <PullRequestSummaryPanel
        summary={{
          status: 'current',
          generated_at: '2026-03-07T12:00:00Z',
          failure_reason: null,
          snapshot_id: 11,
          stale: true,
          files_changed: 6,
          lines_added: 210,
          lines_removed: 34,
          main_changes: ['Caching layer added'],
          risk_areas: [],
        }}
      />,
    )

    expect(screen.getByText('Stale')).toBeTruthy()
    expect(screen.getByText(/older snapshot/i)).toBeTruthy()
  })
})
