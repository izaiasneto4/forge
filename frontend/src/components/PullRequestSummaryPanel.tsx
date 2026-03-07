import type { PullRequestAiSummary } from '../types/api'

function metricValue(value: number | null | undefined) {
  return value == null ? '—' : value.toLocaleString()
}

export function PullRequestSummaryPanel({ summary }: { summary: PullRequestAiSummary }) {
  if (summary.status === 'pending') {
    return (
      <div className="rounded-lg border border-[color:var(--color-border-default)] bg-[color:var(--color-bg-secondary)] p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">PR Summary</h3>
          <span className="linear-badge linear-badge-blue">Generating</span>
        </div>
        <p className="text-xs text-[color:var(--color-text-secondary)]">
          AI summary is being prepared in the background. Review can start now.
        </p>
      </div>
    )
  }

  if (summary.status === 'failed') {
    return (
      <div className="rounded-lg border border-[color:var(--color-surface-danger-border)] bg-[color:var(--color-surface-danger-bg)] p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">PR Summary</h3>
          <span className="linear-badge linear-badge-red">Unavailable</span>
        </div>
        <p className="text-xs text-[color:var(--color-surface-danger-text)]">
          {summary.failure_reason || 'Summary generation failed.'}
        </p>
      </div>
    )
  }

  if (summary.status === 'none') {
    return (
      <div className="rounded-lg border border-[color:var(--color-border-default)] bg-[color:var(--color-bg-secondary)] p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">PR Summary</h3>
          <span className="linear-badge linear-badge-default">Pending</span>
        </div>
        <p className="text-xs text-[color:var(--color-text-secondary)]">
          Summary has not been generated yet.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-[color:var(--color-border-default)] bg-[color:var(--color-bg-secondary)] p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">PR Summary</h3>
        {summary.stale ? <span className="linear-badge linear-badge-yellow">Stale</span> : <span className="linear-badge linear-badge-green">Ready</span>}
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-md bg-[color:var(--color-bg-primary)] px-2 py-2">
          <div className="text-[10px] uppercase tracking-wide text-[color:var(--color-text-tertiary)]">Files</div>
          <div className="text-sm font-semibold">{metricValue(summary.files_changed)}</div>
        </div>
        <div className="rounded-md bg-[color:var(--color-bg-primary)] px-2 py-2">
          <div className="text-[10px] uppercase tracking-wide text-[color:var(--color-text-tertiary)]">Added</div>
          <div className="text-sm font-semibold text-[color:var(--color-surface-success-text)]">{metricValue(summary.lines_added)}</div>
        </div>
        <div className="rounded-md bg-[color:var(--color-bg-primary)] px-2 py-2">
          <div className="text-[10px] uppercase tracking-wide text-[color:var(--color-text-tertiary)]">Removed</div>
          <div className="text-sm font-semibold text-[color:var(--color-surface-danger-text)]">{metricValue(summary.lines_removed)}</div>
        </div>
      </div>

      <section className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-[color:var(--color-text-tertiary)]">Main changes</h4>
        <ul className="space-y-1 text-sm text-[color:var(--color-text-primary)]">
          {summary.main_changes.map((item) => <li key={item}>• {item}</li>)}
        </ul>
      </section>

      <section className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-[color:var(--color-text-tertiary)]">Risk areas</h4>
        {summary.risk_areas.length > 0 ? (
          <ul className="space-y-1 text-sm text-[color:var(--color-text-primary)]">
            {summary.risk_areas.map((item) => <li key={item}>• {item}</li>)}
          </ul>
        ) : (
          <p className="text-xs text-[color:var(--color-text-secondary)]">No specific risk areas flagged.</p>
        )}
      </section>

      {summary.stale ? (
        <p className="text-xs text-[color:var(--color-text-secondary)]">
          This summary was generated from an older snapshot while a fresh one is still pending.
        </p>
      ) : null}
    </div>
  )
}
