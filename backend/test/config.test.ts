import { describe, expect, test } from 'bun:test'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { DEFAULT_HOST, DEFAULT_MIGRATIONS_DIR, runtimeConfig } from '../src/config'
import { ALLOW_ALL_HOSTS, DEFAULT_ALLOWED_HOSTS, isAllowedHost } from '../src/http/host-authorization'

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

  test('resolves a relative DATABASE_PATH from ORDEM_ROOT, like database.yml', () => {
    const appRoot = '/srv/ordem'
    const relativeDatabasePath = 'storage/custom.sqlite3'

    const config = runtimeConfig({ ORDEM_ROOT: appRoot, DATABASE_PATH: relativeDatabasePath })

    expect(config.appRoot).toBe(appRoot)
    expect(config.databasePath).toBe(join(appRoot, relativeDatabasePath))
  })

  test('keeps an absolute DATABASE_PATH and reads port, hosts and the Vite URL', () => {
    const absoluteDatabasePath = '/data/ordem.sqlite3'
    const port = 4100
    const frontendDevUrl = 'http://localhost:5174'

    const config = runtimeConfig({ DATABASE_PATH: absoluteDatabasePath, PORT: String(port), ORDEM_ALLOWED_HOSTS: 'ordem.example.com', FRONTEND_DEV_URL: frontendDevUrl })

    expect(config).toMatchObject({ databasePath: absoluteDatabasePath, port, allowedHosts: ['ordem.example.com'], frontendDevUrl })
  })

  test('preserves an existing installation database location', () => {
    const legacyRoot = '/srv/existing-app'
    const relativeDatabasePath = 'storage/custom.sqlite3'

    const config = runtimeConfig({ NODE_ENV: 'production', FORGE_ROOT: legacyRoot, DATABASE_PATH: relativeDatabasePath })

    expect(config.databasePath).toBe(join(legacyRoot, relativeDatabasePath))
  })

  test('preserves existing production host restrictions', () => {
    const allowedHost = 'private.example.com'

    const config = runtimeConfig({ NODE_ENV: 'production', FORGE_ALLOWED_HOSTS: allowedHost })

    expect(isAllowedHost(allowedHost, config.allowedHosts)).toBe(true)
    expect(isAllowedHost('blocked.example.com', config.allowedHosts)).toBe(false)
  })

  test('prefers Ordem configuration over legacy settings', () => {
    const appRoot = '/srv/ordem'
    const allowedHost = 'ordem.example.com'
    const legacyHost = 'legacy.example.com'

    const config = runtimeConfig({ NODE_ENV: 'production', ORDEM_ROOT: appRoot, FORGE_ROOT: '/srv/existing-app', ORDEM_ALLOWED_HOSTS: allowedHost, FORGE_ALLOWED_HOSTS: legacyHost })

    expect(config.appRoot).toBe(appRoot)
    expect(isAllowedHost(allowedHost, config.allowedHosts)).toBe(true)
    expect(isAllowedHost(legacyHost, config.allowedHosts)).toBe(false)
  })

  test('keeps server mode, every interface and the repository migrations without desktop variables', () => {
    const repositoryMigrations = join(repositoryRoot, 'backend', 'drizzle')

    const config = runtimeConfig({})

    expect(config).toMatchObject({ mode: 'server', host: DEFAULT_HOST, stateDir: null, migrationsDir: repositoryMigrations })
    expect(DEFAULT_MIGRATIONS_DIR).toBe(repositoryMigrations)
  })

  test('puts state under ORDEM_HOME/dev outside production', () => {
    const home = '/tmp/ordem-home'
    const expectedStateDir = join(home, 'dev')

    const config = runtimeConfig({ ORDEM_HOME: home })

    expect(config.stateDir).toBe(expectedStateDir)
    expect(config.databasePath).toBe(join(expectedStateDir, 'ordem.sqlite3'))
  })

  test('puts state under ORDEM_HOME/userdata in production', () => {
    const home = '/tmp/ordem-home'
    const expectedStateDir = join(home, 'userdata')

    const config = runtimeConfig({ NODE_ENV: 'production', ORDEM_HOME: home })

    expect(config.stateDir).toBe(expectedStateDir)
    expect(config.databasePath).toBe(join(expectedStateDir, 'ordem.sqlite3'))
  })

  test('prefers ORDEM_STATE_DIR over the ORDEM_HOME split', () => {
    const stateDir = '/tmp/ordem-state'

    const config = runtimeConfig({ ORDEM_HOME: '/tmp/ordem-home', ORDEM_STATE_DIR: stateDir })

    expect(config.stateDir).toBe(stateDir)
    expect(config.databasePath).toBe(join(stateDir, 'ordem.sqlite3'))
  })

  test('prefers DATABASE_PATH over the state directory', () => {
    const databasePath = '/data/explicit.sqlite3'

    const config = runtimeConfig({ ORDEM_HOME: '/tmp/ordem-home', DATABASE_PATH: databasePath })

    expect(config.databasePath).toBe(databasePath)
  })

  test('reads desktop mode, host, public and migrations directories', () => {
    const host = '127.0.0.1'
    const publicDir = '/Applications/Ordem.app/Contents/Resources/public'
    const migrationsDir = '/Applications/Ordem.app/Contents/Resources/drizzle'

    const config = runtimeConfig({ ORDEM_MODE: 'desktop', ORDEM_HOST: host, ORDEM_PUBLIC_DIR: publicDir, ORDEM_MIGRATIONS_DIR: migrationsDir })

    expect(config).toMatchObject({ mode: 'desktop', host, publicDir, migrationsDir })
  })

  test('treats an unknown ORDEM_MODE as server mode', () => {
    const config = runtimeConfig({ ORDEM_MODE: 'kiosk' })

    expect(config.mode).toBe('server')
  })

  test('expands a leading ~ in ORDEM_HOME', () => {
    const homeSetting = '~/.ordem'

    const config = runtimeConfig({ ORDEM_HOME: homeSetting })

    expect(config.stateDir).toBe(join(homedir(), '.ordem', 'dev'))
  })
})
