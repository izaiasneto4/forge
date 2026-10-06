import { Elysia } from 'elysia'
import { SettingsResponse } from '../contracts/settings'
import type { Db } from '../db/client'
import { ok } from '../http/envelope'
import { settingsPayload } from '../presenters/settings'

export function settingsRoutes(db: Db) {
  return new Elysia({ name: 'settings-routes', prefix: '/api/v1' }).get(
    '/settings',
    async () => ok(await settingsPayload(db)),
    { response: { 200: SettingsResponse } },
  )
}
