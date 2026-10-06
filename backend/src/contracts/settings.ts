import { t } from 'elysia'
import { okSchema } from '../http/envelope'

const ThemePreference = t.Union([t.Literal('light'), t.Literal('dark')])

export const CurrentRepo = t.Object({
  path: t.Nullable(t.String()),
  slug: t.Nullable(t.String()),
  name: t.Nullable(t.String()),
})

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
