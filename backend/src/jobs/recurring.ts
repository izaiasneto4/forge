import type { AppContext } from '../context'
import { logger } from '../lib/logger'
import { fixStateMismatches } from '../models/pull-request'
import { resetStuckTasks } from '../models/review-task'

// config/recurring.yml: both commands ran "every 5 minutes".
export const RECURRING_INTERVAL_MS = 5 * 60 * 1000

export const RECURRING_TASKS: Array<{ name: string; run: (ctx: AppContext) => number }> = [
  { name: 'reset_stuck_review_tasks', run: (ctx) => resetStuckTasks(ctx, 10) },
  { name: 'fix_review_state_mismatches', run: (ctx) => fixStateMismatches(ctx.db) },
]

export function runRecurringTasks(ctx: AppContext) {
  for (const task of RECURRING_TASKS) {
    try {
      const changed = task.run(ctx)
      if (changed > 0) logger.info(`[recurring] ${task.name}: ${changed} record(s) updated`)
    } catch (error) {
      logger.error(`[recurring] ${task.name} failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

export function startRecurringTasks(ctx: AppContext, intervalMs = RECURRING_INTERVAL_MS) {
  const timer = setInterval(() => runRecurringTasks(ctx), intervalMs)
  return { stop: () => clearInterval(timer) }
}
