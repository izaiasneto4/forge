import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { backoffDelayMs, BACKOFF_CAP_MS, BackendManager, BackendStartError, buildServerEnv, LOOPBACK_HOST, stripServerKeys, type BackendState } from '../src/backend'
import { RotatingLog } from '../src/log'

const values = {
  home: '/Users/dev/.ordem',
  stateDir: '/Users/dev/.ordem/userdata',
  publicDir: '/Applications/Ordem.app/Contents/Resources/public',
  migrationsDir: '/Applications/Ordem.app/Contents/Resources/drizzle',
  isPackaged: true,
  port: 51234,
  token: 'c'.repeat(64),
}

describe('server environment', () => {
  test('drops ORDEM_*, legacy FORGE_* and data-moving keys from the inherited env', () => {
    const inherited = { HOME: '/Users/dev', ORDEM_HOME: '/elsewhere', FORGE_ROOT: '/old', DATABASE_PATH: '/tmp/other.sqlite3', PORT: '3000', ELECTRON_RUN_AS_NODE: '1' }

    const stripped = stripServerKeys(inherited)

    expect(stripped).toEqual({ HOME: inherited.HOME })
  })

  test('lays the login shell over the launch env, then the desktop values over both', () => {
    const launchPath = '/usr/bin:/bin'
    const shellPath = '/opt/homebrew/bin:/usr/bin:/bin'
    const inherited = { PATH: launchPath, ORDEM_DESKTOP_TOKEN: 'leaked' }
    const shellEnv = { PATH: shellPath, ORDEM_HOST: '0.0.0.0' }

    const env = buildServerEnv(inherited, shellEnv, values)

    expect(env).toMatchObject({
      PATH: shellPath,
      ORDEM_MODE: 'desktop',
      ORDEM_HOME: values.home,
      ORDEM_STATE_DIR: values.stateDir,
      NODE_ENV: 'production',
      ORDEM_HOST: LOOPBACK_HOST,
      PORT: String(values.port),
      ORDEM_DESKTOP_TOKEN: values.token,
      ORDEM_PUBLIC_DIR: values.publicDir,
      ORDEM_MIGRATIONS_DIR: values.migrationsDir,
    })
  })

  test('runs a development shell with NODE_ENV=development', () => {
    const env = buildServerEnv({}, {}, { ...values, isPackaged: false, stateDir: '/Users/dev/.ordem/dev' })

    expect(env.NODE_ENV).toBe('development')
  })
})

describe('backoff', () => {
  test('doubles from one second and caps at thirty', () => {
    const expected = [1000, 2000, 4000, 8000, 16000, BACKOFF_CAP_MS, BACKOFF_CAP_MS]

    expect(expected.map((_, index) => backoffDelayMs(index + 1))).toEqual(expected)
  })
})

describe('BackendManager', () => {
  let tempDir: string
  let manager: BackendManager | null

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'ordem-backend-'))
    manager = null
  })

  afterEach(async () => {
    await manager?.stop()
    rmSync(tempDir, { recursive: true, force: true })
  })

  function createManager(args: string[], onState: (state: BackendState) => void = () => {}) {
    const created = new BackendManager({
      server: { command: process.execPath, args },
      cwd: tempDir,
      inheritedEnv: { PATH: process.env.PATH, ORDEM_LEAKED_SETTING: 'from-the-shell', DATABASE_PATH: join(tempDir, 'wrong.sqlite3') },
      shellEnv: {},
      values: { ...values, stateDir: join(tempDir, 'state') },
      log: new RotatingLog(join(tempDir, 'logs', 'server.log')),
      readyTimeoutMs: 10_000,
      stopTimeoutMs: 3000,
      backoff: () => 50,
      onState,
    })
    manager = created
    return created
  }

  const fakeServer = join(import.meta.dir, 'fixtures', 'fake-server.ts')

  test('starts the server on loopback with a token and without leaked settings', async () => {
    const started = createManager([fakeServer])

    const environment = await started.start()
    const echoed = await (await fetch(`${environment.httpBaseUrl}/env`)).json()

    expect(environment.httpBaseUrl).toStartWith(`http://${LOOPBACK_HOST}:`)
    expect(echoed).toEqual({ mode: 'desktop', token: environment.token, stateDir: join(tempDir, 'state'), databasePath: null, leaked: null })
  }, 20_000)

  test('restarts a crashed server on the same port with the same token', async () => {
    const states: BackendState[] = []
    const started = createManager([fakeServer], (state) => states.push(state))
    const environment = await started.start()
    const firstPid = started.pid

    if (firstPid !== null) process.kill(firstPid, 'SIGKILL')
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline && !(started.pid !== null && started.pid !== firstPid && started.state.status === 'ready')) await Bun.sleep(50)

    expect(started.pid).not.toBe(firstPid)
    expect(started.environment).toEqual(environment)
    expect(states.map((state) => state.status)).toContain('restarting')
    expect((await fetch(`${environment.httpBaseUrl}/up`)).status).toBe(200)
  }, 20_000)

  test('stops the server it spawned and leaves nothing running', async () => {
    const started = createManager([fakeServer])
    const environment = await started.start()
    const pid = started.pid

    await started.stop()

    expect(started.state.status).toBe('stopped')
    expect(() => process.kill(pid ?? 0, 0)).toThrow()
    await expect(fetch(`${environment.httpBaseUrl}/up`)).rejects.toThrow()
  }, 20_000)

  test('fails the first start with the log path when the server exits early', async () => {
    const exitsAtOnce = join(tempDir, 'exits.ts')
    await Bun.write(exitsAtOnce, 'console.error("boom"); process.exit(3)')
    const started = createManager([exitsAtOnce])

    await expect(started.start()).rejects.toBeInstanceOf(BackendStartError)
    expect(readFileSync(join(tempDir, 'logs', 'server.log'), 'utf8')).toContain('boom')
  }, 20_000)
})
