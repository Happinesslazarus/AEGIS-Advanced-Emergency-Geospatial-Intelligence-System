/**
 * Module: EmergencyReadinessScore.tsx
 *
 * Emergency readiness score shared component (reusable UI element used across pages).
 *
 * - Used across both admin and citizen interfaces */

import { useState, useEffect, useRef } from 'react'
import { Shield, CheckCircle2, Circle, ChevronDown, ChevronUp, Sparkles } from 'lucide-react'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'

interface CheckItem {
  id: string
  label: string
  category: 'supplies' | 'plan' | 'knowledge' | 'communication'
}

const CHECKLIST: CheckItem[] = [
  { id: 'water', label: '72-hour water supply stored', category: 'supplies' },
  { id: 'food', label: 'Non-perishable food kit ready', category: 'supplies' },
  { id: 'firstaid', label: 'First-aid kit accessible', category: 'supplies' },
  { id: 'torch', label: 'Torch/flashlight with batteries', category: 'supplies' },
  { id: 'route', label: 'Know nearest evacuation route', category: 'plan' },
  { id: 'meetpoint', label: 'Family meeting point agreed', category: 'plan' },
  { id: 'shelter', label: 'Know nearest emergency shelter', category: 'plan' },
  { id: 'contacts', label: 'Emergency contacts saved offline', category: 'communication' },
  { id: 'alerts', label: 'Subscribed to local alerts', category: 'communication' },
  { id: 'cpr', label: 'CPR/first-aid trained', category: 'knowledge' },
  { id: 'flood', label: 'Know local flood risk level', category: 'knowledge' },
  { id: 'insurance', label: 'Home insurance reviewed', category: 'knowledge' },
]

const CATEGORY_COLORS: Record<string, { bg: string; text: string; ring: string }> = {
  supplies: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-600 dark:text-blue-400', ring: 'stroke-blue-500' },
  plan: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-600 dark:text-green-400', ring: 'stroke-green-500' },
  knowledge: { bg: 'bg-purple-100 dark:bg-purple-900/30', text: 'text-purple-600 dark:text-purple-400', ring: 'stroke-purple-500' },
  communication: { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-600 dark:text-amber-400', ring: 'stroke-amber-500' },
}

function ScoreRing({ score, size = 80 }: { score: number; size?: number }) {
  const [animatedScore, setAnimatedScore] = useState(0)
  const prevScore = useRef(0)

  useEffect(() => {
    const start = prevScore.current
    const end = score
    const duration = 600
    const startTime = performance.now()
    const animate = (now: number) => {
      const p = Math.min((now - startTime) / duration, 1)
      const eased = 1 - Math.pow(1 - p, 3)
      setAnimatedScore(Math.round(start + (end - start) * eased))
      if (p < 1) requestAnimationFrame(animate)
    }
    requestAnimationFrame(animate)
    prevScore.current = end
  }, [score])

  const r = (size - 8) / 2
  const circumference = 2 * Math.PI * r
  const offset = circumference - (animatedScore / 100) * circumference
  const color = animatedScore >= 80 ? '#10b981' : animatedScore >= 50 ? '#f59e0b' : '#ef4444'

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth="6" className="text-gray-200 dark:text-gray-700" />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={color} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.6s cubic-bezier(0.33,1,0.68,1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-black tabular-nums" style={{ color }}>{animatedScore}</span>
        <span className="text-[8px] font-bold text-gray-400 uppercase tracking-wider">Score</span>
      </div>
    </div>
  )
}

export default function EmergencyReadinessScore(): JSX.Element {
  const lang = useLanguage()
  const [checked, setChecked] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('aegis-readiness-checks')
      return saved ? new Set(JSON.parse(saved)) : new Set()
    } catch { return new Set() }
  })
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    localStorage.setItem('aegis-readiness-checks', JSON.stringify([...checked]))
  }, [checked])

  const toggle = (id: string) => {
    setChecked(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const score = Math.round((checked.size / CHECKLIST.length) * 100)
  const level = score >= 80 ? 'Excellent' : score >= 50 ? 'Moderate' : score < 20 ? 'Critical' : 'Needs Work'
  const levelColor = score >= 80 ? 'text-green-600 dark:text-green-400' : score >= 50 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'

  const categories = ['supplies', 'plan', 'knowledge', 'communication'] as const
  const categoryProgress = categories.map(cat => {
    const items = CHECKLIST.filter(c => c.category === cat)
    const done = items.filter(c => checked.has(c.id)).length
    return { cat, done, total: items.length, pct: Math.round((done / items.length) * 100) }
  })

  return (
    <div className="card p-3 sm:p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-sm flex items-center gap-2 text-gray-900 dark:text-white">
          <Shield className="w-4 h-4 text-aegis-500" />
          Emergency Readiness
          <span className="text-[9px] bg-aegis-100 dark:bg-aegis-800 text-aegis-600 dark:text-aegis-300 px-1.5 py-0.5 rounded-full font-bold">NEW</span>
        </h3>
        <button onClick={() => setExpanded(!expanded)} className="btn-ghost p-1.5">
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Score overview — always visible */}
      <div className="flex items-center gap-4">
        <ScoreRing score={score} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            <Sparkles className={`w-3.5 h-3.5 ${levelColor}`} />
            <span className={`font-bold text-sm ${levelColor}`}>{level}</span>
          </div>
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-2">
            {checked.size}/{CHECKLIST.length} preparedness items completed
          </p>
          {/* Category mini-bars */}
          <div className="grid grid-cols-2 gap-1.5">
            {categoryProgress.map(({ cat, pct }) => (
              <div key={cat} className="flex items-center gap-1.5">
                <div className="flex-1 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      cat === 'supplies' ? 'bg-blue-500' : cat === 'plan' ? 'bg-green-500' : cat === 'knowledge' ? 'bg-purple-500' : 'bg-amber-500'
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-[9px] font-bold text-gray-400 capitalize w-14 truncate">{cat}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Expanded checklist */}
      <div className={`overflow-hidden transition-all duration-400 ${expanded ? 'max-h-[600px] mt-3 opacity-100' : 'max-h-0 opacity-0'}`}>
        <div className="border-t border-gray-100 dark:border-gray-800 pt-3 space-y-1.5">
          {CHECKLIST.map(item => {
            const isChecked = checked.has(item.id)
            const colors = CATEGORY_COLORS[item.category]
            return (
              <button
                key={item.id}
                onClick={() => toggle(item.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left transition-all duration-200 ${
                  isChecked
                    ? `${colors.bg} shadow-sm`
                    : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                }`}
              >
                {isChecked ? (
                  <CheckCircle2 className={`w-4 h-4 flex-shrink-0 ${colors.text}`} />
                ) : (
                  <Circle className="w-4 h-4 flex-shrink-0 text-gray-300 dark:text-gray-600" />
                )}
                <span className={`text-xs flex-1 ${isChecked ? `font-semibold ${colors.text}` : 'text-gray-600 dark:text-gray-400'}`}>
                  {item.label}
                </span>
                <span className={`text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${colors.bg} ${colors.text}`}>
                  {item.category}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
