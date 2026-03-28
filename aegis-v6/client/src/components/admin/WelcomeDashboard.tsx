import { useMemo } from 'react'
import {
  Shield, BarChart3, FileText, Users, Bell, Activity,
  AlertTriangle, CheckCircle, Clock, MapPin, Zap,
  TrendingUp, Eye, Heart, ArrowRight
} from 'lucide-react'

interface WelcomeDashboardProps {
  user: any
  stats: any
  alerts: any[]
  reports: any[]
  lang: string
  onNavigate: (view: string) => void
}

export default function WelcomeDashboard({ user, stats, alerts, reports, lang, onNavigate }: WelcomeDashboardProps) {
  const greeting = useMemo(() => {
    const h = new Date().getHours()
    if (h < 12) return 'Good morning'
    if (h < 17) return 'Good afternoon'
    return 'Good evening'
  }, [])

  const today = new Date()
  const todayStr = today.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  const recentReports = useMemo(() => {
    return [...reports]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 5)
  }, [reports])

  const activeAlerts = useMemo(() => alerts.filter(a => a.active !== false).slice(0, 3), [alerts])
  const criticalCount = reports.filter(r => r.severity === 'High' && r.status !== 'Resolved' && r.status !== 'Archived').length

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Hero Welcome Banner */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-aegis-600 via-aegis-700 to-blue-900 p-8 text-white shadow-2xl">
        <div className="absolute top-0 right-0 w-96 h-96 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/3" />
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/4" />
        <div className="relative z-10">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-16 h-16 rounded-2xl bg-white/15 backdrop-blur-sm flex items-center justify-center shadow-xl border border-white/20">
              {user?.avatarUrl ? (
                <img src={user.avatarUrl} alt="" className="w-full h-full rounded-2xl object-cover" />
              ) : (
                <span className="text-2xl font-black text-white">{user?.displayName?.charAt(0) || 'A'}</span>
              )}
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-black tracking-tight">
                {greeting}, {user?.displayName?.split(' ')[0] || 'Admin'}
              </h1>
              <p className="text-white/70 text-sm font-medium mt-1">{todayStr}</p>
            </div>
          </div>
          <p className="text-white/80 text-sm max-w-xl leading-relaxed">
            Welcome to your AEGIS Command Centre. You have{' '}
            <span className="font-bold text-white">{stats.unverified} unverified reports</span>{' '}
            and{' '}
            <span className="font-bold text-white">{stats.urgent} urgent incidents</span>{' '}
            requiring attention.
          </p>

          {criticalCount > 0 && (
            <div className="mt-4 flex items-center gap-2 bg-red-500/20 backdrop-blur-sm border border-red-400/30 rounded-xl px-4 py-2.5 w-fit">
              <AlertTriangle className="w-4 h-4 text-red-300" />
              <span className="text-sm font-bold text-red-100">{criticalCount} high-severity incident{criticalCount > 1 ? 's' : ''} active</span>
              <button onClick={() => onNavigate('reports')} className="ml-2 text-xs font-bold bg-white/20 hover:bg-white/30 px-3 py-1 rounded-lg transition">
                View <ArrowRight className="w-3 h-3 inline ml-0.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Quick Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={FileText} label="Total Reports" value={stats.total} color="blue" onClick={() => onNavigate('reports')} />
        <StatCard icon={AlertTriangle} label="Urgent" value={stats.urgent} color="red" onClick={() => onNavigate('reports')} />
        <StatCard icon={CheckCircle} label="Verified" value={stats.verified} color="emerald" onClick={() => onNavigate('reports')} />
        <StatCard icon={TrendingUp} label="Verify Rate" value={`${stats.verifyRate}%`} color="violet" />
      </div>

      {/* Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Quick Actions */}
        <div className="glass-card rounded-2xl p-5">
          <h3 className="text-sm font-extrabold text-gray-900 dark:text-white flex items-center gap-2 mb-4">
            <Zap className="w-4 h-4 text-amber-500" />
            Quick Actions
          </h3>
          <div className="grid grid-cols-2 gap-2">
            <QuickAction icon={FileText} label="View Reports" desc={`${stats.unverified} pending`} onClick={() => onNavigate('reports')} color="blue" />
            <QuickAction icon={Bell} label="Send Alert" desc="Broadcast now" onClick={() => onNavigate('alert_send')} color="red" />
            <QuickAction icon={BarChart3} label="Analytics" desc="View trends" onClick={() => onNavigate('analytics')} color="violet" />
            <QuickAction icon={MapPin} label="Live Map" desc="Real-time view" onClick={() => onNavigate('map')} color="emerald" />
            <QuickAction icon={Users} label="Manage Users" desc="Team & citizens" onClick={() => onNavigate('users')} color="amber" />
            <QuickAction icon={Activity} label="System Health" desc="Monitor status" onClick={() => onNavigate('system_health')} color="cyan" />
          </div>
        </div>

        {/* Active Alerts */}
        <div className="glass-card rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-extrabold text-gray-900 dark:text-white flex items-center gap-2">
              <Bell className="w-4 h-4 text-red-500" />
              Active Alerts
            </h3>
            <span className="text-[10px] font-bold text-gray-500 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded-lg">
              {alerts.filter(a => a.active !== false).length} active
            </span>
          </div>
          {activeAlerts.length === 0 ? (
            <div className="text-center py-8">
              <CheckCircle className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
              <p className="text-xs text-gray-500 dark:text-gray-400">No active alerts. All clear.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {activeAlerts.map((alert, i) => (
                <div key={alert.id || i} className="flex items-center gap-3 p-3 rounded-xl bg-gray-50/60 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-800">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    alert.severity === 'Critical' ? 'bg-red-500' :
                    alert.severity === 'High' ? 'bg-orange-500' :
                    alert.severity === 'Medium' ? 'bg-amber-500' : 'bg-blue-500'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-gray-900 dark:text-white truncate">{alert.title || alert.message || 'Alert'}</p>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400">{alert.severity || 'Info'} | {alert.area || 'All areas'}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent Activity */}
      <div className="glass-card rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-extrabold text-gray-900 dark:text-white flex items-center gap-2">
            <Clock className="w-4 h-4 text-blue-500" />
            Recent Reports
          </h3>
          <button onClick={() => onNavigate('reports')} className="text-[10px] font-bold text-aegis-600 hover:text-aegis-700 flex items-center gap-1">
            View all <ArrowRight className="w-3 h-3" />
          </button>
        </div>
        {recentReports.length === 0 ? (
          <p className="text-xs text-gray-500 text-center py-6">No reports yet</p>
        ) : (
          <div className="space-y-2">
            {recentReports.map((r, i) => (
              <div key={r.id || i} className="flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50/60 dark:hover:bg-gray-800/30 transition-colors">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                  r.severity === 'High' ? 'bg-red-100 dark:bg-red-950/30' :
                  r.severity === 'Medium' ? 'bg-amber-100 dark:bg-amber-950/30' : 'bg-blue-100 dark:bg-blue-950/30'
                }`}>
                  <AlertTriangle className={`w-4 h-4 ${
                    r.severity === 'High' ? 'text-red-600 dark:text-red-400' :
                    r.severity === 'Medium' ? 'text-amber-600 dark:text-amber-400' : 'text-blue-600 dark:text-blue-400'
                  }`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-gray-900 dark:text-white truncate">{r.type || 'Report'} {r.reportNumber ? `#${r.reportNumber}` : ''}</p>
                  <p className="text-[10px] text-gray-500 dark:text-gray-400 truncate">{r.location || 'Unknown location'}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
                    r.status === 'Urgent' ? 'bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400' :
                    r.status === 'Verified' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400' :
                    r.status === 'Resolved' ? 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' :
                    'bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400'
                  }`}>{r.status}</span>
                  <p className="text-[9px] text-gray-400 mt-0.5">
                    {new Date(r.timestamp).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* System Overview Footer */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
        <MiniStat label="High Sev." value={stats.high} />
        <MiniStat label="Medium" value={stats.medium} />
        <MiniStat label="Low" value={stats.low} />
        <MiniStat label="With Media" value={stats.withMedia} />
        <MiniStat label="Trapped" value={stats.trapped} />
        <MiniStat label="Avg Conf." value={`${stats.avgConf}%`} />
      </div>
    </div>
  )
}

function StatCard({ icon: Icon, label, value, color, onClick }: { icon: any; label: string; value: string | number; color: string; onClick?: () => void }) {
  const colors: Record<string, string> = {
    blue: 'from-blue-500 to-indigo-600',
    red: 'from-red-500 to-rose-600',
    emerald: 'from-emerald-500 to-teal-600',
    violet: 'from-violet-500 to-purple-600',
    amber: 'from-amber-500 to-orange-600',
    cyan: 'from-cyan-500 to-teal-600',
  }

  return (
    <button onClick={onClick} className="glass-card rounded-2xl p-4 text-left hover:shadow-md transition-all group">
      <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${colors[color] || colors.blue} flex items-center justify-center mb-3 shadow-md group-hover:scale-105 transition-transform`}>
        <Icon className="w-4 h-4 text-white" />
      </div>
      <div className="text-2xl font-black text-gray-900 dark:text-white">{value}</div>
      <div className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mt-0.5">{label}</div>
    </button>
  )
}

function QuickAction({ icon: Icon, label, desc, onClick, color }: { icon: any; label: string; desc: string; onClick: () => void; color: string }) {
  const bgColors: Record<string, string> = {
    blue: 'bg-blue-50 dark:bg-blue-950/20 hover:bg-blue-100 dark:hover:bg-blue-950/40',
    red: 'bg-red-50 dark:bg-red-950/20 hover:bg-red-100 dark:hover:bg-red-950/40',
    violet: 'bg-violet-50 dark:bg-violet-950/20 hover:bg-violet-100 dark:hover:bg-violet-950/40',
    emerald: 'bg-emerald-50 dark:bg-emerald-950/20 hover:bg-emerald-100 dark:hover:bg-emerald-950/40',
    amber: 'bg-amber-50 dark:bg-amber-950/20 hover:bg-amber-100 dark:hover:bg-amber-950/40',
    cyan: 'bg-cyan-50 dark:bg-cyan-950/20 hover:bg-cyan-100 dark:hover:bg-cyan-950/40',
  }
  const iconColors: Record<string, string> = {
    blue: 'text-blue-600 dark:text-blue-400',
    red: 'text-red-600 dark:text-red-400',
    violet: 'text-violet-600 dark:text-violet-400',
    emerald: 'text-emerald-600 dark:text-emerald-400',
    amber: 'text-amber-600 dark:text-amber-400',
    cyan: 'text-cyan-600 dark:text-cyan-400',
  }

  return (
    <button onClick={onClick} className={`p-3 rounded-xl transition-all text-left ${bgColors[color] || bgColors.blue}`}>
      <Icon className={`w-5 h-5 ${iconColors[color] || iconColors.blue} mb-1.5`} />
      <p className="text-xs font-bold text-gray-900 dark:text-white">{label}</p>
      <p className="text-[10px] text-gray-500 dark:text-gray-400">{desc}</p>
    </button>
  )
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="glass-card rounded-xl p-3 text-center">
      <div className="text-lg font-black text-gray-900 dark:text-white">{value}</div>
      <div className="text-[8px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{label}</div>
    </div>
  )
}
