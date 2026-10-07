import type { Db } from '../db/client'
import { fixOrphanedReviewStates } from '../models/pull-request'
import { runScript, stdoutWriter, type OutputWriter } from './script-context'

// rake pull_requests:fix_orphaned_states
// Resets PRs marked reviewed/in review/failed that have no review task.
export function fixOrphanedStates(db: Db, output: OutputWriter) {
  output.puts('Checking for orphaned review states...')

  const fixedCount = fixOrphanedReviewStates(db)

  if (fixedCount > 0) {
    output.puts(`✓ Fixed ${fixedCount} orphaned pull request(s)`)
  } else {
    output.puts('✓ No orphaned states found - all pull requests are consistent')
  }
  return fixedCount
}

if (import.meta.main) {
  await runScript((ctx) => fixOrphanedStates(ctx.db, stdoutWriter))
}
