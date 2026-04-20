/**
 * Stat card shared component (reusable UI element used across pages).
 *
 * - Used across both admin and citizen interfaces */

import type { LucideIcon } from 'lucide-react'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'

interface Props { label: string; value: string | number; icon?: LucideIcon; color?: string; trend?: string }

import { STAT_CARD_COLORS } from '../../utils/colorTokens'
const COLOR_MAP: Record<string, string> = STAT_CARD_COLORS

export default function StatCard({ label, value, icon: Icon, color = 'blue', trend }: Props): JSX.Element {
  const lang = useLanguage()
  const cls = COLOR_MAP[color] || COLOR_MAP.blue
  const [borderCls, ...textCls] = cls.split(' ')
  return (
    <div className={`card p-4 border-l-4 ${borderCls}`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wide">{label}</p>
          <p className={`text-2xl font-bold mt-1 ${textCls.join(' ')}`}>{value}</p>
          {trend && <p className="text-xs text-gray-500 dark:text-gray-300 mt-1">{trend}</p>}
        </div>
        {Icon && <Icon className={`w-8 h-8 opacity-60 ${textCls.join(' ')}`} />}
      </div>
    </div>
  )
}
