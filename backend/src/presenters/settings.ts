import { CLI_CLIENTS, SettingStore, VALID_THEME_PREFERENCES } from '../models/setting'
import { dbOf, type PayloadSource } from './pull-request-index'
import { currentRepoPayload } from './ui-payloads'

export { currentRepoPayload }

// Port of Api::V1::UiPayloads::Settings.
export async function settingsPayload(source: PayloadSource) {
  const db = dbOf(source)
  const settingStore = new SettingStore(db)

  return {
    repos_folder: settingStore.reposFolder(),
    current_repo: await currentRepoPayload(db),
    default_cli_client: settingStore.defaultCliClient(),
    auto_submit_enabled: settingStore.autoSubmitEnabled(),
    theme_preference: settingStore.themePreference(),
    cli_clients: [...CLI_CLIENTS],
    valid_theme_preferences: [...VALID_THEME_PREFERENCES],
  }
}
