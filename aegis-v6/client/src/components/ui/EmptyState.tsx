/**
 * EmptyState.tsx - Friendly placeholder when lists/feeds are empty (#56)
 */
import React from 'react'
import { Inbox, MessageSquare, FileText, Users, Shield, type LucideIcon } from 'lucide-react'

interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description?: string
  action?: { label: string; onClick: () => void }
}

export default function EmptyState({ icon: Icon = Inbox, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center" role="status">
      <div className="w-14 h-14 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
        <Icon className="w-7 h-7 text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300" />
      </div>
      <h3 className="text-sm font-medium text-secondary mb-1">{title}</h3>
      {description && (
        <p className="text-xs text-muted max-w-xs">{description}</p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-4 px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}

/** Pre-configured empty states for common scenarios */
export function EmptyMessages() {
  return <EmptyState icon={MessageSquare} title="No messages yet" description="Start a conversation with the support team for help or updates." />
}

export function EmptyReports() {
  return <EmptyState icon={FileText} title="No reports" description="You haven't submitted any emergency reports yet." />
}

export function EmptyCommunity() {
  return <EmptyState icon={Users} title="No community posts" description="Be the first to offer help or request assistance in your area." />
}

export function EmptySafety() {
  return <EmptyState icon={Shield} title="No check-ins" description="Use safety check-ins to let responders and contacts know your status." />
}




