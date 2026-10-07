import { t } from 'elysia'
import { okSchema } from '../http/envelope'
import { CurrentRepo, ThemePreference } from './ui-payloads'

export { CurrentRepo }

export const Settings = {
  repos_folder: t.Nullable(t.String()),
  current_repo: CurrentRepo,
  default_cli_client: t.String(),
  auto_submit_enabled: t.Boolean(),
  theme_preference: t.Nullable(ThemePreference),
  cli_clients: t.Array(t.String()),
  valid_theme_preferences: t.Array(ThemePreference),
}

export const SettingsResponse = okSchema(Settings)
