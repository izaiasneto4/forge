import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import { openDatabase } from '../../src/db/client'

const migrationsFolder = new URL('../../drizzle', import.meta.url).pathname

export function createTestDatabase() {
  const db = openDatabase(':memory:')
  migrate(db, { migrationsFolder })
  return db
}
