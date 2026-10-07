import { eq } from 'drizzle-orm'
import type { Db } from '../db/client'
import { settings } from '../db/schema'
import { isBlank, isPresent, iso8601, secondsBetween } from '../lib/ruby'

export const CLI_CLIENTS = ['claude', 'codex', 'opencode'] as const
export const VALID_THEME_PREFERENCES = ['light', 'dark'] as const
export const DEFAULT_CLI_CLIENT = 'claude'
export const SYNC_DEBOUNCE_SECONDS = 300
export const DEFAULT_AUTO_REVIEW_DELAY_MIN = 5
export const DEFAULT_AUTO_REVIEW_DELAY_MAX = 30

export type CliClient = (typeof CLI_CLIENTS)[number]
export type ThemePreference = (typeof VALID_THEME_PREFERENCES)[number]

export const SETTING_KEYS = {
  reposFolder: 'repos_folder',
  currentRepo: 'current_repo',
  defaultCliClient: 'default_cli_client',
  lastSyncedAt: 'last_synced_at',
  onlyRequestedReviews: 'only_requested_reviews',
  githubLogin: 'github_login',
  autoReviewMode: 'auto_review_mode',
  autoReviewDelayMin: 'auto_review_delay_min',
  autoReviewDelayMax: 'auto_review_delay_max',
  autoSubmitEnabled: 'auto_submit_enabled',
  themePreference: 'theme_preference',
} as const

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS]

export function isThemePreference(value: string): value is ThemePreference {
  return VALID_THEME_PREFERENCES.some((preference) => preference === value)
}

export function isCliClient(value: string): value is CliClient {
  return CLI_CLIENTS.some((client) => client === value)
}

// Ruby `Integer(value, exception: false)` for the decimal values this app stores.
function parseInteger(value: string | null) {
  if (value === null) return null
  const trimmed = value.trim()
  if (!/^[+-]?\d+(_\d+)*$/.test(trimmed)) return null
  return Number.parseInt(trimmed.replaceAll('_', ''), 10)
}

function parseDelay(value: string | null, fallback: number) {
  const parsed = parseInteger(value)
  return parsed === null || parsed < 0 ? fallback : parsed
}

// Port of the Rails `Setting` key/value model (plus Auto-review, Sync and Repos
// configuration, which read the same rows).
export class SettingStore {
  constructor(private readonly db: Db) {}

  read(key: SettingKey): string | null {
    const row = this.db.select({ value: settings.value }).from(settings).where(eq(settings.key, key)).get()
    return row?.value ?? null
  }

  // `find_or_initialize_by(key:).update!(value:)`: no write when the value is unchanged.
  write(key: SettingKey, value: string | null) {
    const existing = this.db.select().from(settings).where(eq(settings.key, key)).get()
    const now = new Date()
    if (!existing) {
      this.db.insert(settings).values({ key, value, createdAt: now, updatedAt: now }).run()
      return
    }
    if (existing.value === value) return
    this.db.update(settings).set({ value, updatedAt: now }).where(eq(settings.id, existing.id)).run()
  }

  reposFolder() {
    return this.read(SETTING_KEYS.reposFolder)
  }

  setReposFolder(path: string | null) {
    this.write(SETTING_KEYS.reposFolder, path)
  }

  currentRepo() {
    return this.read(SETTING_KEYS.currentRepo)
  }

  setCurrentRepo(path: string | null) {
    this.write(SETTING_KEYS.currentRepo, path)
  }

  defaultCliClient() {
    return this.read(SETTING_KEYS.defaultCliClient) ?? DEFAULT_CLI_CLIENT
  }

  setDefaultCliClient(client: string) {
    if (!isCliClient(client)) return
    this.write(SETTING_KEYS.defaultCliClient, client)
  }

  lastSyncedAt(): Date | null {
    const value = this.read(SETTING_KEYS.lastSyncedAt)
    if (isBlank(value)) return null
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  setLastSyncedAt(time: Date | null) {
    this.write(SETTING_KEYS.lastSyncedAt, iso8601(time))
  }

  touchLastSynced() {
    this.setLastSyncedAt(new Date())
  }

  syncNeeded(now = new Date()) {
    const last = this.lastSyncedAt()
    return last === null || secondsBetween(now, last) >= SYNC_DEBOUNCE_SECONDS
  }

  secondsUntilSyncAllowed(now = new Date()) {
    const last = this.lastSyncedAt()
    if (last === null) return 0
    return Math.trunc(Math.max(SYNC_DEBOUNCE_SECONDS - secondsBetween(now, last), 0))
  }

  onlyRequestedReviews() {
    const value = this.read(SETTING_KEYS.onlyRequestedReviews)
    if (value === null) return true
    return value === 'true'
  }

  setOnlyRequestedReviews(enabled: boolean) {
    this.write(SETTING_KEYS.onlyRequestedReviews, String(enabled))
  }

  githubLogin() {
    return this.read(SETTING_KEYS.githubLogin)
  }

  setGithubLogin(login: string | null) {
    this.write(SETTING_KEYS.githubLogin, login)
  }

  autoReviewMode() {
    return this.read(SETTING_KEYS.autoReviewMode) === 'true'
  }

  setAutoReviewMode(enabled: boolean) {
    this.write(SETTING_KEYS.autoReviewMode, String(enabled))
  }

  autoReviewDelayMin() {
    return parseDelay(this.read(SETTING_KEYS.autoReviewDelayMin), DEFAULT_AUTO_REVIEW_DELAY_MIN)
  }

  setAutoReviewDelayMin(seconds: number) {
    this.write(SETTING_KEYS.autoReviewDelayMin, String(seconds))
  }

  autoReviewDelayMax() {
    return parseDelay(this.read(SETTING_KEYS.autoReviewDelayMax), DEFAULT_AUTO_REVIEW_DELAY_MAX)
  }

  setAutoReviewDelayMax(seconds: number) {
    this.write(SETTING_KEYS.autoReviewDelayMax, String(seconds))
  }

  // Random whole number of seconds between the configured bounds, inclusive.
  autoReviewDelay(random = Math.random) {
    const lower = Math.min(this.autoReviewDelayMin(), this.autoReviewDelayMax())
    const upper = Math.max(this.autoReviewDelayMin(), this.autoReviewDelayMax())
    return lower + Math.floor(random() * (upper - lower + 1))
  }

  autoSubmitEnabled() {
    return this.read(SETTING_KEYS.autoSubmitEnabled) === 'true'
  }

  setAutoSubmitEnabled(enabled: boolean) {
    this.write(SETTING_KEYS.autoSubmitEnabled, String(enabled))
  }

  themePreference(): ThemePreference | null {
    const value = this.read(SETTING_KEYS.themePreference)
    if (isBlank(value) || !isThemePreference(value)) return null
    return value
  }

  // Ignores invalid values; blank clears the preference.
  setThemePreference(value: string | null) {
    if (isPresent(value) && !isThemePreference(value)) return
    this.write(SETTING_KEYS.themePreference, isPresent(value) ? value : null)
  }
}
