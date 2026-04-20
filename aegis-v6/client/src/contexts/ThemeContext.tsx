/**
 * Provides light / dark / system theme state to the entire app.
 * Persists the user's choice in localStorage and applies the
 * "dark" class to the document root element.
 */

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'

//AEGIS 6-Theme System
//Each theme defines an accent palette + light/dark base

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
  //Accept stored theme only if it still exists in the THEMES array.
  //This guards against renamed or removed themes after an app update.
  if (name && THEMES.some(t => t.name === name)) return name as ThemeName
  //Backward-compat: old builds stored 'dark' as a boolean string.
  //Map it to 'default' (our dark blue theme) instead of showing a blank UI.
  if (name === 'dark') return 'default'
  //No saved preference: fall back to the OS-level dark/light setting.
  //window.matchMedia('(prefers-color-scheme: dark)') reads the system theme.
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'default' : 'light'
}

export function ThemeProvider({ children }: { children: ReactNode }): JSX.Element {
  const [theme, setThemeState] = useState<ThemeName>(() =>
    resolveTheme(localStorage.getItem('aegis-theme'))
  )

  const config = THEMES.find(t => t.name === theme) || THEMES[0]

  useEffect(() => {
    //documentElement is the <html> tag -- we apply theme classes here so
    //Tailwind's `dark:` variants and our custom CSS variables work globally.
    const el = document.documentElement
    //classList.toggle(class, force): adds 'dark' when isDark=true, removes it otherwise.
    //Tailwind uses the 'dark' class on <html> to activate dark-mode styles.
    el.classList.toggle('dark', config.isDark)
    //data-theme drives CSS custom-property overrides (--color-accent, --color-bg, etc.)
    //defined in index.css, allowing per-theme color variation independent of dark/light.
    el.setAttribute('data-theme', theme)
    //Persist so the correct theme is loaded on the next page visit.
    localStorage.setItem('aegis-theme', theme)
  }, [theme, config.isDark])

  const setTheme = (t: ThemeName) => setThemeState(t)

  //backward compat: toggle cycles between default (dark) and light
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

const THEME_DEFAULTS: ThemeContextType = {
  dark: false, toggle: () => {}, darkMode: false, toggleDarkMode: () => {},
  theme: 'default', setTheme: () => {}, themeConfig: THEMES[0],
}

export function useTheme(): ThemeContextType {
  const ctx = useContext(ThemeContext)
  if (!ctx) {
    if (import.meta.env.DEV) console.warn('[Theme] Context unavailable -- returning safe defaults.')
    return THEME_DEFAULTS
  }
  return ctx
}
