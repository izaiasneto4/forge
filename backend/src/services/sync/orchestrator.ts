import type { AppContext } from '../../context'
import { SettingStore } from '../../models/setting'
import { withSyncMode } from '../sync-mode'
import { runSync, type SyncResult } from './engine'

// Port of Sync::Orchestrator: a manual sync with PullRequest's review-status
// consistency validation suspended (SyncMode) for the whole run.
export async function runOrchestratedSync(ctx: AppContext, options: { repoPath?: string | null } = {}): Promise<SyncResult> {
  const repoPath = options.repoPath ?? new SettingStore(ctx.db).currentRepo()
  return withSyncMode(() => runSync(ctx, { repoPath }))
}
