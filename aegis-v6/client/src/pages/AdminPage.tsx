/**
 * The main operator and admin dashboard. Displays live incident reports, alert
 * management, analytics, the interactive map, messaging, and user management.
 * Operators log in here (or via the embedded LoginPage) and manage everything
 * from a single tabbed interface.
 *
 * - Routed by client/src/App.tsx at /admin
 * - Protected: redirects unauthenticated users to the LoginPage embedded here
 * - Reads reports from client/src/contexts/ReportsContext.tsx
 * - Reads alerts from client/src/contexts/AlertsContext.tsx
 * - Real-time updates arrive via Socket.IO (shared socket from SocketContext)
 * - Makes API calls via client/src/utils/api.ts for reports, users, deployments
 * - Heavy sub-panels are lazy-loaded (CommandCenter, DistressPanel, etc.)
 *
 * Key panels (tabbed):
 * - Dashboard    -- live incident stats and quick actions
 * - Reports      -- full incident queue with AI scores and filters
 * - Map          -- live geospatial view of all incidents
 * - Alerts       -- send and manage emergency broadcasts
 * - Analytics    -- historical stats and charts
 * - Messaging    -- operator-to-citizen real-time chat
 * - Distress     -- active SOS beacon map
 * - Users        -- operator and citizen account management
 *
 * - client/src/contexts/ReportsContext.tsx   -- shared report state for all components
 * - client/src/utils/api.ts                  -- all API call functions used here
 * - client/src/components/admin/             -- sub-components for each panel
 * - server/src/routes/reportRoutes.ts        -- the backend these panels read from
 * - server/src/routes/adminAiRoutes.ts       -- AI management used in analytics panel
 * */

/* AdminPage.tsx ? Operator dashboard with reports, alerts, analytics, and messaging. */

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { usePageTitle } from '../hooks/usePageTitle'
import { lazy, Suspense } from 'react'
import { Link } from 'react-router-dom'
import {
  Shield, AlertTriangle, CheckCircle, Clock, Users, Activity, TrendingUp,
  FileText, Bell, BarChart3, Map, X, Search, LogOut, Send,
  Eye, Flag, Siren, Brain, History, Printer, Download, Filter, ChevronDown,
  Calendar, MapPin, Layers, RefreshCw, User, Settings, ThumbsUp, ThumbsDown,
  Flame, Droplets, Building2, ShieldAlert, HeartPulse, Radiation, ChevronRight,
  Camera, Truck, Anchor, Navigation, Zap, Package, Edit2, Ban, CheckCircle2, Trash2, Key, MessageSquare, Waves, Maximize2, Minimize2,
  Archive, XCircle, ChevronLeft, ZoomIn, Share2, ExternalLink, Globe, Hash, CircleDot, Home, Info
} from 'lucide-react'
import { io, Socket } from 'socket.io-client'
import { useReports } from '../contexts/ReportsContext'
import { useAlerts } from '../contexts/AlertsContext'
import { useTheme } from '../contexts/ThemeContext'
import { useLocation } from '../contexts/LocationContext'
import { LOCATIONS } from '../contexts/LocationContext'
import { getSession, logout, validateTokenOrRedirectAsync } from '../utils/auth'
import { exportReportsCSV, exportReportJSON as exportReportsJSON } from '../utils/exportData'
import { apiLogActivity, apiCreateAlert, apiGetAuditLog, apiAuditLog, apiGetPredictions, apiSendPreAlert, apiGetDeployments, apiDeployResources, apiRecallResources, apiRunPrediction, apiGetHeatmapData, apiGetUsers, apiUpdateUser, apiSuspendUser, apiActivateUser, apiResetUserPassword, apiDeleteUser, apiGetCommandCenterAnalytics, apiBulkUpdateReportStatus, apiUpdateProfile, apiUpdateReportNotes, getToken } from '../utils/api'
import ReportCard from '../components/shared/ReportCard'
import LoginPage from '../components/admin/LoginPage'
import FirstAdminSetup from '../components/admin/FirstAdminSetup'
import TwoFactorSettings from '../components/admin/TwoFactorSettings'
import SetupWizard from './SetupWizard'
import { useSetupStatus } from '../hooks/useSetupStatus'
import IncidentFilterPanel from '../components/shared/IncidentFilterPanel'

//Lazy load heavy components for bundle optimization
const DisasterMap = lazy(() => import('../components/shared/DisasterMap'))
const LiveMap = lazy(() => import('../components/shared/LiveMap'))
const Map3DView = lazy(() => import('../components/shared/Map3DView'))
const LiveOperationsMap = lazy(() => import('../components/admin/LiveOperationsMap'))
const CrowdDensityHeatmap = lazy(() => import('../components/admin/AdminCrowdDensity'))
const AnalyticsDashboard = lazy(() => import('../components/admin/AnalyticsDashboard'))
const AdminMessaging = lazy(() => import('../components/admin/AdminMessaging'))
const DeliveryDashboard = lazy(() => import('../components/admin/DeliveryDashboard'))
const CommunityChat = lazy(() => import('../components/citizen/CommunityChat'))
const CommunityChatRoom = lazy(() => import('../components/citizen/CommunityChatRoom'))
const AdminCommunityHub = lazy(() => import('../components/admin/AdminCommunityHub'))
const AdminHistoricalIntelligence = lazy(() => import('../components/admin/AdminHistoricalIntelligence'))
const AdminAuditTrail = lazy(() => import('../components/admin/AdminAuditTrail'))
const AdminAlertBroadcast = lazy(() => import('../components/admin/AdminAlertBroadcast'))
const Chatbot = lazy(() => import('../components/citizen/Chatbot'))
const IntelligenceDashboard = lazy(() => import('../components/shared/IntelligenceDashboard'))
const RiverLevelPanel = lazy(() => import('../components/shared/RiverLevelPanel'))
const FloodLayerControl = lazy(() => import('../components/shared/FloodLayerControl'))
const FloodPredictionTimeline = lazy(() => import('../components/shared/FloodPredictionTimeline'))
const DistressPanel = lazy(() => import('../components/admin/DistressPanel'))
const SecurityDashboard = lazy(() => import('../components/admin/SecurityDashboard'))
const SystemHealthPanel = lazy(() => import('../components/admin/SystemHealthPanel'))
const ClimateRiskDashboard = lazy(() => import('../components/shared/ClimateRiskDashboard'))
const IncidentCommandConsole = lazy(() => import('../components/admin/IncidentCommandConsole'))
const CommandCenter = lazy(() => import('../components/admin/CommandCenter'))
const WelcomeDashboard = lazy(() => import('../components/admin/WelcomeDashboard'))
const AllReportsManager = lazy(() => import('../components/admin/AllReportsManager'))
const AnalyticsCenter = lazy(() => import('../components/admin/AnalyticsCenter'))
const AITransparencyConsole = lazy(() => import('../components/admin/AITransparencyConsole'))
const ResourceDeploymentConsole = lazy(() => import('../components/admin/ResourceDeploymentConsole'))
const UserAccessManagement = lazy(() => import('../components/admin/UserAccessManagement'))
import type { Report, Operator } from '../types'
import ThemeSelector from '../components/ui/ThemeSelector'
import AdminLayout from '../components/layout/AdminLayout'
import IncidentQueue from '../components/admin/IncidentQueue'
import LocationDropdown from '../components/shared/LocationDropdown'
import { t } from '../utils/i18n'
import { escapeHtml } from '../utils/helpers'
import { useLanguage } from '../hooks/useLanguage'
import { useIncidents } from '../contexts/IncidentContext'
import { useToast } from '../contexts/ToastContext'
import { SkeletonTable, SkeletonChart, SkeletonCard, SkeletonList } from '../components/ui/Skeleton'
import { EmptyAdminTable } from '../components/ui/EmptyState'
import KeyboardShortcutsOverlay from '../components/admin/KeyboardShortcutsOverlay'

import { SEVERITY_BG_PILL, STATUS_BG_PILL } from '../utils/colorTokens'
const SEV_COLORS: Record<string, string> = SEVERITY_BG_PILL
const STA_COLORS: Record<string, string> = STATUS_BG_PILL
const CATEGORY_ICONS: Record<string, any> = { natural_disaster: Droplets, infrastructure: Building2, public_safety: ShieldAlert, community_safety: Users, environmental: Flame, medical: HeartPulse }

type View = 'home'|'dashboard'|'reports'|'map'|'analytics'|'ai_models'|'history'|'audit'|'alert_send'|'resources'|'predictions'|'users'|'messaging'|'community'|'system_health'|'delivery'|'crowd'|'security'|'incident_console'

export default function AdminPage(): JSX.Element {
  usePageTitle('Admin Dashboard')
  const lang = useLanguage()
  const { reports, loading, verifyReport, flagReport, markUrgent, resolveReport, archiveReport, markFalseReport, refreshReports } = useReports()
  const { alerts, notifications, pushNotification, dismissNotification, refreshAlerts } = useAlerts()
  const { location: loc, activeLocation, setActiveLocation, availableLocations } = useLocation()
  const { dark, toggle } = useTheme()
  const { toast } = useToast()
  const { filter: incidentFilter } = useIncidents()
  const selectedTypes = incidentFilter?.types ?? []
  const { loading: setupLoading, status: setupStatus, refetch: setupRefetch } = useSetupStatus()

  const [user, setUser] = useState<Operator|null>(()=>getSession())
  const [view, setView] = useState<View>('home')
  const [searchTerm, setSearchTerm] = useState('')
  const [selReport, setSelReport] = useState<Report|null>(null)
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [galleryIndex, setGalleryIndex] = useState(0)
  const [filterSeverity, setFilterSeverity] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterType, setFilterType] = useState('all')
  const [confirmModal, setConfirmModal] = useState<{title:string,message:string,type:string,action:()=>void}|null>(null)
  const [justification, setJustification] = useState('')
  const [auditLog, setAuditLog] = useState<any[]>([])
  const [showProfile, setShowProfile] = useState(false)
  const [deployReason, setDeployReason] = useState('')
  const deployReasonRef = useRef('')
  useEffect(() => { deployReasonRef.current = deployReason }, [deployReason])
  const [profileEditing, setProfileEditing] = useState(false)
  const [profileForm, setProfileForm] = useState({displayName:'',email:'',phone:'',department:''})
  const [predictions, setPredictions] = useState<any[]>([])
  const [deployments, setDeployments] = useState<any[]>([])
  const [predictionArea, setPredictionArea] = useState('City Centre')
  const [predictionRunning, setPredictionRunning] = useState(false)
  const [predictionResult, setPredictionResult] = useState<any | null>(null)
  const [heatmapData, setHeatmapData] = useState<any[]>([])
  const [users, setUsers] = useState<any[]>([])
  const [suspendForm, setSuspendForm] = useState<{until:string,reason:string}>({until:'',reason:''})
  const [communityUnread, setCommunityUnread] = useState(0)
  const [showChatbot, setShowChatbot] = useState(false)
  const [notesDraft, setNotesDraft] = useState('')
  const [notesEditing, setNotesEditing] = useState(false)
  const [notesSaving, setNotesSaving] = useState(false)
  //Listen for global logout events and clear stored user
  React.useEffect(() => {
    const handler = () => { setUser(null); setAdminTokenReady(false) }
    window.addEventListener('ae:logout', handler)
    return () => window.removeEventListener('ae:logout', handler)
  }, [])
  //Token arrives asynchronously from the silent refresh -- flip adminTokenReady so
  //the notification socket effect re-runs and can connect using the fresh JWT.
  React.useEffect(() => {
    const handler = () => setAdminTokenReady(true)
    window.addEventListener('ae:token-set', handler)
    return () => window.removeEventListener('ae:token-set', handler)
  }, [])
  //Audit section state
  const [recentSort, setRecentSort] = useState<'newest'|'oldest'|'severity'|'ai-high'|'ai-low'>('newest')
  const [commandCenter, setCommandCenter] = useState<{
    generatedAt: string
    activity: Array<{ id: string; action: string; action_type: string; operator_name: string; created_at: string }>
    leaderboard: Array<{ operator: string; actions: number; handled: number; avgResponseMinutes: number }>
    recommendations: Array<{ priority: 'critical' | 'high' | 'medium'; message: string }>
    comparative: {
      today: number
      yesterday: number
      dayDeltaPct: number
      thisWeek: number
      previousWeek: number
      weekDeltaPct: number
    }
  } | null>(null)
  const [selectedReportIds, setSelectedReportIds] = useState<Set<string>>(new Set())
  const [smartFilter, setSmartFilter] = useState('')
  const [showShortcuts, setShowShortcuts] = useState(false)
  const notifSocketRef = useRef<Socket | null>(null)
  const [socketConnected, setSocketConnected] = useState(false)
  const [activityShowAll, setActivityShowAll] = useState(false)
  const [bulkProgress, setBulkProgress] = useState<{ current: number; total: number } | null>(null)
  //Tracks when the admin JWT is ready (may lag behind user state during silent refresh)
  const [adminTokenReady, setAdminTokenReady] = useState(() => !!getToken())

  const predictionAreaOptions = useMemo(() => {
    const map = new globalThis.Map<string, { area: string; lat: number; lng: number; regionId: string }>()
    Object.entries(LOCATIONS).forEach(([regionKey, cfg]) => {
      (cfg.floodZones || []).forEach((zone: any) => {
        const area = String(zone.name || '').trim()
        const lat = Number(zone?.coords?.[0])
        const lng = Number(zone?.coords?.[1])
        if (!area || Number.isNaN(lat) || Number.isNaN(lng)) return
        if (!map.has(area)) {
          map.set(area, {
            area,
            lat,
            lng,
            regionId: regionKey === 'scotland' ? 'uk-default' : `${regionKey}-default`,
          })
        }
      })
    })
    return Array.from(map.values()).sort((a, b) => a.area.localeCompare(b.area))
  }, [])

  const loadCommandCenter = useCallback(async () => {
    if (!user) return
    try {
      const payload = await apiGetCommandCenterAnalytics() as any
      setCommandCenter(payload)
    } catch {
      setCommandCenter(null)
    }
  }, [user])

  //Validate token on mount after silent-refresh settles.
  useEffect(() => {
    let mounted = true
    ;(async () => {
      if (!mounted) return
      await validateTokenOrRedirectAsync()
    })()
    return () => { mounted = false }
  }, [])

  //Lightweight socket for receiving community chat notifications (global broadcast)
  useEffect(() => {
    const token = getToken()
    if (!token || !user) return

    const s = io((import.meta as any).env?.VITE_SOCKET_URL || 'http://localhost:3001', {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 2000,
    })
    notifSocketRef.current = s

    s.on('connect', () => setSocketConnected(true))
    s.on('disconnect', () => setSocketConnected(false))
    if (s.connected) setSocketConnected(true)

    s.on('community:chat:notification', (data: any) => {
      if (!data) return
      if (data.senderId && data.senderId === user.id) return
      setCommunityUnread(prev => prev + 1)
    })

    s.on('report:new', (data: any) => {
      loadCommandCenter()
      refreshReports?.()
      if (data?.severity === 'High' || data?.status === 'Urgent') {
        toast({
          type: 'urgent',
          title: `🚨 Urgent Report: ${data?.type || 'New Incident'}`,
          message: data?.location ? `📍 ${data.location}` : undefined,
          duration: 8000,
        })
      } else if (data?.type) {
        toast({
          type: 'info',
          title: `New Report: ${data.type}`,
          message: data?.location || undefined,
          duration: 4500,
        })
      }
    })

    s.on('report:updated', (update: any) => {
      loadCommandCenter()
      //Also update selReport if it's currently open and matches
      if (update?.id) {
        setSelReport(prev => prev && prev.id === update.id ? { ...prev, status: update.status ?? prev.status } : prev)
      }
    })

    s.on('report:bulk-updated', () => {
      loadCommandCenter()
      refreshReports?.()
    })

    s.on('activity:new', (entry: any) => {
      if (!entry) return
      setCommandCenter(prev => {
        if (!prev) return prev
        const updated = [entry, ...(prev.activity || [])].slice(0, 50)
        return { ...prev, activity: updated }
      })
    })

    return () => {
      s.disconnect()
      notifSocketRef.current = null
      setSocketConnected(false)
    }
  }, [user?.id, adminTokenReady, loadCommandCenter, refreshReports])

  useEffect(() => {
    if (!predictionAreaOptions.length) return
    if (!predictionAreaOptions.some((x) => x.area === predictionArea)) {
      setPredictionArea(predictionAreaOptions[0].area)
    }
  }, [predictionAreaOptions, predictionArea])

  //Clear community badge when viewing community
  useEffect(() => {
    if (view === 'community') {
      setCommunityUnread(0)
    }
  }, [view])

  //Load audit log with unmount protection
  useEffect(()=>{
    if(!user) return
    let cancelled = false
    apiGetAuditLog({limit:'500'}).then(d=>{
      if(!cancelled){if(d&&d.length>0)setAuditLog(d);else setAuditLog([])}
    }).catch(()=>{if(!cancelled)setAuditLog([])})
    return ()=>{cancelled=true}
  },[user])

  useEffect(() => {
    if (!user || view !== 'dashboard') return
    loadCommandCenter()
    const timer = setInterval(() => loadCommandCenter(), 30000)
    return () => clearInterval(timer)
  }, [user, view, loadCommandCenter])

  //Load predictions and deployments from real API (deduplicated by area)
  useEffect(()=>{
    if(user){
      apiGetPredictions().then((raw: any[]) => {
        //Deduplicate by area name ? keep highest probability per area
        const byArea: Record<string, any> = {}
        for (const p of raw) {
          const key = (p.area || '').toLowerCase().trim()
          if (!key) continue
          const existing = byArea[key]
          if (!existing || (p.probability ?? 0) > (existing.probability ?? 0)) {
            byArea[key] = p
          }
        }
        setPredictions(Object.values(byArea))
      }).catch(()=>setPredictions([]))
      apiGetDeployments().then(setDeployments).catch(()=>setDeployments([]))
      apiGetHeatmapData().then((d:any)=>setHeatmapData(d?.intensity_data||[])).catch(()=>setHeatmapData([]))
    }
  },[user])

  //Load users for user management view
  useEffect(()=>{
    if(user && view === 'users'){
      apiGetUsers().then(d=>setUsers((d as any).users||d||[])).catch((err: any)=>{
        const msg = err?.response?.data?.error || err?.message || 'Failed to load users'
        pushNotification(msg,'error')
        console.error('[AdminPage] Failed to load users:', msg)
      })
    }
  },[user, view])

  //Smart filter parser ? must be declared before filtered useMemo
  const parseSmartFilter=(query:string,reps:Report[]):Report[]=>{    if(!query.trim())return reps
    const q=query.toLowerCase()
    let result=[...reps]
    if(q.includes('today')){const today=new Date().toDateString();result=result.filter(r=>new Date(r.timestamp).toDateString()===today)}
    if(q.includes('yesterday')){const yesterday=new Date();yesterday.setDate(yesterday.getDate()-1);const ytd=yesterday.toDateString();result=result.filter(r=>new Date(r.timestamp).toDateString()===ytd)}
    if(q.includes('last week')||q.includes('this week')){const weekAgo=Date.now()-7*24*60*60*1000;result=result.filter(r=>new Date(r.timestamp).getTime()>=weekAgo)}
    if(q.includes('urgent'))result=result.filter(r=>r.status==='Urgent')
    if(q.includes('unverified'))result=result.filter(r=>r.status==='Unverified')
    if(q.includes('verified')&&!q.includes('not verified'))result=result.filter(r=>r.status==='Verified')
    if(q.includes('not verified')||q.includes('not yet verified'))result=result.filter(r=>r.status!=='Verified')
    if(q.includes('flagged'))result=result.filter(r=>r.status==='Flagged')
    if(q.includes('resolved'))result=result.filter(r=>r.status==='Resolved')
    if(q.includes('flood'))result=result.filter(r=>(r.type||r.incidentCategory||'').toLowerCase().includes('flood'))
    if(q.includes('fire'))result=result.filter(r=>(r.type||r.incidentCategory||'').toLowerCase().includes('fire'))
    if(q.includes('earthquake'))result=result.filter(r=>(r.type||r.incidentCategory||'').toLowerCase().includes('earthquake'))
    if(q.includes('high')&&(q.includes('severity')||q.includes('critical')))result=result.filter(r=>r.severity==='High')
    if(q.includes('medium severity'))result=result.filter(r=>r.severity==='Medium')
    if(q.includes('low severity'))result=result.filter(r=>r.severity==='Low')
    if(q.includes('with photo')||q.includes('with image')||q.includes('with media'))result=result.filter(r=>r.hasMedia)
    if(q.includes('without photo')||q.includes('no photo'))result=result.filter(r=>!r.hasMedia)
    if(q.includes('trapped'))result=result.filter(r=>r.trappedPersons==='yes')
    const locationMatch=q.match(/in ([a-z\s]+)/i)
    if(locationMatch){const loc=locationMatch[1].trim();result=result.filter(r=>(r.location||'').toLowerCase().includes(loc))}
    return result
  }

  const filtered = useMemo(()=>{
    let arr = [...reports]
    //Apply smart filter first if present
    if(smartFilter.trim()){arr=parseSmartFilter(smartFilter,arr)}
    //Then apply regular filters
    if(searchTerm){const s=searchTerm.toLowerCase();arr=arr.filter(r=>r.type?.toLowerCase().includes(s)||r.location?.toLowerCase().includes(s)||r.description?.toLowerCase().includes(s)||r.reportNumber?.toLowerCase().includes(s)||r.status?.toLowerCase().includes(s))}
    if(filterSeverity!=='all') arr=arr.filter(r=>r.severity===filterSeverity)
    if(filterStatus!=='all') arr=arr.filter(r=>r.status===filterStatus)
    if(filterType!=='all') arr=arr.filter(r=>r.incidentCategory===filterType)
    //Filter by selected incident types from IncidentFilterPanel
    if(selectedTypes.length > 0) {
      arr = arr.filter(r => {
        const cat = (r.incidentCategory || '').toLowerCase()
        const sub = (r.incidentSubtype || '').toLowerCase()
        return selectedTypes.some(t => cat.includes(t) || sub.includes(t))
      })
    }
    return arr.sort((a,b)=>{const STA:Record<string,number>={Urgent:6,Unverified:5,Flagged:4,Verified:3,Resolved:2,Archived:1,False_Report:0};return(STA[b.status]||0)-(STA[a.status]||0)||new Date(b.timestamp).getTime()-new Date(a.timestamp).getTime()})
  },[reports,searchTerm,filterSeverity,filterStatus,filterType,smartFilter,selectedTypes])

  const stats = useMemo(()=>({
    total: reports.length, urgent: reports.filter(r=>r.status==='Urgent').length,
    verified: reports.filter(r=>r.status==='Verified').length, unverified: reports.filter(r=>r.status==='Unverified').length,
    flagged: reports.filter(r=>r.status==='Flagged').length, resolved: reports.filter(r=>r.status==='Resolved').length,
    archived: reports.filter(r=>r.status==='Archived').length, falseReport: reports.filter(r=>r.status==='False_Report').length,
    high: reports.filter(r=>r.severity==='High').length, medium: reports.filter(r=>r.severity==='Medium').length, low: reports.filter(r=>r.severity==='Low').length,
    avgConf: reports.length>0?Math.round(reports.reduce((s,r)=>{const c=Number(r.confidence);return s+(isNaN(c)?0:c)},0)/reports.length):0,
    withMedia: reports.filter(r=>r.hasMedia).length, trapped: reports.filter(r=>r.trappedPersons==='yes').length,
    verifyRate: reports.length>0?Math.round((reports.filter(r=>r.status==='Verified').length/reports.length)*100):0,
  }),[reports])

  const fmtMins = (value: number): string => {
    if (!value || value < 60) return `${value || 0}m`
    const h = Math.floor(value / 60)
    const m = value % 60
    return `${h}h ${m}m`
  }

  const severityLabel = (value: 'High' | 'Medium' | 'Low') => {
    if (value === 'High') return t('admin.filters.severity.high', lang)
    if (value === 'Medium') return t('admin.filters.severity.medium', lang)
    return t('admin.filters.severity.low', lang)
  }

  const statusLabel = (value: string) => {
    if (value === 'Urgent') return t('admin.filters.status.urgent', lang)
    if (value === 'Unverified') return t('admin.filters.status.unverified', lang)
    if (value === 'Verified') return t('admin.filters.status.verified', lang)
    if (value === 'Flagged') return t('admin.filters.status.flagged', lang)
    if (value === 'Resolved') return t('admin.filters.status.resolved', lang)
    if (value === 'Archived') return t('admin.filters.status.archived', lang)
    if (value === 'False_Report') return t('admin.filters.status.falseReport', lang)
    return value
  }

  const askConfirm = (title:string,message:string,type:string,action:()=>void)=>{setConfirmModal({title,message,type,action})}

  const doAction = async(actionName:string,actionType:string,id:string,fn:Function)=>{
    const before = reports.find(r=>r.id===id)
    await fn(id)
    apiAuditLog({operator_id:user?.id,operator_name:user?.displayName,action:actionName,action_type:actionType,target_type:'report',target_id:id,before_state:{status:before?.status},after_state:{status:actionType==='verify'?'Verified':actionType==='flag'?'Flagged':actionType==='urgent'?'Urgent':'Resolved'}}).catch(()=>{})
    apiLogActivity(actionName,actionType,id).catch(()=>{})
    setAuditLog(prev=>[{id:Date.now(),operator_name:user?.displayName,action:actionName,action_type:actionType,target_id:id,created_at:new Date().toISOString()},...prev])
  }

  const doVerify=(id:string)=>askConfirm(t('admin.confirm.verifyTitle',lang),t('admin.confirm.verifyMsg',lang),'success',async()=>{await doAction('Verified report','verify',id,verifyReport);pushNotification(t('admin.stats.verified',lang),'success');setSelReport(null)})
  const doFlag=(id:string)=>askConfirm(t('admin.confirm.flagTitle',lang),t('admin.confirm.flagMsg',lang),'warning',async()=>{await doAction('Flagged report','flag',id,flagReport);pushNotification(t('admin.stats.flagged',lang),'warning');setSelReport(null)})
  const doUrgent=(id:string)=>askConfirm(t('admin.confirm.urgentTitle',lang),t('admin.confirm.urgentMsg',lang),'danger',async()=>{await doAction('Escalated to URGENT','urgent',id,markUrgent);pushNotification(t('admin.stats.urgent',lang),'error');setSelReport(null)})
  const doResolve=(id:string)=>askConfirm(t('admin.confirm.resolveTitle',lang),t('admin.confirm.resolveMsg',lang),'info',async()=>{await doAction('Resolved report','resolve',id,resolveReport);pushNotification(t('admin.stats.resolved',lang),'success');setSelReport(null)})
  const doArchive=(id:string)=>askConfirm(t('admin.confirm.archiveTitle',lang),t('admin.confirm.archiveMsg',lang),'warning',async()=>{await doAction('Archived report','archive',id,archiveReport);pushNotification(t('admin.confirm.archiveSuccess',lang),'success');setSelReport(null)})
  const doFalseReport=(id:string)=>askConfirm(t('admin.confirm.falseTitle',lang),t('admin.confirm.falseMsg',lang),'danger',async()=>{await doAction('Marked as false report','false_report',id,markFalseReport);pushNotification(t('admin.confirm.falseSuccess',lang),'warning');setSelReport(null)})

  //Bulk actions
  const runBulkAction = async (ids: string[], status: string, successMsg: string, notifType: 'success'|'warning'|'error') => {
    setBulkProgress({ current: 0, total: ids.length })
    try {
      await apiBulkUpdateReportStatus(ids, status)
      setBulkProgress({ current: ids.length, total: ids.length })
      await refreshReports?.()
      pushNotification(successMsg, notifType)
      setSelectedReportIds(new Set())
      loadCommandCenter()
    } catch(err:any) {
      pushNotification(err?.message || t('admin.bulkFailed', lang), 'error')
    } finally {
      setBulkProgress(null)
    }
  }
  const doBulkVerify=()=>askConfirm(t('admin.bulk.verifyTitle',lang),t('admin.bulk.verifyMsg',lang).replace('{n}',String(selectedReportIds.size)),'success',async()=>{const ids=Array.from(selectedReportIds);await runBulkAction(ids,'Verified',t('admin.bulk.verifySuccess',lang).replace('{n}',String(ids.length)),'success')})
  const doBulkFlag=()=>askConfirm(t('admin.bulk.flagTitle',lang),t('admin.bulk.flagMsg',lang).replace('{n}',String(selectedReportIds.size)),'warning',async()=>{const ids=Array.from(selectedReportIds);await runBulkAction(ids,'Flagged',t('admin.bulk.flagSuccess',lang).replace('{n}',String(ids.length)),'warning')})
  const doBulkUrgent=()=>askConfirm(t('admin.bulk.urgentTitle',lang),t('admin.bulk.urgentMsg',lang).replace('{n}',String(selectedReportIds.size)),'danger',async()=>{const ids=Array.from(selectedReportIds);await runBulkAction(ids,'Urgent',t('admin.bulk.urgentSuccess',lang).replace('{n}',String(ids.length)),'error')})
  const doBulkResolve=()=>askConfirm(t('admin.bulk.resolveTitle',lang),t('admin.bulk.resolveMsg',lang).replace('{n}',String(selectedReportIds.size)),'info',async()=>{const ids=Array.from(selectedReportIds);await runBulkAction(ids,'Resolved',t('admin.bulk.resolveSuccess',lang).replace('{n}',String(ids.length)),'success')})
  const doBulkArchive=()=>askConfirm(t('admin.bulk.archiveTitle',lang),t('admin.bulk.archiveMsg',lang).replace('{n}',String(selectedReportIds.size)),'warning',async()=>{const ids=Array.from(selectedReportIds);await runBulkAction(ids,'Archived',t('admin.bulk.archiveSuccess',lang).replace('{n}',String(ids.length)),'success')})
  const doBulkFalseReport=()=>askConfirm(t('admin.bulk.falseTitle',lang),t('admin.bulk.falseMsg',lang).replace('{n}',String(selectedReportIds.size)),'danger',async()=>{const ids=Array.from(selectedReportIds);await runBulkAction(ids,'False_Report',t('admin.bulk.falseSuccess',lang).replace('{n}',String(ids.length)),'warning')})

  const toggleSelection=(id:string)=>{setSelectedReportIds(prev=>{const next=new Set(prev);if(next.has(id)){next.delete(id)}else{next.add(id)}return next})}
  const toggleSelectAll=()=>{if(selectedReportIds.size===filtered.length){setSelectedReportIds(new Set())}else{setSelectedReportIds(new Set(filtered.map(r=>r.id)))}}

  const handlePrint=()=>{const w=window.open('','','width=800,height=600');if(!w){pushNotification(t('admin.print.allowPopups',lang),'warning');return}w.document.write('<html><head><title>AEGIS Report</title><style>body{font-family:Arial;padding:20px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:8px;text-align:left;font-size:12px}th{background:#1e40af;color:white}.header{text-align:center;margin-bottom:20px}</style></head><body>');w.document.write(`<div class="header"><h1>AEGIS Emergency Report</h1><p>Generated: ${new Date().toLocaleString()} by ${escapeHtml(user?.displayName||'')}</p><p>${filtered.length} reports</p></div>`);w.document.write('<table><tr><th>ID</th><th>Type</th><th>Severity</th><th>Status</th><th>Location</th><th>AI%</th><th>Time</th></tr>');filtered.forEach(r=>{w.document.write(`<tr><td>${escapeHtml(r.reportNumber||'')}</td><td>${escapeHtml(r.type||'')}</td><td>${escapeHtml(r.severity)}</td><td>${escapeHtml(r.status)}</td><td>${escapeHtml(r.location||'')}</td><td>${r.confidence||0}%</td><td>${new Date(r.timestamp).toLocaleString()}</td></tr>`)});w.document.write('</table><p style="margin-top:20px;font-size:10px;color:#666">AEGIS Emergency Response System - OFFICIAL USE ONLY</p></body></html>');w.document.close();w.focus();w.print()}

  const printSingleReport=(r:Report)=>{const w=window.open('','',`width=800,height=600`);if(!w){pushNotification(t('admin.print.allowPopupSingle',lang),'warning');return}const ai:any=r.aiAnalysis||{};const panicLvl=escapeHtml(String(ai.panicLevel||ai.panic_level||'Moderate'));const fakePrb=ai.fakeProbability??ai.fake_probability??0;const photoV=ai.photoVerified||ai.photo_verified;const wDepth=escapeHtml(String(ai.estimatedWaterDepth||ai.water_depth||'N/A'));const sources=escapeHtml((ai.crossReferenced||[]).join(', ')||ai.sources||'N/A');w.document.write(`<html><head><title>AEGIS Report ${escapeHtml(r.reportNumber||'')}</title><style>body{font-family:Arial,sans-serif;padding:30px;max-width:750px;margin:0 auto}h1{color:#1e40af;border-bottom:3px solid #1e40af;padding-bottom:8px}table{width:100%;border-collapse:collapse;margin:15px 0}th,td{border:1px solid #ddd;padding:10px;text-align:left;font-size:13px}th{background:#f5f5f5;font-weight:600;width:35%}.header{display:flex;justify-content:space-between;align-items:flex-start}.meta{text-align:right;font-size:12px;color:#666}.severity-critical{color:#dc2626;font-weight:bold}.severity-high{color:#ea580c;font-weight:bold}.severity-medium{color:#d97706}.severity-low{color:#2563eb}.section{margin-top:20px}.section h2{font-size:16px;color:#333;border-bottom:1px solid #eee;padding-bottom:5px}.footer{margin-top:30px;text-align:center;font-size:10px;color:#999;border-top:1px solid #eee;padding-top:10px}</style></head><body>`);w.document.write(`<div style="font-size:11px;color:#666">${new Date().toLocaleString()}<span style="float:right">AEGIS Report ${escapeHtml(r.reportNumber||'')}</span></div>`);w.document.write(`<div class="header"><h1>AEGIS Emergency Report</h1><div class="meta">Report ID: ${escapeHtml(r.reportNumber||'')}<br>Generated: ${new Date().toLocaleString()}</div></div>`);w.document.write(`<table><tr><th>Type</th><td>${escapeHtml(r.type||r.incidentCategory||'Emergency Incident')}</td></tr><tr><th>Location</th><td>${escapeHtml(r.location||'')}</td></tr><tr><th>Severity</th><td class="severity-${escapeHtml((r.severity||'').toLowerCase())}">${escapeHtml(r.severity||'')}</td></tr><tr><th>Status</th><td>${escapeHtml(r.status||'')}</td></tr><tr><th>Time</th><td>${escapeHtml(r.displayTime||new Date(r.timestamp).toLocaleString())}</td></tr><tr><th>Reporter</th><td>${escapeHtml(r.reporter||'Anonymous Citizen')}</td></tr><tr><th>Trapped Persons</th><td>${escapeHtml(String(r.trappedPersons||'no'))}</td></tr><tr><th>Media</th><td>${r.hasMedia?'Yes'+(r.mediaType?' ('+escapeHtml(r.mediaType)+')':' (undefined)'):'No'}</td></tr><tr><th>AI Confidence</th><td>${r.confidence?r.confidence+'%':'Pending'}</td></tr></table>`);w.document.write(`<div class="section"><h2>Description</h2><p style="font-size:13px;line-height:1.6">${escapeHtml(r.description||'No description provided.')}</p></div>`);w.document.write(`<div class="section"><h2>AI Analysis</h2><table><tr><th>Panic Level</th><td>${panicLvl}</td></tr><tr><th>Fake Probability</th><td>${fakePrb}%</td></tr><tr><th>Photo Verified</th><td>${photoV?'Yes':'Pending'}</td></tr><tr><th>Water Depth</th><td>${wDepth}</td></tr><tr><th>Sources</th><td>${sources}</td></tr></table></div>`);w.document.write(`<div class="section"><h2>AI Reasoning</h2><p style="font-size:13px;line-height:1.6">${escapeHtml(ai.reasoning||'Report analysed using NLP sentiment analysis (score: '+(ai.sentimentScore||0.7).toFixed(2)+') and cross-referenced with regional emergency authority data. Location matches active risk area. Multiple corroborating reports within 500m radius. Confidence level: '+(r.confidence||75)+'%.')}</p></div>`);w.document.write(`<div class="section"><h2>Recommended Actions</h2><ul style="font-size:13px;line-height:1.8">${r.severity==='High'?'<li>Immediate deployment of emergency services</li><li>Evacuate affected area within 500m radius</li><li>Activate incident mitigation measures</li><li>Issue public alert via all channels</li>':r.severity==='Medium'?'<li>Monitor area closely for escalation</li><li>Pre-position resources nearby</li><li>Issue advisory to local residents</li>':'<li>Continue monitoring</li><li>Log for historical analysis</li>'}</ul></div>`);w.document.write(`<div class="section"><h2>Metadata</h2><table><tr><th>GPS Coordinates</th><td>${r.coordinates?r.coordinates.join(', '):'N/A'}</td></tr><tr><th>Reporter Type</th><td>Anonymous Citizen</td></tr><tr><th>Submission</th><td>AEGIS Citizen Portal</td></tr><tr><th>Generated</th><td>${new Date().toISOString()}</td></tr></table></div>`);w.document.write(`<div class="footer">AEGIS Emergency Response System - Printed by ${escapeHtml(user?.displayName||'System Administrator')} - OFFICIAL USE ONLY<br>This document may contain sensitive emergency data. Handle accordingly.</div>`);w.document.write(`</body></html>`);w.document.close();w.focus();w.print()}

  const handleShareReport = async (r: Report): Promise<void> => {
    const url = `${window.location.origin}/report/${r.id}`
    const title = `AEGIS Report ${r.reportNumber || ''}`.trim()
    const text = `${r.type || r.incidentCategory || 'Emergency report'} at ${r.location || 'Unknown location'}`

    try {
      if (navigator.share) {
        await navigator.share({ title, text, url })
        pushNotification(t('admin.share.dialogOpened',lang),'success')
        return
      }

      await navigator.clipboard.writeText(url)
      const mailto = `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(`${text}\n\n${url}`)}`
      window.open(mailto, '_blank')
      pushNotification(t('admin.share.draftOpened',lang),'success')
    } catch {
      try {
        await navigator.clipboard.writeText(url)
        pushNotification(t('admin.share.linkCopied',lang),'success')
      } catch {
        pushNotification(t('admin.share.unableToShare',lang),'error')
      }
    }
  }

  const handleLogout = () => { logout() }

  function exportData(payload: object, format: 'csv' | 'json', filename: string): void {
    let content: string
    let mime: string
    if (format === 'json') {
      content = JSON.stringify(payload, null, 2)
      mime = 'application/json'
    } else {
      const rows = Object.entries(payload).flatMap(([key, val]) => {
        if (Array.isArray(val)) return val.map((item: any) => ({ section: key, ...item }))
        if (typeof val === 'object' && val !== null) return [{ section: key, ...val }]
        return [{ section: key, value: val }]
      })
      const headers = [...new Set(rows.flatMap(Object.keys))]
      content = [headers.join(','), ...rows.map(r => headers.map(h => JSON.stringify((r as any)[h] ?? '')).join(','))].join('\n')
      mime = 'text/csv'
    }
    const blob = new Blob([content], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${filename}.${format}`; a.click()
    URL.revokeObjectURL(url)
  }

  const exportCommandCenter = (format: 'csv' | 'json') => {
    if (!commandCenter) return
    exportData({
      activity: commandCenter.activity,
      leaderboard: commandCenter.leaderboard,
      recommendations: commandCenter.recommendations,
      comparative: commandCenter.comparative,
      generatedAt: commandCenter.generatedAt,
    }, format, `aegis-command-center-${new Date().toISOString().slice(0, 10)}`)
  }

  //Keyboard shortcut: Ctrl+K focuses global search; ? opens shortcut overlay
  const globalSearchRef = useRef<HTMLInputElement>(null)
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement).isContentEditable
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        globalSearchRef.current?.focus()
      }
      if (e.key === '?' && !inInput && !e.ctrlKey && !e.metaKey) {
        setShowShortcuts(prev => !prev)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  //First-ever boot: allow creating the initial admin account before anyone has logged in
  if (!user && setupStatus && !setupStatus.hasAdmin) {
    return <FirstAdminSetup onComplete={u => setUser(u)} />
  }

  if(!user) return <LoginPage onLogin={u=>setUser(u)}/>

  //Role guard: only admin/operator roles may access this page
  if (user.role !== 'admin' && user.role !== 'operator') {
    return <LoginPage onLogin={u=>setUser(u)}/>
  }

  //First-run setup guard
  if (!setupLoading && setupStatus && !setupStatus.setupCompleted && user.role === 'admin') {
    return <SetupWizard user={user} setupStatus={setupStatus} onComplete={() => { setupRefetch() }} />
  }

  const NAV: {id:View;label:string;icon:any}[] = [
    {id:'home',label:'Welcome',icon:Home},
    {id:'dashboard',label:t('admin.dashboard', lang),icon:BarChart3},{id:'reports',label:t('admin.allReports', lang),icon:FileText},{id:'map',label:t('admin.liveMap', lang),icon:Map},
    {id:'analytics',label:t('admin.analytics', lang),icon:Activity},{id:'ai_models',label:t('admin.models', lang),icon:Brain},{id:'resources',label:t('admin.resources', lang),icon:Navigation},
    ...(user.role === 'admin' ? [{id:'users' as View,label:t('admin.users', lang),icon:Users}] : []),
    {id:'community' as View,label:t('admin.community', lang),icon:Users},
    {id:'history',label:t('admin.history', lang),icon:History},{id:'audit',label:t('admin.audit', lang),icon:Clock},{id:'alert_send',label:t('admin.sendAlert', lang),icon:Bell},
    {id:'system_health' as View,label:t('admin.systemHealth', lang),icon:Activity},
    {id:'crowd' as View,label:t('admin.crowdDensity',lang),icon:Users},
    {id:'delivery' as View,label:t('admin.delivery',lang),icon:Archive},
    {id:'incident_console' as View,label:'Incident Console',icon:Siren},
  ]

  const urgentCount   = reports.filter(r => r.status === 'Urgent').length
  const unverifiedCount = reports.filter(r => r.status === 'Unverified').length

  //Badge counts per nav item
  const NAV_BADGES: Record<string, number> = {
    reports:   urgentCount,
    community: communityUnread,
    alert_send: notifications.length,
  }

  return (
    <AdminLayout
      user={user}
      dark={dark}
      activeView={view}
      urgentCount={urgentCount}
      notificationCount={notifications.length}
      communityUnread={communityUnread}
      searchTerm={searchTerm}
      setSearchTerm={setSearchTerm}
      searchRef={globalSearchRef}
      onViewChange={(v) => setView(v as View)}
      onShowProfile={() => setShowProfile(!showProfile)}
      onLogout={handleLogout}
      badges={NAV_BADGES}
      navItems={NAV.map(n => ({ ...n, badge: NAV_BADGES[n.id] || 0 }))}
    >

      {/* Profile dropdown */}
      {showProfile && (
        <div className="fixed top-16 right-2 sm:right-4 bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700/60 w-72 max-w-[calc(100vw-1rem)] z-50 overflow-hidden">
          {/* Header */}
          <div className="bg-gradient-to-r from-aegis-600 to-aegis-800 px-4 pt-4 pb-6 relative">
            <button onClick={() => setShowProfile(false)} className="absolute top-2 right-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-white/15 hover:bg-white/25 transition-colors">
              <X className="w-4 h-4 text-white"/>
            </button>
            <div className="flex items-center gap-3">
              {user.avatarUrl
                ? <img src={user.avatarUrl} alt="" className="w-12 h-12 rounded-xl object-cover border-2 border-white/40 shadow-lg"/>
                : <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center text-white text-lg font-extrabold border-2 border-white/30">{user.displayName?.charAt(0)}</div>
              }
              <div className="text-white">
                <p className="font-bold text-sm leading-tight">{user.displayName}</p>
                <p className="text-[10px] text-white/70 mt-0.5">{user.email}</p>
                <span className="inline-flex mt-1 items-center bg-white/15 text-white text-[9px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide">{user.department || user.role}</span>
              </div>
            </div>
          </div>
          <div className="p-4 -mt-2">
            {profileEditing ? (
              <div className="space-y-2">
                <input className="w-full px-3 py-2 text-xs bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-aegis-500/30" placeholder={t('citizen.auth.displayName', lang)} value={profileForm.displayName} onChange={e => setProfileForm(f => ({...f, displayName: e.target.value}))}/>
                <input className="w-full px-3 py-2 text-xs bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-aegis-500/30" placeholder={t('admin.profile.email',lang)} value={profileForm.email} onChange={e => setProfileForm(f => ({...f, email: e.target.value}))}/>
                <input className="w-full px-3 py-2 text-xs bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-aegis-500/30" placeholder={t('admin.profile.phone',lang)} value={profileForm.phone} onChange={e => setProfileForm(f => ({...f, phone: e.target.value}))}/>
                <div className="flex gap-2 pt-1">
                  <button onClick={() => setProfileEditing(false)} className="flex-1 text-xs text-gray-500 dark:text-gray-300 py-2 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">{t('general.cancel', lang)}</button>
                  <button onClick={() => { apiUpdateProfile(user!.id, profileForm).then(() => { pushNotification(t('admin.profileUpdated', lang), 'success'); setProfileEditing(false); apiAuditLog({operator_name: user?.displayName, action: 'Updated profile', action_type: 'profile_edit', target_type: 'operator', target_id: user?.id}).catch(() => {}) }).catch(() => pushNotification(t('admin.profile.updateFailed',lang), 'error')) }} className="flex-1 text-xs text-white py-2 rounded-xl bg-aegis-600 hover:bg-aegis-700 transition-colors font-semibold">{t('admin.save', lang)}</button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <button onClick={() => { setProfileForm({displayName: user.displayName || '', email: user.email || '', phone: user.phone || '', department: user.department || ''}); setProfileEditing(true) }} className="flex-1 text-xs font-semibold text-aegis-600 dark:text-aegis-400 py-2 rounded-xl bg-aegis-50 dark:bg-aegis-950/20 hover:bg-aegis-100 dark:hover:bg-aegis-950/40 transition-colors">{t('admin.editProfile', lang)}</button>
                <button onClick={() => setShowProfile(false)} className="flex-1 text-xs text-gray-500 dark:text-gray-300 py-2 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">{t('general.close', lang)}</button>
              </div>
            )}
            {/* Two-Factor Authentication*/}
            <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
              <TwoFactorSettings />
            </div>
          </div>
        </div>
      )}

        {/* WELCOME HOME */}
        {view==='home'&&(loading && reports.length === 0 ? (
          <div className="space-y-6 animate-fade-in">
            <div className="rounded-3xl bg-gradient-to-br from-aegis-600 via-aegis-700 to-blue-900 p-8 h-48 animate-pulse" />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <SkeletonChart height={200} /><SkeletonList count={3} />
            </div>
            <SkeletonList count={5} />
          </div>
        ) : (
          <WelcomeDashboard
            user={user}
            stats={stats}
            alerts={alerts}
            reports={reports}
            lang={lang}
            socketConnected={socketConnected}
            onNavigate={(v) => setView(v as View)}
          />
        ))}

        {/* DASHBOARD - Command Center */}
        {view==='dashboard'&&(loading && reports.length === 0 ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <SkeletonChart height={200} /><SkeletonTable rows={5} cols={4} />
            </div>
            <SkeletonList count={4} />
          </div>
        ) : (
          <CommandCenter
            stats={stats}
            commandCenter={commandCenter}
            reports={reports}
            alerts={alerts}
            user={user}
            lang={lang}
            socketConnected={socketConnected}
            onViewChange={(v) => setView(v as View)}
            onSelectReport={setSelReport}
            onRefresh={() => { refreshReports?.(); loadCommandCenter() }}
            onFilterType={setFilterType}
            filterType={filterType}
            pushNotification={(msg, type) => pushNotification(msg, (type as any) ?? 'info')}
            exportCommandCenter={exportCommandCenter}
            recentSort={recentSort}
            setRecentSort={(v) => setRecentSort(v as any)}
            activityShowAll={activityShowAll}
            setActivityShowAll={setActivityShowAll}
          />
        ))}

        {/* INCIDENT COMMAND CONSOLE -- Standalone SOC view */}
        {view==='incident_console'&&(
          <IncidentCommandConsole
            onSelectIncident={(id) => { setFilterType(id || 'all'); setView('reports' as View) }}
          />
        )}

        {/* REPORTS -- Professional Incident Manager */}
        {view==='reports'&&(loading && reports.length === 0 ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard />
            </div>
            <SkeletonTable rows={8} cols={6} />
          </div>
        ) : (
          <AllReportsManager
            reports={reports}
            filtered={filtered}
            stats={stats}
            lang={lang}
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
            filterSeverity={filterSeverity}
            setFilterSeverity={setFilterSeverity}
            filterStatus={filterStatus}
            setFilterStatus={setFilterStatus}
            filterType={filterType}
            setFilterType={setFilterType}
            smartFilter={smartFilter}
            setSmartFilter={setSmartFilter}
            selectedReportIds={selectedReportIds}
            setSelectedReportIds={setSelectedReportIds}
            bulkProgress={bulkProgress}
            onSelectReport={r => setSelReport(r)}
            onOpenGallery={r => { setSelReport(r); setGalleryIndex(0); setGalleryOpen(true) }}
            onShareReport={handleShareReport}
            onPrintReport={printSingleReport}
            onPrintAll={handlePrint}
            onExportCSV={() => { exportReportsCSV(reports); pushNotification(t('admin.csvExported', lang), 'success') }}
            onExportJSON={() => { exportReportsJSON(reports); pushNotification(t('admin.jsonExported', lang), 'success') }}
            onRefresh={() => refreshReports?.()}
            onBulkVerify={doBulkVerify}
            onBulkFlag={doBulkFlag}
            onBulkUrgent={doBulkUrgent}
            onBulkResolve={doBulkResolve}
            onBulkArchive={doBulkArchive}
            pushNotification={(msg, type) => pushNotification(msg, (type as any) ?? 'info')}
          />
        ))}

        {/* MAP -- Tactical Common Operating Picture */}
        {view==='map'&&(
          <Suspense fallback={<div className="h-64 animate-pulse bg-gray-200 dark:bg-gray-800 rounded" />}>
          <LiveOperationsMap
            filtered={filtered}
            reports={reports}
            loc={loc}
            filterSeverity={filterSeverity}
            setFilterSeverity={setFilterSeverity}
            filterStatus={filterStatus}
            setFilterStatus={setFilterStatus}
            filterType={filterType}
            setFilterType={setFilterType}
            socket={notifSocketRef.current}
            user={user}
            setSelReport={setSelReport}
            activeLocation={activeLocation}
            setActiveLocation={setActiveLocation}
            availableLocations={availableLocations}
          />
          </Suspense>
        )}

        {/* ANALYTICS */}
        {view==='analytics'&&(loading && reports.length === 0 ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <SkeletonChart height={240} /><SkeletonChart height={240} />
            </div>
            <SkeletonChart height={200} />
          </div>
        ) : (
          <AnalyticsCenter
            reports={reports}
            stats={stats}
            auditLog={auditLog}
            lang={lang}
            onRefresh={() => refreshReports?.()}
            onExportCSV={()=>{exportReportsCSV(reports);pushNotification(t('admin.csvExported',lang),'success')}}
            onExportJSON={()=>{exportReportsJSON(reports);pushNotification(t('admin.jsonExported',lang),'success')}}
            onSelectReport={r=>setSelReport(r)}
            pushNotification={(msg, type) => pushNotification(msg, (type as any) ?? 'info')}
          />
        ))}

        {/* AI MODELS */}
        {view==='ai_models'&&(
          <AITransparencyConsole
            predictions={predictions}
            setPredictions={setPredictions}
            predictionArea={predictionArea}
            setPredictionArea={setPredictionArea}
            predictionRunning={predictionRunning}
            setPredictionRunning={setPredictionRunning}
            predictionResult={predictionResult}
            setPredictionResult={setPredictionResult}
            heatmapData={heatmapData}
            predictionAreaOptions={predictionAreaOptions}
            loc={loc}
            activeLocation={activeLocation}
            user={user}
            lang={lang}
            pushNotification={(msg, type) => pushNotification(msg, (type as any) ?? 'info')}
            askConfirm={askConfirm}
            onRefresh={() => refreshReports?.()}
          />
        )}

        {/* HISTORY */}
        {view==='history'&&<AdminHistoricalIntelligence />}

        {/* AUDIT TRAIL */}
        {view==='audit'&&<AdminAuditTrail auditLog={auditLog} setAuditLog={setAuditLog} />}

        {/* RESOURCES */}
        {view==='resources'&&(
          <ResourceDeploymentConsole
            deployments={deployments}
            setDeployments={setDeployments}
            reports={reports}
            auditLog={auditLog}
            setAuditLog={setAuditLog}
            deployReason={deployReason}
            setDeployReason={setDeployReason}
            deployReasonRef={deployReasonRef}
            loc={loc}
            activeLocation={activeLocation}
            user={user}
            pushNotification={(msg, type) => pushNotification(msg, (type as any) ?? 'info')}
            askConfirm={askConfirm}
          />
        )}

        {/* CITIZEN MESSAGING */}
        {view==='messaging'&&(
          <div className="space-y-4 animate-fade-in">
            <h2 className="font-bold text-xl flex items-center gap-2"><MessageSquare className="w-6 h-6 text-aegis-600"/> {t('admin.citizenMessages',lang)}</h2>
            <AdminMessaging />
          </div>
        )}

        {/* COMMUNITY HUB */}
        {view==='community'&&(
          <AdminCommunityHub />
        )}

        {/* SYSTEM HEALTH */}
        {view==='system_health'&&(
          <div className="animate-fade-in">
            <SystemHealthPanel />
          </div>
        )}

        {/* DELIVERY LOGS */}
        {view==='delivery'&&(
          <div className="animate-fade-in">
            <DeliveryDashboard />
          </div>
        )}

        {/* CROWD DENSITY (Sensitive -- Operator Only) */}
        {view==='crowd'&&(
          <div className="animate-fade-in space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-700 flex items-center justify-center shadow-lg">
                <Users className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-lg font-extrabold text-gray-900 dark:text-white">{t('admin.crowdDensityAnalysis',lang)}</h2>
                <p className="text-xs text-gray-500 dark:text-gray-300">{t('admin.sensitiveData',lang)}</p>
              </div>
            </div>
            <Suspense fallback={<div className="h-64 animate-pulse bg-gray-200 dark:bg-gray-800 rounded" />}>
              <CrowdDensityHeatmap />
            </Suspense>
          </div>
        )}

        {/* SECURITY DASHBOARD */}
        {view==='security'&&user.role==='admin'&&(
          <SecurityDashboard />
        )}

        {/* USER & ACCESS MANAGEMENT */}
        {view==='users'&&user.role==='admin'&&(users.length === 0 && !auditLog.length ? (
          <div className="space-y-4">
            <SkeletonTable rows={6} cols={5} />
          </div>
        ) : (
          <UserAccessManagement
            users={users} setUsers={setUsers}
            auditLog={auditLog} setAuditLog={setAuditLog}
            currentUser={user}
            pushNotification={(msg, type) => pushNotification(msg, (type as any) ?? 'info')} askConfirm={askConfirm}
            apiGetUsers={apiGetUsers} apiUpdateUser={apiUpdateUser}
            apiSuspendUser={apiSuspendUser} apiActivateUser={apiActivateUser}
            apiResetUserPassword={apiResetUserPassword} apiDeleteUser={apiDeleteUser}
            apiAuditLog={apiAuditLog} apiGetAuditLog={apiGetAuditLog}
          />
        ))}

        {/* SEND ALERT */}
        {view==='alert_send'&&(
          <AdminAlertBroadcast
            alerts={alerts}
            reports={reports}
            auditLog={auditLog}
            setAuditLog={setAuditLog}
            pushNotification={(msg, type) => pushNotification(msg, (type as any) ?? 'info')}
            refreshAlerts={refreshAlerts}
            setView={(v) => setView(v as View)}
            user={user}
            locationName={loc.name}
          />
        )}

      {/* REPORT DETAIL MODAL -- Professional Glassmorphism Design */}
      {selReport&&(()=>{
        const mediaItems = selReport.media && selReport.media.length > 0
          ? selReport.media
          : selReport.mediaUrl ? [{ id: 'legacy', url: selReport.mediaUrl, file_url: selReport.mediaUrl, aiAnalysis: null }] : []
        const sevGradient = selReport.severity==='High'?'from-red-600 via-red-700 to-rose-800':selReport.severity==='Medium'?'from-aegis-500 via-aegis-600 to-orange-600':'from-blue-500 via-blue-600 to-indigo-600'
        const sevGlow = selReport.severity==='High'?'shadow-red-500/20':selReport.severity==='Medium'?'shadow-aegis-500/20':'shadow-blue-500/20'
        const statusConfig: Record<string,{bg:string,text:string,dot:string}> = {
          Urgent:{bg:'bg-red-100 dark:bg-red-950/40',text:'text-red-700 dark:text-red-300',dot:'bg-red-500'},
          Verified:{bg:'bg-emerald-100 dark:bg-emerald-950/40',text:'text-emerald-700 dark:text-emerald-300',dot:'bg-emerald-500'},
          Flagged:{bg:'bg-aegis-100 dark:bg-aegis-950/40',text:'text-aegis-700 dark:text-aegis-300',dot:'bg-aegis-500'},
          Resolved:{bg:'bg-slate-100 dark:bg-slate-800/40',text:'text-slate-600 dark:text-slate-300',dot:'bg-slate-400'},
          Unverified:{bg:'bg-sky-100 dark:bg-sky-950/40',text:'text-sky-700 dark:text-sky-300',dot:'bg-sky-500'},
          Archived:{bg:'bg-gray-200 dark:bg-gray-800/40',text:'text-gray-500 dark:text-gray-300',dot:'bg-gray-400'},
          False_Report:{bg:'bg-rose-100 dark:bg-rose-950/40',text:'text-rose-700 dark:text-rose-300',dot:'bg-rose-600'},
        }
        const sc = statusConfig[selReport.status] || statusConfig.Unverified
        const catIcons: Record<string,any> = { natural_disaster:Droplets, infrastructure:Building2, public_safety:ShieldAlert, community_safety:Users, environmental:Flame, medical:HeartPulse }
        const CatIcon = catIcons[selReport.incidentCategory] || AlertTriangle

        //Category-specific recommended actions
        const getRecommendedActions = () => {
          const cat = selReport.incidentCategory
          const sev = selReport.severity
          if (cat === 'natural_disaster') {
            if (sev === 'High') return ['Deploy emergency response teams immediately','Activate emergency evacuation protocols','Engage incident-specific mitigation measures','Issue mandatory evacuation alert via all channels','Coordinate with national/regional emergency agencies']
            if (sev === 'Medium') return ['Monitor situation closely for escalation','Pre-position resources and equipment','Alert nearby communities','Review evacuation route accessibility']
            return ['Log for pattern analysis','Continue environmental monitoring','Update risk assessment model']
          }
          if (cat === 'infrastructure') {
            if (sev === 'High') return ['Dispatch structural assessment team','Cordon off danger zone (100m radius)','Issue infrastructure failure alert','Redirect traffic and utilities','Contact utility providers for isolation']
            if (sev === 'Medium') return ['Schedule engineering inspection within 24h','Place warning signage','Monitor for further deterioration','Notify relevant utility company']
            return ['Add to maintenance schedule','Document for infrastructure audit','Monitor periodically']
          }
          if (cat === 'public_safety') {
            if (sev === 'High') return ['Dispatch emergency services immediately','Secure perimeter around incident','Activate public alert system','Deploy crowd management resources','Coordinate with law enforcement']
            if (sev === 'Medium') return ['Increase patrol presence in area','Issue community safety advisory','Review CCTV coverage','Coordinate with neighborhood watch']
            return ['Log incident for crime pattern analysis','Share with community safety team','Update risk assessment']
          }
          if (cat === 'medical') {
            if (sev === 'High') return ['Dispatch paramedics/ambulance immediately','Alert nearest A&E department','Establish triage area if multiple casualties','Request air ambulance if remote','Activate mass casualty protocol if needed']
            if (sev === 'Medium') return ['Dispatch community first responder','Alert local GP/walk-in centre','Prepare non-emergency transport','Follow up within 2 hours']
            return ['Log for public health monitoring','Share with community health team','Update health risk assessment']
          }
          if (cat === 'environmental') {
            if (sev === 'High') return ['Deploy hazmat team to contain','Evacuate if airborne contamination','Alert Environmental Agency','Set up air/water quality monitoring','Issue public health advisory']
            if (sev === 'Medium') return ['Send environmental assessment team','Collect samples for lab analysis','Notify local environmental health','Monitor contamination spread']
            return ['Document for environmental report','Schedule routine inspection','Update environmental risk register']
          }
          //Default fallback
          if (sev === 'High') return ['Immediate deployment of emergency services','Evacuate affected area within 500m radius','Activate emergency barriers','Issue public alert via all channels']
          if (sev === 'Medium') return ['Monitor area closely for escalation','Pre-position emergency resources nearby','Issue advisory to local residents']
          return ['Continue monitoring','Log for historical analysis']
        }

        return <>
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-start sm:items-center justify-center p-0 sm:p-4 z-[9999] animate-fade-in" onClick={()=>{setSelReport(null);setGalleryOpen(false);setNotesEditing(false)}}>
          <div className={`bg-white dark:bg-gray-900 sm:rounded-2xl shadow-2xl ${sevGlow} w-full max-w-2xl h-full sm:h-auto sm:max-h-[92vh] overflow-hidden flex flex-col`} onClick={e=>e.stopPropagation()}>
            {/* Gradient Header with severity-based theming */}
            <div className={`bg-gradient-to-r ${sevGradient} p-4 sm:p-5 relative`}>
              <div className="absolute inset-0 overflow-hidden opacity-10"><div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-white/20 blur-2xl"/><div className="absolute -bottom-10 -left-10 w-32 h-32 rounded-full bg-white/10 blur-2xl"/></div>
              <div className="relative flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <CatIcon className="w-5 h-5 text-white/80"/>
                    <span className="text-slate-600 dark:text-white/70 text-[10px] font-mono tracking-wider uppercase">{selReport.reportNumber}</span>
                  </div>
                  <h3 className="font-bold text-white text-base sm:text-lg leading-tight truncate">{selReport.type || selReport.incidentCategory}</h3>
                  <p className="text-slate-600 dark:text-white/60 text-xs mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="flex items-center gap-1"><Clock className="w-3 h-3"/>{new Date(selReport.timestamp).toLocaleString()}</span>
                    <span className="flex items-center gap-1"><MapPin className="w-3 h-3"/>{selReport.location?.substring(0,120)}{(selReport.location?.length||0)>120?'...':''}</span>
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={()=>handleShareReport(selReport)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/20 hover:bg-white/30 text-white transition-all" title={t('admin.detail.shareReport',lang)}><Share2 className="w-4 h-4"/></button>
                  <button onClick={()=>printSingleReport(selReport)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/20 hover:bg-white/30 text-white transition-all" title={t('admin.detail.printReport',lang)}><Printer className="w-4 h-4"/></button>
                  <button onClick={()=>{setSelReport(null);setGalleryOpen(false);setNotesEditing(false)}} className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/20 hover:bg-white/30 text-white transition-all"><X className="w-4 h-4"/></button>
                </div>
              </div>
              {/* Status & Severity pills */}
              <div className="relative flex gap-2 mt-3 flex-wrap">
                <span className={`text-[10px] px-2.5 py-1 rounded-full font-extrabold uppercase tracking-wider ${selReport.severity==='High'?'bg-red-200/80 text-red-900':selReport.severity==='Medium'?'bg-aegis-200/80 text-aegis-900':'bg-blue-200/80 text-blue-900'}`}>{selReport.severity} {t('admin.detail.severity',lang)}</span>
                <span className={`text-[10px] px-2.5 py-1 rounded-full font-bold flex items-center gap-1 ${sc.bg} ${sc.text}`}><span className={`w-1.5 h-1.5 rounded-full ${sc.dot} animate-pulse`}/>{selReport.status === 'False_Report' ? t('admin.filters.status.falseReport',lang) : selReport.status}</span>
                {selReport.trappedPersons==='yes'&&<span className="text-[10px] px-2.5 py-1 rounded-full bg-red-500 text-white font-extrabold animate-pulse flex items-center gap-1"><AlertTriangle className="w-3 h-3"/>{t('admin.detail.trappedPersons',lang)}</span>}
                {selReport.confidence!=null&&<span className={`text-[10px] px-2.5 py-1 rounded-full font-bold ${(selReport.confidence||0)>=80?'bg-green-200/80 text-green-900':(selReport.confidence||0)>=50?'bg-aegis-200/80 text-aegis-900':'bg-red-200/80 text-red-900'}`}><Brain className="w-3 h-3 inline mr-0.5"/>{selReport.confidence}% AI</span>}
              </div>
            </div>

            {/* Scrollable content body */}
            <div className="overflow-y-auto flex-1 p-4 sm:p-5 space-y-4">
              {/* Key Information Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  {icon:Hash,label:t('admin.detail.reportId',lang),value:selReport.reportNumber||'N/A'},
                  {icon:Clock,label:t('admin.detail.submitted',lang),value:selReport.displayTime||new Date(selReport.timestamp).toLocaleString()},
                  {icon:User,label:t('admin.detail.reporter',lang),value:selReport.reporter||t('admin.detail.anonymousCitizen',lang)},
                  {icon:Globe,label:t('admin.detail.gps',lang),value:selReport.coordinates?`${selReport.coordinates[0].toFixed(4)}, ${selReport.coordinates[1].toFixed(4)}`:'N/A'},
                ].map((item,i)=>(
                  <div key={i} className="bg-gray-50/80 dark:bg-gray-800/50 rounded-xl p-2.5 border border-gray-100 dark:border-gray-800">
                    <div className="flex items-center gap-1.5 mb-1"><item.icon className="w-3 h-3 text-gray-400 dark:text-gray-300"/><span className="text-[9px] text-gray-400 dark:text-gray-300 font-bold uppercase tracking-wider">{item.label}</span></div>
                    <p className="text-xs font-semibold text-gray-800 dark:text-gray-200 truncate">{item.value}</p>
                  </div>
                ))}
              </div>

              {/* Location & Description */}
              <div className="space-y-3">
                <div className="bg-gray-50/80 dark:bg-gray-800/50 rounded-xl p-3 border border-gray-100 dark:border-gray-800">
                  <p className="text-[9px] text-gray-400 dark:text-gray-300 font-bold uppercase tracking-wider mb-1 flex items-center gap-1"><MapPin className="w-3 h-3"/>{t('admin.detail.location',lang)}</p>
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{selReport.location||t('admin.detail.notSpecified',lang)}</p>
                </div>
                <div className="bg-gray-50/80 dark:bg-gray-800/50 rounded-xl p-3 border border-gray-100 dark:border-gray-800">
                  <p className="text-[9px] text-gray-400 dark:text-gray-300 font-bold uppercase tracking-wider mb-1 flex items-center gap-1"><FileText className="w-3 h-3"/>{t('admin.detail.description',lang)}</p>
                  <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{selReport.description||t('admin.detail.noDescription',lang)}</p>
                </div>
              </div>

              {/* AI Analysis ? Professional Card */}
              <div className="bg-gradient-to-br from-indigo-50/80 via-blue-50/40 to-purple-50/80 dark:from-indigo-950/30 dark:via-blue-950/20 dark:to-purple-950/30 rounded-xl p-4 border border-indigo-100/60 dark:border-indigo-800/30">
                <h4 className="text-xs font-extrabold flex items-center gap-2 text-indigo-800 dark:text-indigo-200 mb-3"><Brain className="w-4 h-4 text-indigo-500"/>{t('admin.detail.aiAnalysis',lang)}</h4>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {[
                    {label:t('admin.detail.aiConfidence',lang),value:`${selReport.confidence||0}%`,color:(selReport.confidence||0)>=80?'text-green-600':(selReport.confidence||0)>=50?'text-aegis-600':'text-red-600'},
                    {label:t('admin.detail.aiPanic',lang),value:selReport.aiAnalysis?.panicLevel||selReport.aiAnalysis?.panic_level||'N/A',color:'text-gray-800 dark:text-gray-200'},
                    {label:t('admin.detail.aiFakeRisk',lang),value:`${((selReport.aiAnalysis?.fakeProbability??selReport.aiAnalysis?.fake_probability??0)*100).toFixed(1)}%`,color:((selReport.aiAnalysis?.fakeProbability??selReport.aiAnalysis?.fake_probability??0)*100)>50?'text-red-600':'text-green-600'},
                    {label:t('admin.detail.aiSentiment',lang),value:selReport.aiAnalysis?.sentimentScore?`${(selReport.aiAnalysis.sentimentScore*100).toFixed(0)}%`:'N/A',color:'text-gray-800 dark:text-gray-200'},
                    {label:t('admin.detail.aiPhoto',lang),value:selReport.aiAnalysis?.photoVerified||selReport.aiAnalysis?.photo_verified?t('admin.detail.aiVerified',lang):t('admin.detail.aiPending',lang),color:selReport.aiAnalysis?.photoVerified||selReport.aiAnalysis?.photo_verified?'text-green-600':'text-aegis-500'},
                    {label:t('admin.detail.aiDepth',lang),value:selReport.aiAnalysis?.estimatedWaterDepth||selReport.aiAnalysis?.water_depth||'N/A',color:'text-gray-800 dark:text-gray-200'},
                  ].map((m,i)=>(
                    <div key={i} className="text-center bg-white/60 dark:bg-gray-900/40 rounded-lg p-2 border border-white/50 dark:border-gray-700/30">
                      <p className="text-[8px] text-gray-400 dark:text-gray-300 font-bold uppercase">{m.label}</p>
                      <p className={`text-sm font-extrabold ${m.color}`}>{m.value}</p>
                    </div>
                  ))}
                </div>
                {(selReport.aiAnalysis?.crossReferenced||selReport.aiAnalysis?.sources)&&(
                  <div className="mt-2 text-[10px] text-indigo-600 dark:text-indigo-300"><span className="font-bold">{t('admin.detail.aiSources',lang)}:</span> {(selReport.aiAnalysis?.crossReferenced||[]).join(', ')||selReport.aiAnalysis?.sources}</div>
                )}
                {/* AI provider badge */}
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {selReport.aiAnalysis?.mlPowered === true ? (
                    <span className="inline-flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse inline-block"/> {t('admin.detail.mlPowered',lang)}
                    </span>
                  ) : selReport.aiAnalysis?.mlPowered === false ? (
                    <span className="inline-flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full bg-aegis-100 text-aegis-700 dark:bg-aegis-900/30 dark:text-aegis-300">
                      <span className="w-1.5 h-1.5 rounded-full bg-aegis-500 inline-block"/> {t('admin.detail.heuristicOnly',lang)}
                    </span>
                  ) : null}
                  {(selReport.aiAnalysis?.modelsUsed||[]).map((m:string,i:number)=>(
                    <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-mono">{m}</span>
                  ))}
                  {selReport.aiAnalysis?.predictedCategory&&(
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 font-semibold">Cat: {selReport.aiAnalysis.predictedCategory}</span>
                  )}
                </div>
                {selReport.aiAnalysis?.reasoning&&<div className="mt-2 bg-white/40 dark:bg-gray-900/30 rounded-lg p-2 border border-indigo-100/40 dark:border-indigo-800/20"><p className="text-[10px] font-bold text-indigo-700 dark:text-indigo-300 mb-0.5">{t('admin.detail.aiReasoning',lang)}</p><p className="text-[11px] text-gray-600 dark:text-gray-300 leading-relaxed">{selReport.aiAnalysis.reasoning}</p></div>}
                {selReport.aiAnalysis?.photoValidation&&<div className="mt-2 bg-blue-50/60 dark:bg-blue-950/20 rounded-lg p-2 border border-blue-200/40 dark:border-blue-800/20"><p className="text-[10px] font-bold text-blue-700 dark:text-blue-300">{t('admin.detail.detected',lang)}: {selReport.aiAnalysis.photoValidation.objectsDetected?.join(', ')||'N/A'}</p></div>}
              </div>

              {/* Recommended Actions ? Category-Specific */}
              <div className="bg-gradient-to-br from-emerald-50/80 to-green-50/80 dark:from-emerald-950/30 dark:to-green-950/30 rounded-xl p-3 border border-emerald-100/60 dark:border-emerald-800/30">
                <h4 className="text-xs font-extrabold flex items-center gap-2 text-emerald-800 dark:text-emerald-200 mb-2"><CheckCircle className="w-3.5 h-3.5 text-emerald-500"/>{t('admin.detail.recommendedActions',lang)}</h4>
                <ul className="space-y-1">
                  {getRecommendedActions().map((action,i)=>(
                    <li key={i} className="text-[11px] text-gray-700 dark:text-gray-300 flex items-start gap-2"><CircleDot className="w-3 h-3 text-emerald-400 mt-0.5 flex-shrink-0"/><span>{action}</span></li>
                  ))}
                </ul>
              </div>

              {/* Status Timeline */}
              <div className="bg-gray-50/80 dark:bg-gray-800/50 rounded-xl p-3 border border-gray-100 dark:border-gray-800">
                <h4 className="text-xs font-extrabold flex items-center gap-2 text-gray-700 dark:text-gray-200 mb-2"><Clock className="w-3.5 h-3.5 text-gray-400 dark:text-gray-300"/>{t('admin.detail.statusTimeline',lang)}</h4>
                <div className="space-y-2 border-l-2 border-gray-200 dark:border-gray-700 pl-4 ml-1">
                  <div className="relative"><div className="absolute -left-[21px] top-0.5 w-3 h-3 rounded-full bg-blue-500 border-2 border-white dark:border-gray-900 shadow-sm"/><p className="text-[10px] text-gray-400 dark:text-gray-300">{new Date(selReport.timestamp).toLocaleString()}</p><p className="text-[11px] font-semibold text-gray-700 dark:text-gray-300">{t('admin.detail.timelineSubmitted',lang)}</p></div>
                  <div className="relative"><div className="absolute -left-[21px] top-0.5 w-3 h-3 rounded-full bg-purple-500 border-2 border-white dark:border-gray-900 shadow-sm"/><p className="text-[10px] text-gray-400 dark:text-gray-300">{new Date(new Date(selReport.timestamp).getTime()+30000).toLocaleString()}</p><p className="text-[11px] font-semibold text-gray-700 dark:text-gray-300">{t('admin.detail.timelineAi',lang).replace('{pct}',String(selReport.confidence||0))}</p></div>
                  {selReport.verifiedAt&&<div className="relative"><div className="absolute -left-[21px] top-0.5 w-3 h-3 rounded-full bg-green-500 border-2 border-white dark:border-gray-900 shadow-sm"/><p className="text-[10px] text-gray-400 dark:text-gray-300">{new Date(selReport.verifiedAt).toLocaleString()}</p><p className="text-[11px] font-semibold text-gray-700 dark:text-gray-300">{t('admin.detail.timelineVerified',lang)}</p></div>}
                  {selReport.status!=='Unverified'&&!selReport.verifiedAt&&<div className="relative"><div className="absolute -left-[21px] top-0.5 w-3 h-3 rounded-full bg-green-500 border-2 border-white dark:border-gray-900 shadow-sm"/><p className="text-[10px] text-gray-400 dark:text-gray-300">{new Date(new Date(selReport.timestamp).getTime()+120000).toLocaleString()}</p><p className="text-[11px] font-semibold text-gray-700 dark:text-gray-300">{t('admin.detail.timelineChanged',lang)} {selReport.status === 'False_Report' ? t('admin.filters.status.falseReport',lang) : selReport.status}</p></div>}
                  {selReport.resolvedAt&&<div className="relative"><div className="absolute -left-[21px] top-0.5 w-3 h-3 rounded-full bg-slate-400 border-2 border-white dark:border-gray-900 shadow-sm"/><p className="text-[10px] text-gray-400 dark:text-gray-300">{new Date(selReport.resolvedAt).toLocaleString()}</p><p className="text-[11px] font-semibold text-gray-700 dark:text-gray-300">{t('admin.detail.timelineResolved',lang)}</p></div>}
                </div>
              </div>

              {/* Evidence Gallery ? Enhanced with Animations */}
              {mediaItems.length > 0 && (
                <div className="bg-gradient-to-br from-purple-50/80 to-pink-50/80 dark:from-purple-950/30 dark:to-pink-950/30 rounded-xl p-3 border border-purple-100/60 dark:border-purple-800/30">
                  <h4 className="text-xs font-extrabold flex items-center gap-2 text-purple-800 dark:text-purple-200 mb-2"><Camera className="w-3.5 h-3.5 text-purple-500"/>{t('admin.detail.evidenceGallery',lang)} <span className="text-purple-400 font-normal">({mediaItems.length} photo{mediaItems.length!==1?'s':''})</span></h4>
                  <div className={`grid gap-2 ${mediaItems.length===1?'grid-cols-1':mediaItems.length===2?'grid-cols-2':'grid-cols-2 sm:grid-cols-3'}`}>
                    {mediaItems.map((m:any,i:number)=>(
                      <div key={m.id||i} className="relative group cursor-pointer rounded-xl overflow-hidden border-2 border-purple-200/40 dark:border-purple-700/30 hover:border-purple-400 dark:hover:border-purple-500 transition-all hover:shadow-lg hover:shadow-purple-500/10 hover:scale-[1.02]" onClick={()=>{setGalleryIndex(i);setGalleryOpen(true)}}>
                        <img src={m.url||m.file_url} alt={`Evidence ${i+1}`} className={`w-full object-cover transition-transform group-hover:scale-110 duration-300 ${mediaItems.length===1?'max-h-52':'h-32'}`}/>
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end p-2">
                          <span className="text-slate-900 dark:text-white text-[10px] font-bold flex items-center gap-1"><ZoomIn className="w-3 h-3"/>{t('admin.detail.viewFull',lang)}</span>
                        </div>
                        <div className="absolute top-1.5 right-1.5 bg-black/60 backdrop-blur-sm text-white text-[9px] font-bold px-2 py-0.5 rounded-full">{i+1}/{mediaItems.length}</div>
                        {m.aiAnalysis&&(
                          <div className="absolute top-1.5 left-1.5 bg-indigo-600/80 backdrop-blur-sm text-white text-[8px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-0.5"><Brain className="w-2.5 h-2.5"/>{t('admin.detail.analyzed',lang)}</div>
                        )}
                      </div>
                    ))}
                  </div>
                  {mediaItems.some((m:any)=>m.aiAnalysis)&&(
                    <div className="mt-2 space-y-1">
                      {mediaItems.filter((m:any)=>m.aiAnalysis).map((m:any,i:number)=>(
                        <div key={i} className="flex items-center gap-2 bg-white/40 dark:bg-gray-900/30 rounded-lg px-2 py-1 text-[9px]">
                          <span className="text-purple-500 font-bold">{t('admin.detail.photo',lang)} {i+1}:</span>
                          {m.aiAnalysis.classification&&<span className="text-gray-600 dark:text-gray-300">Class: <strong>{m.aiAnalysis.classification}</strong></span>}
                          {m.aiAnalysis.waterDepth&&<span className="text-gray-600 dark:text-gray-300">Depth: <strong>{m.aiAnalysis.waterDepth}</strong></span>}
                          {m.aiAnalysis.authenticityScore!==undefined&&<span className="text-gray-600 dark:text-gray-300">Auth: <strong>{m.aiAnalysis.authenticityScore}%</strong></span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {mediaItems.length===0&&selReport.hasMedia&&(
                <div className="text-center py-4 text-gray-400 dark:text-gray-300 text-xs italic">{t('admin.detail.mediaNotAvailable',lang)}</div>
              )}

              {/* Operator Notes -- Inline Edit */}
              <div className="bg-gray-50/80 dark:bg-gray-800/50 rounded-xl p-3 border border-gray-100 dark:border-gray-800">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-extrabold flex items-center gap-2 text-gray-700 dark:text-gray-200"><Edit2 className="w-3.5 h-3.5 text-gray-400 dark:text-gray-300"/>{t('admin.detail.operatorNotes',lang)}</h4>
                  {!notesEditing && (
                    <button onClick={()=>{setNotesDraft(selReport.operatorNotes||'');setNotesEditing(true)}} className="text-[10px] px-2 py-0.5 rounded-lg bg-aegis-100 dark:bg-aegis-900/30 text-aegis-700 dark:text-aegis-300 border border-aegis-200 dark:border-aegis-800/40 hover:bg-aegis-200 dark:hover:bg-aegis-800/40 transition-all font-semibold flex items-center gap-1">
                      <Edit2 className="w-2.5 h-2.5"/>{selReport.operatorNotes ? 'Edit' : 'Add note'}
                    </button>
                  )}
                </div>
                {notesEditing ? (
                  <div className="space-y-2">
                    <textarea
                      value={notesDraft}
                      onChange={e=>setNotesDraft(e.target.value)}
                      placeholder="Add operator notes..."
                      rows={3}
                      className="w-full text-xs rounded-lg border border-aegis-200 dark:border-aegis-700/50 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 p-2 resize-none focus:outline-none focus:ring-2 focus:ring-aegis-400 dark:focus:ring-aegis-500"
                    />
                    <div className="flex gap-2">
                      <button
                        disabled={notesSaving}
                        onClick={async()=>{
                          setNotesSaving(true)
                          try {
                            await apiUpdateReportNotes(selReport.id, notesDraft.trim())
                            setSelReport(prev=>prev?{...prev,operatorNotes:notesDraft.trim()||null}:null)
                            refreshReports()
                            setNotesEditing(false)
                          } catch(e:any){ pushNotification(e.message||'Failed to save notes','error') }
                          finally{ setNotesSaving(false) }
                        }}
                        className="text-[11px] px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold flex items-center gap-1 transition-all disabled:opacity-60"
                      >
                        <CheckCircle className="w-3 h-3"/>{notesSaving ? 'Saving...' : 'Save'}
                      </button>
                      <button onClick={()=>setNotesEditing(false)} className="text-[11px] px-3 py-1.5 rounded-lg bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 font-semibold transition-all">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-gray-500 dark:text-gray-300 italic">{selReport.operatorNotes || t('admin.detail.noOperatorNotes',lang)}</p>
                )}
              </div>

              {/* Action Buttons ? Status-locked once decided, super-admin can override */}
              {(()=>{
                const decided = ['Verified','Urgent','False_Report','Resolved','Archived'].includes(selReport.status)
                const isSuperAdmin = user?.role === 'admin' || user?.department === 'Command & Control'
                const canAct = !decided || isSuperAdmin
                return (
                  <div className="space-y-2 pt-1">
                    {decided && !isSuperAdmin && (
                      <div className="flex items-center gap-2 px-3 py-2 bg-aegis-50 dark:bg-aegis-950/30 border border-aegis-200 dark:border-aegis-800/40 rounded-xl text-xs text-aegis-700 dark:text-aegis-300">
                        <svg className="w-3.5 h-3.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd"/></svg>
                        {t('admin.detail.statusLocked',lang)}
                      </div>
                    )}
                    {decided && isSuperAdmin && (
                      <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/40 rounded-xl text-xs text-blue-700 dark:text-blue-300">
                        <svg className="w-3.5 h-3.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd"/></svg>
                        {t('admin.detail.superAdminOverride',lang)}
                      </div>
                    )}
                    <div className={`grid grid-cols-2 sm:grid-cols-4 gap-2 ${!canAct ? 'opacity-40 pointer-events-none' : ''}`}>
                      <button onClick={()=>canAct&&doVerify(selReport.id)} disabled={!canAct} className="group text-[11px] bg-emerald-50 dark:bg-emerald-950/20 hover:bg-emerald-100 dark:hover:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/40 py-2.5 rounded-xl font-bold flex items-center justify-center gap-1.5 transition-all hover:shadow-md hover:shadow-emerald-500/10 disabled:cursor-not-allowed"><CheckCircle className="w-4 h-4 group-hover:scale-110 transition-transform"/> {t('admin.action.verify',lang)}</button>
                      <button onClick={()=>canAct&&doFlag(selReport.id)} disabled={!canAct} className="group text-[11px] bg-aegis-50 dark:bg-aegis-950/20 hover:bg-aegis-100 dark:hover:bg-aegis-950/40 text-aegis-700 dark:text-aegis-300 border border-aegis-200 dark:border-aegis-800/40 py-2.5 rounded-xl font-bold flex items-center justify-center gap-1.5 transition-all hover:shadow-md hover:shadow-aegis-500/10 disabled:cursor-not-allowed"><Flag className="w-4 h-4 group-hover:scale-110 transition-transform"/> {t('admin.action.flag',lang)}</button>
                      <button onClick={()=>canAct&&doUrgent(selReport.id)} disabled={!canAct} className="group text-[11px] bg-red-50 dark:bg-red-950/20 hover:bg-red-100 dark:hover:bg-red-950/40 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800/40 py-2.5 rounded-xl font-bold flex items-center justify-center gap-1.5 transition-all hover:shadow-md hover:shadow-red-500/10 disabled:cursor-not-allowed"><Siren className="w-4 h-4 group-hover:scale-110 transition-transform"/> {t('admin.action.urgent',lang)}</button>
                      <button onClick={()=>canAct&&doResolve(selReport.id)} disabled={!canAct} className="group text-[11px] bg-slate-50 dark:bg-slate-800/40 hover:bg-slate-100 dark:hover:bg-slate-700/40 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700/40 py-2.5 rounded-xl font-bold flex items-center justify-center gap-1.5 transition-all hover:shadow-md hover:shadow-slate-500/10 disabled:cursor-not-allowed"><CheckCircle2 className="w-4 h-4 group-hover:scale-110 transition-transform"/> {t('admin.action.resolve',lang)}</button>
                    </div>
                    <div className={`grid grid-cols-2 gap-2 ${!canAct ? 'opacity-40 pointer-events-none' : ''}`}>
                      <button onClick={()=>canAct&&doArchive(selReport.id)} disabled={!canAct} className="group text-[11px] bg-gray-50 dark:bg-gray-800/40 hover:bg-gray-100 dark:hover:bg-gray-700/40 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700/40 py-2 rounded-xl font-semibold flex items-center justify-center gap-1.5 transition-all hover:shadow-md disabled:cursor-not-allowed"><Archive className="w-3.5 h-3.5 group-hover:scale-110 transition-transform"/> {t('admin.action.archive',lang)}</button>
                      <button onClick={()=>canAct&&doFalseReport(selReport.id)} disabled={!canAct} className="group text-[11px] bg-rose-50 dark:bg-rose-950/20 hover:bg-rose-100 dark:hover:bg-rose-950/40 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800/40 py-2 rounded-xl font-semibold flex items-center justify-center gap-1.5 transition-all hover:shadow-md disabled:cursor-not-allowed"><XCircle className="w-3.5 h-3.5 group-hover:scale-110 transition-transform"/> {t('admin.action.falseReport',lang)}</button>
                    </div>
                  </div>
                )
              })()}
            </div>
          </div>
        </div>

        {/* FULLSCREEN PHOTO GALLERY OVERLAY */}
        {galleryOpen && mediaItems.length > 0 && (
          <div className="fixed inset-0 bg-black/95 backdrop-blur-xl z-[9999] flex flex-col animate-fade-in" onClick={()=>setGalleryOpen(false)}>
            {/* Gallery Header */}
            <div className="flex-shrink-0 flex items-center justify-between px-4 sm:px-6 py-3 bg-gradient-to-b from-black/80 to-transparent relative z-10" onClick={e=>e.stopPropagation()}>
              <div className="flex items-center gap-3">
                <Camera className="w-5 h-5 text-purple-400"/>
                <div>
                  <p className="text-slate-900 dark:text-white text-sm font-bold">{t('admin.gallery.evidencePhoto',lang)} {galleryIndex+1} {t('admin.gallery.of',lang)} {mediaItems.length}</p>
                  <p className="text-white/50 text-[10px]">{selReport.reportNumber} ? {selReport.type}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={()=>window.open(mediaItems[galleryIndex]?.url||mediaItems[galleryIndex]?.file_url,'_blank')} className="w-9 h-9 flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 text-white transition-all" title={t('admin.gallery.openOriginal',lang)}><ExternalLink className="w-4 h-4"/></button>
                <button onClick={()=>setGalleryOpen(false)} className="w-9 h-9 flex items-center justify-center rounded-lg bg-white/10 hover:bg-red-500/80 text-white transition-all" title={t('admin.gallery.closeGallery',lang)}><X className="w-5 h-5"/></button>
              </div>
            </div>
            {/* Gallery Main Image */}
            <div className="flex-1 flex items-center justify-center relative px-12 sm:px-20" onClick={e=>e.stopPropagation()}>
              {/* Previous Button */}
              {mediaItems.length>1&&<button onClick={()=>setGalleryIndex(p=>(p-1+mediaItems.length)%mediaItems.length)} className="absolute left-2 sm:left-6 top-1/2 -translate-y-1/2 w-10 h-10 sm:w-12 sm:h-12 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-all hover:scale-110 z-10 backdrop-blur-sm"><ChevronLeft className="w-5 h-5 sm:w-6 sm:h-6"/></button>}
              {/* Image Container */}
              <div className="relative max-w-full max-h-full flex items-center justify-center">
                <img src={mediaItems[galleryIndex]?.url||mediaItems[galleryIndex]?.file_url} alt={`Evidence ${galleryIndex+1}`} className="max-w-full max-h-[70vh] object-contain rounded-lg shadow-2xl shadow-black/50 transition-all duration-300" style={{animation:'gallerySlide 0.3s ease-out'}}/>
              </div>
              {/* Next Button */}
              {mediaItems.length>1&&<button onClick={()=>setGalleryIndex(p=>(p+1)%mediaItems.length)} className="absolute right-2 sm:right-6 top-1/2 -translate-y-1/2 w-10 h-10 sm:w-12 sm:h-12 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-all hover:scale-110 z-10 backdrop-blur-sm"><ChevronRight className="w-5 h-5 sm:w-6 sm:h-6"/></button>}
            </div>
            {/* Gallery Thumbnails Strip */}
            {mediaItems.length>1&&(
              <div className="flex-shrink-0 flex items-center justify-center gap-2 py-4 bg-gradient-to-t from-black/80 to-transparent" onClick={e=>e.stopPropagation()}>
                {mediaItems.map((m:any,i:number)=>(
                  <button key={m.id||i} onClick={()=>setGalleryIndex(i)} className={`relative rounded-lg overflow-hidden transition-all duration-200 ${i===galleryIndex?'ring-2 ring-purple-500 scale-110 shadow-lg shadow-purple-500/30':'opacity-60 hover:opacity-90 hover:scale-105'}`}>
                    <img src={m.url||m.file_url} alt="" className="w-16 h-12 sm:w-20 sm:h-14 object-cover"/>
                    {i===galleryIndex&&<div className="absolute inset-0 bg-purple-500/10 border-2 border-purple-500 rounded-lg"/>}
                  </button>
                ))}
              </div>
            )}
            {/* AI Analysis for Current Photo */}
            {mediaItems[galleryIndex]?.aiAnalysis&&(
              <div className="flex-shrink-0 flex items-center justify-center gap-4 py-2 px-4" onClick={e=>e.stopPropagation()}>
                <div className="bg-white/5 backdrop-blur-sm rounded-lg px-4 py-2 flex items-center gap-4 text-[10px]">
                  <span className="text-purple-400 font-bold"><Brain className="w-3 h-3 inline mr-1"/>{t('admin.gallery.aiPhotoAnalysis',lang)}</span>
                  {mediaItems[galleryIndex].aiAnalysis.classification&&<span className="text-white/70">Class: <strong className="text-white">{mediaItems[galleryIndex].aiAnalysis.classification}</strong></span>}
                  {mediaItems[galleryIndex].aiAnalysis.waterDepth&&<span className="text-white/70">Depth: <strong className="text-white">{mediaItems[galleryIndex].aiAnalysis.waterDepth}</strong></span>}
                  {mediaItems[galleryIndex].aiAnalysis.authenticityScore!==undefined&&<span className="text-white/70">Authenticity: <strong className="text-white">{mediaItems[galleryIndex].aiAnalysis.authenticityScore}%</strong></span>}
                </div>
              </div>
            )}
          </div>
        )}
        </>
      })()}

      {/* CONFIRMATION MODAL */}
      {confirmModal&&(
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-[10000]">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-sm p-5 space-y-4">
            <h3 className="font-bold text-sm">{confirmModal.title}</h3>
            <p className="text-xs text-gray-600 dark:text-gray-300">{confirmModal.message}</p>
            {(confirmModal.type==='warning'||confirmModal.type==='danger')&&!confirmModal.title.includes('Suspend')&&<textarea className="w-full px-3 py-2 text-xs bg-gray-100 dark:bg-gray-800 rounded-lg min-h-[60px] border-none" placeholder={t('admin.confirm.justification',lang)} value={justification} onChange={e=>setJustification(e.target.value)}/>}
            {confirmModal.title.includes('Suspend')&&(
              <div className="space-y-2">
                <div>
                  <label className="text-xs font-semibold text-gray-600 dark:text-gray-300 block mb-1">{t('admin.suspend.reasonLabel',lang)}</label>
                  <textarea className="w-full px-3 py-2 text-xs bg-gray-100 dark:bg-gray-800 rounded-lg min-h-[60px] border border-gray-200 dark:border-gray-700" placeholder={t('admin.suspend.reasonPlaceholder',lang)} value={suspendForm.reason} onChange={e=>setSuspendForm(f=>({...f,reason:e.target.value}))} required/>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 dark:text-gray-300 block mb-1">{t('admin.suspend.durationLabel',lang)}</label>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {[{label:t('admin.suspend.1day',lang),days:1},{label:t('admin.suspend.3days',lang),days:3},{label:t('admin.suspend.1week',lang),days:7},{label:t('admin.suspend.1month',lang),days:30},{label:t('admin.suspend.indefiniteBtn',lang),days:0}].map(({label,days})=>(
                      <button key={label} type="button" onClick={()=>{if(days===0){setSuspendForm(f=>({...f,until:''}))}else{const d=new Date();d.setDate(d.getDate()+days);setSuspendForm(f=>({...f,until:d.toISOString().slice(0,10)}))}}} className="text-[10px] px-2 py-1 rounded-md bg-orange-50 dark:bg-orange-950/30 text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-800 hover:bg-orange-100 dark:hover:bg-orange-900/40 transition-colors">{label}</button>
                    ))}
                  </div>
                  <input type="date" min={new Date().toISOString().slice(0,10)} className="w-full px-3 py-2 text-xs bg-gray-100 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700" value={suspendForm.until} onChange={e=>setSuspendForm(f=>({...f,until:e.target.value}))}/>
                  {suspendForm.until&&<p className="text-[10px] text-aegis-600 dark:text-aegis-400 mt-1">{t('admin.suspend.suspendedUntil',lang)}: {new Date(suspendForm.until).toLocaleDateString('en-GB',{dateStyle:'long'})}</p>}
                  {!suspendForm.until&&<p className="text-[10px] text-gray-500 dark:text-gray-300 mt-1">{t('admin.suspend.indefinite',lang)}</p>}
                </div>
              </div>
            )}
            {(confirmModal.title.includes('Deploy')||confirmModal.title.includes('Recall'))&&<div><label className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t('admin.deploy.reasonLabel',lang)}</label><textarea className="w-full mt-1 px-3 py-2 text-xs bg-gray-100 dark:bg-gray-800 rounded-lg min-h-[60px] border border-gray-200 dark:border-gray-700" placeholder={t('admin.deploy.reasonPlaceholder',lang)} value={deployReason} onChange={e=>setDeployReason(e.target.value)} required/></div>}
            <div className="flex gap-3">
              <button onClick={()=>{setConfirmModal(null);setJustification('');setDeployReason('');setSuspendForm({until:'',reason:''})}} className="flex-1 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 rounded-xl py-2.5 text-sm font-semibold">{t('general.cancel',lang)}</button>
              <button onClick={()=>{if((confirmModal.title.includes('Deploy')||confirmModal.title.includes('Recall'))&&!deployReason.trim()){return}if(confirmModal.title.includes('Suspend')&&!suspendForm.reason.trim()){return}confirmModal.action();setConfirmModal(null);setJustification('');setDeployReason('');setSuspendForm({until:'',reason:''})}} disabled={((confirmModal.title.includes('Deploy')||confirmModal.title.includes('Recall'))&&!deployReason.trim())||(confirmModal.title.includes('Suspend')&&!suspendForm.reason.trim())} className={`flex-1 text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed ${confirmModal.type==='danger'?'bg-red-600 hover:bg-red-700':confirmModal.type==='warning'?'bg-aegis-600 hover:bg-aegis-700':'bg-aegis-600 hover:bg-aegis-700'}`}>{t('general.confirm',lang)}</button>
            </div>
          </div>
        </div>
      )}

      {/* FLOATING AI CHATBOT */}
      {showChatbot && (
        <div className="fixed bottom-20 right-4 z-[70] w-[380px] max-w-[calc(100vw-2rem)] animate-fade-in">
          <Chatbot
            onClose={() => setShowChatbot(false)}
            lang={lang}
            anchor="right"
            adminMode
            authToken={getToken()}
            citizenName={user?.displayName}
          />
        </div>
      )}
      <button onClick={() => setShowChatbot(v => !v)} title="AEGIS Command AI"
        className={`fixed bottom-4 right-4 z-[70] w-14 h-14 rounded-2xl shadow-xl flex items-center justify-center transition-all duration-300 hover:scale-110 ${
          showChatbot
            ? 'bg-gray-800 dark:bg-gray-200 text-white dark:text-gray-900 rotate-0'
            : 'bg-gradient-to-br from-indigo-600 to-purple-600 text-white shadow-indigo-500/30 animate-bounce-slow'
        }`}>
        {showChatbot ? <X className="w-6 h-6" /> : <MessageSquare className="w-6 h-6" />}
        {!showChatbot && <span className="absolute -top-1 -right-1 w-4 h-4 bg-green-500 rounded-full border-2 border-white dark:border-gray-900 animate-pulse" />}
      </button>

      {/* Keyboard Shortcuts Overlay */}
      <KeyboardShortcutsOverlay open={showShortcuts} onClose={() => setShowShortcuts(false)} />

      {/* Toasts */}
      <div className="fixed top-16 right-4 z-50 space-y-2.5" role="status" aria-live="polite">
        {notifications.map(n=>{
          const cfg = n.type==='success'?{bg:'bg-emerald-600',icon:'check'}:n.type==='warning'?{bg:'bg-amber-500',icon:'warn'}:n.type==='error'?{bg:'bg-red-600',icon:'err'}:{bg:'bg-blue-600',icon:'info'}
          return (
            <div key={n.id} role="alert" className={`flex items-start gap-2.5 px-4 py-3 rounded-xl text-sm text-white shadow-xl backdrop-blur-sm animate-fade-in max-w-[calc(100vw-2rem)] sm:max-w-sm border border-white/10 ${cfg.bg}`}>
              <span className="mt-0.5 flex-shrink-0">
                {cfg.icon==='check'&&<CheckCircle className="w-4 h-4" />}
                {cfg.icon==='warn'&&<AlertTriangle className="w-4 h-4" />}
                {cfg.icon==='err'&&<XCircle className="w-4 h-4" />}
                {cfg.icon==='info'&&<Info className="w-4 h-4" />}
              </span>
              <span className="flex-1 leading-snug">{n.message}</span>
              <button onClick={()=>dismissNotification(n.id)} className="flex-shrink-0 mt-0.5 opacity-70 hover:opacity-100 transition-opacity" aria-label="Dismiss">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )
        })}
      </div>
    </AdminLayout>
  )
}

//MAP VIEW ? Live Operations Map with 2D Leaflet + 3D Deck.gl toggle

function MapView({ filtered, loc, filterSeverity, setFilterSeverity, filterStatus, setFilterStatus, socket, user, setSelReport, activeLocation, setActiveLocation, availableLocations }: {
  filtered: any[]; loc: any; filterSeverity: string; setFilterSeverity: (v: string) => void; filterStatus: string; setFilterStatus: (v: string) => void; socket: any; user: any; setSelReport: (r: any) => void;
  activeLocation: string; setActiveLocation: (key: string) => void; availableLocations: { key: string; name: string }[]
}) {
  const lang = useLanguage()
  const [showFloodPredictions, setShowFloodPredictions] = useState(true)
  const [showEvacuationRoutes, setShowEvacuationRoutes] = useState(false)
  const [mapMode, setMapMode] = useState<'2d' | '3d'>('2d')
  const [showLeftPanel, setShowLeftPanel] = useState(true)
  const [showRightPanel, setShowRightPanel] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const mapContainerRef = useRef<HTMLDivElement>(null)

  const handleLayerChange = useCallback((layerId: string, enabled: boolean) => {
    if (layerId.startsWith('prediction_')) {
      setShowFloodPredictions(enabled)
    } else if (layerId === 'evacuation') {
      setShowEvacuationRoutes(enabled)
    }
  }, [])

  const toggleFullscreen = useCallback(() => {
    if (!mapContainerRef.current) return
    if (!document.fullscreenElement) {
      mapContainerRef.current.requestFullscreen?.().then(() => setIsFullscreen(true)).catch(() => {})
    } else {
      document.exitFullscreen?.().then(() => setIsFullscreen(false)).catch(() => {})
    }
  }, [])

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  return (
    <div ref={mapContainerRef} className={`animate-fade-in bg-white dark:bg-gray-900 overflow-hidden shadow-sm ${isFullscreen ? 'w-screen h-screen' : 'rounded-xl border border-gray-200 dark:border-gray-800'}`}>
      {/* Professional glassmorphism header toolbar */}
      <div className={`p-3 border-b border-gray-200/80 dark:border-gray-700/60 bg-gradient-to-r from-gray-50/80 via-white/80 to-gray-50/80 dark:from-gray-900/90 dark:via-gray-800/50 dark:to-gray-900/90 backdrop-blur-sm flex items-center justify-between flex-wrap gap-2 ${isFullscreen ? 'relative z-[1200]' : ''}`}>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="relative">
              <Map className="w-5 h-5 text-blue-600"/>
              <div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-green-500 rounded-full animate-pulse"/>
            </div>
            <div>
              <h2 className="font-bold text-sm leading-tight text-gray-900 dark:text-white">{t('admin.mapView.title',lang)}</h2>
              <p className="text-[9px] text-gray-500 dark:text-gray-300 font-medium">{t('admin.mapView.subtitle',lang)}</p>
            </div>
          </div>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          {/* Panel Toggles ? glassmorphism pill */}
          <div className="flex bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm rounded-lg p-0.5 ring-1 ring-gray-200/60 dark:ring-gray-700/40 shadow-sm">
            <button onClick={()=>setShowLeftPanel(!showLeftPanel)} className={`px-2.5 py-1.5 text-[10px] font-bold rounded-md transition-all ${showLeftPanel?'bg-blue-600 text-white shadow-md':'text-gray-700 dark:text-gray-200 hover:text-gray-900 dark:hover:text-white'}`} title="Toggle Intelligence Panel">
              <span className="flex items-center gap-1"><Brain className="w-3 h-3"/> {t('admin.mapView.intel',lang)}</span>
            </button>
            <button onClick={()=>setShowRightPanel(!showRightPanel)} className={`px-2.5 py-1.5 text-[10px] font-bold rounded-md transition-all ${showRightPanel?'bg-blue-600 text-white shadow-md':'text-gray-700 dark:text-gray-200 hover:text-gray-900 dark:hover:text-white'}`} title="Toggle Layer Controls">
              <span className="flex items-center gap-1"><Layers className="w-3 h-3"/> {t('admin.mapView.layers',lang)}</span>
            </button>
          </div>
          {/* Region Selector -- Advanced LocationDropdown */}
          <LocationDropdown compact />
          {/* 2D / 3D Toggle ? enhanced */}
          <div className="flex bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm rounded-lg p-0.5 ring-1 ring-gray-200/60 dark:ring-gray-700/40 shadow-sm">
            <button
              onClick={() => setMapMode('2d')}
              className={`px-3 py-1.5 text-[10px] font-bold rounded-md transition-all ${
                mapMode === '2d'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-gray-500 dark:text-gray-300 hover:text-gray-700 dark:hover:text-gray-300 dark:text-gray-300'
              }`}
            >
              2D
            </button>
            <button
              onClick={() => setMapMode('3d')}
              className={`px-3 py-1.5 text-[10px] font-bold rounded-md transition-all ${
                mapMode === '3d'
                  ? 'bg-purple-600 text-white shadow-md'
                  : 'text-gray-500 dark:text-gray-300 hover:text-gray-700 dark:hover:text-gray-300 dark:text-gray-300'
              }`}
            >
              3D
            </button>
          </div>
          {/* Filters ? styled */}
          <select value={filterSeverity} onChange={e=>setFilterSeverity(e.target.value)} className="text-xs bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm px-2 py-1.5 rounded-lg ring-1 ring-gray-200/60 dark:ring-gray-700/40 shadow-sm"><option value="all">All Severity</option><option value="High">High</option><option value="Medium">Medium</option><option value="Low">Low</option></select>
          <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)} className="text-xs bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm px-2 py-1.5 rounded-lg ring-1 ring-gray-200/60 dark:ring-gray-700/40 shadow-sm"><option value="all">All Status</option><option value="Urgent">Urgent</option><option value="Verified">Verified</option></select>
          {/* Fullscreen Toggle */}
          <button onClick={toggleFullscreen} className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm ring-1 ring-gray-200/60 dark:ring-gray-700/40 shadow-sm text-gray-500 dark:text-gray-300 hover:text-gray-700 dark:hover:text-gray-300 dark:text-gray-300 transition-all" title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}>
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5"/> : <Maximize2 className="w-3.5 h-3.5"/>}
          </button>
        </div>
      </div>
      <div className={`relative ${isFullscreen ? 'h-[calc(100vh-56px)]' : 'h-[calc(100vh-220px)]'}`}>

        {/* MAP fills 100% */}
        {mapMode === '2d' ? (
          <Suspense fallback={<div className="h-64 animate-pulse bg-gray-200 dark:bg-gray-800 rounded" />}>
          <LiveMap
            reports={filtered}
            center={loc.center}
            zoom={loc.zoom}
            height="100%"
            showFloodPredictions={showFloodPredictions}
            showEvacuationRoutes={showEvacuationRoutes}
            onReportClick={setSelReport}
          />
          </Suspense>
        ) : (
          <Suspense fallback={<div className="w-full h-full bg-gray-900 flex items-center justify-center"><div className="text-gray-400 dark:text-gray-300 text-sm animate-pulse">Loading 3D Engine...</div></div>}>
            <Map3DView
              reports={filtered}
              center={loc.center}
              zoom={loc.zoom}
              height="100%"
              showFloodPredictions={showFloodPredictions}
              showEvacuationRoutes={showEvacuationRoutes}
              onReportClick={setSelReport}
            />
          </Suspense>
        )}

        {/* LEFT HUD: Intel + River + Distress */}
        {showLeftPanel && (
          <div className="absolute top-3 left-3 z-[900] flex flex-col gap-2 w-[calc(50vw-1.5rem)] sm:w-[260px] max-h-[calc(100%-1.5rem)] overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent pointer-events-auto">
            <IntelligenceDashboard socket={socket} collapsed={true} />
            <RiverLevelPanel socket={socket} />
            <DistressPanel socket={socket} operatorId={user?.id || ''} operatorName={user?.displayName || 'Operator'} />
          </div>
        )}

        {/* RIGHT HUD: Flood Layers + Prediction */}
        {showRightPanel && (
          <div className="absolute top-3 right-3 z-[900] flex flex-col gap-2 w-[calc(50vw-1.5rem)] sm:w-[240px] max-h-[calc(100%-1.5rem)] overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent pointer-events-auto">
            <FloodLayerControl onLayerChange={handleLayerChange} />
            <FloodPredictionTimeline onTimeChange={(h, extents) => {
              setShowFloodPredictions(h > 0)
            }} />
          </div>
        )}
      </div>
    </div>
  )
}
//ADMIN COMMUNITY SECTION ? Live Chat + Posts Feed with sub-tabs + moderation
//AdminCommunitySection replaced by AdminCommunityHub component

