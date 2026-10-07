import type { AppContext } from '../../context'
import { SettingStore } from '../../models/setting'
import { runSync } from '../../services/sync/engine'

// Port of SyncPullRequestsJob: syncs the current repo; errors fail the job.
export async function syncPullRequestsJob(ctx: AppContext): Promise<void> {
  await runSync(ctx, { repoPath: new SettingStore(ctx.db).currentRepo(), trigger: 'job' })
}
