import type { reviewIterations } from '../db/schema'
import { secondsBetween } from '../lib/ruby'

export type ReviewIterationRecord = typeof reviewIterations.$inferSelect

export function iterationDurationSeconds(iteration: ReviewIterationRecord) {
  if (iteration.startedAt === null || iteration.completedAt === null) return null
  return Math.trunc(secondsBetween(iteration.completedAt, iteration.startedAt))
}
