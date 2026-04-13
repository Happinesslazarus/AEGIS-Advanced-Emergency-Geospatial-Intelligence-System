import { Link } from 'react-router-dom'
import { Navbar } from '../components/Navbar'
import AlertCard from '../components/AlertCard'
import { AlertTriangle, Bell, MapPin, Filter, ChevronDown } from 'lucide-react'
import { useState } from 'react'

const ALL_ALERTS = [
  { id: '1', severity: 'critical', title: 'Flash Flood Warning — River Dee', message: 'Severe flash flood warning for River Dee catchment area. Water levels 2.3m above normal. Immediate evacuation advised for Zone A residents. Emergency services deployed.', area: 'Aberdeen City', time: '5 min ago', type: 'flood' },
  { id: '2', severity: 'critical', title: 'Structural Collapse Risk', message: 'Multiple buildings in Stonehaven showing structural instability following storm damage. 200m exclusion zone established. Structural engineers en route.', area: 'Stonehaven', time: '18 min ago', type: 'structural' },
  { id: '3', severity: 'high', title: 'Storm Force Winds', message: 'Storm force winds expected 80-90mph across Aberdeenshire. Secure loose items, avoid unnecessary travel. Schools closed in affected areas.', area: 'Aberdeenshire', time: '1 hour ago', type: 'storm' },
  { id: '4', severity: 'high', title: 'Coastal Flooding', message: 'High tide combined with storm surge expected to cause coastal flooding. Beach areas and promenades closed.', area: 'Aberdeen Beach', time: '2 hours ago', type: 'flood' },
  { id: '5', severity: 'medium', title: 'Power Grid Warning', message: 'Rolling power outages possible due to damaged infrastructure. Essential services on backup power. National Grid engineers working to restore.', area: 'Northeast Scotland', time: '3 hours ago', type: 'power' },
  { id: '6', severity: 'medium', title: 'Coastal Surge Advisory', message: 'Elevated tide levels for the next 6 hours. Coastal areas may experience minor flooding. Monitor local conditions.', area: 'East Coast', time: '4 hours ago', type: 'flood' },
  { id: '7', severity: 'low', title: 'Transport Disruption', message: 'Multiple road closures on A90, A96 due to fallen trees and debris. Rail services suspended Aberdeen-Inverness line.', area: 'Grampian Region', time: '5 hours ago', type: 'transport' },
  { id: '8', severity: 'low', title: 'Water Quality Advisory', message: 'Well water in rural areas may be affected by flooding. Boil water advisory in effect for Deeside communities.', area: 'Deeside', time: '6 hours ago', type: 'health' },
]

export default function AlertsPage() {
  const [filter, setFilter] = useState('all')

  const filtered = filter === 'all' ? ALL_ALERTS : ALL_ALERTS.filter(a => a.severity === filter)

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-aegis-100/40 dark:from-gray-950 dark:via-gray-900 dark:to-aegis-950/30 text-gray-900 dark:text-gray-100">
      <Navbar />

      <main className="pt-20 pb-16">
        <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 space-y-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2"><Bell className="w-6 h-6 text-aegis-500" /> Active Alerts</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Real-time emergency alerts for Aberdeen & Aberdeenshire</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 flex items-center gap-1"><Filter className="w-3 h-3" /> Filter:</span>
              {['all', 'critical', 'high', 'medium', 'low'].map(f => (
                <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all ${filter === f ? 'bg-aegis-500 text-white shadow-sm' : 'bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-white/10'}`}>
                  {f}
                </button>
              ))}
            </div>
          </div>

          {/* Summary */}
          <div className="flex gap-3 flex-wrap">
            {[
              { label: 'Critical', count: ALL_ALERTS.filter(a => a.severity === 'critical').length, color: 'bg-red-500' },
              { label: 'High', count: ALL_ALERTS.filter(a => a.severity === 'high').length, color: 'bg-orange-500' },
              { label: 'Medium', count: ALL_ALERTS.filter(a => a.severity === 'medium').length, color: 'bg-amber-500' },
              { label: 'Low', count: ALL_ALERTS.filter(a => a.severity === 'low').length, color: 'bg-blue-500' },
            ].map(s => (
              <div key={s.label} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-50 dark:bg-white/[0.03] border border-gray-200 dark:border-white/5">
                <span className={`w-2 h-2 rounded-full ${s.color}`} />
                <span className="text-xs font-semibold">{s.count} {s.label}</span>
              </div>
            ))}
          </div>

          {/* Alert List */}
          <div className="space-y-3">
            {filtered.map(a => <AlertCard key={a.id} alert={a} />)}
          </div>

          {filtered.length === 0 && (
            <div className="card p-8 text-center">
              <AlertTriangle className="w-8 h-8 text-gray-400 mx-auto mb-2" />
              <p className="text-sm text-gray-500">No alerts matching this filter.</p>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
