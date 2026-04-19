/**
 * Module: AdminNavbar.tsx
 *
 * Admin navbar React component.
 *
 * - Rendered by AdminLayout
 * - Reads alerts from AlertsContext for the notification dropdown
 * - Calls onViewChange to switch the active admin view
import { useState, useRef, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  Shield, Search, AlertTriangle, Bell, LogOut, ChevronDown,
  Menu, Siren, Home, User, ExternalLink, Zap, X, Clock
} from 'lucide-react'
import { useAlerts } from '../../contexts/AlertsContext'
import LanguageDropdown from '../shared/LanguageDropdown'
import ThemeSelector from '../ui/ThemeSelector'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'
import type { Operator } from '../../types'

interface NavItem {
  id: string
  label: string
  icon: React.ElementType
  badge?: number
}

interface AdminNavbarProps {
  user: Operator
  dark: boolean
  urgentCount: number
  notificationCount: number
  communityUnread?: number
  messagingUnread?: number
  searchTerm: string
  setSearchTerm: (v: string) => void
  searchRef: React.RefObject<HTMLInputElement | null>
  onMenuToggle: () => void
  onViewChange: (view: string) => void
  onShowProfile: () => void
  onLogout: () => void
  navItems?: NavItem[]
  activeView?: string
}

/* Isolated live clock — ticks every second without re-rendering the whole navbar */
function LiveClock() {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="hidden xl:flex items-center gap-1.5 bg-gray-100/80 dark:bg-white/5 border border-gray-200/60 dark:border-white/8 px-2.5 py-1 rounded-full" aria-live="polite" aria-label="Current time">
      <Clock className="w-3 h-3 text-gray-400 dark:text-gray-300" />
      <span className="text-[10px] font-mono font-semibold text-gray-600 dark:text-gray-300 tabular-nums tracking-wide">
        {now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
      </span>
    </div>
  )
}

export default function AdminNavbar({
  user, dark, urgentCount, notificationCount,
  communityUnread = 0, messagingUnread = 0,
  searchTerm, setSearchTerm, searchRef,
  onMenuToggle, onViewChange, onShowProfile, onLogout,
  navItems = [], activeView = '',
}: AdminNavbarProps): JSX.Element {
  const lang = useLanguage()
  const { alerts, dismissAllNotifications } = useAlerts()
  const [portalOpen, setPortalOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)
  const portalRef = useRef<HTMLDivElement>(null)
  const notifRef = useRef<HTMLDivElement>(null)
  const mobileSearchRef = useRef<HTMLInputElement>(null)

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (portalRef.current && !portalRef.current.contains(e.target as Node)) setPortalOpen(false)
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Ctrl+K / Cmd+K keyboard shortcut to focus search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        if (window.innerWidth >= 768 && searchRef.current) {
          searchRef.current.focus()
        } else {
          setMobileSearchOpen(true)
          setTimeout(() => mobileSearchRef.current?.focus(), 100)
        }
      }
      if (e.key === 'Escape') {
        setPortalOpen(false)
        setNotifOpen(false)
        setMobileSearchOpen(false)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [searchRef])

  // Auto-focus mobile search when opened
  useEffect(() => {
    if (mobileSearchOpen && mobileSearchRef.current) {
      mobileSearchRef.current.focus()
    }
  }, [mobileSearchOpen])

  // Recent alerts for notification bell
  const recentAlerts = alerts.slice(0, 5)
  const activeAlertCount = alerts.filter(a => a.active).length
  const totalBellCount = activeAlertCount + communityUnread + messagingUnread

  // Bell shake when urgentCount increases
  const [bellShaking, setBellShaking] = useState(false)
  const prevUrgentRef = useRef(urgentCount)
  useEffect(() => {
    if (urgentCount > prevUrgentRef.current) {
      setBellShaking(true)
      setTimeout(() => setBellShaking(false), 700)
    }
    prevUrgentRef.current = urgentCount
  }, [urgentCount])

  // Active view label for breadcrumb
  const activeViewLabel = navItems.find(item => item.id === activeView)?.label || ''

  return (
    <nav role="navigation" aria-label="Main navigation" className="fixed top-0 left-0 right-0 z-[500] bg-white/98 dark:bg-surface-ultra-dark backdrop-blur-2xl border-b border-gray-200 dark:border-aegis-500/15 shadow-md shadow-gray-200/50 dark:shadow-2xl dark:shadow-black/80">
      {/* Accent line */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-aegis-400/60 to-transparent pointer-events-none" />
      <div className="h-14 flex items-center gap-3 px-4">

        {/* LEFT: Hamburger + Logo + Status */}
        <div className="flex items-center gap-2.5 flex-shrink-0">
          {/* Mobile hamburger */}
          <button
            onClick={onMenuToggle}
            aria-label="Toggle navigation menu"
            className="lg:hidden min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
          >
            <Menu className="w-5 h-5 text-gray-600 dark:text-gray-300" />
          </button>

          <Link to="/" className="flex items-center gap-2 group" aria-label="AEGIS Home">
            <div className="relative w-9 h-9 rounded-xl bg-gradient-to-br from-aegis-500 to-aegis-700 flex items-center justify-center shadow-lg shadow-aegis-500/40 group-hover:shadow-aegis-400/60 transition-all group-hover:scale-105">
              <Shield className="w-5 h-5 text-white drop-shadow-sm" />
            </div>
            <div className="hidden sm:block leading-none">
              <span className="font-black text-sm tracking-wide">
                <span className="text-aegis-600 dark:text-aegis-400">AEGIS</span>
              </span>
              <span className="block text-[9px] text-gray-400 dark:text-gray-300 dark:text-aegis-300 tracking-widest uppercase">
                {t('admin.operatorDashboard', lang)}
              </span>
            </div>
          </Link>

          {/* Online status */}
          <div className="hidden md:flex items-center gap-1.5 bg-emerald-500/8 border border-emerald-500/20 px-2.5 py-1 rounded-full">
            <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" aria-hidden="true" />
            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold">{t('admin.online', lang)}</span>
          </div>

          {/* System uptime indicator */}
          <div className="hidden lg:flex items-center gap-1.5 bg-blue-500/8 border border-blue-500/15 px-2.5 py-1 rounded-full">
            <Zap className="w-3 h-3 text-blue-400" aria-hidden="true" />
            <span className="text-[10px] text-blue-600 dark:text-blue-400 font-semibold">{t('layout.adminNavbar.systemsNormal', lang)}</span>
          </div>

          {/* Live clock */}
          <LiveClock />

          {/* Breadcrumb — show current view on larger screens */}
          {activeViewLabel && (
            <div className="hidden 2xl:flex items-center gap-1 text-[10px] text-gray-400 dark:text-gray-400">
              <ChevronDown className="w-3 h-3 -rotate-90" aria-hidden="true" />
              <span className="font-semibold text-gray-600 dark:text-gray-300">{activeViewLabel}</span>
            </div>
          )}
        </div>

        {/* CENTER: Global Search */}
        <div className="flex-1 max-w-xl mx-3 hidden md:block">
          <div className="relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 dark:text-gray-300 group-focus-within:text-aegis-500 dark:group-focus-within:text-aegis-400 transition-colors" />
            <input
              ref={searchRef as React.RefObject<HTMLInputElement>}
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder={t('layout.adminNavbar.searchPlaceholder', lang)}
              onFocus={() => onViewChange('reports')}
              aria-label="Search reports"
              className="w-full pl-9 pr-16 py-2 text-xs bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/8 focus:bg-aegis-50 dark:focus:bg-aegis-500/6 border border-gray-200 dark:border-white/8 focus:border-aegis-500/35 rounded-xl text-primary placeholder-gray-400 dark:placeholder-white/20 focus:outline-none focus:ring-1 focus:ring-aegis-500/25 transition-all"
            />
            <kbd className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] text-gray-400 dark:text-gray-300 bg-gray-200 dark:bg-white/5 border border-gray-300 dark:border-white/8 px-1.5 py-0.5 rounded font-mono hidden lg:inline">⌘K</kbd>
          </div>
        </div>

        {/* RIGHT: Controls */}
        <div className="flex items-center gap-1.5 ml-auto">
          {/* Mobile search toggle */}
          <button
            onClick={() => { setMobileSearchOpen(!mobileSearchOpen); onViewChange('reports') }}
            aria-label="Toggle search"
            className="md:hidden min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
          >
            <Search className="w-4 h-4 text-gray-500 dark:text-gray-300" />
          </button>

          {/* Urgent reports badge */}
          {urgentCount > 0 && (
            <button
              onClick={() => onViewChange('reports')}
              className="hidden sm:flex items-center gap-1.5 bg-red-500/12 hover:bg-red-500/20 border border-red-500/20 px-2.5 py-1 rounded-lg transition-all"
            >
              <Siren className="w-3.5 h-3.5 text-red-400 animate-pulse" />
              <span className="text-[10px] font-bold text-red-600 dark:text-red-300">{urgentCount} {t('common.urgent', lang)}</span>
            </button>
          )}

          {/* Send Alert — always visible, icon-only on small screens */}
          <button
            onClick={() => onViewChange('alert_send')}
            className="flex items-center gap-1.5 bg-red-600 hover:bg-red-500 text-white min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 justify-center sm:justify-start px-2 sm:px-3 py-1.5 rounded-xl text-xs font-bold transition-all shadow-lg shadow-red-600/30 hover:shadow-red-500/40 active:scale-95"
            title={t('admin.sendAlert', lang)}
            aria-label={t('admin.sendAlert', lang)}
          >
            <AlertTriangle className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
            <span className="hidden sm:inline">{t('admin.sendAlert', lang)}</span>
          </button>

          {/* Notification Bell */}
          <div ref={notifRef} className="relative">
            <button
              onClick={() => setNotifOpen(!notifOpen)}
              aria-label={`Notifications${totalBellCount > 0 ? ` (${totalBellCount} new)` : ''}`}
              aria-expanded={notifOpen}
              className="relative min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl bg-gray-100 dark:bg-white/5 hover:bg-aegis-50 dark:hover:bg-aegis-500/10 border border-gray-200 dark:border-white/8 hover:border-aegis-500/25 transition-all"
            >
              <Bell className={`w-4 h-4 text-gray-500 dark:text-gray-300 ${bellShaking ? 'bell-shake' : ''}`} />
              {totalBellCount > 0 && (
                <span className="absolute -top-1 -right-1 w-4.5 h-4.5 bg-red-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center shadow-sm shadow-red-500/40 animate-pulse">
                  {totalBellCount > 9 ? '9+' : totalBellCount}
                </span>
              )}
            </button>

            {/* Notification dropdown */}
            {notifOpen && (
              <div className="absolute right-0 top-12 w-80 max-w-[calc(100vw-1.5rem)] bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700/60 overflow-hidden z-50">
                <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
                  <span className="text-xs font-bold text-gray-900 dark:text-white">{t('layout.header.notifications', lang)}</span>
                  <button
                    onClick={() => { dismissAllNotifications(); setNotifOpen(false) }}
                    className="text-[10px] font-semibold text-aegis-600 dark:text-aegis-400 hover:underline"
                  >
                    Mark all read
                  </button>
                </div>
                <div className="max-h-64 overflow-y-auto">
                  {/* Community chat unread */}
                  {communityUnread > 0 && (
                    <button
                      onClick={() => { setNotifOpen(false); onViewChange('community') }}
                      className="w-full px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors border-b border-gray-50 dark:border-gray-800/50"
                    >
                      <div className="flex items-start gap-2.5">
                        <span className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0 bg-teal-500" />
                        <div className="min-w-0">
                          <p className="text-[11px] font-semibold text-gray-900 dark:text-white">{t('community.title', lang)}</p>
                          <p className="text-[10px] text-gray-500 dark:text-gray-300 mt-0.5">{communityUnread} {t(communityUnread === 1 ? 'layout.adminNavbar.newMessage' : 'layout.adminNavbar.newMessages', lang)}</p>
                        </div>
                      </div>
                    </button>
                  )}
                  {/* Messaging unread */}
                  {messagingUnread > 0 && (
                    <button
                      onClick={() => { setNotifOpen(false); onViewChange('messaging') }}
                      className="w-full px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors border-b border-gray-50 dark:border-gray-800/50"
                    >
                      <div className="flex items-start gap-2.5">
                        <span className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0 bg-sky-500" />
                        <div className="min-w-0">
                          <p className="text-[11px] font-semibold text-gray-900 dark:text-white">{t('layout.adminNavbar.directMessages', lang)}</p>
                          <p className="text-[10px] text-gray-500 dark:text-gray-300 mt-0.5">{messagingUnread} {t(messagingUnread === 1 ? 'layout.adminNavbar.unreadConversation' : 'layout.adminNavbar.unreadConversations', lang)}</p>
                        </div>
                      </div>
                    </button>
                  )}
                  {/* Weather/emergency alerts */}
                  {recentAlerts.length === 0 && communityUnread === 0 && messagingUnread === 0 ? (
                    <div className="px-4 py-6 text-center text-xs text-gray-500 dark:text-gray-300">{t('layout.adminNavbar.noRecentNotifications', lang)}</div>
                  ) : (
                    recentAlerts.map(alert => (
                      <button
                        key={alert.id}
                        onClick={() => { setNotifOpen(false); onViewChange('alert_send') }}
                        className="w-full px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors border-b border-gray-50 dark:border-gray-800/50 last:border-0"
                      >
                        <div className="flex items-start gap-2.5">
                          <span className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
                            alert.severity === 'critical' ? 'bg-red-500' :
                            alert.severity === 'high' ? 'bg-orange-500' :
                            alert.severity === 'medium' ? 'bg-yellow-500' : 'bg-blue-500'
                          }`} />
                          <div className="min-w-0">
                            <p className="text-[11px] font-semibold text-gray-900 dark:text-white truncate">{alert.title}</p>
                            <p className="text-[10px] text-gray-500 dark:text-gray-300 mt-0.5">{alert.displayTime}</p>
                          </div>
                        </div>
                      </button>
                    ))
                  )}
                </div>
                <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-800">
                  <button
                    onClick={() => { setNotifOpen(false); onViewChange('alert_send') }}
                    className="w-full text-[10px] font-semibold text-aegis-600 dark:text-aegis-400 hover:underline text-center py-1"
                  >
                    {t('layout.adminNavbar.viewAllAlerts', lang)}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Theme + Language */}
          <ThemeSelector darkNav={dark} />
          <LanguageDropdown darkNav={dark} />

          {/* Profile */}
          <button
            onClick={onShowProfile}
            aria-label={`Profile: ${user.displayName}`}
            className="flex items-center gap-2 bg-gray-100 dark:bg-white/5 hover:bg-aegis-50 dark:hover:bg-aegis-500/10 border border-gray-200 dark:border-white/8 hover:border-aegis-500/25 px-2.5 py-1.5 rounded-xl text-xs transition-all group"
          >
            {user.avatarUrl ? (
              <img src={user.avatarUrl} alt="" className="w-6 h-6 rounded-full object-cover ring-2 ring-aegis-500/40 group-hover:ring-aegis-400/70 transition-all" />
            ) : (
              <div className="w-6 h-6 rounded-full bg-gradient-to-br from-aegis-500 to-aegis-700 flex items-center justify-center text-white text-[10px] font-extrabold ring-1 ring-aegis-400/30">
                {user.displayName?.charAt(0) || 'A'}
              </div>
            )}
            <span className="hidden lg:inline truncate max-w-[100px] font-medium text-muted group-hover:text-primary transition-colors">
              {user.displayName}
            </span>
            <ChevronDown className="w-3 h-3 text-gray-400 dark:text-gray-300 group-hover:text-aegis-500 transition-all" />
          </button>

          {/* Portal Switch — second to last */}
          <div ref={portalRef} className="relative hidden md:block">
            <button
              onClick={() => setPortalOpen(!portalOpen)}
              className="flex items-center gap-1.5 bg-gray-100 dark:bg-white/5 hover:bg-aegis-50 dark:hover:bg-aegis-500/10 border border-gray-200 dark:border-white/8 hover:border-aegis-500/25 px-2.5 py-1.5 rounded-xl text-xs transition-all"
            >
              <ExternalLink className="w-3 h-3 text-gray-500 dark:text-gray-300" />
              <span className="text-[10px] font-medium text-gray-500 dark:text-gray-300 hidden lg:inline">{t('layout.adminNavbar.portals', lang)}</span>
              <ChevronDown className={`w-3 h-3 text-gray-400 dark:text-gray-300 transition-transform ${portalOpen ? 'rotate-180' : ''}`} />
            </button>

            {portalOpen && (
              <div className="absolute right-0 top-10 w-52 bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700/60 overflow-hidden z-50">
                <Link
                  to="/citizen"
                  onClick={() => setPortalOpen(false)}
                  className="flex items-center gap-2.5 px-4 py-2.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                >
                  <Home className="w-3.5 h-3.5 text-green-500" />
                  <div>
                    <p className="font-semibold text-gray-900 dark:text-white">{t('layout.portals.guestPortal', lang)}</p>
                    <p className="text-[9px] text-gray-500 dark:text-gray-300">{t('layout.portals.guestPortalDescription', lang)}</p>
                  </div>
                </Link>
                <Link
                  to="/citizen/dashboard"
                  onClick={() => setPortalOpen(false)}
                  className="flex items-center gap-2.5 px-4 py-2.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors border-t border-gray-100 dark:border-gray-800/50"
                >
                  <User className="w-3.5 h-3.5 text-blue-500" />
                  <div>
                    <p className="font-semibold text-gray-900 dark:text-white">{t('citizen.auth.citizenPortal', lang)}</p>
                    <p className="text-[9px] text-gray-500 dark:text-gray-300">{t('layout.portals.citizenPortalDescription', lang)}</p>
                  </div>
                </Link>
                <div className="flex items-center gap-2.5 px-4 py-2.5 text-xs bg-aegis-50 dark:bg-aegis-500/10 border-t border-gray-100 dark:border-gray-800/50">
                  <Shield className="w-3.5 h-3.5 text-aegis-500" />
                  <div>
                    <p className="font-semibold text-aegis-700 dark:text-aegis-300">{t('layout.portals.operatorPortal', lang)}</p>
                    <p className="text-[9px] text-aegis-500/70">{t('layout.portals.currentlyActive', lang)}</p>
                  </div>
                </div>
                <button
                  onClick={() => { setPortalOpen(false); onLogout() }}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs hover:bg-red-50 dark:hover:bg-red-900/20 border-t border-gray-100 dark:border-gray-800/50 transition-colors group"
                >
                  <LogOut className="w-3.5 h-3.5 text-red-500 group-hover:text-red-600" />
                  <p className="font-semibold text-red-600 dark:text-red-400">{t('auth.logout', lang)}</p>
                </button>
              </div>
            )}
          </div>

        </div>
      </div>

      {/* SECOND ROW: Scrollable view tabs */}
      {navItems.length > 0 && (
        <div className="h-10 flex items-center border-t border-gray-200 dark:border-white/5 bg-gray-50/80 dark:bg-surface-ultra-dark/80">
          <div className="flex items-center overflow-x-auto scrollbar-none gap-0.5 px-3">
            {navItems.map(item => {
              const isActive = activeView === item.id
              const Icon = item.icon
              return (
                <button
                  key={item.id}
                  onClick={() => onViewChange(item.id)}
                  className={`relative flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-semibold whitespace-nowrap transition-all flex-shrink-0 min-h-[36px]
                    ${
                      isActive
                        ? 'text-aegis-600 dark:text-aegis-400 bg-aegis-50 dark:bg-aegis-500/10'
                        : 'text-gray-500 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5'
                    }
                  `}
                >
                  <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                  {item.label}
                  {(item.badge ?? 0) > 0 && (
                    <span className="ml-0.5 bg-red-500 text-white text-[8px] font-bold px-1.5 py-0.5 rounded-full leading-none min-w-[16px] text-center">
                      {(item.badge ?? 0) > 99 ? '99+' : item.badge}
                    </span>
                  )}
                  {isActive && (
                    <span className="absolute bottom-0.5 left-2 right-2 h-[2px] bg-aegis-500 rounded-full" />
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Mobile search overlay */}
      {mobileSearchOpen && (
        <div className="md:hidden absolute top-14 left-0 right-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700/60 px-4 py-3 shadow-lg z-50">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 dark:text-gray-300" aria-hidden="true" />
            <input
              ref={mobileSearchRef}
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder={t('layout.adminNavbar.searchPlaceholder', lang)}
              aria-label="Search reports"
              className="w-full pl-9 pr-10 py-2.5 text-sm bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/8 focus:border-aegis-500/35 rounded-xl text-primary placeholder-gray-400 dark:placeholder-white/20 focus:outline-none focus:ring-1 focus:ring-aegis-500/25 transition-all"
            />
            <button
              onClick={() => setMobileSearchOpen(false)}
              aria-label="Close search"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-lg hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
            >
              <X className="w-4 h-4 text-gray-400" />
            </button>
          </div>
        </div>
      )}
    </nav>
  )
}

