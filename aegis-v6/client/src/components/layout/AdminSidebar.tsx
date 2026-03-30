/* AdminSidebar.tsx — Responsive sidebar navigation for the Operator dashboard */

import {
  BarChart3, FileText, Map, Activity, Brain, Navigation, Users,
  History, Clock, Bell, ChevronLeft, ChevronRight,
  X, AlertTriangle, Archive, Zap, ShieldCheck, Radio
} from 'lucide-react'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'

export interface AdminSidebarItem {
  key: string
  label: string
  icon: React.ElementType
  adminOnly?: boolean
  color?: string
}

/* Grouped sidebar sections */
const SECTIONS = (lang: string, isAdmin: boolean): { title: string; items: AdminSidebarItem[] }[] => [
  {
    title: 'Operations',
    items: [
      { key: 'dashboard',    label: t('admin.dashboard', lang),   icon: BarChart3,     color: 'text-blue-500' },
      { key: 'reports',      label: t('admin.allReports', lang),  icon: FileText,      color: 'text-orange-500' },
      { key: 'map',          label: t('admin.liveMap', lang),     icon: Map,           color: 'text-emerald-500' },
      { key: 'alert_send',   label: t('admin.sendAlert', lang),   icon: Bell,          color: 'text-red-500' },
      { key: 'incident_console', label: 'Incident Console',       icon: Radio,         color: 'text-amber-500' },
    ],
  },
  {
    title: 'Intelligence',
    items: [
      { key: 'analytics',    label: t('admin.analytics', lang),   icon: Activity,      color: 'text-violet-500' },
      { key: 'ai_models',    label: t('admin.models', lang),      icon: Brain,         color: 'text-purple-500' },
      { key: 'crowd',        label: 'Crowd Density',              icon: Users,         color: 'text-cyan-500' },
      { key: 'system_health', label: t('admin.systemHealth', lang), icon: Zap,          color: 'text-yellow-500' },
    ],
  },
  {
    title: 'Management',
    items: [
      { key: 'resources',    label: t('admin.resources', lang),   icon: Navigation,    color: 'text-teal-500' },
      ...(isAdmin ? [{ key: 'users', label: t('admin.users', lang), icon: Users, adminOnly: true, color: 'text-indigo-500' } as AdminSidebarItem] : []),
      { key: 'community',    label: t('admin.community', lang),   icon: Users,         color: 'text-teal-400' },
    ],
  },
  {
    title: 'Records',
    items: [
      { key: 'history',      label: t('admin.history', lang),     icon: History,       color: 'text-amber-500' },
      { key: 'audit',        label: t('admin.audit', lang),       icon: Clock,         color: 'text-gray-400 dark:text-gray-300' },
      { key: 'delivery',     label: 'Delivery',                   icon: Archive,       color: 'text-slate-500' },
      ...(isAdmin ? [{ key: 'security', label: 'Security', icon: ShieldCheck, adminOnly: true, color: 'text-red-400' } as AdminSidebarItem] : []),
    ],
  },
]

interface AdminSidebarProps {
  collapsed: boolean
  setCollapsed: (v: boolean) => void
  mobileOpen: boolean
  setMobileOpen: (v: boolean) => void
  activeView: string
  onNavigate: (key: string) => void
  isAdmin: boolean
  badges?: Record<string, number>
}

export default function AdminSidebar({
  collapsed, setCollapsed, mobileOpen, setMobileOpen,
  activeView, onNavigate, isAdmin, badges = {},
}: AdminSidebarProps): JSX.Element {
  const lang = useLanguage()
  const sections = SECTIONS(lang, isAdmin)

  const handleClick = (key: string) => {
    onNavigate(key)
    setMobileOpen(false)
  }

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Collapse toggle — desktop only */}
      <div className="hidden lg:flex items-center justify-end px-2 py-2">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 dark:text-gray-300 hover:text-white transition-all"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {/* Mobile close button */}
      <div className="lg:hidden flex items-center justify-between px-4 py-3 border-b border-white/5">
        <span className="text-sm font-bold text-white">Navigation</span>
        <button onClick={() => setMobileOpen(false)} className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors">
          <X className="w-5 h-5 text-gray-400 dark:text-gray-300" />
        </button>
      </div>

      {/* Nav sections */}
      <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-4 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/5">
        {sections.map(section => (
          <div key={section.title}>
            {!collapsed && (
              <p className="px-3 mb-1.5 text-[9px] font-bold uppercase tracking-[0.15em] text-gray-500 dark:text-gray-300">
                {section.title}
              </p>
            )}
            <div className="space-y-0.5">
              {section.items.map(item => {
                const isActive = activeView === item.key
                const badge = badges[item.key] || 0
                return (
                  <button
                    key={item.key}
                    onClick={() => handleClick(item.key)}
                    title={collapsed ? item.label : undefined}
                    className={`w-full flex items-center gap-3 rounded-xl transition-all duration-200 group relative
                      ${collapsed ? 'justify-center px-2 py-2.5 min-h-[44px]' : 'px-3 py-2.5 min-h-[40px]'}
                      ${isActive
                        ? 'bg-aegis-500/15 text-aegis-400 shadow-sm shadow-aegis-500/10'
                        : 'text-gray-400 dark:text-gray-300 hover:text-white hover:bg-white/5'
                      }
                    `}
                  >
                    {/* Active indicator bar */}
                    {isActive && (
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-aegis-500 shadow-sm shadow-aegis-500/50" />
                    )}

                    <item.icon className={`w-4 h-4 flex-shrink-0 transition-colors ${isActive ? 'text-aegis-400' : item.color || 'text-gray-500 dark:text-gray-300'} ${!isActive ? 'group-hover:text-white' : ''}`} />

                    {!collapsed && (
                      <span className={`text-[11px] font-semibold truncate ${isActive ? 'text-aegis-300' : ''}`}>
                        {item.label}
                      </span>
                    )}

                    {badge > 0 && (
                      <span className={`${collapsed ? 'absolute -top-0.5 -right-0.5' : 'ml-auto'} text-[9px] font-bold text-white bg-red-500 px-1.5 py-0.5 rounded-full leading-none min-w-[18px] text-center shadow-sm shadow-red-500/30 animate-pulse`}>
                        {badge > 99 ? '99+' : badge}
                      </span>
                    )}

                    {/* Tooltip for collapsed mode */}
                    {collapsed && (
                      <span className="absolute left-full ml-3 px-2.5 py-1.5 rounded-lg bg-gray-900 text-white text-[10px] font-semibold whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50 shadow-xl border border-white/10">
                        {item.label}
                        {badge > 0 && <span className="ml-1.5 text-red-400">({badge})</span>}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Quick incident report at bottom */}
      <div className={`px-2 py-3 border-t border-white/5 ${collapsed ? 'flex justify-center' : ''}`}>
        <button
          onClick={() => handleClick('alert_send')}
          title="Send Alert"
          className={`flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white font-bold rounded-xl shadow-lg shadow-red-600/30 hover:shadow-red-500/40 transition-all active:scale-95
            ${collapsed ? 'w-10 h-10 justify-center' : 'w-full px-4 py-2.5 text-xs'}
          `}
        >
          <AlertTriangle className="w-4 h-4" />
          {!collapsed && <span>{t('admin.sendAlert', lang)}</span>}
        </button>
      </div>
    </div>
  )

  return (
    <>
      {/* Desktop Sidebar */}
      <aside
        className={`fixed top-24 left-0 bottom-0 z-30 hidden lg:flex flex-col
          bg-white/98 dark:bg-surface-ultra-dark border-r border-gray-200 dark:border-white/5
          transition-all duration-300
          ${collapsed ? 'w-[60px]' : 'w-[220px]'}
        `}
      >
        {sidebarContent}
      </aside>

      {/* Mobile/Tablet overlay */}
      {mobileOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="fixed top-0 left-0 bottom-0 w-[280px] max-w-[85vw] z-50 lg:hidden bg-surface-ultra-dark border-r border-white/5 animate-slide-in-left shadow-2xl">
            {sidebarContent}
          </aside>
        </>
      )}
    </>
  )
}

