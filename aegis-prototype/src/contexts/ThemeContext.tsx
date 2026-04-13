import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

export type ThemeName = 'default' | 'light' | 'midnight' | 'ocean' | 'forest' | 'sunset' | 'rose'

export interface ThemeConfig {
  name: ThemeName; label: string; isDark: boolean; swatch: string
}

export const THEMES: ThemeConfig[] = [
  { name: 'default',  label: 'Default',    isDark: true,  swatch: '#1a6df5' },
  { name: 'light',    label: 'Light Blue', isDark: false, swatch: '#338dff' },
  { name: 'midnight', label: 'Midnight',   isDark: true,  swatch: '#6366f1' },
  { name: 'ocean',    label: 'Ocean',      isDark: true,  swatch: '#06b6d4' },
  { name: 'forest',   label: 'Forest',     isDark: true,  swatch: '#059669' },
  { name: 'sunset',   label: 'Sunset',     isDark: false, swatch: '#d97706' },
  { name: 'rose',     label: 'Rose',       isDark: true,  swatch: '#e11d48' },
]

interface ThemeContextType {
  dark: boolean; theme: ThemeName; setTheme: (t: ThemeName) => void; toggle: () => void
}

const ThemeContext = createContext<ThemeContextType>({ dark: true, theme: 'default', setTheme: () => {}, toggle: () => {} })

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeName>(() => {
    const saved = localStorage.getItem('aegis-proto-theme')
    return (saved && THEMES.some(t => t.name === saved) ? saved : 'default') as ThemeName
  })
  const config = THEMES.find(t => t.name === theme) || THEMES[0]

  useEffect(() => {
    document.documentElement.classList.toggle('dark', config.isDark)
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('aegis-proto-theme', theme)
  }, [theme, config.isDark])

  const toggle = () => setTheme(prev => THEMES.find(t => t.name === prev)?.isDark ? 'light' : 'default')

  return (
    <ThemeContext.Provider value={{ dark: config.isDark, theme, setTheme, toggle }}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => useContext(ThemeContext)
