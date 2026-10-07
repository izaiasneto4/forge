import { useMemo, useState } from 'react'

import type { PullRequestFileTriage, PullRequestFileTriageFile } from '../types/api'

const BUDGETS = [5, 15, 30, 60] as const

function budgetFileCount(minutes: number) {
  if (minutes <= 5) return 3
  if (minutes <= 15) return 5
  if (minutes <= 30) return 8
  return 10
}

function pickDiverse(files: PullRequestFileTriageFile[], limit: number) {
  if (files.length <= limit) return files

  const selected: PullRequestFileTriageFile[] = []
  const seenRoles = new Set<string>()

  for (const file of files) {
    if (selected.length >= limit) break
    if (seenRoles.has(file.role)) continue
    selected.push(file)
    seenRoles.add(file.role)
  }

  const remaining = files.filter((file) => !selected.includes(file))
  while (selected.length < limit && remaining.length > 0) {
    selected.push(remaining.shift()!)
  }

  return selected
}

function scoreLabel(value: number) {
  return value.toFixed(1)
}

export function MustReadFilesPanel({ triage }: { triage: PullRequestFileTriage }) {
  const [ budgetMinutes, setBudgetMinutes ] = useState<(typeof BUDGETS)[number]>(15)

  const shortlist = useMemo(() => {
    const scored = triage.files.filter((file) => !file.skipped)
    return pickDiverse(scored, budgetFileCount(budgetMinutes))
  }, [ triage.files, budgetMinutes ])

  if (triage.status === 'pending') {
    return (
      <div className="rounded-lg border border-[color:var(--color-border-default)] bg-[color:var(--color-bg-secondary)] p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Must-read files</h3>
          <span className="linear-badge linear-badge-blue">Scoring</span>
        </div>
        <p className="text-xs text-[color:var(--color-text-secondary)]">
          Jev is scoring changed files. Review can start now.
        </p>
      </div>
    )
  }

  if (triage.status === 'failed') {
    return (
      <div className="rounded-lg border border-[color:var(--color-surface-danger-border)] bg-[color:var(--color-surface-danger-bg)] p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Must-read files</h3>
          <span className="linear-badge linear-badge-red">Unavailable</span>
        </div>
        <p className="text-xs text-[color:var(--color-surface-danger-text)]">
          {triage.failure_reason || 'File triage failed.'}
        </p>
      </div>
    )
  }

  if (triage.status === 'none') {
    return (
      <div className="rounded-lg border border-[color:var(--color-border-default)] bg-[color:var(--color-bg-secondary)] p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Must-read files</h3>
          <span className="linear-badge linear-badge-default">Pending</span>
        </div>
        <p className="text-xs text-[color:var(--color-text-secondary)]">
          File triage has not been generated yet.
        </p>
      </div>
    )
  }

  const scoredCount = triage.scored_count || triage.files.filter((file) => !file.skipped).length

  return (
    <div className="rounded-lg border border-[color:var(--color-border-default)] bg-[color:var(--color-bg-secondary)] p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Must-read files</h3>
        {triage.stale ? <span className="linear-badge linear-badge-yellow">Stale</span> : <span className="linear-badge linear-badge-green">Ready</span>}
      </div>

      <div className="space-y-2">
        <label className="block text-xs font-semibold uppercase tracking-wide text-[color:var(--color-text-tertiary)]">
          Review budget
        </label>
        <div className="flex flex-wrap gap-2">
          {BUDGETS.map((minutes) => (
            <button
              key={minutes}
              type="button"
              className={`linear-btn linear-btn-sm ${budgetMinutes === minutes ? 'linear-btn-primary' : 'linear-btn-ghost'}`}
              onClick={() => setBudgetMinutes(minutes)}
            >
              {minutes} min
            </button>
          ))}
        </div>
        <p className="text-xs text-[color:var(--color-text-secondary)]">
          Based on a {budgetMinutes} min budget — {shortlist.length} of {scoredCount} scored files.
          {triage.skipped_count > 0 ? ` (${triage.skipped_count} skipped lock/build files)` : null}
        </p>
      </div>

      {shortlist.length === 0 ? (
        <p className="text-xs text-[color:var(--color-text-secondary)]">No scored files available.</p>
      ) : shortlist.length >= scoredCount ? (
        <p className="text-xs text-[color:var(--color-text-secondary)]">
          All changed files fit your budget — read everything.
        </p>
      ) : null}

      <ol className="space-y-3">
        {shortlist.map((file, index) => (
          <li key={file.path} className="rounded-md bg-[color:var(--color-bg-primary)] px-3 py-2 space-y-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-medium break-all">
                  {index + 1}. {file.path}
                </div>
                <div className="text-[11px] text-[color:var(--color-text-tertiary)]">
                  {file.role.replaceAll('_', ' ')} · core {scoreLabel(file.core_score)} · risk {scoreLabel(file.risk_score)}
                  {file.must_read_p >= 0.5 ? ' · must-read' : ''}
                </div>
              </div>
              <span className="text-[11px] text-[color:var(--color-text-tertiary)] shrink-0">
                +{file.additions}/-{file.deletions}
              </span>
            </div>
            <p className="text-xs text-[color:var(--color-text-secondary)]">{file.why}</p>
          </li>
        ))}
      </ol>
    </div>
  )
}
