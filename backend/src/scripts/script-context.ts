import { bunCommandRunner } from '../commands/runner'
import { runtimeConfig } from '../config'
import type { AppContext } from '../context'
import { openDatabase } from '../db/client'
import { migrateDatabase } from '../db/migrate'
import { JobQueue } from '../jobs/queue'
import type { Broadcaster } from '../realtime/broadcaster'
import type { OutputWriter } from '../services/review-lifecycle-backfill'

// Shared plumbing for the `bun backend/src/scripts/<name>.ts` ports of the rake tasks.

export type { OutputWriter }

export const stdoutWriter: OutputWriter = {
  puts: (line) => {
    process.stdout.write(`${line}\n`)
  },
}

// The cable server lives inside the web process, so a standalone script has no
// subscribers to reach (Rails delivered rake-task broadcasts via solid_cable).
const detachedBroadcaster: Broadcaster = {
  broadcast() {},
}

// Opens the database exactly as the server does (from the app root, migrated),
// like a rake task loading `:environment`.
export function openScriptContext(env: Record<string, string | undefined> = process.env): AppContext {
  const config = runtimeConfig(env)
  process.chdir(config.appRoot)
  const db = openDatabase(config.databasePath)
  migrateDatabase(db)
  return { db, events: detachedBroadcaster, jobs: new JobQueue(db), commands: bunCommandRunner }
}

export async function runScript(work: (ctx: AppContext) => unknown) {
  const ctx = openScriptContext()
  try {
    await work(ctx)
  } finally {
    ctx.db.$client.close()
  }
}
