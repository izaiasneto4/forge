import { mkdirSync } from 'node:fs'
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

// Standalone scripts run outside the web process, so broadcasts have no live subscribers.
const detachedBroadcaster: Broadcaster = {
  broadcast() {},
}

export function openScriptContext(env: Record<string, string | undefined> = process.env): AppContext {
  const config = runtimeConfig(env)
  if (config.mode === 'server') process.chdir(config.appRoot)
  if (config.stateDir) mkdirSync(config.stateDir, { recursive: true })
  const db = openDatabase(config.databasePath)
  migrateDatabase(db, config.migrationsDir)
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
