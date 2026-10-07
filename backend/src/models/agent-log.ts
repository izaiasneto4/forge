import { asc, eq } from 'drizzle-orm'
import type { AppContext } from '../context'
import type { Db } from '../db/client'
import { agentLogs } from '../db/schema'
import { iso8601 } from '../lib/ruby'
import { literals } from '../lib/literals'
import { STREAMS } from '../realtime/broadcaster'
import { Validator } from './record'

export type AgentLogRecord = typeof agentLogs.$inferSelect

export const LOG_TYPES = literals('output', 'error', 'status')
export type LogType = (typeof LOG_TYPES)[number]

export function agentLogPayload(log: AgentLogRecord) {
  return { id: log.id, log_type: log.logType, message: log.message, created_at: iso8601(log.createdAt) }
}

// `AgentLog.create!` plus its after_create_commit broadcast to the task's stream.
export function createAgentLog(ctx: AppContext, values: { reviewTaskId: number; message: string; logType: LogType }) {
  const validator = new Validator()
  validator.inclusion('Log type', values.logType, LOG_TYPES)
  validator.presence('Message', values.message)
  validator.assertValid()

  const now = new Date()
  const log = ctx.db.insert(agentLogs).values({ ...values, createdAt: now, updatedAt: now }).returning().get()
  ctx.events.broadcast(STREAMS.reviewTaskLogs(log.reviewTaskId), agentLogPayload(log))
  return log
}

// `review_task.agent_logs.recent`: oldest first.
export function recentLogs(db: Db, reviewTaskId: number) {
  return db.select().from(agentLogs).where(eq(agentLogs.reviewTaskId, reviewTaskId)).orderBy(asc(agentLogs.createdAt)).all()
}
