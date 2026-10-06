import { basename } from 'node:path'
import type { Db } from '../db/client'
import { CLI_CLIENTS, isBlank, SettingStore, VALID_THEME_PREFERENCES } from '../models/setting'
import { recoverCurrentRepo } from '../services/current-repo-recovery'
import { slugFromPath } from '../services/repo-slug-resolver'

// Port of Api::V1::UiPayloads::Base#current_repo_payload.
export async function currentRepoPayload(db: Db) {
  const repoPath = (await recoverCurrentRepo(db)) ?? new SettingStore(db).currentRepo()

  return {
    path: repoPath,
    slug: await slugFromPath(repoPath),
    name: isBlank(repoPath) ? null : basename(repoPath),
  }
}

// Port of Api::V1::UiPayloads::Settings.
export async function settingsPayload(db: Db) {
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
