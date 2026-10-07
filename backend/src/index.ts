import { createApp } from './app'
import { bunCommandRunner } from './commands/runner'
import { runtimeConfig } from './config'
import type { AppContext } from './context'
import { openDatabase } from './db/client'
import { migrateDatabase } from './db/migrate'
import { JobQueue } from './jobs/queue'
import { startRecurringTasks } from './jobs/recurring'
import { jobHandlers } from './jobs/registry'
import { startJobWorker } from './jobs/worker'
import { logger } from './lib/logger'
import { CableServer } from './realtime/cable-server'

const config = runtimeConfig(process.env)

// Run where Rails ran, so relative repo paths stored in settings resolve identically.
process.chdir(config.appRoot)

const db = openDatabase(config.databasePath)
migrateDatabase(db)

const cable = new CableServer(db)
const ctx: AppContext = { db, events: cable, jobs: new JobQueue(db), commands: bunCommandRunner }
// FORGE_DISABLE_JOB_WORKER=1 queues jobs without running them (like Rails without `bin/jobs`).
const worker = process.env.FORGE_DISABLE_JOB_WORKER === '1' ? { stop: async () => {} } : startJobWorker(ctx.jobs, jobHandlers(ctx))
const recurring = startRecurringTasks(ctx)
const app = createApp({ ctx, cable, ...config }).listen({ port: config.port, hostname: '0.0.0.0' })

logger.info(`Forge on http://localhost:${app.server?.port} (db: ${config.databasePath})`)

let stopping = false
async function shutdown(signal: string) {
  if (stopping) return
  stopping = true
  logger.info(`Received ${signal}, shutting down`)
  recurring.stop()
  cable.stop()
  await app.stop()
  await worker.stop()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
