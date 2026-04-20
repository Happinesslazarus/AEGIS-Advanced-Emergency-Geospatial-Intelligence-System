/**
 * Top navbar React component.
 *
 * - Rendered by AppLayout
 * - Reads auth state from CitizenAuthContext
 * - Reads alerts from AlertsContext to derive risk level
 * - Uses LocationContext for the active region
 */
import { useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  Shield, Menu, LogOut, User, Settings as SettingsIcon,
  ChevronDown, Bell, Home
} from 'lucide-react'
import { useCitizenAuth } from '../../contexts/CitizenAuthContext'
import { useLocation } from '../../contexts/LocationContext'
import { useAlerts } from '../../contexts/AlertsContext'
import { useTheme } from '../../contexts/ThemeContext'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'
import LanguageSelector from '../shared/LanguageSelector'
import ThemeSelector from '../ui/ThemeSelector'
import LocationDropdown from '../shared/LocationDropdown'

interface TopNavbarProps {
  onMenuToggle: () => void
  alertCount?: number
  communityUnread?: number
  unreadMessages?: number
}

export default function TopNavbar({ onMenuToggle, alertCount = 0, communityUnread = 0, unreadMessages = 0 }: TopNavbarProps): JSX.Element {
  const { isAuthenticated, user, logout } = useCitizenAuth()
  const { activeLocation } = useLocation()
  const { alerts } = useAlerts()
  const { dark } = useTheme()
  const lang = useLanguage()
  const [loginDropdownOpen, setLoginDropdownOpen] = useState(false)
  const [userDropdownOpen, setUserDropdownOpen] = useState(false)
  const [bellOpen, setBellOpen] = useState(false)
  const loginRef = useRef<HTMLDivElement>(null)
  const userRef = useRef<HTMLDivElement>(null)
  const bellRef = useRef<HTMLDivElement>(null)

  // Derive risk level from alerts
  const riskLevel = (() => {
    const critCount = alerts.filter(a => a.severity === 'critical' || a.severity === 'high').length
    const warnCount = alerts.filter(a => a.severity === 'medium').length
    if (critCount > 0) return { label: t('layout.topNavbar.riskElevated', lang), color: 'bg-red-500', textColor: 'text-red-600 dark:text-red-400', ring: 'ring-red-500/30' }
    if (warnCount > 0) return { label: t('risk.moderate', lang), color: 'bg-amber-500', textColor: 'text-amber-600 dark:text-amber-400', ring: 'ring-amber-500/30' }
    return { label: t('layout.topNavbar.riskNormal', lang), color: 'bg-green-500', textColor: 'text-green-600 dark:text-green-400', ring: 'ring-green-500/30' }
  })()

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (loginRef.current && !loginRef.current.contains(e.target as Node)) setLoginDropdownOpen(false)
      if (userRef.current && !userRef.current.contains(e.target as Node)) setUserDropdownOpen(false)
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setBellOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <nav className="fixed top-0 left-0 right-0 z-40 bg-white/98 dark:bg-gray-950 backdrop-blur-2xl border-b border-gray-200 dark:border-aegis-500/15 shadow-sm dark:shadow-2xl dark:shadow-black/70">
      {/* Gold accent line */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-aegis-400/40 dark:via-aegis-400/60 to-transparent pointer-events-none" />

      <div className="h-14 flex items-center justify-between px-3 sm:px-4">
        {/* LEFT: Hamburger (mobile/tablet) + Logo + Region */}
        <div className="flex items-center gap-2">
          {/* Hamburger for mobile/tablet */}
          <button
            onClick={onMenuToggle}
            className="lg:hidden min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-gray-500 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5 hover:text-gray-700 dark:hover:text-white transition-colors"
            aria-label={t('layout.topNavbar.toggleNavigation', lang)}
          >
            <Menu className="w-5 h-5" />
          </button>

          {/* Logo */}
          <Link to="/" className="flex items-center gap-2 group">
            <div className="relative w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-gradient-to-br from-aegis-500 to-aegis-700 flex items-center justify-center shadow-lg shadow-aegis-500/30 group-hover:shadow-aegis-400/60 transition-all group-hover:scale-105">
              <Shield className="w-4 h-4 sm:w-5 sm:h-5 text-white drop-shadow-sm" />
            </div>
            <div className="hidden sm:block">
              <span className="font-black text-sm block leading-tight text-aegis-600 dark:text-aegis-400 tracking-wide">{t('app.title', lang)}</span>
              <span className="text-[8px] text-gray-400 dark:text-gray-300 dark:text-aegis-300 leading-none tracking-widest uppercase">{t('app.subtitle', lang)}</span>
            </div>
          </Link>

          {/* Divider */}
          <div className="w-px h-6 bg-gray-200 dark:bg-white/8 hidden sm:block mx-1" />

          {/* Region selector — shared dropdown */}
          <LocationDropdown compact className="hidden sm:block" />

          {/* System status indicator */}
          <div className="hidden md:flex items-center gap-1.5 ml-1 px-2.5 py-1.5 rounded-lg bg-gray-50 dark:bg-white/[0.03] border border-gray-200 dark:border-white/5">
            <span className={`w-2 h-2 rounded-full ${riskLevel.color} animate-pulse ring-2 ${riskLevel.ring}`} />
            <span className={`text-[10px] font-bold ${riskLevel.textColor}`}>{riskLevel.label}</span>
          </div>
        </div>

        {/* RIGHT: Language + Theme + Login/User */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* System status on mobile - compact */}
          <div className="flex md:hidden items-center gap-1 px-2 py-1.5 rounded-lg bg-gray-50 dark:bg-white/[0.03] border border-gray-200 dark:border-white/5">
            <span className={`w-2 h-2 rounded-full ${riskLevel.color} animate-pulse`} />
            <span className={`text-[10px] font-bold ${riskLevel.textColor}`}>{riskLevel.label}</span>
          </div>

          <LanguageSelector darkNav={dark} />
          <ThemeSelector darkNav={dark} />

          {/* Notifications bell — dropdown */}
          {(() => {
            const totalBell = alertCount + communityUnread + unreadMessages
            const recentAlerts = alerts.filter(a => a.active).slice(0, 5)
            return (
              <div ref={bellRef} className="relative">
                <button
                  onClick={() => setBellOpen(o => !o)}
                  className="relative p-2 rounded-xl text-gray-500 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5 hover:text-gray-700 dark:hover:text-white transition-colors"
                  aria-label={totalBell > 0 ? `${totalBell} alert${totalBell !== 1 ? 's' : ''}` : 'Alerts'}
                  aria-expanded={bellOpen}
                >
                  <Bell className="w-4 h-4" aria-hidden="true" />
                  {totalBell > 0 && (
                    <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center animate-pulse">
                      {totalBell > 9 ? '9+' : totalBell}
                    </span>
                  )}
                </button>

                {bellOpen && (
                  <div className="absolute right-0 top-12 w-80 max-w-[calc(100vw-1.5rem)] bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700/60 overflow-hidden z-50 animate-fade-in">
                    <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
                      <span className="text-xs font-bold text-gray-900 dark:text-white">Active Alerts</span>
                      <span className="text-[10px] text-gray-500 dark:text-gray-400">{recentAlerts.length} active</span>
                    </div>
                    <div className="max-h-72 overflow-y-auto">
                      {recentAlerts.length === 0 ? (
                        <div className="px-4 py-6 text-center text-xs text-gray-500 dark:text-gray-400">No active alerts</div>
                      ) : (
                        recentAlerts.map(alert => (
                          <div
                            key={alert.id}
                            className="px-4 py-3 border-b border-gray-50 dark:border-gray-800/50 last:border-0"
                          >
                            <div className="flex items-start gap-2.5">
                              <span className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
                                alert.severity === 'critical' ? 'bg-red-500 animate-pulse' :
                                alert.severity === 'high' ? 'bg-orange-500' :
                                alert.severity === 'medium' ? 'bg-yellow-500' : 'bg-blue-500'
                              }`} />
                              <div className="min-w-0">
                                <p className="text-[11px] font-semibold text-gray-900 dark:text-white truncate">{alert.title}</p>
                                <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">{alert.displayTime}</p>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                    <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-800">
                      <Link
                        to="/alerts"
                        onClick={() => setBellOpen(false)}
                        className="w-full block text-[10px] font-semibold text-aegis-600 dark:text-aegis-400 hover:underline text-center py-1"
                      >
                        View all alerts
                      </Link>
                    </div>
                  </div>
                )}
              </div>
            )
          })()}

          {/* Not authenticated: Login dropdown */}
          {!isAuthenticated && (
            <div className="relative" ref={loginRef}>
              <button
                onClick={() => setLoginDropdownOpen(!loginDropdownOpen)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-400 text-black shadow-lg shadow-amber-500/30 hover:shadow-amber-400/50 transition-all hover:scale-[1.02] active:scale-[0.97]"
              >
                <User className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{t('auth.login', lang)}</span>
                <ChevronDown className={`w-3 h-3 transition-transform ${loginDropdownOpen ? 'rotate-180' : ''}`} />
              </button>

              {loginDropdownOpen && (
                <div className="absolute right-0 mt-2 w-52 max-w-[calc(100vw-1.5rem)] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl py-1.5 animate-fade-in z-50">
                  <Link
                    to="/"
                    onClick={() => setLoginDropdownOpen(false)}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
                  >
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-gray-400 to-gray-600 flex items-center justify-center shadow-sm">
                      <Home className="w-4 h-4 text-white" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-gray-900 dark:text-white">Home</p>
                      <p className="text-[10px] text-gray-500 dark:text-gray-300">Landing page</p>
                    </div>
                  </Link>
                  <div className="mx-3 my-1 h-px bg-gray-100 dark:bg-gray-800" />
                  <Link
                    to="/citizen/login"
                    onClick={() => setLoginDropdownOpen(false)}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
                  >
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-aegis-500 to-aegis-700 flex items-center justify-center shadow-sm">
                      <User className="w-4 h-4 text-white" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-gray-900 dark:text-white">{t('citizen.auth.citizenPortal', lang)}</p>
                      <p className="text-[10px] text-gray-500 dark:text-gray-300">{t('layout.portals.citizenPortalDescription', lang)}</p>
                    </div>
                  </Link>
                  <div className="mx-3 my-1 h-px bg-gray-100 dark:bg-gray-800" />
                  <Link
                    to="/admin"
                    onClick={() => setLoginDropdownOpen(false)}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
                  >
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-indigo-700 flex items-center justify-center shadow-sm">
                      <Shield className="w-4 h-4 text-white" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-gray-900 dark:text-white">{t('layout.portals.operatorPortal', lang)}</p>
                      <p className="text-[10px] text-gray-500 dark:text-gray-300">{t('layout.portals.operatorPortalDescription', lang)}</p>
                    </div>
                  </Link>
                </div>
              )}
            </div>
          )}

          {/* Authenticated: User dropdown */}
          {isAuthenticated && user && (
            <div className="relative" ref={userRef}>
              <button
                onClick={() => setUserDropdownOpen(!userDropdownOpen)}
                className="flex items-center gap-2 px-2 py-1.5 rounded-xl hover:bg-gray-100 dark:hover:bg-white/5 transition-colors border border-transparent hover:border-gray-200 dark:hover:border-white/10"
              >
                {user.avatarUrl ? (
                  <img src={user.avatarUrl} alt="" className="w-7 h-7 rounded-lg object-cover" />
                ) : (
                  <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-aegis-500 to-aegis-700 flex items-center justify-center">
                    <span className="text-[10px] font-bold text-white">{(user.displayName || user.email || '?')[0].toUpperCase()}</span>
                  </div>
                )}
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300 hidden sm:block max-w-[100px] truncate">{user.displayName || t('layout.topNavbar.citizenFallback', lang)}</span>
                <ChevronDown className={`w-3 h-3 text-gray-500 dark:text-gray-300 transition-transform ${userDropdownOpen ? 'rotate-180' : ''}`} />
              </button>

              {userDropdownOpen && (
                <div className="absolute right-0 mt-2 w-52 max-w-[calc(100vw-1.5rem)] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl py-1.5 animate-fade-in z-50">
                  <div className="px-4 py-2.5 border-b border-gray-100 dark:border-gray-800">
                    <p className="text-xs font-bold text-gray-900 dark:text-white truncate">{user.displayName || t('layout.topNavbar.citizenFallback', lang)}</p>
                    <p className="text-[10px] text-gray-500 dark:text-gray-300 truncate">{user.email}</p>
                  </div>
                  <Link
                    to="/citizen/dashboard?tab=profile"
                    onClick={() => setUserDropdownOpen(false)}
                    className="flex items-center gap-2.5 px-4 py-2.5 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
                  >
                    <User className="w-4 h-4" /> {t('layout.header.profile', lang)}
                  </Link>
                  <Link
                    to="/citizen/dashboard?tab=settings"
                    onClick={() => setUserDropdownOpen(false)}
                    className="flex items-center gap-2.5 px-4 py-2.5 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
                  >
                    <SettingsIcon className="w-4 h-4" /> {t('layout.header.settings', lang)}
                  </Link>
                  <div className="mx-3 my-1 h-px bg-gray-100 dark:bg-gray-800" />
                  <button
                    onClick={() => { setUserDropdownOpen(false); logout() }}
                    className="flex items-center gap-2.5 px-4 py-2.5 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors w-full text-left"
                  >
                    <LogOut className="w-4 h-4" /> {t('auth.logout', lang)}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </nav>
  )
}

