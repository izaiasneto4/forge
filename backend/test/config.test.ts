import { describe, expect, test } from 'bun:test'
import { join, resolve } from 'node:path'
import { runtimeConfig } from '../src/config'

const repositoryRoot = resolve(import.meta.dir, '../..')

describe('runtimeConfig', () => {
  test('defaults to the repository root and the Rails development database', () => {
    const config = runtimeConfig({})

    expect(config.railsRoot).toBe(repositoryRoot)
    expect(config.databasePath).toBe(join(repositoryRoot, 'storage', 'development.sqlite3'))
  })

  test('resolves a relative DATABASE_PATH from RAILS_ROOT, like database.yml', () => {
    const railsRoot = '/srv/forge'
    const relativeDatabasePath = 'storage/production.sqlite3'

    const config = runtimeConfig({ RAILS_ROOT: railsRoot, DATABASE_PATH: relativeDatabasePath })

    expect(config.railsRoot).toBe(railsRoot)
    expect(config.databasePath).toBe(join(railsRoot, relativeDatabasePath))
  })

  test('keeps an absolute DATABASE_PATH as given', () => {
    const absoluteDatabasePath = '/data/forge.sqlite3'

    expect(runtimeConfig({ DATABASE_PATH: absoluteDatabasePath }).databasePath).toBe(absoluteDatabasePath)
  })

  test('reads port and Rails URL from the environment', () => {
    const port = 4100
    const railsUrl = 'http://rails.internal:3000'

    const config = runtimeConfig({ PORT: String(port), RAILS_URL: railsUrl })

    expect(config.port).toBe(port)
    expect(config.railsUrl).toBe(railsUrl)
  })
})
