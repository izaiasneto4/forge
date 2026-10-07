import { Elysia } from 'elysia'
import { SettingsResponse } from '../contracts/settings'
import { ok } from '../http/envelope'
import { castBoolean, mergeParams, presentString, type Params } from '../http/params'
import { isPresent } from '../lib/ruby'
import { SETTING_KEYS, SettingStore, VALID_THEME_PREFERENCES } from '../models/setting'
import { settingsPayload } from '../presenters/settings'
import { isDirectory } from '../services/git'
import { renderError, type RouteDependencies } from './shared'

// SettingsController#update (Rails routes both PATCH and PUT here).
async function updateSettings(deps: RouteDependencies, params: Params) {
  const { ctx } = deps
  const settings = new SettingStore(ctx.db)
  const folderPath = presentString(params, 'repos_folder')
  const cliClient = presentString(params, 'default_cli_client')

  if (folderPath !== null && !isDirectory(folderPath)) renderError('invalid_input', 'Invalid folder path')

  if ('repos_folder' in params) {
    const raw = params.repos_folder
    settings.setReposFolder(raw === null || raw === undefined ? null : String(raw))
  }
  if (cliClient !== null) settings.setDefaultCliClient(cliClient)
  // ActiveModel boolean cast; a missing value is stored as "" like `nil.to_s`.
  const autoSubmit = castBoolean(params.auto_submit_enabled)
  settings.write(SETTING_KEYS.autoSubmitEnabled, autoSubmit === null ? '' : String(autoSubmit))

  return ok({ message: 'Settings updated', settings: await settingsPayload(ctx.db) })
}

export function settingsRoutes(deps: RouteDependencies) {
  const { ctx, services } = deps

  return new Elysia({ name: 'settings-routes', prefix: '/api/v1/settings' })
    .get('', async () => ok(await settingsPayload(ctx.db)), { response: { 200: SettingsResponse } })
    .patch('', ({ query, body }) => updateSettings(deps, mergeParams(query, body)))
    .put('', ({ query, body }) => updateSettings(deps, mergeParams(query, body)))
    .patch('/theme', async ({ query, body }) => {
      const themePreference = presentString(mergeParams(query, body), 'theme_preference')
      if (!isPresent(themePreference) || !VALID_THEME_PREFERENCES.some((theme) => theme === themePreference)) {
        renderError('invalid_input', 'Invalid theme_preference')
      }
      new SettingStore(ctx.db).setThemePreference(themePreference)
      return ok({ message: 'Theme updated', settings: await settingsPayload(ctx.db) })
    })
    .post('/pick_folder', async () => ok({ path: await services.pickFolder(ctx) }))
}
