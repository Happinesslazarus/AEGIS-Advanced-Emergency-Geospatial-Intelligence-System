/**
 * Admin layout React component.
 *
 * - Used by AdminPage to wrap all admin views
 * - Composes AdminNavbar and AdminSidebar with SkipLinks for a11y
 */
import { useState, useCallback } from 'react'
import AdminNavbar from './AdminNavbar'
import AdminSidebar from './AdminSidebar'
import { SkipLinks } from '../ui/SkipLinks'
import type { Operator } from '../../types'

interface AdminLayoutProps {
  children: React.ReactNode
  user: Operator
  dark: boolean
  activeView: string
  urgentCount: number
  notificationCount: number
  communityUnread?: number
  messagingUnread?: number
  searchTerm: string
  setSearchTerm: (v: string) => void
  searchRef: React.RefObject<HTMLInputElement | null>
  onViewChange: (view: string) => void
  onShowProfile: () => void
  onLogout: () => void
  badges?: Record<string, number>
  navItems?: Array<{id: string; label: string; icon: React.ElementType; badge?: number}>
}

export default function AdminLayout({
  children, user, dark, activeView, urgentCount, notificationCount,
  communityUnread = 0, messagingUnread = 0,
  searchTerm, setSearchTerm, searchRef,
  onViewChange, onShowProfile, onLogout, badges, navItems = [],
}: AdminLayoutProps): JSX.Element {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  const handleMenuToggle = useCallback(() => {
    setMobileOpen(prev => !prev)
  }, [])

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <SkipLinks />
      <AdminNavbar
        user={user}
        dark={dark}
        urgentCount={urgentCount}
        notificationCount={notificationCount}
        communityUnread={communityUnread}
        messagingUnread={messagingUnread}
        searchTerm={searchTerm}
        setSearchTerm={setSearchTerm}
        searchRef={searchRef}
        onMenuToggle={handleMenuToggle}
        onViewChange={onViewChange}
        onShowProfile={() => onShowProfile()}
        onLogout={onLogout}
        navItems={navItems}
        activeView={activeView}
      />

      <AdminSidebar
        collapsed={sidebarCollapsed}
        setCollapsed={setSidebarCollapsed}
        mobileOpen={mobileOpen}
        setMobileOpen={setMobileOpen}
        activeView={activeView}
        onNavigate={onViewChange}
        isAdmin={user.role === 'admin'}
        badges={badges}
      />

      {/* Main content area -- shifts right for the sidebar */}
      <main
        id="main-content"
        className={`pt-24 min-h-screen transition-all duration-300
          ${sidebarCollapsed ? 'lg:pl-[60px]' : 'lg:pl-[220px]'}
        `}
      >
        <div className="w-full max-w-[1440px] mx-auto px-3 sm:px-4 lg:px-6 py-5 space-y-5">
          {children}
        </div>
      </main>
    </div>
  )
}
