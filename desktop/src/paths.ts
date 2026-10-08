import { basename, join, resolve } from 'node:path'

// Where the shell keeps state and finds the server, the migrations and the web
// build. Pure: main.ts feeds it Electron's values, tests feed it their own.

export const PACKAGED_STATE_DIR = 'userdata'
export const DEVELOPMENT_STATE_DIR = 'dev'

export interface PathInputs {
  isPackaged: boolean
  platform: NodeJS.Platform
  homeDir: string
  // process.resourcesPath: Contents/Resources on macOS, resources/ elsewhere.
  resourcesPath: string
  // app.getAppPath(): the desktop/ folder when running from source.
  appPath: string
  env: Record<string, string | undefined>
}

export interface ServerCommand {
  command: string
  args: string[]
}

export interface DesktopPaths {
  home: string
  stateDir: string
  logDir: string
  settingsFile: string
  server: ServerCommand
  // The ordem CLI: the server binary's `cli` mode, or bin/ordem.ts from source.
  cli: ServerCommand
  migrationsDir: string
  publicDir: string
}

export function serverBinaryName(platform: NodeJS.Platform) {
  return platform === 'win32' ? 'ordem-server.exe' : 'ordem-server'
}

// ORDEM_HOME lets a developer point the shell elsewhere (a worktree, a scratch dir).
export function ordemHome(inputs: Pick<PathInputs, 'homeDir' | 'env'>) {
  const override = inputs.env.ORDEM_HOME?.trim()
  return override ? resolve(override) : join(inputs.homeDir, '.ordem')
}

export function resolveDesktopPaths(inputs: PathInputs): DesktopPaths {
  const home = ordemHome(inputs)
  const stateDir = join(home, inputs.isPackaged ? PACKAGED_STATE_DIR : DEVELOPMENT_STATE_DIR)
  assertDevelopmentStateDir(stateDir, inputs.isPackaged)
  const logDir = join(stateDir, 'logs')
  const settingsFile = join(stateDir, 'desktop-settings.json')

  if (inputs.isPackaged) {
    const serverBinary = join(inputs.resourcesPath, 'server', serverBinaryName(inputs.platform))
    return {
      home,
      stateDir,
      logDir,
      settingsFile,
      server: { command: serverBinary, args: [] },
      cli: { command: serverBinary, args: ['cli'] },
      migrationsDir: join(inputs.resourcesPath, 'drizzle'),
      publicDir: join(inputs.resourcesPath, 'public'),
    }
  }

  // From source: the repository is desktop/'s parent and the server runs under bun --watch.
  const repositoryRoot = resolve(inputs.appPath, '..')
  const bun = inputs.env.ORDEM_BUN?.trim() || 'bun'
  return {
    home,
    stateDir,
    logDir,
    settingsFile,
    server: { command: bun, args: ['--watch', join(repositoryRoot, 'backend', 'src', 'index.ts')] },
    cli: { command: bun, args: [join(repositoryRoot, 'backend', 'bin', 'ordem.ts')] },
    migrationsDir: join(repositoryRoot, 'backend', 'drizzle'),
    publicDir: join(repositoryRoot, 'public'),
  }
}

// A development launch must never open the real database.
export function assertDevelopmentStateDir(stateDir: string, isPackaged: boolean) {
  if (!isPackaged && basename(stateDir) === PACKAGED_STATE_DIR) {
    throw new Error(`Refusing to run a development build against ${stateDir}`)
  }
}
