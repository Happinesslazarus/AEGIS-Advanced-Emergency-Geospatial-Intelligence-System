import { Droplets, TrendingUp, TrendingDown, AlertTriangle, Activity } from 'lucide-react'

const GAUGES = [
  { name: 'River Dee — Aberdeen', level: 2.34, normal: 1.2, trend: 'rising', status: 'Warning', color: 'text-amber-500', barColor: 'bg-amber-500', pct: 78 },
  { name: 'River Don — Inverurie', level: 1.87, normal: 1.0, trend: 'rising', status: 'Alert', color: 'text-red-500', barColor: 'bg-red-500', pct: 93 },
  { name: 'River Deveron — Turriff', level: 0.95, normal: 0.8, trend: 'falling', status: 'Normal', color: 'text-green-500', barColor: 'bg-green-500', pct: 45 },
  { name: 'Cowie Water — Stonehaven', level: 1.54, normal: 0.9, trend: 'steady', status: 'Elevated', color: 'text-amber-400', barColor: 'bg-amber-400', pct: 65 },
]

export default function RiverGaugePanel() {
  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold flex items-center gap-2">
          <Droplets className="w-4 h-4 text-blue-500" /> River Gauges (SEPA / EA)
        </h3>
        <span className="text-[10px] text-gray-400 flex items-center gap-1">
          <Activity className="w-3 h-3" /> Live
        </span>
      </div>
      <div className="space-y-3">
        {GAUGES.map(g => (
          <div key={g.name} className="p-3 rounded-xl bg-gray-50 dark:bg-white/[0.02] border border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <span className={`text-xs font-bold ${g.color}`}>{g.status}</span>
                {g.status === 'Alert' && <AlertTriangle className="w-3 h-3 text-red-500" />}
              </div>
              <div className="flex items-center gap-1 text-[10px] text-gray-500">
                {g.trend === 'rising' && <TrendingUp className="w-3 h-3 text-red-500" />}
                {g.trend === 'falling' && <TrendingDown className="w-3 h-3 text-green-500" />}
                {g.trend === 'steady' && <span className="w-3 h-px bg-gray-400 inline-block" />}
                <span className="capitalize">{g.trend}</span>
              </div>
            </div>
            <p className="text-xs font-bold mb-1">{g.name}</p>
            <div className="flex items-center justify-between text-[10px] text-gray-500 mb-1">
              <span>Level: <strong className="text-gray-700 dark:text-gray-300">{g.level}m</strong></span>
              <span>Normal: {g.normal}m</span>
            </div>
            <div className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div className={`h-full ${g.barColor} rounded-full transition-all`} style={{ width: `${g.pct}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
