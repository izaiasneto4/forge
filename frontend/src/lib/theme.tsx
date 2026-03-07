import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react'

import { api } from './api'

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

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const value = useMemo<ThemeContextValue>(() => ({
    theme,
    async setTheme(nextTheme) {
      const previous = theme
      setThemeState(nextTheme)

      try {
        await api.patch('/api/v1/settings/theme', { theme_preference: nextTheme })
      } catch (error) {
        setThemeState(previous)
        throw error
      }
    },
    applyServerPreference(preference) {
      setThemeState(preference ?? preferredTheme())
    },
  }), [theme])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)

  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider')
  }

  return context
}
