import { AsyncLocalStorage } from 'node:async_hooks'

// Port of SyncMode: while a sync applies GitHub state, PullRequest skips its
// review_status/review_task consistency validation. Rails scoped this to the
// thread; AsyncLocalStorage scopes it to the async call chain.
const syncMode = new AsyncLocalStorage<true>()

export function isSyncModeActive() {
  return syncMode.getStore() === true
}

export function withSyncMode<Result>(work: () => Result): Result {
  return syncMode.run(true, work)
}
