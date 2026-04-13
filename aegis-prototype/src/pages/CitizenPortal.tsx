import { useState } from 'react'
import { TopNavbar } from '../components/Navbar'
import Sidebar from '../components/Sidebar'
import MapPlaceholder from '../components/MapPlaceholder'
import ReportCard from '../components/ReportCard'
import AlertCard from '../components/AlertCard'
import StatCard from '../components/StatCard'
import WeatherPanel from '../components/WeatherPanel'
import RiverGaugePanel from '../components/RiverGaugePanel'
import Chatbot from '../components/Chatbot'
import ReportForm from '../components/ReportForm'
import SOSButton from '../components/SOSButton'
import {
  MapPin, FileText, Home, Bell, Users, Activity, Shield, Phone, AlertTriangle,
  Droplets, Thermometer, Wind, Plus, MessageSquare, Search, Heart, Bot,
  BookOpen, Newspaper, ShieldAlert, Settings, User, ChevronRight, Clock,
  CheckCircle, Star, Eye, Lock, Globe, Volume2, Moon, Smartphone, Mail,
  Camera, Zap
} from 'lucide-react'

const MOCK_REPORTS = [
  { id: '1', type: 'Flood — River Dee Overflow', location: 'Aberdeen City Centre', severity: 'High', status: 'Urgent', time: '3 min ago', description: 'Major flooding reported along the River Dee. Water levels rising rapidly. Multiple roads submerged.', confidence: 92 },
  { id: '2', type: 'Structural Damage', location: 'Stonehaven', severity: 'Medium', status: 'Verified', time: '12 min ago', description: 'Building wall collapse on High Street following storm damage. Area cordoned off.', confidence: 87 },
  { id: '3', type: 'Power Outage', location: 'Inverurie', severity: 'Medium', status: 'Unverified', time: '28 min ago', description: 'Widespread power outage affecting residential area. Approximately 500 homes affected.', confidence: 74 },
  { id: '4', type: 'Road Blockage — Fallen Tree', location: 'A90 Northbound', severity: 'Low', status: 'Verified', time: '45 min ago', description: 'Large tree blocking both lanes of A90. Emergency services en route.', confidence: 95 },
  { id: '5', type: 'Coastal Erosion', location: 'Stonehaven Beach', severity: 'Low', status: 'Verified', time: '1 hour ago', description: 'Cliff path showing signs of erosion after heavy rainfall. Section cordoned off.', confidence: 88 },
]

const MOCK_ALERTS = [
  { id: '1', severity: 'critical', title: 'Flash Flood Warning', message: 'Severe flash flood warning for River Dee catchment. Immediate evacuation advised for Zone A residents.', area: 'Aberdeen City', time: '5 min ago', type: 'flood' },
  { id: '2', severity: 'high', title: 'Storm Force Winds', message: 'Storm force winds expected 80-90mph. Secure loose items and avoid travel.', area: 'Aberdeenshire', time: '1 hour ago', type: 'storm' },
  { id: '3', severity: 'medium', title: 'Coastal Surge Advisory', message: 'Elevated tide levels expected. Coastal areas may experience minor flooding.', area: 'East Coast', time: '2 hours ago', type: 'flood' },
]

const NEWS = [
  { id: 1, title: 'Storm Éowyn Aftermath: Cleanup Continues Across Aberdeenshire', source: 'BBC Scotland', time: '1 hour ago', tag: 'Breaking' },
  { id: 2, title: 'River Dee Levels Expected to Peak This Evening', source: 'SEPA', time: '2 hours ago', tag: 'Alert' },
  { id: 3, title: 'Aberdeen Council Opens Additional Emergency Shelters', source: 'Press & Journal', time: '3 hours ago', tag: 'Shelters' },
  { id: 4, title: 'Met Office Issues Yellow Warning for Heavy Rain', source: 'Met Office', time: '4 hours ago', tag: 'Weather' },
  { id: 5, title: 'Community Volunteers Rally to Support Flood-Hit Residents', source: 'Evening Express', time: '5 hours ago', tag: 'Community' },
]

const COMMUNITY_POSTS = [
  { user: 'Sarah M.', avatar: '👩', time: '5m ago', text: 'Anyone near Rosemount need sandbags? I have 20 spare.', type: 'offer', likes: 12, replies: 4 },
  { user: 'James K.', avatar: '👨', time: '12m ago', text: 'Road completely flooded on King Street near the Cathedral. Avoid!', type: 'alert', likes: 28, replies: 7 },
  { user: 'Fatima A.', avatar: '👩‍⚕️', time: '18m ago', text: 'I\'m a nurse — can help with first aid at Stonehaven shelter. DM me.', type: 'offer', likes: 15, replies: 3 },
  { user: 'David L.', avatar: '🧑', time: '25m ago', text: 'Power back on in Inverurie west side. Still out on east.', type: 'info', likes: 8, replies: 2 },
]

const PREPARE_ITEMS = [
  { title: 'Emergency Kit Checklist', desc: 'Torch, batteries, first aid, water, tinned food, radio, blankets', icon: Shield, done: 3, total: 8 },
  { title: 'Evacuation Plan', desc: 'Know your nearest shelter and multiple exit routes from your home', icon: MapPin, done: 2, total: 4 },
  { title: 'Emergency Contacts', desc: 'Family, neighbours, local council, emergency services', icon: Phone, done: 5, total: 5 },
  { title: 'Insurance & Documents', desc: 'Critical documents in waterproof bag, photo inventory', icon: FileText, done: 1, total: 3 },
]

export default function CitizenPortal() {
  const [activeKey, setActiveKey] = useState('home')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [showChatbot, setShowChatbot] = useState(false)
  const [showReportForm, setShowReportForm] = useState(false)
  const [reportFilter, setReportFilter] = useState('all')
  const [newsSearch, setNewsSearch] = useState('')

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-aegis-100/40 dark:from-gray-950 dark:via-gray-900 dark:to-aegis-950/30 text-gray-900 dark:text-gray-100">
      <TopNavbar onMenuToggle={() => setMobileOpen(!mobileOpen)} alertCount={3} />
      <Sidebar variant="citizen" activeKey={activeKey} onNavigate={setActiveKey} />

      <main className="pt-14 min-h-screen lg:pl-[220px] transition-all duration-300">
        <div className="w-full max-w-7xl mx-auto px-3 sm:px-4 lg:px-6 py-4 sm:py-6 space-y-6">
          {/* Emergency Banner */}
          <div className="bg-red-600 text-white px-4 py-3 rounded-xl flex items-center justify-center gap-2 text-sm font-semibold">
            <Phone className="w-4 h-4" /> In a life-threatening emergency, call 999 / 112
          </div>

          {/* ═══ DASHBOARD HOME ═══ */}
          {activeKey === 'home' && (
            <div className="space-y-6 animate-fade-up">
              <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-aegis-600 to-aegis-800 text-white p-6 sm:p-8">
                <div className="absolute top-0 right-0 w-64 h-64 rounded-full bg-white/5 -translate-y-1/2 translate-x-1/4" />
                <div className="relative z-10">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="px-2 py-0.5 rounded-full bg-green-500/20 text-green-200 text-[10px] font-bold flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" /> OPERATIONAL
                    </span>
                  </div>
                  <h1 className="text-2xl font-bold mb-1">Citizen Dashboard</h1>
                  <p className="text-sm opacity-80">Aberdeen & Aberdeenshire — Alert Level: <span className="text-amber-300 font-bold">AMBER</span></p>
                </div>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <StatCard label="Active Alerts" value={3} icon={Bell} color="red" trend="+1" />
                <StatCard label="Reports Today" value={24} icon={FileText} color="blue" trend="+5" />
                <StatCard label="Safe Zones" value={8} icon={Home} color="green" />
                <StatCard label="Online Citizens" value={312} icon={Users} color="purple" trend="+48" />
              </div>

              <div className="grid lg:grid-cols-3 gap-4">
                <div className="lg:col-span-2 space-y-3">
                  <h2 className="text-sm font-bold flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-500" /> Active Alerts</h2>
                  {MOCK_ALERTS.slice(0, 2).map(a => <AlertCard key={a.id} alert={a} />)}
                </div>
                <WeatherPanel />
              </div>

              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {[
                  { icon: FileText, label: 'Report Incident', desc: 'Submit a new emergency report', color: 'text-blue-500', bg: 'bg-blue-500/10', action: () => setShowReportForm(true) },
                  { icon: Bot, label: 'AI Assistant', desc: 'Get safety guidance & info', color: 'text-purple-500', bg: 'bg-purple-500/10', action: () => setShowChatbot(true) },
                  { icon: MapPin, label: 'Live Map', desc: 'View real-time incidents', color: 'text-green-500', bg: 'bg-green-500/10', action: () => setActiveKey('map') },
                  { icon: Home, label: 'Find Shelter', desc: 'Nearest safe zones', color: 'text-amber-500', bg: 'bg-amber-500/10', action: () => setActiveKey('shelters') },
                ].map(q => (
                  <button key={q.label} onClick={q.action} className="card p-4 text-left hover:shadow-md transition-all group">
                    <div className={`w-10 h-10 rounded-xl ${q.bg} flex items-center justify-center mb-3 group-hover:scale-105 transition-transform`}>
                      <q.icon className={`w-5 h-5 ${q.color}`} />
                    </div>
                    <h3 className="text-xs font-bold mb-0.5">{q.label}</h3>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400">{q.desc}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ═══ LIVE MAP ═══ */}
          {activeKey === 'map' && (
            <div className="space-y-6 animate-fade-up">
              <div className="flex items-center justify-between">
                <h1 className="text-xl font-bold">Live Map — Aberdeen & Shire</h1>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-50 dark:bg-white/[0.03] border border-gray-200 dark:border-white/5">
                    <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                    <span className="text-[10px] font-bold text-green-600 dark:text-green-400">LIVE</span>
                  </div>
                </div>
              </div>
              <MapPlaceholder height="500px" />
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard label="Active Reports" value={24} icon={FileText} color="blue" />
                <StatCard label="Active Alerts" value={3} icon={Bell} color="red" />
                <StatCard label="Safe Zones" value={8} icon={Home} color="green" />
                <StatCard label="People Safe" value="1.2K" icon={Users} color="purple" />
              </div>
              {/* Map Legend */}
              <div className="card p-4">
                <h3 className="text-xs font-bold mb-3">Map Legend</h3>
                <div className="flex flex-wrap gap-4">
                  {[
                    { color: 'bg-red-500', label: 'Critical Incident' },
                    { color: 'bg-orange-500', label: 'High Severity' },
                    { color: 'bg-amber-500', label: 'Medium Severity' },
                    { color: 'bg-blue-500', label: 'Low Severity' },
                    { color: 'bg-green-500', label: 'Safe Zone / Shelter' },
                    { color: 'bg-purple-500', label: 'AI Prediction' },
                  ].map(l => (
                    <div key={l.label} className="flex items-center gap-1.5">
                      <span className={`w-2.5 h-2.5 rounded-full ${l.color}`} />
                      <span className="text-[10px] text-gray-500 dark:text-gray-400">{l.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ═══ REPORTS ═══ */}
          {activeKey === 'reports' && (
            <div className="space-y-4 animate-fade-up">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <h1 className="text-xl font-bold">Incident Reports</h1>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                    <input placeholder="Search reports..." className="input pl-9 py-2 text-xs w-48" />
                  </div>
                  <button onClick={() => setShowReportForm(true)} className="btn-primary text-xs px-3 py-2 flex items-center gap-1.5">
                    <Plus className="w-3.5 h-3.5" /> Report
                  </button>
                </div>
              </div>
              <div className="flex gap-1.5">
                {['all', 'High', 'Medium', 'Low'].map(f => (
                  <button key={f} onClick={() => setReportFilter(f)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all ${reportFilter === f ? 'bg-aegis-500 text-white' : 'bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-white/10'}`}>
                    {f}
                  </button>
                ))}
              </div>
              <div className="grid gap-3">
                {MOCK_REPORTS.filter(r => reportFilter === 'all' || r.severity === reportFilter).map(r => <ReportCard key={r.id} report={r} />)}
              </div>
            </div>
          )}

          {/* ═══ ALERTS ═══ */}
          {activeKey === 'alerts' && (
            <div className="space-y-4 animate-fade-up">
              <h1 className="text-xl font-bold">Active Alerts</h1>
              <div className="flex gap-2">
                {[
                  { label: 'Critical', count: 1, color: 'bg-red-500' },
                  { label: 'High', count: 1, color: 'bg-orange-500' },
                  { label: 'Medium', count: 1, color: 'bg-amber-500' },
                ].map(s => (
                  <div key={s.label} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gray-50 dark:bg-white/[0.03] border border-gray-200 dark:border-white/5">
                    <span className={`w-2 h-2 rounded-full ${s.color}`} />
                    <span className="text-[10px] font-bold">{s.count} {s.label}</span>
                  </div>
                ))}
              </div>
              <div className="grid gap-3">
                {MOCK_ALERTS.map(a => <AlertCard key={a.id} alert={a} />)}
              </div>
            </div>
          )}

          {/* ═══ SHELTERS ═══ */}
          {activeKey === 'shelters' && (
            <div className="space-y-4 animate-fade-up">
              <h1 className="text-xl font-bold">Safe Zones & Shelters</h1>
              <MapPlaceholder height="300px" label="Shelter Locations" />
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {[
                  { name: 'Aberdeen Community Centre', type: 'Emergency Shelter', capacity: 200, max: 350, status: 'Open', amenities: ['Water', 'First Aid', 'Power', 'Wi-Fi'], distance: '0.8 km' },
                  { name: 'Stonehaven Town Hall', type: 'Evacuation Point', capacity: 89, max: 150, status: 'Open', amenities: ['Water', 'First Aid', 'Blankets'], distance: '2.4 km' },
                  { name: 'Inverurie Sports Complex', type: 'Emergency Shelter', capacity: 0, max: 500, status: 'Standby', amenities: ['Water', 'Power', 'Kitchen', 'Medical'], distance: '5.1 km' },
                  { name: 'Westhill Community Centre', type: 'Rest Centre', capacity: 45, max: 120, status: 'Open', amenities: ['Water', 'Food', 'Wi-Fi'], distance: '3.2 km' },
                  { name: 'Portlethen Academy', type: 'Emergency Shelter', capacity: 0, max: 300, status: 'Standby', amenities: ['Water', 'Power', 'Kitchen'], distance: '4.7 km' },
                ].map(s => (
                  <div key={s.name} className="card p-4 hover:shadow-md transition-shadow">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Home className="w-4 h-4 text-green-500" />
                        <span className={`badge text-[10px] ${s.status === 'Open' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'}`}>{s.status}</span>
                      </div>
                      <span className="text-[10px] text-gray-500 flex items-center gap-1"><MapPin className="w-3 h-3" />{s.distance}</span>
                    </div>
                    <h3 className="font-bold text-sm mb-1">{s.name}</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">{s.type}</p>
                    <div className="flex flex-wrap gap-1 mb-2">
                      {s.amenities.map(a => (
                        <span key={a} className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">{a}</span>
                      ))}
                    </div>
                    <div className="flex justify-between text-[10px] text-gray-500 dark:text-gray-400 mb-1"><span>Capacity</span><span>{s.capacity} / {s.max}</span></div>
                    <div className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${s.capacity / s.max > 0.8 ? 'bg-red-500' : s.capacity / s.max > 0.5 ? 'bg-amber-500' : 'bg-green-500'}`} style={{ width: `${(s.capacity / s.max) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ═══ COMMUNITY ═══ */}
          {activeKey === 'community' && (
            <div className="space-y-4 animate-fade-up">
              <h1 className="text-xl font-bold">Community Hub</h1>
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {[
                  { title: 'Offer Help', desc: 'Volunteer skills, shelter, supplies', icon: '🤝', color: 'border-green-500', count: 24 },
                  { title: 'Request Help', desc: 'Transport, supplies, shelter', icon: '🆘', color: 'border-red-500', count: 8 },
                  { title: 'Community Chat', desc: 'Live local discussion', icon: '💬', color: 'border-blue-500', count: 156 },
                  { title: 'Resource Board', desc: 'Available resources', icon: '📋', color: 'border-amber-500', count: 42 },
                ].map(c => (
                  <div key={c.title} className={`card p-4 border-l-4 ${c.color} hover:shadow-md transition-shadow cursor-pointer`}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-2xl">{c.icon}</span>
                      <span className="text-[10px] font-bold text-gray-400">{c.count} active</span>
                    </div>
                    <h3 className="font-bold text-sm mb-0.5">{c.title}</h3>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400">{c.desc}</p>
                  </div>
                ))}
              </div>

              <div className="card p-5">
                <h3 className="text-xs font-bold mb-3 flex items-center gap-2"><MessageSquare className="w-4 h-4 text-blue-500" /> Community Feed</h3>
                <div className="space-y-3">
                  {COMMUNITY_POSTS.map((p, i) => (
                    <div key={i} className="p-3 rounded-xl bg-gray-50 dark:bg-white/[0.02] border border-gray-200 dark:border-gray-700">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-lg">{p.avatar}</span>
                        <div className="flex-1">
                          <span className="text-xs font-bold">{p.user}</span>
                          <span className="text-[10px] text-gray-400 ml-2">{p.time}</span>
                        </div>
                        <span className={`badge text-[8px] ${p.type === 'offer' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : p.type === 'alert' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'}`}>{p.type}</span>
                      </div>
                      <p className="text-xs text-gray-700 dark:text-gray-300 mb-2">{p.text}</p>
                      <div className="flex items-center gap-4 text-[10px] text-gray-500">
                        <span className="flex items-center gap-1 cursor-pointer hover:text-red-500"><Heart className="w-3 h-3" /> {p.likes}</span>
                        <span className="flex items-center gap-1 cursor-pointer hover:text-blue-500"><MessageSquare className="w-3 h-3" /> {p.replies}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ═══ RISK ASSESSMENT ═══ */}
          {activeKey === 'risk' && (
            <div className="space-y-4 animate-fade-up">
              <h1 className="text-xl font-bold">Risk Assessment</h1>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {[
                  { type: 'Flood Risk', level: 'High', pct: 78, desc: 'River levels elevated. Potential for overflow in low-lying areas.', color: 'text-red-500', bg: 'bg-red-500' },
                  { type: 'Storm Damage', level: 'Medium', pct: 55, desc: 'Wind speeds reducing but structural risk remains.', color: 'text-amber-500', bg: 'bg-amber-500' },
                  { type: 'Power Outage', level: 'Medium', pct: 42, desc: 'Ongoing restoration. 500 homes still affected.', color: 'text-orange-500', bg: 'bg-orange-500' },
                  { type: 'Landslide', level: 'Low', pct: 25, desc: 'Saturated ground in hilly areas. Monitor slopes.', color: 'text-blue-500', bg: 'bg-blue-500' },
                  { type: 'Coastal Surge', level: 'Medium', pct: 60, desc: 'Next high tide 18:00. Elevated levels expected.', color: 'text-cyan-500', bg: 'bg-cyan-500' },
                  { type: 'Transport', level: 'High', pct: 72, desc: 'Multiple road closures. Rail suspended.', color: 'text-purple-500', bg: 'bg-purple-500' },
                ].map(r => (
                  <div key={r.type} className="card p-4">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-xs font-bold">{r.type}</h3>
                      <span className={`text-[10px] font-bold ${r.color}`}>{r.level}</span>
                    </div>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400 mb-3">{r.desc}</p>
                    <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div className={`h-full ${r.bg} rounded-full transition-all`} style={{ width: `${r.pct}%` }} />
                    </div>
                    <p className="text-[9px] text-gray-400 mt-1 text-right">{r.pct}% risk</p>
                  </div>
                ))}
              </div>
              <RiverGaugePanel />
            </div>
          )}

          {/* ═══ EMERGENCY KIT ═══ */}
          {activeKey === 'emergency' && (
            <div className="space-y-4 animate-fade-up">
              <h1 className="text-xl font-bold">Emergency Kit & Resources</h1>
              <div className="card p-6 text-center border-2 border-red-500/20">
                <Phone className="w-12 h-12 text-red-500 mx-auto mb-3" />
                <h2 className="font-bold text-lg mb-1">Emergency SOS</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">Send an SOS alert with your GPS location to emergency responders</p>
                <button className="bg-red-600 hover:bg-red-700 text-white px-8 py-3 rounded-xl font-bold text-sm transition-colors shadow-lg shadow-red-500/20">
                  🆘 SEND SOS ALERT
                </button>
                <p className="text-[10px] text-gray-400 mt-3">For life-threatening emergencies, always call 999 / 112</p>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                {[
                  { title: 'Emergency Contacts', desc: '999 (UK) · 112 (EU) · 111 (NHS)', icon: Phone },
                  { title: 'First Aid Guide', desc: 'CPR, bleeding, shock, burns', icon: Heart },
                  { title: 'Evacuation Routes', desc: 'Pre-planned routes to nearest shelters', icon: MapPin },
                  { title: 'Medical Information', desc: 'Store allergies, medications, blood type', icon: ShieldAlert },
                ].map(e => (
                  <div key={e.title} className="card p-4 cursor-pointer hover:shadow-md transition-shadow group">
                    <e.icon className="w-5 h-5 text-aegis-500 mb-2" />
                    <h3 className="text-xs font-bold mb-0.5">{e.title}</h3>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400">{e.desc}</p>
                    <ChevronRight className="w-3.5 h-3.5 text-gray-400 mt-2 group-hover:translate-x-0.5 transition-transform" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ═══ PREPARE ═══ */}
          {activeKey === 'prepare' && (
            <div className="space-y-4 animate-fade-up">
              <h1 className="text-xl font-bold">Preparedness Guide</h1>
              <div className="card p-5">
                <h3 className="text-sm font-bold mb-4">Your Preparedness Score</h3>
                <div className="flex items-center gap-4 mb-4">
                  <div className="relative w-20 h-20">
                    <svg className="w-20 h-20 -rotate-90" viewBox="0 0 100 100">
                      <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="8" className="text-gray-200 dark:text-gray-700" />
                      <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="8" className="text-aegis-500" strokeDasharray={`${(11/20)*264} 264`} strokeLinecap="round" />
                    </svg>
                    <span className="absolute inset-0 flex items-center justify-center text-lg font-bold">55%</span>
                  </div>
                  <div>
                    <p className="text-sm font-bold">11 of 20 items completed</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Complete all items to be fully prepared</p>
                  </div>
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                {PREPARE_ITEMS.map(p => (
                  <div key={p.title} className="card p-4">
                    <p.icon className="w-5 h-5 text-aegis-500 mb-2" />
                    <h3 className="text-xs font-bold mb-0.5">{p.title}</h3>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400 mb-2">{p.desc}</p>
                    <div className="flex justify-between text-[9px] text-gray-400 mb-1">
                      <span>{p.done}/{p.total} complete</span>
                      <span>{Math.round((p.done/p.total)*100)}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${p.done === p.total ? 'bg-green-500' : 'bg-aegis-500'}`} style={{ width: `${(p.done/p.total)*100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ═══ NEWS ═══ */}
          {activeKey === 'news' && (
            <div className="space-y-4 animate-fade-up">
              <div className="flex items-center justify-between">
                <h1 className="text-xl font-bold">News Feed</h1>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                  <input value={newsSearch} onChange={e => setNewsSearch(e.target.value)} placeholder="Search news..." className="input pl-9 py-2 text-xs w-48" />
                </div>
              </div>
              <div className="space-y-3">
                {NEWS.filter(n => !newsSearch || n.title.toLowerCase().includes(newsSearch.toLowerCase())).map(n => (
                  <div key={n.id} className="card p-4 hover:shadow-md transition-shadow cursor-pointer">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className={`badge text-[9px] ${n.tag === 'Breaking' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' : n.tag === 'Alert' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'}`}>{n.tag}</span>
                      <span className="text-[10px] text-gray-400">{n.source}</span>
                    </div>
                    <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-1">{n.title}</h3>
                    <span className="text-[10px] text-gray-400 flex items-center gap-1"><Clock className="w-3 h-3" />{n.time}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ═══ MESSAGES ═══ */}
          {activeKey === 'messages' && (
            <div className="space-y-4 animate-fade-up">
              <h1 className="text-xl font-bold">Messages</h1>
              <div className="card p-5 space-y-3">
                {[
                  { from: 'Emergency Services', msg: 'Evacuation order for Zone A has been lifted. Please monitor alerts for further updates.', time: '14 min ago', unread: true, avatar: '🚨' },
                  { from: 'Community Board', msg: 'Volunteer drivers needed for supply delivery to Stonehaven area.', time: '1h ago', unread: true, avatar: '👥' },
                  { from: 'AEGIS System', msg: 'Your report #AEG-2847 has been verified and classified by AI as HIGH severity — Flood.', time: '3h ago', unread: false, avatar: '🤖' },
                  { from: 'Aberdeen Council', msg: 'Additional emergency shelters now open at Westhill Community Centre.', time: '4h ago', unread: false, avatar: '🏛️' },
                  { from: 'Safety Alert', msg: 'Your scheduled safety check-in is overdue. Please confirm you are safe.', time: '6h ago', unread: false, avatar: '⚠️' },
                ].map((m, i) => (
                  <div key={i} className={`p-3 rounded-xl border transition-colors cursor-pointer hover:bg-gray-50 dark:hover:bg-white/[0.02] ${m.unread ? 'border-aegis-500/30 bg-aegis-500/[0.03]' : 'border-gray-200 dark:border-white/5'}`}>
                    <div className="flex items-start gap-3">
                      <span className="text-lg">{m.avatar}</span>
                      <div className="flex-1">
                        <div className="flex justify-between items-start mb-1">
                          <span className="text-xs font-bold flex items-center gap-1.5">{m.from} {m.unread && <span className="w-1.5 h-1.5 rounded-full bg-aegis-500" />}</span>
                          <span className="text-[10px] text-gray-500">{m.time}</span>
                        </div>
                        <p className="text-xs text-gray-600 dark:text-gray-400">{m.msg}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ═══ SAFETY CHECK-IN ═══ */}
          {activeKey === 'safety' && (
            <div className="space-y-4 animate-fade-up">
              <h1 className="text-xl font-bold">Safety Check-In</h1>
              <div className="card p-6 text-center">
                <Heart className="w-12 h-12 text-green-500 mx-auto mb-3" />
                <h2 className="font-bold text-lg mb-1">Are You Safe?</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">Let emergency services and family know your current status</p>
                <div className="flex justify-center gap-3 mb-6">
                  <button className="bg-green-600 hover:bg-green-700 text-white px-8 py-3 rounded-xl font-bold text-sm transition-colors flex items-center gap-2"><CheckCircle className="w-4 h-4" /> I'm Safe</button>
                  <button className="bg-amber-600 hover:bg-amber-700 text-white px-8 py-3 rounded-xl font-bold text-sm transition-colors flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Need Help</button>
                </div>
                <p className="text-[10px] text-gray-400">Last check-in: 2 hours ago · Next scheduled: 18:00</p>
              </div>
              <div className="card p-5">
                <h3 className="text-xs font-bold mb-3">Check-In History</h3>
                <div className="space-y-2">
                  {[
                    { status: 'Safe', time: 'Today, 14:00', method: 'Manual' },
                    { status: 'Safe', time: 'Today, 10:00', method: 'Scheduled' },
                    { status: 'Safe', time: 'Yesterday, 22:00', method: 'Manual' },
                    { status: 'Needed Help', time: 'Yesterday, 16:00', method: 'SOS Trigger' },
                  ].map((c, i) => (
                    <div key={i} className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-800 last:border-0">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${c.status === 'Safe' ? 'bg-green-500' : 'bg-amber-500'}`} />
                        <span className="text-xs font-semibold">{c.status}</span>
                      </div>
                      <span className="text-[10px] text-gray-400">{c.time} · {c.method}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ═══ PROFILE ═══ */}
          {activeKey === 'profile' && (
            <div className="space-y-4 animate-fade-up">
              <h1 className="text-xl font-bold">My Profile</h1>
              <div className="card p-6">
                <div className="flex items-center gap-4 mb-6">
                  <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-aegis-500 to-purple-600 flex items-center justify-center text-3xl shadow-lg">
                    👤
                  </div>
                  <div>
                    <h2 className="font-bold text-lg">Citizen User</h2>
                    <p className="text-xs text-gray-500 dark:text-gray-400">citizen@email.com</p>
                    <p className="text-[10px] text-gray-400 mt-1">Member since December 2025 · Aberdeen City</p>
                  </div>
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  {[
                    { label: 'Full Name', value: 'Citizen User', type: 'text' },
                    { label: 'Email', value: 'citizen@email.com', type: 'email' },
                    { label: 'Phone', value: '+44 7700 900000', type: 'tel' },
                    { label: 'Location', value: 'Aberdeen City, AB10', type: 'text' },
                    { label: 'Country', value: 'United Kingdom 🇬🇧', type: 'text' },
                    { label: 'Language', value: 'English', type: 'text' },
                  ].map(f => (
                    <div key={f.label}>
                      <label className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide block mb-1">{f.label}</label>
                      <input type={f.type} defaultValue={f.value} className="input text-xs py-2" />
                    </div>
                  ))}
                </div>
                <button className="btn-primary mt-4 text-xs px-4 py-2">Save Changes</button>
              </div>
            </div>
          )}

          {/* ═══ SECURITY ═══ */}
          {activeKey === 'security' && (
            <div className="space-y-4 animate-fade-up">
              <h1 className="text-xl font-bold flex items-center gap-2"><Lock className="w-5 h-5 text-aegis-500" /> Security</h1>
              <div className="card p-6 space-y-4">
                <h3 className="text-sm font-bold">Change Password</h3>
                <div className="space-y-3 max-w-md">
                  <div><label className="text-[10px] font-bold text-gray-500 block mb-1">Current Password</label><input type="password" className="input text-xs py-2" /></div>
                  <div><label className="text-[10px] font-bold text-gray-500 block mb-1">New Password</label><input type="password" className="input text-xs py-2" /></div>
                  <div><label className="text-[10px] font-bold text-gray-500 block mb-1">Confirm New Password</label><input type="password" className="input text-xs py-2" /></div>
                  <div className="flex gap-2">
                    {['8+ chars', 'Uppercase', 'Number', 'Symbol'].map(r => (
                      <span key={r} className="badge text-[8px] bg-gray-100 dark:bg-gray-800 text-gray-500">{r}</span>
                    ))}
                  </div>
                  <button className="btn-primary text-xs px-4 py-2">Update Password</button>
                </div>
              </div>
              <div className="card p-6">
                <h3 className="text-sm font-bold mb-3">Active Sessions</h3>
                <div className="space-y-2">
                  {[
                    { device: 'Chrome — Windows 11', location: 'Aberdeen, UK', time: 'Current session', current: true },
                    { device: 'Safari — iPhone 15', location: 'Aberdeen, UK', time: '2 hours ago', current: false },
                  ].map((s, i) => (
                    <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-gray-50 dark:bg-white/[0.02]">
                      <div className="flex items-center gap-2">
                        <Smartphone className="w-4 h-4 text-gray-500" />
                        <div>
                          <p className="text-xs font-bold">{s.device}</p>
                          <p className="text-[10px] text-gray-400">{s.location} · {s.time}</p>
                        </div>
                      </div>
                      {s.current ? <span className="badge text-[8px] bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">Current</span> : <button className="text-[10px] text-red-500 font-bold">Revoke</button>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ═══ SETTINGS ═══ */}
          {activeKey === 'settings' && (
            <div className="space-y-4 animate-fade-up">
              <h1 className="text-xl font-bold flex items-center gap-2"><Settings className="w-5 h-5 text-gray-500" /> Settings</h1>
              <div className="card p-6">
                <h3 className="text-sm font-bold mb-4">Notification Preferences</h3>
                <div className="space-y-3">
                  {[
                    { label: 'Email Alerts', desc: 'Receive alerts via email', enabled: true },
                    { label: 'Push Notifications', desc: 'Browser push notifications', enabled: true },
                    { label: 'SMS Alerts', desc: 'Critical alerts via SMS', enabled: false },
                    { label: 'Community Updates', desc: 'Posts from your community', enabled: true },
                    { label: 'Weekly Summary', desc: 'Weekly safety report', enabled: false },
                  ].map(n => (
                    <div key={n.label} className="flex items-center justify-between p-3 rounded-xl bg-gray-50 dark:bg-white/[0.02]">
                      <div>
                        <p className="text-xs font-bold">{n.label}</p>
                        <p className="text-[10px] text-gray-500 dark:text-gray-400">{n.desc}</p>
                      </div>
                      <div className={`w-10 h-5 rounded-full transition-colors relative cursor-pointer ${n.enabled ? 'bg-aegis-500' : 'bg-gray-300 dark:bg-gray-600'}`}>
                        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${n.enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="card p-6">
                <h3 className="text-sm font-bold mb-4">Accessibility</h3>
                <div className="space-y-3">
                  {[
                    { label: 'Audio Alerts', desc: 'Play sound for critical alerts', enabled: true },
                    { label: 'Live Captions', desc: 'Show text for audio content', enabled: false },
                    { label: 'High Contrast', desc: 'Increase visual contrast', enabled: false },
                    { label: 'Reduced Motion', desc: 'Minimise animations', enabled: false },
                  ].map(a => (
                    <div key={a.label} className="flex items-center justify-between p-3 rounded-xl bg-gray-50 dark:bg-white/[0.02]">
                      <div>
                        <p className="text-xs font-bold">{a.label}</p>
                        <p className="text-[10px] text-gray-500 dark:text-gray-400">{a.desc}</p>
                      </div>
                      <div className={`w-10 h-5 rounded-full transition-colors relative cursor-pointer ${a.enabled ? 'bg-aegis-500' : 'bg-gray-300 dark:bg-gray-600'}`}>
                        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${a.enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* SOS Button */}
      <SOSButton />

      {/* Chatbot toggle */}
      {showChatbot && <Chatbot onClose={() => setShowChatbot(false)} />}
      {!showChatbot && (
        <button onClick={() => setShowChatbot(true)} className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-2xl bg-gradient-to-br from-aegis-500 to-aegis-700 text-white shadow-xl shadow-aegis-500/30 flex items-center justify-center hover:scale-105 transition-transform">
          <Bot className="w-6 h-6" />
        </button>
      )}

      {/* Report Form Modal */}
      {showReportForm && <ReportForm onClose={() => setShowReportForm(false)} />}
    </div>
  )
}
