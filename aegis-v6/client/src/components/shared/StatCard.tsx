import type { LucideIcon } from 'lucide-react'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'

interface Props { label: string; value: string | number; icon?: LucideIcon; color?: string; trend?: string }

const COLOR_MAP: Record<string, string> = {
  red: 'border-l-red-500 text-red-600 dark:text-red-400', amber: 'border-l-amber-500 text-amber-600 dark:text-amber-400',
  green: 'border-l-green-500 text-green-600 dark:text-green-400', blue: 'border-l-blue-500 text-blue-600 dark:text-blue-400',
  purple: 'border-l-purple-500 text-purple-600 dark:text-purple-400',
}

export default function StatCard({ label, value, icon: Icon, color = 'blue', trend }: Props): JSX.Element {
  const lang = useLanguage()
  const cls = COLOR_MAP[color] || COLOR_MAP.blue
  const [borderCls, ...textCls] = cls.split(' ')
  return (
    <div className={`card p-4 border-l-4 ${borderCls}`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 uppercase tracking-wide">{label}</p>
          <p className={`text-2xl font-bold mt-1 ${textCls.join(' ')}`}>{value}</p>
          {trend && <p className="text-xs text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 mt-1">{trend}</p>}
        </div>
        {Icon && <Icon className={`w-8 h-8 opacity-60 ${textCls.join(' ')}`} />}
      </div>
    </div>
  )
}




