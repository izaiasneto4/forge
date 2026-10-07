import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import * as relations from './relations'
import * as schema from './schema'

const fullSchema = { ...schema, ...relations }

export function openDatabase(path: string) {
  const sqlite = new Database(path, { create: true, strict: true })
  sqlite.exec('PRAGMA journal_mode = WAL')
  sqlite.exec('PRAGMA busy_timeout = 5000')
  sqlite.exec('PRAGMA foreign_keys = ON')
  return drizzle(sqlite, { schema: fullSchema })
}

export type Db = ReturnType<typeof openDatabase>
