import { Link } from 'react-router-dom'
import { Shield } from 'lucide-react'
import { THEMES, useTheme, type ThemeName } from '../contexts/ThemeContext'
import LanguageSelector from './LanguageSelector'

export function Navbar({ transparent = false }: { transparent?: boolean }) {
  const { dark, theme, setTheme } = useTheme()
  return (
    <nav className={`sticky top-0 z-50 backdrop-blur-2xl border-b ${transparent ? 'bg-white/80 dark:bg-gray-950/80 border-gray-200/60 dark:border-white/5' : 'bg-white/98 dark:bg-gray-950 border-gray-200 dark:border-aegis-500/15 shadow-sm'}`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2.5 group">
          <div className="relative w-9 h-9 rounded-xl bg-gradient-to-br from-aegis-500 to-aegis-700 flex items-center justify-center shadow-lg shadow-aegis-500/30 group-hover:shadow-aegis-400/60 transition-all group-hover:scale-105">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <div className="leading-none hidden sm:block">
            <span className="font-black text-sm text-aegis-600 dark:text-aegis-400 tracking-wide">AEGIS</span>
            <span className="block text-[8px] text-gray-400 dark:text-gray-500 tracking-[0.2em] uppercase">Emergency Intelligence</span>
          </div>
        </Link>
        <div className="flex items-center gap-2">
          <ThemePicker theme={theme} setTheme={setTheme} />
          <LanguageSelector compact />
        </div>
      </div>
    </nav>
  )
}

function ThemePicker({ theme, setTheme }: { theme: ThemeName; setTheme: (t: ThemeName) => void }) {
  return (
    <div className="flex items-center gap-1 bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-lg px-2 py-1.5">
      {THEMES.map(t => (
        <button
          key={t.name}
          onClick={() => setTheme(t.name)}
          className={`w-4 h-4 rounded-full border-2 transition-all ${theme === t.name ? 'border-white dark:border-white scale-110 ring-2 ring-offset-1 ring-aegis-500' : 'border-transparent opacity-60 hover:opacity-100'}`}
          style={{ background: t.swatch }}
          title={t.label}
        />
      ))}
    </div>
  )
}

export function TopNavbar({ onMenuToggle, alertCount = 0 }: { onMenuToggle: () => void; alertCount?: number }) {
  const { theme, setTheme } = useTheme()
  return (
    <nav className="fixed top-0 left-0 right-0 z-40 bg-white/98 dark:bg-gray-950 backdrop-blur-2xl border-b border-gray-200 dark:border-aegis-500/15 shadow-sm">
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-aegis-400/40 to-transparent pointer-events-none" />
      <div className="h-14 flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <button onClick={onMenuToggle} className="lg:hidden w-10 h-10 flex items-center justify-center rounded-xl text-gray-500 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M4 6h16M4 12h16M4 18h16"/></svg>
          </button>
          <Link to="/" className="flex items-center gap-2 group">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-aegis-500 to-aegis-700 flex items-center justify-center shadow-lg shadow-aegis-500/30">
              <Shield className="w-4 h-4 text-white" />
            </div>
            <div className="hidden sm:block">
              <span className="font-black text-sm text-aegis-600 dark:text-aegis-400">AEGIS</span>
              <span className="block text-[8px] text-gray-400 tracking-widest uppercase">Emergency Intelligence</span>
            </div>
          </Link>
          <div className="w-px h-6 bg-gray-200 dark:bg-white/8 hidden sm:block mx-1" />
          <div className="hidden sm:flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-gray-50 dark:bg-white/[0.03] border border-gray-200 dark:border-white/5">
            <span className="text-[10px] font-bold text-gray-500 dark:text-gray-400">Aberdeen & Shire</span>
          </div>
          <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-gray-50 dark:bg-white/[0.03] border border-gray-200 dark:border-white/5">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse ring-2 ring-green-500/30" />
            <span className="text-[10px] font-bold text-green-600 dark:text-green-400">NORMAL</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ThemePicker theme={theme} setTheme={setTheme} />
          <LanguageSelector compact />
          {alertCount > 0 && (
            <div className="relative">
              <div className="w-9 h-9 rounded-lg bg-red-50 dark:bg-red-500/10 flex items-center justify-center">
                <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M15 17h5l-1.41-1.41A2 2 0 0 1 18 14.17V11a6 6 0 1 0-12 0v3.17c0 .53-.21 1.04-.59 1.42L4 17h5m6 0v1a3 3 0 1 1-6 0v-1m6 0H9"/></svg>
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">{alertCount}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </nav>
  )
}
