import { Elysia } from 'elysia'
import type { Db } from './db/client'
import { errorHandling } from './http/envelope'
import { cableServerWebSocketOptions, railsCableProxy } from './http/rails-cable-proxy'
import { railsProxy } from './http/rails-proxy'
import { settingsRoutes } from './routes/settings'

export interface AppOptions {
  db: Db
  railsUrl: string
}

export function createApp({ db, railsUrl }: AppOptions) {
  return new Elysia({ websocket: cableServerWebSocketOptions() })
    .use(errorHandling)
    .use(settingsRoutes(db))
    .use(railsCableProxy(railsUrl))
    .use(railsProxy(railsUrl))
}

export type App = ReturnType<typeof createApp>
