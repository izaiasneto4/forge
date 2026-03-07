import { useQueryClient } from '@tanstack/react-query'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react'

import { api } from './api'
import { queryKeys } from './queryKeys'
import type { BootstrapResponse } from './types/api'

type Theme = 'light' | 'dark'

type ThemeContextValue = {
  theme: Theme
  setTheme: (theme: Theme) => Promise<void>
  applyServerPreference: (preference: Theme | null) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function preferredTheme(): Theme {
  if (typeof window === 'undefined') {
    return 'light'
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
}

export function ThemeProvider({ children }: PropsWithChildren) {
  const [theme, setThemeState] = useState<Theme>(() => preferredTheme())
  const queryClient = useQueryClient()

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const applyServerPreference = useCallback((preference: Theme | null) => {
    setThemeState(preference ?? preferredTheme())
  }, [])

  const setTheme = useCallback(async (nextTheme: Theme) => {
    const previous = theme
    setThemeState(nextTheme)

    try {
      const response = await api.patch<{ settings: { theme_preference: Theme | null } }>('/api/v1/settings/theme', { theme_preference: nextTheme })
      queryClient.setQueryData<BootstrapResponse>(queryKeys.bootstrap, (current) => {
        if (!current) return current
        return {
          ...current,
          settings: {
            ...current.settings,
            theme_preference: response.data.settings.theme_preference,
          },
        }
      })
    } catch (error) {
      setThemeState(previous)
      throw error
    }
  }, [queryClient, theme])

  const value = useMemo<ThemeContextValue>(() => ({
    theme,
    setTheme,
    applyServerPreference,
  }), [theme, setTheme, applyServerPreference])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)

  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider')
  }

  return context
}
