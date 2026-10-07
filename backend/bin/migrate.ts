#!/usr/bin/env bun
// Creates or upgrades the database (adopting a Rails-created one in place).
import { runtimeConfig } from '../src/config'
import { openDatabase } from '../src/db/client'
import { migrateDatabase } from '../src/db/migrate'

const config = runtimeConfig(process.env)
migrateDatabase(openDatabase(config.databasePath))
console.log(`Database ready at ${config.databasePath}`)
