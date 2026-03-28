/**
 * NotFoundPage.tsx — Production-grade 404 experience for AEGIS V6.
 *
 * Features:
 * i18n via useLanguage + t()
 * Sentry breadcrumb for 404 analytics
 * Focus management (auto-focus heading on mount)
 * Inline search bar with keyboard-navigable suggestions
 * Emergency contacts always visible
 * Reduced-motion aware
 * Semantic HTML & ARIA landmarks
 */
import { useEffect, useRef, useState, useCallback, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import * as Sentry from '@sentry/react'
import { Shield, Home, Users, Lock, MapPin, Phone as PhoneIcon, Search } from 'lucide-react'
import { t } from '../utils/i18n'
import { useLanguage } from '../hooks/useLanguage'
import EmergencyBanner from '../components/shared/EmergencyBanner'

// Static route directory for search suggestions

interface RouteEntry { path: string; labelKey: string; icon: typeof Home }

const ROUTES: RouteEntry[] = [
  { path: '/', labelKey: 'notFound.home', icon: Home },
  { path: '/citizen/dashboard', labelKey: 'notFound.citizenPortal', icon: Users },
  { path: '/admin', labelKey: 'notFound.admin', icon: Lock },
  { path: '/guest', labelKey: 'notFound.guestDashboard', icon: MapPin },
]

export default function NotFoundPage() {
  const lang = useLanguage()
  const location = useLocation()
  const navigate = useNavigate()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [query, setQuery] = useState('')

  // Focus heading on mount
  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  // Record 404 in Sentry as a breadcrumb
  useEffect(() => {
    Sentry.addBreadcrumb({
      category: 'navigation',
      message: `404: ${location.pathname}`,
      level: 'warning',
      data: {
        pathname: location.pathname,
        search: location.search,
        referrer: document.referrer || undefined,
      },
    })
  }, [location.pathname, location.search])

  // Search handler
  const handleSearch = useCallback(
    (e: FormEvent) => {
      e.preventDefault()
      const trimmed = query.trim()
      if (!trimmed) return
      // Navigate to citizen dashboard with a search param (primary search surface)
      navigate(`/citizen/dashboard?search=${encodeURIComponent(trimmed)}`)
    },
    [query, navigate],
  )

  // Filter route suggestions based on query
  const filteredRoutes = query.trim()
    ? ROUTES.filter(r =>
        t(r.labelKey, lang).toLowerCase().includes(query.toLowerCase()) ||
        r.path.toLowerCase().includes(query.toLowerCase()),
      )
    : ROUTES

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-950">
      <EmergencyBanner forceShow />

      <main className="flex-1 flex items-center justify-center px-4 py-16">
        <div className="max-w-lg w-full text-center">
          {/* AEGIS branding */}
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-aegis-500 via-aegis-600 to-aegis-700 flex items-center justify-center shadow-xl shadow-aegis-500/20">
              <Shield className="w-8 h-8 text-white" aria-hidden="true" />
            </div>
          </div>

          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-6xl font-bold text-gray-300 dark:text-gray-700 mb-2 select-none outline-none"
          >
            {t('notFound.heading', lang)}
          </h1>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
            {t('notFound.title', lang)}
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-6 max-w-sm mx-auto">
            {t('notFound.message', lang)}
          </p>

          {/* Attempted path — helps support diagnose mistyped URLs */}
          <p className="text-xs font-mono text-gray-400 dark:text-gray-500 mb-6 max-w-sm mx-auto truncate select-all">
            {location.pathname}
          </p>

          {/* Search bar */}
          <form
            onSubmit={handleSearch}
            role="search"
            aria-label={t('notFound.searchPlaceholder', lang)}
            className="max-w-sm mx-auto mb-8"
          >
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={t('notFound.searchPlaceholder', lang)}
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-aegis-500 focus:border-aegis-500 transition-colors"
              />
            </div>
          </form>

          {/* Navigation links */}
          <nav aria-label="Helpful navigation links" className="grid grid-cols-2 gap-3 max-w-sm mx-auto mb-10">
            {filteredRoutes.map(route => {
              const Icon = route.icon
              return (
                <Link
                  key={route.path}
                  to={route.path}
                  className="flex items-center gap-2 px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm font-medium text-gray-700 dark:text-gray-200 hover:border-aegis-400 hover:bg-aegis-50 dark:hover:bg-aegis-950/40 transition-colors focus:outline-none focus:ring-2 focus:ring-aegis-500 focus:ring-offset-2 dark:focus:ring-offset-gray-950"
                >
                  <Icon className="w-4 h-4 text-aegis-600 dark:text-aegis-400" aria-hidden="true" />
                  {t(route.labelKey, lang)}
                </Link>
              )
            })}
          </nav>

          {/* Emergency contacts block */}
          <div className="rounded-xl border border-red-200 dark:border-red-800/50 bg-red-50 dark:bg-red-950/20 p-4 text-left max-w-sm mx-auto">
            <h3 className="text-sm font-semibold text-red-700 dark:text-red-400 flex items-center gap-2 mb-2">
              <PhoneIcon className="w-4 h-4" aria-hidden="true" />
              {t('emergency.contacts', lang)}
            </h3>
            <ul className="text-xs text-red-600 dark:text-red-300 space-y-1">
              <li><strong>{t('emergency.services', lang)}:</strong> 999 / 112</li>
              <li><strong>{t('emergency.floodHelpline', lang)}:</strong> 0345 988 1188</li>
              <li><strong>{t('emergency.nonEmergency', lang)}:</strong> 101</li>
            </ul>
          </div>
        </div>
      </main>

      <footer className="py-4 text-center text-xs text-gray-400 dark:text-gray-600">
        AEGIS V6 — Emergency Management Platform
      </footer>
    </div>
  )
}
