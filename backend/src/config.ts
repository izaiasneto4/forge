import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { allowedHostsFromEnv } from './http/host-authorization'

const DEFAULT_APP_ROOT = fileURLToPath(new URL('../..', import.meta.url))

// Next to the source. A compiled server cannot read this path (it points inside
// the binary), so the desktop shell passes ORDEM_MIGRATIONS_DIR instead.
export const DEFAULT_MIGRATIONS_DIR = fileURLToPath(new URL('../drizzle', import.meta.url))

export const DEFAULT_HOST = '0.0.0.0'

export type RuntimeMode = 'server' | 'desktop'

export interface RuntimeConfig {
  mode: RuntimeMode
  port: number
  host: string
  appRoot: string
  stateDir: string | null
  databasePath: string
  publicDir: string
  migrationsDir: string
  development: boolean
  allowedHosts: string[]
  frontendDevUrl: string
}

function presentValue(value: string | undefined) {
  return value === undefined || value.trim() === '' ? undefined : value
}

// Shells expand `~`, .env files do not.
function expandHome(path: string) {
  return path === '~' || path.startsWith('~/') ? join(homedir(), path.slice(1)) : path
}

// ORDEM_STATE_DIR wins; otherwise ORDEM_HOME holds `userdata` for production
// and `dev` for everything else, so a development run never opens real data.
function stateDirFrom(env: Record<string, string | undefined>, appRoot: string, development: boolean) {
  const explicit = presentValue(env.ORDEM_STATE_DIR)
  if (explicit) return resolve(appRoot, expandHome(explicit))
  const home = presentValue(env.ORDEM_HOME)
  if (home) return resolve(appRoot, expandHome(home), development ? 'dev' : 'userdata')
  return null
}

// Relative paths resolve from the app root (where storage/ and public/ live),
// as they did under Rails; stored repo paths may be relative to it too.
export function runtimeConfig(env: Record<string, string | undefined>): RuntimeConfig {
  const appRoot = resolve(env.ORDEM_ROOT ?? env.FORGE_ROOT ?? env.RAILS_ROOT ?? DEFAULT_APP_ROOT)
  const development = env.NODE_ENV !== 'production'
  const stateDir = stateDirFrom(env, appRoot, development)
  const defaultDatabasePath = stateDir ? join(stateDir, 'ordem.sqlite3') : `storage/${development ? 'development' : 'production'}.sqlite3`
  const publicDir = presentValue(env.ORDEM_PUBLIC_DIR)
  const migrationsDir = presentValue(env.ORDEM_MIGRATIONS_DIR)

  return {
    mode: env.ORDEM_MODE === 'desktop' ? 'desktop' : 'server',
    port: Number(env.PORT ?? 3000),
    host: presentValue(env.ORDEM_HOST) ?? DEFAULT_HOST,
    appRoot,
    stateDir,
    databasePath: resolve(appRoot, env.DATABASE_PATH ?? defaultDatabasePath),
    publicDir: publicDir ? resolve(appRoot, publicDir) : resolve(appRoot, 'public'),
    migrationsDir: migrationsDir ? resolve(appRoot, migrationsDir) : DEFAULT_MIGRATIONS_DIR,
    development,
    allowedHosts: allowedHostsFromEnv(env.ORDEM_ALLOWED_HOSTS ?? env.FORGE_ALLOWED_HOSTS, development),
    frontendDevUrl: env.FRONTEND_DEV_URL ?? 'http://localhost:5173',
  }
}
