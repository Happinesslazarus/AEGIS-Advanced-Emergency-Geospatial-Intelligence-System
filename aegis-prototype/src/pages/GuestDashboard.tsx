import { useState } from 'react'
import { Link } from 'react-router-dom'
import { TopNavbar } from '../components/Navbar'
import StatCard from '../components/StatCard'
import AlertCard from '../components/AlertCard'
import ReportCard from '../components/ReportCard'
import MapPlaceholder from '../components/MapPlaceholder'
import WeatherPanel from '../components/WeatherPanel'
import { Shield, Bell, FileText, MapPin, Activity, Users, ChevronRight, AlertTriangle, Eye, BarChart3, Brain, TrendingUp, Clock, Droplets, Wind, ThermometerSun } from 'lucide-react'

const MOCK_ALERTS = [
  { id: '1', severity: 'critical' as const, title: 'Flash Flood Warning', message: 'Severe flash flood warning for River Dee catchment area. Immediate evacuation advised for Zone A.', area: 'Aberdeen City', time: '5 min ago', type: 'flood' },
  { id: '2', severity: 'high' as const, title: 'Storm Force Winds', message: 'Storm force winds expected 80-90mph. Secure loose items.', area: 'Aberdeenshire', time: '1 hour ago', type: 'storm' },
  { id: '3', severity: 'medium' as const, title: 'Coastal Surge Advisory', message: 'Elevated tide levels. Coastal areas may experience minor flooding.', area: 'East Coast', time: '2 hours ago', type: 'flood' },
]

const MOCK_REPORTS = [
  { id: '1', type: 'Flood — River Overflow', location: 'Aberdeen City Centre', severity: 'High', status: 'Urgent', time: '3 min ago', description: 'Major flooding along River Dee.', confidence: 92 },
  { id: '2', type: 'Structural Damage', location: 'Stonehaven', severity: 'Medium', status: 'Verified', time: '12 min ago', description: 'Building wall collapse on High Street.', confidence: 87 },
  { id: '3', type: 'Road Blockage', location: 'A90 Northbound', severity: 'Low', status: 'Verified', time: '45 min ago', description: 'Large tree blocking both lanes.', confidence: 95 },
]

export default function GuestDashboard() {
  const [tab, setTab] = useState<'map' | 'alerts' | 'reports' | 'weather' | 'predictions'>('map')

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-aegis-100/40 dark:from-gray-950 dark:via-gray-900 dark:to-aegis-950/30 text-gray-900 dark:text-gray-100">
      <TopNavbar alertCount={3} />

      <main className="pt-14 min-h-screen">
        <div className="w-full max-w-7xl mx-auto px-3 sm:px-4 lg:px-6 py-4 sm:py-6 space-y-6">
          {/* Guest Banner */}
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-aegis-600 to-aegis-700 p-5 sm:p-6 text-white">
            <div className="absolute top-0 right-0 w-48 h-48 rounded-full bg-white/5 -translate-y-1/3 translate-x-1/4" />
            <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Eye className="w-4 h-4 opacity-60" />
                  <span className="text-[10px] font-bold bg-white/10 px-2 py-0.5 rounded-full">GUEST VIEW</span>
                </div>
                <h1 className="text-xl font-bold">Public Safety Dashboard</h1>
                <p className="text-sm opacity-80 mt-1">Real-time disaster information for Aberdeen & Aberdeenshire</p>
              </div>
              <Link to="/citizen/login" className="btn-primary bg-white text-aegis-700 hover:bg-gray-100 text-xs px-4 py-2 flex items-center gap-1.5 whitespace-nowrap">
                Sign in for full access <ChevronRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Active Reports" value={24} icon={FileText} color="blue" />
            <StatCard label="Active Alerts" value={3} icon={Bell} color="red" />
            <StatCard label="Safe Zones" value={8} icon={MapPin} color="green" />
            <StatCard label="Online Users" value={312} icon={Users} color="purple" />
          </div>

          {/* Tabs */}
          <div className="flex gap-1 p-1 bg-gray-100 dark:bg-white/[0.03] rounded-xl border border-gray-200 dark:border-white/5 overflow-x-auto">
            {([
              { key: 'map', label: '🗺️ Live Map' },
              { key: 'alerts', label: '⚠️ Alerts' },
              { key: 'reports', label: '📋 Reports' },
              { key: 'weather', label: '🌤️ Weather' },
              { key: 'predictions', label: '🧠 AI Predictions' },
            ] as const).map(t => (
              <button key={t.key} onClick={() => setTab(t.key as typeof tab)} className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${tab === t.key ? 'bg-white dark:bg-white/10 shadow-sm text-aegis-600 dark:text-aegis-400' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}>
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'map' && (
            <div className="space-y-4 animate-fade-up">
              <MapPlaceholder height="450px" />
              <div className="card p-4">
                <h3 className="text-xs font-bold mb-2 flex items-center gap-2"><Activity className="w-3.5 h-3.5 text-green-500" /> Live Activity Feed</h3>
                <div className="space-y-2">
                  {[
                    { text: 'New flood report verified at Union Street', time: '1 min ago', dot: 'bg-blue-500' },
                    { text: 'Alert level raised to AMBER for Aberdeen City', time: '5 min ago', dot: 'bg-amber-500' },
                    { text: 'Shelter capacity updated — Community Centre', time: '8 min ago', dot: 'bg-green-500' },
                    { text: 'Storm surge measurement: 2.3m at harbor', time: '12 min ago', dot: 'bg-purple-500' },
                    { text: 'AI classified 3 new incident reports automatically', time: '15 min ago', dot: 'bg-violet-500' },
                    { text: 'Power restored to Inverurie district', time: '22 min ago', dot: 'bg-emerald-500' },
                  ].map((e, i) => (
                    <div key={i} className="flex items-center gap-3 py-1.5">
                      <span className={`w-2 h-2 rounded-full ${e.dot} flex-shrink-0`} />
                      <span className="text-xs flex-1">{e.text}</span>
                      <span className="text-[10px] text-gray-500 whitespace-nowrap">{e.time}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab === 'alerts' && (
            <div className="space-y-3 animate-fade-up">
              {MOCK_ALERTS.map(a => <AlertCard key={a.id} alert={a} />)}
            </div>
          )}

          {tab === 'reports' && (
            <div className="space-y-3 animate-fade-up">
              {MOCK_REPORTS.map(r => <ReportCard key={r.id} report={r} />)}
              <div className="card p-6 text-center border-2 border-dashed border-gray-200 dark:border-white/10">
                <Shield className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                <p className="text-xs text-gray-500 dark:text-gray-400">Sign in to submit reports and access full features</p>
                <Link to="/citizen/login" className="btn-primary text-xs px-4 py-2 mt-3 inline-flex items-center gap-1">
                  Create Account <ChevronRight className="w-3 h-3" />
                </Link>
              </div>
            </div>
          )}

          {tab === 'weather' && (
            <div className="space-y-4 animate-fade-up">
              <WeatherPanel />
              <div className="card p-4">
                <h3 className="text-xs font-bold mb-3 flex items-center gap-2"><Droplets className="w-3.5 h-3.5 text-blue-500" /> River Levels</h3>
                <div className="grid sm:grid-cols-2 gap-3">
                  {[
                    { river: 'River Dee', level: '2.8m', normal: '1.2m', status: 'High', color: 'text-red-500' },
                    { river: 'River Don', level: '1.6m', normal: '1.0m', status: 'Above Normal', color: 'text-amber-500' },
                    { river: 'River Deveron', level: '1.1m', normal: '0.9m', status: 'Normal', color: 'text-green-500' },
                    { river: 'Cowie Water', level: '0.7m', normal: '0.5m', status: 'Normal', color: 'text-green-500' },
                  ].map(r => (
                    <div key={r.river} className="flex items-center justify-between p-3 rounded-xl bg-gray-50 dark:bg-white/[0.02]">
                      <div>
                        <p className="text-xs font-bold">{r.river}</p>
                        <p className="text-[10px] text-gray-500">Normal: {r.normal}</p>
                      </div>
                      <div className="text-right">
                        <p className={`text-sm font-bold ${r.color}`}>{r.level}</p>
                        <p className={`text-[10px] font-semibold ${r.color}`}>{r.status}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab === 'predictions' && (
            <div className="space-y-4 animate-fade-up">
              <div className="card p-5">
                <h3 className="text-sm font-bold mb-4 flex items-center gap-2"><Brain className="w-4 h-4 text-purple-500" /> AI-Powered Predictions</h3>
                <div className="space-y-4">
                  {[
                    { title: 'Flood Risk — River Dee', prediction: 'Peak flood levels expected at 18:00 today. 87% probability of exceeding warning threshold.', confidence: 87, risk: 'High', icon: Droplets, color: 'border-blue-500 bg-blue-500/5' },
                    { title: 'Wind Speed Forecast', prediction: 'Storm weakening overnight. Wind speeds dropping below 40mph by 06:00 tomorrow.', confidence: 92, risk: 'Moderate', icon: Wind, color: 'border-amber-500 bg-amber-500/5' },
                    { title: 'Temperature Warning', prediction: 'Temperatures dropping to -3°C tonight. Ice risk on untreated roads.', confidence: 95, risk: 'Low', icon: ThermometerSun, color: 'border-cyan-500 bg-cyan-500/5' },
                  ].map(p => (
                    <div key={p.title} className={`p-4 rounded-xl border-l-4 ${p.color}`}>
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-xs font-bold flex items-center gap-2"><p.icon className="w-4 h-4" /> {p.title}</h4>
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${p.risk === 'High' ? 'bg-red-500/10 text-red-500' : p.risk === 'Moderate' ? 'bg-amber-500/10 text-amber-500' : 'bg-green-500/10 text-green-500'}`}>{p.risk} Risk</span>
                          <span className="text-[10px] font-mono text-aegis-500">{p.confidence}% confidence</span>
                        </div>
                      </div>
                      <p className="text-xs text-gray-600 dark:text-gray-400">{p.prediction}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="card p-5">
                <h3 className="text-sm font-bold mb-3 flex items-center gap-2"><TrendingUp className="w-4 h-4 text-green-500" /> 72-Hour Incident Forecast</h3>
                <div className="h-40 flex items-end gap-1 px-2">
                  {[12, 18, 25, 32, 28, 22, 15, 10, 8, 14, 20, 16].map((v, i) => (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1">
                      <div className={`w-full rounded-t transition-all hover:opacity-100 ${v > 25 ? 'bg-red-500/70' : v > 15 ? 'bg-amber-500/70' : 'bg-green-500/70'}`} style={{ height: `${(v / 35) * 100}%` }} />
                      <span className="text-[8px] text-gray-500">{i * 6}h</span>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-gray-400 mt-2 text-center">Predicted incident count per 6-hour window</p>
              </div>
            </div>
          )}

          {/* Sign-up CTA */}
          <div className="card p-6 text-center">
            <Shield className="w-8 h-8 text-aegis-500 mx-auto mb-3" />
            <h3 className="font-bold text-sm mb-1">Get the Full AEGIS Experience</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3 max-w-md mx-auto">Create a free account to submit reports, receive personalised alerts, access the SOS feature, and connect with your community.</p>
            <Link to="/citizen/login" className="btn-primary text-xs px-6 py-2.5 inline-flex items-center gap-1.5">
              Sign Up Free <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </main>
    </div>
  )
}
