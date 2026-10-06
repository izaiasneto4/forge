import { createApp } from './app'
import { openDatabase } from './db/client'

const port = Number(process.env.PORT ?? 3100)
const railsUrl = process.env.RAILS_URL ?? 'http://localhost:3000'
const databasePath = process.env.DATABASE_PATH ?? new URL('../../storage/development.sqlite3', import.meta.url).pathname

const app = createApp({ db: openDatabase(databasePath), railsUrl }).listen(port)

console.log(`Forge backend on http://localhost:${app.server?.port} (db: ${databasePath}, fallback: ${railsUrl})`)
