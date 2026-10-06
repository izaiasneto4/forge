import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_RAILS_ROOT = fileURLToPath(new URL('../..', import.meta.url))

export interface RuntimeConfig {
  port: number
  railsUrl: string
  railsRoot: string
  databasePath: string
}

// Relative paths resolve from the Rails root, as they do in Rails: settings may
// hold repo paths relative to it, and database.yml's paths are relative to it.
export function runtimeConfig(env: Record<string, string | undefined>): RuntimeConfig {
  const railsRoot = resolve(env.RAILS_ROOT ?? DEFAULT_RAILS_ROOT)

  return {
    port: Number(env.PORT ?? 3100),
    railsUrl: env.RAILS_URL ?? 'http://localhost:3000',
    railsRoot,
    databasePath: resolve(railsRoot, env.DATABASE_PATH ?? 'storage/development.sqlite3'),
  }
}
