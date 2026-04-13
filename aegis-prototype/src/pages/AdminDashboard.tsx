import { useState } from 'react'
import { TopNavbar } from '../components/Navbar'
import Sidebar from '../components/Sidebar'
import StatCard from '../components/StatCard'
import AlertCard from '../components/AlertCard'
import ReportCard from '../components/ReportCard'
import MapPlaceholder from '../components/MapPlaceholder'
import {
  Shield, Bell, FileText, MapPin, Activity, Users, BarChart3, Cpu,
  CheckCircle, Clock, AlertTriangle, Zap, Server, Database, Globe,
  ChevronRight, Terminal, ArrowUp, Signal, Eye, TrendingUp, Radio,
  Keyboard, Search, Brain, Navigation, History, Archive, Send,
  Lock, Trash2, MoreVertical, Download, Filter, RefreshCw,
  AlertCircle, Info, MessageSquare, ShieldAlert, UserPlus, UserMinus,
  Settings, Wifi, Power, HardDrive, ThermometerSun, Layers, Hash
} from 'lucide-react'

const MOCK_ALERTS = [
  { id: '1', severity: 'critical' as const, title: 'Flash Flood Warning', message: 'River Dee catchment — immediate evacuation Zone A.', area: 'Aberdeen City', time: '5m ago', type: 'flood' },
  { id: '2', severity: 'high' as const, title: 'Storm Force Winds', message: 'Winds 80-90mph forecast across Aberdeenshire.', area: 'Aberdeenshire', time: '1h ago', type: 'storm' },
  { id: '3', severity: 'medium' as const, title: 'Coastal Surge Advisory', message: 'Elevated tide levels expected.', area: 'East Coast', time: '2h ago', type: 'flood' },
]

const MOCK_REPORTS = [
  { id: '1', type: 'Flood — River Overflow', location: 'Aberdeen Centre', severity: 'High', status: 'Urgent', time: '3m ago', description: 'Major flooding along River Dee.', confidence: 92 },
  { id: '2', type: 'Structural Damage', location: 'Stonehaven', severity: 'Medium', status: 'Verified', time: '12m ago', description: 'Wall collapse on High Street.', confidence: 87 },
  { id: '3', type: 'Power Outage', location: 'Inverurie', severity: 'Medium', status: 'Unverified', time: '28m ago', description: 'Widespread outage — 500 homes.', confidence: 74 },
  { id: '4', type: 'Road Blockage', location: 'A90 Northbound', severity: 'Low', status: 'Verified', time: '45m ago', description: 'Fallen tree blocking both lanes.', confidence: 95 },
]

export default function AdminDashboard() {
  const [sideKey, setSideKey] = useState('dashboard')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [alertForm, setAlertForm] = useState({ title: '', severity: 'high', area: 'Aberdeen City', message: '' })

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-aegis-100/40 dark:from-gray-950 dark:via-gray-900 dark:to-aegis-950/30 text-gray-900 dark:text-gray-100">
      <TopNavbar onMenuToggle={() => setMobileOpen(!mobileOpen)} alertCount={3} />
      <Sidebar variant="admin" activeKey={sideKey} onNavigate={setSideKey} />

      <main className="pt-14 min-h-screen lg:pl-[220px] transition-all duration-300">
        <div className="w-full max-w-7xl mx-auto px-3 sm:px-4 lg:px-6 py-4 sm:py-6 space-y-6">

          {/* ═══════════════════════ OPERATIONS: DASHBOARD ═══════════════════════ */}
          {sideKey === 'dashboard' && (
            <div className="space-y-6 animate-fade-up">
              <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-aegis-700 via-aegis-600 to-blue-600 text-white p-6 sm:p-8">
                <div className="absolute top-0 right-0 w-96 h-96">
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[length:24px_24px]" />
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 rounded-full bg-white/5 animate-pulse" />
                </div>
                <div className="relative z-10 flex flex-col sm:flex-row justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Terminal className="w-4 h-4 opacity-60" />
                      <span className="text-[10px] font-bold bg-white/10 px-2 py-0.5 rounded-full">COMMAND CENTRE</span>
                    </div>
                    <h1 className="text-2xl sm:text-3xl font-bold mb-1">Welcome, Operator</h1>
                    <p className="text-sm opacity-80">Aberdeen & Aberdeenshire Emergency Response — <span className="font-bold text-amber-300">AMBER ALERT</span></p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] opacity-60">Current Time</p>
                    <p className="text-xl font-mono font-bold">{new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</p>
                    <p className="text-[10px] opacity-60">{new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</p>
                  </div>
                </div>
              </div>

              <div className="card p-3 flex flex-wrap items-center gap-4 sm:gap-6">
                {[
                  { icon: Server, label: 'API', status: 'Operational', ok: true },
                  { icon: Database, label: 'Database', status: 'Operational', ok: true },
                  { icon: Cpu, label: 'AI Engine', status: 'Processing', ok: true },
                  { icon: Globe, label: 'Data Feeds', status: '4/4 Active', ok: true },
                  { icon: Signal, label: 'Socket', status: 'Connected', ok: true },
                ].map(s => (
                  <div key={s.label} className="flex items-center gap-2 text-xs">
                    <s.icon className="w-3.5 h-3.5 text-gray-500" />
                    <span className="text-gray-600 dark:text-gray-400">{s.label}:</span>
                    <span className={`font-semibold ${s.ok ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>{s.status}</span>
                    <span className={`w-1.5 h-1.5 rounded-full ${s.ok ? 'bg-green-500' : 'bg-red-500'}`} />
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <StatCard label="Active Reports" value={24} icon={FileText} color="blue" trend="+3" />
                <StatCard label="Active Alerts" value={3} icon={Bell} color="red" trend="+1" />
                <StatCard label="Responders" value={18} icon={Users} color="green" />
                <StatCard label="AI Accuracy" value="94.2%" icon={Cpu} color="purple" trend="+2.1%" />
              </div>

              <div className="grid lg:grid-cols-3 gap-4">
                <div className="lg:col-span-2 space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-bold flex items-center gap-2"><FileText className="w-4 h-4 text-blue-500" /> Recent Incident Reports</h2>
                    <button onClick={() => setSideKey('reports')} className="text-xs text-aegis-500 hover:text-aegis-400 font-semibold flex items-center gap-1">View All <ChevronRight className="w-3 h-3" /></button>
                  </div>
                  {MOCK_REPORTS.slice(0, 3).map(r => <ReportCard key={r.id} report={r} />)}
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-bold flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-500" /> Active Alerts</h2>
                    <button onClick={() => setSideKey('alert_send')} className="text-xs text-aegis-500 hover:text-aegis-400 font-semibold flex items-center gap-1">All <ChevronRight className="w-3 h-3" /></button>
                  </div>
                  {MOCK_ALERTS.map(a => <AlertCard key={a.id} alert={a} />)}
                </div>
              </div>

              <div className="card p-4">
                <h3 className="text-xs font-bold mb-3 flex items-center gap-2"><Keyboard className="w-3.5 h-3.5 text-gray-500" /> Quick Actions</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { keys: 'Ctrl+K', label: 'Command Palette' },
                    { keys: 'Ctrl+M', label: 'Map View' },
                    { keys: 'Ctrl+R', label: 'Reports' },
                    { keys: 'Ctrl+I', label: 'AI Insights' },
                  ].map(s => (
                    <div key={s.keys} className="flex items-center gap-2 p-2 rounded-lg bg-gray-50 dark:bg-white/[0.02]">
                      <kbd className="px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-[10px] font-mono font-bold">{s.keys}</kbd>
                      <span className="text-[10px] text-gray-500">{s.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ═══════════════════════ OPERATIONS: REPORTS ═══════════════════════ */}
          {sideKey === 'reports' && (
            <div className="space-y-4 animate-fade-up">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h1 className="text-xl font-bold flex items-center gap-2"><FileText className="w-5 h-5 text-aegis-500" /> Reports Management</h1>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input type="text" placeholder="Search reports..." className="input pl-9 py-2 text-xs w-48 sm:w-64" />
                  </div>
                  <button className="btn-ghost text-xs flex items-center gap-1"><Filter className="w-3.5 h-3.5" /> Filter</button>
                  <button className="btn-ghost text-xs flex items-center gap-1"><Download className="w-3.5 h-3.5" /> Export</button>
                </div>
              </div>

              {/* Report summary row */}
              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: 'Total', value: 247, color: 'text-gray-700 dark:text-gray-300' },
                  { label: 'Urgent', value: 8, color: 'text-red-500' },
                  { label: 'Verified', value: 189, color: 'text-green-500' },
                  { label: 'Pending', value: 50, color: 'text-amber-500' },
                ].map(s => (
                  <div key={s.label} className="card p-3 text-center">
                    <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                    <p className="text-[10px] text-gray-500">{s.label}</p>
                  </div>
                ))}
              </div>

              {/* Sortable table header */}
              <div className="card overflow-hidden">
                <div className="hidden sm:grid grid-cols-12 gap-2 px-4 py-3 bg-gray-50 dark:bg-white/[0.02] text-[10px] font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200 dark:border-white/5">
                  <span className="col-span-1">ID</span>
                  <span className="col-span-3">Type</span>
                  <span className="col-span-2">Location</span>
                  <span className="col-span-1">Severity</span>
                  <span className="col-span-2">Status</span>
                  <span className="col-span-1">AI</span>
                  <span className="col-span-1">Time</span>
                  <span className="col-span-1"></span>
                </div>
                {MOCK_REPORTS.map((r, i) => (
                  <div key={r.id} className={`grid grid-cols-1 sm:grid-cols-12 gap-2 px-4 py-3 text-xs items-center hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors ${i < MOCK_REPORTS.length - 1 ? 'border-b border-gray-100 dark:border-white/5' : ''}`}>
                    <span className="col-span-1 font-mono text-gray-400">#{r.id}</span>
                    <span className="col-span-3 font-semibold">{r.type}</span>
                    <span className="col-span-2 text-gray-500 flex items-center gap-1"><MapPin className="w-3 h-3" />{r.location}</span>
                    <span className="col-span-1">
                      <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold ${r.severity === 'High' ? 'bg-red-500/10 text-red-500' : r.severity === 'Medium' ? 'bg-amber-500/10 text-amber-500' : 'bg-blue-500/10 text-blue-500'}`}>{r.severity}</span>
                    </span>
                    <span className="col-span-2">
                      <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold ${r.status === 'Urgent' ? 'bg-red-500/10 text-red-500' : r.status === 'Verified' ? 'bg-green-500/10 text-green-500' : 'bg-gray-500/10 text-gray-500'}`}>{r.status}</span>
                    </span>
                    <span className="col-span-1 font-mono text-aegis-500">{r.confidence}%</span>
                    <span className="col-span-1 text-gray-400">{r.time}</span>
                    <span className="col-span-1 text-right">
                      <button className="p-1 rounded hover:bg-gray-100 dark:hover:bg-white/5"><MoreVertical className="w-3.5 h-3.5 text-gray-400" /></button>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ═══════════════════════ OPERATIONS: MAP ═══════════════════════ */}
          {sideKey === 'map' && (
            <div className="space-y-4 animate-fade-up">
              <div className="flex items-center justify-between">
                <h1 className="text-xl font-bold flex items-center gap-2"><MapPin className="w-5 h-5 text-aegis-500" /> Operational Map</h1>
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-50 dark:bg-white/[0.03] border border-gray-200 dark:border-white/5">
                  <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-[10px] font-bold text-green-600 dark:text-green-400">LIVE</span>
                </div>
              </div>
              <MapPlaceholder height="500px" label="Operational Command Map" />
              <div className="grid sm:grid-cols-4 gap-3">
                {[
                  { icon: AlertTriangle, label: 'Active Incidents', value: '12', color: 'text-red-500' },
                  { icon: Navigation, label: 'Deployed Units', value: '18', color: 'text-blue-500' },
                  { icon: Shield, label: 'Shelters Open', value: '8', color: 'text-green-500' },
                  { icon: Users, label: 'Evacuated', value: '342', color: 'text-amber-500' },
                ].map(s => (
                  <div key={s.label} className="card p-3 flex items-center gap-3">
                    <s.icon className={`w-5 h-5 ${s.color}`} />
                    <div>
                      <p className="text-lg font-bold">{s.value}</p>
                      <p className="text-[10px] text-gray-500">{s.label}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ═══════════════════════ OPERATIONS: SEND ALERT ═══════════════════════ */}
          {sideKey === 'alert_send' && (
            <div className="space-y-6 animate-fade-up">
              <h1 className="text-xl font-bold flex items-center gap-2"><Bell className="w-5 h-5 text-red-500" /> Alert Broadcast</h1>
              <div className="grid lg:grid-cols-2 gap-6">
                <div className="card p-6 space-y-4">
                  <h2 className="text-sm font-bold">Compose Alert</h2>
                  <div>
                    <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Alert Title</label>
                    <input type="text" className="input w-full" placeholder="e.g. Flash Flood Warning" value={alertForm.title} onChange={e => setAlertForm(p => ({ ...p, title: e.target.value }))} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Severity</label>
                      <select className="input w-full" value={alertForm.severity} onChange={e => setAlertForm(p => ({ ...p, severity: e.target.value }))}>
                        <option value="critical">🔴 Critical</option>
                        <option value="high">🟠 High</option>
                        <option value="medium">🟡 Medium</option>
                        <option value="low">🔵 Low</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Target Area</label>
                      <select className="input w-full" value={alertForm.area} onChange={e => setAlertForm(p => ({ ...p, area: e.target.value }))}>
                        <option>Aberdeen City</option>
                        <option>Aberdeenshire</option>
                        <option>Stonehaven</option>
                        <option>Inverurie</option>
                        <option>All Areas</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Message</label>
                    <textarea className="input w-full h-28 resize-none" placeholder="Describe the emergency situation..." value={alertForm.message} onChange={e => setAlertForm(p => ({ ...p, message: e.target.value }))} />
                  </div>
                  <div className="flex gap-2">
                    <button className="btn-primary flex-1 flex items-center justify-center gap-2"><Send className="w-4 h-4" /> Broadcast Alert</button>
                    <button className="btn-ghost">Preview</button>
                  </div>
                  <p className="text-[10px] text-gray-400 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> Alerts are sent via push notification, SMS, and in-app to all citizens in the target area.</p>
                </div>
                <div className="space-y-3">
                  <h2 className="text-sm font-bold">Recent Broadcasts</h2>
                  {MOCK_ALERTS.map(a => <AlertCard key={a.id} alert={a} />)}
                  <div className="card p-3">
                    <h3 className="text-xs font-bold mb-2">Broadcast Channels</h3>
                    <div className="space-y-2">
                      {['Push Notifications', 'SMS Gateway', 'In-App Alert', 'Email Digest', 'Public Sirens'].map(ch => (
                        <div key={ch} className="flex items-center justify-between text-xs">
                          <span>{ch}</span>
                          <span className="flex items-center gap-1 text-green-500"><CheckCircle className="w-3 h-3" /> Active</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ═══════════════════════ OPERATIONS: INCIDENT CONSOLE ═══════════════════════ */}
          {sideKey === 'incident' && (
            <div className="space-y-4 animate-fade-up">
              <div className="flex items-center justify-between">
                <h1 className="text-xl font-bold flex items-center gap-2"><Radio className="w-5 h-5 text-amber-500" /> Incident Console</h1>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-1 rounded-full bg-red-500/10 text-red-500 text-[10px] font-bold animate-pulse">● 3 ACTIVE INCIDENTS</span>
                  <button className="btn-ghost text-xs flex items-center gap-1"><RefreshCw className="w-3.5 h-3.5" /> Refresh</button>
                </div>
              </div>

              <div className="grid lg:grid-cols-3 gap-4">
                {[
                  { id: 'INC-2024-001', title: 'River Dee Flooding', severity: 'Critical', status: 'Active', commander: 'Inspector Morrison', resources: 12, affected: 450, elapsed: '2h 34m', color: 'border-red-500' },
                  { id: 'INC-2024-002', title: 'Stonehaven Structural', severity: 'High', status: 'Responding', commander: 'Sgt. Campbell', resources: 6, affected: 28, elapsed: '1h 12m', color: 'border-orange-500' },
                  { id: 'INC-2024-003', title: 'A90 Road Blockage', severity: 'Medium', status: 'Monitoring', commander: 'Const. Patel', resources: 3, affected: 150, elapsed: '45m', color: 'border-amber-500' },
                ].map(inc => (
                  <div key={inc.id} className={`card p-4 space-y-3 border-l-4 ${inc.color}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono text-gray-400">{inc.id}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${inc.status === 'Active' ? 'bg-red-500/10 text-red-500' : inc.status === 'Responding' ? 'bg-orange-500/10 text-orange-500' : 'bg-amber-500/10 text-amber-500'}`}>{inc.status}</span>
                    </div>
                    <h3 className="text-sm font-bold">{inc.title}</h3>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div><span className="text-gray-500">Commander:</span> <span className="font-semibold">{inc.commander}</span></div>
                      <div><span className="text-gray-500">Resources:</span> <span className="font-semibold">{inc.resources} units</span></div>
                      <div><span className="text-gray-500">Affected:</span> <span className="font-semibold">{inc.affected} people</span></div>
                      <div><span className="text-gray-500">Elapsed:</span> <span className="font-mono font-semibold">{inc.elapsed}</span></div>
                    </div>
                    <div className="flex gap-2">
                      <button className="btn-primary text-[10px] px-3 py-1.5 flex-1">View Detail</button>
                      <button className="btn-ghost text-[10px] px-3 py-1.5">Escalate</button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="card p-4">
                <h3 className="text-xs font-bold mb-3 flex items-center gap-2"><Activity className="w-3.5 h-3.5 text-green-500" /> Incident Timeline</h3>
                <div className="space-y-3">
                  {[
                    { time: '14:32', event: 'River Dee level exceeded critical threshold (3.2m)', type: 'alert' },
                    { time: '14:35', event: 'Auto-classification: Flood — River Overflow (95% confidence)', type: 'ai' },
                    { time: '14:38', event: 'Incident INC-2024-001 created, Inspector Morrison assigned', type: 'action' },
                    { time: '14:42', event: '6 response units deployed to Zone A', type: 'resource' },
                    { time: '14:45', event: 'Evacuation order issued for Union Street area', type: 'alert' },
                    { time: '14:55', event: 'Shelter at Robert Gordon University activated', type: 'shelter' },
                    { time: '15:10', event: 'Additional 6 units requested from Aberdeenshire', type: 'resource' },
                  ].map((evt, i) => (
                    <div key={i} className="flex items-start gap-3 text-xs">
                      <span className="font-mono text-gray-400 w-12 flex-shrink-0">{evt.time}</span>
                      <span className={`w-2 h-2 rounded-full mt-1 flex-shrink-0 ${evt.type === 'alert' ? 'bg-red-500' : evt.type === 'ai' ? 'bg-purple-500' : evt.type === 'resource' ? 'bg-blue-500' : evt.type === 'shelter' ? 'bg-green-500' : 'bg-amber-500'}`} />
                      <span>{evt.event}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ═══════════════════════ INTELLIGENCE: ANALYTICS ═══════════════════════ */}
          {sideKey === 'analytics' && (
            <div className="space-y-6 animate-fade-up">
              <h1 className="text-xl font-bold flex items-center gap-2"><BarChart3 className="w-5 h-5 text-aegis-500" /> Analytics Dashboard</h1>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <StatCard label="Total Reports" value={247} icon={FileText} color="blue" trend="+12%" />
                <StatCard label="Avg Response" value="4.2m" icon={Clock} color="green" trend="-18%" />
                <StatCard label="AI Accuracy" value="94.2%" icon={Cpu} color="purple" trend="+2.1%" />
                <StatCard label="Citizen Safety" value="98.7%" icon={CheckCircle} color="emerald" />
              </div>
              <div className="grid lg:grid-cols-2 gap-4">
                <div className="card p-5">
                  <h3 className="text-xs font-bold mb-4">Reports Over Time (7 Days)</h3>
                  <div className="h-48 flex items-end gap-2 px-2">
                    {[35, 28, 42, 55, 38, 60, 24].map((v, i) => (
                      <div key={i} className="flex-1 flex flex-col items-center gap-1">
                        <div className="w-full rounded-t-lg bg-aegis-500/70 transition-all hover:bg-aegis-500" style={{ height: `${(v / 60) * 100}%` }} />
                        <span className="text-[9px] text-gray-500">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i]}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="card p-5">
                  <h3 className="text-xs font-bold mb-4">Report Types Distribution</h3>
                  <div className="space-y-3">
                    {[
                      { label: 'Flood', pct: 38, color: 'bg-blue-500' },
                      { label: 'Storm', pct: 24, color: 'bg-purple-500' },
                      { label: 'Structural', pct: 18, color: 'bg-amber-500' },
                      { label: 'Power Outage', pct: 12, color: 'bg-red-500' },
                      { label: 'Other', pct: 8, color: 'bg-gray-500' },
                    ].map(t => (
                      <div key={t.label}>
                        <div className="flex justify-between text-xs mb-1"><span>{t.label}</span><span className="font-bold">{t.pct}%</span></div>
                        <div className="w-full h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                          <div className={`h-full ${t.color} rounded-full transition-all`} style={{ width: `${t.pct}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="card p-5">
                <h3 className="text-xs font-bold mb-4">Model Performance</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {[
                    { label: 'Precision', value: '93.8%', trend: '+1.2%' },
                    { label: 'Recall', value: '91.4%', trend: '+0.8%' },
                    { label: 'F1 Score', value: '92.6%', trend: '+1.0%' },
                    { label: 'Inference', value: '42ms', trend: '-8ms' },
                  ].map(m => (
                    <div key={m.label} className="text-center p-3 rounded-xl bg-gray-50 dark:bg-white/[0.02]">
                      <p className="text-2xl font-bold text-aegis-500">{m.value}</p>
                      <p className="text-[10px] text-gray-500 mt-0.5">{m.label}</p>
                      <p className="text-[10px] text-green-500 font-semibold mt-1 flex items-center justify-center gap-0.5"><TrendingUp className="w-2.5 h-2.5" /> {m.trend}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ═══════════════════════ INTELLIGENCE: AI MODELS ═══════════════════════ */}
          {sideKey === 'ai_models' && (
            <div className="space-y-6 animate-fade-up">
              <h1 className="text-xl font-bold flex items-center gap-2"><Brain className="w-5 h-5 text-purple-500" /> AI Model Transparency</h1>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {[
                  { name: 'IncidentClassifier v3.2', type: 'Multi-label Classification', accuracy: 94.2, f1: 92.6, status: 'Production', samples: '24,580', framework: 'PyTorch', color: 'from-blue-500 to-indigo-600' },
                  { name: 'SeverityPredictor v2.1', type: 'Regression + Classification', accuracy: 91.8, f1: 89.4, status: 'Production', samples: '18,240', framework: 'scikit-learn', color: 'from-purple-500 to-pink-600' },
                  { name: 'FloodForecaster v1.4', type: 'Time-Series Prediction', accuracy: 88.5, f1: 86.2, status: 'Beta', samples: '12,800', framework: 'TensorFlow', color: 'from-cyan-500 to-blue-600' },
                  { name: 'ImageAnalyser v2.0', type: 'Computer Vision', accuracy: 92.1, f1: 90.8, status: 'Production', samples: '31,200', framework: 'PyTorch', color: 'from-green-500 to-emerald-600' },
                  { name: 'NLPExtractor v1.8', type: 'Named Entity Recognition', accuracy: 89.7, f1: 87.3, status: 'Production', samples: '15,600', framework: 'Transformers', color: 'from-amber-500 to-orange-600' },
                ].map(model => (
                  <div key={model.name} className="card overflow-hidden">
                    <div className={`bg-gradient-to-r ${model.color} p-4 text-white`}>
                      <Brain className="w-5 h-5 mb-2 opacity-70" />
                      <h3 className="text-sm font-bold">{model.name}</h3>
                      <p className="text-[10px] opacity-80">{model.type}</p>
                    </div>
                    <div className="p-4 space-y-3">
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div><span className="text-gray-500">Accuracy:</span> <span className="font-bold text-green-500">{model.accuracy}%</span></div>
                        <div><span className="text-gray-500">F1:</span> <span className="font-bold text-aegis-500">{model.f1}%</span></div>
                        <div><span className="text-gray-500">Samples:</span> <span className="font-semibold">{model.samples}</span></div>
                        <div><span className="text-gray-500">Framework:</span> <span className="font-semibold">{model.framework}</span></div>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${model.status === 'Production' ? 'bg-green-500/10 text-green-500' : 'bg-amber-500/10 text-amber-500'}`}>{model.status}</span>
                        <button className="text-[10px] text-aegis-500 font-semibold hover:underline">View Details →</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ═══════════════════════ INTELLIGENCE: CROWD DENSITY ═══════════════════════ */}
          {sideKey === 'crowd' && (
            <div className="space-y-6 animate-fade-up">
              <h1 className="text-xl font-bold flex items-center gap-2"><Users className="w-5 h-5 text-cyan-500" /> Crowd Density Monitor</h1>
              <MapPlaceholder height="350px" label="Crowd Density Heatmap" />
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {[
                  { zone: 'Zone A — City Centre', density: 'High', people: 1240, trend: 'Rising', color: 'bg-red-500' },
                  { zone: 'Zone B — Beach Area', density: 'Medium', people: 680, trend: 'Stable', color: 'bg-amber-500' },
                  { zone: 'Zone C — University', density: 'Low', people: 320, trend: 'Falling', color: 'bg-green-500' },
                  { zone: 'Zone D — Industrial', density: 'Very Low', people: 85, trend: 'Stable', color: 'bg-blue-500' },
                ].map(z => (
                  <div key={z.zone} className="card p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`w-2.5 h-2.5 rounded-full ${z.color}`} />
                      <span className="text-xs font-bold">{z.zone}</span>
                    </div>
                    <p className="text-2xl font-bold">{z.people.toLocaleString()}</p>
                    <p className="text-[10px] text-gray-500">Estimated people</p>
                    <div className="flex items-center gap-1 mt-1 text-[10px]">
                      <span className={z.trend === 'Rising' ? 'text-red-500' : z.trend === 'Falling' ? 'text-green-500' : 'text-gray-500'}>{z.trend === 'Rising' ? '↑' : z.trend === 'Falling' ? '↓' : '→'} {z.trend}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ═══════════════════════ MANAGEMENT: RESOURCES ═══════════════════════ */}
          {sideKey === 'resources' && (
            <div className="space-y-6 animate-fade-up">
              <h1 className="text-xl font-bold flex items-center gap-2"><Navigation className="w-5 h-5 text-teal-500" /> Resource Deployment</h1>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <StatCard label="Total Units" value={42} icon={Users} color="blue" />
                <StatCard label="Deployed" value={18} icon={Navigation} color="green" />
                <StatCard label="Available" value={24} icon={CheckCircle} color="emerald" />
                <StatCard label="In Transit" value={4} icon={Activity} color="amber" />
              </div>
              <div className="card overflow-hidden">
                <div className="px-4 py-3 bg-gray-50 dark:bg-white/[0.02] text-[10px] font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200 dark:border-white/5 grid grid-cols-6 gap-2">
                  <span>Unit</span><span>Type</span><span>Status</span><span>Location</span><span>Assigned</span><span></span>
                </div>
                {[
                  { unit: 'Fire Engine 1', type: 'Fire & Rescue', status: 'Deployed', location: 'Zone A', assigned: 'INC-001' },
                  { unit: 'Ambulance 3', type: 'Medical', status: 'Deployed', location: 'Zone A', assigned: 'INC-001' },
                  { unit: 'Patrol Car 7', type: 'Police', status: 'In Transit', location: 'En route Zone B', assigned: 'INC-002' },
                  { unit: 'Rescue Boat 2', type: 'Water Rescue', status: 'Deployed', location: 'River Dee', assigned: 'INC-001' },
                  { unit: 'Drone Unit 1', type: 'Aerial Survey', status: 'Available', location: 'HQ', assigned: '—' },
                  { unit: 'Generator 4', type: 'Power', status: 'Deployed', location: 'Inverurie', assigned: 'INC-003' },
                ].map((u, i) => (
                  <div key={u.unit} className={`grid grid-cols-6 gap-2 px-4 py-3 text-xs items-center hover:bg-gray-50 dark:hover:bg-white/[0.02] ${i < 5 ? 'border-b border-gray-100 dark:border-white/5' : ''}`}>
                    <span className="font-semibold">{u.unit}</span>
                    <span className="text-gray-500">{u.type}</span>
                    <span><span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold ${u.status === 'Deployed' ? 'bg-green-500/10 text-green-500' : u.status === 'In Transit' ? 'bg-amber-500/10 text-amber-500' : 'bg-gray-500/10 text-gray-500'}`}>{u.status}</span></span>
                    <span className="text-gray-500">{u.location}</span>
                    <span className="font-mono text-gray-400">{u.assigned}</span>
                    <span className="text-right"><button className="text-[10px] text-aegis-500 font-semibold hover:underline">Manage</button></span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ═══════════════════════ MANAGEMENT: USERS ═══════════════════════ */}
          {sideKey === 'users' && (
            <div className="space-y-6 animate-fade-up">
              <div className="flex items-center justify-between">
                <h1 className="text-xl font-bold flex items-center gap-2"><Users className="w-5 h-5 text-indigo-500" /> User Management</h1>
                <button className="btn-primary text-xs flex items-center gap-1"><UserPlus className="w-3.5 h-3.5" /> Add User</button>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <StatCard label="Total Users" value={1284} icon={Users} color="blue" />
                <StatCard label="Active Now" value={312} icon={Activity} color="green" />
                <StatCard label="Admins" value={8} icon={ShieldAlert} color="purple" />
                <StatCard label="New (7d)" value={47} icon={UserPlus} color="emerald" trend="+12" />
              </div>
              <div className="card overflow-hidden">
                <div className="px-4 py-3 bg-gray-50 dark:bg-white/[0.02] text-[10px] font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200 dark:border-white/5 grid grid-cols-7 gap-2">
                  <span>User</span><span className="col-span-2">Email</span><span>Role</span><span>Status</span><span>Last Active</span><span></span>
                </div>
                {[
                  { name: 'H. Lazarus', email: 'happiness@rgu.ac.uk', role: 'Super Admin', status: 'Online', active: 'Now', avatar: 'HL' },
                  { name: 'J. Morrison', email: 'j.morrison@police.uk', role: 'Admin', status: 'Online', active: '5m ago', avatar: 'JM' },
                  { name: 'S. Campbell', email: 's.campbell@fire.uk', role: 'Operator', status: 'Online', active: '12m ago', avatar: 'SC' },
                  { name: 'A. Patel', email: 'a.patel@nhs.uk', role: 'Responder', status: 'Offline', active: '2h ago', avatar: 'AP' },
                  { name: 'R. MacLeod', email: 'r.macleod@council.uk', role: 'Citizen', status: 'Online', active: '1m ago', avatar: 'RM' },
                ].map((u, i) => (
                  <div key={u.email} className={`grid grid-cols-7 gap-2 px-4 py-3 text-xs items-center hover:bg-gray-50 dark:hover:bg-white/[0.02] ${i < 4 ? 'border-b border-gray-100 dark:border-white/5' : ''}`}>
                    <span className="flex items-center gap-2">
                      <span className="w-7 h-7 rounded-full bg-aegis-500/20 text-aegis-600 dark:text-aegis-400 text-[10px] font-bold flex items-center justify-center">{u.avatar}</span>
                      <span className="font-semibold">{u.name}</span>
                    </span>
                    <span className="col-span-2 text-gray-500">{u.email}</span>
                    <span><span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold ${u.role === 'Super Admin' ? 'bg-purple-500/10 text-purple-500' : u.role === 'Admin' ? 'bg-blue-500/10 text-blue-500' : 'bg-gray-500/10 text-gray-500'}`}>{u.role}</span></span>
                    <span className="flex items-center gap-1"><span className={`w-1.5 h-1.5 rounded-full ${u.status === 'Online' ? 'bg-green-500' : 'bg-gray-400'}`} />{u.status}</span>
                    <span className="text-gray-400">{u.active}</span>
                    <span className="text-right"><button className="p-1 rounded hover:bg-gray-100 dark:hover:bg-white/5"><MoreVertical className="w-3.5 h-3.5 text-gray-400" /></button></span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ═══════════════════════ MANAGEMENT: COMMUNITY ═══════════════════════ */}
          {sideKey === 'community' && (
            <div className="space-y-6 animate-fade-up">
              <h1 className="text-xl font-bold flex items-center gap-2"><Users className="w-5 h-5 text-teal-500" /> Community Hub</h1>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <StatCard label="Community Posts" value={156} icon={MessageSquare} color="blue" />
                <StatCard label="Volunteers" value={89} icon={Users} color="green" />
                <StatCard label="Aid Requests" value={12} icon={AlertTriangle} color="amber" />
                <StatCard label="Resolved" value={134} icon={CheckCircle} color="emerald" />
              </div>
              <div className="space-y-3">
                {[
                  { author: 'Sarah M.', time: '20m ago', text: 'Road between Portlethen and Stonehaven is clear now. Drove through 10 mins ago.', likes: 24, replies: 8, tag: 'Update' },
                  { author: 'Community Centre', time: '45m ago', text: 'We have supplies available — blankets, water, and hot food. Open until 10pm tonight.', likes: 56, replies: 12, tag: 'Aid' },
                  { author: 'James K.', time: '1h ago', text: 'Volunteer drivers needed for supply delivery to Stonehaven elderly residents.', likes: 31, replies: 15, tag: 'Volunteer' },
                  { author: 'Weather Watch', time: '2h ago', text: 'Next band of rain expected around 18:00. Should be lighter than this morning.', likes: 42, replies: 6, tag: 'Weather' },
                ].map((post, i) => (
                  <div key={i} className="card p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="w-8 h-8 rounded-full bg-aegis-500/20 text-aegis-600 dark:text-aegis-400 text-[10px] font-bold flex items-center justify-center">{post.author[0]}</span>
                        <div>
                          <span className="text-xs font-bold">{post.author}</span>
                          <span className="text-[10px] text-gray-400 ml-2">{post.time}</span>
                        </div>
                      </div>
                      <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${post.tag === 'Update' ? 'bg-blue-500/10 text-blue-500' : post.tag === 'Aid' ? 'bg-green-500/10 text-green-500' : post.tag === 'Volunteer' ? 'bg-purple-500/10 text-purple-500' : 'bg-amber-500/10 text-amber-500'}`}>{post.tag}</span>
                    </div>
                    <p className="text-xs mb-3">{post.text}</p>
                    <div className="flex items-center gap-4 text-[10px] text-gray-500">
                      <span>♡ {post.likes}</span>
                      <span>💬 {post.replies}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ═══════════════════════ RECORDS: HISTORY ═══════════════════════ */}
          {sideKey === 'history' && (
            <div className="space-y-6 animate-fade-up">
              <div className="flex items-center justify-between">
                <h1 className="text-xl font-bold flex items-center gap-2"><History className="w-5 h-5 text-amber-500" /> Incident History</h1>
                <div className="flex items-center gap-2">
                  <button className="btn-ghost text-xs flex items-center gap-1"><Filter className="w-3.5 h-3.5" /> Filter</button>
                  <button className="btn-ghost text-xs flex items-center gap-1"><Download className="w-3.5 h-3.5" /> Export</button>
                </div>
              </div>
              <div className="card overflow-hidden">
                <div className="px-4 py-3 bg-gray-50 dark:bg-white/[0.02] text-[10px] font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200 dark:border-white/5 grid grid-cols-6 gap-2">
                  <span>ID</span><span className="col-span-2">Incident</span><span>Severity</span><span>Duration</span><span>Status</span>
                </div>
                {[
                  { id: 'INC-2024-098', title: 'Storm Arwen Response', severity: 'Critical', duration: '72h', status: 'Resolved' },
                  { id: 'INC-2024-095', title: 'Deveron Flood Warning', severity: 'High', duration: '36h', status: 'Resolved' },
                  { id: 'INC-2024-092', title: 'A90 Multi-Vehicle RTC', severity: 'High', duration: '8h', status: 'Resolved' },
                  { id: 'INC-2024-088', title: 'Coastal Erosion Alert', severity: 'Medium', duration: '48h', status: 'Monitoring' },
                  { id: 'INC-2024-085', title: 'Power Grid Failure', severity: 'High', duration: '12h', status: 'Resolved' },
                  { id: 'INC-2024-079', title: 'Chemical Spill — Harbor', severity: 'Critical', duration: '24h', status: 'Resolved' },
                ].map((h, i) => (
                  <div key={h.id} className={`grid grid-cols-6 gap-2 px-4 py-3 text-xs items-center hover:bg-gray-50 dark:hover:bg-white/[0.02] ${i < 5 ? 'border-b border-gray-100 dark:border-white/5' : ''}`}>
                    <span className="font-mono text-gray-400">{h.id}</span>
                    <span className="col-span-2 font-semibold">{h.title}</span>
                    <span><span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold ${h.severity === 'Critical' ? 'bg-red-500/10 text-red-500' : h.severity === 'High' ? 'bg-orange-500/10 text-orange-500' : 'bg-amber-500/10 text-amber-500'}`}>{h.severity}</span></span>
                    <span className="font-mono text-gray-500">{h.duration}</span>
                    <span><span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold ${h.status === 'Resolved' ? 'bg-green-500/10 text-green-500' : 'bg-amber-500/10 text-amber-500'}`}>{h.status}</span></span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ═══════════════════════ RECORDS: AUDIT LOG ═══════════════════════ */}
          {sideKey === 'audit' && (
            <div className="space-y-6 animate-fade-up">
              <h1 className="text-xl font-bold flex items-center gap-2"><Clock className="w-5 h-5 text-gray-500" /> Audit Log</h1>
              <div className="card overflow-hidden">
                {[
                  { time: '15:12:04', user: 'H. Lazarus', action: 'Broadcasted alert: Flash Flood Warning', type: 'alert', ip: '86.142.xxx.xxx' },
                  { time: '15:10:22', user: 'System', action: 'AI auto-classified report #247 as Flood (94.2%)', type: 'ai', ip: '—' },
                  { time: '15:08:15', user: 'J. Morrison', action: 'Assigned 6 units to INC-2024-001', type: 'resource', ip: '82.214.xxx.xxx' },
                  { time: '15:05:33', user: 'S. Campbell', action: 'Updated shelter capacity — RGU Centre', type: 'shelter', ip: '94.128.xxx.xxx' },
                  { time: '14:58:41', user: 'System', action: 'River Dee gauge exceeded threshold (3.2m)', type: 'sensor', ip: '—' },
                  { time: '14:55:12', user: 'H. Lazarus', action: 'Created incident INC-2024-001', type: 'incident', ip: '86.142.xxx.xxx' },
                  { time: '14:42:08', user: 'A. Patel', action: 'Verified report #245 — Structural damage', type: 'report', ip: '78.150.xxx.xxx' },
                  { time: '14:30:00', user: 'System', action: 'Scheduled backup completed successfully', type: 'system', ip: '—' },
                ].map((log, i) => (
                  <div key={i} className={`flex items-center gap-4 px-4 py-3 text-xs hover:bg-gray-50 dark:hover:bg-white/[0.02] ${i < 7 ? 'border-b border-gray-100 dark:border-white/5' : ''}`}>
                    <span className="font-mono text-gray-400 w-16 flex-shrink-0">{log.time}</span>
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${log.type === 'alert' ? 'bg-red-500' : log.type === 'ai' ? 'bg-purple-500' : log.type === 'resource' ? 'bg-blue-500' : log.type === 'shelter' ? 'bg-green-500' : log.type === 'sensor' ? 'bg-cyan-500' : log.type === 'incident' ? 'bg-amber-500' : log.type === 'report' ? 'bg-orange-500' : 'bg-gray-500'}`} />
                    <span className="font-semibold w-24 flex-shrink-0">{log.user}</span>
                    <span className="flex-1">{log.action}</span>
                    <span className="font-mono text-gray-400 text-[10px]">{log.ip}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ═══════════════════════ RECORDS: DELIVERY ═══════════════════════ */}
          {sideKey === 'delivery' && (
            <div className="space-y-6 animate-fade-up">
              <h1 className="text-xl font-bold flex items-center gap-2"><Archive className="w-5 h-5 text-slate-500" /> Alert Delivery Status</h1>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <StatCard label="Total Sent" value={1847} icon={Send} color="blue" />
                <StatCard label="Delivered" value="98.2%" icon={CheckCircle} color="green" />
                <StatCard label="Read" value="76.4%" icon={Eye} color="purple" />
                <StatCard label="Failed" value={33} icon={AlertCircle} color="red" />
              </div>
              <div className="card overflow-hidden">
                <div className="px-4 py-3 bg-gray-50 dark:bg-white/[0.02] text-[10px] font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200 dark:border-white/5 grid grid-cols-6 gap-2">
                  <span className="col-span-2">Alert</span><span>Channel</span><span>Sent</span><span>Delivered</span><span>Read</span>
                </div>
                {[
                  { alert: 'Flash Flood Warning', channel: 'Push', sent: 892, delivered: 876, read: 654 },
                  { alert: 'Flash Flood Warning', channel: 'SMS', sent: 892, delivered: 889, read: 812 },
                  { alert: 'Flash Flood Warning', channel: 'Email', sent: 892, delivered: 834, read: 423 },
                  { alert: 'Storm Force Winds', channel: 'Push', sent: 756, delivered: 742, read: 598 },
                  { alert: 'Coastal Surge Advisory', channel: 'Push', sent: 421, delivered: 418, read: 312 },
                ].map((d, i) => (
                  <div key={`${d.alert}-${d.channel}`} className={`grid grid-cols-6 gap-2 px-4 py-3 text-xs items-center hover:bg-gray-50 dark:hover:bg-white/[0.02] ${i < 4 ? 'border-b border-gray-100 dark:border-white/5' : ''}`}>
                    <span className="col-span-2 font-semibold">{d.alert}</span>
                    <span className="text-gray-500">{d.channel}</span>
                    <span className="font-mono">{d.sent}</span>
                    <span className="font-mono text-green-500">{d.delivered}</span>
                    <span className="font-mono text-aegis-500">{d.read}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </main>
    </div>
  )
}
