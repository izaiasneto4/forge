import { asc } from 'drizzle-orm'
import type { Db } from '../db/client'
import { pullRequests } from '../db/schema'
import { isReviewStatus, notArchived, REVIEW_STATUSES_REQUIRING_TASK, reviewTaskFor, type PullRequestRecord } from '../models/pull-request'
import { isSyncModeActive } from '../services/sync-mode'
import { runScript, stdoutWriter, type OutputWriter } from './script-context'

export const FIX_COMMAND = 'bun backend/src/scripts/pull-requests-fix-orphaned-states.ts'

export interface InconsistentPullRequest {
  id: number
  number: number | null
  title: string | null
  status: string | null
  errors: string[]
}

// `pr.valid?` then `pr.errors[:review_status]`: the inclusion check and
// review_status_consistency, as attribute-less messages.
export function reviewStatusErrors(db: Db, pullRequest: PullRequestRecord) {
  const status = pullRequest.reviewStatus
  const errors: string[] = []
  if (status === null || !isReviewStatus(status)) errors.push('is not included in the list')
  if (status !== null && !isSyncModeActive() && REVIEW_STATUSES_REQUIRING_TASK.includes(status) && !reviewTaskFor(db, pullRequest.id)) {
    errors.push(`cannot be '${status}' without a review task`)
  }
  return errors
}

// rake pull_requests:validate_consistency
export function validateConsistency(db: Db, output: OutputWriter) {
  output.puts('Validating review state consistency...')

  const inconsistent: InconsistentPullRequest[] = []
  for (const pullRequest of db.select().from(pullRequests).where(notArchived).orderBy(asc(pullRequests.id)).all()) {
    const errors = reviewStatusErrors(db, pullRequest)
    if (errors.length === 0) continue
    inconsistent.push({ id: pullRequest.id, number: pullRequest.number, title: pullRequest.title, status: pullRequest.reviewStatus, errors })
  }

  if (inconsistent.length > 0) {
    output.puts(`⚠ Found ${inconsistent.length} inconsistent pull request(s):`)
    for (const entry of inconsistent) {
      output.puts(`  - PR #${entry.number ?? ''} (${entry.title ?? ''}): ${entry.status ?? ''} - ${entry.errors.join(', ')}`)
    }
    output.puts(`\nRun '${FIX_COMMAND}' to fix these issues`)
  } else {
    output.puts('✓ All pull requests have consistent review states')
  }
  return inconsistent
}

if (import.meta.main) {
  await runScript((ctx) => validateConsistency(ctx.db, stdoutWriter))
}
