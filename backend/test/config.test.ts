import { describe, expect, test } from 'bun:test'
import { join, resolve } from 'node:path'
import { runtimeConfig } from '../src/config'
import { ALLOW_ALL_HOSTS, DEFAULT_ALLOWED_HOSTS } from '../src/http/host-authorization'

const repositoryRoot = resolve(import.meta.dir, '../..')

describe('runtimeConfig', () => {
  test('defaults to the repository root, port 3000 and the development database', () => {
    const config = runtimeConfig({})

    expect(config).toMatchObject({
      port: 3000,
      appRoot: repositoryRoot,
      databasePath: join(repositoryRoot, 'storage', 'development.sqlite3'),
      publicDir: join(repositoryRoot, 'public'),
      development: true,
      allowedHosts: DEFAULT_ALLOWED_HOSTS,
    })
  })

  test('uses the production database in production', () => {
    const config = runtimeConfig({ NODE_ENV: 'production' })

    expect(config.development).toBe(false)
    expect(config.databasePath).toBe(join(repositoryRoot, 'storage', 'production.sqlite3'))
    expect(config.allowedHosts).toEqual(ALLOW_ALL_HOSTS)
  })

  test('resolves a relative DATABASE_PATH from FORGE_ROOT, like database.yml', () => {
    const appRoot = '/srv/forge'
    const relativeDatabasePath = 'storage/custom.sqlite3'

    const config = runtimeConfig({ FORGE_ROOT: appRoot, DATABASE_PATH: relativeDatabasePath })

    expect(config.appRoot).toBe(appRoot)
    expect(config.databasePath).toBe(join(appRoot, relativeDatabasePath))
  })

  test('keeps an absolute DATABASE_PATH and reads port, hosts and the Vite URL', () => {
    const absoluteDatabasePath = '/data/forge.sqlite3'
    const port = 4100
    const frontendDevUrl = 'http://localhost:5174'

    const config = runtimeConfig({ DATABASE_PATH: absoluteDatabasePath, PORT: String(port), FORGE_ALLOWED_HOSTS: 'forge.example.com', FRONTEND_DEV_URL: frontendDevUrl })

    expect(config).toMatchObject({ databasePath: absoluteDatabasePath, port, allowedHosts: ['forge.example.com'], frontendDevUrl })
  })
})
