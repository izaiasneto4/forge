import { eq } from 'drizzle-orm'
import type { Db } from '../db/client'
import { settings } from '../db/schema'

export const CLI_CLIENTS = ['claude', 'codex', 'opencode'] as const
export const VALID_THEME_PREFERENCES = ['light', 'dark'] as const
export const DEFAULT_CLI_CLIENT = 'claude'

export type ThemePreference = (typeof VALID_THEME_PREFERENCES)[number]

export const SETTING_KEYS = {
  reposFolder: 'repos_folder',
  currentRepo: 'current_repo',
  defaultCliClient: 'default_cli_client',
  autoSubmitEnabled: 'auto_submit_enabled',
  themePreference: 'theme_preference',
} as const

type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS]

export function isThemePreference(value: string): value is ThemePreference {
  return VALID_THEME_PREFERENCES.some((preference) => preference === value)
}

export function isBlank(value: string | null): value is null {
  return value === null || value.trim() === ''
}

// Port of the Rails `Setting` key/value model. Rails caches reads for 30s in
// process memory, so writes made here can take up to 30s to show up in Rails.
export class SettingStore {
  constructor(private readonly db: Db) {}

  read(key: SettingKey): string | null {
    const row = this.db.select({ value: settings.value }).from(settings).where(eq(settings.key, key)).get()
    return row?.value ?? null
  }

  write(key: SettingKey, value: string | null) {
    const now = new Date()
    this.db
      .insert(settings)
      .values({ key, value, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now } })
      .run()
  }

  reposFolder() {
    return this.read(SETTING_KEYS.reposFolder)
  }

  currentRepo() {
    return this.read(SETTING_KEYS.currentRepo)
  }

  setCurrentRepo(path: string) {
    this.write(SETTING_KEYS.currentRepo, path)
  }

  defaultCliClient() {
    return this.read(SETTING_KEYS.defaultCliClient) ?? DEFAULT_CLI_CLIENT
  }

  autoSubmitEnabled() {
    return this.read(SETTING_KEYS.autoSubmitEnabled) === 'true'
  }

  themePreference(): ThemePreference | null {
    const value = this.read(SETTING_KEYS.themePreference)
    if (isBlank(value) || !isThemePreference(value)) {
      return null
    }

    return value
  }
}
