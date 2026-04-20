/**
 * Operator field-resource management console. Manages deployment zones with
 * a 5-stage pipeline (Requested -> Staging -> Transit -> On-Site -> De-Mob),
 * AI-generated resource recommendations per hazard type, mutual-aid partner
 * tracking, and ops log entries. Includes an inline DisasterMap for
 * geographic context.
 *
 * State is owned by AdminPage.tsx and passed as props + API helpers.
 *
 * - Rendered inside AdminPage.tsx when the Resources view is active
 * - Uses apiGetDeployments, apiDeployResources, apiRecallResources, etc.
 * - DisasterMap lazy-loaded to avoid blocking the initial admin page render
 * */

import React, { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from 'react'
import {
  Navigation, RefreshCw, Layers, Package, AlertTriangle, FileText, Map, Clock,
  Truck, Flame, Anchor, Brain, Eye, ChevronDown, ChevronRight, Search,
  Activity, Shield, ArrowUpDown, ArrowUp, ArrowDown, Users, CheckCircle,
  Radio, Target, Crosshair, LayoutGrid, List, Keyboard, Plus, Trash2, X,
  Link2, Cpu, MapPin, Zap, Edit3, Save, BarChart3, Sparkles, AlertCircle,
  TrendingUp, Hash, Siren, HeartPulse, Wind, Droplets, Mountain, Building2,
  Thermometer, Sun, Leaf, type LucideIcon
} from 'lucide-react'
const DisasterMap = lazy(() => import('../shared/DisasterMap'))
import { apiGetDeployments, apiDeployResources, apiRecallResources, apiAuditLog, apiCreateDeployment, apiDeleteDeployment, apiUpdateDeployment, apiGetDeploymentAssets, apiAddDeploymentAsset, apiUpdateDeploymentAsset, apiDeleteDeploymentAsset, apiAcknowledgeDraft, apiAddOpsLog, apiToggleMutualAid } from '../../utils/api'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'

interface Props {
  deployments: any[]
  setDeployments: React.Dispatch<React.SetStateAction<any[]>>
  reports: any[]
  auditLog: any[]
  setAuditLog: React.Dispatch<React.SetStateAction<any[]>>
  deployReason: string
  setDeployReason: (v: string) => void
  deployReasonRef: React.MutableRefObject<string>
  loc: any
  activeLocation: string
  user: any
  pushNotification: (msg: string, type?: 'success' | 'warning' | 'error' | 'info' | string, duration?: number) => void | number
  askConfirm: (title: string, message: string, type: string, action: () => void) => void
}

//5-stage deployment pipeline. Zones move through these states as resources are mobilised.
//Returned as a function so labels can be translated per the active locale.
function getPipeline(lang: string) {
  return [
    { key: 'requested', label: t('resource.request', lang), icon: Radio },
    { key: 'staging', label: t('resource.staging', lang), icon: Package },
    { key: 'transit', label: t('resource.transit', lang), icon: Truck },
    { key: 'on_site', label: t('resource.onSite', lang), icon: Target },
    { key: 'demob', label: t('resource.deMob', lang), icon: ArrowDown },
  ] as const
}

//Sort order helpers for priority columns in the deployment table.
const P_ORDER: Record<string, number> = { Critical: 4, High: 3, Medium: 2, Low: 1 }
const P_DOT: Record<string, string> = { Critical: 'bg-red-500', High: 'bg-amber-500', Medium: 'bg-blue-500', Low: 'bg-slate-400' }
const P_PILL: Record<string, string> = {
  Critical: 'bg-red-500/10 text-red-600 dark:text-red-400 ring-red-500/20',
  High: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-amber-500/20',
  Medium: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 ring-blue-500/20',
  Low: 'bg-slate-500/10 text-slate-600 dark:text-slate-400 ring-slate-500/20',
}

//Per-hazard display metadata for the AI recommendation UI.
//Icon + gradient shown on the recommendation card, color used for the hazard label.
/* Client-side Resource Recommendation Engine*/
const HAZARD_CATEGORIES: Record<string, { label: string; icon: LucideIcon; color: string; gradient: string }> = {
  flood: { label: 'Flood', icon: Droplets, color: 'text-blue-600', gradient: 'from-blue-500/20 to-cyan-500/20' },
  severe_storm: { label: 'Severe Storm', icon: Wind, color: 'text-indigo-600', gradient: 'from-indigo-500/20 to-purple-500/20' },
  heatwave: { label: 'Heatwave', icon: Thermometer, color: 'text-orange-600', gradient: 'from-orange-500/20 to-red-500/20' },
  wildfire: { label: 'Wildfire', icon: Flame, color: 'text-red-600', gradient: 'from-red-500/20 to-orange-500/20' },
  landslide: { label: 'Landslide', icon: Mountain, color: 'text-amber-700', gradient: 'from-amber-500/20 to-yellow-500/20' },
  earthquake: { label: 'Earthquake', icon: Activity, color: 'text-amber-600', gradient: 'from-amber-500/20 to-red-500/20' },
  tornado: { label: 'Tornado', icon: Wind, color: 'text-gray-700', gradient: 'from-gray-500/20 to-slate-500/20' },
  tsunami: { label: 'Tsunami', icon: Droplets, color: 'text-cyan-700', gradient: 'from-cyan-500/20 to-blue-500/20' },
  volcanic: { label: 'Volcanic', icon: Mountain, color: 'text-red-700', gradient: 'from-red-600/20 to-orange-500/20' },
  drought: { label: 'Drought', icon: Sun, color: 'text-yellow-700', gradient: 'from-yellow-500/20 to-amber-500/20' },
  avalanche: { label: 'Avalanche', icon: Mountain, color: 'text-sky-700', gradient: 'from-sky-500/20 to-blue-500/20' },
  road_damage: { label: 'Road Damage', icon: Navigation, color: 'text-gray-600', gradient: 'from-gray-500/20 to-slate-500/20' },
  bridge_damage: { label: 'Bridge Damage', icon: Building2, color: 'text-slate-700', gradient: 'from-slate-500/20 to-gray-500/20' },
  building_collapse: { label: 'Building Collapse', icon: Building2, color: 'text-stone-700', gradient: 'from-stone-500/20 to-gray-500/20' },
  gas_leak: { label: 'Gas Leak', icon: AlertTriangle, color: 'text-yellow-600', gradient: 'from-yellow-400/20 to-amber-400/20' },
  water_main: { label: 'Water Main Break', icon: Droplets, color: 'text-blue-500', gradient: 'from-blue-400/20 to-cyan-400/20' },
  power_line: { label: 'Power Line Down', icon: Zap, color: 'text-yellow-500', gradient: 'from-yellow-500/20 to-orange-400/20' },
  debris: { label: 'Debris', icon: Layers, color: 'text-stone-600', gradient: 'from-stone-400/20 to-gray-400/20' },
  sinkhole: { label: 'Sinkhole', icon: AlertCircle, color: 'text-gray-800', gradient: 'from-gray-600/20 to-stone-500/20' },
  structural: { label: 'Structural Hazard', icon: Building2, color: 'text-amber-600', gradient: 'from-amber-400/20 to-orange-400/20' },
  person_trapped: { label: 'Person Trapped', icon: Siren, color: 'text-red-600', gradient: 'from-red-500/20 to-rose-500/20' },
  missing_person: { label: 'Missing Person', icon: Search, color: 'text-violet-600', gradient: 'from-violet-500/20 to-purple-500/20' },
  hazardous_area: { label: 'Hazardous Area', icon: AlertTriangle, color: 'text-yellow-600', gradient: 'from-yellow-500/20 to-orange-500/20' },
  evacuation: { label: 'Evacuation', icon: Navigation, color: 'text-rose-600', gradient: 'from-rose-500/20 to-red-500/20' },
  public_safety_incident: { label: 'Public Safety', icon: Shield, color: 'text-blue-700', gradient: 'from-blue-500/20 to-indigo-500/20' },
  pollution: { label: 'Pollution', icon: Wind, color: 'text-green-700', gradient: 'from-green-500/20 to-emerald-500/20' },
  chemical: { label: 'Chemical Hazard', icon: AlertTriangle, color: 'text-purple-600', gradient: 'from-purple-500/20 to-fuchsia-500/20' },
  environmental_hazard: { label: 'Environmental', icon: Leaf, color: 'text-emerald-700', gradient: 'from-emerald-500/20 to-green-500/20' },
  mass_casualty: { label: 'Mass Casualty', icon: HeartPulse, color: 'text-red-600', gradient: 'from-red-600/20 to-rose-600/20' },
  contamination: { label: 'Contamination', icon: AlertCircle, color: 'text-amber-600', gradient: 'from-amber-500/20 to-yellow-500/20' },
  general: { label: 'General', icon: FileText, color: 'text-gray-600', gradient: 'from-gray-400/20 to-slate-400/20' },
}

const HAZARD_GROUPS = [
  { group: 'Natural Disasters', keys: ['flood','severe_storm','heatwave','wildfire','landslide','earthquake','tornado','tsunami','volcanic','drought','avalanche'] },
  { group: 'Infrastructure', keys: ['road_damage','bridge_damage','building_collapse','gas_leak','water_main','power_line','debris','sinkhole','structural'] },
  { group: 'Public Safety', keys: ['person_trapped','missing_person','hazardous_area','evacuation','public_safety_incident'] },
  { group: 'Environmental / Medical', keys: ['pollution','chemical','environmental_hazard','mass_casualty','contamination'] },
  { group: 'Other', keys: ['general'] },
]

//Client-side AI resource recommendation engine.
//Returns suggested ambulance/fire engine/boat counts + threat level for a
//given hazard type and priority. Counts scale by mult: Critical=2x, High=1.5x, other=1x.
//This mirrors the server-side logic in reportRoutes.ts POST handler (kept in sync).
function getSmartResourceSuggestion(hazardType: string, priority: string): { ambulances: number; fire_engines: number; rescue_boats: number; reasoning: string; threatLevel: number } {
  const isCrit = priority === 'Critical'
  const isHigh = priority === 'High'
  const mult = isCrit ? 2.0 : isHigh ? 1.5 : 1.0
  const base = { ambulances: 0, fire_engines: 0, rescue_boats: 0, reasoning: '', threatLevel: 1 }

  switch (hazardType) {
    case 'flood': case 'tsunami':
      return { ambulances: Math.ceil(3 * mult), fire_engines: Math.ceil(1 * mult), rescue_boats: Math.ceil(4 * mult), reasoning: `Water rescue priority -- ${Math.ceil(4 * mult)} boats + swift-water teams. Medical standby for hypothermia.`, threatLevel: isCrit ? 5 : isHigh ? 4 : 3 }
    case 'wildfire':
      return { ambulances: Math.ceil(2 * mult), fire_engines: Math.ceil(6 * mult), rescue_boats: 0, reasoning: `Fire suppression priority -- ${Math.ceil(6 * mult)} engines needed for containment perimeter. Aerial support recommended if > 50 hectares.`, threatLevel: isCrit ? 5 : 4 }
    case 'earthquake': case 'building_collapse': case 'landslide': case 'avalanche': case 'sinkhole':
      return { ambulances: Math.ceil(4 * mult), fire_engines: Math.ceil(2 * mult), rescue_boats: 0, reasoning: `Urban SAR priority -- Structural collapse teams. ${Math.ceil(4 * mult)} ambulances for crush injuries. K9 units recommended.`, threatLevel: isCrit ? 5 : isHigh ? 4 : 3 }
    case 'volcanic':
      return { ambulances: Math.ceil(3 * mult), fire_engines: Math.ceil(2 * mult), rescue_boats: 1, reasoning: 'Multi-hazard volcanic response -- Ashfall, lava, lahars. Evacuate within exclusion zone. Respirator equipment required.', threatLevel: 5 }
    case 'mass_casualty':
      return { ambulances: Math.ceil(8 * mult), fire_engines: Math.ceil(2 * mult), rescue_boats: 0, reasoning: `MCI protocol -- Triage START. ${Math.ceil(8 * mult)} ambulances for casualty distribution. Field hospital if >50 patients.`, threatLevel: isCrit ? 5 : 4 }
    case 'chemical': case 'gas_leak': case 'pollution': case 'contamination': case 'environmental_hazard':
      return { ambulances: Math.ceil(2 * mult), fire_engines: Math.ceil(3 * mult), rescue_boats: 0, reasoning: `HazMat response -- Decon teams required. Hot/warm/cold zone established. ${Math.ceil(3 * mult)} engines with SCBA.`, threatLevel: isCrit ? 5 : isHigh ? 4 : 3 }
    case 'tornado': case 'severe_storm':
      return { ambulances: Math.ceil(3 * mult), fire_engines: Math.ceil(2 * mult), rescue_boats: Math.ceil(1 * mult), reasoning: `Storm damage response -- Downed power lines, structural debris. Ensure electrical isolation before SAR.`, threatLevel: isCrit ? 5 : 3 }
    case 'heatwave': case 'drought':
      return { ambulances: Math.ceil(4 * mult), fire_engines: 0, rescue_boats: 0, reasoning: `Heat emergency response -- Cooling stations + rapid IV fluid resupply. ${Math.ceil(4 * mult)} ambulances for heat stroke cases.`, threatLevel: isCrit ? 4 : 2 }
    case 'person_trapped':
      return { ambulances: Math.ceil(2 * mult), fire_engines: Math.ceil(2 * mult), rescue_boats: 0, reasoning: `Technical rescue -- Extrication tools (Jaws of Life). ${Math.ceil(2 * mult)} ambulances on standby for immediate transport.`, threatLevel: isCrit ? 5 : 3 }
    case 'evacuation':
      return { ambulances: Math.ceil(2 * mult), fire_engines: Math.ceil(1 * mult), rescue_boats: Math.ceil(1 * mult), reasoning: 'Evacuation logistics -- Transport staging + marshalling points. Track head counts at reception centres.', threatLevel: isCrit ? 4 : 3 }
    case 'power_line': case 'road_damage': case 'bridge_damage': case 'debris': case 'structural': case 'water_main':
      return { ambulances: Math.ceil(1 * mult), fire_engines: Math.ceil(2 * mult), rescue_boats: 0, reasoning: `Infrastructure response -- Isolation perimeter. Public works coordination. ${Math.ceil(2 * mult)} engines for scene safety.`, threatLevel: isCrit ? 3 : 2 }
    case 'missing_person':
      return { ambulances: 1, fire_engines: 0, rescue_boats: isCrit ? 1 : 0, reasoning: 'Search operation -- Grid search teams + K9. Drone aerial survey if available. Medical standby.', threatLevel: isCrit ? 3 : 2 }
    default:
      return { ambulances: Math.ceil(2 * mult), fire_engines: Math.ceil(1 * mult), rescue_boats: 0, reasoning: 'Standard multi-agency response -- Assess on arrival and scale as needed.', threatLevel: isCrit ? 3 : 2 }
  }
}

//UK threat level scale (1-5): used to show coloured threat pill on zone cards.
//Maps to standard UK JTAC threat levels: Low/Moderate/Substantial/Severe/Critical.
function getThreatLevelInfo(level: number): { label: string; color: string; bgColor: string; ringColor: string } {
  switch (level) {
    case 5: return { label: 'EXTREME', color: 'text-red-600 dark:text-red-400', bgColor: 'bg-red-500/15', ringColor: 'ring-red-500/30' }
    case 4: return { label: 'SEVERE', color: 'text-orange-600 dark:text-orange-400', bgColor: 'bg-orange-500/15', ringColor: 'ring-orange-500/30' }
    case 3: return { label: 'SUBSTANTIAL', color: 'text-amber-600 dark:text-amber-400', bgColor: 'bg-amber-500/15', ringColor: 'ring-amber-500/30' }
    case 2: return { label: 'MODERATE', color: 'text-yellow-600 dark:text-yellow-400', bgColor: 'bg-yellow-500/15', ringColor: 'ring-yellow-500/30' }
    default: return { label: 'LOW', color: 'text-green-600 dark:text-green-400', bgColor: 'bg-green-500/15', ringColor: 'ring-green-500/30' }
  }
}

/* Extract leading number from strings like "23 people needing help".
 * Zone records can store estimated_affected as either a pure number or
 * a free-text field -- this normalises both into a safe integer. */
function parseAffected(val: any): number {
  if (typeof val === 'number') return val
  if (typeof val === 'string') {
    const m = val.match(/(\d+)/)
    return m ? parseInt(m[1], 10) : 0
  }
  return 0
}

function formatRelativeTime(mins: number, lang: string): string {
  if (mins < 1) return t('common.justNow', lang)
  if (mins < 60) return `${mins}${t('common.minutesShort', lang)} ${t('common.ago', lang)}`
  if (mins < 1440) return `${Math.floor(mins / 60)}${t('common.hoursShort', lang)} ${mins % 60}${t('common.minutesShort', lang)} ${t('common.ago', lang)}`
  return `${Math.floor(mins / 1440)}${t('common.daysShort', lang)} ${t('common.ago', lang)}`
}

function getDeploymentDuration(deployedAt: string | null): { label: string; isLong: boolean } {
  if (!deployedAt) return { label: '', isLong: false }
  const ms = Date.now() - new Date(deployedAt).getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return { label: '<1m', isLong: false }
  if (mins < 60) return { label: `${mins}m`, isLong: mins > 240 }
  const hrs = Math.floor(mins / 60); const rem = mins % 60
  return { label: `${hrs}h ${rem}m`, isLong: hrs >= 4 }
}

export default function ResourceDeploymentConsole({
  deployments, setDeployments, reports, auditLog, setAuditLog,
  deployReason, setDeployReason, deployReasonRef,
  loc, activeLocation, user, pushNotification, askConfirm
}: Props) {
  const lang = useLanguage()
  const pipeline = useMemo(() => getPipeline(lang), [lang])

  const [time, setTime] = useState({ zulu: '', local: '' })
  const [showMap, setShowMap] = useState(true)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [zoneSearch, setZoneSearch] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortField, setSortField] = useState('priority')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [expandedZone, setExpandedZone] = useState<string | null>(null)
  const [zoneView, setZoneView] = useState<'table' | 'grid'>('table')
  const [countdown, setCountdown] = useState(30)
  const cdRef = useRef(30)
  const searchRef = useRef<HTMLInputElement>(null)

  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createForm, setCreateForm] = useState({ zone: '', priority: 'Medium', active_reports: '0', estimated_affected: '', ai_recommendation: '', commander_notes: '', ambulances: '0', fire_engines: '0', rescue_boats: '0', lat: '', lng: '', report_id: '', hazard_type: 'general', incident_commander: '', radio_channel: '', weather_conditions: 'clear', evacuation_status: 'none', access_routes: '' })
  const [creating, setCreating] = useState(false)
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})

  //Asset tracking state (Module 3)
  const [assetsByZone, setAssetsByZone] = useState<Record<string, any[]>>({})
  const [loadingAssetsFor, setLoadingAssetsFor] = useState<string | null>(null)
  const [showAddAsset, setShowAddAsset] = useState<string | null>(null)
  const [assetForm, setAssetForm] = useState({ asset_type: 'ambulance', call_sign: '', status: 'staging', crew_count: '1', notes: '' })

  //Operational state
  const [opsNoteByZone, setOpsNoteByZone] = useState<Record<string, string>>({})
  const [savingOpsNote, setSavingOpsNote] = useState<string | null>(null)
  const [togglingMutualAid, setTogglingMutualAid] = useState<string | null>(null)
  const [acknowledging, setAcknowledging] = useState<string | null>(null)

  //Inline editing state
  const [editingZone, setEditingZone] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<Record<string, any>>({})
  const [savingEdit, setSavingEdit] = useState(false)

  //Smart create modal state
  const [createStep, setCreateStep] = useState(0) // 0=identity, 1=resources, 2=review
  const smartSuggestion = useMemo(() => getSmartResourceSuggestion(createForm.hazard_type, createForm.priority), [createForm.hazard_type, createForm.priority])
  const hazardInfo = HAZARD_CATEGORIES[createForm.hazard_type] || HAZARD_CATEGORIES.general
  const threatInfo = getThreatLevelInfo(smartSuggestion.threatLevel)

  //Watches hazard_type and priority changes to auto-fill resource fields
  //with the AI suggestion, unless the operator has manually overridden them.
  const prevHazardRef = useRef(createForm.hazard_type)
  const prevPriorityRef = useRef(createForm.priority)
  useEffect(() => {
    if (prevHazardRef.current !== createForm.hazard_type || prevPriorityRef.current !== createForm.priority) {
      prevHazardRef.current = createForm.hazard_type
      prevPriorityRef.current = createForm.priority
      const suggestion = getSmartResourceSuggestion(createForm.hazard_type, createForm.priority)
      setCreateForm(f => ({
        ...f,
        ambulances: String(suggestion.ambulances),
        fire_engines: String(suggestion.fire_engines),
        rescue_boats: String(suggestion.rescue_boats),
        ai_recommendation: suggestion.reasoning,
      }))
    }
  }, [createForm.hazard_type, createForm.priority])

  /* clock */
  useEffect(() => {
    const tick = () => {
      const n = new Date()
      setTime({ zulu: n.toISOString().slice(11, 19) + 'Z', local: n.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) })
    }
    tick(); const id = setInterval(tick, 1000); return () => clearInterval(id)
  }, [])

  /* auto-refresh */
  useEffect(() => {
    const id = setInterval(() => {
      cdRef.current -= 1
      if (cdRef.current <= 0) { apiGetDeployments().then(setDeployments).catch(() => {}); cdRef.current = 30 }
      setCountdown(cdRef.current)
    }, 1000)
    return () => clearInterval(id)
  }, [setDeployments])

  const doRefresh = useCallback(() => {
    apiGetDeployments().then(setDeployments).catch(() => {})
    cdRef.current = 30; setCountdown(30)
    pushNotification(t('resource.dataRefreshed', lang), 'info')
  }, [lang, setDeployments, pushNotification])

  /* keyboard */
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === '?') { e.preventDefault(); setShowShortcuts(p => !p) }
      if (e.key === 'r' && !e.ctrlKey) { e.preventDefault(); doRefresh() }
      if (e.key === 'm') { e.preventDefault(); setShowMap(p => !p) }
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus() }
    }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [doRefresh])

  /* computed */
  const totalZones = deployments.length
  const activeCount = deployments.filter((d: any) => d.deployed).length
  const criticalCount = deployments.filter((d: any) => (d.priority || '').toLowerCase() === 'critical').length
  const totalReports = deployments.reduce((s: number, d: any) => s + (Number(d.active_reports) || 0), 0)
  const totalAffected = deployments.reduce((s: number, d: any) => s + parseAffected(d.estimated_affected), 0)
  const totalAssets = deployments.reduce((s: number, d: any) => s + (Number(d.ambulances) || 0) + (Number(d.fire_engines) || 0) + (Number(d.rescue_boats) || 0), 0)
  const deployedAssets = deployments.filter((d: any) => d.deployed).reduce((s: number, d: any) => s + (Number(d.ambulances) || 0) + (Number(d.fire_engines) || 0) + (Number(d.rescue_boats) || 0), 0)
  const utilizationPct = totalAssets > 0 ? Math.round((deployedAssets / totalAssets) * 100) : 0

  const readiness = criticalCount > 2 ? 'critical' : criticalCount > 0 ? 'elevated' : activeCount > 0 ? 'active' : 'standby'
  const readinessClass = readiness === 'critical' ? 'text-red-500 bg-red-500/10 ring-red-500/30 animate-pulse' : readiness === 'elevated' ? 'text-amber-500 bg-amber-500/10 ring-amber-500/30' : readiness === 'active' ? 'text-emerald-500 bg-emerald-500/10 ring-emerald-500/30' : 'text-slate-400 bg-slate-500/10 ring-slate-500/30'
  const readinessLabel = readiness === 'critical'
    ? t('resource.readinessCritical', lang)
    : readiness === 'elevated'
      ? t('resource.readinessElevated', lang)
      : readiness === 'active'
        ? t('resource.readinessActive', lang)
        : t('resource.readinessStandby', lang)

  const assetRows = useMemo(() => {
    const deployed = deployments.filter((d: any) => d.deployed)
    return [
      { label: t('resource.ambulances', lang), icon: Truck, color: 'text-red-500', bg: 'bg-red-500', total: deployments.reduce((s: number, d: any) => s + (Number(d.ambulances) || 0), 0), active: deployed.reduce((s: number, d: any) => s + (Number(d.ambulances) || 0), 0) },
      { label: t('resource.fireEngines', lang), icon: Flame, color: 'text-orange-500', bg: 'bg-orange-500', total: deployments.reduce((s: number, d: any) => s + (Number(d.fire_engines) || 0), 0), active: deployed.reduce((s: number, d: any) => s + (Number(d.fire_engines) || 0), 0) },
      { label: t('resource.rescueBoats', lang), icon: Anchor, color: 'text-blue-500', bg: 'bg-blue-500', total: deployments.reduce((s: number, d: any) => s + (Number(d.rescue_boats) || 0), 0), active: deployed.reduce((s: number, d: any) => s + (Number(d.rescue_boats) || 0), 0) },
    ]
  }, [deployments, lang])

  const pipelineCounts = useMemo(() => {
    const nd = deployments.filter((d: any) => !d.deployed)
    return {
      requested: nd.filter((d: any) => (d.priority || '').toLowerCase() === 'critical' || (d.priority || '').toLowerCase() === 'high').length,
      staging: nd.filter((d: any) => (d.priority || '').toLowerCase() === 'medium' || (d.priority || '').toLowerCase() === 'low').length,
      transit: 0,
      on_site: deployments.filter((d: any) => d.deployed).length,
      demob: 0,
    }
  }, [deployments])

  const deployEvents = useMemo(() =>
    auditLog.filter(a => a.action_type === 'deploy' || a.action_type === 'recall').slice(0, 10),
    [auditLog])

  //Unacknowledged AI draft zones (need operator review)
  const unacknowledgedDrafts = useMemo(() =>
    deployments.filter((d: any) => d.is_ai_draft && !d.ai_draft_acknowledged_at),
    [deployments])

  /* filtered + sorted zones */
  const zones = useMemo(() => {
    let items = [...deployments]
    if (zoneSearch.trim()) { const q = zoneSearch.toLowerCase(); items = items.filter((d: any) => (d.zone || '').toLowerCase().includes(q) || (d.ai_recommendation || '').toLowerCase().includes(q)) }
    if (priorityFilter !== 'all') items = items.filter((d: any) => (d.priority || '').toLowerCase() === priorityFilter.toLowerCase())
    if (statusFilter === 'deployed') items = items.filter((d: any) => d.deployed)
    if (statusFilter === 'standby') items = items.filter((d: any) => !d.deployed)
    items.sort((a: any, b: any) => {
      let c = 0
      if (sortField === 'priority') c = (P_ORDER[(b.priority || '')] || 0) - (P_ORDER[(a.priority || '')] || 0)
      else if (sortField === 'zone') c = (a.zone || '').localeCompare(b.zone || '')
      else if (sortField === 'reports') c = (Number(b.active_reports) || 0) - (Number(a.active_reports) || 0)
      else if (sortField === 'affected') c = parseAffected(b.estimated_affected) - parseAffected(a.estimated_affected)
      else if (sortField === 'status') c = (b.deployed ? 1 : 0) - (a.deployed ? 1 : 0)
      return sortDir === 'asc' ? -c : c
    })
    return items
  }, [deployments, zoneSearch, priorityFilter, statusFilter, sortField, sortDir])

  const handleDeploy = useCallback((zone: any) => {
    setDeployReason('')
    askConfirm(t('resource.deployResources', lang), `${t('resource.deployConfirmPrefix', lang)} ${zone.zone}? ${t('resource.deployConfirmSuffix', lang)}`, 'success', async () => {
      const reason = deployReasonRef.current
      if (!reason.trim()) { pushNotification(t('resource.reasonRequired', lang), 'error'); return }
      apiDeployResources(zone.id, user?.id, reason).then(() => { setDeployments(d => d.map(x => x.id === zone.id ? { ...x, deployed: true, deployed_at: new Date().toISOString(), deployed_by: user?.id || null } : x)); pushNotification(t('resource.deploySuccess', lang), 'success') }).catch(() => pushNotification(t('resource.deployFailed', lang), 'error'))
      apiAuditLog({ operator_id: user?.id, operator_name: user?.displayName, action: `${t('resource.deployedToPrefix', lang)} ${zone.zone}`, action_type: 'deploy', target_type: 'deployment', target_id: zone.id, reason, before_state: { deployed: false }, after_state: { deployed: true } }).catch(() => {})
      setAuditLog(prev => [{ id: Date.now(), operator_name: user?.displayName, action: `${t('resource.deployedToPrefix', lang)} ${zone.zone}`, action_type: 'deploy', target_id: zone.id, created_at: new Date().toISOString() }, ...prev])
    })
  }, [askConfirm, deployReasonRef, lang, pushNotification, setAuditLog, setDeployReason, setDeployments, user])

  const handleRecall = useCallback((zone: any) => {
    setDeployReason('')
    askConfirm(t('resource.recallResources', lang), `${t('resource.recallConfirmPrefix', lang)} ${zone.zone}? ${t('resource.recallConfirmSuffix', lang)}`, 'warning', async () => {
      const reason = deployReasonRef.current
      if (!reason.trim()) { pushNotification(t('resource.recallReasonRequired', lang), 'error'); return }
      apiRecallResources(zone.id, reason, reason, undefined, 'correct').then(() => { setDeployments(d => d.map(x => x.id === zone.id ? { ...x, deployed: false, deployed_at: null, deployed_by: null } : x)); pushNotification(t('resource.recallSuccess', lang), 'warning') }).catch(() => pushNotification(t('resource.recallFailed', lang), 'error'))
      apiAuditLog({ operator_id: user?.id, operator_name: user?.displayName, action: `${t('resource.recalledFromPrefix', lang)} ${zone.zone}`, action_type: 'recall', target_type: 'deployment', target_id: zone.id, reason, before_state: { deployed: true }, after_state: { deployed: false } }).catch(() => {})
      setAuditLog(prev => [{ id: Date.now(), operator_name: user?.displayName, action: `${t('resource.recalledFromPrefix', lang)} ${zone.zone}`, action_type: 'recall', target_id: zone.id, created_at: new Date().toISOString() }, ...prev])
    })
  }, [askConfirm, deployReasonRef, lang, pushNotification, setAuditLog, setDeployReason, setDeployments, user])

  const handleCreate = useCallback(async () => {
    //Comprehensive validation
    const errors: Record<string, string> = {}
    const zoneName = createForm.zone.trim()
    if (!zoneName) errors.zone = 'Zone name is required'
    else if (zoneName.length < 3) errors.zone = 'Zone name must be at least 3 characters'
    else if (zoneName.length > 120) errors.zone = 'Zone name must be under 120 characters'
    else if (/[<>{}\\]/.test(zoneName)) errors.zone = 'Zone name contains invalid characters'
    if (createForm.lat) {
      const lat = parseFloat(createForm.lat)
      if (isNaN(lat) || lat < -90 || lat > 90) errors.lat = 'Latitude must be between -90 and 90'
    }
    if (createForm.lng) {
      const lng = parseFloat(createForm.lng)
      if (isNaN(lng) || lng < -180 || lng > 180) errors.lng = 'Longitude must be between -180 and 180'
    }
    if ((createForm.lat && !createForm.lng) || (!createForm.lat && createForm.lng)) errors.lat = 'Both coordinates are required if one is provided'
    const amb = parseInt(createForm.ambulances) || 0
    const fe = parseInt(createForm.fire_engines) || 0
    const rb = parseInt(createForm.rescue_boats) || 0
    if (amb < 0 || amb > 99) errors.ambulances = 'Must be 0-99'
    if (fe < 0 || fe > 99) errors.fire_engines = 'Must be 0-99'
    if (rb < 0 || rb > 99) errors.rescue_boats = 'Must be 0-99'
    const ar = parseInt(createForm.active_reports)
    if (isNaN(ar) || ar < 0 || ar > 999) errors.active_reports = 'Must be 0-999'
    if (createForm.estimated_affected && createForm.estimated_affected.length > 100) errors.estimated_affected = 'Must be under 100 characters'
    if (createForm.commander_notes.length > 500) errors.commander_notes = 'Notes must be under 500 characters'
    if (createForm.incident_commander.length > 80) errors.incident_commander = 'Must be under 80 characters'
    if (createForm.radio_channel.length > 30) errors.radio_channel = 'Must be under 30 characters'
    if (createForm.access_routes.length > 300) errors.access_routes = 'Must be under 300 characters'
    if (Object.keys(errors).length > 0) { setFormErrors(errors); pushNotification(`${Object.keys(errors).length} validation error(s) -- please correct before submitting`, 'error'); return }
    setFormErrors({})
    setCreating(true)
    try {
      const finalRec = createForm.commander_notes.trim()
        ? `${createForm.ai_recommendation} | Notes: ${createForm.commander_notes.trim()}`
        : createForm.ai_recommendation
      const newZone = await apiCreateDeployment({
        zone: zoneName,
        priority: createForm.priority,
        active_reports: parseInt(createForm.active_reports) || 0,
        estimated_affected: createForm.estimated_affected || undefined,
        ai_recommendation: finalRec || undefined,
        ambulances: amb,
        fire_engines: fe,
        rescue_boats: rb,
        lat: createForm.lat ? parseFloat(createForm.lat) : undefined,
        lng: createForm.lng ? parseFloat(createForm.lng) : undefined,
        report_id: createForm.report_id || undefined,
        hazard_type: createForm.hazard_type || 'general',
      })
      setDeployments(prev => [...prev, newZone])
      setShowCreateModal(false)
      setCreateStep(0)
      setCreateForm({ zone: '', priority: 'Medium', active_reports: '0', estimated_affected: '', ai_recommendation: '', commander_notes: '', ambulances: '0', fire_engines: '0', rescue_boats: '0', lat: '', lng: '', report_id: '', hazard_type: 'general', incident_commander: '', radio_channel: '', weather_conditions: 'clear', evacuation_status: 'none', access_routes: '' })
      pushNotification(`Zone "${newZone.zone}" created`, 'success')
    } catch {
      pushNotification('Failed to create zone', 'error')
    } finally {
      setCreating(false)
    }
  }, [createForm, pushNotification, setDeployments])

  //Asset tracking helpers
  const loadAssets = useCallback(async (zoneId: string) => {
    if (assetsByZone[zoneId] !== undefined) return // already loaded
    setLoadingAssetsFor(zoneId)
    try {
      const assets = await apiGetDeploymentAssets(zoneId)
      setAssetsByZone(prev => ({ ...prev, [zoneId]: assets }))
    } catch { setAssetsByZone(prev => ({ ...prev, [zoneId]: [] })) }
    finally { setLoadingAssetsFor(null) }
  }, [assetsByZone])

  const handleAddAsset = useCallback(async (zoneId: string) => {
    if (!assetForm.call_sign.trim()) { pushNotification('Call sign is required', 'error'); return }
    try {
      const asset = await apiAddDeploymentAsset(zoneId, {
        asset_type: assetForm.asset_type,
        call_sign: assetForm.call_sign.trim(),
        status: assetForm.status,
        crew_count: parseInt(assetForm.crew_count) || 1,
        notes: assetForm.notes || undefined,
      })
      setAssetsByZone(prev => ({ ...prev, [zoneId]: [...(prev[zoneId] || []), asset] }))
      setShowAddAsset(null)
      setAssetForm({ asset_type: 'ambulance', call_sign: '', status: 'staging', crew_count: '1', notes: '' })
      pushNotification(`Asset ${asset.call_sign} added`, 'success')
    } catch { pushNotification('Failed to add asset', 'error') }
  }, [assetForm, pushNotification])

  const handleUpdateAssetStatus = useCallback(async (assetId: string, status: string, zoneId: string) => {
    try {
      const updated = await apiUpdateDeploymentAsset(assetId, { status })
      setAssetsByZone(prev => ({
        ...prev,
        [zoneId]: (prev[zoneId] || []).map(a => a.id === assetId ? { ...a, ...updated } : a)
      }))
    } catch { pushNotification('Failed to update asset', 'error') }
  }, [pushNotification])

  const handleDeleteAsset = useCallback(async (assetId: string, zoneId: string) => {
    try {
      await apiDeleteDeploymentAsset(assetId)
      setAssetsByZone(prev => ({ ...prev, [zoneId]: (prev[zoneId] || []).filter(a => a.id !== assetId) }))
      pushNotification('Asset removed', 'warning')
    } catch { pushNotification('Failed to remove asset', 'error') }
  }, [pushNotification])

  //Operations handlers
  const handleAcknowledge = useCallback(async (zoneId: string) => {
    setAcknowledging(zoneId)
    try {
      await apiAcknowledgeDraft(zoneId)
      setDeployments(d => d.map((x: any) => x.id === zoneId ? { ...x, ai_draft_acknowledged_at: new Date().toISOString() } : x))
      pushNotification('AI draft acknowledged', 'success')
    } catch { pushNotification('Failed to acknowledge draft', 'error') }
    finally { setAcknowledging(null) }
  }, [pushNotification, setDeployments])

  const handleAddOpsLog = useCallback(async (zoneId: string) => {
    const note = (opsNoteByZone[zoneId] || '').trim()
    if (!note) { pushNotification('Note cannot be empty', 'error'); return }
    setSavingOpsNote(zoneId)
    try {
      const result = await apiAddOpsLog(zoneId, note)
      setDeployments(d => d.map((x: any) => x.id === zoneId ? { ...x, ops_log: result.ops_log } : x))
      setOpsNoteByZone(prev => ({ ...prev, [zoneId]: '' }))
      pushNotification('Log entry added', 'success')
    } catch { pushNotification('Failed to add log entry', 'error') }
    finally { setSavingOpsNote(null) }
  }, [opsNoteByZone, pushNotification, setDeployments])

  const handleToggleMutualAid = useCallback(async (zone: any) => {
    setTogglingMutualAid(zone.id)
    const newVal = !zone.needs_mutual_aid
    try {
      await apiToggleMutualAid(zone.id, newVal)
      setDeployments(d => d.map((x: any) => x.id === zone.id ? { ...x, needs_mutual_aid: newVal } : x))
      pushNotification(newVal ? 'Mutual aid requested -- neighbouring agencies notified' : 'Mutual aid request cleared', newVal ? 'warning' : 'success')
    } catch { pushNotification('Failed to update mutual aid flag', 'error') }
    finally { setTogglingMutualAid(null) }
  }, [pushNotification, setDeployments])

  //Inline edit handlers
  const startEdit = useCallback((zone: any) => {
    setEditingZone(zone.id)
    setEditForm({ priority: zone.priority || 'Medium', active_reports: String(zone.active_reports || 0), estimated_affected: zone.estimated_affected || '', ambulances: String(zone.ambulances || 0), fire_engines: String(zone.fire_engines || 0), rescue_boats: String(zone.rescue_boats || 0), hazard_type: zone.hazard_type || 'general', incident_commander: zone.incident_commander || '' })
  }, [])

  const cancelEdit = useCallback(() => { setEditingZone(null); setEditForm({}) }, [])

  const saveEdit = useCallback(async (zoneId: string) => {
    setSavingEdit(true)
    try {
      const updated = await apiUpdateDeployment(zoneId, {
        priority: editForm.priority,
        active_reports: parseInt(editForm.active_reports) || 0,
        estimated_affected: editForm.estimated_affected || undefined,
        ambulances: parseInt(editForm.ambulances) || 0,
        fire_engines: parseInt(editForm.fire_engines) || 0,
        rescue_boats: parseInt(editForm.rescue_boats) || 0,
        hazard_type: editForm.hazard_type || 'general',
        incident_commander: editForm.incident_commander || undefined,
      })
      setDeployments(d => d.map(x => x.id === zoneId ? { ...x, ...updated } : x))
      setEditingZone(null); setEditForm({})
      pushNotification('Zone updated', 'success')
    } catch { pushNotification('Failed to update zone', 'error') }
    finally { setSavingEdit(false) }
  }, [editForm, pushNotification, setDeployments])

  //Smart auto-apply suggestion
  const applySmartSuggestion = useCallback(() => {
    setCreateForm(f => ({
      ...f,
      ambulances: String(smartSuggestion.ambulances),
      fire_engines: String(smartSuggestion.fire_engines),
      rescue_boats: String(smartSuggestion.rescue_boats),
      ai_recommendation: smartSuggestion.reasoning,
    }))
  }, [smartSuggestion])

  const handleDelete = useCallback((zone: any) => {
    askConfirm('Delete Zone', `Permanently delete zone "${zone.zone}"? This cannot be undone.`, 'error', () => {
      apiDeleteDeployment(zone.id)
        .then(() => { setDeployments(d => d.filter((x: any) => x.id !== zone.id)); pushNotification(`Zone "${zone.zone}" deleted`, 'warning') })
        .catch(() => pushNotification('Failed to delete zone', 'error'))
    })
  }, [askConfirm, pushNotification, setDeployments])

  const toggleSort = (f: string) => { if (sortField === f) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortField(f); setSortDir('desc') } }
  const SortBtn = ({ field, children }: { field: string; children: React.ReactNode }) => (
    <button onClick={() => toggleSort(field)} className="flex items-center gap-1 hover:text-gray-900 dark:hover:text-white transition-colors">
      {children}
      {sortField === field ? (sortDir === 'desc' ? <ArrowDown className="w-3 h-3" /> : <ArrowUp className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-30" />}
    </button>
  )

  return (
    <>
    <div className="space-y-5 animate-fade-in">

      {/* HEADER */}
      <div className="rounded-2xl overflow-hidden bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-lg">
        {/* Status bar */}
        <div className="flex items-center justify-between px-5 py-2 bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-700 text-[11px]">
          <div className="flex items-center gap-3">
            <span className={`px-2.5 py-0.5 rounded-md font-extrabold ring-1 ${readinessClass}`}>{readinessLabel}</span>
            <span className="text-gray-400 dark:text-gray-300">{loc.name || t('historical.allRegions', lang)}</span>
          </div>
          <div className="flex items-center gap-3 font-mono text-gray-500 dark:text-gray-300">
            <span className="font-semibold text-gray-700 dark:text-gray-300 tabular-nums">{time.zulu}</span>
            <span className="text-gray-300 dark:text-gray-400">|</span>
            <span className="tabular-nums">{t('common.local', lang)} {time.local}</span>
            <span className="text-gray-300 dark:text-gray-400">|</span>
            <span className="tabular-nums text-emerald-600 dark:text-emerald-400">{t('common.sync', lang)} {countdown}s</span>
          </div>
        </div>

        {/* Title + actions */}
        <div className="px-5 py-4 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <Navigation className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <h2 className="text-lg font-extrabold text-gray-900 dark:text-white tracking-tight">{t('resource.deployment', lang)}</h2>
              <div className="text-xs text-gray-500 dark:text-gray-300 flex items-center gap-2 flex-wrap">
                <span>{t('resource.subtitle', lang)}</span>
                <span aria-hidden="true" className="w-1 h-1 rounded-full bg-gray-300 dark:bg-gray-600" />
                <span>{t('resource.assetLogistics', lang)}</span>
                <span aria-hidden="true" className="w-1 h-1 rounded-full bg-gray-300 dark:bg-gray-600" />
                <span>{t('resource.zoneManagement', lang)}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowShortcuts(p => !p)} className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 flex items-center justify-center text-gray-500 dark:text-gray-300 transition-colors" title={t('resource.keyboardShortcuts', lang)}><Keyboard className="w-4 h-4" /></button>
            <button onClick={doRefresh} className="h-8 px-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/30 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 text-xs font-semibold flex items-center gap-1.5 transition-colors">
              <RefreshCw className="w-3.5 h-3.5" /> {t('common.refresh', lang)}
            </button>
            <button onClick={() => { const init = getSmartResourceSuggestion('general', 'Medium'); setCreateForm({ zone: '', priority: 'Medium', active_reports: '0', estimated_affected: '', ai_recommendation: init.reasoning, commander_notes: '', ambulances: String(init.ambulances), fire_engines: String(init.fire_engines), rescue_boats: String(init.rescue_boats), lat: '', lng: '', report_id: '', hazard_type: 'general', incident_commander: '', radio_channel: '', weather_conditions: 'clear', evacuation_status: 'none', access_routes: '' }); setCreateStep(0); setShowCreateModal(true) }} className="h-8 px-3 rounded-lg bg-violet-50 dark:bg-violet-900/30 hover:bg-violet-100 dark:hover:bg-violet-900/50 text-violet-700 dark:text-violet-300 text-xs font-semibold flex items-center gap-1.5 transition-colors">
              <Plus className="w-3.5 h-3.5" /> {t('admin.resource.addZone', lang)}
            </button>
          </div>
        </div>

        {/* Stats row */}
        <div className="px-5 pb-4">
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
            {[
              { label: t('resource.zones', lang), value: String(totalZones), accent: 'text-gray-900 dark:text-white' },
              { label: t('common.active', lang), value: String(activeCount), accent: 'text-emerald-600 dark:text-emerald-400' },
              { label: t('common.critical', lang), value: String(criticalCount), accent: criticalCount > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-400 dark:text-gray-300' },
              { label: t('common.reports', lang), value: String(totalReports), accent: 'text-amber-600 dark:text-amber-400' },
              { label: t('resource.affected', lang), value: totalAffected.toLocaleString(), accent: 'text-rose-600 dark:text-rose-400' },
              { label: t('resource.utilization', lang), value: `${utilizationPct}%`, accent: utilizationPct > 70 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400' },
            ].map((s, i) => (
              <div key={i} className="text-center py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-700/50">
                <p className="text-[10px] text-gray-500 dark:text-gray-300 font-semibold uppercase tracking-wider mb-0.5">{s.label}</p>
                <p className={`text-xl font-extrabold tabular-nums ${s.accent}`}>{s.value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Shortcuts */}
      {showShortcuts && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[['R', t('common.refresh', lang)], ['M', t('common.toggleMap', lang)], ['/', t('common.search', lang)], ['?', t('common.shortcuts', lang)]].map(([k, d]) => (
            <div key={k} className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-300">
              <kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded text-[10px] font-mono text-gray-700 dark:text-gray-300">{k}</kbd>
              {d}
            </div>
          ))}
        </div>
      )}

      {/* ASSET READINESS */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2"><Shield className="w-4 h-4 text-emerald-500" /> {t('resource.assetReadiness', lang)}</h3>
          <span className={`text-[10px] px-2 py-0.5 rounded-md font-bold ring-1 ${readinessClass}`}>{readiness}</span>
        </div>
        <div className="p-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {assetRows.map((a, i) => {
              const Icon = a.icon
              const avail = a.total - a.active
              const pct = a.total > 0 ? Math.round((a.active / a.total) * 100) : 0
              const assetPulse = pct >= 80 && a.active > 0
              return (
                <div key={i} className="rounded-xl border border-gray-100 dark:border-gray-800 p-4 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
                  <div className="flex items-center gap-2 mb-3">
                    <div className={`w-8 h-8 rounded-lg ${assetPulse ? 'bg-emerald-50 dark:bg-emerald-900/20' : 'bg-gray-50 dark:bg-gray-800'} flex items-center justify-center transition-colors`}>
                      <Icon className={`w-4 h-4 ${assetPulse ? 'text-emerald-500' : a.color}`} />
                    </div>
                    <span className="text-sm font-bold text-gray-900 dark:text-white">{a.label}</span>
                  </div>
                  <div className="flex items-end justify-between mb-3">
                    <div>
                      <p className="text-[10px] text-gray-400 dark:text-gray-300 font-medium uppercase">{t('common.total', lang)}</p>
                      <p className="text-2xl font-extrabold text-gray-900 dark:text-white tabular-nums">{a.total}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-[10px] text-emerald-500 font-medium uppercase">{t('common.active', lang)}</p>
                      <p className="text-2xl font-extrabold text-emerald-600 dark:text-emerald-400 tabular-nums">{a.active}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-blue-500 font-medium uppercase">{t('resource.available', lang)}</p>
                      <p className="text-2xl font-extrabold text-blue-600 dark:text-blue-400 tabular-nums">{avail}</p>
                    </div>
                  </div>
                  <div className="h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                    <div className={`h-full ${a.bg} rounded-full transition-all duration-700 ${assetPulse ? 'opacity-100' : pct > 0 ? 'opacity-90' : 'opacity-0'}`} style={{ width: `${pct}%` }} />
                  </div>
                  <p className={`text-[10px] mt-1.5 text-right tabular-nums ${assetPulse ? 'text-emerald-500 font-bold' : 'text-gray-400 dark:text-gray-300'}`}>{pct}% {t('resource.deployed', lang).toLowerCase()}</p>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* LOGISTICS PIPELINE */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2"><Activity className="w-4 h-4 text-indigo-500" /> {t('resource.logisticsPipeline', lang)}</h3>
          <span className="text-xs font-bold tabular-nums px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 ring-1 ring-indigo-500/20">{Object.values(pipelineCounts).reduce((a, b) => a + b, 0)} {t('common.total', lang).toLowerCase()}</span>
        </div>
        <div className="p-5">
          <div className="flex items-center gap-0">
            {pipeline.map((stage, i) => {
              const Icon = stage.icon
              const count = pipelineCounts[stage.key as keyof typeof pipelineCounts]
              const active = count > 0
              return (
                <React.Fragment key={stage.key}>
                  {i > 0 && (
                    <div className="flex-shrink-0 flex items-center w-8 justify-center">
                      <svg width="24" height="12" viewBox="0 0 24 12" className="text-gray-200 dark:text-gray-700"><path d="M0 6h18m0 0l-4-4m4 4l-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
                    </div>
                  )}
                  <div className={`flex-1 rounded-xl p-4 text-center border transition-all ${active ? 'bg-emerald-50 dark:bg-emerald-900/15 border-emerald-200 dark:border-emerald-800' : 'bg-gray-50 dark:bg-gray-800/30 border-gray-100 dark:border-gray-800'}`}>
                    <div className={`w-8 h-8 rounded-lg mx-auto mb-2 flex items-center justify-center ${active ? 'bg-emerald-100 dark:bg-emerald-900/40' : 'bg-gray-100 dark:bg-gray-800'}`}>
                      <Icon className={`w-4 h-4 ${active ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400 dark:text-gray-300'}`} />
                    </div>
                    <p className={`text-[10px] font-bold uppercase tracking-wider mb-1 ${active ? 'text-emerald-700 dark:text-emerald-300' : 'text-gray-400 dark:text-gray-300'}`}>{stage.label}</p>
                    <p className={`text-2xl font-extrabold tabular-nums ${active ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-300 dark:text-gray-400'}`}>{count}</p>
                  </div>
                </React.Fragment>
              )
            })}
          </div>
        </div>
      </div>

      {/* AI DRAFT REVIEW PANEL -- shown only when unacknowledged AI-generated zones exist */}
      {unacknowledgedDrafts.length > 0 && (
        <div className={`rounded-2xl border shadow-sm overflow-hidden ${unacknowledgedDrafts.some((d: any) => d.priority?.toLowerCase() === 'critical') ? 'border-violet-400 dark:border-violet-600 bg-violet-50/60 dark:bg-violet-900/10' : 'border-violet-200 dark:border-violet-800 bg-violet-50/30 dark:bg-violet-900/5'}`}>
          <div className="px-5 py-3 border-b border-violet-200 dark:border-violet-800 flex items-center justify-between">
            <h3 className="text-sm font-bold text-violet-900 dark:text-violet-200 flex items-center gap-2">
              <Brain className={`w-4 h-4 text-violet-500 ${unacknowledgedDrafts.some((d: any) => d.priority?.toLowerCase() === 'critical') ? 'animate-pulse' : ''}`} />
              {t('admin.resource.aiDraftsAwaitingReview', lang)}
              <span className="ml-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-violet-600 text-white">{unacknowledgedDrafts.length}</span>
            </h3>
            <p className="text-[11px] text-violet-500 dark:text-violet-400">{t('resource.operatorConfirmRequired', lang)}</p>
          </div>
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {unacknowledgedDrafts.map((zone: any) => {
              const priority = (zone.priority || 'Low').charAt(0).toUpperCase() + (zone.priority || 'low').slice(1).toLowerCase()
              const isCritical = priority === 'Critical'
              return (
                <div key={zone.id} className={`rounded-xl border p-3.5 bg-white dark:bg-gray-900 ${isCritical ? 'border-rose-300 dark:border-rose-700' : 'border-violet-200 dark:border-violet-800'}`}>
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="text-sm font-bold text-gray-900 dark:text-white">{zone.zone}</p>
                      <p className="text-[10px] text-gray-400 dark:text-gray-300 mt-0.5">{zone.hazard_type || 'General'} - {zone.estimated_affected || 'unknown'} {t('admin.resource.affected', lang)}</p>
                    </div>
                    <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md font-bold ring-1 ${P_PILL[priority] || P_PILL.Low}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${P_DOT[priority] || P_DOT.Low}`} />{priority}
                    </span>
                  </div>
                  {zone.ai_recommendation && (
                    <p className="text-[11px] text-blue-600 dark:text-blue-400 mb-3 line-clamp-2 flex items-start gap-1.5">
                      <Brain className="w-3 h-3 flex-shrink-0 mt-0.5 opacity-50" />{zone.ai_recommendation}
                    </p>
                  )}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleAcknowledge(zone.id)}
                      disabled={acknowledging === zone.id}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-[10px] font-bold rounded-lg bg-violet-600 text-white hover:bg-violet-700 transition-colors disabled:opacity-50"
                    >
                      {acknowledging === zone.id ? <RefreshCw className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
                      {t('admin.resource.confirmDraft', lang)}
                    </button>
                    <button
                      onClick={() => handleDeploy(zone)}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-[10px] font-bold rounded-lg bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 ring-1 ring-emerald-500/20 transition-colors"
                    >
                      <Zap className="w-3 h-3" /> {t('admin.resource.deployNow', lang)}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* MAP */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
        <button onClick={() => setShowMap(p => !p)} className="w-full px-5 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2"><Map className="w-4 h-4 text-teal-500" /> {t('resource.deploymentZonesMap', lang)}</h3>
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 text-[10px] text-gray-400 dark:text-gray-300">
              {[
                { key: 'Critical', label: t('common.critical', lang) },
                { key: 'High', label: t('common.high', lang) },
                { key: 'Medium', label: t('common.medium', lang) },
                { key: 'Low', label: t('common.low', lang) },
              ].map(p => (
                <span key={p.key} className="flex items-center gap-1"><span className={`w-2 h-2 rounded-full ${P_DOT[p.key]}`} />{p.label}</span>
              ))}
            </div>
            {showMap ? <ChevronDown className="w-4 h-4 text-gray-400 dark:text-gray-300" /> : <ChevronRight className="w-4 h-4 text-gray-400 dark:text-gray-300" />}
          </div>
        </button>
        {showMap && (
          <div className="h-[50vh] min-h-[320px] max-h-[560px]">
            <Suspense fallback={<div className="h-full animate-pulse bg-gray-200 dark:bg-gray-800 rounded" />}>
              <DisasterMap reports={reports.filter(r => r.status === 'Urgent' || r.status === 'Verified')} deployments={deployments} center={loc.center} zoom={loc.zoom} showDistress showPredictions showRiskLayer showFloodMonitoring />
            </Suspense>
          </div>
        )}
      </div>

      {/* DEPLOYMENT ZONES */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2"><Layers className="w-4 h-4 text-violet-500" /> {t('resource.deploymentZones', lang)}</h3>
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-gray-400 dark:text-gray-300 font-medium">{zones.length} {t(zones.length === 1 ? 'resource.zone' : 'resource.zones', lang).toLowerCase()}</span>
            <div className="flex items-center rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              <button onClick={() => setZoneView('table')} className={`p-1.5 transition-colors ${zoneView === 'table' ? 'bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400' : 'text-gray-400 dark:text-gray-300 hover:text-gray-600 dark:hover:text-gray-300 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'}`} title={t('resource.tableView', lang)}><List className="w-3.5 h-3.5" /></button>
              <button onClick={() => setZoneView('grid')} className={`p-1.5 transition-colors ${zoneView === 'grid' ? 'bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400' : 'text-gray-400 dark:text-gray-300 hover:text-gray-600 dark:hover:text-gray-300 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'}`} title={t('resource.gridView', lang)}><LayoutGrid className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        </div>

        {/* Toolbar */}
        <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 flex flex-col sm:flex-row items-stretch sm:items-center gap-2 bg-gray-50/50 dark:bg-gray-800/20">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 dark:text-gray-300" />
            <input ref={searchRef} type="text" placeholder={t('resource.searchZones', lang)} value={zoneSearch} onChange={e => setZoneSearch(e.target.value)} className="w-full pl-9 pr-3 py-2 text-xs bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500 transition-all placeholder:text-gray-400 dark:text-gray-300" />
          </div>
          <div className="flex items-center gap-2">
            <select value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)} className="px-2.5 py-2 text-xs bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg">
              <option value="all">{t('resource.allPriorities', lang)}</option>
              <option value="Critical">{t('common.critical', lang)}</option>
              <option value="High">{t('common.high', lang)}</option>
              <option value="Medium">{t('common.medium', lang)}</option>
              <option value="Low">{t('common.low', lang)}</option>
            </select>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="px-2.5 py-2 text-xs bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg">
              <option value="all">{t('resource.allStatus', lang)}</option>
              <option value="deployed">{t('resource.deployed', lang)}</option>
              <option value="standby">{t('resource.standby', lang)}</option>
            </select>
          </div>
        </div>

        {/* Zones table */}
        {zoneView === 'table' && <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-[10px] font-bold text-gray-500 dark:text-gray-300 uppercase tracking-wider border-b border-gray-100 dark:border-gray-800">
                <th className="px-5 py-3 text-left"><SortBtn field="zone">{t('resource.zone', lang)}</SortBtn></th>
                <th className="px-3 py-3 text-left"><SortBtn field="priority">{t('common.priority', lang)}</SortBtn></th>
                <th className="px-3 py-3 text-left"><SortBtn field="status">{t('common.status', lang)}</SortBtn></th>
                <th className="px-3 py-3 text-right"><SortBtn field="reports">{t('common.reports', lang)}</SortBtn></th>
                <th className="px-3 py-3 text-right"><SortBtn field="affected">{t('resource.affected', lang)}</SortBtn></th>
                <th className="px-3 py-3 text-left">{t('resource.assets', lang)}</th>
                <th className="px-3 py-3 text-left">{t('resource.aiRecommendation', lang)}</th>
                <th className="px-5 py-3 text-right">{t('common.actions', lang)}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-800/50">
              {zones.map((zone: any, i: number) => {
                const isExpanded = expandedZone === (zone.id || String(i))
                const affected = parseAffected(zone.estimated_affected)
                const priority = (zone.priority || 'Low').charAt(0).toUpperCase() + (zone.priority || 'low').slice(1).toLowerCase()
                return (
                  <React.Fragment key={zone.id || i}>
                    <tr className={`group text-xs hover:bg-gray-50 dark:hover:bg-gray-800/20 transition-colors border-l-2 ${
                        (zone.priority || '').toLowerCase() === 'critical' ? 'border-l-rose-500 bg-rose-50/10 dark:bg-rose-900/5' :
                        (zone.priority || '').toLowerCase() === 'high' ? 'border-l-amber-400' :
                        zone.deployed ? 'border-l-emerald-400 bg-emerald-50/30 dark:bg-emerald-900/5' :
                        'border-l-transparent'
                      }`}>
                      <td className="px-5 py-3.5">
                        <button onClick={() => { setExpandedZone(isExpanded ? null : (zone.id || String(i))); if (!isExpanded && zone.id) loadAssets(zone.id) }} className="flex items-center gap-1.5 font-bold text-gray-900 dark:text-white hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors whitespace-nowrap min-w-[140px]">
                          {isExpanded ? <ChevronDown className="w-3 h-3 text-gray-400 dark:text-gray-300 flex-shrink-0" /> : <ChevronRight className="w-3 h-3 text-gray-400 dark:text-gray-300 flex-shrink-0" />}
                          <span className="truncate">{zone.zone}</span>
                          {zone.hazard_type && zone.hazard_type !== 'general' && (() => { const HIcon = HAZARD_CATEGORIES[zone.hazard_type]?.icon; return HIcon ? <span title={HAZARD_CATEGORIES[zone.hazard_type]?.label || zone.hazard_type}><HIcon className="w-3.5 h-3.5 opacity-70" /></span> : null })()}
                        </button>
                        {zone.is_ai_draft && (
                          <span className="mt-0.5 inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded font-bold bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-300 ring-1 ring-violet-500/20">
                            <Cpu className="w-2.5 h-2.5" /> {t('admin.resource.aiDraft', lang)}
                          </span>
                        )}
                        {zone.report_id && (
                          <span className="mt-0.5 ml-1 inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded font-bold bg-sky-100 dark:bg-sky-900/30 text-sky-600 dark:text-sky-300 ring-1 ring-sky-500/20">
                            <Link2 className="w-2.5 h-2.5" /> {zone.report_number || `RPT-${zone.report_id?.slice(0, 6).toUpperCase()}`}
                          </span>
                        )}
                        {zone.needs_mutual_aid && (
                          <span className="mt-0.5 ml-1 inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded font-bold bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-300 ring-1 ring-orange-500/20">
                            <Users className="w-2.5 h-2.5" /> {t('admin.resource.mutualAid', lang)}
                          </span>
                        )}
                        {zone.hazard_type && zone.hazard_type !== 'general' && (
                          <span className="mt-0.5 ml-1 inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded font-bold bg-sky-50 dark:bg-sky-900/10 text-sky-600 dark:text-sky-400 ring-1 ring-sky-500/20 capitalize">
                            {zone.hazard_type.replace(/_/g, '\u202f')}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3.5">
                        <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md font-bold ring-1 ${P_PILL[priority] || P_PILL.Low}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${P_DOT[priority] || P_DOT.Low}`} />
                          {priority}
                        </span>
                      </td>
                      <td className="px-3 py-3.5">
                        {zone.deployed ? (
                          <>
                            <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md font-bold bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-500/20">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> {t('common.active', lang)}
                            </span>
                            {zone.deployed_at && (() => {
                              const dur = getDeploymentDuration(zone.deployed_at)
                              return <span className={`flex items-center gap-0.5 text-[9px] font-mono mt-0.5 ${dur.isLong ? 'text-amber-500 animate-pulse' : 'text-gray-400'}`}><Clock className="w-3 h-3" /> {dur.label}</span>
                            })()}
                          </>
                        ) : (
                          <span className="text-[10px] px-2 py-0.5 rounded-md font-medium bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-300">{t('resource.standby', lang)}</span>
                        )}
                      </td>
                      <td className="px-3 py-3.5 text-right font-bold tabular-nums text-gray-900 dark:text-white">{zone.active_reports}</td>
                      <td className="px-3 py-3.5 text-right font-bold tabular-nums text-rose-600 dark:text-rose-400">{affected > 0 ? affected.toLocaleString() : '--'}</td>
                      <td className="px-3 py-3.5">
                        <div className="flex items-center gap-2">
                          {Number(zone.ambulances) > 0 && <span className="flex items-center gap-0.5 text-[10px] text-gray-600 dark:text-gray-300"><Truck className="w-3 h-3 text-red-500" />{zone.ambulances}</span>}
                          {Number(zone.fire_engines) > 0 && <span className="flex items-center gap-0.5 text-[10px] text-gray-600 dark:text-gray-300"><Flame className="w-3 h-3 text-orange-500" />{zone.fire_engines}</span>}
                          {Number(zone.rescue_boats) > 0 && <span className="flex items-center gap-0.5 text-[10px] text-gray-600 dark:text-gray-300"><Anchor className="w-3 h-3 text-blue-500" />{zone.rescue_boats}</span>}
                          {!Number(zone.ambulances) && !Number(zone.fire_engines) && !Number(zone.rescue_boats) && <span className="text-[10px] text-gray-400 dark:text-gray-300">--</span>}
                        </div>
                      </td>
                      <td className="px-3 py-3.5 max-w-[260px]">
                        <p className="text-[11px] text-blue-600 dark:text-blue-400 truncate" title={zone.ai_recommendation}>
                          <Brain className="w-3 h-3 inline mr-1 opacity-50" />{zone.ai_recommendation || '--'}
                        </p>
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {zone.is_ai_draft && !zone.ai_draft_acknowledged_at && (
                            <button onClick={() => handleAcknowledge(zone.id)} disabled={acknowledging === zone.id} className="px-3 py-1.5 text-[10px] font-bold rounded-lg bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-400 hover:bg-violet-100 ring-1 ring-violet-500/20 transition-colors flex items-center gap-1">
                              {acknowledging === zone.id ? <RefreshCw className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />} Ack
                            </button>
                          )}
                          {zone.deployed ? (
                            <button onClick={() => handleRecall(zone)} className="px-3 py-1.5 text-[10px] font-bold rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/40 ring-1 ring-amber-500/20 transition-colors">{t('resource.recall', lang)}</button>
                          ) : (
                            <button onClick={() => handleDeploy(zone)} className="px-3 py-1.5 text-[10px] font-bold rounded-lg bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 ring-1 ring-emerald-500/20 transition-colors">{t('resource.deploy', lang)}</button>
                          )}
                          {user?.role === 'admin' && (
                            <button onClick={() => handleDelete(zone)} className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400 transition-colors" title="Delete zone"><Trash2 className="w-3.5 h-3.5" /></button>
                          )}
                        </div>
                      </td>
                    </tr>

                    {/* Expanded detail row */}
                    {isExpanded && (
                      <tr>
                        <td colSpan={8} className="px-5 py-4 bg-gray-50/50 dark:bg-gray-800/20">
                          {/* Header with Edit toggle */}
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-extrabold text-gray-400 dark:text-gray-400 uppercase tracking-wider">{t('admin.resource.zoneDetails', lang)}</span>
                              {zone.hazard_type && zone.hazard_type !== 'general' && (
                                <span className="text-[10px] px-2 py-0.5 rounded-md font-bold bg-gradient-to-r from-violet-50 to-indigo-50 dark:from-violet-900/20 dark:to-indigo-900/20 text-violet-700 dark:text-violet-300 ring-1 ring-violet-500/20 flex items-center gap-1">
                                  {(() => { const HIcon = HAZARD_CATEGORIES[zone.hazard_type]?.icon || FileText; return <HIcon className="w-3 h-3" /> })()} {HAZARD_CATEGORIES[zone.hazard_type]?.label || zone.hazard_type}
                                </span>
                              )}
                            </div>
                            {editingZone !== zone.id ? (
                              <button onClick={() => startEdit(zone)} className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">
                                <Edit3 className="w-3 h-3" /> {t('admin.resource.editZone', lang)}
                              </button>
                            ) : (
                              <div className="flex items-center gap-1.5">
                                <button onClick={() => saveEdit(zone.id)} disabled={savingEdit} className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors disabled:opacity-50">
                                  {savingEdit ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Save
                                </button>
                                <button onClick={cancelEdit} className="px-2.5 py-1 text-[10px] font-semibold rounded-lg text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">{t('admin.resource.cancel', lang)}</button>
                              </div>
                            )}
                          </div>

                          {/* Inline Edit Panel */}
                          {editingZone === zone.id ? (
                            <div className="mb-4 p-3 rounded-xl border border-violet-200 dark:border-violet-800 bg-violet-50/30 dark:bg-violet-900/5 space-y-3">
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                <div>
                                  <label className="text-[10px] font-bold text-gray-500 uppercase">{t('admin.resource.priority', lang)}</label>
                                  <select value={editForm.priority} onChange={e => setEditForm(f => ({ ...f, priority: e.target.value }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg dark:text-white">
                                    {['Critical', 'High', 'Medium', 'Low'].map(p => <option key={p} value={p}>{p}</option>)}
                                  </select>
                                </div>
                                <div>
                                  <label className="text-[10px] font-bold text-gray-500 uppercase">{t('admin.resource.hazardType', lang)}</label>
                                  <select value={editForm.hazard_type} onChange={e => setEditForm(f => ({ ...f, hazard_type: e.target.value }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg dark:text-white">
                                    {Object.entries(HAZARD_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                                  </select>
                                </div>
                                <div>
                                  <label className="text-[10px] font-bold text-gray-500 uppercase">{t('admin.resource.reports', lang)}</label>
                                  <input type="number" min={0} value={editForm.active_reports} onChange={e => setEditForm(f => ({ ...f, active_reports: e.target.value }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg dark:text-white" />
                                </div>
                                <div>
                                  <label className="text-[10px] font-bold text-gray-500 uppercase">{t('admin.resource.affected', lang)}</label>
                                  <input type="text" value={editForm.estimated_affected} onChange={e => setEditForm(f => ({ ...f, estimated_affected: e.target.value }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg dark:text-white" placeholder={t('admin.resource.affectedPlaceholder', lang)} />
                                </div>
                              </div>
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                <div>
                                  <label className="text-[10px] font-bold text-gray-500 uppercase flex items-center gap-1"><Truck className="w-3 h-3 text-red-500" /> {t('admin.resource.ambulances', lang)}</label>
                                  <input type="number" min={0} value={editForm.ambulances} onChange={e => setEditForm(f => ({ ...f, ambulances: e.target.value }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg dark:text-white font-bold" />
                                </div>
                                <div>
                                  <label className="text-[10px] font-bold text-gray-500 uppercase flex items-center gap-1"><Flame className="w-3 h-3 text-orange-500" /> {t('admin.resource.fire', lang)}</label>
                                  <input type="number" min={0} value={editForm.fire_engines} onChange={e => setEditForm(f => ({ ...f, fire_engines: e.target.value }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg dark:text-white font-bold" />
                                </div>
                                <div>
                                  <label className="text-[10px] font-bold text-gray-500 uppercase flex items-center gap-1"><Anchor className="w-3 h-3 text-blue-500" /> {t('admin.resource.boats', lang)}</label>
                                  <input type="number" min={0} value={editForm.rescue_boats} onChange={e => setEditForm(f => ({ ...f, rescue_boats: e.target.value }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg dark:text-white font-bold" />
                                </div>
                                <div>
                                  <label className="text-[10px] font-bold text-gray-500 uppercase flex items-center gap-1"><Shield className="w-3 h-3 text-indigo-500" /> {t('admin.resource.incidentCommander', lang)}</label>
                                  <input type="text" value={editForm.incident_commander} onChange={e => setEditForm(f => ({ ...f, incident_commander: e.target.value }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg dark:text-white" placeholder={t('admin.resource.namePlaceholder', lang)} />
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs mb-3">
                              <div><span className="text-gray-400 dark:text-gray-300 font-medium">{t('resource.zoneId', lang)}</span><p className="font-mono font-bold text-gray-700 dark:text-gray-300 mt-0.5">{zone.id || '--'}</p></div>
                              <div><span className="text-gray-400 dark:text-gray-300 font-medium">{t('resource.priorityScore', lang)}</span><p className="font-bold text-gray-700 dark:text-gray-300 mt-0.5">{P_ORDER[priority] || 0}/4</p></div>
                              <div><span className="text-gray-400 dark:text-gray-300 font-medium">{t('resource.estimatedAffected', lang)}</span><p className="font-bold text-rose-600 dark:text-rose-400 mt-0.5">{zone.estimated_affected || '--'}</p></div>
                              <div><span className="text-gray-400 dark:text-gray-300 font-medium">{t('resource.deploymentStatus', lang)}</span><p className={`font-bold mt-0.5 ${zone.deployed ? 'text-emerald-600' : 'text-gray-500 dark:text-gray-300'}`}>{zone.deployed ? t('resource.resourcesDeployed', lang) : t('resource.awaitingDeployment', lang)}</p></div>
                            </div>
                          )}
                          {/* Module 1 & 2: AI draft + linked report info */}
                          {(zone.is_ai_draft || zone.report_id || zone.prediction_id) && (
                            <div className="flex flex-wrap gap-2 mb-3">
                              {zone.is_ai_draft && (
                                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 text-[11px] text-violet-700 dark:text-violet-300 font-semibold">
                                  <Cpu className="w-3 h-3" /> {t('resource.aiDraftAwaiting', lang)}
                                </div>
                              )}
                              {zone.report_id && (
                                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800 text-[11px] text-sky-700 dark:text-sky-300 font-medium">
                                  <Link2 className="w-3 h-3" /> {t('resource.linkedReport', lang)}: <span className="font-mono font-bold">{zone.report_number || `RPT-${zone.report_id?.slice(0, 6).toUpperCase()}`}</span>
                                </div>
                              )}
                              {zone.prediction_id && (
                                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 text-[11px] text-indigo-700 dark:text-indigo-300 font-medium">
                                  <Brain className="w-3 h-3" /> {t('resource.prediction', lang)}: <span className="font-mono">PRD-{zone.prediction_id?.slice(0, 6).toUpperCase()}</span>
                                </div>
                              )}
                            </div>
                          )}
                          {/* AI recommendation full */}
                          <div className="bg-blue-50 dark:bg-blue-900/10 rounded-lg p-3 border border-blue-100 dark:border-blue-900/30 mb-3">
                            <p className="text-xs text-blue-700 dark:text-blue-300 flex items-start gap-2">
                              <Brain className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 opacity-60" />
                              <span>{zone.ai_recommendation || t('resource.noRecommendation', lang)}</span>
                            </p>
                          </div>
                          {/* Module 3: Asset tracking panel */}
                          <div className="mb-3">
                            <div className="flex items-center justify-between mb-2">
                              <p className="text-[10px] font-bold text-gray-400 dark:text-gray-300 uppercase tracking-wider flex items-center gap-1.5">
                                <MapPin className="w-3 h-3" /> {t('admin.resource.assetTracking', lang)}
                                {zone.id && assetsByZone[zone.id] && (
                                  <span className="ml-1 px-1.5 py-0.5 rounded-md bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 font-bold">
                                    {assetsByZone[zone.id].filter((a: any) => a.status === 'on_site').length}/{assetsByZone[zone.id].length} {t('admin.resource.onSite', lang)}
                                  </span>
                                )}
                              </p>
                              {zone.id && (
                                <button onClick={() => { setShowAddAsset(showAddAsset === zone.id ? null : zone.id); setAssetForm({ asset_type: 'ambulance', call_sign: '', status: 'staging', crew_count: '1', notes: '' }) }} className="h-6 px-2 text-[10px] font-bold rounded-md bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 flex items-center gap-1 transition-colors">
                                  <Plus className="w-2.5 h-2.5" /> {t('admin.resource.addAsset', lang)}
                                </button>
                              )}
                            </div>
                            {loadingAssetsFor === zone.id && <p className="text-[11px] text-gray-400 dark:text-gray-300">{t('admin.resource.loadingAssets', lang)}</p>}
                            {zone.id && assetsByZone[zone.id] && (
                              <div className="space-y-1">
                                {assetsByZone[zone.id].length === 0 && <p className="text-[11px] text-gray-400 dark:text-gray-300">{t('admin.resource.noAssetsTracked', lang)}</p>}
                                {assetsByZone[zone.id].map((asset: any) => {
                                  const statusColor: Record<string, string> = {
                                    staging: 'bg-slate-500', en_route: 'bg-amber-500', on_site: 'bg-emerald-500',
                                    returning: 'bg-blue-500', available: 'bg-teal-500', off_duty: 'bg-gray-400',
                                  }
                                  return (
                                    <div key={asset.id} className="flex items-center gap-2 p-2 rounded-lg bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800">
                                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusColor[asset.status] || 'bg-gray-400'}`} />
                                      <span className="font-mono font-bold text-[11px] text-gray-800 dark:text-gray-200 min-w-[60px]">{asset.call_sign}</span>
                                      <span className="text-[10px] text-gray-500 dark:text-gray-400 min-w-[70px]">{asset.asset_type.replace(/_/g, ' ')}</span>
                                      <select value={asset.status} onChange={e => handleUpdateAssetStatus(asset.id, e.target.value, zone.id)} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200">
                                        {['staging', 'en_route', 'on_site', 'returning', 'available', 'off_duty'].map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                                      </select>
                                      {asset.last_lat && <span className="text-[9px] text-gray-400 dark:text-gray-300 font-mono flex items-center gap-0.5"><MapPin className="w-2.5 h-2.5" />{Number(asset.last_lat).toFixed(3)},{Number(asset.last_lng).toFixed(3)}</span>}
                                      {asset.crew_count > 0 && <span className="text-[10px] text-gray-500 dark:text-gray-400">{asset.crew_count} {t('admin.resource.crew', lang)}</span>}
                                      <button onClick={() => handleDeleteAsset(asset.id, zone.id)} className="ml-auto p-0.5 rounded text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"><Trash2 className="w-3 h-3" /></button>
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                            {/* Add asset inline form */}
                            {showAddAsset === zone.id && (
                              <div className="mt-2 p-3 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50/30 dark:bg-emerald-900/10">
                                <p className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 uppercase tracking-wider mb-2">{t('admin.resource.addAsset', lang)}</p>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
                                  <select value={assetForm.asset_type} onChange={e => setAssetForm(f => ({ ...f, asset_type: e.target.value }))} className="px-2 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg dark:text-white">
                                    {['ambulance','fire_engine','rescue_boat','helicopter','hazmat_unit','police','medical_unit','urban_search_rescue','other'].map(t => <option key={t} value={t}>{t.replace(/_/g,' ')}</option>)}
                                  </select>
                                  <input type="text" placeholder={t('admin.resource.callSignPlaceholder', lang)} value={assetForm.call_sign} onChange={e => setAssetForm(f => ({ ...f, call_sign: e.target.value }))} className="px-2 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg placeholder:text-gray-400 dark:text-white" />
                                  <select value={assetForm.status} onChange={e => setAssetForm(f => ({ ...f, status: e.target.value }))} className="px-2 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg dark:text-white">
                                    {['staging','en_route','on_site','returning','available','off_duty'].map(s => <option key={s} value={s}>{s.replace('_',' ')}</option>)}
                                  </select>
                                  <input type="number" min={0} placeholder={t('admin.resource.crewPlaceholder', lang)} value={assetForm.crew_count} onChange={e => setAssetForm(f => ({ ...f, crew_count: e.target.value }))} className="px-2 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg dark:text-white" />
                                </div>
                                <div className="flex gap-2">
                                  <button onClick={() => handleAddAsset(zone.id)} className="px-3 py-1.5 text-[10px] font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors">{t('admin.resource.add', lang)}</button>
                                  <button onClick={() => setShowAddAsset(null)} className="px-3 py-1.5 text-[10px] font-semibold rounded-lg text-gray-500 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">{t('admin.resource.cancel', lang)}</button>
                                </div>
                              </div>
                            )}
                          </div>
                          {/* Zone activity */}
                          <div className="mb-4">
                            <p className="text-[10px] font-bold text-gray-400 dark:text-gray-300 uppercase tracking-wider mb-2">{t('resource.zoneActivityLog', lang)}</p>
                            {auditLog.filter(a => (a.action_type === 'deploy' || a.action_type === 'recall') && a.target_id === zone.id).slice(0, 4).map((log, li) => (
                              <div key={li} className="flex items-center gap-2 text-[11px] py-1">
                                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${log.action_type === 'deploy' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                                <span className="text-gray-700 dark:text-gray-300">{log.action}</span>
                                <span className="ml-auto text-gray-400 dark:text-gray-300 text-[10px]">{new Date(log.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                              </div>
                            ))}
                            {auditLog.filter(a => (a.action_type === 'deploy' || a.action_type === 'recall') && a.target_id === zone.id).length === 0 && (
                              <p className="text-[11px] text-gray-400 dark:text-gray-300">{t('resource.noActivityRecorded', lang)}</p>
                            )}
                          </div>

                          {/* Mutual Aid Toggle */}
                          <div className="flex items-center justify-between mb-3 p-2.5 rounded-lg border border-orange-100 dark:border-orange-800 bg-orange-50/30 dark:bg-orange-900/5">
                            <div className="flex items-center gap-2">
                              <Users className="w-4 h-4 text-orange-500" />
                              <span className="text-xs font-bold text-gray-900 dark:text-white">{t('admin.resource.mutualAid', lang)}</span>
                              {zone.needs_mutual_aid && <span className="text-[9px] px-1.5 py-0.5 bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-300 font-bold rounded">{t('admin.resource.activeRequest', lang)}</span>}
                            </div>
                            <button
                              onClick={() => handleToggleMutualAid(zone)}
                              disabled={togglingMutualAid === zone.id}
                              className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold rounded-lg transition-colors ${zone.needs_mutual_aid ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 hover:bg-orange-200' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'}`}
                            >
                              {togglingMutualAid === zone.id ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Users className="w-3 h-3" />}
                              {zone.needs_mutual_aid ? 'Clear Request' : 'Request Mutual Aid'}
                            </button>
                          </div>

                          {/* Incident Commander */}
                          {zone.incident_commander && (
                            <div className="mb-3 flex items-center gap-2 p-2.5 rounded-lg border border-indigo-100 dark:border-indigo-800 bg-indigo-50/30 dark:bg-indigo-900/5">
                              <Shield className="w-4 h-4 text-indigo-500 flex-shrink-0" />
                              <span className="text-xs font-bold text-gray-900 dark:text-white">IC:</span>
                              <span className="text-xs text-indigo-700 dark:text-indigo-300 font-semibold">{zone.incident_commander}</span>
                            </div>
                          )}

                          {/* ICS Operations Log */}
                          <div>
                            <p className="text-[10px] font-bold text-gray-400 dark:text-gray-300 uppercase tracking-wider mb-2 flex items-center gap-1">
                              <Radio className="w-3 h-3" /> {t('admin.resource.icsOperationsLog', lang)}
                            </p>
                            <div className="space-y-1 mb-2 max-h-32 overflow-y-auto">
                              {(zone.ops_log || []).length === 0 && (
                                <p className="text-[10px] text-gray-400 dark:text-gray-300">{t('admin.resource.noLogEntries', lang)}</p>
                              )}
                              {(zone.ops_log || []).map((entry: any, li: number) => (
                                <div key={li} className="flex gap-2 text-[10px] p-1.5 rounded bg-gray-50 dark:bg-gray-800/40">
                                  <span className="font-mono text-gray-400 whitespace-nowrap">{new Date(entry.ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
                                  <span className="font-semibold text-gray-600 dark:text-gray-300 min-w-[60px] truncate">{entry.operator}</span>
                                  <span className="text-gray-700 dark:text-gray-200">{entry.note}</span>
                                </div>
                              ))}
                            </div>
                            <div className="flex gap-2">
                              <input
                                type="text"
                                placeholder={t('admin.resource.addLogEntryPlaceholder', lang)}
                                value={opsNoteByZone[zone.id] || ''}
                                onChange={e => setOpsNoteByZone(prev => ({ ...prev, [zone.id]: e.target.value }))}
                                onKeyDown={e => e.key === 'Enter' && handleAddOpsLog(zone.id)}
                                className="flex-1 px-2 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg dark:text-white placeholder:text-gray-400"
                              />
                              <button
                                onClick={() => handleAddOpsLog(zone.id)}
                                disabled={savingOpsNote === zone.id}
                                className="px-3 py-1.5 text-[10px] font-bold rounded-lg bg-gray-900 dark:bg-white text-white dark:text-gray-900 hover:bg-gray-700 dark:hover:bg-gray-200 transition-colors flex items-center gap-1"
                              >
                                {savingOpsNote === zone.id ? <RefreshCw className="w-3 h-3 animate-spin" /> : <><FileText className="w-3 h-3" /> {t('admin.resource.log', lang)}</>}
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
          {zones.length === 0 && (
            <div className="text-center py-12">
              <Layers className="w-8 h-8 text-gray-300 dark:text-gray-400 mx-auto mb-2" />
              <p className="text-sm text-gray-400 dark:text-gray-300">{deployments.length === 0 ? 'No deployment zones yet -- create one to get started.' : t('resource.noZonesMatch', lang)}</p>
              {deployments.length === 0 && (
                <button onClick={() => { const init = getSmartResourceSuggestion('general', 'Medium'); setCreateForm({ zone: '', priority: 'Medium', active_reports: '0', estimated_affected: '', ai_recommendation: init.reasoning, commander_notes: '', ambulances: String(init.ambulances), fire_engines: String(init.fire_engines), rescue_boats: String(init.rescue_boats), lat: '', lng: '', report_id: '', hazard_type: 'general', incident_commander: '', radio_channel: '', weather_conditions: 'clear', evacuation_status: 'none', access_routes: '' }); setCreateStep(0); setShowCreateModal(true) }} className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-400 hover:bg-violet-100 dark:hover:bg-violet-900/30 ring-1 ring-violet-500/20 transition-colors"><Plus className="w-3.5 h-3.5" /> Create First Zone</button>
              )}
            </div>
          )}
        </div>}

        {/* Grid view */}
        {zoneView === 'grid' && (
          <div className="p-5">
            {zones.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {zones.map((zone: any, i: number) => {
                const isExpanded = expandedZone === (zone.id || String(i))
                const affected = parseAffected(zone.estimated_affected)
                const priority = (zone.priority || 'Low').charAt(0).toUpperCase() + (zone.priority || 'low').slice(1).toLowerCase()
                const isCriticalRow = priority === 'Critical'
                return (
                  <div
                    key={zone.id || i}
                    className={`rounded-xl border transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 ${
                      isCriticalRow ? 'border-rose-300 dark:border-rose-800 ring-1 ring-rose-200 dark:ring-rose-900' :
                      zone.deployed ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/30 dark:bg-emerald-900/5' :
                      'border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900'
                    }`}
                    style={{ animationDelay: `${i * 40}ms` }}
                  >
                      <div className="p-4">
                        <div className="flex items-start justify-between mb-3">
                          <button onClick={() => { setExpandedZone(isExpanded ? null : (zone.id || String(i))); if (!isExpanded && zone.id) loadAssets(zone.id) }} className="flex items-center gap-1.5 font-bold text-sm text-gray-900 dark:text-white hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors text-left">
                            {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-gray-400 dark:text-gray-300 flex-shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-400 dark:text-gray-300 flex-shrink-0" />}
                            {zone.hazard_type && zone.hazard_type !== 'general' && (() => { const HIcon = HAZARD_CATEGORIES[zone.hazard_type]?.icon; return HIcon ? <span title={HAZARD_CATEGORIES[zone.hazard_type]?.label}><HIcon className={`w-4 h-4 ${HAZARD_CATEGORIES[zone.hazard_type]?.color || ''}`} /></span> : null })()}
                            {zone.zone}
                          </button>
                          <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md font-bold ring-1 ${P_PILL[priority] || P_PILL.Low}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${P_DOT[priority] || P_DOT.Low}`} />{priority}
                          </span>
                        </div>
                        {(zone.is_ai_draft || zone.report_id || zone.needs_mutual_aid) && (
                          <div className="flex flex-wrap items-center gap-1 mb-2">
                            {zone.is_ai_draft && <span className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded font-bold bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-300 ring-1 ring-violet-500/20"><Cpu className="w-2.5 h-2.5" /> AI DRAFT</span>}
                            {zone.report_id && <span className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded font-bold bg-sky-100 dark:bg-sky-900/30 text-sky-600 dark:text-sky-300 ring-1 ring-sky-500/20"><Link2 className="w-2.5 h-2.5" /> {zone.report_number || `RPT-${zone.report_id?.slice(0, 6).toUpperCase()}`}</span>}
                            {zone.needs_mutual_aid && <span className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded font-bold bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-300 ring-1 ring-orange-500/20"><Users className="w-2.5 h-2.5" /> MUTUAL AID</span>}
                          </div>
                        )}
                        <div className="flex items-center gap-2 mb-3">
                          {zone.deployed ? (
                            <>
                              <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md font-bold bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-500/20">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> {t('common.active', lang)}
                              </span>
                              {zone.deployed_at && (() => {
                                const dur = getDeploymentDuration(zone.deployed_at)
                                return <span className={`flex items-center gap-0.5 text-[9px] font-mono ${dur.isLong ? 'text-amber-500 animate-pulse' : 'text-gray-400'}`}><Clock className="w-3 h-3" /> {dur.label}</span>
                              })()}
                            </>
                          ) : (
                            <span className="text-[10px] px-2 py-0.5 rounded-md font-medium bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-300">{t('resource.standby', lang)}</span>
                          )}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-center mb-3">
                          <div className="bg-gray-50 dark:bg-gray-800/40 rounded-lg p-2">
                            <p className="text-[9px] text-gray-400 dark:text-gray-300 font-medium uppercase">{t('common.reports', lang)}</p>
                            <p className="text-sm font-extrabold text-gray-900 dark:text-white tabular-nums">{zone.active_reports}</p>
                          </div>
                          <div className="bg-gray-50 dark:bg-gray-800/40 rounded-lg p-2">
                            <p className="text-[9px] text-gray-400 dark:text-gray-300 font-medium uppercase">{t('resource.affected', lang)}</p>
                            <p className="text-sm font-extrabold text-rose-600 dark:text-rose-400 tabular-nums">{affected > 0 ? affected.toLocaleString() : '--'}</p>
                          </div>
                          <div className="bg-gray-50 dark:bg-gray-800/40 rounded-lg p-2">
                            <p className="text-[9px] text-gray-400 dark:text-gray-300 font-medium uppercase">{t('resource.assets', lang)}</p>
                            <p className="text-sm font-extrabold text-gray-900 dark:text-white tabular-nums">{(Number(zone.ambulances) || 0) + (Number(zone.fire_engines) || 0) + (Number(zone.rescue_boats) || 0)}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 mb-3">
                          {Number(zone.ambulances) > 0 && <span className="flex items-center gap-0.5 text-[10px] text-gray-600 dark:text-gray-300"><Truck className="w-3 h-3 text-red-500" />{zone.ambulances}</span>}
                          {Number(zone.fire_engines) > 0 && <span className="flex items-center gap-0.5 text-[10px] text-gray-600 dark:text-gray-300"><Flame className="w-3 h-3 text-orange-500" />{zone.fire_engines}</span>}
                          {Number(zone.rescue_boats) > 0 && <span className="flex items-center gap-0.5 text-[10px] text-gray-600 dark:text-gray-300"><Anchor className="w-3 h-3 text-blue-500" />{zone.rescue_boats}</span>}
                        </div>
                        {zone.ai_recommendation && (
                          <p className="text-[11px] text-blue-600 dark:text-blue-400 mb-3 line-clamp-2"><Brain className="w-3 h-3 inline mr-1 opacity-50" />{zone.ai_recommendation}</p>
                        )}
                        <div className="flex items-center justify-between gap-2">
                          {user?.role === 'admin' && (
                            <button onClick={() => handleDelete(zone)} className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400 transition-colors" title="Delete zone"><Trash2 className="w-3.5 h-3.5" /></button>
                          )}
                          <div className="flex items-center gap-1.5 ml-auto">
                            {zone.is_ai_draft && !zone.ai_draft_acknowledged_at && (
                              <button onClick={() => handleAcknowledge(zone.id)} disabled={acknowledging === zone.id} className="flex items-center gap-1 px-3 py-1.5 text-[10px] font-bold rounded-lg bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-400 hover:bg-violet-100 ring-1 ring-violet-500/20 transition-colors">
                                {acknowledging === zone.id ? <RefreshCw className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />} Ack
                              </button>
                            )}
                            {zone.deployed ? (
                              <button onClick={() => handleRecall(zone)} className="px-3 py-1.5 text-[10px] font-bold rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/40 ring-1 ring-amber-500/20 transition-colors">{t('resource.recall', lang)}</button>
                            ) : (
                              <button onClick={() => handleDeploy(zone)} className="px-3 py-1.5 text-[10px] font-bold rounded-lg bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 ring-1 ring-emerald-500/20 transition-colors">{t('resource.deploy', lang)}</button>
                            )}
                          </div>
                        </div>
                      </div>
                      {/* Expanded detail in grid */}
                      {isExpanded && (
                        <div className="px-4 pb-4 pt-1 border-t border-gray-100 dark:border-gray-800">
                          {/* Edit toggle */}
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] font-extrabold text-gray-400 dark:text-gray-400 uppercase tracking-wider">Details</span>
                            {editingZone !== zone.id ? (
                              <button onClick={() => startEdit(zone)} className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">
                                <Edit3 className="w-3 h-3" /> Edit
                              </button>
                            ) : (
                              <div className="flex items-center gap-1.5">
                                <button onClick={() => saveEdit(zone.id)} disabled={savingEdit} className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors disabled:opacity-50">
                                  {savingEdit ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Save
                                </button>
                                <button onClick={cancelEdit} className="px-2 py-0.5 text-[10px] font-semibold rounded-lg text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">Cancel</button>
                              </div>
                            )}
                          </div>
                          {editingZone === zone.id ? (
                            <div className="mb-3 p-2.5 rounded-xl border border-violet-200 dark:border-violet-800 bg-violet-50/30 dark:bg-violet-900/5 space-y-2">
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="text-[10px] font-bold text-gray-500 uppercase">Priority</label>
                                  <select value={editForm.priority} onChange={e => setEditForm(f => ({ ...f, priority: e.target.value }))} className="w-full mt-0.5 px-2 py-1 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg dark:text-white">
                                    {['Critical', 'High', 'Medium', 'Low'].map(p => <option key={p} value={p}>{p}</option>)}
                                  </select>
                                </div>
                                <div>
                                  <label className="text-[10px] font-bold text-gray-500 uppercase">Hazard</label>
                                  <select value={editForm.hazard_type} onChange={e => setEditForm(f => ({ ...f, hazard_type: e.target.value }))} className="w-full mt-0.5 px-2 py-1 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg dark:text-white">
                                    {Object.entries(HAZARD_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                                  </select>
                                </div>
                              </div>
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                <div>
                                  <label className="text-[9px] font-bold text-gray-500 uppercase"><Truck className="w-2.5 h-2.5 inline text-red-500" /> Amb</label>
                                  <input type="number" min={0} value={editForm.ambulances} onChange={e => setEditForm(f => ({ ...f, ambulances: e.target.value }))} className="w-full mt-0.5 px-1.5 py-1 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg dark:text-white font-bold" />
                                </div>
                                <div>
                                  <label className="text-[9px] font-bold text-gray-500 uppercase"><Flame className="w-2.5 h-2.5 inline text-orange-500" /> Fire</label>
                                  <input type="number" min={0} value={editForm.fire_engines} onChange={e => setEditForm(f => ({ ...f, fire_engines: e.target.value }))} className="w-full mt-0.5 px-1.5 py-1 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg dark:text-white font-bold" />
                                </div>
                                <div>
                                  <label className="text-[9px] font-bold text-gray-500 uppercase"><Anchor className="w-2.5 h-2.5 inline text-blue-500" /> Boat</label>
                                  <input type="number" min={0} value={editForm.rescue_boats} onChange={e => setEditForm(f => ({ ...f, rescue_boats: e.target.value }))} className="w-full mt-0.5 px-1.5 py-1 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg dark:text-white font-bold" />
                                </div>
                                <div>
                                  <label className="text-[9px] font-bold text-gray-500 uppercase">Affected</label>
                                  <input type="text" value={editForm.estimated_affected} onChange={e => setEditForm(f => ({ ...f, estimated_affected: e.target.value }))} className="w-full mt-0.5 px-1.5 py-1 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg dark:text-white" />
                                </div>
                              </div>
                              <div>
                                <label className="text-[9px] font-bold text-gray-500 uppercase"><Shield className="w-2.5 h-2.5 inline text-indigo-500" /> Incident Commander</label>
                                <input type="text" value={editForm.incident_commander} onChange={e => setEditForm(f => ({ ...f, incident_commander: e.target.value }))} className="w-full mt-0.5 px-2 py-1 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg dark:text-white" placeholder="Name" />
                              </div>
                            </div>
                          ) : (
                            <div className="grid grid-cols-2 gap-3 text-xs mb-3">
                              <div><span className="text-gray-400 dark:text-gray-300 font-medium">{t('resource.zoneId', lang)}</span><p className="font-mono font-bold text-gray-700 dark:text-gray-300 mt-0.5">{zone.id || '--'}</p></div>
                              <div><span className="text-gray-400 dark:text-gray-300 font-medium">{t('resource.priorityScore', lang)}</span><p className="font-bold text-gray-700 dark:text-gray-300 mt-0.5">{P_ORDER[priority] || 0}/4</p></div>
                              <div><span className="text-gray-400 dark:text-gray-300 font-medium">{t('resource.estimatedAffected', lang)}</span><p className="font-bold text-rose-600 dark:text-rose-400 mt-0.5">{zone.estimated_affected || '--'}</p></div>
                              <div><span className="text-gray-400 dark:text-gray-300 font-medium">{t('common.status', lang)}</span><p className={`font-bold mt-0.5 ${zone.deployed ? 'text-emerald-600' : 'text-gray-500 dark:text-gray-300'}`}>{zone.deployed ? t('resource.resourcesDeployed', lang) : t('resource.awaitingDeployment', lang)}</p></div>
                            </div>
                          )}
                          {(zone.is_ai_draft || zone.report_id || zone.prediction_id) && (
                            <div className="flex flex-wrap gap-1.5 mb-3">
                              {zone.is_ai_draft && <span className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-800 font-semibold"><Cpu className="w-3 h-3" /> {t('resource.aiDraftNeedsReview', lang)}</span>}
                              {zone.report_id && <span className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg bg-sky-50 dark:bg-sky-900/20 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800 font-medium"><Link2 className="w-3 h-3" /> {zone.report_number || `RPT-${zone.report_id?.slice(0, 6).toUpperCase()}`}</span>}
                            </div>
                          )}
                          {/* Assets summary */}
                          {zone.id && assetsByZone[zone.id] && assetsByZone[zone.id].length > 0 && (
                            <div className="mb-3">
                              <p className="text-[10px] font-bold text-gray-400 dark:text-gray-300 uppercase tracking-wider mb-1 flex items-center gap-1"><MapPin className="w-3 h-3" /> Assets ({assetsByZone[zone.id].filter((a: any) => a.status === 'on_site').length}/{assetsByZone[zone.id].length} on-site)</p>
                              <div className="flex flex-wrap gap-1">
                                {assetsByZone[zone.id].map((a: any) => {
                                  const dotColor: Record<string, string> = { staging: 'bg-slate-400', en_route: 'bg-amber-500', on_site: 'bg-emerald-500', returning: 'bg-blue-500', available: 'bg-teal-500', off_duty: 'bg-gray-400' }
                                  return <span key={a.id} className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300"><span className={`w-1.5 h-1.5 rounded-full ${dotColor[a.status] || 'bg-gray-400'}`} />{a.call_sign}</span>
                                })}
                              </div>
                            </div>
                          )}
                          <div className="bg-blue-50 dark:bg-blue-900/10 rounded-lg p-2.5 border border-blue-100 dark:border-blue-900/30 mb-3">
                            <p className="text-[11px] text-blue-700 dark:text-blue-300 flex items-start gap-1.5">
                              <Brain className="w-3 h-3 flex-shrink-0 mt-0.5 opacity-60" />
                              <span>{zone.ai_recommendation || t('resource.noRecommendation', lang)}</span>
                            </p>
                          </div>
                          {/* Zone activity log */}
                          <div className="mb-4">
                            <p className="text-[10px] font-bold text-gray-400 dark:text-gray-300 uppercase tracking-wider mb-2">{t('resource.zoneActivityLog', lang)}</p>
                            {auditLog.filter(a => (a.action_type === 'deploy' || a.action_type === 'recall') && a.target_id === zone.id).slice(0, 4).map((log, li) => (
                              <div key={li} className="flex items-center gap-2 text-[11px] py-1">
                                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${log.action_type === 'deploy' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                                <span className="text-gray-700 dark:text-gray-300">{log.action}</span>
                                <span className="ml-auto text-gray-400 dark:text-gray-300 text-[10px]">{new Date(log.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                              </div>
                            ))}
                            {auditLog.filter(a => (a.action_type === 'deploy' || a.action_type === 'recall') && a.target_id === zone.id).length === 0 && (
                              <p className="text-[11px] text-gray-400 dark:text-gray-300">{t('resource.noActivityRecorded', lang)}</p>
                            )}
                          </div>

                          {/* Mutual Aid Toggle */}
                          <div className="flex items-center justify-between mb-3 p-2.5 rounded-lg border border-orange-100 dark:border-orange-800 bg-orange-50/30 dark:bg-orange-900/5">
                            <div className="flex items-center gap-2">
                              <Users className="w-4 h-4 text-orange-500" />
                              <span className="text-xs font-bold text-gray-900 dark:text-white">Mutual Aid</span>
                              {zone.needs_mutual_aid && <span className="text-[9px] px-1.5 py-0.5 bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-300 font-bold rounded">ACTIVE</span>}
                            </div>
                            <button
                              onClick={() => handleToggleMutualAid(zone)}
                              disabled={togglingMutualAid === zone.id}
                              className={`flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold rounded-lg transition-colors ${zone.needs_mutual_aid ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 hover:bg-orange-200' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'}`}
                            >
                              {togglingMutualAid === zone.id ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Users className="w-3 h-3" />}
                              {zone.needs_mutual_aid ? 'Clear' : 'Request'}
                            </button>
                          </div>

                          {/* Incident Commander */}
                          {zone.incident_commander && (
                            <div className="mb-3 flex items-center gap-2 p-2 rounded-lg border border-indigo-100 dark:border-indigo-800 bg-indigo-50/30 dark:bg-indigo-900/5">
                              <Shield className="w-3.5 h-3.5 text-indigo-500 flex-shrink-0" />
                              <span className="text-[10px] font-bold text-gray-900 dark:text-white">IC:</span>
                              <span className="text-[10px] text-indigo-700 dark:text-indigo-300 font-semibold">{zone.incident_commander}</span>
                            </div>
                          )}

                          {/* ICS Operations Log */}
                          <div>
                            <p className="text-[10px] font-bold text-gray-400 dark:text-gray-300 uppercase tracking-wider mb-2 flex items-center gap-1">
                              <Radio className="w-3 h-3" /> ICS Ops Log
                            </p>
                            <div className="space-y-1 mb-2 max-h-28 overflow-y-auto">
                              {(zone.ops_log || []).length === 0 && <p className="text-[10px] text-gray-400 dark:text-gray-300">No entries.</p>}
                              {(zone.ops_log || []).map((entry: any, li: number) => (
                                <div key={li} className="flex gap-2 text-[10px] p-1.5 rounded bg-gray-50 dark:bg-gray-800/40">
                                  <span className="font-mono text-gray-400 whitespace-nowrap">{new Date(entry.ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
                                  <span className="font-semibold text-gray-600 dark:text-gray-300 min-w-[50px] truncate">{entry.operator}</span>
                                  <span className="text-gray-700 dark:text-gray-200 line-clamp-1">{entry.note}</span>
                                </div>
                              ))}
                            </div>
                            <div className="flex gap-1.5">
                              <input
                                type="text"
                                placeholder="Log entry..."
                                value={opsNoteByZone[zone.id] || ''}
                                onChange={e => setOpsNoteByZone(prev => ({ ...prev, [zone.id]: e.target.value }))}
                                onKeyDown={e => e.key === 'Enter' && handleAddOpsLog(zone.id)}
                                className="flex-1 px-2 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg dark:text-white placeholder:text-gray-400"
                              />
                              <button
                                onClick={() => handleAddOpsLog(zone.id)}
                                disabled={savingOpsNote === zone.id}
                                className="px-2.5 py-1.5 text-[10px] font-bold rounded-lg bg-gray-900 dark:bg-white text-white dark:text-gray-900 hover:bg-gray-700 dark:hover:bg-gray-200 transition-colors"
                              >
                                {savingOpsNote === zone.id ? <RefreshCw className="w-3 h-3 animate-spin" /> : 'Log'}
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="text-center py-12">
                <Layers className="w-8 h-8 text-gray-300 dark:text-gray-400 mx-auto mb-2" />
                <p className="text-sm text-gray-400 dark:text-gray-300">{deployments.length === 0 ? 'No deployment zones yet -- create one to get started.' : t('resource.noZonesMatch', lang)}</p>
                {deployments.length === 0 && (
                  <button onClick={() => { const init = getSmartResourceSuggestion('general', 'Medium'); setCreateForm({ zone: '', priority: 'Medium', active_reports: '0', estimated_affected: '', ai_recommendation: init.reasoning, commander_notes: '', ambulances: String(init.ambulances), fire_engines: String(init.fire_engines), rescue_boats: String(init.rescue_boats), lat: '', lng: '', report_id: '', hazard_type: 'general', incident_commander: '', radio_channel: '', weather_conditions: 'clear', evacuation_status: 'none', access_routes: '' }); setCreateStep(0); setShowCreateModal(true) }} className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-400 hover:bg-violet-100 dark:hover:bg-violet-900/30 ring-1 ring-violet-500/20 transition-colors"><Plus className="w-3.5 h-3.5" /> Create First Zone</button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* RECENT ACTIVITY */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2"><Clock className="w-4 h-4 text-purple-500" /> {t('resource.recentActivity', lang)}</h3>
          <span className="text-[11px] text-gray-400 dark:text-gray-300">{deployEvents.length} {t(deployEvents.length === 1 ? 'common.event' : 'common.events', lang)}</span>
        </div>
        <div className="p-5">
          {deployEvents.length > 0 ? (
            <div className="space-y-0 border-l-2 border-gray-100 dark:border-gray-800 ml-2 pl-5">
              {deployEvents.map((log, i) => {
                const isDeploy = log.action_type === 'deploy'
                const ms = Date.now() - new Date(log.created_at).getTime()
                const mins = Math.floor(ms / 60000)
                const ago = formatRelativeTime(mins, lang)
                return (
                  <div key={log.id || i} className="relative pb-4 last:pb-0 group">
                    <div className={`absolute -left-[25px] top-1 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-gray-900 ${isDeploy ? 'bg-emerald-500' : 'bg-amber-500'} group-hover:scale-125 transition-transform`} />
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${isDeploy ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400' : 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400'}`}>{t(isDeploy ? 'resource.deploy' : 'resource.recall', lang)}</span>
                          <span className="text-xs font-medium text-gray-900 dark:text-white">{log.action}</span>
                        </div>
                        <div className="text-[10px] text-gray-400 dark:text-gray-300 flex items-center gap-1.5 flex-wrap">
                          <span>{log.operator_name || t('common.system', lang)}</span>
                          <span aria-hidden="true" className="w-1 h-1 rounded-full bg-gray-300 dark:bg-gray-600" />
                          <span>{new Date(log.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                      </div>
                      <span className="text-[10px] text-gray-400 dark:text-gray-300 font-mono tabular-nums whitespace-nowrap">{ago}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="text-center py-8">
              <Activity className="w-6 h-6 text-gray-300 dark:text-gray-400 mx-auto mb-1.5" />
              <p className="text-xs text-gray-400 dark:text-gray-300">{t('resource.noActivity', lang)}</p>
            </div>
          )}
        </div>
      </div>
    </div>

    {/* CREATE ZONE MODAL -- multi-step with AI resource engine */}
    {showCreateModal && (
      <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in" onClick={() => { setShowCreateModal(false); setCreateStep(0); setFormErrors({}) }}>
        <div className="w-full max-w-2xl bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-800 overflow-hidden" onClick={e => e.stopPropagation()}>
          {/* Header with gradient threat bar */}
          <div className={`relative overflow-hidden`}>
            <div className={`absolute inset-0 bg-gradient-to-r ${hazardInfo.gradient} opacity-60`} />
            <div className="relative px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/80 dark:bg-gray-800/80 backdrop-blur flex items-center justify-center shadow-sm">
                  <hazardInfo.icon className={`w-5 h-5 ${hazardInfo.color}`} />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-gray-900 dark:text-white tracking-tight flex items-center gap-2">
                    Create Deployment Zone
                    <span className={`text-[9px] px-2 py-0.5 rounded-md font-extrabold ring-1 ${threatInfo.bgColor} ${threatInfo.color} ${threatInfo.ringColor}`}>
                      THREAT: {threatInfo.label}
                    </span>
                  </h3>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{hazardInfo.label} incident - AI-assisted resource staging</p>
                </div>
              </div>
              <button onClick={() => { setShowCreateModal(false); setCreateStep(0); setFormErrors({}) }} className="p-2 rounded-xl text-gray-400 hover:bg-white/60 dark:hover:bg-gray-800/60 hover:text-gray-600 dark:hover:text-gray-300 transition-all"><X className="w-4 h-4" /></button>
            </div>
            {/* Step indicator */}
            <div className="relative px-6 pb-3 flex items-center gap-2">
              {['Zone Identity', 'Resource Staging', 'Review & Deploy'].map((label, si) => (
                <button key={si} onClick={() => si <= createStep && setCreateStep(si)} className={`flex items-center gap-1.5 text-[10px] font-bold px-3 py-1.5 rounded-lg transition-all ${createStep === si ? 'bg-white/90 dark:bg-gray-800/90 text-gray-900 dark:text-white shadow-sm' : createStep > si ? 'bg-white/40 dark:bg-gray-800/40 text-emerald-700 dark:text-emerald-400' : 'text-gray-400 dark:text-gray-400'}`}>
                  <span className={`w-4 h-4 rounded-full text-[9px] flex items-center justify-center font-extrabold ${createStep > si ? 'bg-emerald-500 text-white' : createStep === si ? 'bg-violet-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-500'}`}>
                    {createStep > si ? <CheckCircle className="w-3 h-3" /> : si + 1}
                  </span>
                  <span className="hidden sm:inline">{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Step 0: Zone Identity & Operational Details */}
          {createStep === 0 && (
            <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5">Zone Name <span className="text-red-500">*</span></label>
                <input type="text" maxLength={120} value={createForm.zone} onChange={e => { setCreateForm(f => ({ ...f, zone: e.target.value })); setFormErrors(p => { const n = { ...p }; delete n.zone; return n }) }} placeholder="e.g. Aberdeen City Centre -- North Sector" className={`w-full px-4 py-2.5 text-sm bg-white dark:bg-gray-800 border rounded-xl focus:ring-2 focus:ring-violet-500/40 focus:border-violet-500 transition-all placeholder:text-gray-400 dark:text-white font-medium ${formErrors.zone ? 'border-red-400 dark:border-red-600 ring-1 ring-red-400/30' : 'border-gray-200 dark:border-gray-700'}`} autoFocus />
                {formErrors.zone && <p className="mt-1 text-[10px] text-red-500 font-semibold flex items-center gap-1"><AlertCircle className="w-3 h-3" />{formErrors.zone}</p>}
                <p className="mt-1 text-[10px] text-gray-400 text-right tabular-nums">{createForm.zone.length}/120</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Priority Level */}
                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5 flex items-center gap-1"><AlertCircle className="w-3 h-3 text-red-500" /> Priority Level</label>
                  <div className="relative">
                    <select
                      value={createForm.priority}
                      onChange={e => setCreateForm(f => ({ ...f, priority: e.target.value }))}
                      className={`w-full px-4 py-2.5 text-sm font-bold bg-white dark:bg-gray-800 border rounded-xl appearance-none cursor-pointer transition-all focus:ring-2 focus:ring-violet-500/40 focus:border-violet-500 dark:text-white ${P_PILL[createForm.priority]?.split(' ').filter(c => c.startsWith('text-')).join(' ') || ''} ${createForm.priority === 'Critical' ? 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950/20' : createForm.priority === 'High' ? 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/20' : createForm.priority === 'Medium' ? 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/20' : 'border-gray-200 dark:border-gray-700'}`}
                    >
                      {['Critical', 'High', 'Medium', 'Low'].map(p => (
                        <option key={p} value={p}>{p === 'Critical' ? 'Critical -- Immediate life threat' : p === 'High' ? 'High -- Significant danger' : p === 'Medium' ? 'Medium -- Moderate risk' : 'Low -- Monitoring'}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                  </div>
                </div>
                {/* Hazard Classification */}
                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5 flex items-center gap-1">
                    <Siren className="w-3 h-3 text-amber-500" /> Hazard Classification
                  </label>
                  <div className="relative">
                    <select
                      value={createForm.hazard_type}
                      onChange={e => setCreateForm(f => ({ ...f, hazard_type: e.target.value }))}
                      className={`w-full px-4 py-2.5 text-sm bg-white dark:bg-gray-800 border rounded-xl appearance-none cursor-pointer transition-all focus:ring-2 focus:ring-violet-500/40 focus:border-violet-500 dark:text-white font-medium ${createForm.hazard_type !== 'general' ? `border-current/20 bg-gradient-to-r ${HAZARD_CATEGORIES[createForm.hazard_type]?.gradient || ''} ${HAZARD_CATEGORIES[createForm.hazard_type]?.color || ''}` : 'border-gray-200 dark:border-gray-700'}`}
                    >
                      {HAZARD_GROUPS.map(({ group, keys }) => (
                        <optgroup key={group} label={group}>
                          {keys.map(k => {
                            const h = HAZARD_CATEGORIES[k]
                            return <option key={k} value={k}>{h?.label || k}</option>
                          })}
                        </optgroup>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                  </div>
                </div>
              </div>
              {/* Combined Priority + Hazard info card */}
              <div className={`flex items-center gap-3 p-3 rounded-xl ring-1 transition-all ${createForm.priority === 'Critical' ? 'bg-red-50 dark:bg-red-950/15 ring-red-200 dark:ring-red-800' : createForm.priority === 'High' ? 'bg-amber-50 dark:bg-amber-950/15 ring-amber-200 dark:ring-amber-800' : createForm.priority === 'Medium' ? 'bg-blue-50 dark:bg-blue-950/15 ring-blue-200 dark:ring-blue-800' : 'bg-gray-50 dark:bg-gray-800/30 ring-gray-200 dark:ring-gray-700'}`}>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={`w-3 h-3 rounded-full ${P_DOT[createForm.priority]}`} />
                  {(() => { const HIcon = HAZARD_CATEGORIES[createForm.hazard_type]?.icon || FileText; return <HIcon className={`w-4 h-4 ${HAZARD_CATEGORIES[createForm.hazard_type]?.color || 'text-gray-500'}`} /> })()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-bold text-gray-700 dark:text-gray-200">
                    {createForm.priority} -- {HAZARD_CATEGORIES[createForm.hazard_type]?.label || 'General'}
                    <span className="mx-1.5 text-gray-300 dark:text-gray-400">|</span>
                    <span className={`font-extrabold ${threatInfo.color}`}>Threat: {threatInfo.label}</span>
                  </p>
                  <p className="text-[10px] text-gray-500 dark:text-gray-400 leading-snug mt-0.5">
                    {createForm.priority === 'Critical' && 'Multi-channel alert -- All command staff notified immediately. Resources auto-deployed.'}
                    {createForm.priority === 'High' && 'Priority dispatch -- Senior operators alerted. Expedited resource staging.'}
                    {createForm.priority === 'Medium' && 'Standard response -- Normal dispatch queue. Resources allocated per availability.'}
                    {createForm.priority === 'Low' && 'Monitoring only -- Logged for situational awareness. No immediate dispatch.'}
                  </p>
                </div>
              </div>

              {/* Incident Commander & Radio Channel */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5 flex items-center gap-1"><Shield className="w-3 h-3 text-indigo-500" /> Incident Commander <span className="text-gray-400 font-normal">(optional)</span></label>
                  <input type="text" maxLength={80} value={createForm.incident_commander} onChange={e => { setCreateForm(f => ({ ...f, incident_commander: e.target.value })); setFormErrors(p => { const n = { ...p }; delete n.incident_commander; return n }) }} placeholder="e.g. Commander J. MacLeod" className={`w-full px-4 py-2.5 text-sm bg-white dark:bg-gray-800 border rounded-xl focus:ring-2 focus:ring-violet-500/40 focus:border-violet-500 transition-all placeholder:text-gray-400 dark:text-white ${formErrors.incident_commander ? 'border-red-400 dark:border-red-600' : 'border-gray-200 dark:border-gray-700'}`} />
                  {formErrors.incident_commander && <p className="mt-1 text-[10px] text-red-500 font-semibold flex items-center gap-1"><AlertCircle className="w-3 h-3" />{formErrors.incident_commander}</p>}
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5 flex items-center gap-1"><Radio className="w-3 h-3 text-emerald-500" /> Radio Channel <span className="text-gray-400 font-normal">(optional)</span></label>
                  <input type="text" maxLength={30} value={createForm.radio_channel} onChange={e => { setCreateForm(f => ({ ...f, radio_channel: e.target.value })); setFormErrors(p => { const n = { ...p }; delete n.radio_channel; return n }) }} placeholder="e.g. TAC-3 / 155.250 MHz" className={`w-full px-4 py-2.5 text-sm bg-white dark:bg-gray-800 border rounded-xl focus:ring-2 focus:ring-violet-500/40 focus:border-violet-500 transition-all placeholder:text-gray-400 dark:text-white font-mono ${formErrors.radio_channel ? 'border-red-400 dark:border-red-600' : 'border-gray-200 dark:border-gray-700'}`} />
                  {formErrors.radio_channel && <p className="mt-1 text-[10px] text-red-500 font-semibold flex items-center gap-1"><AlertCircle className="w-3 h-3" />{formErrors.radio_channel}</p>}
                </div>
              </div>

              {/* Weather & Evacuation Status */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5 flex items-center gap-1"><Wind className="w-3 h-3 text-sky-500" /> Weather Conditions</label>
                  <div className="relative">
                    <select value={createForm.weather_conditions} onChange={e => setCreateForm(f => ({ ...f, weather_conditions: e.target.value }))} className="w-full px-4 py-2.5 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl appearance-none cursor-pointer focus:ring-2 focus:ring-violet-500/40 focus:border-violet-500 transition-all dark:text-white font-medium">
                      <option value="clear">Clear / Fair</option>
                      <option value="cloudy">Overcast / Cloudy</option>
                      <option value="rain">Rain</option>
                      <option value="heavy_rain">Heavy Rain / Downpour</option>
                      <option value="storm">Thunderstorm</option>
                      <option value="fog">Fog / Low Visibility</option>
                      <option value="snow">Snow</option>
                      <option value="ice">Ice / Freezing</option>
                      <option value="extreme_heat">Extreme Heat</option>
                      <option value="high_wind">High Wind / Gale</option>
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5 flex items-center gap-1"><Navigation className="w-3 h-3 text-rose-500" /> Evacuation Status</label>
                  <div className="relative">
                    <select value={createForm.evacuation_status} onChange={e => setCreateForm(f => ({ ...f, evacuation_status: e.target.value }))} className={`w-full px-4 py-2.5 text-sm bg-white dark:bg-gray-800 border rounded-xl appearance-none cursor-pointer focus:ring-2 focus:ring-violet-500/40 focus:border-violet-500 transition-all dark:text-white font-medium ${createForm.evacuation_status === 'mandatory' ? 'border-red-300 dark:border-red-700 bg-red-50/50 dark:bg-red-950/10' : createForm.evacuation_status === 'voluntary' ? 'border-amber-300 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-950/10' : 'border-gray-200 dark:border-gray-700'}`}>
                      <option value="none">No Evacuation</option>
                      <option value="voluntary">Voluntary Evacuation</option>
                      <option value="mandatory">Mandatory Evacuation</option>
                      <option value="shelter_in_place">Shelter-in-Place</option>
                      <option value="completed">Evacuation Completed</option>
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5 flex items-center gap-1"><Hash className="w-3 h-3" /> Active Reports</label>
                  <input type="number" min={0} max={999} value={createForm.active_reports} onChange={e => { setCreateForm(f => ({ ...f, active_reports: e.target.value })); setFormErrors(p => { const n = { ...p }; delete n.active_reports; return n }) }} className={`w-full px-4 py-2.5 text-sm bg-white dark:bg-gray-800 border rounded-xl dark:text-white ${formErrors.active_reports ? 'border-red-400 dark:border-red-600' : 'border-gray-200 dark:border-gray-700'}`} />
                  {formErrors.active_reports && <p className="mt-1 text-[10px] text-red-500 font-semibold flex items-center gap-1"><AlertCircle className="w-3 h-3" />{formErrors.active_reports}</p>}
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5 flex items-center gap-1"><Users className="w-3 h-3" /> Estimated Affected</label>
                  <input type="text" maxLength={100} value={createForm.estimated_affected} onChange={e => { setCreateForm(f => ({ ...f, estimated_affected: e.target.value })); setFormErrors(p => { const n = { ...p }; delete n.estimated_affected; return n }) }} placeholder="e.g. 150 residents" className={`w-full px-4 py-2.5 text-sm bg-white dark:bg-gray-800 border rounded-xl placeholder:text-gray-400 dark:text-white ${formErrors.estimated_affected ? 'border-red-400 dark:border-red-600' : 'border-gray-200 dark:border-gray-700'}`} />
                  {formErrors.estimated_affected && <p className="mt-1 text-[10px] text-red-500 font-semibold flex items-center gap-1"><AlertCircle className="w-3 h-3" />{formErrors.estimated_affected}</p>}
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5 flex items-center gap-1"><Link2 className="w-3 h-3 text-sky-500" /> Link to Incident Report <span className="text-gray-400 font-normal">(optional)</span></label>
                <select value={createForm.report_id} onChange={e => setCreateForm(f => ({ ...f, report_id: e.target.value }))} className="w-full px-4 py-2.5 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl dark:text-white">
                  <option value="">-- None --</option>
                  {reports.filter((r: any) => ['unverified','verified','urgent','flagged'].includes((r.status || '').toLowerCase())).slice(0, 50).map((r: any) => (
                    <option key={r.id} value={r.id}>{r.reportNumber || `RPT-${r.id?.slice(0, 6).toUpperCase()}`} -- {r.description?.slice(0, 60) || r.status}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5 flex items-center gap-1"><MapPin className="w-3 h-3 text-teal-500" /> Coordinates <span className="text-gray-400 font-normal">(optional)</span></label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <input type="number" step="any" placeholder="Latitude  e.g. 57.149" value={createForm.lat} onChange={e => { setCreateForm(f => ({ ...f, lat: e.target.value })); setFormErrors(p => { const n = { ...p }; delete n.lat; return n }) }} className={`w-full px-4 py-2.5 text-sm bg-white dark:bg-gray-800 border rounded-xl placeholder:text-gray-400 dark:text-white ${formErrors.lat ? 'border-red-400 dark:border-red-600' : 'border-gray-200 dark:border-gray-700'}`} />
                    {formErrors.lat && <p className="mt-1 text-[10px] text-red-500 font-semibold flex items-center gap-1"><AlertCircle className="w-3 h-3" />{formErrors.lat}</p>}
                  </div>
                  <div>
                    <input type="number" step="any" placeholder="Longitude  e.g. -2.094" value={createForm.lng} onChange={e => { setCreateForm(f => ({ ...f, lng: e.target.value })); setFormErrors(p => { const n = { ...p }; delete n.lng; return n }) }} className={`w-full px-4 py-2.5 text-sm bg-white dark:bg-gray-800 border rounded-xl placeholder:text-gray-400 dark:text-white ${formErrors.lng ? 'border-red-400 dark:border-red-600' : 'border-gray-200 dark:border-gray-700'}`} />
                    {formErrors.lng && <p className="mt-1 text-[10px] text-red-500 font-semibold flex items-center gap-1"><AlertCircle className="w-3 h-3" />{formErrors.lng}</p>}
                  </div>
                </div>
              </div>
              {/* Access Routes / Ingress Notes */}
              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5 flex items-center gap-1"><Crosshair className="w-3 h-3 text-orange-500" /> Access Routes / Ingress Notes <span className="text-gray-400 font-normal">(optional)</span></label>
                <textarea rows={2} maxLength={300} value={createForm.access_routes} onChange={e => { setCreateForm(f => ({ ...f, access_routes: e.target.value })); setFormErrors(p => { const n = { ...p }; delete n.access_routes; return n }) }} placeholder="Primary route: A90 northbound exit 3. Alternate: B999 via Dyce. Road closures: King St between Union Bridge and Castle St." className={`w-full px-4 py-2.5 text-sm bg-white dark:bg-gray-800 border rounded-xl resize-none placeholder:text-gray-400 dark:text-white leading-relaxed ${formErrors.access_routes ? 'border-red-400 dark:border-red-600' : 'border-gray-200 dark:border-gray-700'}`} />
                {formErrors.access_routes && <p className="mt-1 text-[10px] text-red-500 font-semibold flex items-center gap-1"><AlertCircle className="w-3 h-3" />{formErrors.access_routes}</p>}
                <p className="mt-1 text-[10px] text-gray-400 text-right tabular-nums">{createForm.access_routes.length}/300</p>
              </div>
            </div>
          )}

          {/* Step 1: Resource Staging with AI Engine */}
          {createStep === 1 && (
            <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
              {/* AI Recommendation Card */}
              <div className={`rounded-xl border p-4 bg-gradient-to-br ${hazardInfo.gradient} border-violet-200 dark:border-violet-800`}>
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center">
                      <Sparkles className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                    </div>
                    <div>
                      <p className="text-xs font-extrabold text-violet-900 dark:text-violet-200">AI Resource Engine</p>
                      <p className="text-[10px] text-violet-600 dark:text-violet-400">Auto-calculated for {hazardInfo.label} × {createForm.priority} priority</p>
                    </div>
                  </div>
                  <span className="flex items-center gap-1 px-2.5 py-1 text-[9px] font-extrabold rounded-md bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/20">
                    <Zap className="w-3 h-3" /> AUTO-APPLIED
                  </span>
                </div>
                <div className="bg-white/40 dark:bg-gray-800/20 rounded-lg p-3 mb-3 border border-violet-100 dark:border-violet-900/30">
                  <p className="text-[10px] font-bold text-violet-600 dark:text-violet-400 uppercase tracking-wider mb-1">AI Assessment</p>
                  <p className="text-[12px] text-violet-900 dark:text-violet-100 leading-relaxed flex items-start gap-2">
                    <Brain className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 opacity-70" />
                    {smartSuggestion.reasoning}
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div className="bg-white/60 dark:bg-gray-800/40 rounded-lg p-2.5 text-center backdrop-blur-sm">
                    <Truck className="w-4 h-4 text-red-500 mx-auto mb-1" />
                    <p className="text-lg font-extrabold text-gray-900 dark:text-white tabular-nums">{smartSuggestion.ambulances}</p>
                    <p className="text-[9px] text-gray-500 uppercase font-bold">Ambulances</p>
                  </div>
                  <div className="bg-white/60 dark:bg-gray-800/40 rounded-lg p-2.5 text-center backdrop-blur-sm">
                    <Flame className="w-4 h-4 text-orange-500 mx-auto mb-1" />
                    <p className="text-lg font-extrabold text-gray-900 dark:text-white tabular-nums">{smartSuggestion.fire_engines}</p>
                    <p className="text-[9px] text-gray-500 uppercase font-bold">Fire Engines</p>
                  </div>
                  <div className="bg-white/60 dark:bg-gray-800/40 rounded-lg p-2.5 text-center backdrop-blur-sm">
                    <Anchor className="w-4 h-4 text-blue-500 mx-auto mb-1" />
                    <p className="text-lg font-extrabold text-gray-900 dark:text-white tabular-nums">{smartSuggestion.rescue_boats}</p>
                    <p className="text-[9px] text-gray-500 uppercase font-bold">Rescue Boats</p>
                  </div>
                </div>
              </div>

              {/* Manual Override */}
              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-1.5">
                  <BarChart3 className="w-3 h-3 text-emerald-500" /> Resource Override
                  <span className="text-[9px] text-gray-400 font-normal ml-auto">Adjust counts if AI values need correction (max 99 each)</span>
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="bg-gray-50 dark:bg-gray-800/30 rounded-xl p-3 border border-gray-100 dark:border-gray-800">
                    <label className="flex items-center gap-1.5 text-[10px] text-gray-500 dark:text-gray-400 mb-2 font-bold uppercase"><Truck className="w-3.5 h-3.5 text-red-500" /> Ambulances</label>
                    <input type="number" min={0} max={99} value={createForm.ambulances} onChange={e => { setCreateForm(f => ({ ...f, ambulances: e.target.value })); setFormErrors(p => { const n = { ...p }; delete n.ambulances; return n }) }} className={`w-full px-3 py-2 text-base font-extrabold text-center bg-white dark:bg-gray-800 border rounded-xl dark:text-white tabular-nums ${formErrors.ambulances ? 'border-red-400 dark:border-red-600' : 'border-gray-200 dark:border-gray-700'}`} />
                    {formErrors.ambulances && <p className="text-[9px] text-red-500 mt-1 text-center font-semibold">{formErrors.ambulances}</p>}
                    {!formErrors.ambulances && String(smartSuggestion.ambulances) !== createForm.ambulances && <p className="text-[9px] text-amber-600 mt-1 text-center font-semibold">AI suggested: {smartSuggestion.ambulances}</p>}
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-800/30 rounded-xl p-3 border border-gray-100 dark:border-gray-800">
                    <label className="flex items-center gap-1.5 text-[10px] text-gray-500 dark:text-gray-400 mb-2 font-bold uppercase"><Flame className="w-3.5 h-3.5 text-orange-500" /> Fire Engines</label>
                    <input type="number" min={0} max={99} value={createForm.fire_engines} onChange={e => { setCreateForm(f => ({ ...f, fire_engines: e.target.value })); setFormErrors(p => { const n = { ...p }; delete n.fire_engines; return n }) }} className={`w-full px-3 py-2 text-base font-extrabold text-center bg-white dark:bg-gray-800 border rounded-xl dark:text-white tabular-nums ${formErrors.fire_engines ? 'border-red-400 dark:border-red-600' : 'border-gray-200 dark:border-gray-700'}`} />
                    {formErrors.fire_engines && <p className="text-[9px] text-red-500 mt-1 text-center font-semibold">{formErrors.fire_engines}</p>}
                    {!formErrors.fire_engines && String(smartSuggestion.fire_engines) !== createForm.fire_engines && <p className="text-[9px] text-amber-600 mt-1 text-center font-semibold">AI suggested: {smartSuggestion.fire_engines}</p>}
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-800/30 rounded-xl p-3 border border-gray-100 dark:border-gray-800">
                    <label className="flex items-center gap-1.5 text-[10px] text-gray-500 dark:text-gray-400 mb-2 font-bold uppercase"><Anchor className="w-3.5 h-3.5 text-blue-500" /> Rescue Boats</label>
                    <input type="number" min={0} max={99} value={createForm.rescue_boats} onChange={e => { setCreateForm(f => ({ ...f, rescue_boats: e.target.value })); setFormErrors(p => { const n = { ...p }; delete n.rescue_boats; return n }) }} className={`w-full px-3 py-2 text-base font-extrabold text-center bg-white dark:bg-gray-800 border rounded-xl dark:text-white tabular-nums ${formErrors.rescue_boats ? 'border-red-400 dark:border-red-600' : 'border-gray-200 dark:border-gray-700'}`} />
                    {formErrors.rescue_boats && <p className="text-[9px] text-red-500 mt-1 text-center font-semibold">{formErrors.rescue_boats}</p>}
                    {!formErrors.rescue_boats && String(smartSuggestion.rescue_boats) !== createForm.rescue_boats && <p className="text-[9px] text-amber-600 mt-1 text-center font-semibold">AI suggested: {smartSuggestion.rescue_boats}</p>}
                  </div>
                </div>
                <button onClick={applySmartSuggestion} className="mt-2 w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-[10px] font-bold rounded-lg bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/30 ring-1 ring-violet-500/20 transition-colors">
                  <RefreshCw className="w-3 h-3" /> Reset to AI Recommendation
                </button>
              </div>

              {/* Additional Commander Notes (optional) */}
              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5 flex items-center gap-1"><Edit3 className="w-3 h-3 text-gray-400" /> Commander Notes <span className="text-gray-400 font-normal">(optional -- terrain, access routes, hazard specifics)</span></label>
                <textarea rows={2} maxLength={500} value={createForm.commander_notes} onChange={e => { setCreateForm(f => ({ ...f, commander_notes: e.target.value })); setFormErrors(p => { const n = { ...p }; delete n.commander_notes; return n }) }} placeholder="Add operational notes visible to all responders..." className={`w-full px-4 py-2.5 text-sm bg-white dark:bg-gray-800 border rounded-xl resize-none placeholder:text-gray-400 dark:text-white leading-relaxed ${formErrors.commander_notes ? 'border-red-400 dark:border-red-600' : 'border-gray-200 dark:border-gray-700'}`} />
                {formErrors.commander_notes && <p className="mt-1 text-[10px] text-red-500 font-semibold flex items-center gap-1"><AlertCircle className="w-3 h-3" />{formErrors.commander_notes}</p>}
                <p className="mt-1 text-[10px] text-gray-400 text-right tabular-nums">{createForm.commander_notes.length}/500</p>
              </div>
            </div>
          )}

          {/* Step 2: Review & Confirm */}
          {createStep === 2 && (
            <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
              {/* Summary Card */}
              <div className={`rounded-xl border overflow-hidden ${createForm.priority === 'Critical' ? 'border-red-300 dark:border-red-800' : 'border-gray-200 dark:border-gray-800'}`}>
                <div className={`px-4 py-3 bg-gradient-to-r ${hazardInfo.gradient} flex items-center justify-between`}>
                  <div className="flex items-center gap-2">
                    <hazardInfo.icon className={`w-5 h-5 ${hazardInfo.color}`} />
                    <div>
                      <p className="text-sm font-extrabold text-gray-900 dark:text-white">{createForm.zone || 'Unnamed Zone'}</p>
                      <p className="text-[10px] text-gray-600 dark:text-gray-400">{hazardInfo.label} incident</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-lg font-extrabold ring-1 ${P_PILL[createForm.priority]}`}>
                      <span className={`w-2 h-2 rounded-full ${P_DOT[createForm.priority]}`} /> {createForm.priority}
                    </span>
                    <span className={`text-[9px] px-2 py-1 rounded-lg font-extrabold ring-1 ${threatInfo.bgColor} ${threatInfo.color} ${threatInfo.ringColor}`}>
                      {threatInfo.label}
                    </span>
                  </div>
                </div>
                <div className="p-4 bg-white dark:bg-gray-900">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                    <div className="text-center p-2 rounded-lg bg-gray-50 dark:bg-gray-800/40">
                      <p className="text-lg font-extrabold text-gray-900 dark:text-white tabular-nums">{createForm.active_reports || 0}</p>
                      <p className="text-[9px] text-gray-500 uppercase font-bold">Reports</p>
                    </div>
                    <div className="text-center p-2 rounded-lg bg-gray-50 dark:bg-gray-800/40">
                      <p className="text-lg font-extrabold text-rose-600 dark:text-rose-400 tabular-nums">{createForm.estimated_affected || '--'}</p>
                      <p className="text-[9px] text-gray-500 uppercase font-bold">Affected</p>
                    </div>
                    <div className="text-center p-2 rounded-lg bg-gray-50 dark:bg-gray-800/40">
                      <p className="text-lg font-extrabold text-gray-900 dark:text-white tabular-nums">{(parseInt(createForm.ambulances) || 0) + (parseInt(createForm.fire_engines) || 0) + (parseInt(createForm.rescue_boats) || 0)}</p>
                      <p className="text-[9px] text-gray-500 uppercase font-bold">Total Assets</p>
                    </div>
                    <div className="text-center p-2 rounded-lg bg-gray-50 dark:bg-gray-800/40">
                      <p className="text-lg font-extrabold text-gray-900 dark:text-white tabular-nums">{createForm.lat && createForm.lng ? <MapPin className="w-5 h-5 text-teal-500 mx-auto" /> : '--'}</p>
                      <p className="text-[9px] text-gray-500 uppercase font-bold">Geo-Pin</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 mb-3">
                    {parseInt(createForm.ambulances) > 0 && <span className="flex items-center gap-1 text-xs font-bold text-gray-700 dark:text-gray-300"><Truck className="w-4 h-4 text-red-500" />{createForm.ambulances} Ambulances</span>}
                    {parseInt(createForm.fire_engines) > 0 && <span className="flex items-center gap-1 text-xs font-bold text-gray-700 dark:text-gray-300"><Flame className="w-4 h-4 text-orange-500" />{createForm.fire_engines} Fire Engines</span>}
                    {parseInt(createForm.rescue_boats) > 0 && <span className="flex items-center gap-1 text-xs font-bold text-gray-700 dark:text-gray-300"><Anchor className="w-4 h-4 text-blue-500" />{createForm.rescue_boats} Boats</span>}
                    {!parseInt(createForm.ambulances) && !parseInt(createForm.fire_engines) && !parseInt(createForm.rescue_boats) && <span className="text-xs text-gray-400">No resources staged</span>}
                  </div>
                  {createForm.ai_recommendation && (
                    <div className="bg-blue-50 dark:bg-blue-900/10 rounded-lg p-3 border border-blue-100 dark:border-blue-900/30">
                      <p className="text-[11px] text-blue-700 dark:text-blue-300 flex items-start gap-2 leading-relaxed">
                        <Brain className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 opacity-60" />
                        {createForm.ai_recommendation}
                      </p>
                      {createForm.commander_notes.trim() && (
                        <p className="mt-1.5 text-[11px] text-indigo-700 dark:text-indigo-300 flex items-start gap-2 leading-relaxed border-t border-blue-100 dark:border-blue-900/30 pt-1.5">
                          <Edit3 className="w-3 h-3 flex-shrink-0 mt-0.5 opacity-60" />
                          <span><span className="font-bold">Notes:</span> {createForm.commander_notes.trim()}</span>
                        </p>
                      )}
                    </div>
                  )}
                  {createForm.report_id && (
                    <div className="mt-2 flex items-center gap-1.5 text-[10px] text-sky-600 dark:text-sky-400 font-medium">
                      <Link2 className="w-3 h-3" /> {t('resource.linkedReport', lang)}: {reports.find((r: any) => r.id === createForm.report_id)?.reportNumber || `RPT-${createForm.report_id?.slice(0, 6).toUpperCase()}`}
                    </div>
                  )}
                  {/* Operational Details Summary */}
                  {(createForm.incident_commander || createForm.radio_channel || createForm.evacuation_status !== 'none' || createForm.weather_conditions !== 'clear' || createForm.access_routes) && (
                    <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800 space-y-1.5">
                      <p className="text-[9px] font-extrabold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Operational Details</p>
                      {createForm.incident_commander && (
                        <div className="flex items-center gap-1.5 text-[11px] text-gray-700 dark:text-gray-300">
                          <Shield className="w-3 h-3 text-indigo-500 flex-shrink-0" /> <span className="font-semibold">IC:</span> {createForm.incident_commander}
                        </div>
                      )}
                      {createForm.radio_channel && (
                        <div className="flex items-center gap-1.5 text-[11px] text-gray-700 dark:text-gray-300">
                          <Radio className="w-3 h-3 text-emerald-500 flex-shrink-0" /> <span className="font-semibold">Comms:</span> <span className="font-mono">{createForm.radio_channel}</span>
                        </div>
                      )}
                      {createForm.weather_conditions !== 'clear' && (
                        <div className="flex items-center gap-1.5 text-[11px] text-gray-700 dark:text-gray-300">
                          <Wind className="w-3 h-3 text-sky-500 flex-shrink-0" /> <span className="font-semibold">Weather:</span> {createForm.weather_conditions.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                        </div>
                      )}
                      {createForm.evacuation_status !== 'none' && (
                        <div className={`flex items-center gap-1.5 text-[11px] font-semibold ${createForm.evacuation_status === 'mandatory' ? 'text-red-600 dark:text-red-400' : createForm.evacuation_status === 'voluntary' ? 'text-amber-600 dark:text-amber-400' : 'text-gray-700 dark:text-gray-300'}`}>
                          <Navigation className="w-3 h-3 flex-shrink-0" /> Evacuation: {createForm.evacuation_status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                        </div>
                      )}
                      {createForm.access_routes && (
                        <div className="flex items-start gap-1.5 text-[11px] text-gray-700 dark:text-gray-300">
                          <Crosshair className="w-3 h-3 text-orange-500 flex-shrink-0 mt-0.5" /> <span className="font-semibold">Access:</span> <span className="leading-snug">{createForm.access_routes}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Critical Warning */}
              {createForm.priority === 'Critical' && (
                <div className="flex items-start gap-3 p-3 rounded-xl bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800">
                  <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                  <div className="text-[11px] text-red-700 dark:text-red-300 leading-relaxed">
                    <span className="font-bold">CRITICAL PRIORITY</span> -- Creating this zone will trigger immediate multi-channel notifications to all active command staff and operators.
                  </div>
                </div>
              )}

              {/* Operational Readiness Assessment */}
              {(() => {
                const checks = [
                  { label: 'Zone named', ok: !!createForm.zone.trim() },
                  { label: 'Hazard classified', ok: createForm.hazard_type !== 'general' },
                  { label: 'Resources staged', ok: (parseInt(createForm.ambulances) || 0) + (parseInt(createForm.fire_engines) || 0) + (parseInt(createForm.rescue_boats) || 0) > 0 },
                  { label: 'Geo-located', ok: !!(createForm.lat && createForm.lng) },
                  { label: 'Report linked', ok: !!createForm.report_id },
                  { label: 'Affected estimated', ok: !!createForm.estimated_affected },
                  { label: 'IC assigned', ok: !!createForm.incident_commander },
                  { label: 'Comms channel', ok: !!createForm.radio_channel },
                  { label: 'Access routes', ok: !!createForm.access_routes },
                ]
                const passed = checks.filter(c => c.ok).length
                const pct = Math.round((passed / checks.length) * 100)
                const color = pct >= 80 ? 'emerald' : pct >= 50 ? 'amber' : 'red'
                return (
                  <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-4 bg-gray-50/50 dark:bg-gray-800/20">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[11px] font-extrabold text-gray-700 dark:text-gray-300 uppercase tracking-wider flex items-center gap-1.5">
                        <Shield className="w-3.5 h-3.5" /> Deployment Readiness
                      </p>
                      <span className={`text-sm font-extrabold tabular-nums text-${color}-600 dark:text-${color}-400`}>{pct}%</span>
                    </div>
                    <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden mb-3">
                      <div className={`h-full rounded-full transition-all duration-500 bg-${color}-500`} style={{ width: `${pct}%` }} />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                      {checks.map(c => (
                        <div key={c.label} className={`flex items-center gap-1.5 text-[10px] px-2 py-1 rounded-lg ${c.ok ? 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/20' : 'text-gray-400 dark:text-gray-400 bg-gray-100 dark:bg-gray-800/40'}`}>
                          {c.ok ? <CheckCircle className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                          <span className="font-medium">{c.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })()}
            </div>
          )}

          {/* Footer */}
          <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/20 flex items-center justify-between">
            <div>
              {createStep > 0 && (
                <button onClick={() => setCreateStep(s => s - 1)} className="px-4 py-2 text-xs font-semibold rounded-xl text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
 {'<-'} Back
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => { setShowCreateModal(false); setCreateStep(0); setFormErrors({}) }} className="px-4 py-2.5 text-xs font-semibold rounded-xl text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">Cancel</button>
              {createStep < 2 ? (
                <button
                  disabled={createStep === 0 && !createForm.zone.trim()}
                  onClick={() => {
                    if (createStep === 0) {
                      const stepErrors: Record<string, string> = {}
                      const z = createForm.zone.trim()
                      if (!z) stepErrors.zone = 'Zone name is required'
                      else if (z.length < 3) stepErrors.zone = 'Zone name must be at least 3 characters'
                      else if (/[<>{}\\]/.test(z)) stepErrors.zone = 'Zone name contains invalid characters'
                      if (createForm.lat) { const v = parseFloat(createForm.lat); if (isNaN(v) || v < -90 || v > 90) stepErrors.lat = 'Latitude must be between -90 and 90' }
                      if (createForm.lng) { const v = parseFloat(createForm.lng); if (isNaN(v) || v < -180 || v > 180) stepErrors.lng = 'Longitude must be between -180 and 180' }
                      if ((createForm.lat && !createForm.lng) || (!createForm.lat && createForm.lng)) stepErrors.lat = 'Both coordinates required'
                      if (Object.keys(stepErrors).length > 0) { setFormErrors(stepErrors); return }
                      setFormErrors({})
                    }
                    setCreateStep(s => s + 1)
                  }}
                  className="px-5 py-2.5 text-xs font-bold rounded-xl bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 transition-all shadow-sm hover:shadow-md"
                >
 Next {'->'}
                </button>
              ) : (
                <button
                  disabled={creating || !createForm.zone.trim()}
                  onClick={() => { handleCreate(); setCreateStep(0) }}
                  className={`px-5 py-2.5 text-xs font-extrabold rounded-xl text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 transition-all shadow-sm hover:shadow-md ${createForm.priority === 'Critical' ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}
                >
                  {creating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                  {createForm.priority === 'Critical' ? 'Deploy Critical Zone' : 'Create Zone'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    )}
    </>
  )
}

