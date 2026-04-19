/**
 * Tiny component that renders a single checkmark (sent), double grey
 * check (delivered), or double blue check (read) based on the message
 * status string from the server.
 *
 * - Used by FloatingChatWidget.tsx and any chat message list
 * - Status values: "sent" | "delivered" | "read" (set by server socket events)
 */

import { Check, CheckCheck } from 'lucide-react'

interface Props {
  status: string
  size?: 'sm' | 'md' | 'lg'
}

const SIZES = {
  sm: 'w-2.5 h-2.5',
  md: 'w-3 h-3',
  lg: 'w-3.5 h-3.5',
}

export default function MessageStatusIcon({ status, size = 'md' }: Props) {
  const cls = SIZES[size]
  if (status === 'read') return <CheckCheck className={`${cls} text-blue-500`} />
  if (status === 'delivered') return <CheckCheck className={`${cls} text-gray-400 dark:text-gray-300`} />
  return <Check className={`${cls} text-gray-400 dark:text-gray-300`} />
}

