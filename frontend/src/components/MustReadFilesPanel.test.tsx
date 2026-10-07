import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { MustReadFilesPanel } from './MustReadFilesPanel'

afterEach(() => {
  cleanup()
})

const scoredFiles = Array.from({ length: 8 }, (_, index) => ({
  path: `app/file_${index}.rb`,
  status: 'modified',
  additions: 10 - index,
  deletions: index,
  role: index % 2 === 0 ? 'domain_logic' : 'test',
  core_score: 4.5 - index * 0.2,
  risk_score: 4.0 - index * 0.2,
  must_read_p: index < 3 ? 0.8 : 0.2,
  priority: 5 - index * 0.3,
  confidence: 0.7,
  skipped: false,
  skip_reason: null,
  why: `Why for file ${index}`,
  rank: index + 1,
}))

describe('MustReadFilesPanel', () => {
  it('renders shortlist for the selected budget', () => {
    render(
      <MustReadFilesPanel
        triage={{
          status: 'current',
          generated_at: '2026-03-07T12:00:00Z',
          failure_reason: null,
          snapshot_id: 12,
          stale: false,
          files: scoredFiles,
          shortlist: [],
          scored_count: 8,
          skipped_count: 0,
        }}
      />,
    )

    expect(screen.getByText('Must-read files')).toBeTruthy()
    expect(screen.getByText(/Based on a 15 min budget — 5 of 8/)).toBeTruthy()
    expect(screen.getByText(/app\/file_0\.rb/)).toBeTruthy()
  })

  it('updates shortlist size when budget changes', () => {
    render(
      <MustReadFilesPanel
        triage={{
          status: 'current',
          generated_at: '2026-03-07T12:00:00Z',
          failure_reason: null,
          snapshot_id: 12,
          stale: false,
          files: scoredFiles,
          shortlist: [],
          scored_count: 8,
          skipped_count: 0,
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '5 min' }))
    expect(screen.getByText(/Based on a 5 min budget — 3 of 8/)).toBeTruthy()
  })

  it('renders scoring pending state', () => {
    render(
      <MustReadFilesPanel
        triage={{
          status: 'pending',
          generated_at: null,
          failure_reason: null,
          snapshot_id: 12,
          stale: false,
          files: [],
          shortlist: [],
          scored_count: 0,
          skipped_count: 0,
        }}
      />,
    )

    expect(screen.getByText('Scoring')).toBeTruthy()
  })
})
