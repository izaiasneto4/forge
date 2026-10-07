import { openDatabase } from '../../src/db/client'
import { migrateDatabase } from '../../src/db/migrate'

export function createTestDatabase() {
  const db = openDatabase(':memory:')
  migrateDatabase(db)
  return db
}
