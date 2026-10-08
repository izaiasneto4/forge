#!/usr/bin/env bun
// Creates or upgrades the database (adopting a Rails-created one in place).
import { mkdirSync } from 'node:fs'
import { runtimeConfig } from '../src/config'
import { openDatabase } from '../src/db/client'
import { migrateDatabase } from '../src/db/migrate'

const config = runtimeConfig(process.env)
if (config.stateDir) mkdirSync(config.stateDir, { recursive: true })
migrateDatabase(openDatabase(config.databasePath), config.migrationsDir)
console.log(`Database ready at ${config.databasePath}`)
