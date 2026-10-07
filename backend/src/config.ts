import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { allowedHostsFromEnv } from './http/host-authorization'

const DEFAULT_APP_ROOT = fileURLToPath(new URL('../..', import.meta.url))

export interface RuntimeConfig {
  port: number
  appRoot: string
  databasePath: string
  publicDir: string
  development: boolean
  allowedHosts: string[]
  frontendDevUrl: string
}

// Relative paths resolve from the app root (where storage/ and public/ live),
// as they did under Rails; stored repo paths may be relative to it too.
export function runtimeConfig(env: Record<string, string | undefined>): RuntimeConfig {
  const appRoot = resolve(env.ORDEM_ROOT ?? env.RAILS_ROOT ?? DEFAULT_APP_ROOT)
  const development = env.NODE_ENV !== 'production'

  return {
    port: Number(env.PORT ?? 3000),
    appRoot,
    databasePath: resolve(appRoot, env.DATABASE_PATH ?? `storage/${development ? 'development' : 'production'}.sqlite3`),
    publicDir: resolve(appRoot, 'public'),
    development,
    allowedHosts: allowedHostsFromEnv(env.ORDEM_ALLOWED_HOSTS, development),
    frontendDevUrl: env.FRONTEND_DEV_URL ?? 'http://localhost:5173',
  }
}
