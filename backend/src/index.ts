import { createApp } from './app'
import { runtimeConfig } from './config'
import { openDatabase } from './db/client'

const config = runtimeConfig(process.env)

// Run where Rails runs, so relative repo paths stored by Rails resolve identically.
process.chdir(config.railsRoot)

const app = createApp({ db: openDatabase(config.databasePath), railsUrl: config.railsUrl }).listen(config.port)

console.log(
  `Forge backend on http://localhost:${app.server?.port} (rails root: ${config.railsRoot}, db: ${config.databasePath}, fallback: ${config.railsUrl})`,
)
