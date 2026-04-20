/**
 * App layout React component.
 *
 * - Used by CitizenPage and CitizenDashboard to wrap citizen views
 * - Reads alert count from AlertsContext for the navbar badge
 */
import { useState, useCallback } from 'react'
import TopNavbar from './TopNavbar'
import Sidebar, { type SidebarItem } from './Sidebar'
import { useAlerts } from '../../contexts/AlertsContext'
import { SkipLinks } from '../ui/SkipLinks'

interface AppLayoutProps {
  children: React.ReactNode
  activeKey: string
  onNavigate: (item: SidebarItem) => void
  unreadMessages?: number
  communityUnread?: number
}

export default function AppLayout({ children, activeKey, onNavigate, unreadMessages = 0, communityUnread = 0 }: AppLayoutProps): JSX.Element {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const { alerts } = useAlerts()

  const alertCount = alerts.length

  const handleMenuToggle = useCallback(() => {
    setMobileOpen(prev => !prev)
  }, [])

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-aegis-100/40 dark:from-gray-950 dark:via-gray-900 dark:to-aegis-950/30 text-gray-900 dark:text-gray-100">
      <SkipLinks />
      <TopNavbar onMenuToggle={handleMenuToggle} alertCount={alertCount} communityUnread={communityUnread} unreadMessages={unreadMessages} />

      <Sidebar
        collapsed={sidebarCollapsed}
        setCollapsed={setSidebarCollapsed}
        mobileOpen={mobileOpen}
        setMobileOpen={setMobileOpen}
        onNavigate={onNavigate}
        activeKey={activeKey}
        alertCount={alertCount}
        unreadMessages={unreadMessages}
        communityUnread={communityUnread}
      />

      {/* Main content area — shifts right for the sidebar */}
      <main
        id="main-content"
        className={`pt-14 min-h-screen transition-all duration-300
          ${sidebarCollapsed ? 'lg:pl-[60px]' : 'lg:pl-[220px]'}
        `}
      >
        <div className="w-full max-w-7xl mx-auto px-3 sm:px-4 lg:px-6 py-4 sm:py-6">
          {children}
        </div>
      </main>
    </div>
  )
}
