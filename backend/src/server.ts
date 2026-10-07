import { createApp } from './app'
import { bunCommandRunner, type CommandRunner } from './commands/runner'
import type { RuntimeConfig } from './config'
import type { AppContext } from './context'
import { openDatabase } from './db/client'
import { migrateDatabase } from './db/migrate'
import { JobQueue } from './jobs/queue'
import { startRecurringTasks } from './jobs/recurring'
import { jobHandlers } from './jobs/registry'
import { startJobWorker } from './jobs/worker'
import { RealtimeServer } from './realtime/ws-server'

export const SHUTDOWN_TIMEOUT_MS = 5000

export interface ServerOptions {
  config: RuntimeConfig
  jobWorker?: boolean
  commands?: CommandRunner
  shutdownTimeoutMs?: number
}

async function within(timeoutMs: number, work: Promise<unknown>) {
  await Promise.race([work, Bun.sleep(timeoutMs)])
}

export function startServer(options: ServerOptions) {
  const { config } = options
  const shutdownTimeoutMs = options.shutdownTimeoutMs ?? SHUTDOWN_TIMEOUT_MS

  const db = openDatabase(config.databasePath)
  migrateDatabase(db)

  const realtime = new RealtimeServer(db)
  const ctx: AppContext = { db, events: realtime, jobs: new JobQueue(db), commands: options.commands ?? bunCommandRunner }
  const worker = options.jobWorker === false ? { stop: async () => {} } : startJobWorker(ctx.jobs, jobHandlers(ctx), { shutdownTimeoutMs })
  const recurring = startRecurringTasks(ctx)
  const app = createApp({ ctx, realtime, ...config }).listen({ port: config.port, hostname: '0.0.0.0' })

  return {
    app,
    ctx,
    port: app.server?.port ?? config.port,
    async stop() {
      recurring.stop()
      realtime.disconnectAll()
      // Bun 1.2.20's server.stop() can stay pending after the server closed
      // websockets itself, so it gets the same deadline as running jobs.
      await within(shutdownTimeoutMs, app.stop(true))
      await worker.stop()
    },
  }
}
