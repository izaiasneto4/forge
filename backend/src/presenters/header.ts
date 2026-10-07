import { and, count } from 'drizzle-orm'
import type { Db } from '../db/client'
import { pullRequests } from '../db/schema'
import { isBlank, rubyBasename } from '../lib/ruby'
import { currentRepoCondition, withReviewStatus } from '../models/pull-request'

// Port of HeaderPresenter. Rails cached the counts for a minute; they are
// computed fresh here, so there is nothing to invalidate.

// `File.basename(path).sub(%r{/$}, "")`
export function repoDirectoryName(path: string) {
  return rubyBasename(path).replace(/\/$/, '')
}

export function headerRepoName(currentRepo: string | null) {
  if (isBlank(currentRepo)) return 'No repository selected'
  return repoDirectoryName(currentRepo)
}

// The Ruby methods `rescue` any error into 0.
async function countWithStatus(db: Db, currentRepo: string | null, status: string) {
  try {
    const repoCondition = await currentRepoCondition(currentRepo)
    const row = db
      .select({ total: count() })
      .from(pullRequests)
      .where(and(withReviewStatus(status), repoCondition))
      .get()
    return row?.total ?? 0
  } catch {
    return 0
  }
}

export function headerPendingCount(db: Db, currentRepo: string | null) {
  return countWithStatus(db, currentRepo, 'pending_review')
}

export function headerInReviewCount(db: Db, currentRepo: string | null) {
  return countWithStatus(db, currentRepo, 'in_review')
}
