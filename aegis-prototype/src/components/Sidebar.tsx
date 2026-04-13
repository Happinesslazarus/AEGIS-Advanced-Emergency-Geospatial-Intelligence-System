import { useState } from 'react'
import {
  MapPin, FileText, Home, Bell, Users, Activity, Shield,
  BookOpen, Newspaper, ChevronLeft, ChevronRight, Lock,
  MessageSquare, ShieldAlert, Settings, User, Sparkles, X,
  BarChart3, Map, Brain, Navigation, History, Clock, Archive, Radio
} from 'lucide-react'

interface SidebarItem { key: string; label: string; icon: React.ElementType; color?: string; locked?: boolean; badge?: number }

const CITIZEN_NAV: SidebarItem[] = [
  { key: 'home', label: 'Dashboard', icon: Sparkles, color: 'text-indigo-500' },
  { key: 'map', label: 'Live Map', icon: MapPin, color: 'text-blue-500' },
  { key: 'reports', label: 'Reports', icon: FileText, color: 'text-orange-500' },
  { key: 'shelters', label: 'Safe Zones', icon: Home, color: 'text-green-500' },
  { key: 'alerts', label: 'Alerts', icon: Bell, color: 'text-red-500', badge: 3 },
  { key: 'community', label: 'Community', icon: Users, color: 'text-teal-500' },
  { key: 'risk', label: 'Risk Assessment', icon: Activity, color: 'text-rose-500' },
  { key: 'emergency', label: 'Emergency Kit', icon: Shield, color: 'text-amber-500' },
  { key: 'prepare', label: 'Prepare', icon: BookOpen, color: 'text-emerald-500' },
  { key: 'news', label: 'News Feed', icon: Newspaper, color: 'text-purple-500' },
  { key: 'messages', label: 'Messages', icon: MessageSquare, color: 'text-sky-500', badge: 2 },
  { key: 'safety', label: 'Safety Check-In', icon: ShieldAlert, color: 'text-green-600' },
  { key: 'profile', label: 'My Profile', icon: User, color: 'text-indigo-500' },
  { key: 'settings', label: 'Settings', icon: Settings, color: 'text-gray-500' },
]

const ADMIN_SECTIONS: { title: string; items: SidebarItem[] }[] = [
  { title: 'Operations', items: [
    { key: 'dashboard', label: 'Dashboard', icon: BarChart3, color: 'text-blue-500' },
    { key: 'reports', label: 'All Reports', icon: FileText, color: 'text-orange-500' },
    { key: 'map', label: 'Live Map', icon: Map, color: 'text-emerald-500' },
    { key: 'alert_send', label: 'Send Alert', icon: Bell, color: 'text-red-500' },
    { key: 'incident', label: 'Incident Console', icon: Radio, color: 'text-amber-500' },
  ]},
  { title: 'Intelligence', items: [
    { key: 'analytics', label: 'Analytics', icon: Activity, color: 'text-violet-500' },
    { key: 'ai_models', label: 'AI Models', icon: Brain, color: 'text-purple-500' },
    { key: 'crowd', label: 'Crowd Density', icon: Users, color: 'text-cyan-500' },
  ]},
  { title: 'Management', items: [
    { key: 'resources', label: 'Resources', icon: Navigation, color: 'text-teal-500' },
    { key: 'users', label: 'Users', icon: Users, color: 'text-indigo-500' },
    { key: 'community', label: 'Community', icon: Users, color: 'text-teal-400' },
  ]},
  { title: 'Records', items: [
    { key: 'history', label: 'History', icon: History, color: 'text-amber-500' },
    { key: 'audit', label: 'Audit Log', icon: Clock, color: 'text-gray-400' },
    { key: 'delivery', label: 'Delivery', icon: Archive, color: 'text-slate-500' },
  ]},
]

interface Props { variant: 'citizen' | 'admin'; activeKey: string; onNavigate: (key: string) => void }

export default function Sidebar({ variant, activeKey, onNavigate }: Props) {
  const [collapsed, setCollapsed] = useState(false)
  const items = variant === 'citizen' ? CITIZEN_NAV : []
  const sections = variant === 'admin' ? ADMIN_SECTIONS : []

  return (
    <aside className={`fixed top-14 left-0 bottom-0 z-30 bg-white dark:bg-gray-950 border-r border-gray-200 dark:border-gray-800 transition-all duration-300 overflow-y-auto hidden lg:block ${collapsed ? 'w-[60px]' : 'w-[220px]'}`}>
      <div className="flex items-center justify-end px-2 py-2">
        <button onClick={() => setCollapsed(!collapsed)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/5 text-gray-400">
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {variant === 'citizen' && (
        <div className="px-2 space-y-0.5">
          {items.map(item => {
            const isActive = activeKey === item.key
            const Icon = item.icon
            return (
              <button
                key={item.key}
                onClick={() => onNavigate(item.key)}
                className={`w-full flex items-center gap-3 rounded-xl transition-all duration-200 group relative
                  ${collapsed ? 'justify-center px-2 py-2.5' : 'px-3 py-2.5'}
                  ${isActive
                    ? 'bg-aegis-50 dark:bg-aegis-500/10 text-aegis-700 dark:text-aegis-300 font-semibold shadow-sm'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/[0.03]'
                  }
                `}
              >
                {isActive && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-aegis-500 rounded-r-full" />}
                <Icon className={`w-[18px] h-[18px] flex-shrink-0 ${isActive ? 'text-aegis-600 dark:text-aegis-400' : item.color || 'text-gray-400'}`} />
                {!collapsed && <span className="text-xs truncate">{item.label}</span>}
                {!collapsed && item.badge && item.badge > 0 && (
                  <span className="ml-auto w-5 h-5 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">{item.badge}</span>
                )}
              </button>
            )
          })}
        </div>
      )}

      {variant === 'admin' && sections.map(section => (
        <div key={section.title} className="mb-3">
          {!collapsed && <p className="px-4 pt-3 pb-1 text-[9px] font-bold text-gray-400 dark:text-gray-600 uppercase tracking-widest">{section.title}</p>}
          <div className="px-2 space-y-0.5">
            {section.items.map(item => {
              const isActive = activeKey === item.key
              const Icon = item.icon
              return (
                <button
                  key={item.key}
                  onClick={() => onNavigate(item.key)}
                  className={`w-full flex items-center gap-3 rounded-xl transition-all duration-200 relative
                    ${collapsed ? 'justify-center px-2 py-2.5' : 'px-3 py-2.5'}
                    ${isActive
                      ? 'bg-aegis-50 dark:bg-aegis-500/10 text-aegis-700 dark:text-aegis-300 font-semibold'
                      : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/[0.03]'
                    }
                  `}
                >
                  {isActive && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-aegis-500 rounded-r-full" />}
                  <Icon className={`w-[18px] h-[18px] flex-shrink-0 ${isActive ? 'text-aegis-600 dark:text-aegis-400' : item.color || ''}`} />
                  {!collapsed && <span className="text-xs truncate">{item.label}</span>}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </aside>
  )
}
