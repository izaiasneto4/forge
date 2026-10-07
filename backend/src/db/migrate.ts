import { sql } from 'drizzle-orm'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import type { Db } from './client'

const migrationsFolder = new URL('../../drizzle', import.meta.url).pathname

// The last Rails migration folded into drizzle/0000_rails_baseline.sql.
export const RAILS_BASELINE_VERSION = '20260307120000'

// Raw `db.get` returns array rows in drizzle's bun-sqlite driver; `db.all` returns objects.
function firstRow<Row>(rows: Row[]) {
  return rows[0]
}

function tableExists(db: Db, table: string) {
  const row = firstRow(db.all<{ found: number }>(sql`SELECT count(*) AS found FROM sqlite_master WHERE type = 'table' AND name = ${table}`))
  return (row?.found ?? 0) > 0
}

// Databases created by Rails already contain the baseline tables. Record the
// baseline as applied so only Bun-era migrations run against them.
function adoptRailsDatabase(db: Db) {
  const latest = firstRow(db.all<{ version: string | null }>(sql`SELECT max(version) AS version FROM schema_migrations`))
  const railsVersion = latest?.version ?? ''
  if (railsVersion < RAILS_BASELINE_VERSION) {
    throw new Error(
      `Database is at Rails schema ${railsVersion || 'none'}, older than ${RAILS_BASELINE_VERSION}. ` +
        'Run the Rails migrations once with the last Rails release before switching to the Bun backend.',
    )
  }

  const [baseline] = readMigrationFiles({ migrationsFolder })
  if (!baseline) throw new Error(`No migrations found in ${migrationsFolder}`)

  // One transaction: a start interrupted mid-adoption leaves no half-made tracking table behind.
  db.transaction((tx) => {
    tx.run(sql`CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (id INTEGER PRIMARY KEY AUTOINCREMENT, hash text NOT NULL, created_at numeric)`)
    tx.run(sql`INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (${baseline.hash}, ${baseline.folderMillis})`)
  })
}

// An empty tracking table counts as not adopted, which also recovers databases
// where an older build stopped between creating the table and recording the baseline.
function hasRecordedMigrations(db: Db) {
  if (!tableExists(db, '__drizzle_migrations')) return false
  const row = firstRow(db.all<{ recorded: number }>(sql`SELECT count(*) AS recorded FROM "__drizzle_migrations"`))
  return (row?.recorded ?? 0) > 0
}

export function migrateDatabase(db: Db) {
  if (tableExists(db, 'schema_migrations') && !hasRecordedMigrations(db)) {
    adoptRailsDatabase(db)
  }
  migrate(db, { migrationsFolder })
}
