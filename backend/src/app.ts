import { Elysia } from 'elysia'
import type { Db } from './db/client'
import { errorHandling } from './http/envelope'
import { railsProxy } from './http/rails-proxy'
import { settingsRoutes } from './routes/settings'

export interface AppOptions {
  db: Db
  railsUrl: string
}

export function createApp({ db, railsUrl }: AppOptions) {
  return new Elysia().use(errorHandling).use(settingsRoutes(db)).use(railsProxy(railsUrl))
}

export type App = ReturnType<typeof createApp>
