/**
 * File: ThemeSelector.tsx
 *
 * What this file does:
 * Dropdown button to switch between light, dark, and system-default
 * themes. Reads and writes theme preference via ThemeContext so the
 * change is reflected everywhere instantly.
 *
 * How it connects:
 * - Consumes client/src/contexts/ThemeContext.tsx (theme, setTheme)
 * - Embedded in the top nav bar and accessibility panel
 * - Theme preference persisted to localStorage by ThemeContext
 */

import { useState, useRef, useEffect } from 'react'
import { Palette, Check } from 'lucide-react'
import { useTheme, THEMES, type ThemeName } from '../../contexts/ThemeContext'

interface Props {
  /* Show on dark navbar (always-white icon) */
  darkNav?: boolean
  className?: string
}

export default function ThemeSelector({ darkNav, className = '' }: Props) {
  const { theme, setTheme, themeConfig } = useTheme()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  return (
    <div className={`relative ${className}`} ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className={`p-2 rounded-xl transition-all active:scale-95 group ${
          darkNav
            ? 'hover:bg-white/10 text-aegis-50 hover:text-white'
            : 'hover:bg-gray-100 dark:hover:bg-white/10 text-muted dark:text-primary hover:text-primary'
        }`}
        aria-label="Change theme"
        title="Change theme"
      >
        <Palette className="w-4 h-4" style={{ color: themeConfig.swatch }} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-56 bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700/50 overflow-hidden z-50 animate-scale-in">
          {/* Header */}
          <div className="px-4 py-2.5 border-b border-gray-100 dark:border-gray-800">
            <p className="text-[10px] font-bold text-gray-500 dark:text-gray-300 uppercase tracking-widest">Choose Theme</p>
          </div>

          {/* Theme list */}
          <div className="p-1.5 space-y-0.5">
            {THEMES.map((t) => {
              const active = theme === t.name
              return (
                <button
                  key={t.name}
                  onClick={() => { setTheme(t.name as ThemeName); setOpen(false) }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-left group ${
                    active
                      ? 'bg-aegis-50 dark:bg-aegis-950/30'
                      : 'hover:bg-gray-50 dark:hover:bg-white/5'
                  }`}
                >
                  {/* Swatch */}
                  <div
                    className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 shadow-sm transition-transform group-hover:scale-110 ${
                      active ? 'ring-2 ring-aegis-500 ring-offset-2 ring-offset-white dark:ring-offset-gray-900' : ''
                    }`}
                    style={{ background: t.swatch }}
                  >
                    {active && <Check className="w-3.5 h-3.5 text-white drop-shadow-sm" />}
                  </div>

                  {/* Label */}
                  <div className="min-w-0 flex-1">
                    <p className={`text-xs font-semibold truncate ${
                      active ? 'text-aegis-700 dark:text-aegis-300' : 'text-secondary'
                    }`}>
                      {t.label}
                    </p>
                    <p className="text-[10px] text-gray-400 dark:text-gray-300 truncate">{t.description}</p>
                  </div>

                  {/* Dark/Light badge */}
                  <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full flex-shrink-0 ${
                    t.isDark
                      ? 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-300'
                      : 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-600 dark:text-yellow-400'
                  }`}>
                    {t.isDark ? 'Dark' : 'Light'}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Footer */}
          <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-800">
            <p className="text-[9px] text-gray-400 dark:text-gray-400">
              Active: <span className="font-semibold text-gray-500 dark:text-gray-300">{themeConfig.label}</span>
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

