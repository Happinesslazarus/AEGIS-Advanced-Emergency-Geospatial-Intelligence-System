import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
interface ThemeContextType { dark: boolean; toggle: () => void; darkMode: boolean; toggleDarkMode: () => void }
const ThemeContext = createContext<ThemeContextType | null>(null)
export function ThemeProvider({ children }: { children: ReactNode }): JSX.Element {
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    const s = localStorage.getItem('aegis-theme')
    if (s) return s === 'dark'
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode)
    localStorage.setItem('aegis-theme', darkMode ? 'dark' : 'light')
  }, [darkMode])
  const toggleFn = () => setDarkMode(p => !p)
  return <ThemeContext.Provider value={{ dark: darkMode, toggle: toggleFn, darkMode, toggleDarkMode: toggleFn }}>{children}</ThemeContext.Provider>
}
export function useTheme(): ThemeContextType {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be within ThemeProvider')
  return ctx
}
