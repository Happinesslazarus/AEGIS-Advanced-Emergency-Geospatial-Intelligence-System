import { createContext, useContext, useState, useEffect, ReactNode } from 'react'

// AEGIS 6-Theme System
// Each theme defines an accent palette + light/dark base

export type ThemeName = 'default' | 'light' | 'midnight' | 'ocean' | 'forest' | 'sunset' | 'rose'

export interface ThemeConfig {
  name: ThemeName
  label: string
  isDark: boolean
  swatch: string       // preview color for the picker
  description: string
}

export const THEMES: ThemeConfig[] = [
  { name: 'default',  label: 'Default',     isDark: true,  swatch: '#1a6df5', description: 'Default dark-blue theme' },
  { name: 'light',    label: 'Light Blue',  isDark: false, swatch: '#338dff', description: 'Clean white with blue accents' },
  { name: 'midnight', label: 'Midnight',    isDark: true,  swatch: '#6366f1', description: 'Deep dark with purple glow' },
  { name: 'ocean',    label: 'Ocean',       isDark: true,  swatch: '#06b6d4', description: 'Dark with cyan/teal tones' },
  { name: 'forest',   label: 'Forest',      isDark: true,  swatch: '#059669', description: 'Dark with emerald green' },
  { name: 'sunset',   label: 'Sunset',      isDark: false, swatch: '#d97706', description: 'Warm light with amber glow' },
  { name: 'rose',     label: 'Rose',        isDark: true,  swatch: '#e11d48', description: 'Dark with rose pink accents' },
]

interface ThemeContextType {
  dark: boolean
  toggle: () => void
  darkMode: boolean
  toggleDarkMode: () => void
  theme: ThemeName
  setTheme: (t: ThemeName) => void
  themeConfig: ThemeConfig
}

const ThemeContext = createContext<ThemeContextType | null>(null)

function resolveTheme(name: string | null): ThemeName {
  if (name && THEMES.some(t => t.name === name)) return name as ThemeName
  // migrate old 'dark' localStorage value → 'default'
  if (name === 'dark') return 'default'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'default' : 'light'
}

export function ThemeProvider({ children }: { children: ReactNode }): JSX.Element {
  const [theme, setThemeState] = useState<ThemeName>(() =>
    resolveTheme(localStorage.getItem('aegis-theme'))
  )

  const config = THEMES.find(t => t.name === theme) || THEMES[0]

  useEffect(() => {
    const el = document.documentElement
    // set dark/light base
    el.classList.toggle('dark', config.isDark)
    // set data-theme for CSS variable selection
    el.setAttribute('data-theme', theme)
    // persist
    localStorage.setItem('aegis-theme', theme)
  }, [theme, config.isDark])

  const setTheme = (t: ThemeName) => setThemeState(t)

  // backward compat: toggle cycles between default (dark) and light
  const toggle = () => setThemeState(prev => {
    const cur = THEMES.find(t => t.name === prev)
    return cur?.isDark ? 'light' : 'default'
  })

  return (
    <ThemeContext.Provider value={{
      dark: config.isDark,
      toggle,
      darkMode: config.isDark,
      toggleDarkMode: toggle,
      theme,
      setTheme,
      themeConfig: config,
    }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextType {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be within ThemeProvider')
  return ctx
}
