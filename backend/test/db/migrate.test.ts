import { describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { readFileSync } from 'node:fs'
import { openDatabase, type Db } from '../../src/db/client'
import { migrateDatabase, RAILS_BASELINE_VERSION } from '../../src/db/migrate'

const baselineSql = readFileSync(new URL('../../drizzle/0000_rails_baseline.sql', import.meta.url), 'utf8')

function tableNames(db: Db) {
  return db.all<{ name: string }>(sql`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).map((row) => row.name)
}

// What `bin/rails db:prepare` leaves behind: the Rails tables plus schema_migrations.
function createRailsDatabase(version: string) {
  const db = openDatabase(':memory:')
  for (const statement of baselineSql.split('--> statement-breakpoint')) db.run(sql.raw(statement))
  db.run(sql`INSERT INTO schema_migrations (version) VALUES (${version})`)
  return db
}

describe('migrateDatabase', () => {
  test('builds a fresh database with the Rails tables and the Bun jobs table', () => {
    const db = openDatabase(':memory:')

    migrateDatabase(db)

    expect(tableNames(db)).toEqual(expect.arrayContaining(['pull_requests', 'review_tasks', 'settings', 'jobs']))
  })

  test('adopts a Rails-created database without re-running the baseline', () => {
    const db = createRailsDatabase(RAILS_BASELINE_VERSION)
    const existingSettingKey = 'repos_folder'
    db.run(sql`INSERT INTO settings (key, value, created_at, updated_at) VALUES (${existingSettingKey}, '/repos', '2026-01-01 00:00:00', '2026-01-01 00:00:00')`)

    migrateDatabase(db)

    expect(tableNames(db)).toContain('jobs')
    expect(db.all<{ key: string }>(sql`SELECT key FROM settings`)[0]?.key).toBe(existingSettingKey)
  })

  test('adds the review focus column to fresh and adopted databases', () => {
    const column = 'review_focus'
    const fresh = openDatabase(':memory:')
    const adopted = createRailsDatabase(RAILS_BASELINE_VERSION)
    const columnsOf = (db: Db) => db.all<{ name: string }>(sql`PRAGMA table_info(review_tasks)`).map((row) => row.name)

    migrateDatabase(fresh)
    migrateDatabase(adopted)

    expect(columnsOf(fresh)).toContain(column)
    expect(columnsOf(adopted)).toContain(column)
  })

  test('is idempotent', () => {
    const db = createRailsDatabase(RAILS_BASELINE_VERSION)

    migrateDatabase(db)
    migrateDatabase(db)

    expect(tableNames(db).filter((name) => name === 'jobs')).toHaveLength(1)
  })

  test('adopts a Rails database whose earlier adoption stopped before recording the baseline', () => {
    const db = createRailsDatabase(RAILS_BASELINE_VERSION)
    db.run(sql`CREATE TABLE "__drizzle_migrations" (id INTEGER PRIMARY KEY AUTOINCREMENT, hash text NOT NULL, created_at numeric)`)

    migrateDatabase(db)

    expect(tableNames(db)).toContain('jobs')
  })

  test('refuses a Rails database that is behind the baseline schema', () => {
    const olderVersion = '20250101000000'
    const db = createRailsDatabase(olderVersion)

    expect(() => migrateDatabase(db)).toThrow(olderVersion)
  })
})
