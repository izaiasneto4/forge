import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { assertDevelopmentStateDir, resolveDesktopPaths, serverBinaryName } from '../src/paths'

const homeDir = '/Users/dev'
const resourcesPath = '/Applications/Ordem.app/Contents/Resources'
const repositoryRoot = '/Users/dev/code/ordem'
const appPath = join(repositoryRoot, 'desktop')

describe('resolveDesktopPaths', () => {
  test('packaged: userdata state and every resource under Resources/', () => {
    const paths = resolveDesktopPaths({ isPackaged: true, platform: 'darwin', homeDir, resourcesPath, appPath: join(resourcesPath, 'app.asar'), env: {} })

    expect(paths).toEqual({
      home: join(homeDir, '.ordem'),
      stateDir: join(homeDir, '.ordem', 'userdata'),
      logDir: join(homeDir, '.ordem', 'userdata', 'logs'),
      settingsFile: join(homeDir, '.ordem', 'userdata', 'desktop-settings.json'),
      server: { command: join(resourcesPath, 'server', 'ordem-server'), args: [] },
      migrationsDir: join(resourcesPath, 'drizzle'),
      publicDir: join(resourcesPath, 'public'),
    })
  })

  test('packaged on Windows runs the .exe', () => {
    const paths = resolveDesktopPaths({ isPackaged: true, platform: 'win32', homeDir, resourcesPath, appPath, env: {} })

    expect(paths.server.command).toBe(join(resourcesPath, 'server', serverBinaryName('win32')))
  })

  test('development: dev state and the server from source under bun --watch', () => {
    const paths = resolveDesktopPaths({ isPackaged: false, platform: 'darwin', homeDir, resourcesPath, appPath, env: {} })

    expect(paths.stateDir).toBe(join(homeDir, '.ordem', 'dev'))
    expect(paths.server).toEqual({ command: 'bun', args: ['--watch', join(repositoryRoot, 'backend', 'src', 'index.ts')] })
    expect(paths.migrationsDir).toBe(join(repositoryRoot, 'backend', 'drizzle'))
    expect(paths.publicDir).toBe(join(repositoryRoot, 'public'))
  })

  test('honours ORDEM_HOME and ORDEM_BUN', () => {
    const home = '/tmp/ordem-scratch'
    const bun = '/opt/bun/bin/bun'

    const paths = resolveDesktopPaths({ isPackaged: false, platform: 'linux', homeDir, resourcesPath, appPath, env: { ORDEM_HOME: home, ORDEM_BUN: bun } })

    expect(paths.stateDir).toBe(join(home, 'dev'))
    expect(paths.server.command).toBe(bun)
  })

  test('a development launch refuses the real userdata folder', () => {
    const realState = join(homeDir, '.ordem', 'userdata')

    expect(() => assertDevelopmentStateDir(realState, false)).toThrow(realState)
    expect(() => assertDevelopmentStateDir(realState, true)).not.toThrow()
  })
})
