/**
 * Collapsible citizen navigation sidebar with desktop, tablet, and mobile modes.
 *
 * Layout behaviour:
 * - Desktop (lg+): fixed sidebar, 220 px wide or collapsed to 60 px icon rail.
 * - Tablet (md-lg): sidebar hidden by default; a small toggle button opens it.
 * - Mobile (<md): only accessible via mobileOpen prop; no persistent sidebar.
 * - Mobile/tablet: slides in as an overlay drawer with backdrop dismiss.
 *
 * Navigation model:
 * - All items declared in NAV_ITEM_CONFIG (public) and CITIZEN_EXTRA_ITEM_CONFIG
 *   (authenticated only).  The citizen-extra list is appended only when the user
 *   is authenticated, keeping the list lean for guests.
 * - guestAccess:false items are rendered but disabled (greyed, lock icon) for
 *   guests so they discover the features while being guided to sign in.
 * - Clicking a locked item is a no-op; an inline "Sign in" link lets the guest
 *   navigate to /citizen/login without a separate prompt.
 *
 * Badges:
 * - alertCount, unreadMessages, communityUnread are mapped to item keys in
 *   getBadge().  Badge dots render on the icon in both expanded and collapsed
 *   modes.
 *
 * - Rendered by AppLayout
 * - Reads auth state from CitizenAuthContext to show/hide items
 * - Calls onNavigate with a SidebarItem when the user picks a section */

import { useState, useEffect } from 'react'
import { Link, useLocation as useRouterLocation } from 'react-router-dom'
import {
  MapPin, FileText, Home, Bell, Users, Activity, Shield,
  BookOpen, Newspaper, ChevronLeft, ChevronRight, Lock,
  AlertTriangle, MessageSquare, ShieldAlert, Settings, User,
  Globe, Heart, X, Sparkles
} from 'lucide-react'
import { useCitizenAuth } from '../../contexts/CitizenAuthContext'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'

export interface SidebarItem {
  key: string
  label: string
  icon: React.ElementType
  path: string
  guestAccess: boolean
  citizenOnly?: boolean
  badge?: number
  color?: string
}

interface SidebarItemConfig extends Omit<SidebarItem, 'label'> {
  labelKey: string
}

/**
 * NAV_ITEM_CONFIG -- core navigation available to all users (guests and citizens).
 *
 * guestAccess:true  items appear and work for unauthenticated guests.
 * guestAccess:false items appear but are disabled with a lock badge; clicking
 * them shows a sign-in prompt rather than navigating.
 * citizenOnly:true  items go into the citizen-account section below the divider.
 * color             Lucide icon colour class; overrides the default gray when active.
 */
const NAV_ITEM_CONFIG: SidebarItemConfig[] = [
  { key: 'home',       labelKey: 'layout.sidebar.home',             icon: Sparkles,      path: '/citizen/dashboard',              guestAccess: false, citizenOnly: true, color: 'text-indigo-500' },
  { key: 'map',        labelKey: 'map.title',                       icon: MapPin,        path: '/citizen',                        guestAccess: true,  color: 'text-blue-500' },
  { key: 'reports',    labelKey: 'reports.title',                   icon: FileText,      path: '/citizen?tab=reports',            guestAccess: true,  color: 'text-orange-500' },
  { key: 'shelters',   labelKey: 'citizenPage.tab.safeZones',       icon: Home,          path: '/citizen?tab=shelters',           guestAccess: true,  color: 'text-green-500' },
  { key: 'alerts',     labelKey: 'citizen.action.alerts',           icon: Bell,          path: '/alerts',                         guestAccess: true,  color: 'text-red-500' },
  { key: 'community',  labelKey: 'layout.sidebar.communitySupport', icon: Users,         path: '/citizen?tab=community',          guestAccess: true,  color: 'text-teal-500' },
  { key: 'risk',       labelKey: 'risk.title',                      icon: Activity,      path: '/citizen/dashboard?tab=risk',     guestAccess: false, citizenOnly: true, color: 'text-rose-500' },
  { key: 'emergency',  labelKey: 'citizenPage.emergencyCard',       icon: Shield,        path: '/citizen/dashboard?tab=emergency', guestAccess: false, citizenOnly: true, color: 'text-amber-500' },
  { key: 'prepare',    labelKey: 'citizen.tab.prepare',             icon: BookOpen,      path: '/citizen/dashboard?tab=prepare',  guestAccess: false, citizenOnly: true, color: 'text-emerald-500' },
  { key: 'news',       labelKey: 'citizen.tab.news',                icon: Newspaper,     path: '/citizen?tab=news',               guestAccess: true,  color: 'text-purple-500' },
]

/**
 * CITIZEN_EXTRA_ITEM_CONFIG -- account-level items shown only when authenticated.
 * Appended to navItems at render time; never shown to guests.
 */
const CITIZEN_EXTRA_ITEM_CONFIG: SidebarItemConfig[] = [
  { key: 'messages',   labelKey: 'citizen.tab.messages',            icon: MessageSquare, path: '/citizen/dashboard?tab=messages', guestAccess: false, citizenOnly: true, color: 'text-sky-500' },
  { key: 'safety',     labelKey: 'layout.sidebar.safetyCheckIn',    icon: ShieldAlert,   path: '/citizen/dashboard?tab=safety',   guestAccess: false, citizenOnly: true, color: 'text-green-600' },
  { key: 'profile',    labelKey: 'layout.sidebar.myProfile',        icon: User,          path: '/citizen/dashboard?tab=profile',  guestAccess: false, citizenOnly: true, color: 'text-indigo-500' },
  { key: 'settings',   labelKey: 'layout.header.settings',          icon: Settings,      path: '/citizen/dashboard?tab=settings', guestAccess: false, citizenOnly: true, color: 'text-gray-500 dark:text-gray-300' },
]

interface SidebarProps {
  collapsed: boolean
  setCollapsed: (v: boolean) => void
  mobileOpen: boolean
  setMobileOpen: (v: boolean) => void
  onNavigate: (item: SidebarItem) => void
  activeKey: string
  alertCount?: number
  unreadMessages?: number
  communityUnread?: number
}

export default function Sidebar({
  collapsed, setCollapsed, mobileOpen, setMobileOpen,
  onNavigate, activeKey, alertCount = 0, unreadMessages = 0, communityUnread = 0,
}: SidebarProps): JSX.Element {
  const { isAuthenticated } = useCitizenAuth()
  const routerLocation = useRouterLocation()
  const lang = useLanguage()

  //localizeItems resolves i18n keys at render time so labels update immediately
  //when the user switches language without a remount.
  const localizeItems = (configs: SidebarItemConfig[]): SidebarItem[] =>
    configs.map(({ labelKey, ...item }) => ({ ...item, label: t(labelKey, lang) }))

  const navItems = localizeItems(NAV_ITEM_CONFIG)
  const citizenExtraItems = localizeItems(CITIZEN_EXTRA_ITEM_CONFIG)
  const items = isAuthenticated ? [...navItems, ...citizenExtraItems] : navItems

  //Close mobile sidebar on route change
  useEffect(() => {
    setMobileOpen(false)
  }, [routerLocation.pathname, routerLocation.search])

  //getBadge maps live badge counts to their corresponding nav key.
  //Only three items carry badges; everything else returns 0.
  const getBadge = (key: string) => {
    if (key === 'alerts' && alertCount > 0) return alertCount
    if (key === 'messages' && unreadMessages > 0) return unreadMessages
    if (key === 'community' && communityUnread > 0) return communityUnread
    return 0
  }

  const renderItem = (item: SidebarItem, onClose?: () => void) => {
    const isActive = activeKey === item.key
    //isLocked: item requires authentication but user is a guest.
    //The button renders (so guests see all features) but is disabled.
    const isLocked = !item.guestAccess && !isAuthenticated
    const badge = getBadge(item.key)
    const Icon = item.icon

    return (
      <button
        key={item.key}
        onClick={() => { if (!isLocked) { onNavigate(item); onClose?.() } }}
        title={collapsed ? item.label : undefined}
        className={`w-full flex items-center gap-3 rounded-xl transition-all duration-200 group relative
          ${collapsed ? 'justify-center px-2 py-2.5 min-h-[44px]' : 'px-3 py-2.5 min-h-[40px]'}
          ${isActive
            ? 'bg-aegis-500/15 dark:bg-aegis-500/20 text-aegis-700 dark:text-aegis-300 font-bold shadow-sm'
            : isLocked
              ? 'text-gray-400 dark:text-gray-300 cursor-default'
              : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-white'
          }`}
        disabled={isLocked}
      >
        <div className="relative flex-shrink-0">
          <Icon className={`w-[18px] h-[18px] transition-colors ${isActive ? (item.color || 'text-aegis-500') : isLocked ? 'text-gray-300 dark:text-gray-300' : 'text-gray-500 dark:text-gray-300 group-hover:text-gray-700 dark:group-hover:text-gray-300 dark:text-gray-300'}`} />
          {isLocked && <Lock className="w-2 h-2 absolute -top-0.5 -right-1 text-gray-400 dark:text-gray-300" />}
          {badge > 0 && (
            <span className="absolute -top-1.5 -right-2 w-4 h-4 bg-red-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center shadow-sm">
              {badge > 9 ? '9+' : badge}
            </span>
          )}
        </div>
        {!collapsed && (
          <>
            <span className="text-xs font-medium flex-1 text-left truncate">{item.label}</span>
            {isLocked && (
              <Link
                to="/citizen/login"
                onClick={e => e.stopPropagation()}
                className="text-[9px] font-bold text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 whitespace-nowrap"
              >
                {t('citizen.auth.signIn', lang)}
              </Link>
            )}
          </>
        )}

        {/* Tooltip for collapsed mode -- CSS group-hover opacity; no JS state needed.
             Also shows lock hint so guests know why the item requires sign-in. */}
        {collapsed && (
          <div className="absolute left-full ml-2 px-2.5 py-1.5 bg-gray-900 dark:bg-gray-700 text-white text-[10px] font-medium rounded-lg shadow-lg whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity z-50">
            {item.label}
            {isLocked && <span className="text-amber-400 ml-1">({t('citizen.auth.signIn', lang)})</span>}
          </div>
        )}
      </button>
    )
  }

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Sidebar header */}
      <div className={`flex items-center ${collapsed ? 'justify-center' : 'justify-between'} px-3 py-3 border-b border-gray-200 dark:border-white/5`}>
        {!collapsed && (
          <span className="text-[10px] font-bold text-gray-500 dark:text-gray-300 uppercase tracking-widest">{t('layout.sidebar.navigation', lang)}</span>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/5 text-gray-500 dark:text-gray-300 hover:text-gray-600 dark:hover:text-gray-300 dark:text-gray-300 transition-colors hidden lg:flex"
          title={collapsed ? t('layout.sidebar.expandSidebar', lang) : t('layout.sidebar.collapseSidebar', lang)}
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {/* Navigation items */}
      <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5">
        {/* Welcome -- always rendered first for authenticated users so the personalised
             dashboard entry is visually separated above the public nav items. */}
        {isAuthenticated && (
          <div className="space-y-0.5 mb-1">
            {items.filter(i => i.key === 'home').map(item => renderItem(item))}
          </div>
        )}

        {/* Main navigation */}
        <div className="space-y-0.5">
          {items.filter(i => !i.citizenOnly && i.key !== 'home').map(item => renderItem(item))}
        </div>

        {/* Citizen-only section (excludes Welcome which is above) */}
        {isAuthenticated && (
          <>
            <div className={`my-3 ${collapsed ? 'mx-2' : 'mx-1'}`}>
              <div className="h-px bg-gray-200 dark:bg-white/5" />
              {!collapsed && (
                <span className="text-[9px] font-bold text-gray-400 dark:text-gray-300 uppercase tracking-widest mt-2 block px-1">{t('layout.sidebar.myAccount', lang)}</span>
              )}
            </div>
            <div className="space-y-0.5">
              {items.filter(i => i.citizenOnly && i.key !== 'home').map(item => renderItem(item))}
            </div>
          </>
        )}

        {/* Guest sign-in CTA -- shown when the user hasn't authenticated yet.
             Only visible in expanded mode; in collapsed mode the lock icons on
             individual items serve as the signal. */}
        {!isAuthenticated && !collapsed && (
          <div className="mt-4 mx-1">
            <Link
              to="/citizen/login"
              className="flex items-center gap-2 px-3 py-3 bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/20 dark:to-orange-950/20 border border-amber-200 dark:border-amber-800/40 rounded-xl text-xs font-bold text-amber-700 dark:text-amber-400 hover:shadow-md transition-all group"
            >
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-amber-400 to-orange-600 flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform">
                <User className="w-3.5 h-3.5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="leading-tight">{t('citizen.auth.signIn', lang)}</p>
                <p className="text-[9px] font-normal text-amber-600 dark:text-amber-500 leading-tight">{t('layout.sidebar.unlockFullFeatures', lang)}</p>
              </div>
              <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" />
            </Link>
          </div>
        )}
      </nav>

      {/* Emergency report button -- prominent bottom CTA visible at all times.
           Creates a synthetic SidebarItem so onNavigate can handle the action
           the same way as a regular nav click without a dedicated route. */}
      <div className={`px-2 pb-3 pt-2 border-t border-gray-200 dark:border-white/5 ${collapsed ? 'px-1.5' : ''}`}>
        <button
          onClick={() => onNavigate({ key: 'report_emergency', label: t('nav.reportEmergency', lang), icon: AlertTriangle, path: '', guestAccess: true })}
          title={collapsed ? t('nav.reportEmergency', lang) : undefined}
          className={`w-full flex items-center justify-center gap-2 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white font-bold rounded-xl shadow-lg shadow-red-600/25 hover:shadow-red-500/40 transition-all hover:scale-[1.02] active:scale-[0.98]
            ${collapsed ? 'px-2 py-2.5' : 'px-4 py-2.5 text-xs'}`}
        >
          <AlertTriangle className="w-4 h-4" />
          {!collapsed && <span>{t('nav.reportEmergency', lang)}</span>}
        </button>
      </div>
    </div>
  )

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={`hidden lg:flex flex-col fixed top-[56px] left-0 bottom-0 bg-white dark:bg-gray-950 border-r border-gray-200 dark:border-white/5 z-30 transition-all duration-300 ease-in-out
          ${collapsed ? 'w-[60px]' : 'w-[220px]'}`}
      >
        {sidebarContent}
      </aside>

      {/* Tablet sidebar toggle button */}
      <button
        onClick={() => setMobileOpen(true)}
        className="hidden md:flex lg:hidden fixed top-[68px] left-3 z-30 w-10 h-10 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg items-center justify-center text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        aria-label={t('layout.sidebar.openNavigation', lang)}
      >
        <ChevronRight className="w-5 h-5" />
      </button>

      {/* Mobile/tablet slide-in drawer overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="absolute top-0 left-0 bottom-0 w-[280px] max-w-[85vw] bg-white dark:bg-gray-950 border-r border-gray-200 dark:border-white/5 shadow-2xl animate-slide-in-left flex flex-col pt-[56px]">
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-white/5">
              <span className="text-xs font-bold text-gray-500 dark:text-gray-300 uppercase tracking-widest">{t('layout.sidebar.menu', lang)}</span>
              <button
                onClick={() => setMobileOpen(false)}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-white/5 text-gray-400 dark:text-gray-300 hover:text-gray-600 transition-colors"
                aria-label={t('layout.sidebar.closeMenu', lang)}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5">
              {/* Home (Dashboard) pinned first for authenticated users, same as desktop */}
              {isAuthenticated && (
                <div className="space-y-0.5 mb-1">
                  {items.filter(i => i.key === 'home').map(item => renderItem(item, () => setMobileOpen(false)))}
                </div>
              )}
              {items.filter(i => !i.citizenOnly && i.key !== 'home').map(item => renderItem(item, () => setMobileOpen(false)))}
              {isAuthenticated && (
                <>
                  <div className="my-3 mx-1">
                    <div className="h-px bg-gray-200 dark:bg-white/5" />
                    <span className="text-[9px] font-bold text-gray-400 dark:text-gray-300 uppercase tracking-widest mt-2 block px-1">{t('layout.sidebar.myAccount', lang)}</span>
                  </div>
                  {items.filter(i => i.citizenOnly && i.key !== 'home').map(item => renderItem(item, () => setMobileOpen(false)))}
                </>
              )}
              {!isAuthenticated && (
                <div className="mt-4 mx-1">
                  <Link
                    to="/citizen/login"
                    className="flex items-center gap-2 px-3 py-3 bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/20 dark:to-orange-950/20 border border-amber-200 dark:border-amber-800/40 rounded-xl text-xs font-bold text-amber-700 dark:text-amber-400 hover:shadow-md transition-all group"
                  >
                    <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-amber-400 to-orange-600 flex items-center justify-center shadow-sm">
                      <User className="w-3.5 h-3.5 text-white" />
                    </div>
                    <div className="flex-1">
                      <p className="leading-tight">{t('citizen.auth.signIn', lang)}</p>
                      <p className="text-[9px] font-normal text-amber-600 dark:text-amber-500">{t('layout.sidebar.unlockFullFeatures', lang)}</p>
                    </div>
                  </Link>
                </div>
              )}
            </nav>
            {/* Emergency button */}
            <div className="px-2 pb-3 pt-2 border-t border-gray-200 dark:border-white/5">
              <button
                onClick={() => { setMobileOpen(false); onNavigate({ key: 'report_emergency', label: t('nav.reportEmergency', lang), icon: AlertTriangle, path: '', guestAccess: true }) }}
                className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white font-bold text-xs rounded-xl py-2.5 shadow-lg shadow-red-600/25 transition-all"
              >
                <AlertTriangle className="w-4 h-4" /> {t('nav.reportEmergency', lang)}
              </button>
            </div>
          </aside>
        </div>
      )}
    </>
  )
}

export { NAV_ITEM_CONFIG, CITIZEN_EXTRA_ITEM_CONFIG }
