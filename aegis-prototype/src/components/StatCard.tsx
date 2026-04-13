import type { LucideIcon } from 'lucide-react'

interface Props {
  label: string; value: string | number; icon?: LucideIcon; color?: string; trend?: string
}

const COLORS: Record<string, { border: string; text: string }> = {
  blue:   { border: 'border-blue-500',   text: 'text-blue-600 dark:text-blue-400' },
  red:    { border: 'border-red-500',    text: 'text-red-600 dark:text-red-400' },
  green:  { border: 'border-green-500',  text: 'text-green-600 dark:text-green-400' },
  amber:  { border: 'border-amber-500',  text: 'text-amber-600 dark:text-amber-400' },
  purple: { border: 'border-purple-500', text: 'text-purple-600 dark:text-purple-400' },
  cyan:   { border: 'border-cyan-500',   text: 'text-cyan-600 dark:text-cyan-400' },
  orange: { border: 'border-orange-500', text: 'text-orange-600 dark:text-orange-400' },
}

export default function StatCard({ label, value, icon: Icon, color = 'blue', trend }: Props) {
  const c = COLORS[color] || COLORS.blue
  return (
    <div className={`card p-4 border-l-4 ${c.border}`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">{label}</p>
          <p className={`text-2xl font-bold mt-1 ${c.text}`}>{value}</p>
          {trend && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{trend}</p>}
        </div>
        {Icon && <Icon className={`w-8 h-8 opacity-60 ${c.text}`} />}
      </div>
    </div>
  )
}
