/**
 * Reusable empty-state illustration shown when a list has no items
 * (no reports, no alerts, no messages, etc.). Accepts an icon, title,
 * description, and up to two action buttons.
 *
 * - Used across AdminPage, AlertsPage, and any list component
 * - Compact prop shrinks padding for use inside table cells
 * - Uses i18n t() for button/label text
 */

import { type LucideIcon, Inbox, MessageSquare, FileText, Users, Shield, Bell, Database, BarChart3, CloudOff } from 'lucide-react'
import { t, getLanguage } from '../../utils/i18n'

interface EmptyAction {
  label: string
  onClick: () => void
  variant?: 'primary' | 'secondary'
}

interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description?: string
  action?: EmptyAction
  secondaryAction?: EmptyAction
  compact?: boolean
}

export default function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  secondaryAction,
  compact = false,
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center ${compact ? 'py-6 px-3' : 'py-12 px-4'} text-center`}
      role="status"
    >
      <div className={`${compact ? 'w-10 h-10 mb-3' : 'w-14 h-14 mb-4'} rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center`}>
        <Icon className={`${compact ? 'w-5 h-5' : 'w-7 h-7'} text-gray-400 dark:text-gray-500`} aria-hidden="true" />
      </div>
      <h3 className={`${compact ? 'text-xs' : 'text-sm'} font-medium text-secondary mb-1`}>{title}</h3>
      {description && (
        <p className={`${compact ? 'text-[11px]' : 'text-xs'} text-muted max-w-xs`}>{description}</p>
      )}
      {(action || secondaryAction) && (
        <div className="mt-4 flex items-center gap-2 flex-wrap justify-center">
          {action && (
            <button
              onClick={action.onClick}
              className={
                action.variant === 'secondary'
                  ? 'px-4 py-2 text-sm font-medium rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 hover:border-gray-300 dark:hover:border-gray-600 transition-colors focus:outline-none focus:ring-2 focus:ring-aegis-500 focus:ring-offset-2 dark:focus:ring-offset-gray-950'
                  : 'px-4 py-2 text-sm font-medium rounded-lg bg-aegis-600 text-white hover:bg-aegis-700 transition-colors focus:outline-none focus:ring-2 focus:ring-aegis-500 focus:ring-offset-2 dark:focus:ring-offset-gray-950'
              }
            >
              {action.label}
            </button>
          )}
          {secondaryAction && (
            <button
              onClick={secondaryAction.onClick}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 hover:border-gray-300 dark:hover:border-gray-600 transition-colors focus:outline-none focus:ring-2 focus:ring-aegis-500 focus:ring-offset-2 dark:focus:ring-offset-gray-950"
            >
              {secondaryAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// Pre-configured empty states

export function EmptyMessages() {
  const lang = getLanguage()
  return (
    <EmptyState
      icon={MessageSquare}
      title={t('empty.noData', lang)}
      description="Start a conversation with the support team for help or updates."
    />
  )
}

export function EmptyReports() {
  const lang = getLanguage()
  return (
    <EmptyState
      icon={FileText}
      title={t('empty.noReports', lang)}
      description={t('empty.noReportsDesc', lang)}
    />
  )
}

export function EmptyCommunity() {
  const lang = getLanguage()
  return (
    <EmptyState
      icon={Users}
      title={t('empty.noCommunityPosts', lang)}
      description={t('empty.noCommunityPostsDesc', lang)}
    />
  )
}

export function EmptySafety() {
  const lang = getLanguage()
  return (
    <EmptyState
      icon={Shield}
      title={t('empty.noCheckIns', lang)}
      description={t('empty.noCheckInsDesc', lang)}
    />
  )
}

export function EmptyAlerts() {
  const lang = getLanguage()
  return (
    <EmptyState
      icon={Bell}
      title={t('empty.noActiveAlerts', lang)}
      description={t('empty.noActiveAlertsDesc', lang)}
    />
  )
}

export function EmptyAdminTable({ resource = 'records' }: { resource?: string }) {
  const lang = getLanguage()
  return (
    <EmptyState
      icon={Database}
      title={`${t('empty.noResults', lang)}`}
      description={`There are no ${resource} matching your current filters. ${t('empty.adjustFilters', lang)}`}
    />
  )
}

export function EmptyChat() {
  return (
    <EmptyState
      icon={MessageSquare}
      title="No messages yet"
      description="Start a conversation with the support team for help or real-time updates."
    />
  )
}

export function EmptyAnalytics() {
  const lang = getLanguage()
  return (
    <EmptyState
      icon={BarChart3}
      title={t('empty.noData', lang)}
      description="Analytics data will appear here once reports start coming in."
    />
  )
}

export function EmptyWeather() {
  return (
    <EmptyState
      icon={CloudOff}
      title="No weather data"
      description="Weather and environmental data is temporarily unavailable. Check back shortly."
    />
  )
}

