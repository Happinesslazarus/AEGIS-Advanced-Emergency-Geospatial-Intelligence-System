/* AdminPage.tsx — Operator dashboard with reports, alerts, analytics, and messaging. */

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  Shield, AlertTriangle, CheckCircle, Clock, Users, Activity, TrendingUp,
  FileText, Bell, BarChart3, Map, X, Sun, Moon, Search, LogOut, Send,
  Eye, Flag, Siren, Brain, History, Printer, Download, Filter, ChevronDown,
  Calendar, MapPin, Layers, RefreshCw, User, Settings, ThumbsUp, ThumbsDown,
  Flame, Droplets, Building2, ShieldAlert, HeartPulse, Radiation, ChevronRight,
  Camera, Truck, Anchor, Navigation, Zap, Package, Edit2, Ban, CheckCircle2, Trash2, Key, MessageSquare, Waves, Maximize2, Minimize2,
  Archive, XCircle, ChevronLeft, ZoomIn, Share2, ExternalLink, Globe, Hash, CircleDot
} from 'lucide-react'
import { io, Socket } from 'socket.io-client'
import { useReports } from '../contexts/ReportsContext'
import { useAlerts } from '../contexts/AlertsContext'
import { useTheme } from '../contexts/ThemeContext'
import { useLocation } from '../contexts/LocationContext'
import { LOCATIONS } from '../contexts/LocationContext'
import { getSession, logout } from '../utils/auth'
import { exportReportsCSV, exportReportJSON as exportReportsJSON } from '../utils/exportData'
import { apiLogActivity, apiCreateAlert, apiGetAuditLog, apiAuditLog, apiGetPredictions, apiSendPreAlert, apiGetDeployments, apiDeployResources, apiRecallResources, apiRunPrediction, apiGetHeatmapData, apiGetUsers, apiUpdateUser, apiSuspendUser, apiActivateUser, apiResetUserPassword, apiDeleteUser, apiGetCommandCenterAnalytics, apiBulkUpdateReportStatus, apiUpdateProfile } from '../utils/api'
import { HISTORICAL_EVENTS, SEASONAL_TRENDS } from '../data/historical'
import DisasterMap from '../components/shared/DisasterMap'
import ReportCard from '../components/shared/ReportCard'
import LoginPage from '../components/admin/LoginPage'
import AnalyticsDashboard from '../components/admin/AnalyticsDashboard'
import AITransparencyDashboard from '../components/admin/AITransparencyDashboard'
import AdminMessaging from '../components/admin/AdminMessaging'
import CommunityChat from '../components/citizen/CommunityChat'
import CommunityChatRoom from '../components/citizen/CommunityChatRoom'
import Chatbot from '../components/citizen/Chatbot'
import IntelligenceDashboard from '../components/shared/IntelligenceDashboard'
import RiverLevelPanel from '../components/shared/RiverLevelPanel'
import FloodLayerControl from '../components/shared/FloodLayerControl'
import FloodPredictionTimeline from '../components/shared/FloodPredictionTimeline'
import LiveMap from '../components/shared/LiveMap'
import { lazy, Suspense } from 'react'
const Map3DView = lazy(() => import('../components/shared/Map3DView'))
import DistressPanel from '../components/admin/DistressPanel'
import SystemHealthPanel from '../components/admin/SystemHealthPanel'
import ClimateRiskDashboard from '../components/shared/ClimateRiskDashboard'
import LanguageSelector from '../components/shared/LanguageSelector'
import IncidentFilterPanel from '../components/shared/IncidentFilterPanel'
import type { Report, Operator } from '../types'
import { t } from '../utils/i18n'
import { useLanguage } from '../hooks/useLanguage'
import { useIncidents } from '../contexts/IncidentContext'

const SEV_COLORS: Record<string, string> = { High: 'bg-red-500', Medium: 'bg-amber-400', Low: 'bg-blue-400' }
const STA_COLORS: Record<string, string> = { Urgent: 'bg-red-600', Unverified: 'bg-gray-400', Verified: 'bg-green-500', Flagged: 'bg-amber-500', Resolved: 'bg-gray-300', Archived: 'bg-slate-500', False_Report: 'bg-rose-700' }
const CATEGORY_ICONS: Record<string, any> = { natural_disaster: Droplets, infrastructure: Building2, public_safety: ShieldAlert, community_safety: Users, environmental: Flame, medical: HeartPulse }

type View = 'dashboard'|'reports'|'map'|'analytics'|'ai_models'|'history'|'audit'|'alert_send'|'resources'|'predictions'|'users'|'messaging'|'community'|'system_health'

export default function AdminPage(): JSX.Element {
  const lang = useLanguage()
  const { reports, loading, verifyReport, flagReport, markUrgent, resolveReport, archiveReport, markFalseReport, refreshReports } = useReports()
  const { alerts, notifications, pushNotification, dismissNotification, refreshAlerts } = useAlerts()
  const { location: loc, activeLocation, setActiveLocation, availableLocations } = useLocation()
  const { dark, toggle } = useTheme()
  const { selectedTypes } = useIncidents()

  const [user, setUser] = useState<Operator|null>(()=>getSession())
  const [view, setView] = useState<View>('dashboard')
  const [searchTerm, setSearchTerm] = useState('')
  const [selReport, setSelReport] = useState<Report|null>(null)
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [galleryIndex, setGalleryIndex] = useState(0)
  const [alertForm, setAlertForm] = useState({ title:'', message:'', severity:'warning', location:'' })
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
  const [alertChannels, setAlertChannels] = useState<{web:boolean,telegram:boolean,email:boolean,sms:boolean,whatsapp:boolean}>({web:true,telegram:false,email:false,sms:false,whatsapp:false})
  const [profileEditing, setProfileEditing] = useState(false)
  const [profileForm, setProfileForm] = useState({displayName:'',email:'',phone:'',department:''})
  const [predictions, setPredictions] = useState<any[]>([])
  const [deployments, setDeployments] = useState<any[]>([])
  const [predictionArea, setPredictionArea] = useState('City Centre')
  const [predictionRunning, setPredictionRunning] = useState(false)
  const [predictionResult, setPredictionResult] = useState<any | null>(null)
  const [heatmapData, setHeatmapData] = useState<any[]>([])
  const [users, setUsers] = useState<any[]>([])
  const [selectedUser, setSelectedUser] = useState<any | null>(null)
  const [editUserForm, setEditUserForm] = useState({ role: '', department: '', phone: '', displayName: '' })
  const [suspendForm, setSuspendForm] = useState({ until: '', reason: '' })
  const [communityUnread, setCommunityUnread] = useState(0)
  const [showChatbot, setShowChatbot] = useState(false)
  // History section state (top-level to satisfy React hooks rules)
  const [histSearch, setHistSearch] = useState('')
  const [histSort, setHistSort] = useState<'date-desc'|'date-asc'|'severity'|'affected'>('date-desc')
  const [histFilter, setHistFilter] = useState<'all'|'High'|'Medium'|'Low'>('all')
  const [histType, setHistType] = useState<'all'|'Flood'|'Storm'>('all')
  // Audit section state
  const [auditSearch, setAuditSearch] = useState('')
  const [auditTypeFilter, setAuditTypeFilter] = useState('all')
  const [auditSort, setAuditSort] = useState<'newest'|'oldest'>('newest')
  // User management sorting
  const [userSortField, setUserSortField] = useState<'name'|'role'|'department'|'status'|'lastLogin'>('name')
  const [userSortDir, setUserSortDir] = useState<'asc'|'desc'>('asc')
  const [userRoleFilter, setUserRoleFilter] = useState<'all'|'admin'|'operator'|'viewer'>('all')
  const [userStatusFilter, setUserStatusFilter] = useState<'all'|'active'|'suspended'|'inactive'>('all')
  // Recent reports sorting on dashboard
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
  const notifSocketRef = useRef<Socket | null>(null)
  const [activityShowAll, setActivityShowAll] = useState(false)
  const [bulkProgress, setBulkProgress] = useState<{ current: number; total: number } | null>(null)

  const predictionAreaOptions = useMemo(() => {
    const map = new globalThis.Map<string, { area: string; lat: number; lng: number; regionId: string }>()
    Object.entries(LOCATIONS).forEach(([regionKey, cfg]) => {
      ;(cfg.floodZones || []).forEach((zone: any) => {
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

  // Lightweight socket for receiving community chat notifications (global broadcast)
  useEffect(() => {
    const token = localStorage.getItem('aegis-token')
    if (!token || !user) return

    const s = io('http://localhost:3001', {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 2000,
    })
    notifSocketRef.current = s

    s.on('community:chat:notification', (data: any) => {
      if (!data) return
      if (data.senderId && data.senderId === user.id) return
      setCommunityUnread(prev => prev + 1)
    })

    s.on('report:new', () => {
      loadCommandCenter()
      refreshReports?.()
    })

    s.on('report:updated', (update: any) => {
      loadCommandCenter()
      // Also update selReport if it's currently open and matches
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
    }
  }, [user?.id, loadCommandCenter])

  useEffect(() => {
    if (!predictionAreaOptions.length) return
    if (!predictionAreaOptions.some((x) => x.area === predictionArea)) {
      setPredictionArea(predictionAreaOptions[0].area)
    }
  }, [predictionAreaOptions, predictionArea])

  // Clear community badge when viewing community
  useEffect(() => {
    if (view === 'community') {
      setCommunityUnread(0)
    }
  }, [view])

  // Load audit log
  useEffect(()=>{
    if(user) apiGetAuditLog({limit:'50'}).then(d=>{if(d&&d.length>0)setAuditLog(d);else setAuditLog([])}).catch(()=>setAuditLog([]))
  },[user])

  useEffect(() => {
    if (!user || view !== 'dashboard') return
    loadCommandCenter()
    const timer = setInterval(() => loadCommandCenter(), 30000)
    return () => clearInterval(timer)
  }, [user, view, loadCommandCenter])

  // Load predictions and deployments from real API (deduplicated by area)
  useEffect(()=>{
    if(user){
      apiGetPredictions().then((raw: any[]) => {
        // Deduplicate by area name — keep highest probability per area
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

  // Load users for user management view
  useEffect(()=>{
    if(user && view === 'users'){
      apiGetUsers().then(d=>setUsers(d.users||[])).catch((err: any)=>{
        const msg = err?.response?.data?.error || err?.message || 'Failed to load users'
        pushNotification(msg,'error')
        console.error('[AdminPage] Failed to load users:', msg)
      })
    }
  },[user, view])

  // Smart filter parser — must be declared before filtered useMemo
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
    // Apply smart filter first if present
    if(smartFilter.trim()){arr=parseSmartFilter(smartFilter,arr)}
    // Then apply regular filters
    if(searchTerm){const s=searchTerm.toLowerCase();arr=arr.filter(r=>r.type?.toLowerCase().includes(s)||r.location?.toLowerCase().includes(s)||r.description?.toLowerCase().includes(s)||r.reportNumber?.toLowerCase().includes(s)||r.status?.toLowerCase().includes(s))}
    if(filterSeverity!=='all') arr=arr.filter(r=>r.severity===filterSeverity)
    if(filterStatus!=='all') arr=arr.filter(r=>r.status===filterStatus)
    if(filterType!=='all') arr=arr.filter(r=>r.incidentCategory===filterType)
    // Filter by selected incident types from IncidentFilterPanel
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
    avgConf: reports.length>0?Math.round(reports.reduce((s,r)=>s+(r.confidence||0),0)/reports.length):0,
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
    if (value === 'Archived') return 'Archived'
    if (value === 'False_Report') return 'False Report'
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
  const doArchive=(id:string)=>askConfirm('Archive Report','Archive this report? It will be moved to archived status and preserved for audit history.','warning',async()=>{await doAction('Archived report','archive',id,archiveReport);pushNotification('Report archived successfully','success');setSelReport(null)})
  const doFalseReport=(id:string)=>askConfirm('Mark as False Report','Flag this report as a false/hoax report? This action will be logged in the audit trail.','danger',async()=>{await doAction('Marked as false report','false_report',id,markFalseReport);pushNotification('Report marked as false report','warning');setSelReport(null)})

  // Bulk actions
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
      pushNotification(err?.message || `Bulk ${status.toLowerCase()} failed`, 'error')
    } finally {
      setBulkProgress(null)
    }
  }
  const doBulkVerify=()=>askConfirm('Bulk Verify',`Verify ${selectedReportIds.size} selected reports?`,'success',async()=>{const ids=Array.from(selectedReportIds);await runBulkAction(ids,'Verified',`Verified ${ids.length} reports`,'success')})
  const doBulkFlag=()=>askConfirm('Bulk Flag',`Flag ${selectedReportIds.size} selected reports?`,'warning',async()=>{const ids=Array.from(selectedReportIds);await runBulkAction(ids,'Flagged',`Flagged ${ids.length} reports`,'warning')})
  const doBulkUrgent=()=>askConfirm('Bulk Mark Urgent',`Mark ${selectedReportIds.size} selected reports as URGENT?`,'danger',async()=>{const ids=Array.from(selectedReportIds);await runBulkAction(ids,'Urgent',`Marked ${ids.length} reports as urgent`,'error')})
  const doBulkResolve=()=>askConfirm('Bulk Resolve',`Resolve ${selectedReportIds.size} selected reports?`,'info',async()=>{const ids=Array.from(selectedReportIds);await runBulkAction(ids,'Resolved',`Resolved ${ids.length} reports`,'success')})
  const doBulkArchive=()=>askConfirm('Bulk Archive',`Archive ${selectedReportIds.size} selected reports?`,'warning',async()=>{const ids=Array.from(selectedReportIds);await runBulkAction(ids,'Archived',`Archived ${ids.length} reports`,'success')})
  const doBulkFalseReport=()=>askConfirm('Bulk Mark False',`Mark ${selectedReportIds.size} selected reports as false reports?`,'danger',async()=>{const ids=Array.from(selectedReportIds);await runBulkAction(ids,'False_Report',`Marked ${ids.length} reports as false`,'warning')})


  const toggleSelection=(id:string)=>{setSelectedReportIds(prev=>{const next=new Set(prev);if(next.has(id)){next.delete(id)}else{next.add(id)};return next})}
  const toggleSelectAll=()=>{if(selectedReportIds.size===filtered.length){setSelectedReportIds(new Set())}else{setSelectedReportIds(new Set(filtered.map(r=>r.id)))}}

  const sendAlert=async()=>{
    if(!alertForm.title||!alertForm.message)return
    const channels=Object.entries(alertChannels).filter(([,v])=>v).map(([k])=>k)
    if(channels.length===0)return
    try{
      const response:any=await apiCreateAlert({title:alertForm.title,message:alertForm.message,severity:alertForm.severity,locationText:alertForm.location,channels})
      await refreshAlerts()
      apiAuditLog({operator_name:user?.displayName,action:`Sent alert: ${alertForm.title} via ${channels.join(', ')}`,action_type:'alert_send',target_type:'alert'}).catch(()=>{})
      setAuditLog(prev=>[{id:Date.now(),operator_name:user?.displayName,action:`Sent alert: ${alertForm.title} — ${channels.join(', ')}`,action_type:'alert_send',created_at:new Date().toISOString()},...prev])
      const delivered=response?.delivery?.sent??0
      const attempted=response?.delivery?.attempted??0
      pushNotification(`Alert sent via ${channels.join(', ')} (${delivered}/${attempted} delivered)`,'success')
      setAlertForm({title:'',message:'',severity:'warning',location:''})
      setView('dashboard')
    }catch(err:any){
      pushNotification(err?.message||'Failed to send alert','error')
    }
  }

  const handlePrint=()=>{const w=window.open('','','width=800,height=600');if(!w){pushNotification('Please allow popups to print reports','warning');return}w.document.write('<html><head><title>AEGIS Report</title><style>body{font-family:Arial;padding:20px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:8px;text-align:left;font-size:12px}th{background:#1a4480;color:white}.header{text-align:center;margin-bottom:20px}</style></head><body>');w.document.write(`<div class="header"><h1>AEGIS Emergency Report</h1><p>Generated: ${new Date().toLocaleString()} by ${user?.displayName}</p><p>${filtered.length} reports</p></div>`);w.document.write('<table><tr><th>ID</th><th>Type</th><th>Severity</th><th>Status</th><th>Location</th><th>AI%</th><th>Time</th></tr>');filtered.forEach(r=>{w.document.write(`<tr><td>${r.reportNumber||''}</td><td>${r.type||''}</td><td>${r.severity}</td><td>${r.status}</td><td>${r.location||''}</td><td>${r.confidence||0}%</td><td>${new Date(r.timestamp).toLocaleString()}</td></tr>`)});w.document.write('</table><p style="margin-top:20px;font-size:10px;color:#666">AEGIS Emergency Response System — OFFICIAL USE ONLY</p></body></html>');w.document.close();w.focus();w.print()}

  const printSingleReport=(r:Report)=>{const w=window.open('','',`width=800,height=600`);if(!w){pushNotification('Please allow popups to print this report','warning');return}const ai:any=r.aiAnalysis||{};const panicLvl=ai.panicLevel||ai.panic_level||'Moderate';const fakePrb=ai.fakeProbability??ai.fake_probability??0;const photoV=ai.photoVerified||ai.photo_verified;const wDepth=ai.estimatedWaterDepth||ai.water_depth||'N/A';const sources=(ai.crossReferenced||[]).join(', ')||ai.sources||'N/A';w.document.write(`<html><head><title>AEGIS Report ${r.reportNumber}</title><style>body{font-family:Arial,sans-serif;padding:30px;max-width:750px;margin:0 auto}h1{color:#1a4480;border-bottom:3px solid #1a4480;padding-bottom:8px}table{width:100%;border-collapse:collapse;margin:15px 0}th,td{border:1px solid #ddd;padding:10px;text-align:left;font-size:13px}th{background:#f5f5f5;font-weight:600;width:35%}.header{display:flex;justify-content:space-between;align-items:flex-start}.meta{text-align:right;font-size:12px;color:#666}.severity-high{color:#dc2626;font-weight:bold}.severity-medium{color:#d97706}.severity-low{color:#2563eb}.section{margin-top:20px}.section h2{font-size:16px;color:#333;border-bottom:1px solid #eee;padding-bottom:5px}.footer{margin-top:30px;text-align:center;font-size:10px;color:#999;border-top:1px solid #eee;padding-top:10px}</style></head><body>`);w.document.write(`<div style="font-size:11px;color:#666">${new Date().toLocaleString()}<span style="float:right">AEGIS Report ${r.reportNumber}</span></div>`);w.document.write(`<div class="header"><h1>AEGIS Emergency Report</h1><div class="meta">Report ID: ${r.reportNumber}<br>Generated: ${new Date().toLocaleString()}</div></div>`);w.document.write(`<table><tr><th>Type</th><td>${r.type||r.incidentCategory||'Emergency Incident'}</td></tr><tr><th>Location</th><td>${r.location||''}</td></tr><tr><th>Severity</th><td class="severity-${(r.severity||'').toLowerCase()}">${r.severity}</td></tr><tr><th>Status</th><td>${r.status}</td></tr><tr><th>Time</th><td>${r.displayTime||new Date(r.timestamp).toLocaleString()}</td></tr><tr><th>Reporter</th><td>${r.reporter||'Anonymous Citizen'}</td></tr><tr><th>Trapped Persons</th><td>${r.trappedPersons||'no'}</td></tr><tr><th>Media</th><td>${r.hasMedia?'Yes'+(r.mediaType?' ('+r.mediaType+')':' (undefined)'):'No'}</td></tr><tr><th>AI Confidence</th><td>${r.confidence?r.confidence+'%':'Pending'}</td></tr></table>`);w.document.write(`<div class="section"><h2>Description</h2><p style="font-size:13px;line-height:1.6">${r.description||'No description provided.'}</p></div>`);w.document.write(`<div class="section"><h2>AI Analysis</h2><table><tr><th>Panic Level</th><td>${panicLvl}</td></tr><tr><th>Fake Probability</th><td>${fakePrb}%</td></tr><tr><th>Photo Verified</th><td>${photoV?'Yes':'Pending'}</td></tr><tr><th>Water Depth</th><td>${wDepth}</td></tr><tr><th>Sources</th><td>${sources}</td></tr></table></div>`);w.document.write(`<div class="section"><h2>AI Reasoning</h2><p style="font-size:13px;line-height:1.6">${ai.reasoning||'Report analysed using NLP sentiment analysis (score: '+(ai.sentimentScore||0.7).toFixed(2)+') and cross-referenced with Environment Agency flood warnings. Location matches active flood zone. Multiple corroborating reports within 500m radius. Confidence level: '+(r.confidence||75)+'%.'}</p></div>`);w.document.write(`<div class="section"><h2>Recommended Actions</h2><ul style="font-size:13px;line-height:1.8">${r.severity==='High'?'<li>Immediate deployment of emergency services</li><li>Evacuate affected area within 500m radius</li><li>Activate flood barriers</li><li>Issue public alert via all channels</li>':r.severity==='Medium'?'<li>Monitor area closely for escalation</li><li>Pre-position resources nearby</li><li>Issue advisory to local residents</li>':'<li>Continue monitoring</li><li>Log for historical analysis</li>'}</ul></div>`);w.document.write(`<div class="section"><h2>Metadata</h2><table><tr><th>GPS Coordinates</th><td>${r.coordinates?r.coordinates.join(', '):'N/A'}</td></tr><tr><th>Reporter Type</th><td>Anonymous Citizen</td></tr><tr><th>Submission</th><td>AEGIS Citizen Portal</td></tr><tr><th>Generated</th><td>${new Date().toISOString()}</td></tr></table></div>`);w.document.write(`<div class="footer">AEGIS Emergency Response System — Printed by ${user?.displayName||'System Administrator'} — OFFICIAL USE ONLY<br>This document may contain sensitive emergency data. Handle accordingly.</div>`);w.document.write(`</body></html>`);w.document.close();w.focus();w.print()}

  const handleShareReport = async (r: Report): Promise<void> => {
    const url = `${window.location.origin}/report/${r.id}`
    const title = `AEGIS Report ${r.reportNumber || ''}`.trim()
    const text = `${r.type || r.incidentCategory || 'Emergency report'} at ${r.location || 'Unknown location'}`

    try {
      if (navigator.share) {
        await navigator.share({ title, text, url })
        pushNotification('Share dialog opened','success')
        return
      }

      await navigator.clipboard.writeText(url)
      const mailto = `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(`${text}\n\n${url}`)}`
      window.open(mailto, '_blank')
      pushNotification('Share draft opened and link copied','success')
    } catch {
      try {
        await navigator.clipboard.writeText(url)
        pushNotification('Link copied to clipboard','success')
      } catch {
        pushNotification('Unable to share this report on this browser','error')
      }
    }
  }

  const handleLogout=()=>{logout();setUser(null)}

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

  if(!user) return <LoginPage onLogin={u=>setUser(u)}/>

  const NAV: {id:View;label:string;icon:any}[] = [
    {id:'dashboard',label:t('admin.dashboard', lang),icon:BarChart3},{id:'reports',label:t('admin.allReports', lang),icon:FileText},{id:'map',label:t('admin.liveMap', lang),icon:Map},
    {id:'analytics',label:t('admin.analytics', lang),icon:Activity},{id:'ai_models',label:t('admin.models', lang),icon:Brain},{id:'resources',label:t('admin.resources', lang),icon:Navigation},
    ...(user.role === 'admin' ? [{id:'users' as View,label:t('admin.users', lang),icon:Users}] : []),
    {id:'messaging' as View,label:t('admin.messages', lang),icon:MessageSquare},
    {id:'community' as View,label:t('admin.community', lang),icon:Users},
    {id:'history',label:t('admin.history', lang),icon:History},{id:'audit',label:t('admin.audit', lang),icon:Clock},{id:'alert_send',label:t('admin.sendAlert', lang),icon:Bell},
    {id:'system_health' as View,label:t('admin.systemHealth', lang),icon:Activity},
  ]

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      {/* Top bar */}
      <nav className="bg-gray-900 text-white sticky top-0 z-40 shadow-lg">
        <div className="max-w-[1400px] mx-auto px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/" className="flex items-center gap-2 hover:opacity-80"><Shield className="w-6 h-6 text-aegis-400"/><span className="font-bold text-sm">AEGIS <span className="text-aegis-400">OPS</span></span></Link>
            <span className="text-[10px] text-gray-500 hidden md:inline">{t('admin.operatorDashboard', lang)}</span>
            <Link to="/citizen" className="text-[10px] bg-gray-800 hover:bg-gray-700 px-2.5 py-1 rounded-md border border-gray-700">← {t('admin.citizenPage', lang)}</Link>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden sm:flex items-center gap-1 text-[10px] text-green-400 bg-green-900/30 px-2 py-1 rounded-full"><span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse"/> {t('admin.online', lang)}</span>
            <button onClick={()=>setShowProfile(!showProfile)} className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded-lg text-xs transition-colors">
              {user.avatarUrl?<img src={user.avatarUrl} alt="" className="w-6 h-6 rounded-full object-cover border-2 border-aegis-400"/>:<div className="w-6 h-6 rounded-full bg-aegis-600 flex items-center justify-center text-white text-[10px] font-bold">{user.displayName?.charAt(0)||'A'}</div>}
              <span className="truncate max-w-[120px] hidden sm:inline">{user.displayName}</span><ChevronDown className="w-3 h-3"/>
            </button>
            <LanguageSelector darkNav className="hidden sm:flex" />
            <button onClick={toggle} className="p-2 hover:bg-gray-700 rounded-lg transition-colors">{dark?<Sun className="w-4 h-4"/>:<Moon className="w-4 h-4"/>}</button>
            <button onClick={()=>setView('alert_send')} className="hidden sm:flex items-center gap-1.5 bg-red-600 hover:bg-red-700 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"><AlertTriangle className="w-3.5 h-3.5"/> {t('admin.sendAlert', lang)}</button>
            <button onClick={handleLogout} className="bg-gray-800 hover:bg-red-700 p-2 rounded-lg transition-colors" title={t('auth.logout', lang)}><LogOut className="w-4 h-4"/></button>
          </div>
        </div>
      </nav>

      {/* Profile dropdown with edit */}
      {showProfile&&(
        <div className="fixed top-14 right-4 bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 w-72 z-50 p-4">
          <div className="flex items-center gap-3 mb-3">
            {user.avatarUrl?<img src={user.avatarUrl} alt="" className="w-12 h-12 rounded-full object-cover border-2 border-aegis-400"/>:<div className="w-12 h-12 rounded-full bg-aegis-600 flex items-center justify-center text-white font-bold">{user.displayName?.charAt(0)}</div>}
            <div className="flex-1 min-w-0"><p className="font-bold text-sm truncate">{user.displayName}</p><p className="text-[10px] text-gray-500 truncate">{user.email}</p><p className="text-[10px] text-aegis-600">{user.department||user.role}</p></div>
          </div>
          {profileEditing ? (
            <div className="space-y-2 pt-2 border-t border-gray-100 dark:border-gray-800">
              <input className="w-full px-2.5 py-1.5 text-xs bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700" placeholder={t('citizen.auth.displayName', lang)} value={profileForm.displayName} onChange={e=>setProfileForm(f=>({...f,displayName:e.target.value}))}/>
              <input className="w-full px-2.5 py-1.5 text-xs bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700" placeholder="Email" value={profileForm.email} onChange={e=>setProfileForm(f=>({...f,email:e.target.value}))}/>
              <input className="w-full px-2.5 py-1.5 text-xs bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700" placeholder="Phone" value={profileForm.phone} onChange={e=>setProfileForm(f=>({...f,phone:e.target.value}))}/>
              <div className="flex gap-2">
                <button onClick={()=>setProfileEditing(false)} className="flex-1 text-xs text-gray-500 hover:text-gray-700 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800">{t('general.cancel', lang)}</button>
                <button onClick={()=>{apiUpdateProfile(user!.id,profileForm).then(()=>{pushNotification(t('admin.profileUpdated', lang),'success');setProfileEditing(false);apiAuditLog({operator_name:user?.displayName,action:'Updated profile',action_type:'profile_edit',target_type:'operator',target_id:user?.id}).catch(()=>{})}).catch(()=>pushNotification('Failed to update profile','error'))}} className="flex-1 text-xs text-white py-1.5 rounded-lg bg-aegis-600 hover:bg-aegis-700">{t('admin.save', lang)}</button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2 pt-2 border-t border-gray-100 dark:border-gray-800">
              <button onClick={()=>{setProfileForm({displayName:user.displayName||'',email:user.email||'',phone:user.phone||'',department:user.department||''});setProfileEditing(true)}} className="flex-1 text-xs text-aegis-600 hover:text-aegis-700 py-1.5 rounded-lg bg-aegis-50 dark:bg-aegis-950/20 font-medium">{t('admin.editProfile', lang)}</button>
              <button onClick={()=>setShowProfile(false)} className="flex-1 text-xs text-gray-500 hover:text-gray-700 py-1.5 rounded-lg bg-gray-50 dark:bg-gray-800">{t('general.close', lang)}</button>
            </div>
          )}
        </div>
      )}

      {/* Sub-nav */}
      <div className="bg-gray-800 dark:bg-gray-900/80 text-white overflow-x-auto border-b border-gray-700">
        <div className="max-w-[1400px] mx-auto px-4 flex gap-0.5">
          {NAV.map(n=>(
            <button key={n.id} onClick={()=>setView(n.id)} className={`relative px-3.5 py-2.5 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap border-b-2 transition-all ${view===n.id?'border-aegis-400 text-aegis-300':'border-transparent text-gray-400 hover:text-white'}`}>
              <n.icon className="w-3.5 h-3.5"/> {n.label}
              {n.id === 'community' && communityUnread > 0 && (
                <span className="ml-1 bg-red-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">{communityUnread > 9 ? '9+' : communityUnread}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <main className="max-w-[1440px] mx-auto px-4 py-5 space-y-5">
        {/* ═══ DASHBOARD — Command Center ═══ */}
        {view==='dashboard'&&(
          <div className="space-y-6 animate-fade-in">
            {/* ── Header Row ── */}
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <h1 className="text-xl font-extrabold tracking-tight flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse"/>
                  Command Center
                </h1>
                <p className="text-xs text-gray-500 mt-0.5">
                  Real-time situational awareness &mdash; {new Date().toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-gray-400">{commandCenter?.generatedAt ? `Updated ${new Date(commandCenter.generatedAt).toLocaleTimeString()}` : ''}</span>
                <button onClick={() => exportCommandCenter('csv')} disabled={!commandCenter} className="text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-3 py-1.5 rounded-lg flex items-center gap-1.5 hover:shadow-md transition-all disabled:opacity-40"><Download className="w-3.5 h-3.5"/> CSV</button>
                <button onClick={() => exportCommandCenter('json')} disabled={!commandCenter} className="text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-3 py-1.5 rounded-lg flex items-center gap-1.5 hover:shadow-md transition-all disabled:opacity-40"><Download className="w-3.5 h-3.5"/> JSON</button>
                <button onClick={()=>{refreshReports?.();loadCommandCenter()}} className="text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-3 py-1.5 rounded-lg flex items-center gap-1.5 hover:shadow-md transition-all"><RefreshCw className="w-3.5 h-3.5"/> Refresh</button>
              </div>
            </div>

            {/* ── Hero Stat Cards — glassmorphism ── */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5">
              {([
                {l:t('admin.stats.total',lang),v:stats.total,g:'from-slate-500/10 to-slate-500/5 dark:from-slate-400/10 dark:to-slate-400/5',ring:'ring-slate-200 dark:ring-slate-700',c:'text-slate-900 dark:text-white',i:FileText,ic:'text-slate-400'},
                {l:t('admin.stats.urgent',lang),v:stats.urgent,g:'from-red-500/10 to-red-500/5 dark:from-red-500/15 dark:to-red-500/5',ring:'ring-red-200 dark:ring-red-800',c:'text-red-600 dark:text-red-400',i:Siren,ic:'text-red-400',pulse:stats.urgent>0},
                {l:t('admin.stats.unverified',lang),v:stats.unverified,g:'from-amber-500/10 to-amber-500/5 dark:from-amber-500/15 dark:to-amber-500/5',ring:'ring-amber-200 dark:ring-amber-800',c:'text-amber-600 dark:text-amber-400',i:Clock,ic:'text-amber-400'},
                {l:t('admin.stats.verified',lang),v:stats.verified,g:'from-emerald-500/10 to-emerald-500/5 dark:from-emerald-500/15 dark:to-emerald-500/5',ring:'ring-emerald-200 dark:ring-emerald-800',c:'text-emerald-600 dark:text-emerald-400',i:CheckCircle,ic:'text-emerald-400'},
                {l:t('admin.stats.flagged',lang),v:stats.flagged,g:'from-orange-500/10 to-orange-500/5 dark:from-orange-500/15 dark:to-orange-500/5',ring:'ring-orange-200 dark:ring-orange-800',c:'text-orange-600 dark:text-orange-400',i:Flag,ic:'text-orange-400'},
                {l:t('admin.stats.resolved',lang),v:stats.resolved,g:'from-gray-500/10 to-gray-500/5 dark:from-gray-400/10 dark:to-gray-400/5',ring:'ring-gray-200 dark:ring-gray-700',c:'text-gray-500 dark:text-gray-400',i:CheckCircle2,ic:'text-gray-400'},
                {l:t('admin.stats.avgAi',lang),v:`${stats.avgConf}%`,g:'from-violet-500/10 to-violet-500/5 dark:from-violet-500/15 dark:to-violet-500/5',ring:'ring-violet-200 dark:ring-violet-800',c:'text-violet-600 dark:text-violet-400',i:Brain,ic:'text-violet-400'},
                {l:t('admin.stats.trapped',lang),v:stats.trapped,g:'from-fuchsia-500/10 to-fuchsia-500/5 dark:from-fuchsia-500/15 dark:to-fuchsia-500/5',ring:'ring-fuchsia-200 dark:ring-fuchsia-800',c:'text-fuchsia-600 dark:text-fuchsia-400',i:AlertTriangle,ic:'text-fuchsia-400'},
              ] as const).map((s,i)=>(
                <div key={i} className={`relative overflow-hidden bg-gradient-to-br ${s.g} backdrop-blur-sm rounded-2xl p-3.5 ring-1 ${s.ring} hover:shadow-lg hover:scale-[1.02] transition-all duration-200 cursor-default group`}>
                  <div className="flex items-center justify-between mb-2">
                    <s.i className={`w-4 h-4 ${s.ic} group-hover:scale-110 transition-transform`}/>
                    {'pulse' in s && s.pulse && <span className="w-2 h-2 rounded-full bg-red-500 animate-ping"/>}
                  </div>
                  <p className={`text-2xl font-black tabular-nums tracking-tight ${s.c}`}>{s.v}</p>
                  <p className="text-[9px] text-gray-500 dark:text-gray-400 font-bold uppercase tracking-wider mt-0.5">{s.l}</p>
                </div>
              ))}
            </div>

            {/* ── Row 2 — Trend Indicators + AI Recommendations ── */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Today vs Yesterday */}
              <div className="bg-white dark:bg-gray-900/80 backdrop-blur rounded-2xl ring-1 ring-gray-200 dark:ring-gray-800 p-4 hover:shadow-lg transition-shadow">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Daily Trend</span>
                  <TrendingUp className={`w-4 h-4 ${(commandCenter?.comparative?.dayDeltaPct || 0) >= 0 ? 'text-emerald-500' : 'text-red-500'}`}/>
                </div>
                {(() => {
                  const yesterday = commandCenter?.comparative?.yesterday ?? 0
                  const today = commandCenter?.comparative?.today ?? 0
                  const delta = commandCenter?.comparative?.dayDeltaPct ?? 0
                  const isNew = yesterday === 0 && today > 0
                  return (
                    <>
                      <p className={`text-3xl font-black tabular-nums ${delta >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                        {isNew ? 'New' : `${delta > 0 ? '+' : ''}${delta}%`}
                      </p>
                      <div className="flex items-center gap-2 mt-2">
                        <div className="flex-1 h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full transition-all ${delta >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`}
                            style={{width: `${Math.min(Math.abs(delta), 100)}%`}}/>
                        </div>
                      </div>
                      <p className="text-[10px] text-gray-400 mt-2 tabular-nums">{today} today &middot; {yesterday} yesterday</p>
                    </>
                  )
                })()}
              </div>

              {/* Weekly Momentum */}
              <div className="bg-white dark:bg-gray-900/80 backdrop-blur rounded-2xl ring-1 ring-gray-200 dark:ring-gray-800 p-4 hover:shadow-lg transition-shadow">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Weekly Momentum</span>
                  <Activity className={`w-4 h-4 ${(commandCenter?.comparative?.weekDeltaPct || 0) >= 0 ? 'text-emerald-500' : 'text-red-500'}`}/>
                </div>
                {(() => {
                  const prevWeek = commandCenter?.comparative?.previousWeek ?? 0
                  const thisWeek = commandCenter?.comparative?.thisWeek ?? 0
                  const delta = commandCenter?.comparative?.weekDeltaPct ?? 0
                  const isNew = prevWeek === 0 && thisWeek > 0
                  return (
                    <>
                      <p className={`text-3xl font-black tabular-nums ${delta >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                        {isNew ? 'New' : `${delta > 0 ? '+' : ''}${delta}%`}
                      </p>
                      <div className="flex items-center gap-2 mt-2">
                        <div className="flex-1 h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full transition-all ${delta >= 0 ? 'bg-blue-500' : 'bg-red-500'}`}
                            style={{width: `${Math.min(Math.abs(delta), 100)}%`}}/>
                        </div>
                      </div>
                      <p className="text-[10px] text-gray-400 mt-2 tabular-nums">{thisWeek} this week &middot; {prevWeek} previous</p>
                    </>
                  )
                })()}
              </div>

              {/* Severity Breakdown — Radial Indicator */}
              <div className="bg-white dark:bg-gray-900/80 backdrop-blur rounded-2xl ring-1 ring-gray-200 dark:ring-gray-800 p-4 hover:shadow-lg transition-shadow">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">{t('admin.severityDistribution', lang)}</span>
                <div className="flex items-center gap-4 mt-3">
                  {/* Donut Chart via SVG */}
                  <div className="relative w-16 h-16 flex-shrink-0">
                    <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                      <circle cx="18" cy="18" r="15.9" fill="none" stroke="currentColor" strokeWidth="3" className="text-gray-100 dark:text-gray-800"/>
                      {stats.total > 0 && <>
                        <circle cx="18" cy="18" r="15.9" fill="none" stroke="#ef4444" strokeWidth="3"
                          strokeDasharray={`${(stats.high/stats.total)*100} ${100-(stats.high/stats.total)*100}`} strokeDashoffset="0"/>
                        <circle cx="18" cy="18" r="15.9" fill="none" stroke="#f59e0b" strokeWidth="3"
                          strokeDasharray={`${(stats.medium/stats.total)*100} ${100-(stats.medium/stats.total)*100}`} strokeDashoffset={`${-(stats.high/stats.total)*100}`}/>
                        <circle cx="18" cy="18" r="15.9" fill="none" stroke="#3b82f6" strokeWidth="3"
                          strokeDasharray={`${(stats.low/stats.total)*100} ${100-(stats.low/stats.total)*100}`} strokeDashoffset={`${-((stats.high+stats.medium)/stats.total)*100}`}/>
                      </>}
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-xs font-black text-gray-700 dark:text-gray-200">{stats.total}</span>
                    </div>
                  </div>
                  <div className="space-y-1.5 flex-1">
                    {([{s:'High',n:stats.high,c:'bg-red-500'},{s:'Medium',n:stats.medium,c:'bg-amber-500'},{s:'Low',n:stats.low,c:'bg-blue-500'}] as const).map(v=>(
                      <div key={v.s} className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${v.c}`}/>
                        <span className="text-[10px] text-gray-600 dark:text-gray-400 flex-1">{severityLabel(v.s)}</span>
                        <span className="text-[10px] font-bold tabular-nums">{v.n}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Verification Rate — Gauge */}
              <div className="bg-white dark:bg-gray-900/80 backdrop-blur rounded-2xl ring-1 ring-gray-200 dark:ring-gray-800 p-4 hover:shadow-lg transition-shadow">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">{t('admin.verificationRate', lang)}</span>
                <div className="flex items-center gap-4 mt-3">
                  <div className="relative w-16 h-16 flex-shrink-0">
                    <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                      <circle cx="18" cy="18" r="15.9" fill="none" stroke="currentColor" strokeWidth="3" className="text-gray-100 dark:text-gray-800"/>
                      <circle cx="18" cy="18" r="15.9" fill="none" stroke="#10b981" strokeWidth="3" strokeLinecap="round"
                        strokeDasharray={`${stats.verifyRate} ${100-stats.verifyRate}`}/>
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-xs font-black text-emerald-600 dark:text-emerald-400">{stats.verifyRate}%</span>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-gray-600 dark:text-gray-400">Media attached</p>
                    <p className="text-sm font-bold tabular-nums">{stats.withMedia}<span className="text-gray-400 font-normal">/{stats.total}</span></p>
                    <p className="text-[10px] text-gray-400">Resolution rate</p>
                    <p className="text-sm font-bold tabular-nums">{stats.total > 0 ? Math.round((stats.resolved/stats.total)*100) : 0}%</p>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Row 3 — Main Content Grid ── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              {/* Recent Reports — Premium Card */}
              <div className="lg:col-span-2 bg-white dark:bg-gray-900/80 backdrop-blur rounded-2xl ring-1 ring-gray-200 dark:ring-gray-800 shadow-sm overflow-hidden">
                <div className="px-5 py-3.5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between flex-wrap gap-2 bg-gradient-to-r from-gray-50 to-white dark:from-gray-900 dark:to-gray-900/50">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-aegis-600 flex items-center justify-center"><FileText className="w-3.5 h-3.5 text-white"/></div>
                    <div><h2 className="font-bold text-sm">{t('reports.title', lang)}</h2><p className="text-[10px] text-gray-400">Latest incident reports</p></div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <select value={recentSort} onChange={e=>setRecentSort(e.target.value as any)} className="text-[10px] px-2 py-1 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg font-semibold">
                      <option value="newest">Newest</option>
                      <option value="oldest">Oldest</option>
                      <option value="severity">Severity</option>
                      <option value="ai-high">AI High→Low</option>
                      <option value="ai-low">AI Low→High</option>
                    </select>
                    <button onClick={()=>setView('reports')} className="text-[10px] font-semibold text-aegis-600 hover:text-aegis-700 bg-aegis-50 dark:bg-aegis-950/30 px-2.5 py-1 rounded-lg transition-colors">{t('reports.all', lang)} &rarr;</button>
                    <button onClick={()=>refreshReports?.()} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"><RefreshCw className="w-3.5 h-3.5 text-gray-400"/></button>
                  </div>
                </div>
                <div className="divide-y divide-gray-50 dark:divide-gray-800/50 max-h-[420px] overflow-y-auto">
                  {reports.length === 0 ? (
                    <div className="p-8 text-center">
                      <FileText className="w-10 h-10 text-gray-300 dark:text-gray-700 mx-auto mb-2"/>
                      <p className="text-sm text-gray-500">No reports yet</p>
                    </div>
                  ) : (()=>{
                    const sorted = [...reports].sort((a,b)=>{
                      if(recentSort==='newest') return new Date(b.timestamp).getTime()-new Date(a.timestamp).getTime()
                      if(recentSort==='oldest') return new Date(a.timestamp).getTime()-new Date(b.timestamp).getTime()
                      if(recentSort==='severity'){const o:{[k:string]:number}={High:3,Medium:2,Low:1};return(o[b.severity]||0)-(o[a.severity]||0)}
                      if(recentSort==='ai-high') return(b.confidence||0)-(a.confidence||0)
                      if(recentSort==='ai-low') return(a.confidence||0)-(b.confidence||0)
                      return 0
                    })
                    return sorted.slice(0,12).map((r,idx)=>(
                    <div key={r.id} className="px-5 py-3 hover:bg-gray-50/80 dark:hover:bg-gray-800/30 cursor-pointer flex items-center gap-3.5 transition-all group" onClick={()=>setSelReport(r)}>
                      <div className="relative flex-shrink-0">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-white text-[10px] font-bold shadow-sm ${r.status==='Urgent'?'bg-gradient-to-br from-red-500 to-red-600':r.status==='Verified'?'bg-gradient-to-br from-emerald-500 to-emerald-600':r.status==='Flagged'?'bg-gradient-to-br from-amber-500 to-amber-600':'bg-gradient-to-br from-gray-400 to-gray-500'}`}>
                          {r.status==='Urgent'?<Siren className="w-4 h-4"/>:r.status==='Verified'?<CheckCircle className="w-4 h-4"/>:r.status==='Flagged'?<Flag className="w-4 h-4"/>:<Clock className="w-4 h-4"/>}
                        </div>
                        {r.status==='Urgent'&&<span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-red-500 rounded-full animate-ping"/>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate group-hover:text-aegis-600 transition-colors">{r.type||r.incidentCategory}</p>
                        <p className="text-[10px] text-gray-500 truncate flex items-center gap-1"><MapPin className="w-3 h-3 flex-shrink-0"/>{r.location}</p>
                      </div>
                      <div className="text-right flex-shrink-0 space-y-1">
                        <span className={`inline-block text-[10px] px-2 py-0.5 rounded-md font-bold ${r.severity==='High'?'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300':r.severity==='Medium'?'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300':'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'}`}>{r.severity}</span>
                        <p className="text-[10px] text-gray-400 tabular-nums">{(r.confidence||0)}% AI</p>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-gray-300 group-hover:text-aegis-500 transition-colors flex-shrink-0"/>
                    </div>
                  ))})()}
                </div>
              </div>

              {/* Right Column — Stacked Cards */}
              <div className="space-y-4">
                {/* Active Alerts */}
                {alerts.length>0 && (
                  <div className="bg-gradient-to-br from-red-50 to-orange-50 dark:from-red-950/20 dark:to-orange-950/20 rounded-2xl ring-1 ring-red-200 dark:ring-red-800/50 p-4 shadow-sm">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-6 h-6 rounded-lg bg-red-500 flex items-center justify-center"><Bell className="w-3.5 h-3.5 text-white"/></div>
                      <span className="text-xs font-bold text-red-800 dark:text-red-300">{t('alerts.title', lang)}</span>
                      <span className="ml-auto text-[10px] bg-red-600 text-white px-2 py-0.5 rounded-full font-bold">{alerts.length}</span>
                    </div>
                    {alerts.slice(0,3).map(a=>(
                      <div key={a.id} className="mb-1.5 last:mb-0 bg-white/60 dark:bg-gray-900/40 backdrop-blur rounded-xl px-3 py-2 ring-1 ring-red-100 dark:ring-red-900/30">
                        <p className="text-xs font-semibold text-red-900 dark:text-red-200">{a.title}</p>
                        <p className="text-[10px] text-red-600/70 dark:text-red-400/70 mt-0.5">{new Date(a.timestamp || Date.now()).toLocaleTimeString()}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* AI Recommendations */}
                <div className="bg-gradient-to-br from-violet-50 to-purple-50 dark:from-violet-950/20 dark:to-purple-950/20 rounded-2xl ring-1 ring-violet-200 dark:ring-violet-800/50 p-4 shadow-sm">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center"><Brain className="w-3.5 h-3.5 text-white"/></div>
                    <span className="text-xs font-bold text-violet-800 dark:text-violet-300">AI Recommendations</span>
                  </div>
                  <div className="space-y-1.5">
                    {(commandCenter?.recommendations || []).slice(0, 4).map((item, idx) => (
                      <div key={idx} className={`text-[11px] rounded-xl px-3 py-2 ring-1 backdrop-blur ${item.priority === 'critical' ? 'bg-red-100/60 dark:bg-red-900/20 ring-red-200 dark:ring-red-800/40 text-red-800 dark:text-red-300' : item.priority === 'high' ? 'bg-amber-100/60 dark:bg-amber-900/20 ring-amber-200 dark:ring-amber-800/40 text-amber-800 dark:text-amber-300' : 'bg-blue-100/60 dark:bg-blue-900/20 ring-blue-200 dark:ring-blue-800/40 text-blue-800 dark:text-blue-300'}`}>
                        <div className="flex items-start gap-2">
                          <span className={`mt-0.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${item.priority==='critical'?'bg-red-500 animate-pulse':item.priority==='high'?'bg-amber-500':'bg-blue-500'}`}/>
                          {item.message}
                        </div>
                      </div>
                    ))}
                    {(!commandCenter?.recommendations || commandCenter.recommendations.length === 0) && (
                      <div className="text-center py-4">
                        <Brain className="w-8 h-8 text-violet-300 dark:text-violet-700 mx-auto mb-1"/>
                        <p className="text-[11px] text-violet-500/70">All systems nominal</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Quick Actions */}
                <div className="bg-white dark:bg-gray-900/80 backdrop-blur rounded-2xl ring-1 ring-gray-200 dark:ring-gray-800 p-4 shadow-sm">
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Quick Actions</span>
                  <div className="grid grid-cols-2 gap-2 mt-3">
                    <button onClick={()=>setView('alert_send')} className="flex items-center gap-2 text-xs font-semibold text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-950/50 px-3 py-2.5 rounded-xl ring-1 ring-red-200 dark:ring-red-800/40 transition-all hover:shadow-md">
                      <Bell className="w-4 h-4"/> Send Alert
                    </button>
                    <button onClick={()=>setView('reports')} className="flex items-center gap-2 text-xs font-semibold text-aegis-700 dark:text-aegis-300 bg-aegis-50 dark:bg-aegis-950/30 hover:bg-aegis-100 dark:hover:bg-aegis-950/50 px-3 py-2.5 rounded-xl ring-1 ring-aegis-200 dark:ring-aegis-800/40 transition-all hover:shadow-md">
                      <FileText className="w-4 h-4"/> All Reports
                    </button>
                    <button onClick={()=>setView('analytics')} className="flex items-center gap-2 text-xs font-semibold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/30 hover:bg-blue-100 dark:hover:bg-blue-950/50 px-3 py-2.5 rounded-xl ring-1 ring-blue-200 dark:ring-blue-800/40 transition-all hover:shadow-md">
                      <BarChart3 className="w-4 h-4"/> Analytics
                    </button>
                    <button onClick={()=>setView('map')} className="flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 hover:bg-emerald-100 dark:hover:bg-emerald-950/50 px-3 py-2.5 rounded-xl ring-1 ring-emerald-200 dark:ring-emerald-800/40 transition-all hover:shadow-md">
                      <Map className="w-4 h-4"/> Live Map
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Row 4 — Leaderboard + Activity Stream ── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* Officer Leaderboard */}
              <div className="bg-white dark:bg-gray-900/80 backdrop-blur rounded-2xl ring-1 ring-gray-200 dark:ring-gray-800 shadow-sm overflow-hidden">
                <div className="px-5 py-3.5 border-b border-gray-100 dark:border-gray-800 bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/10 dark:to-orange-950/10">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center"><Users className="w-3.5 h-3.5 text-white"/></div>
                    <div><h3 className="font-bold text-sm">Officer Leaderboard</h3><p className="text-[10px] text-gray-400">Last 7 days performance</p></div>
                  </div>
                </div>
                <div className="p-4 space-y-2">
                  {(commandCenter?.leaderboard || []).map((row, idx) => {
                    const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx+1}`
                    return (
                      <div key={`${row.operator}-${idx}`} className="flex items-center gap-3 bg-gray-50 dark:bg-gray-800/40 rounded-xl px-4 py-2.5 ring-1 ring-gray-100 dark:ring-gray-800 hover:ring-amber-300 dark:hover:ring-amber-700 transition-all group">
                        <span className="text-sm w-7 text-center flex-shrink-0">{medal}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold truncate group-hover:text-amber-600 transition-colors">{row.operator}</p>
                          <p className="text-[10px] text-gray-500 tabular-nums">{row.handled} handled &middot; {row.actions} actions</p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-xs font-black text-aegis-600 tabular-nums">{fmtMins(row.avgResponseMinutes)}</p>
                          <p className="text-[9px] text-gray-400">avg resp.</p>
                        </div>
                      </div>
                    )
                  })}
                  {(!commandCenter?.leaderboard || commandCenter.leaderboard.length === 0) && (
                    <div className="text-center py-8">
                      <Users className="w-10 h-10 text-gray-300 dark:text-gray-700 mx-auto mb-2"/>
                      <p className="text-xs text-gray-500">No leaderboard data yet</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">Actions taken by operators will appear here</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Live Activity Stream */}
              <div className="bg-white dark:bg-gray-900/80 backdrop-blur rounded-2xl ring-1 ring-gray-200 dark:ring-gray-800 shadow-sm overflow-hidden">
                <div className="px-5 py-3.5 border-b border-gray-100 dark:border-gray-800 bg-gradient-to-r from-cyan-50 to-blue-50 dark:from-cyan-950/10 dark:to-blue-950/10">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center"><Activity className="w-3.5 h-3.5 text-white"/></div>
                    <div><h3 className="font-bold text-sm">Live Activity Stream</h3><p className="text-[10px] text-gray-400">Real-time operator actions</p></div>
                    <span className="ml-auto flex items-center gap-1 text-[9px] text-green-500 font-bold"><span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"/>LIVE</span>
                  </div>
                </div>
                <div className="p-4 space-y-1.5 max-h-[340px] overflow-y-auto">
                  {(() => {
                    const allEntries = commandCenter?.activity || []
                    const visibleEntries = activityShowAll ? allEntries : allEntries.slice(0, 12)
                    if (allEntries.length === 0) return (
                      <div className="text-center py-8">
                        <Activity className="w-10 h-10 text-gray-300 dark:text-gray-700 mx-auto mb-2"/>
                        <p className="text-xs text-gray-500">No activity yet</p>
                        <p className="text-[10px] text-gray-400 mt-0.5">Operator actions will stream here in real-time</p>
                      </div>
                    )
                    return (
                      <>
                        {visibleEntries.map((entry, idx) => {
                          const mins=Math.floor((Date.now()-new Date(entry.created_at).getTime())/60000)
                          const timeAgo=mins<1?'just now':mins<60?`${mins}m ago`:mins<1440?`${Math.floor(mins/60)}h ago`:`${Math.floor(mins/1440)}d ago`
                          const iconBg = entry.action_type==='verify'?'from-emerald-500 to-green-500':entry.action_type==='flag'?'from-amber-500 to-orange-500':entry.action_type==='urgent'?'from-red-500 to-rose-500':entry.action_type==='resolve'?'from-gray-400 to-gray-500':entry.action_type==='alert_send'?'from-red-600 to-rose-600':'from-blue-500 to-cyan-500'
                          return (
                            <div key={`${entry.id || idx}`} className="flex items-center gap-3 py-2 px-3 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors group">
                              <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${iconBg} flex items-center justify-center text-white flex-shrink-0 shadow-sm`}>
                                {entry.action_type==='verify'?<CheckCircle className="w-3.5 h-3.5"/>:entry.action_type==='flag'?<Flag className="w-3.5 h-3.5"/>:entry.action_type==='urgent'?<Siren className="w-3.5 h-3.5"/>:<Activity className="w-3.5 h-3.5"/>}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium truncate">{entry.action}</p>
                                <p className="text-[10px] text-gray-400">{entry.operator_name || 'System'}</p>
                              </div>
                              <span className="text-[10px] text-gray-400 flex-shrink-0 tabular-nums">{timeAgo}</span>
                            </div>
                          )
                        })}
                        {allEntries.length > 12 && (
                          <button
                            onClick={() => setActivityShowAll(prev => !prev)}
                            className="w-full text-[10px] font-semibold text-cyan-600 hover:text-cyan-700 py-2 border-t border-gray-100 dark:border-gray-800 mt-1 transition-colors"
                          >
                            {activityShowAll ? `Show less ▲` : `Show ${allEntries.length - 12} more ▼`}
                          </button>
                        )}
                      </>
                    )
                  })()}
                </div>
              </div>
            </div>

            {/* ── Row 5 — Status Pipeline + Climate Risk ── */}
            <div className="bg-white dark:bg-gray-900/80 backdrop-blur rounded-2xl ring-1 ring-gray-200 dark:ring-gray-800 p-5 shadow-sm">
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Report Pipeline</span>
              <div className="flex items-center gap-2 mt-4">
                {([
                  {label:'Urgent',count:stats.urgent,color:'bg-red-500',pct:stats.total>0?(stats.urgent/stats.total)*100:0},
                  {label:'Unverified',count:stats.unverified,color:'bg-amber-400',pct:stats.total>0?(stats.unverified/stats.total)*100:0},
                  {label:'Verified',count:stats.verified,color:'bg-emerald-500',pct:stats.total>0?(stats.verified/stats.total)*100:0},
                  {label:'Flagged',count:stats.flagged,color:'bg-orange-500',pct:stats.total>0?(stats.flagged/stats.total)*100:0},
                  {label:'Resolved',count:stats.resolved,color:'bg-gray-400',pct:stats.total>0?(stats.resolved/stats.total)*100:0},
                ] as const).map((stage,i,arr)=>(
                  <React.Fragment key={stage.label}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] font-semibold text-gray-600 dark:text-gray-400">{stage.label}</span>
                        <span className="text-xs font-black tabular-nums">{stage.count}</span>
                      </div>
                      <div className="h-2.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${stage.color} transition-all duration-700`} style={{width:`${Math.max(stage.pct, stage.count > 0 ? 8 : 0)}%`}}/>
                      </div>
                      <p className="text-[9px] text-gray-400 mt-1 text-center tabular-nums">{Math.round(stage.pct)}%</p>
                    </div>
                    {i < arr.length - 1 && <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-700 flex-shrink-0 mt-1"/>}
                  </React.Fragment>
                ))}
              </div>
            </div>

            {/* Climate Risk Analytics */}
            <ClimateRiskDashboard />
          </div>
        )}

        {/* ═══ REPORTS — Advanced Incident Manager ═══ */}
        {view==='reports'&&(
          <div className="space-y-5 animate-fade-in">
            {/* ── Header Bar ── */}
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <h1 className="text-xl font-extrabold tracking-tight flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-aegis-600 flex items-center justify-center"><FileText className="w-3.5 h-3.5 text-white"/></div>
                  All Reports
                </h1>
                <p className="text-xs text-gray-500 mt-0.5">{filtered.length} of {reports.length} reports matching current filters</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={()=>{exportReportsCSV(reports);pushNotification(t('admin.csvExported', lang),'success')}} className="text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-3 py-1.5 rounded-lg flex items-center gap-1.5 hover:shadow-md transition-all"><Download className="w-3.5 h-3.5"/> CSV</button>
                <button onClick={()=>{exportReportsJSON(reports);pushNotification(t('admin.jsonExported', lang),'success')}} className="text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-3 py-1.5 rounded-lg flex items-center gap-1.5 hover:shadow-md transition-all"><Download className="w-3.5 h-3.5"/> JSON</button>
                <button onClick={handlePrint} className="text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-3 py-1.5 rounded-lg flex items-center gap-1.5 hover:shadow-md transition-all"><Printer className="w-3.5 h-3.5"/> {t('admin.print', lang)}</button>
                <button onClick={()=>refreshReports?.()} className="text-xs bg-aegis-600 hover:bg-aegis-700 text-white px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all shadow-sm"><RefreshCw className="w-3.5 h-3.5"/> Refresh</button>
              </div>
            </div>

            {/* ── Status Summary Pills ── */}
            <div className="flex items-center gap-2 flex-wrap">
              {([
                {label:'All',value:'all',count:reports.length,bg:'bg-gray-100 dark:bg-gray-800',tc:'text-gray-700 dark:text-gray-300',ring:'ring-gray-200 dark:ring-gray-700'},
                {label:'Urgent',value:'Urgent',count:stats.urgent,bg:'bg-red-50 dark:bg-red-950/20',tc:'text-red-700 dark:text-red-300',ring:'ring-red-200 dark:ring-red-800',dot:'bg-red-500'},
                {label:'Unverified',value:'Unverified',count:stats.unverified,bg:'bg-amber-50 dark:bg-amber-950/20',tc:'text-amber-700 dark:text-amber-300',ring:'ring-amber-200 dark:ring-amber-800',dot:'bg-amber-500'},
                {label:'Verified',value:'Verified',count:stats.verified,bg:'bg-emerald-50 dark:bg-emerald-950/20',tc:'text-emerald-700 dark:text-emerald-300',ring:'ring-emerald-200 dark:ring-emerald-800',dot:'bg-emerald-500'},
                {label:'Flagged',value:'Flagged',count:stats.flagged,bg:'bg-orange-50 dark:bg-orange-950/20',tc:'text-orange-700 dark:text-orange-300',ring:'ring-orange-200 dark:ring-orange-800',dot:'bg-orange-500'},
                {label:'Resolved',value:'Resolved',count:stats.resolved,bg:'bg-gray-50 dark:bg-gray-900/50',tc:'text-gray-600 dark:text-gray-400',ring:'ring-gray-200 dark:ring-gray-700',dot:'bg-gray-400'},
              ] as const).map(pill=>(
                <button key={pill.value} onClick={()=>setFilterStatus(pill.value)} className={`text-xs font-semibold px-3 py-1.5 rounded-full ring-1 flex items-center gap-1.5 transition-all ${filterStatus===pill.value ? `${pill.bg} ${pill.tc} ${pill.ring} shadow-sm scale-105` : 'bg-white dark:bg-gray-900 text-gray-500 ring-gray-200 dark:ring-gray-800 hover:ring-gray-300'}`}>
                  {'dot' in pill && pill.dot && <span className={`w-1.5 h-1.5 rounded-full ${pill.dot}`}/>}
                  {pill.label}
                  <span className="text-[10px] font-black tabular-nums opacity-70">{pill.count}</span>
                </button>
              ))}
            </div>

            {/* ── AI Smart Filter ── */}
            <div className="bg-gradient-to-r from-violet-500/5 via-purple-500/5 to-fuchsia-500/5 dark:from-violet-500/10 dark:via-purple-500/10 dark:to-fuchsia-500/10 rounded-2xl ring-1 ring-violet-200 dark:ring-violet-800/50 p-4 backdrop-blur">
              <div className="flex items-center gap-2 mb-2.5">
                <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center"><Brain className="w-3.5 h-3.5 text-white"/></div>
                <span className="text-xs font-bold text-violet-800 dark:text-violet-300">AI Smart Filter</span>
                <span className="text-[9px] text-violet-500/70 ml-1">Natural language search — type what you&apos;re looking for</span>
              </div>
              <div className="relative">
                <Search className="absolute left-3.5 top-2.5 w-4 h-4 text-violet-400"/>
                <input
                  className="w-full pl-10 pr-10 py-2.5 text-sm bg-white/80 dark:bg-gray-900/80 backdrop-blur rounded-xl ring-1 ring-violet-200 dark:ring-violet-800 focus:ring-2 focus:ring-violet-500 focus:outline-none placeholder-gray-400 transition-all"
                  placeholder='Try: "flooding reports from today with photos" or "urgent high severity not verified"'
                  value={smartFilter}
                  onChange={e=>setSmartFilter(e.target.value)}
                />
                {smartFilter && (
                  <button onClick={()=>setSmartFilter('')} className="absolute right-3 top-2.5 p-0.5 hover:bg-violet-100 dark:hover:bg-violet-900/30 rounded-md transition-colors">
                    <X className="w-4 h-4 text-violet-400"/>
                  </button>
                )}
              </div>
            </div>
            {/* -- Incident Type Filter Panel -- */}
            <div className="bg-white dark:bg-gray-900/80 backdrop-blur rounded-2xl ring-1 ring-gray-200 dark:ring-gray-800 shadow-sm overflow-hidden">
              <IncidentFilterPanel />
            </div>


            {/* ── Filter Toolbar ── */}
            <div className="bg-white dark:bg-gray-900/80 backdrop-blur rounded-2xl ring-1 ring-gray-200 dark:ring-gray-800 p-3 shadow-sm">
              <div className="flex flex-wrap items-center gap-2.5">
                <div className="relative flex-1 min-w-[220px]">
                  <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400"/>
                  <input className="w-full pl-10 pr-3 py-2 text-xs bg-gray-50 dark:bg-gray-800 rounded-xl ring-1 ring-gray-200 dark:ring-gray-700 focus:ring-2 focus:ring-aegis-500 focus:outline-none transition-all" placeholder={t('reports.search', lang)} value={searchTerm} onChange={e=>setSearchTerm(e.target.value)}/>
                </div>
                <div className="flex items-center gap-1.5">
                  <Filter className="w-3.5 h-3.5 text-gray-400"/>
                  <select value={filterSeverity} onChange={e=>setFilterSeverity(e.target.value)} className="text-xs bg-gray-50 dark:bg-gray-800 px-2.5 py-2 rounded-xl ring-1 ring-gray-200 dark:ring-gray-700 focus:ring-2 focus:ring-aegis-500 focus:outline-none cursor-pointer">
                    <option value="all">{t('admin.filters.severity.all', lang)}</option>
                    <option value="High">{t('admin.filters.severity.high', lang)}</option>
                    <option value="Medium">{t('admin.filters.severity.medium', lang)}</option>
                    <option value="Low">{t('admin.filters.severity.low', lang)}</option>
                  </select>
                  <select value={filterType} onChange={e=>setFilterType(e.target.value)} className="text-xs bg-gray-50 dark:bg-gray-800 px-2.5 py-2 rounded-xl ring-1 ring-gray-200 dark:ring-gray-700 focus:ring-2 focus:ring-aegis-500 focus:outline-none cursor-pointer">
                    <option value="all">{t('admin.filters.type.all', lang)}</option>
                    <option value="natural_disaster">{t('admin.filters.type.natural_disaster', lang)}</option>
                    <option value="infrastructure">{t('admin.filters.type.infrastructure', lang)}</option>
                    <option value="public_safety">{t('admin.filters.type.public_safety', lang)}</option>
                    <option value="community_safety">{t('admin.filters.type.community_safety', lang)}</option>
                    <option value="environmental">{t('admin.filters.type.environmental', lang)}</option>
                    <option value="medical">{t('admin.filters.type.medical', lang)}</option>
                  </select>
                </div>
                {(filterSeverity!=='all'||filterStatus!=='all'||filterType!=='all'||searchTerm||smartFilter)&&(
                  <button onClick={()=>{setFilterSeverity('all');setFilterStatus('all');setFilterType('all');setSearchTerm('');setSmartFilter('')}} className="text-[10px] font-semibold text-red-600 hover:text-red-700 bg-red-50 dark:bg-red-950/20 px-2.5 py-1.5 rounded-lg ring-1 ring-red-200 dark:ring-red-800 flex items-center gap-1 transition-all hover:shadow-sm">
                    <X className="w-3 h-3"/> Clear All
                  </button>
                )}
              </div>
            </div>

            {/* ── Select All + Count ── */}
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-3">
                <p className="text-xs text-gray-500 tabular-nums">
                  <span className="font-bold text-gray-900 dark:text-white">{filtered.length}</span> {t('admin.reportsFound', lang)}
                  {selectedReportIds.size > 0 && <span className="text-aegis-600 font-bold ml-2">({selectedReportIds.size} selected)</span>}
                </p>
              </div>
              {filtered.length > 0 && (
                <label className="flex items-center gap-2 text-xs cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={selectedReportIds.size === filtered.length && filtered.length > 0}
                    onChange={toggleSelectAll}
                    className="w-4 h-4 text-aegis-600 border-gray-300 rounded focus:ring-aegis-500"
                  />
                  <span className="font-semibold text-gray-600 dark:text-gray-400 group-hover:text-aegis-600 transition-colors">Select All</span>
                </label>
              )}
            </div>

            {/* ── Report Cards ── */}
            <div className="space-y-2.5">
              {filtered.length === 0 ? (
                <div className="bg-white dark:bg-gray-900/80 backdrop-blur rounded-2xl ring-1 ring-gray-200 dark:ring-gray-800 p-12 text-center">
                  <div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mx-auto mb-4">
                    <Search className="w-8 h-8 text-gray-300 dark:text-gray-600"/>
                  </div>
                  <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">No reports match your filters</h3>
                  <p className="text-xs text-gray-500 mb-4">Try adjusting your search criteria or clearing filters</p>
                  <button onClick={()=>{setFilterSeverity('all');setFilterStatus('all');setFilterType('all');setSearchTerm('');setSmartFilter('')}} className="text-xs font-semibold text-aegis-600 hover:text-aegis-700 bg-aegis-50 dark:bg-aegis-950/30 px-4 py-2 rounded-lg ring-1 ring-aegis-200 dark:ring-aegis-800 transition-all hover:shadow-md">
                    Clear All Filters
                  </button>
                </div>
              ) : filtered.map(r=>{
                const CatIcon = CATEGORY_ICONS[r.incidentCategory as string] || FileText
                const timeDiff = Math.floor((Date.now()-new Date(r.timestamp).getTime())/60000)
                const timeAgo = timeDiff < 1 ? 'just now' : timeDiff < 60 ? `${timeDiff}m ago` : timeDiff < 1440 ? `${Math.floor(timeDiff/60)}h ago` : `${Math.floor(timeDiff/1440)}d ago`
                return (
                <div key={r.id} className={`bg-white dark:bg-gray-900/80 backdrop-blur rounded-2xl ring-1 ${selectedReportIds.has(r.id) ? 'ring-aegis-400 dark:ring-aegis-600 bg-aegis-50/30 dark:bg-aegis-950/10' : 'ring-gray-200 dark:ring-gray-800'} shadow-sm hover:shadow-lg hover:ring-gray-300 dark:hover:ring-gray-700 transition-all duration-200 group overflow-hidden`}>
                  {/* Urgency accent bar */}
                  {r.status==='Urgent'&&<div className="h-0.5 bg-gradient-to-r from-red-500 via-red-400 to-orange-400"/>}

                  <div className="p-4 flex items-start gap-4">
                    {/* Checkbox */}
                    <div className="flex flex-col items-center gap-2 pt-0.5">
                      <input
                        type="checkbox"
                        checked={selectedReportIds.has(r.id)}
                        onChange={()=>toggleSelection(r.id)}
                        className="w-4 h-4 text-aegis-600 border-gray-300 rounded focus:ring-aegis-500 cursor-pointer"
                        onClick={(e)=>e.stopPropagation()}
                      />
                    </div>

                    {/* Status Icon */}
                    <div className="relative flex-shrink-0">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-sm ${r.status==='Urgent'?'bg-gradient-to-br from-red-500 to-red-600':r.status==='Verified'?'bg-gradient-to-br from-emerald-500 to-emerald-600':r.status==='Flagged'?'bg-gradient-to-br from-amber-500 to-amber-600':r.status==='Resolved'?'bg-gradient-to-br from-gray-400 to-gray-500':r.status==='Archived'?'bg-gradient-to-br from-slate-500 to-slate-600':r.status==='False_Report'?'bg-gradient-to-br from-rose-600 to-rose-700':'bg-gradient-to-br from-blue-400 to-blue-500'}`}>
                        {r.status==='Urgent'?<Siren className="w-5 h-5"/>:r.status==='Verified'?<CheckCircle className="w-5 h-5"/>:r.status==='Flagged'?<Flag className="w-5 h-5"/>:r.status==='Resolved'?<CheckCircle2 className="w-5 h-5"/>:r.status==='Archived'?<Archive className="w-5 h-5"/>:r.status==='False_Report'?<XCircle className="w-5 h-5"/>:<Clock className="w-5 h-5"/>}
                      </div>
                      {r.status==='Urgent'&&<span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-red-500 rounded-full animate-ping"/>}
                    </div>

                    {/* Content */}
                    <div className="min-w-0 flex-1 cursor-pointer" onClick={()=>setSelReport(r)}>
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <span className={`text-[10px] px-2 py-0.5 rounded-md font-bold ${r.severity==='High'?'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300':r.severity==='Medium'?'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300':'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'}`}>
                          {severityLabel(r.severity as 'High' | 'Medium' | 'Low')}
                        </span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-md font-bold ${r.status==='Urgent'?'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300':r.status==='Verified'?'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300':r.status==='Flagged'?'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300':r.status==='Resolved'?'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400':r.status==='Archived'?'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400':r.status==='False_Report'?'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400':'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'}`}>
                          {statusLabel(r.status)}
                        </span>
                        {(r.confidence||0)>0&&<span className="text-[10px] text-violet-600 dark:text-violet-400 flex items-center gap-0.5 font-semibold"><Brain className="w-3 h-3"/> {r.confidence}%</span>}
                        {r.hasMedia&&<span className="text-[10px] text-blue-500 flex items-center gap-0.5"><Camera className="w-3 h-3"/> Media</span>}
                        {r.trappedPersons==='yes'&&<span className="text-[10px] px-2 py-0.5 rounded-md bg-purple-600 text-white font-bold flex items-center gap-0.5"><AlertTriangle className="w-3 h-3"/> {t('admin.badge.vulnerablePerson', lang)}</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        <CatIcon className="w-4 h-4 text-gray-400 flex-shrink-0"/>
                        <p className="text-sm font-bold truncate group-hover:text-aegis-600 transition-colors">{r.type||r.incidentCategory}</p>
                      </div>
                      <div className="flex items-center gap-3 mt-1.5 text-[10px] text-gray-500">
                        <span className="flex items-center gap-1"><MapPin className="w-3 h-3 flex-shrink-0"/><span className="truncate max-w-[200px]">{r.location}</span></span>
                        <span className="flex items-center gap-1 tabular-nums"><Clock className="w-3 h-3"/>{timeAgo}</span>
                        <span className="font-mono text-gray-400">{r.reportNumber}</span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-1.5 flex-shrink-0 items-center opacity-60 group-hover:opacity-100 transition-opacity">
                      <button onClick={()=>setSelReport(r)} className="w-8 h-8 rounded-lg bg-aegis-50 dark:bg-aegis-950/30 hover:bg-aegis-100 dark:hover:bg-aegis-950/50 text-aegis-600 flex items-center justify-center transition-all hover:shadow-sm ring-1 ring-aegis-200 dark:ring-aegis-800/40" title={t('admin.actions.viewReportDetail', lang)}><Eye className="w-4 h-4"/></button>
                      {r.hasMedia&&<button onClick={()=>{setSelReport(r);setGalleryIndex(0);setGalleryOpen(true)}} className="w-8 h-8 rounded-lg bg-purple-50 dark:bg-purple-950/30 hover:bg-purple-100 dark:hover:bg-purple-950/50 text-purple-600 flex items-center justify-center transition-all hover:shadow-sm ring-1 ring-purple-200 dark:ring-purple-800/40 relative" title={t('admin.actions.openMedia', lang)}><Camera className="w-4 h-4"/>{(r.media?.length||0)>1&&<span className="absolute -top-1 -right-1 bg-purple-600 text-white text-[8px] font-bold w-3.5 h-3.5 rounded-full flex items-center justify-center">{r.media!.length}</span>}</button>}
                      <button onClick={()=>handleShareReport(r)} className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/30 hover:bg-blue-100 dark:hover:bg-blue-950/50 text-blue-600 flex items-center justify-center transition-all hover:shadow-sm ring-1 ring-blue-200 dark:ring-blue-800/40" title={t('admin.actions.shareReport', lang)}><Send className="w-4 h-4"/></button>
                      <button onClick={()=>printSingleReport(r)} className="w-8 h-8 rounded-lg bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 flex items-center justify-center transition-all hover:shadow-sm ring-1 ring-gray-200 dark:ring-gray-700" title={t('admin.actions.printReport', lang)}><Printer className="w-4 h-4"/></button>
                    </div>
                  </div>
                </div>
                )
              })}
            </div>

            {/* ── Floating Bulk Actions Bar ── */}
            {selectedReportIds.size > 0 && (
              <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 bg-gray-900/95 backdrop-blur-xl text-white rounded-2xl shadow-2xl px-5 py-3 flex items-center gap-3 ring-2 ring-aegis-500/50 z-50 animate-fade-in">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-aegis-600 flex items-center justify-center"><FileText className="w-4 h-4"/></div>
                  <div>
                    <p className="text-sm font-bold tabular-nums">{selectedReportIds.size} selected</p>
                    <p className="text-[9px] text-gray-400">
                      {bulkProgress ? `Processing ${bulkProgress.current}/${bulkProgress.total}...` : 'Bulk actions'}
                    </p>
                  </div>
                </div>
                <div className="w-px h-8 bg-gray-700" />
                <button onClick={doBulkVerify} className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all hover:shadow-lg hover:scale-105">
                  <CheckCircle className="w-4 h-4" /> Verify
                </button>
                <button onClick={doBulkFlag} className="px-3.5 py-2 bg-amber-600 hover:bg-amber-700 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all hover:shadow-lg hover:scale-105">
                  <Flag className="w-4 h-4" /> Flag
                </button>
                <button onClick={doBulkUrgent} className="px-3.5 py-2 bg-red-600 hover:bg-red-700 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all hover:shadow-lg hover:scale-105">
                  <Siren className="w-4 h-4" /> Urgent
                </button>
                <button onClick={doBulkResolve} className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all hover:shadow-lg hover:scale-105">
                  <CheckCircle2 className="w-4 h-4" /> Resolve
                </button>
                <button onClick={doBulkArchive} className="px-3.5 py-2 bg-slate-600 hover:bg-slate-700 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all hover:shadow-lg hover:scale-105">
                  <Archive className="w-4 h-4" /> Archive
                </button>
                <div className="w-px h-8 bg-gray-700" />
                <button onClick={()=>setSelectedReportIds(new Set())} className="w-8 h-8 hover:bg-gray-800 rounded-lg transition-all flex items-center justify-center" title="Clear selection">
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        )}

        {/* ═══ MAP ═══ */}
        {view==='map'&&(
          <MapView
            filtered={filtered}
            loc={loc}
            filterSeverity={filterSeverity}
            setFilterSeverity={setFilterSeverity}
            filterStatus={filterStatus}
            setFilterStatus={setFilterStatus}
            socket={notifSocketRef.current}
            user={user}
            setSelReport={setSelReport}
            activeLocation={activeLocation}
            setActiveLocation={setActiveLocation}
            availableLocations={availableLocations}
          />
        )}

        {/* ═══ ANALYTICS ═══ */}
        {view==='analytics'&&(
          <div className="space-y-5 animate-fade-in">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="font-bold text-lg flex items-center gap-2"><Activity className="w-5 h-5"/> {t('admin.analytics.dashboardTitle', lang)}</h2>
              <div className="flex gap-2">
                <button onClick={()=>{exportReportsCSV(reports);pushNotification(t('admin.csvExported',lang),'success')}} className="text-xs bg-aegis-600 text-white px-4 py-2 rounded-lg flex items-center gap-1"><Download className="w-3.5 h-3.5"/> {t('admin.analytics.exportCsv',lang)}</button>
                <button onClick={()=>{exportReportsJSON(reports);pushNotification(t('admin.jsonExported',lang),'success')}} className="text-xs bg-gray-600 text-white px-4 py-2 rounded-lg flex items-center gap-1"><Download className="w-3.5 h-3.5"/> {t('admin.analytics.exportJson',lang)}</button>
              </div>
            </div>
            <AnalyticsDashboard />
            {/* Activity Log */}
            <div className="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-800">
              <h3 className="text-sm font-bold mb-3 flex items-center gap-2"><Clock className="w-4 h-4 text-aegis-600"/> {t('admin.analytics.activityLog',lang)}</h3>
              <div className="divide-y divide-gray-100 dark:divide-gray-800 max-h-[400px] overflow-y-auto">
                {auditLog.length===0?<p className="py-4 text-center text-xs text-gray-500">{t('admin.analytics.noActivity',lang)}</p>:
                auditLog.slice(0,20).map((e:any,i:number)=>{
                  const mins=Math.floor((Date.now()-new Date(e.created_at).getTime())/60000)
                  const timeAgo=mins<1?'0m ago':mins<60?`${mins}m ago`:mins<1440?`${Math.floor(mins/60)}h ago`:`${Math.floor(mins/1440)}d ago`
                  const iconCls='w-4 h-4'
                  const getBg=()=>{const t=e.action_type||'';if(t==='verify')return'bg-green-500';if(t==='flag')return'bg-purple-500';if(t==='urgent')return'bg-red-500';if(t==='resolve')return'bg-gray-500';if(t==='alert_send')return'bg-red-600';if(t==='deploy')return'bg-teal-500';if(t==='recall')return'bg-amber-500';if(t.includes('login'))return'bg-gray-400';if(t.includes('export'))return'bg-blue-500';return'bg-blue-500'}
                  const getIcon=()=>{const t=e.action_type||'';if(t==='verify')return<CheckCircle className={iconCls}/>;if(t==='flag')return<Flag className={iconCls}/>;if(t==='urgent')return<AlertTriangle className={iconCls}/>;if(t==='alert_send')return<Bell className={iconCls}/>;if(t==='deploy')return<MapPin className={iconCls}/>;if(t==='recall')return<RefreshCw className={iconCls}/>;if(t.includes('export'))return<Download className={iconCls}/>;return<Activity className={iconCls}/>}
                  const reportId=e.target_id?e.target_id.slice(0,8):null
                  return(
                  <div key={e.id||i} className="py-2.5 flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white flex-shrink-0 ${getBg()}`}>{getIcon()}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium">
                        {e.action}
                        {reportId&&<span className="text-aegis-600 font-mono ml-1 cursor-pointer hover:underline" onClick={()=>{const r=reports.find(rp=>rp.id===e.target_id);if(r)setSelReport(r)}}>(RPT-{reportId})</span>}
                      </p>
                      <p className="text-[10px] text-gray-500">{e.operator_name||'System'} · {timeAgo}</p>
                    </div>
                  </div>
                )})}</div>
            </div>
          </div>
        )}

        {/* ═══ AI MODELS ═══ */}
        {view==='ai_models'&&<div className="animate-fade-in space-y-5">
          <h2 className="font-bold text-lg flex items-center gap-2 mb-4"><Brain className="w-5 h-5"/> {t('admin.ai.title',lang)}</h2>

          {/* Unified AI Flood Intelligence Dashboard */}
          <div className="bg-gradient-to-br from-white via-gray-50 to-white dark:from-gray-900 dark:via-gray-950 dark:to-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-xl overflow-hidden">
            {/* Header */}
            <div className="bg-gradient-to-r from-indigo-700 via-blue-700 to-cyan-700 dark:from-indigo-800 dark:via-blue-800 dark:to-cyan-800 px-6 py-5 relative overflow-hidden">
              <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMSIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjA1KSIvPjwvc3ZnPg==')] opacity-50" />
              <div className="relative z-10 flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-white/15 backdrop-blur-sm flex items-center justify-center border border-white/20">
                    <Zap className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h3 className="font-bold text-white text-lg">AI Flood Intelligence Engine</h3>
                    <p className="text-xs text-blue-200">Multi-source predictive analytics &middot; {loc.name || 'Global'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-white/80 bg-white/10 px-3 py-1.5 rounded-lg">{predictions.length} active prediction{predictions.length!==1?'s':''}</span>
                  <div className="flex items-center gap-2">
                    <div className={`w-3 h-3 rounded-full ${predictionRunning ? 'bg-yellow-400 animate-pulse' : 'bg-green-400 animate-pulse'}`} />
                    <span className="text-xs text-white font-medium">{predictionRunning ? 'Processing...' : 'Online'}</span>
                  </div>
                </div>
              </div>

              {/* Quick stats */}
              <div className="relative z-10 grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
                {[
                  { label: 'High Risk Areas', value: predictions.filter((p:any)=>{const prob=typeof p.probability==='number'?p.probability:parseFloat(String(p.probability))||0;return (prob<=1?prob:prob/100)>0.5}).length, color: 'text-red-300' },
                  { label: 'Avg Confidence', value: predictions.length>0?`${Math.round(predictions.reduce((s:number,p:any)=>{const c=typeof p.confidence==='number'?p.confidence:parseFloat(String(p.confidence))||0;return s+(c<=1?c*100:c)},0)/predictions.length)}%`:'--', color: 'text-cyan-300' },
                  { label: 'Heatmap Points', value: heatmapData.length, color: 'text-amber-300' },
                  { label: 'Data Sources', value: [...new Set(predictions.flatMap((p:any)=>Array.isArray(p.data_sources)?p.data_sources:[]))].length || 0, color: 'text-green-300' },
                ].map((s,i)=>(
                  <div key={i} className="bg-white/5 backdrop-blur-sm rounded-xl p-2.5 border border-white/10">
                    <p className="text-[10px] text-blue-200 uppercase tracking-wider font-semibold">{s.label}</p>
                    <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-5 space-y-5">
              {/* Live Predictions Feed */}
              <div>
                <h4 className="font-bold text-sm mb-3 flex items-center gap-2 text-gray-900 dark:text-white"><TrendingUp className="w-4 h-4 text-indigo-600"/> Live Prediction Feed</h4>
                {predictions.length === 0 ? (
                  <div className="text-center py-8 bg-gray-50 dark:bg-gray-800/30 rounded-xl border border-dashed border-gray-300 dark:border-gray-700">
                    <Waves className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-2"/>
                    <p className="text-sm text-gray-500">No active predictions. Model awaiting data from monitored rivers.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {predictions.map((pred:any,i:number)=>{
                      const prob = typeof pred.probability === 'number' ? pred.probability : parseFloat(String(pred.probability)) || 0
                      const conf = typeof pred.confidence === 'number' ? pred.confidence : parseFloat(String(pred.confidence)) || 0
                      const confDisplay = conf <= 1 ? Math.round(conf * 100) : Math.round(conf)
                      const probPct = prob <= 1 ? Math.round(prob * 100) : Math.round(prob)
                      const riskColor = probPct > 70 ? 'border-red-400 dark:border-red-700 bg-gradient-to-r from-red-50 to-red-25 dark:from-red-950/20 dark:to-red-950/5' : probPct > 40 ? 'border-amber-400 dark:border-amber-700 bg-gradient-to-r from-amber-50 to-amber-25 dark:from-amber-950/20 dark:to-amber-950/5' : 'border-blue-300 dark:border-blue-700 bg-gradient-to-r from-blue-50 to-blue-25 dark:from-blue-950/20 dark:to-blue-950/5'
                      const ttf = (typeof pred.time_to_flood === 'object' && pred.time_to_flood !== null) ? JSON.stringify(pred.time_to_flood) : String(pred.time_to_flood || 'N/A')
                      const pattern = (typeof pred.matched_pattern === 'object' && pred.matched_pattern !== null) ? JSON.stringify(pred.matched_pattern) : String(pred.matched_pattern || 'N/A')
                      return (
                      <div key={pred.id||i} className={`border-2 rounded-xl p-4 ${riskColor} transition-all hover:shadow-md`}>
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <div className="flex-1 min-w-[200px]">
                            <div className="flex items-center gap-2 flex-wrap mb-2">
                              <h4 className="font-bold text-sm text-gray-900 dark:text-white">{pred.area}</h4>
                              <span className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold text-white ${probPct>70?'bg-red-600':probPct>40?'bg-amber-600':'bg-blue-600'}`}>{probPct}%</span>
                              <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 flex items-center gap-1"><Clock className="w-3 h-3"/> {ttf}</span>
                              <span className="text-[10px] text-gray-500">Conf: {confDisplay}%</span>
                            </div>
                            <div className="flex items-center gap-4 mb-2">
                              <div className="flex-1 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                                <div className={`h-full rounded-full transition-all ${probPct>70?'bg-gradient-to-r from-red-500 to-red-600':probPct>40?'bg-gradient-to-r from-amber-400 to-amber-500':'bg-gradient-to-r from-blue-400 to-blue-500'}`} style={{width:`${probPct}%`}}/>
                              </div>
                            </div>
                            <p className="text-xs text-gray-600 dark:text-gray-400 mb-1"><span className="font-semibold">Pattern:</span> {pattern}</p>
                            <p className="text-xs text-gray-600 dark:text-gray-400 mb-2"><span className="font-semibold">Next Areas:</span> {(Array.isArray(pred.next_areas) ? pred.next_areas : []).join(', ') || 'N/A'}</p>
                            <div className="flex gap-1 flex-wrap">{(Array.isArray(pred.data_sources) ? pred.data_sources : []).map((s:string,j:number)=><span key={j} className="text-[9px] px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400">{String(s)}</span>)}</div>
                          </div>
                          <button onClick={()=>askConfirm('Send Pre-Alert',`Send pre-alert for ${pred.area} now? This will notify matched subscribers.`,'warning',async()=>{try{await apiSendPreAlert(pred.id,user?.id);setPredictions(p=>p.map(x=>x.id===pred.id?{...x,pre_alert_sent:true}:x));pushNotification('Pre-alert sent','success')}catch(err:any){pushNotification(err?.message||'Failed to send pre-alert','error')}})} disabled={pred.pre_alert_sent} className={`px-4 py-2.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all shadow-sm ${pred.pre_alert_sent?'bg-gray-200 dark:bg-gray-700 text-gray-500 cursor-not-allowed':'bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white shadow-md hover:shadow-lg'}`}>
                            {pred.pre_alert_sent?'Sent':'Send Pre-Alert'}
                          </button>
                        </div>
                      </div>
                    )})}
                  </div>
                )}
              </div>

              {/* Run New Prediction — Universal Area Input */}
              <div className="bg-gray-50 dark:bg-gray-800/30 rounded-xl p-5 border border-gray-200 dark:border-gray-700">
                <h4 className="font-bold text-sm mb-4 text-gray-900 dark:text-white flex items-center gap-2"><Zap className="w-4 h-4 text-amber-600"/> Run On-Demand Analysis</h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5 uppercase tracking-wider">Target Area</label>
                    <select className="w-full px-3 py-2.5 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all" value={predictionArea} onChange={e=>setPredictionArea(e.target.value)}>
                      {predictionAreaOptions.map((opt)=><option key={opt.area} value={opt.area}>{opt.area}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5 uppercase tracking-wider">Model</label>
                    <div className="px-3 py-2.5 text-sm bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-xl font-mono text-gray-700 dark:text-gray-300">{predictionResult?.model_version || 'flood-fp-latest'}</div>
                  </div>
                  <div className="flex flex-col justify-end">
                    <button onClick={async()=>{try{setPredictionRunning(true);const option=predictionAreaOptions.find((x)=>x.area===predictionArea);const lat=option?.lat??loc.center?.[0]??56.49;const lng=option?.lng??loc.center?.[1]??-4.20;const region_id=option?.regionId ?? (activeLocation==='scotland'?'uk-default':`${activeLocation}-default`);const result=await apiRunPrediction({area:predictionArea,latitude:lat,longitude:lng,region_id});setPredictionResult(result);if(result?.saved_to_feed){apiGetPredictions().then((raw:any[])=>{const byArea:Record<string,any>={};for(const p of raw){const key=(p.area||'').toLowerCase().trim();if(!key)continue;const ex=byArea[key];if(!ex||(p.probability??0)>(ex.probability??0))byArea[key]=p;}setPredictions(Object.values(byArea));}).catch(()=>{})}}catch{pushNotification('Prediction run failed','error')}finally{setPredictionRunning(false)}}} disabled={predictionRunning} className={`w-full px-5 py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-md ${predictionRunning?'bg-gray-400 text-gray-600 cursor-not-allowed':'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-lg hover:shadow-xl'}`}>
                      <Package className="w-4 h-4"/> {predictionRunning?'Analyzing...':'Run Analysis'}
                    </button>
                  </div>
                </div>

                {/* Results */}
                {predictionResult && (
                  <div className="mt-5 space-y-4">
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                      {[
                        { label:'Risk', value:predictionResult.risk_level||'Unknown', icon:AlertTriangle, bg:'bg-red-50 dark:bg-red-900/20', tc:'text-red-700 dark:text-red-300' },
                        { label:'Probability', value:`${Math.round((Number(predictionResult.probability)||0)<=1?(Number(predictionResult.probability)||0)*100:(Number(predictionResult.probability)||0))}%`, icon:TrendingUp, bg:'bg-blue-50 dark:bg-blue-900/20', tc:'text-blue-700 dark:text-blue-300' },
                        { label:'Confidence', value:`${Math.round((Number(predictionResult.confidence)||0)<=1?(Number(predictionResult.confidence)||0)*100:(Number(predictionResult.confidence)||0))}%`, icon:CheckCircle, bg:'bg-green-50 dark:bg-green-900/20', tc:'text-green-700 dark:text-green-300' },
                        { label:'Peak Time', value:predictionResult.predicted_peak_time?new Date(predictionResult.predicted_peak_time).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'N/A', icon:Clock, bg:'bg-purple-50 dark:bg-purple-900/20', tc:'text-purple-700 dark:text-purple-300' },
                        { label:'Radius', value:`${(predictionResult.affected_radius_km||0).toFixed?.(1)||predictionResult.affected_radius_km||0} km`, icon:Waves, bg:'bg-cyan-50 dark:bg-cyan-900/20', tc:'text-cyan-700 dark:text-cyan-300' },
                      ].map((m,i)=>{const Icon=m.icon;return(
                        <div key={i} className={`${m.bg} rounded-xl p-3 border border-gray-200 dark:border-gray-700`}>
                          <div className="flex items-center justify-between mb-1"><span className="text-[10px] font-semibold text-gray-500 uppercase">{m.label}</span><Icon className="w-3.5 h-3.5 opacity-50"/></div>
                          <p className={`font-bold text-sm ${m.tc}`}>{m.value}</p>
                        </div>
                      )})}
                    </div>

                    {predictionResult.contributing_factors?.length>0&&(
                      <div className="bg-white dark:bg-gray-800/50 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
                        <h5 className="font-bold text-xs mb-3 uppercase tracking-wider text-gray-500">Contributing Factors</h5>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {(predictionResult.contributing_factors||[]).map((f:any,idx:number)=>{
                            const imp=typeof f.importance==='number'?Math.round(f.importance*100):0
                            const name=typeof f==='string'?f:(f.factor||f.name||'Unknown')
                            const barColor=imp>=50?'from-red-500 to-red-600':imp>=30?'from-amber-400 to-amber-500':'from-blue-400 to-blue-500'
                            return(
                            <div key={idx}>
                              <div className="flex justify-between text-xs mb-0.5"><span className="font-medium text-gray-700 dark:text-gray-300 truncate">{name}</span><span className="font-bold text-gray-600 dark:text-gray-400">{imp}%</span></div>
                              <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden"><div className={`h-full bg-gradient-to-r ${barColor} rounded-full`} style={{width:`${imp}%`}}/></div>
                            </div>
                          )})}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Heatmap Summary */}
              <div className="flex items-center justify-between bg-gradient-to-r from-indigo-50 to-blue-50 dark:from-indigo-900/20 dark:to-blue-900/20 rounded-xl p-4 border border-indigo-200 dark:border-indigo-800">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center"><Map className="w-5 h-5 text-indigo-600 dark:text-indigo-400"/></div>
                  <div><p className="font-bold text-sm text-gray-900 dark:text-white">Heatmap Coverage</p><p className="text-xs text-gray-500">{heatmapData.length} data points &middot; Updated: {new Date().toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</p></div>
                </div>
                <span className="px-3 py-1.5 bg-indigo-200 dark:bg-indigo-800 text-indigo-900 dark:text-indigo-200 text-xs font-bold rounded-full">{heatmapData.length} pts</span>
              </div>
            </div>
          </div>

          {/* AI Transparency Dashboard */}
          <AITransparencyDashboard/>
        </div>}

        {/* ═══ HISTORY ═══ */}
        {view==='history'&&(()=>{
          const sortedEvents = (()=>{
            let items = [...(HISTORICAL_EVENTS||[])]
            if(histFilter!=='all') items = items.filter(e=>e.severity===histFilter)
            if(histType!=='all') items = items.filter(e=>e.type===histType)
            if(histSearch.trim()) {
              const q = histSearch.toLowerCase()
              items = items.filter(e=>(e.location||'').toLowerCase().includes(q)||(e.description||'').toLowerCase().includes(q)||(e.type||'').toLowerCase().includes(q)||(e.date||'').includes(q))
            }
            if(histSort==='date-desc') items.sort((a,b)=>new Date(b.date).getTime()-new Date(a.date).getTime())
            else if(histSort==='date-asc') items.sort((a,b)=>new Date(a.date).getTime()-new Date(b.date).getTime())
            else if(histSort==='severity') items.sort((a,b)=>{const o:{[k:string]:number}={High:3,Medium:2,Low:1};return (o[b.severity]||0)-(o[a.severity]||0)})
            else if(histSort==='affected') items.sort((a,b)=>(b.affectedPeople||0)-(a.affectedPeople||0))
            return items
          })()

          return (
          <div className="space-y-5 animate-fade-in">
            {/* Header */}
            <div className="bg-gradient-to-r from-slate-800 via-gray-800 to-zinc-800 rounded-2xl p-6 shadow-xl overflow-hidden relative">
              <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMSIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjAzKSIvPjwvc3ZnPg==')] opacity-50" />
              <div className="relative z-10">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 bg-white/10 rounded-xl flex items-center justify-center border border-white/20"><History className="w-6 h-6 text-white"/></div>
                  <div><h2 className="text-white font-bold text-xl">Historical Intelligence</h2><p className="text-gray-400 text-sm">Event archive, flood heatmap &amp; seasonal analytics &middot; {loc.name || 'All Regions'}</p></div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: 'Total Events', value: HISTORICAL_EVENTS.length, color: 'text-cyan-300' },
                    { label: 'High Severity', value: HISTORICAL_EVENTS.filter(e=>e.severity==='High').length, color: 'text-red-300' },
                    { label: 'People Affected', value: HISTORICAL_EVENTS.reduce((s,e)=>s+(e.affectedPeople||0),0).toLocaleString(), color: 'text-amber-300' },
                    { label: 'Total Damage', value: `£${(HISTORICAL_EVENTS.reduce((s,e)=>s+parseFloat(String(e.damage||'0').replace(/[£MK,]/g,m=>m==='M'?'':m==='K'?'':'')),0)/1e6).toFixed(1)}M+`, color: 'text-green-300' },
                  ].map((s,i)=>(
                    <div key={i} className="bg-white/5 rounded-xl p-3 border border-white/10">
                      <p className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold">{s.label}</p>
                      <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Flood Risk Heatmap — Universal */}
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-lg overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-red-100 dark:bg-red-900/30 rounded-lg flex items-center justify-center"><Map className="w-4 h-4 text-red-600"/></div>
                  <div><h3 className="font-bold text-sm text-gray-900 dark:text-white">Flood Risk Heatmap</h3><p className="text-[10px] text-gray-500">{loc.name || 'Active Region'} &middot; Historical intensity from past events</p></div>
                </div>
                <div className="flex gap-1.5">
                  {['High','Medium','Low'].map(r=><span key={r} className={`text-[10px] px-2 py-0.5 rounded-full font-bold text-white ${r==='High'?'bg-red-600':r==='Medium'?'bg-amber-500':'bg-blue-500'}`}>{r}</span>)}
                </div>
              </div>
              <LiveMap showFloodPredictions height="420px" className="w-full"/>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-4">
                {(heatmapData.length > 0
                  ? heatmapData.slice(0, 4).map((h: any) => {
                      const risk = Math.round((h.intensity || 0) * 100)
                      const color = risk >= 80 ? 'bg-gradient-to-r from-red-600 to-red-700' : risk >= 65 ? 'bg-gradient-to-r from-red-500 to-red-600' : risk >= 50 ? 'bg-gradient-to-r from-orange-500 to-orange-600' : 'bg-gradient-to-r from-amber-500 to-amber-600'
                      return { area: h.zone || 'Zone', risk, events: h.eventCount || 0, color }
                    })
                  : (loc.floodZones || []).slice(0, 4).map((z: any, i: number) => {
                      const risks = [92, 78, 65, 55]
                      const evts = [12, 8, 6, 5]
                      const colors = ['bg-gradient-to-r from-red-600 to-red-700', 'bg-gradient-to-r from-red-500 to-red-600', 'bg-gradient-to-r from-orange-500 to-orange-600', 'bg-gradient-to-r from-amber-500 to-amber-600']
                      return { area: z.name || `Zone ${i+1}`, risk: risks[i] || 50, events: evts[i] || 3, color: colors[i] || colors[3] }
                    })
                ).map((z: any, i: number) => (
                  <div key={i} className={`rounded-xl p-3 text-white text-center shadow-md ${z.color}`}>
                    <p className="font-bold text-xs truncate">{z.area}</p>
                    <p className="text-2xl font-extrabold">{z.risk}%</p>
                    <p className="text-[10px] opacity-90">{z.events} events</p>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-gray-400 px-4 pb-3 italic">{heatmapData.length > 0 ? `Computed from ${heatmapData.length} historical events. Updated dynamically.` : `Risk zones for ${loc.name || 'active region'} based on historical flood records and environmental data.`}</p>
            </div>

            {/* Seasonal Trends */}
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 shadow-lg">
              <h3 className="font-bold text-sm mb-4 flex items-center gap-2"><Clock className="w-4 h-4 text-blue-600"/> Seasonal Flood Trends</h3>
              <div className="flex items-end gap-1.5 h-44 mb-3">
                {(SEASONAL_TRENDS||[]).map((s:any,i:number)=>{
                  const max=Math.max(...(SEASONAL_TRENDS||[]).map((x:any)=>x.floodCount||x.floods||0))
                  const count=s.floodCount||s.floods||0; const pct=max>0?((count/max)*100):10
                  const risk=count>=4?'High':count>=2?'Medium':'Low'
                  const color=risk==='High'?'bg-gradient-to-t from-red-600 to-red-400':risk==='Medium'?'bg-gradient-to-t from-amber-500 to-amber-300':'bg-gradient-to-t from-green-500 to-green-300'
                  return <div key={i} className="flex-1 flex flex-col items-center gap-1 group">
                    <div className="text-[9px] font-bold text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity">{count}</div>
                    <div className="w-full relative" style={{height:'130px'}}>
                      <div className={`absolute bottom-0 w-full rounded-t-md ${color} transition-all shadow-sm group-hover:shadow-md`} style={{height:`${Math.max(pct,8)}%`}}/>
                    </div>
                    <span className="text-[10px] text-gray-500 font-medium">{s.month}</span>
                  </div>
                })}
              </div>
              <div className="flex gap-4 text-[10px] text-gray-500">
                <span className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-red-500"/>High (&ge;4)</span>
                <span className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-amber-400"/>Medium (2-3)</span>
                <span className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-green-400"/>Low (0-1)</span>
              </div>
            </div>

            {/* Past Events Board — Search, Sort, Filter */}
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-lg overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
                <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
                  <h3 className="font-bold text-sm flex items-center gap-2"><FileText className="w-4 h-4 text-blue-600"/> Past Events Board</h3>
                  <span className="text-xs text-gray-500">{sortedEvents.length} of {HISTORICAL_EVENTS.length} events</span>
                </div>
                {/* Search & Filters */}
                <div className="flex flex-wrap gap-2 items-center">
                  <div className="relative flex-1 min-w-[180px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400"/>
                    <input value={histSearch} onChange={e=>setHistSearch(e.target.value)} placeholder="Search events..." className="w-full pl-9 pr-3 py-2 text-xs bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"/>
                  </div>
                  <select value={histFilter} onChange={e=>setHistFilter(e.target.value as any)} className="text-xs px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
                    <option value="all">All Severity</option>
                    <option value="High">High</option>
                    <option value="Medium">Medium</option>
                    <option value="Low">Low</option>
                  </select>
                  <select value={histType} onChange={e=>setHistType(e.target.value as any)} className="text-xs px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
                    <option value="all">All Types</option>
                    <option value="Flood">Flood</option>
                    <option value="Storm">Storm</option>
                  </select>
                  <select value={histSort} onChange={e=>setHistSort(e.target.value as any)} className="text-xs px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
                    <option value="date-desc">Newest First</option>
                    <option value="date-asc">Oldest First</option>
                    <option value="severity">Severity</option>
                    <option value="affected">Most Affected</option>
                  </select>
                </div>
              </div>
              <div className="divide-y divide-gray-100 dark:divide-gray-800 max-h-[500px] overflow-y-auto">
                {sortedEvents.length===0?(
                  <div className="text-center py-10">
                    <Search className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-2"/>
                    <p className="text-sm text-gray-500 font-medium">No events match your filters</p>
                    <p className="text-xs text-gray-400 mt-1">Try adjusting search or filter criteria</p>
                  </div>
                ):sortedEvents.map((e:any,i:number)=>{
                  const sev=e.severity||'Medium'
                  return (
                  <div key={e.id||i} className="px-5 py-4 flex items-start gap-4 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors group">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${sev==='High'?'bg-red-100 dark:bg-red-900/30':sev==='Medium'?'bg-amber-100 dark:bg-amber-900/30':'bg-green-100 dark:bg-green-900/30'}`}>
                      {e.type==='Storm'?<Waves className={`w-5 h-5 ${sev==='High'?'text-red-600':sev==='Medium'?'text-amber-600':'text-green-600'}`}/>:<Droplets className={`w-5 h-5 ${sev==='High'?'text-red-600':sev==='Medium'?'text-amber-600':'text-green-600'}`}/>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${sev==='High'?'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300':sev==='Medium'?'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300':'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'}`}>{sev}</span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">{e.type}</span>
                        <span className="text-[10px] font-mono text-gray-400">{e.date}</span>
                      </div>
                      <h4 className="font-bold text-sm text-gray-900 dark:text-white">{e.location}</h4>
                      <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5 line-clamp-2">{e.description}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      {e.affectedPeople&&<p className="text-sm font-bold text-red-600">{e.affectedPeople.toLocaleString()}</p>}
                      {e.affectedPeople&&<p className="text-[10px] text-gray-400">affected</p>}
                      {e.damage&&<p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mt-1">{e.damage}</p>}
                    </div>
                  </div>
                )})}
              </div>
            </div>
          </div>
        )})()}

        {/* ═══ AUDIT TRAIL ═══ */}
        {view==='audit'&&(()=>{
          const actionTypes = [...new Set(auditLog.map(a=>a.action_type).filter(Boolean))]
          const filteredAudit = (()=>{
            let items = [...auditLog]
            if(auditTypeFilter!=='all') items = items.filter(a=>a.action_type===auditTypeFilter)
            if(auditSearch.trim()){const q=auditSearch.toLowerCase();items=items.filter(a=>(a.action||'').toLowerCase().includes(q)||(a.operator_name||'').toLowerCase().includes(q)||(a.target_id||'').toLowerCase().includes(q))}
            if(auditSort==='oldest') items.reverse()
            return items
          })()

          const typeColor = (t:string)=> t==='verify'||t==='user_activate'?'bg-green-500':t==='flag'?'bg-amber-500':t==='urgent'?'bg-red-500':t==='resolve'?'bg-gray-500':t==='deploy'?'bg-emerald-500':t==='recall'?'bg-orange-500':t==='user_delete'?'bg-red-600':t==='user_suspend'?'bg-amber-600':'bg-blue-500'
          const typeIcon = (t:string)=> t==='verify'||t==='user_activate'?<CheckCircle className="w-4 h-4"/>:t==='flag'?<Flag className="w-4 h-4"/>:t==='urgent'?<Siren className="w-4 h-4"/>:t==='deploy'?<Package className="w-4 h-4"/>:t==='recall'?<AlertTriangle className="w-4 h-4"/>:t==='user_delete'?<Trash2 className="w-4 h-4"/>:t==='user_suspend'?<Ban className="w-4 h-4"/>:<Activity className="w-4 h-4"/>

          return (
          <div className="space-y-5 animate-fade-in">
            {/* Header */}
            <div className="bg-gradient-to-r from-violet-800 via-purple-800 to-indigo-800 rounded-2xl p-6 shadow-xl overflow-hidden relative">
              <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMSIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjA0KSIvPjwvc3ZnPg==')] opacity-50" />
              <div className="relative z-10">
                <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-white/10 rounded-xl flex items-center justify-center border border-white/20"><Shield className="w-6 h-6 text-white"/></div>
                    <div><h2 className="text-white font-bold text-xl">Compliance Audit Trail</h2><p className="text-purple-200 text-sm">Immutable record of all operator actions &middot; Tamper-evident logging</p></div>
                  </div>
                  <button onClick={()=>apiGetAuditLog({limit:'100'}).then(d=>setAuditLog(d||[])).catch(()=>{})} className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-medium transition-all flex items-center gap-2 border border-white/10"><RefreshCw className="w-3.5 h-3.5"/> Refresh</button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: 'Total Entries', value: auditLog.length, color: 'text-cyan-300' },
                    { label: 'Today', value: auditLog.filter(a=>new Date(a.created_at).toDateString()===new Date().toDateString()).length, color: 'text-green-300' },
                    { label: 'Operators', value: [...new Set(auditLog.map(a=>a.operator_name).filter(Boolean))].length, color: 'text-amber-300' },
                    { label: 'Action Types', value: actionTypes.length, color: 'text-purple-300' },
                  ].map((s,i)=>(
                    <div key={i} className="bg-white/5 rounded-xl p-3 border border-white/10">
                      <p className="text-[10px] text-purple-200 uppercase tracking-wider font-semibold">{s.label}</p>
                      <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-2 items-center">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"/>
                <input value={auditSearch} onChange={e=>setAuditSearch(e.target.value)} placeholder="Search actions, operators, targets..." className="w-full pl-10 pr-4 py-2.5 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-purple-500 outline-none"/>
              </div>
              <select value={auditTypeFilter} onChange={e=>setAuditTypeFilter(e.target.value)} className="text-xs px-3 py-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl">
                <option value="all">All Types</option>
                {actionTypes.map(t=><option key={t} value={t}>{t}</option>)}
              </select>
              <select value={auditSort} onChange={e=>setAuditSort(e.target.value as any)} className="text-xs px-3 py-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl">
                <option value="newest">Newest First</option>
                <option value="oldest">Oldest First</option>
              </select>
              <span className="text-xs text-gray-500 px-2">{filteredAudit.length} entries</span>
            </div>

            {/* Audit Table */}
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-lg overflow-hidden">
              {/* Table header */}
              <div className="hidden sm:grid grid-cols-12 gap-3 px-5 py-3 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                <div className="col-span-1">Type</div>
                <div className="col-span-4">Action</div>
                <div className="col-span-2">Operator</div>
                <div className="col-span-2">Target</div>
                <div className="col-span-3">Timestamp</div>
              </div>
              <div className="divide-y divide-gray-100 dark:divide-gray-800 max-h-[600px] overflow-y-auto">
                {filteredAudit.length===0?(
                  <div className="text-center py-12">
                    <Shield className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3"/>
                    <p className="text-gray-600 dark:text-gray-400 font-semibold">No audit entries found</p>
                    <p className="text-sm text-gray-500 mt-1">{auditSearch||auditTypeFilter!=='all'?'Try adjusting your filters':'Actions will be recorded here'}</p>
                  </div>
                ):filteredAudit.map((e:any,i:number)=>(
                  <div key={e.id||i} className="grid grid-cols-1 sm:grid-cols-12 gap-2 sm:gap-3 px-5 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors items-center">
                    <div className="col-span-1 flex items-center">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-white ${typeColor(e.action_type)}`}>{typeIcon(e.action_type)}</div>
                    </div>
                    <div className="col-span-4">
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{e.action}</p>
                      <span className={`inline-block text-[9px] px-1.5 py-0.5 rounded font-semibold mt-0.5 ${typeColor(e.action_type)} text-white`}>{e.action_type || 'system'}</span>
                    </div>
                    <div className="col-span-2">
                      <p className="text-xs font-medium text-gray-700 dark:text-gray-300">{e.operator_name||'System'}</p>
                    </div>
                    <div className="col-span-2">
                      <p className="text-xs font-mono text-gray-500 truncate">{e.target_id?e.target_id.slice(0,12)+'...':'—'}</p>
                    </div>
                    <div className="col-span-3">
                      <p className="text-xs text-gray-500">{new Date(e.created_at).toLocaleString('en-GB',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'})}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )})()}

        {/* ═══ RESOURCES ═══ */}
        {view==='resources'&&(
          <div className="space-y-5 animate-fade-in">
            {/* Header */}
            <div className="bg-gradient-to-r from-emerald-800 via-teal-800 to-cyan-800 rounded-2xl p-6 shadow-xl overflow-hidden relative">
              <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMSIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjAzKSIvPjwvc3ZnPg==')] opacity-50" />
              <div className="relative z-10">
                <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-white/10 rounded-xl flex items-center justify-center border border-white/20"><Navigation className="w-6 h-6 text-white"/></div>
                    <div><h2 className="text-white font-bold text-xl">Resource Deployment Dashboard</h2><p className="text-teal-200 text-sm">AI-recommended allocation &middot; {loc.name || 'Active Region'}</p></div>
                  </div>
                  <button onClick={()=>{apiGetDeployments().then(setDeployments).catch(()=>{});pushNotification('Deployment status refreshed','info')}} className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-medium transition-all flex items-center gap-2 border border-white/10"><RefreshCw className="w-3.5 h-3.5"/> Refresh</button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: 'Total Zones', value: deployments.length, icon: Layers, color: 'text-cyan-300' },
                    { label: 'Active Deployments', value: deployments.filter((d:any)=>d.deployed).length, icon: Package, color: 'text-green-300' },
                    { label: 'Critical Zones', value: deployments.filter((d:any)=>d.priority==='Critical').length, icon: AlertTriangle, color: 'text-red-300' },
                    { label: 'Total Reports', value: deployments.reduce((sum:number,d:any)=>sum+(d.active_reports||0),0), icon: FileText, color: 'text-amber-300' },
                  ].map((s,i)=>(
                    <div key={i} className="bg-white/5 rounded-xl p-3 border border-white/10">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-[10px] text-teal-200 uppercase tracking-wider font-semibold">{s.label}</p>
                        <s.icon className={`w-4 h-4 ${s.color}`}/>
                      </div>
                      <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Map View — Proper height and responsive layout */}
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                <h3 className="font-bold text-sm flex items-center gap-2"><Map className="w-4 h-4 text-emerald-600"/> Deployment Zones Map</h3>
                <div className="flex items-center gap-3 flex-wrap text-[10px]">
                  <span className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-full bg-red-500"/><span className="text-gray-500">Critical</span></span>
                  <span className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-full bg-amber-500"/><span className="text-gray-500">High</span></span>
                  <span className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-full bg-blue-500"/><span className="text-gray-500">Medium</span></span>
                  <span className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-full bg-gray-400"/><span className="text-gray-500">Low</span></span>
                </div>
              </div>
              <div className="h-[60vh] min-h-[400px] max-h-[700px] relative"><DisasterMap reports={reports.filter(r=>r.status==='Urgent'||r.status==='Verified')} deployments={deployments} center={loc.center} zoom={loc.zoom} showDistress showPredictions showRiskLayer showFloodMonitoring/></div>
            </div>

            {/* Deployment Cards */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {deployments.map((zone:any,i:number)=>(
                <div key={zone.id||i} className={`bg-white dark:bg-gray-900 rounded-2xl border-2 p-5 shadow-sm transition-all hover:shadow-md ${zone.priority==='Critical'?'border-red-400 dark:border-red-800':zone.priority==='High'?'border-amber-400 dark:border-amber-800':zone.priority==='Medium'?'border-blue-400 dark:border-blue-800':'border-gray-300 dark:border-gray-700'} ${zone.deployed?'ring-2 ring-green-400 dark:ring-green-600':''}`}>
                  <div className="flex items-center gap-2 mb-3 flex-wrap">
                    <h3 className="font-bold text-sm text-gray-900 dark:text-white">{zone.zone}</h3>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold text-white ${zone.priority==='Critical'?'bg-red-600':zone.priority==='High'?'bg-amber-600':zone.priority==='Medium'?'bg-blue-600':'bg-gray-500'}`}>{zone.priority}</span>
                    {zone.deployed&&<span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-green-600 text-white animate-pulse">DEPLOYED</span>}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                    <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-2"><p className="text-[9px] text-gray-500 font-semibold uppercase">Reports</p><p className="font-bold text-sm">{zone.active_reports}</p></div>
                    <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-2"><p className="text-[9px] text-gray-500 font-semibold uppercase">Affected</p><p className="font-bold text-sm text-red-600">{zone.estimated_affected}</p></div>
                    <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-2"><p className="text-[9px] text-gray-500 font-semibold uppercase">Resources</p>
                      <div className="flex gap-1.5 mt-0.5">
                        {zone.ambulances>0&&<span className="flex items-center gap-0.5 text-[10px]"><Truck className="w-3 h-3 text-red-500"/>{zone.ambulances}</span>}
                        {zone.fire_engines>0&&<span className="flex items-center gap-0.5 text-[10px]"><Flame className="w-3 h-3 text-orange-500"/>{zone.fire_engines}</span>}
                        {zone.rescue_boats>0&&<span className="flex items-center gap-0.5 text-[10px]"><Anchor className="w-3 h-3 text-blue-500"/>{zone.rescue_boats}</span>}
                      </div>
                    </div>
                    <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-2"><p className="text-[9px] text-gray-500 font-semibold uppercase">Updated</p><p className="font-bold text-[10px] text-gray-600 dark:text-gray-400">{new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</p></div>
                  </div>
                  <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-xl p-2.5 mb-3">
                    <p className="text-xs text-blue-800 dark:text-blue-200 flex items-start gap-1.5"><Brain className="w-3.5 h-3.5 text-blue-600 flex-shrink-0 mt-0.5"/> <span><span className="font-semibold">AI:</span> {zone.ai_recommendation}</span></p>
                  </div>
                  <div className="flex gap-2">
                    {zone.deployed?(
                      <button onClick={()=>{setDeployReason('');askConfirm('Recall Resources',`Recall all resources from ${zone.zone}? A reason is required.`,'warning',async()=>{const reason=deployReasonRef.current;if(!reason.trim()){pushNotification('Reason is required for recall','error');return}apiRecallResources(zone.id).then(()=>{setDeployments(d=>d.map(x=>x.id===zone.id?{...x,deployed:false}:x));pushNotification('Resources recalled','warning')}).catch(()=>{pushNotification('Failed to recall resources — server error','error')});apiAuditLog({operator_id:user?.id,operator_name:user?.displayName,action:`Recalled resources from ${zone.zone}`,action_type:'recall',target_type:'deployment',target_id:zone.id,reason,before_state:{deployed:true},after_state:{deployed:false}}).catch(()=>{});setAuditLog(prev=>[{id:Date.now(),operator_name:user?.displayName,action:`Recalled resources from ${zone.zone}`,action_type:'recall',target_id:zone.id,created_at:new Date().toISOString()},...prev])})}} className="flex-1 py-2 text-xs font-bold rounded-xl bg-amber-600 hover:bg-amber-700 text-white transition-colors flex items-center justify-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5"/> Recall</button>
                    ):(
                      <button onClick={()=>{setDeployReason('');askConfirm('Deploy Resources',`Deploy resources to ${zone.zone}? A mandatory reason is required and will be logged.`,'success',async()=>{const reason=deployReasonRef.current;if(!reason.trim()){pushNotification('Deployment reason is required','error');return}apiDeployResources(zone.id,user?.id).then(()=>{setDeployments(d=>d.map(x=>x.id===zone.id?{...x,deployed:true}:x));pushNotification('Resources deployed','success')}).catch(()=>{pushNotification('Failed to deploy resources — server error','error')});apiAuditLog({operator_id:user?.id,operator_name:user?.displayName,action:`Deployed resources to ${zone.zone}`,action_type:'deploy',target_type:'deployment',target_id:zone.id,reason,before_state:{deployed:false},after_state:{deployed:true}}).catch(()=>{});setAuditLog(prev=>[{id:Date.now(),operator_name:user?.displayName,action:`Deployed resources to ${zone.zone}`,action_type:'deploy',target_id:zone.id,created_at:new Date().toISOString()},...prev])})}} className="flex-1 py-2 text-xs font-bold rounded-xl bg-green-600 hover:bg-green-700 text-white transition-colors flex items-center justify-center gap-1.5"><Package className="w-3.5 h-3.5"/> Deploy</button>
                    )}
                    <button onClick={()=>setView('reports')} className="py-2 px-3 text-xs font-semibold rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 transition-colors flex items-center justify-center gap-1"><Eye className="w-3 h-3"/> Reports</button>
                  </div>
                </div>
              ))}
            </div>

            {/* Deployment Timeline */}
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 shadow-lg">
              <h3 className="font-bold text-sm mb-4 flex items-center gap-2"><Clock className="w-4 h-4 text-purple-600"/> Recent Deployment Activity</h3>
              <div className="space-y-3 border-l-2 border-gray-200 dark:border-gray-700 pl-4 ml-1">
                {auditLog.filter(a=>a.action_type==='deploy'||a.action_type==='recall').slice(0,8).map((log,i)=>(
                  <div key={log.id||i} className="relative">
                    <div className={`absolute -left-[21px] top-0.5 w-3 h-3 rounded-full border-2 border-white dark:border-gray-900 ${log.action_type==='deploy'?'bg-green-500':'bg-amber-500'}`}/>
                    <p className="text-xs font-medium text-gray-900 dark:text-white">{log.action}</p>
                    <p className="text-[10px] text-gray-500">{log.operator_name} &middot; {new Date(log.created_at).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</p>
                  </div>
                ))}
                {auditLog.filter(a=>a.action_type==='deploy'||a.action_type==='recall').length===0&&(
                  <p className="text-xs text-gray-400 py-2">No recent deployment activity</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ═══ CITIZEN MESSAGING ═══ */}
        {view==='messaging'&&(
          <div className="space-y-4 animate-fade-in">
            <h2 className="font-bold text-xl flex items-center gap-2"><MessageSquare className="w-6 h-6 text-aegis-600"/> Citizen Messages</h2>
            <AdminMessaging />
          </div>
        )}

        {/* ═══ COMMUNITY CHAT ═══ */}
        {view==='community'&&(
          <AdminCommunitySection />
        )}

        {/* ═══ SYSTEM HEALTH ═══ */}
        {view==='system_health'&&(
          <div className="animate-fade-in">
            <SystemHealthPanel />
          </div>
        )}

        {/* ═══ USER MANAGEMENT (SUPER ADMIN ONLY) ═══ */}
        {view==='users'&&user.role==='admin'&&(()=>{
          const userSearch = searchTerm.toLowerCase()
          const filteredUsers = (()=>{
            let items = users.filter(u => {
              if (userSearch && !u.display_name?.toLowerCase().includes(userSearch) && !u.email?.toLowerCase().includes(userSearch) && !u.department?.toLowerCase().includes(userSearch)) return false
              if (userRoleFilter!=='all' && u.role!==userRoleFilter && !(userRoleFilter==='viewer'&&u.role!=='admin'&&u.role!=='operator')) return false
              if (userStatusFilter==='active' && (u.is_suspended||!u.is_active)) return false
              if (userStatusFilter==='suspended' && !u.is_suspended) return false
              if (userStatusFilter==='inactive' && (u.is_active||u.is_suspended)) return false
              return true
            })
            items.sort((a,b)=>{
              let cmp=0
              if(userSortField==='name') cmp=(a.display_name||'').localeCompare(b.display_name||'')
              else if(userSortField==='role') cmp=(a.role||'').localeCompare(b.role||'')
              else if(userSortField==='department') cmp=(a.department||'zzz').localeCompare(b.department||'zzz')
              else if(userSortField==='status') cmp=(a.is_suspended?0:a.is_active?1:2)-(b.is_suspended?0:b.is_active?1:2)
              else if(userSortField==='lastLogin') cmp=new Date(b.last_login||0).getTime()-new Date(a.last_login||0).getTime()
              return userSortDir==='desc'?-cmp:cmp
            })
            return items
          })()
          const roleStats = { admin: users.filter(u=>u.role==='admin').length, operator: users.filter(u=>u.role==='operator').length, viewer: users.filter(u=>u.role!=='admin'&&u.role!=='operator').length }
          const activeCount = users.filter(u=>u.is_active&&!u.is_suspended).length
          const suspendedCount = users.filter(u=>u.is_suspended).length
          const recentLogins = users.filter(u=>u.last_login&&(Date.now()-new Date(u.last_login).getTime())<86400000).length
          return (
          <div className="space-y-5 animate-fade-in">
            {/* Header */}
            <div className="bg-gradient-to-r from-blue-900 via-indigo-900 to-purple-900 rounded-2xl p-6 shadow-xl relative overflow-hidden">
              <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMSIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjA1KSIvPjwvc3ZnPg==')] opacity-50" />
              <div className="relative z-10">
                <div className="flex items-center justify-between flex-wrap gap-4">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/20 flex items-center justify-center">
                      <Users className="w-7 h-7 text-white" />
                    </div>
                    <div>
                      <h2 className="text-white font-bold text-xl tracking-tight">User & Access Management</h2>
                      <p className="text-blue-200 text-sm mt-0.5">Role-based access control, audit & account lifecycle</p>
                    </div>
                  </div>
                  <button onClick={()=>apiGetUsers().then(d=>setUsers(d.users||[])).catch(()=>pushNotification('Failed to reload users','error'))} className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-sm font-medium transition-all flex items-center gap-2 border border-white/10">
                    <RefreshCw className="w-4 h-4"/> Refresh
                  </button>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mt-5">
                  {[
                    { label: 'Total Users', value: String(users.length), icon: Users, color: 'text-cyan-300' },
                    { label: 'Active Now', value: String(activeCount), icon: CheckCircle2, color: 'text-emerald-300' },
                    { label: 'Suspended', value: String(suspendedCount), icon: Ban, color: suspendedCount > 0 ? 'text-red-300' : 'text-gray-400' },
                    { label: 'Admins', value: String(roleStats.admin), icon: Shield, color: 'text-purple-300' },
                    { label: 'Operators', value: String(roleStats.operator), icon: Activity, color: 'text-blue-300' },
                    { label: 'Login (24h)', value: String(recentLogins), icon: Clock, color: 'text-amber-300' },
                  ].map((s, i) => (
                    <div key={i} className="bg-white/5 backdrop-blur-sm rounded-xl p-3 border border-white/10">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] text-blue-300 uppercase tracking-wider font-semibold">{s.label}</span>
                        <s.icon className={`w-4 h-4 ${s.color}`} />
                      </div>
                      <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Search & Advanced Filters */}
            <div className="flex flex-wrap gap-2 items-center">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input value={searchTerm} onChange={e=>setSearchTerm(e.target.value)} placeholder="Search users by name, email or department..." className="w-full pl-10 pr-4 py-2.5 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <select value={userRoleFilter} onChange={e=>setUserRoleFilter(e.target.value as any)} className="text-xs px-3 py-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl font-semibold">
                <option value="all">All Roles</option>
                <option value="admin">Admin</option>
                <option value="operator">Operator</option>
                <option value="viewer">Viewer</option>
              </select>
              <select value={userStatusFilter} onChange={e=>setUserStatusFilter(e.target.value as any)} className="text-xs px-3 py-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl font-semibold">
                <option value="all">All Status</option>
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
                <option value="inactive">Inactive</option>
              </select>
              <select value={`${userSortField}-${userSortDir}`} onChange={e=>{const [f,d]=e.target.value.split('-');setUserSortField(f as any);setUserSortDir(d as any)}} className="text-xs px-3 py-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl font-semibold">
                <option value="name-asc">Name A-Z</option>
                <option value="name-desc">Name Z-A</option>
                <option value="role-asc">Role A-Z</option>
                <option value="role-desc">Role Z-A</option>
                <option value="department-asc">Department A-Z</option>
                <option value="department-desc">Department Z-A</option>
                <option value="status-asc">Status</option>
                <option value="lastLogin-desc">Last Login (Recent)</option>
                <option value="lastLogin-asc">Last Login (Oldest)</option>
              </select>
              <div className="flex gap-1.5 text-xs">
                <span className="px-2.5 py-2 bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 rounded-lg font-semibold flex items-center gap-1"><Shield className="w-3 h-3"/> {roleStats.admin}</span>
                <span className="px-2.5 py-2 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 rounded-lg font-semibold flex items-center gap-1"><Activity className="w-3 h-3"/> {roleStats.operator}</span>
                <span className="px-2.5 py-2 bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 rounded-lg font-semibold flex items-center gap-1"><Eye className="w-3 h-3"/> {roleStats.viewer}</span>
              </div>
            </div>

            {/* Users Table — Row-based layout */}
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-lg overflow-hidden">
              {filteredUsers.length===0?(
                <div className="p-12 text-center">
                  <Users className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3"/>
                  <p className="text-gray-600 dark:text-gray-400 font-semibold">No Users Found</p>
                  <p className="text-sm text-gray-500 mt-1">{searchTerm ? 'Try a different search term' : 'No users registered yet'}</p>
                </div>
              ):(
                <>
                  {/* Table Header — hidden on mobile */}
                  <div className="hidden md:grid md:grid-cols-[2.5fr_1fr_1fr_1fr_1fr_1.2fr] gap-2 px-5 py-3 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700 text-[10px] uppercase tracking-wider font-bold text-gray-500">
                    <span>User</span><span>Role</span><span>Department</span><span>Status</span><span>Last Login</span><span className="text-right">Actions</span>
                  </div>
                  {/* Rows */}
                  <div className="divide-y divide-gray-100 dark:divide-gray-800">
                    {filteredUsers.map(u=>(
                      <div key={u.id} className={`flex flex-col md:grid md:grid-cols-[2.5fr_1fr_1fr_1fr_1fr_1.2fr] gap-2 md:gap-2 px-5 py-3.5 items-center transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/40 ${u.is_suspended?'bg-red-50/40 dark:bg-red-950/10':''}`}>
                        {/* User */}
                        <div className="flex items-center gap-3 w-full">
                          {u.avatar_url
                            ?<img src={u.avatar_url} alt="" className="w-9 h-9 rounded-lg object-cover border border-gray-200 dark:border-gray-700 flex-shrink-0"/>
                            :<div className={`w-9 h-9 rounded-lg flex items-center justify-center text-white font-bold text-sm flex-shrink-0 ${u.role==='admin'?'bg-gradient-to-br from-purple-500 to-indigo-600':u.role==='operator'?'bg-gradient-to-br from-blue-500 to-cyan-600':'bg-gradient-to-br from-gray-400 to-gray-500'}`}>{u.display_name?.charAt(0)||'?'}</div>
                          }
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{u.display_name}</p>
                            <p className="text-[11px] text-gray-500 truncate">{u.email}</p>
                          </div>
                        </div>
                        {/* Role */}
                        <div>
                          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold ${u.role==='admin'?'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300':u.role==='operator'?'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300':'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'}`}>
                            {u.role==='admin'?<Shield className="w-3 h-3"/>:u.role==='operator'?<Activity className="w-3 h-3"/>:<Eye className="w-3 h-3"/>}
                            {u.role?.charAt(0).toUpperCase()+(u.role?.slice(1)||'')}
                          </span>
                        </div>
                        {/* Department */}
                        <p className="text-xs text-gray-600 dark:text-gray-400 truncate">{u.department||<span className="text-gray-400 italic">Unassigned</span>}</p>
                        {/* Status */}
                        <div>
                          {u.is_suspended
                            ?<span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"><Ban className="w-3 h-3"/> Suspended</span>
                            :u.is_active
                              ?<span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"><CheckCircle2 className="w-3 h-3"/> Active</span>
                              :<span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">Inactive</span>
                          }
                        </div>
                        {/* Last Login */}
                        <p className="text-xs text-gray-500">{u.last_login?new Date(u.last_login).toLocaleDateString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):<span className="text-gray-400 italic">Never</span>}</p>
                        {/* Actions */}
                        <div className="flex items-center gap-1.5 justify-end w-full">
                          <button onClick={()=>{setSelectedUser(u);setEditUserForm({role:u.role,department:u.department||'',phone:u.phone||'',displayName:u.display_name})}} title="Edit" className="p-1.5 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors"><Edit2 className="w-3.5 h-3.5"/></button>
                          {u.is_suspended?(
                            <button onClick={()=>askConfirm('Activate User',`Activate ${u.display_name}'s account? They will be able to log in immediately.`,'success',async()=>{apiActivateUser(u.id).then(()=>{setUsers(users.map(x=>x.id===u.id?{...x,is_suspended:false,suspended_until:null}:x));pushNotification('User activated','success')}).catch(()=>pushNotification('Failed to activate user','error'))})} title="Activate" className="p-1.5 rounded-lg bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 hover:bg-green-100 transition-colors"><CheckCircle2 className="w-3.5 h-3.5"/></button>
                          ):(
                            <button onClick={()=>{setSelectedUser(u);setSuspendForm({until:'',reason:''});askConfirm('Suspend User',`Suspend ${u.display_name}'s account?`,'warning',async()=>{if(!suspendForm.reason.trim()){pushNotification('Suspension reason is required','error');return}apiSuspendUser(u.id,suspendForm).then(()=>{setUsers(users.map(x=>x.id===u.id?{...x,is_suspended:true,suspended_until:suspendForm.until||null}:x));pushNotification('User suspended','warning');setSuspendForm({until:'',reason:''})}).catch(()=>pushNotification('Failed to suspend user','error'))})}} title="Suspend" className="p-1.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 hover:bg-amber-100 transition-colors"><Ban className="w-3.5 h-3.5"/></button>
                          )}
                          <button onClick={()=>askConfirm('Reset Password',`Generate password reset link for ${u.display_name}?`,'info',async()=>{apiResetUserPassword(u.id).then(d=>{pushNotification('Password reset link generated','success')}).catch(()=>pushNotification('Failed to generate reset link','error'))})} title="Reset Password" className="p-1.5 rounded-lg bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 hover:bg-purple-100 transition-colors"><Key className="w-3.5 h-3.5"/></button>
                          {u.id!==user.id&&(
                            <button onClick={()=>askConfirm('Delete User',`Permanently delete ${u.display_name}? This action cannot be undone.`,'danger',async()=>{apiDeleteUser(u.id).then(()=>{setUsers(users.filter(x=>x.id!==u.id));pushNotification('User deleted','success')}).catch(()=>pushNotification('Failed to delete user','error'))})} title="Delete" className="p-1.5 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100 transition-colors"><Trash2 className="w-3.5 h-3.5"/></button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* Footer */}
                  <div className="px-5 py-2.5 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-500 flex items-center justify-between">
                    <span>Showing {filteredUsers.length} of {users.length} users</span>
                    <span>{activeCount} active &middot; {suspendedCount} suspended</span>
                  </div>
                </>
              )}
            </div>

            {/* Role Distribution & Activity */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Role Distribution */}
              <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 shadow-sm">
                <h3 className="font-bold text-sm flex items-center gap-2 mb-4"><Shield className="w-4 h-4 text-blue-600"/> Role Distribution</h3>
                <div className="space-y-3">
                  {[
                    { role: 'Admin', count: roleStats.admin, total: users.length, color: 'from-purple-500 to-indigo-500', bg: 'bg-purple-100 dark:bg-purple-900/30' },
                    { role: 'Operator', count: roleStats.operator, total: users.length, color: 'from-blue-500 to-cyan-500', bg: 'bg-blue-100 dark:bg-blue-900/30' },
                    { role: 'Viewer', count: roleStats.viewer, total: users.length, color: 'from-gray-400 to-gray-500', bg: 'bg-gray-100 dark:bg-gray-800' },
                  ].map((r, i) => (
                    <div key={i}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="font-semibold text-gray-700 dark:text-gray-300">{r.role}</span>
                        <span className="font-bold text-gray-600 dark:text-gray-400">{r.count} ({r.total>0?Math.round(r.count/r.total*100):0}%)</span>
                      </div>
                      <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-3 overflow-hidden">
                        <div className={`h-3 rounded-full bg-gradient-to-r ${r.color} transition-all duration-700`} style={{ width: `${r.total>0?r.count/r.total*100:0}%` }}/>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-xl">
                  <p className="text-xs text-blue-800 dark:text-blue-200 flex items-center gap-1.5"><Shield className="w-3.5 h-3.5"/> RBAC enforced: Admins manage users. Operators handle reports. Viewers have read-only access.</p>
                </div>
              </div>

              {/* Activity Timeline */}
              <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 shadow-sm">
                <h3 className="font-bold text-sm flex items-center gap-2 mb-4"><Clock className="w-4 h-4 text-purple-600"/> User Management Audit Trail</h3>
                <div className="space-y-3 max-h-[280px] overflow-y-auto pr-1">
                  {auditLog.filter(a=>a.action_type?.includes('user_')||a.action_type==='password_reset_generate').slice(0,15).map((log,i)=>(
                    <div key={log.id||i} className="flex items-start gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${log.action_type==='user_delete'?'bg-red-100 dark:bg-red-900/30':log.action_type==='user_suspend'?'bg-amber-100 dark:bg-amber-900/30':log.action_type==='user_activate'?'bg-green-100 dark:bg-green-900/30':'bg-blue-100 dark:bg-blue-900/30'}`}>
                        {log.action_type==='user_delete'?<Trash2 className="w-3.5 h-3.5 text-red-600"/>:log.action_type==='user_suspend'?<Ban className="w-3.5 h-3.5 text-amber-600"/>:log.action_type==='user_activate'?<CheckCircle2 className="w-3.5 h-3.5 text-green-600"/>:<Edit2 className="w-3.5 h-3.5 text-blue-600"/>}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-gray-900 dark:text-white truncate">{log.action}</p>
                        <p className="text-[10px] text-gray-500 mt-0.5">{log.operator_name} · {new Date(log.created_at).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</p>
                      </div>
                    </div>
                  ))}
                  {auditLog.filter(a=>a.action_type?.includes('user_')||a.action_type==='password_reset_generate').length===0&&(
                    <div className="text-center py-6">
                      <Clock className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2"/>
                      <p className="text-xs text-gray-400">No recent user management activity</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
          )
        })()}

        {/* ═══ USER EDIT MODAL ═══ */}
        {selectedUser&&(
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-[60]" onClick={()=>setSelectedUser(null)}>
            <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden" onClick={e=>e.stopPropagation()}>
              {/* Modal Header */}
              <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-5">
                <div className="flex items-center gap-3">
                  {selectedUser.avatar_url?<img src={selectedUser.avatar_url} alt="" className="w-12 h-12 rounded-xl object-cover border-2 border-white/30"/>:<div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center text-white font-bold text-lg">{selectedUser.display_name?.charAt(0)||'?'}</div>}
                  <div>
                    <h3 className="font-bold text-white text-lg">{selectedUser.display_name}</h3>
                    <p className="text-blue-200 text-sm">{selectedUser.email}</p>
                  </div>
                  <button onClick={()=>setSelectedUser(null)} className="ml-auto p-2 hover:bg-white/10 rounded-xl transition-colors"><X className="w-5 h-5 text-white"/></button>
                </div>
              </div>

              <div className="p-5 space-y-4">
                <div>
                  <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1.5">Display Name</label>
                  <input className="w-full px-4 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-blue-500 outline-none" value={editUserForm.displayName} onChange={e=>setEditUserForm(f=>({...f,displayName:e.target.value}))}/>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1.5">Role</label>
                  <div className="grid grid-cols-3 gap-2">
                    {['admin','operator','viewer'].map(r=>(
                      <button key={r} onClick={()=>setEditUserForm(f=>({...f,role:r}))} className={`py-2.5 rounded-xl text-xs font-bold transition-all ${editUserForm.role===r?r==='admin'?'bg-purple-100 text-purple-700 border-2 border-purple-400 dark:bg-purple-900/30 dark:text-purple-300':r==='operator'?'bg-blue-100 text-blue-700 border-2 border-blue-400 dark:bg-blue-900/30 dark:text-blue-300':'bg-gray-200 text-gray-700 border-2 border-gray-400 dark:bg-gray-700 dark:text-gray-300':'bg-gray-50 dark:bg-gray-800 text-gray-500 border-2 border-transparent hover:border-gray-300'}`}>
                        {r.charAt(0).toUpperCase()+r.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1.5">Department</label>
                  <select className="w-full px-4 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-blue-500 outline-none" value={editUserForm.department} onChange={e=>setEditUserForm(f=>({...f,department:e.target.value}))}>
                    <option value="">Select Department</option>
                    {['Emergency Operations','Fire & Rescue','Police','Health & Medical','Infrastructure','Environmental','Community Liaison','IT & Communications','Logistics','Command & Control'].map(d=>(<option key={d} value={d}>{d}</option>))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1.5">Phone</label>
                  <input className="w-full px-4 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-blue-500 outline-none" placeholder="+44 1234 567890" value={editUserForm.phone} onChange={e=>setEditUserForm(f=>({...f,phone:e.target.value}))}/>
                </div>

                <div className="flex gap-3 pt-2">
                  <button onClick={()=>setSelectedUser(null)} className="flex-1 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-xl py-3 text-sm font-semibold transition-colors">Cancel</button>
                  <button onClick={()=>{apiUpdateUser(selectedUser.id,{role:editUserForm.role,department:editUserForm.department||null,phone:editUserForm.phone||null,displayName:editUserForm.displayName}).then(()=>{setUsers(users.map(u=>u.id===selectedUser.id?{...u,...editUserForm,display_name:editUserForm.displayName}:u));pushNotification('User updated','success');setSelectedUser(null)}).catch(()=>pushNotification('Failed to update user','error'))}} className="flex-1 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl py-3 text-sm font-bold shadow-lg shadow-blue-500/20 transition-all">Save Changes</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ═══ SEND ALERT — Professional Emergency Broadcast System ═══ */}
        {view==='alert_send'&&(
          <div className="max-w-2xl mx-auto animate-fade-in space-y-5">
            {/* Header */}
            <div className={`rounded-2xl p-6 shadow-xl overflow-hidden relative ${alertForm.severity==='critical'?'bg-gradient-to-r from-red-800 via-red-900 to-rose-900':alertForm.severity==='warning'?'bg-gradient-to-r from-amber-700 via-amber-800 to-orange-800':'bg-gradient-to-r from-blue-800 via-blue-900 to-indigo-900'}`}>
              <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMSIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjA0KSIvPjwvc3ZnPg==')] opacity-50" />
              <div className="relative z-10">
                <div className="flex items-center gap-3 mb-2">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center border border-white/20 ${alertForm.severity==='critical'?'bg-red-500/20':'bg-white/10'}`}>
                    <Siren className={`w-6 h-6 ${alertForm.severity==='critical'?'text-red-200 animate-pulse':'text-white'}`}/>
                  </div>
                  <div>
                    <h2 className="text-white font-bold text-xl">Emergency Alert Broadcast</h2>
                    <p className="text-white/60 text-sm">Multi-channel public alerting &middot; {loc.name || 'All Regions'}</p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3 mt-4">
                  {[
                    { label: 'Active Alerts', value: alerts.length, color: 'text-red-300' },
                    { label: 'Channels Ready', value: Object.values(alertChannels).filter(Boolean).length, color: 'text-green-300' },
                    { label: 'Coverage', value: `${loc.name || 'Region'}`, color: 'text-cyan-300' },
                  ].map((s,i)=>(
                    <div key={i} className="bg-white/5 rounded-xl p-3 border border-white/10">
                      <p className="text-[10px] text-white/50 uppercase tracking-wider font-semibold">{s.label}</p>
                      <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Alert Form Card */}
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-lg overflow-hidden">
              <div className="p-5 space-y-4">
                {/* Severity Selection — Visual Buttons */}
                <div>
                  <label className="text-xs font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider block mb-2">Alert Severity Level</label>
                  <div className="grid grid-cols-3 gap-2">
                    {([['critical','Critical','Immediate life-threatening danger','bg-red-600','bg-red-100 text-red-700 border-red-400 dark:bg-red-900/30 dark:text-red-300 dark:border-red-600'],['warning','Warning','Potential threat approaching','bg-amber-500','bg-amber-100 text-amber-700 border-amber-400 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-600'],['info','Advisory','Situational awareness update','bg-blue-500','bg-blue-100 text-blue-700 border-blue-400 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-600']] as const).map(([val,label,desc,dot,active])=>(
                      <button key={val} onClick={()=>setAlertForm(f=>({...f,severity:val}))} className={`p-3 rounded-xl border-2 text-left transition-all ${alertForm.severity===val?active+' ring-2 ring-offset-1 ring-current shadow-md':'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600'}`}>
                        <div className="flex items-center gap-2 mb-1">
                          <div className={`w-3 h-3 rounded-full ${dot} ${alertForm.severity===val&&val==='critical'?'animate-pulse':''}`}/>
                          <span className="text-xs font-bold">{label}</span>
                        </div>
                        <p className="text-[10px] text-gray-500 dark:text-gray-400">{desc}</p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Title */}
                <div>
                  <label className="text-xs font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider block mb-1.5">Alert Title *</label>
                  <input className="w-full px-4 py-3 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-red-500 outline-none font-medium" placeholder="e.g. Flash Flood Warning — River Don" value={alertForm.title} onChange={e=>setAlertForm(f=>({...f,title:e.target.value}))}/>
                </div>

                {/* Message */}
                <div>
                  <label className="text-xs font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider block mb-1.5">Alert Message *</label>
                  <textarea className="w-full px-4 py-3 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-red-500 outline-none min-h-[120px] leading-relaxed" placeholder="Provide detailed alert information including specific instructions for the public..." value={alertForm.message} onChange={e=>setAlertForm(f=>({...f,message:e.target.value}))}/>
                  <p className="text-[10px] text-gray-400 mt-1">{alertForm.message.length} characters &middot; {alertForm.message.length<20&&alertForm.message.length>0?'⚠ Too short — provide more detail':'Aim for clear, actionable language'}</p>
                </div>

                {/* Affected Area */}
                <div>
                  <label className="text-xs font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider block mb-1.5">Affected Area / Location</label>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"/>
                    <input className="w-full pl-10 pr-4 py-3 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-red-500 outline-none" placeholder="e.g. City Centre, Bridge of Don, Coastal areas" value={alertForm.location} onChange={e=>setAlertForm(f=>({...f,location:e.target.value}))}/>
                  </div>
                </div>
              </div>

              {/* Multi-channel delivery — Enhanced */}
              <div className="px-5 pb-5">
                <div className="bg-gradient-to-br from-gray-50 to-slate-50 dark:from-gray-800/50 dark:to-gray-800/30 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="text-xs font-bold text-gray-700 dark:text-gray-300 flex items-center gap-1.5"><Send className="w-3.5 h-3.5 text-blue-500"/> Delivery Channels</p>
                      <p className="text-[10px] text-gray-500 mt-0.5">Select channels for broadcasting. Critical alerts auto-enable all.</p>
                    </div>
                    <button onClick={()=>setAlertChannels({web:true,telegram:true,email:true,sms:true,whatsapp:true})} className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 hover:underline">Select All</button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                    {([['web','Web Push','Bell','bg-blue-100 dark:bg-blue-900/30','text-blue-600','border-blue-400'],['telegram','Telegram','Send','bg-sky-100 dark:bg-sky-900/30','text-sky-600','border-sky-400'],['email','Email','FileText','bg-green-100 dark:bg-green-900/30','text-green-600','border-green-400'],['sms','SMS','MessageSquare','bg-purple-100 dark:bg-purple-900/30','text-purple-600','border-purple-400'],['whatsapp','WhatsApp','Globe','bg-emerald-100 dark:bg-emerald-900/30','text-emerald-600','border-emerald-400']] as [string,string,string,string,string,string][]).map(([ch,label,_,bg,txt,brd])=>(
                      <label key={ch} className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 cursor-pointer transition-all text-center ${alertChannels[ch as keyof typeof alertChannels]?`${bg} ${brd} shadow-sm`:'border-gray-200 dark:border-gray-700 hover:border-gray-300'}`}>
                        <input type="checkbox" checked={alertChannels[ch as keyof typeof alertChannels]} onChange={e=>setAlertChannels(prev=>({...prev,[ch]:e.target.checked}))} className="sr-only"/>
                        <div className={`w-8 h-8 rounded-lg ${alertChannels[ch as keyof typeof alertChannels]?bg:'bg-gray-100 dark:bg-gray-800'} flex items-center justify-center`}>
                          {ch==='web'?<Bell className={`w-4 h-4 ${alertChannels[ch as keyof typeof alertChannels]?txt:'text-gray-400'}`}/>:ch==='telegram'?<Send className={`w-4 h-4 ${alertChannels[ch as keyof typeof alertChannels]?txt:'text-gray-400'}`}/>:ch==='email'?<FileText className={`w-4 h-4 ${alertChannels[ch as keyof typeof alertChannels]?txt:'text-gray-400'}`}/>:ch==='sms'?<MessageSquare className={`w-4 h-4 ${alertChannels[ch as keyof typeof alertChannels]?txt:'text-gray-400'}`}/>:<Globe className={`w-4 h-4 ${alertChannels[ch as keyof typeof alertChannels]?txt:'text-gray-400'}`}/>}
                        </div>
                        <span className={`text-[10px] font-bold ${alertChannels[ch as keyof typeof alertChannels]?txt:'text-gray-500'}`}>{label}</span>
                        <span className={`text-[8px] font-bold uppercase ${alertChannels[ch as keyof typeof alertChannels]?'text-green-600':'text-gray-400'}`}>{alertChannels[ch as keyof typeof alertChannels]?'ON':'OFF'}</span>
                      </label>
                    ))}
                  </div>
                  {!Object.values(alertChannels).some(Boolean)&&<div className="mt-2 flex items-center gap-1.5 text-red-600"><AlertTriangle className="w-3.5 h-3.5"/><p className="text-[10px] font-bold">Select at least one delivery channel to broadcast</p></div>}
                </div>
              </div>

              {/* Preview Bar */}
              {alertForm.title&&alertForm.message&&(
                <div className="px-5 pb-4">
                  <div className={`rounded-xl p-3 border-l-4 ${alertForm.severity==='critical'?'bg-red-50 dark:bg-red-950/20 border-red-500':alertForm.severity==='warning'?'bg-amber-50 dark:bg-amber-950/20 border-amber-500':'bg-blue-50 dark:bg-blue-950/20 border-blue-500'}`}>
                    <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Preview</p>
                    <p className="text-sm font-bold text-gray-900 dark:text-white">{alertForm.title}</p>
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 line-clamp-2">{alertForm.message}</p>
                    <div className="flex items-center gap-3 mt-2 text-[10px] text-gray-500">
                      {alertForm.location&&<span className="flex items-center gap-1"><MapPin className="w-3 h-3"/>{alertForm.location}</span>}
                      <span className="flex items-center gap-1"><Clock className="w-3 h-3"/>{new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</span>
                      <span>{Object.values(alertChannels).filter(Boolean).length} channel{Object.values(alertChannels).filter(Boolean).length!==1?'s':''}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Send Button */}
              <div className="px-5 pb-5">
                <button onClick={sendAlert} disabled={!Object.values(alertChannels).some(Boolean)||!alertForm.title||!alertForm.message} className={`w-full py-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2.5 transition-all shadow-lg ${alertForm.severity==='critical'?'bg-gradient-to-r from-red-600 to-rose-700 hover:from-red-700 hover:to-rose-800 shadow-red-500/20':'bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 shadow-red-500/10'} text-white disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed disabled:shadow-none`}>
                  <Siren className="w-5 h-5"/> Broadcast Emergency Alert
                </button>
                {(!alertForm.title||!alertForm.message)&&<p className="text-[10px] text-gray-400 text-center mt-2">Fill in title and message to enable broadcast</p>}
              </div>
            </div>

            {/* Recent Alerts History */}
            {alerts.length>0&&(
              <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-lg overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                  <h3 className="text-sm font-bold flex items-center gap-2"><History className="w-4 h-4 text-gray-500"/> Recent Alert Broadcasts</h3>
                  <span className="text-[10px] text-gray-500">{alerts.length} sent</span>
                </div>
                <div className="divide-y divide-gray-100 dark:divide-gray-800 max-h-[200px] overflow-y-auto">
                  {alerts.slice(0,6).map(a=>(
                    <div key={a.id} className="px-5 py-2.5 flex items-center gap-3">
                      <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${a.severity==='high'?'bg-red-500 animate-pulse':a.severity==='medium'?'bg-amber-500':'bg-blue-500'}`}/>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-gray-900 dark:text-white truncate">{a.title}</p>
                        <p className="text-[10px] text-gray-500">{new Date(a.timestamp||Date.now()).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</p>
                      </div>
                      <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold ${a.severity==='high'?'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300':a.severity==='medium'?'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300':'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'}`}>{a.severity}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* ═══ REPORT DETAIL MODAL — Professional Glassmorphism Design ═══ */}
      {selReport&&(()=>{
        const mediaItems = selReport.media && selReport.media.length > 0
          ? selReport.media
          : selReport.mediaUrl ? [{ id: 'legacy', url: selReport.mediaUrl, file_url: selReport.mediaUrl, aiAnalysis: null }] : []
        const sevGradient = selReport.severity==='High'?'from-red-600 via-red-700 to-rose-800':selReport.severity==='Medium'?'from-amber-500 via-amber-600 to-orange-600':'from-blue-500 via-blue-600 to-indigo-600'
        const sevGlow = selReport.severity==='High'?'shadow-red-500/20':selReport.severity==='Medium'?'shadow-amber-500/20':'shadow-blue-500/20'
        const statusConfig: Record<string,{bg:string,text:string,dot:string}> = {
          Urgent:{bg:'bg-red-100 dark:bg-red-950/40',text:'text-red-700 dark:text-red-300',dot:'bg-red-500'},
          Verified:{bg:'bg-emerald-100 dark:bg-emerald-950/40',text:'text-emerald-700 dark:text-emerald-300',dot:'bg-emerald-500'},
          Flagged:{bg:'bg-amber-100 dark:bg-amber-950/40',text:'text-amber-700 dark:text-amber-300',dot:'bg-amber-500'},
          Resolved:{bg:'bg-slate-100 dark:bg-slate-800/40',text:'text-slate-600 dark:text-slate-300',dot:'bg-slate-400'},
          Unverified:{bg:'bg-sky-100 dark:bg-sky-950/40',text:'text-sky-700 dark:text-sky-300',dot:'bg-sky-500'},
          Archived:{bg:'bg-gray-200 dark:bg-gray-800/40',text:'text-gray-500 dark:text-gray-400',dot:'bg-gray-400'},
          False_Report:{bg:'bg-rose-100 dark:bg-rose-950/40',text:'text-rose-700 dark:text-rose-300',dot:'bg-rose-600'},
        }
        const sc = statusConfig[selReport.status] || statusConfig.Unverified
        const catIcons: Record<string,any> = { natural_disaster:Droplets, infrastructure:Building2, public_safety:ShieldAlert, community_safety:Users, environmental:Flame, medical:HeartPulse }
        const CatIcon = catIcons[selReport.incidentCategory] || AlertTriangle

        // Category-specific recommended actions
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
          // Default fallback
          if (sev === 'High') return ['Immediate deployment of emergency services','Evacuate affected area within 500m radius','Activate emergency barriers','Issue public alert via all channels']
          if (sev === 'Medium') return ['Monitor area closely for escalation','Pre-position emergency resources nearby','Issue advisory to local residents']
          return ['Continue monitoring','Log for historical analysis']
        }

        return <>
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-start sm:items-center justify-center p-0 sm:p-4 z-[70] animate-fade-in" onClick={()=>{setSelReport(null);setGalleryOpen(false)}}>
          <div className={`bg-white dark:bg-gray-900 sm:rounded-2xl shadow-2xl ${sevGlow} w-full max-w-2xl h-full sm:h-auto sm:max-h-[92vh] overflow-hidden flex flex-col`} onClick={e=>e.stopPropagation()}>
            {/* Gradient Header with severity-based theming */}
            <div className={`bg-gradient-to-r ${sevGradient} p-4 sm:p-5 relative overflow-hidden`}>
              <div className="absolute inset-0 opacity-10"><div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-white/20 blur-2xl"/><div className="absolute -bottom-10 -left-10 w-32 h-32 rounded-full bg-white/10 blur-2xl"/></div>
              <div className="relative flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <CatIcon className="w-5 h-5 text-white/80"/>
                    <span className="text-white/70 text-[10px] font-mono tracking-wider uppercase">{selReport.reportNumber}</span>
                  </div>
                  <h3 className="font-bold text-white text-base sm:text-lg leading-tight truncate">{selReport.type || selReport.incidentCategory}</h3>
                  <p className="text-white/60 text-xs mt-1 flex items-center gap-3">
                    <span className="flex items-center gap-1"><Clock className="w-3 h-3"/>{new Date(selReport.timestamp).toLocaleString()}</span>
                    <span className="flex items-center gap-1"><MapPin className="w-3 h-3"/>{selReport.location?.substring(0,40)}{(selReport.location?.length||0)>40?'...':''}</span>
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={()=>handleShareReport(selReport)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/20 hover:bg-white/30 text-white transition-all" title="Share Report"><Share2 className="w-4 h-4"/></button>
                  <button onClick={()=>printSingleReport(selReport)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/20 hover:bg-white/30 text-white transition-all" title="Print Report"><Printer className="w-4 h-4"/></button>
                  <button onClick={()=>{setSelReport(null);setGalleryOpen(false)}} className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/20 hover:bg-white/30 text-white transition-all"><X className="w-4 h-4"/></button>
                </div>
              </div>
              {/* Status & Severity pills */}
              <div className="relative flex gap-2 mt-3 flex-wrap">
                <span className={`text-[10px] px-2.5 py-1 rounded-full font-extrabold uppercase tracking-wider ${selReport.severity==='High'?'bg-red-200/80 text-red-900':selReport.severity==='Medium'?'bg-amber-200/80 text-amber-900':'bg-blue-200/80 text-blue-900'}`}>{selReport.severity} Severity</span>
                <span className={`text-[10px] px-2.5 py-1 rounded-full font-bold flex items-center gap-1 ${sc.bg} ${sc.text}`}><span className={`w-1.5 h-1.5 rounded-full ${sc.dot} animate-pulse`}/>{selReport.status === 'False_Report' ? 'False Report' : selReport.status}</span>
                {selReport.trappedPersons==='yes'&&<span className="text-[10px] px-2.5 py-1 rounded-full bg-red-500 text-white font-extrabold animate-pulse flex items-center gap-1"><AlertTriangle className="w-3 h-3"/>TRAPPED PERSONS</span>}
                {selReport.confidence!=null&&<span className={`text-[10px] px-2.5 py-1 rounded-full font-bold ${(selReport.confidence||0)>=80?'bg-green-200/80 text-green-900':(selReport.confidence||0)>=50?'bg-amber-200/80 text-amber-900':'bg-red-200/80 text-red-900'}`}><Brain className="w-3 h-3 inline mr-0.5"/>{selReport.confidence}% AI</span>}
              </div>
            </div>

            {/* Scrollable content body */}
            <div className="overflow-y-auto flex-1 p-4 sm:p-5 space-y-4">
              {/* Key Information Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  {icon:Hash,label:'Report ID',value:selReport.reportNumber||'N/A'},
                  {icon:Clock,label:'Submitted',value:selReport.displayTime||new Date(selReport.timestamp).toLocaleString()},
                  {icon:User,label:'Reporter',value:selReport.reporter||'Anonymous Citizen'},
                  {icon:Globe,label:'GPS',value:selReport.coordinates?`${selReport.coordinates[0].toFixed(4)}, ${selReport.coordinates[1].toFixed(4)}`:'N/A'},
                ].map((item,i)=>(
                  <div key={i} className="bg-gray-50/80 dark:bg-gray-800/50 rounded-xl p-2.5 border border-gray-100 dark:border-gray-800">
                    <div className="flex items-center gap-1.5 mb-1"><item.icon className="w-3 h-3 text-gray-400"/><span className="text-[9px] text-gray-400 font-bold uppercase tracking-wider">{item.label}</span></div>
                    <p className="text-xs font-semibold text-gray-800 dark:text-gray-200 truncate">{item.value}</p>
                  </div>
                ))}
              </div>

              {/* Location & Description */}
              <div className="space-y-3">
                <div className="bg-gray-50/80 dark:bg-gray-800/50 rounded-xl p-3 border border-gray-100 dark:border-gray-800">
                  <p className="text-[9px] text-gray-400 font-bold uppercase tracking-wider mb-1 flex items-center gap-1"><MapPin className="w-3 h-3"/>Location</p>
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{selReport.location||'Not specified'}</p>
                </div>
                <div className="bg-gray-50/80 dark:bg-gray-800/50 rounded-xl p-3 border border-gray-100 dark:border-gray-800">
                  <p className="text-[9px] text-gray-400 font-bold uppercase tracking-wider mb-1 flex items-center gap-1"><FileText className="w-3 h-3"/>Description</p>
                  <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{selReport.description||'No description provided.'}</p>
                </div>
              </div>

              {/* AI Analysis — Professional Card */}
              <div className="bg-gradient-to-br from-indigo-50/80 via-blue-50/40 to-purple-50/80 dark:from-indigo-950/30 dark:via-blue-950/20 dark:to-purple-950/30 rounded-xl p-4 border border-indigo-100/60 dark:border-indigo-800/30">
                <h4 className="text-xs font-extrabold flex items-center gap-2 text-indigo-800 dark:text-indigo-200 mb-3"><Brain className="w-4 h-4 text-indigo-500"/>AI Intelligence Analysis</h4>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {[
                    {label:'Confidence',value:`${selReport.confidence||0}%`,color:(selReport.confidence||0)>=80?'text-green-600':(selReport.confidence||0)>=50?'text-amber-600':'text-red-600'},
                    {label:'Panic',value:selReport.aiAnalysis?.panicLevel||selReport.aiAnalysis?.panic_level||'N/A',color:'text-gray-800 dark:text-gray-200'},
                    {label:'Fake Risk',value:`${selReport.aiAnalysis?.fakeProbability||selReport.aiAnalysis?.fake_probability||0}%`,color:(selReport.aiAnalysis?.fakeProbability||selReport.aiAnalysis?.fake_probability||0)>50?'text-red-600':'text-green-600'},
                    {label:'Sentiment',value:selReport.aiAnalysis?.sentimentScore?`${(selReport.aiAnalysis.sentimentScore*100).toFixed(0)}%`:'N/A',color:'text-gray-800 dark:text-gray-200'},
                    {label:'Photo',value:selReport.aiAnalysis?.photoVerified||selReport.aiAnalysis?.photo_verified?'Verified':'Pending',color:selReport.aiAnalysis?.photoVerified||selReport.aiAnalysis?.photo_verified?'text-green-600':'text-amber-500'},
                    {label:'Depth',value:selReport.aiAnalysis?.estimatedWaterDepth||selReport.aiAnalysis?.water_depth||'N/A',color:'text-gray-800 dark:text-gray-200'},
                  ].map((m,i)=>(
                    <div key={i} className="text-center bg-white/60 dark:bg-gray-900/40 rounded-lg p-2 border border-white/50 dark:border-gray-700/30">
                      <p className="text-[8px] text-gray-400 font-bold uppercase">{m.label}</p>
                      <p className={`text-sm font-extrabold ${m.color}`}>{m.value}</p>
                    </div>
                  ))}
                </div>
                {(selReport.aiAnalysis?.crossReferenced||selReport.aiAnalysis?.sources)&&(
                  <div className="mt-2 text-[10px] text-indigo-600 dark:text-indigo-300"><span className="font-bold">Sources:</span> {(selReport.aiAnalysis?.crossReferenced||[]).join(', ')||selReport.aiAnalysis?.sources}</div>
                )}
                {/* AI provider badge */}
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {selReport.aiAnalysis?.mlPowered === true ? (
                    <span className="inline-flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse inline-block"/> ML Powered
                    </span>
                  ) : selReport.aiAnalysis?.mlPowered === false ? (
                    <span className="inline-flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block"/> Heuristic Only
                    </span>
                  ) : null}
                  {(selReport.aiAnalysis?.modelsUsed||[]).map((m:string,i:number)=>(
                    <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-mono">{m}</span>
                  ))}
                  {selReport.aiAnalysis?.predictedCategory&&(
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 font-semibold">Cat: {selReport.aiAnalysis.predictedCategory}</span>
                  )}
                </div>
                {selReport.aiAnalysis?.reasoning&&<div className="mt-2 bg-white/40 dark:bg-gray-900/30 rounded-lg p-2 border border-indigo-100/40 dark:border-indigo-800/20"><p className="text-[10px] font-bold text-indigo-700 dark:text-indigo-300 mb-0.5">AI Reasoning</p><p className="text-[11px] text-gray-600 dark:text-gray-400 leading-relaxed">{selReport.aiAnalysis.reasoning}</p></div>}
                {selReport.aiAnalysis?.photoValidation&&<div className="mt-2 bg-blue-50/60 dark:bg-blue-950/20 rounded-lg p-2 border border-blue-200/40 dark:border-blue-800/20"><p className="text-[10px] font-bold text-blue-700 dark:text-blue-300">Detected: {selReport.aiAnalysis.photoValidation.objectsDetected?.join(', ')||'N/A'}</p></div>}
              </div>

              {/* Recommended Actions — Category-Specific */}
              <div className="bg-gradient-to-br from-emerald-50/80 to-green-50/80 dark:from-emerald-950/30 dark:to-green-950/30 rounded-xl p-3 border border-emerald-100/60 dark:border-emerald-800/30">
                <h4 className="text-xs font-extrabold flex items-center gap-2 text-emerald-800 dark:text-emerald-200 mb-2"><CheckCircle className="w-3.5 h-3.5 text-emerald-500"/>Recommended Actions</h4>
                <ul className="space-y-1">
                  {getRecommendedActions().map((action,i)=>(
                    <li key={i} className="text-[11px] text-gray-700 dark:text-gray-300 flex items-start gap-2"><CircleDot className="w-3 h-3 text-emerald-400 mt-0.5 flex-shrink-0"/><span>{action}</span></li>
                  ))}
                </ul>
              </div>

              {/* Status Timeline */}
              <div className="bg-gray-50/80 dark:bg-gray-800/50 rounded-xl p-3 border border-gray-100 dark:border-gray-800">
                <h4 className="text-xs font-extrabold flex items-center gap-2 text-gray-700 dark:text-gray-200 mb-2"><Clock className="w-3.5 h-3.5 text-gray-400"/>Status Timeline</h4>
                <div className="space-y-2 border-l-2 border-gray-200 dark:border-gray-700 pl-4 ml-1">
                  <div className="relative"><div className="absolute -left-[21px] top-0.5 w-3 h-3 rounded-full bg-blue-500 border-2 border-white dark:border-gray-900 shadow-sm"/><p className="text-[10px] text-gray-400">{new Date(selReport.timestamp).toLocaleString()}</p><p className="text-[11px] font-semibold text-gray-700 dark:text-gray-300">Report submitted by citizen</p></div>
                  <div className="relative"><div className="absolute -left-[21px] top-0.5 w-3 h-3 rounded-full bg-purple-500 border-2 border-white dark:border-gray-900 shadow-sm"/><p className="text-[10px] text-gray-400">{new Date(new Date(selReport.timestamp).getTime()+30000).toLocaleString()}</p><p className="text-[11px] font-semibold text-gray-700 dark:text-gray-300">AI analysis completed — {selReport.confidence||0}% confidence</p></div>
                  {selReport.verifiedAt&&<div className="relative"><div className="absolute -left-[21px] top-0.5 w-3 h-3 rounded-full bg-green-500 border-2 border-white dark:border-gray-900 shadow-sm"/><p className="text-[10px] text-gray-400">{new Date(selReport.verifiedAt).toLocaleString()}</p><p className="text-[11px] font-semibold text-gray-700 dark:text-gray-300">Verified by operator</p></div>}
                  {selReport.status!=='Unverified'&&!selReport.verifiedAt&&<div className="relative"><div className="absolute -left-[21px] top-0.5 w-3 h-3 rounded-full bg-green-500 border-2 border-white dark:border-gray-900 shadow-sm"/><p className="text-[10px] text-gray-400">{new Date(new Date(selReport.timestamp).getTime()+120000).toLocaleString()}</p><p className="text-[11px] font-semibold text-gray-700 dark:text-gray-300">Status changed to {selReport.status === 'False_Report' ? 'False Report' : selReport.status}</p></div>}
                  {selReport.resolvedAt&&<div className="relative"><div className="absolute -left-[21px] top-0.5 w-3 h-3 rounded-full bg-slate-400 border-2 border-white dark:border-gray-900 shadow-sm"/><p className="text-[10px] text-gray-400">{new Date(selReport.resolvedAt).toLocaleString()}</p><p className="text-[11px] font-semibold text-gray-700 dark:text-gray-300">Report resolved</p></div>}
                </div>
              </div>

              {/* Evidence Gallery — Enhanced with Animations */}
              {mediaItems.length > 0 && (
                <div className="bg-gradient-to-br from-purple-50/80 to-pink-50/80 dark:from-purple-950/30 dark:to-pink-950/30 rounded-xl p-3 border border-purple-100/60 dark:border-purple-800/30">
                  <h4 className="text-xs font-extrabold flex items-center gap-2 text-purple-800 dark:text-purple-200 mb-2"><Camera className="w-3.5 h-3.5 text-purple-500"/>Evidence Gallery <span className="text-purple-400 font-normal">({mediaItems.length} photo{mediaItems.length!==1?'s':''})</span></h4>
                  <div className={`grid gap-2 ${mediaItems.length===1?'grid-cols-1':mediaItems.length===2?'grid-cols-2':'grid-cols-3'}`}>
                    {mediaItems.map((m:any,i:number)=>(
                      <div key={m.id||i} className="relative group cursor-pointer rounded-xl overflow-hidden border-2 border-purple-200/40 dark:border-purple-700/30 hover:border-purple-400 dark:hover:border-purple-500 transition-all hover:shadow-lg hover:shadow-purple-500/10 hover:scale-[1.02]" onClick={()=>{setGalleryIndex(i);setGalleryOpen(true)}}>
                        <img src={m.url||m.file_url} alt={`Evidence ${i+1}`} className={`w-full object-cover transition-transform group-hover:scale-110 duration-300 ${mediaItems.length===1?'max-h-52':'h-32'}`}/>
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end p-2">
                          <span className="text-white text-[10px] font-bold flex items-center gap-1"><ZoomIn className="w-3 h-3"/>View Full</span>
                        </div>
                        <div className="absolute top-1.5 right-1.5 bg-black/60 backdrop-blur-sm text-white text-[9px] font-bold px-2 py-0.5 rounded-full">{i+1}/{mediaItems.length}</div>
                        {m.aiAnalysis&&(
                          <div className="absolute top-1.5 left-1.5 bg-indigo-600/80 backdrop-blur-sm text-white text-[8px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-0.5"><Brain className="w-2.5 h-2.5"/>Analyzed</div>
                        )}
                      </div>
                    ))}
                  </div>
                  {mediaItems.some((m:any)=>m.aiAnalysis)&&(
                    <div className="mt-2 space-y-1">
                      {mediaItems.filter((m:any)=>m.aiAnalysis).map((m:any,i:number)=>(
                        <div key={i} className="flex items-center gap-2 bg-white/40 dark:bg-gray-900/30 rounded-lg px-2 py-1 text-[9px]">
                          <span className="text-purple-500 font-bold">Photo {i+1}:</span>
                          {m.aiAnalysis.classification&&<span className="text-gray-600 dark:text-gray-400">Class: <strong>{m.aiAnalysis.classification}</strong></span>}
                          {m.aiAnalysis.waterDepth&&<span className="text-gray-600 dark:text-gray-400">Depth: <strong>{m.aiAnalysis.waterDepth}</strong></span>}
                          {m.aiAnalysis.authenticityScore!==undefined&&<span className="text-gray-600 dark:text-gray-400">Auth: <strong>{m.aiAnalysis.authenticityScore}%</strong></span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {mediaItems.length===0&&selReport.hasMedia&&(
                <div className="text-center py-4 text-gray-400 text-xs italic">Media reported but files not yet available</div>
              )}

              {/* Operator Notes — Inline Edit */}
              <div className="bg-gray-50/80 dark:bg-gray-800/50 rounded-xl p-3 border border-gray-100 dark:border-gray-800">
                <h4 className="text-xs font-extrabold flex items-center gap-2 text-gray-700 dark:text-gray-200 mb-2"><Edit2 className="w-3.5 h-3.5 text-gray-400"/>Operator Notes</h4>
                <p className="text-xs text-gray-500 dark:text-gray-400 italic">{selReport.operatorNotes || 'No operator notes added yet.'}</p>
              </div>

              {/* Action Buttons — Status-locked once decided, super-admin can override */}
              {(()=>{
                const decided = ['Verified','Urgent','False_Report','Resolved','Archived'].includes(selReport.status)
                const isSuperAdmin = user?.role === 'admin' || user?.department === 'Command & Control'
                const canAct = !decided || isSuperAdmin
                return (
                  <div className="space-y-2 pt-1">
                    {decided && !isSuperAdmin && (
                      <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 rounded-xl text-xs text-amber-700 dark:text-amber-300">
                        <svg className="w-3.5 h-3.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd"/></svg>
                        Status locked — this report has been actioned. Super-admin override required.
                      </div>
                    )}
                    {decided && isSuperAdmin && (
                      <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/40 rounded-xl text-xs text-blue-700 dark:text-blue-300">
                        <svg className="w-3.5 h-3.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd"/></svg>
                        Super-admin override — a justification is required to change this status.
                      </div>
                    )}
                    <div className={`grid grid-cols-2 sm:grid-cols-4 gap-2 ${!canAct ? 'opacity-40 pointer-events-none' : ''}`}>
                      <button onClick={()=>canAct&&doVerify(selReport.id)} disabled={!canAct} className="group text-[11px] bg-emerald-50 dark:bg-emerald-950/20 hover:bg-emerald-100 dark:hover:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/40 py-2.5 rounded-xl font-bold flex items-center justify-center gap-1.5 transition-all hover:shadow-md hover:shadow-emerald-500/10 disabled:cursor-not-allowed"><CheckCircle className="w-4 h-4 group-hover:scale-110 transition-transform"/> Verify</button>
                      <button onClick={()=>canAct&&doFlag(selReport.id)} disabled={!canAct} className="group text-[11px] bg-amber-50 dark:bg-amber-950/20 hover:bg-amber-100 dark:hover:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/40 py-2.5 rounded-xl font-bold flex items-center justify-center gap-1.5 transition-all hover:shadow-md hover:shadow-amber-500/10 disabled:cursor-not-allowed"><Flag className="w-4 h-4 group-hover:scale-110 transition-transform"/> Flag</button>
                      <button onClick={()=>canAct&&doUrgent(selReport.id)} disabled={!canAct} className="group text-[11px] bg-red-50 dark:bg-red-950/20 hover:bg-red-100 dark:hover:bg-red-950/40 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800/40 py-2.5 rounded-xl font-bold flex items-center justify-center gap-1.5 transition-all hover:shadow-md hover:shadow-red-500/10 disabled:cursor-not-allowed"><Siren className="w-4 h-4 group-hover:scale-110 transition-transform"/> Urgent</button>
                      <button onClick={()=>canAct&&doResolve(selReport.id)} disabled={!canAct} className="group text-[11px] bg-slate-50 dark:bg-slate-800/40 hover:bg-slate-100 dark:hover:bg-slate-700/40 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700/40 py-2.5 rounded-xl font-bold flex items-center justify-center gap-1.5 transition-all hover:shadow-md hover:shadow-slate-500/10 disabled:cursor-not-allowed"><CheckCircle2 className="w-4 h-4 group-hover:scale-110 transition-transform"/> Resolve</button>
                    </div>
                    <div className={`grid grid-cols-2 gap-2 ${!canAct ? 'opacity-40 pointer-events-none' : ''}`}>
                      <button onClick={()=>canAct&&doArchive(selReport.id)} disabled={!canAct} className="group text-[11px] bg-gray-50 dark:bg-gray-800/40 hover:bg-gray-100 dark:hover:bg-gray-700/40 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700/40 py-2 rounded-xl font-semibold flex items-center justify-center gap-1.5 transition-all hover:shadow-md disabled:cursor-not-allowed"><Archive className="w-3.5 h-3.5 group-hover:scale-110 transition-transform"/> Archive</button>
                      <button onClick={()=>canAct&&doFalseReport(selReport.id)} disabled={!canAct} className="group text-[11px] bg-rose-50 dark:bg-rose-950/20 hover:bg-rose-100 dark:hover:bg-rose-950/40 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800/40 py-2 rounded-xl font-semibold flex items-center justify-center gap-1.5 transition-all hover:shadow-md disabled:cursor-not-allowed"><XCircle className="w-3.5 h-3.5 group-hover:scale-110 transition-transform"/> False Report</button>
                    </div>
                  </div>
                )
              })()}
            </div>
          </div>
        </div>

        {/* ═══ FULLSCREEN PHOTO GALLERY OVERLAY ═══ */}
        {galleryOpen && mediaItems.length > 0 && (
          <div className="fixed inset-0 bg-black/95 backdrop-blur-xl z-[70] flex flex-col animate-fade-in" onClick={()=>setGalleryOpen(false)}>
            {/* Gallery Header */}
            <div className="flex-shrink-0 flex items-center justify-between px-4 sm:px-6 py-3 bg-gradient-to-b from-black/80 to-transparent relative z-10" onClick={e=>e.stopPropagation()}>
              <div className="flex items-center gap-3">
                <Camera className="w-5 h-5 text-purple-400"/>
                <div>
                  <p className="text-white text-sm font-bold">Evidence Photo {galleryIndex+1} of {mediaItems.length}</p>
                  <p className="text-white/50 text-[10px]">{selReport.reportNumber} — {selReport.type}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={()=>window.open(mediaItems[galleryIndex]?.url||mediaItems[galleryIndex]?.file_url,'_blank')} className="w-9 h-9 flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 text-white transition-all" title="Open Original"><ExternalLink className="w-4 h-4"/></button>
                <button onClick={()=>setGalleryOpen(false)} className="w-9 h-9 flex items-center justify-center rounded-lg bg-white/10 hover:bg-red-500/80 text-white transition-all" title="Close Gallery"><X className="w-5 h-5"/></button>
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
                  <span className="text-purple-400 font-bold"><Brain className="w-3 h-3 inline mr-1"/>AI Photo Analysis</span>
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

      {/* ═══ CONFIRMATION MODAL ═══ */}
      {confirmModal&&(
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-[90]">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-sm p-5 space-y-4">
            <h3 className="font-bold text-sm">{confirmModal.title}</h3>
            <p className="text-xs text-gray-600 dark:text-gray-400">{confirmModal.message}</p>
            {(confirmModal.type==='warning'||confirmModal.type==='danger')&&!confirmModal.title.includes('Suspend')&&<textarea className="w-full px-3 py-2 text-xs bg-gray-100 dark:bg-gray-800 rounded-lg min-h-[60px] border-none" placeholder="Justification (optional)" value={justification} onChange={e=>setJustification(e.target.value)}/>}
            {confirmModal.title.includes('Suspend')&&(
              <div className="space-y-2">
                <div>
                  <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Suspension Reason *</label>
                  <textarea className="w-full px-3 py-2 text-xs bg-gray-100 dark:bg-gray-800 rounded-lg min-h-[60px] border border-gray-200 dark:border-gray-700" placeholder="Enter reason for suspension..." value={suspendForm.reason} onChange={e=>setSuspendForm(f=>({...f,reason:e.target.value}))} required/>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Duration (optional — leave empty for indefinite)</label>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {[{label:'1 day',days:1},{label:'3 days',days:3},{label:'1 week',days:7},{label:'1 month',days:30},{label:'Indefinite',days:0}].map(({label,days})=>(
                      <button key={label} type="button" onClick={()=>{if(days===0){setSuspendForm(f=>({...f,until:''}))}else{const d=new Date();d.setDate(d.getDate()+days);setSuspendForm(f=>({...f,until:d.toISOString().slice(0,10)}))}}} className="text-[10px] px-2 py-1 rounded-md bg-orange-50 dark:bg-orange-950/30 text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-800 hover:bg-orange-100 dark:hover:bg-orange-900/40 transition-colors">{label}</button>
                    ))}
                  </div>
                  <input type="date" min={new Date().toISOString().slice(0,10)} className="w-full px-3 py-2 text-xs bg-gray-100 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700" value={suspendForm.until} onChange={e=>setSuspendForm(f=>({...f,until:e.target.value}))}/>
                  {suspendForm.until&&<p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1">Suspended until: {new Date(suspendForm.until).toLocaleDateString('en-GB',{dateStyle:'long'})}</p>}
                  {!suspendForm.until&&<p className="text-[10px] text-gray-500 mt-1">No date selected — suspension will be indefinite</p>}
                </div>
              </div>
            )}
            {(confirmModal.title.includes('Deploy')||confirmModal.title.includes('Recall'))&&<div><label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Reason (mandatory) *</label><textarea className="w-full mt-1 px-3 py-2 text-xs bg-gray-100 dark:bg-gray-800 rounded-lg min-h-[60px] border border-gray-200 dark:border-gray-700" placeholder="Enter deployment/recall reason..." value={deployReason} onChange={e=>setDeployReason(e.target.value)} required/></div>}
            <div className="flex gap-3">
              <button onClick={()=>{setConfirmModal(null);setJustification('');setDeployReason('');setSuspendForm({until:'',reason:''})}} className="flex-1 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 rounded-xl py-2.5 text-sm font-semibold">Cancel</button>
              <button onClick={()=>{if((confirmModal.title.includes('Deploy')||confirmModal.title.includes('Recall'))&&!deployReason.trim()){return}if(confirmModal.title.includes('Suspend')&&!suspendForm.reason.trim()){return}confirmModal.action();setConfirmModal(null);setJustification('');setDeployReason('');setSuspendForm({until:'',reason:''})}} disabled={((confirmModal.title.includes('Deploy')||confirmModal.title.includes('Recall'))&&!deployReason.trim())||(confirmModal.title.includes('Suspend')&&!suspendForm.reason.trim())} className={`flex-1 text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed ${confirmModal.type==='danger'?'bg-red-600 hover:bg-red-700':confirmModal.type==='warning'?'bg-amber-600 hover:bg-amber-700':'bg-aegis-600 hover:bg-aegis-700'}`}>Confirm</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ FLOATING AI CHATBOT ═══ */}
      {showChatbot && (
        <div className="fixed bottom-20 right-4 z-[70] w-[380px] max-w-[calc(100vw-2rem)] animate-fade-in">
          <Chatbot onClose={() => setShowChatbot(false)} lang={lang} anchor="right" />
        </div>
      )}
      <button onClick={() => setShowChatbot(v => !v)} title="AI Emergency Assistant"
        className={`fixed bottom-4 right-4 z-[70] w-14 h-14 rounded-2xl shadow-xl flex items-center justify-center transition-all duration-300 hover:scale-110 ${
          showChatbot
            ? 'bg-gray-800 dark:bg-gray-200 text-white dark:text-gray-900 rotate-0'
            : 'bg-gradient-to-br from-purple-600 to-indigo-600 text-white shadow-purple-500/30 animate-bounce-slow'
        }`}>
        {showChatbot ? <X className="w-6 h-6" /> : <MessageSquare className="w-6 h-6" />}
        {!showChatbot && <span className="absolute -top-1 -right-1 w-4 h-4 bg-green-500 rounded-full border-2 border-white dark:border-gray-900 animate-pulse" />}
      </button>

      {/* Toasts */}
      <div className="fixed top-16 right-4 z-50 space-y-2">
        {notifications.map(n=>(
          <div key={n.id} onClick={()=>dismissNotification(n.id)} className={`px-4 py-2.5 rounded-xl text-sm shadow-lg cursor-pointer animate-fade-in max-w-xs ${n.type==='success'?'bg-green-600 text-white':n.type==='warning'?'bg-amber-500 text-white':n.type==='error'?'bg-red-600 text-white':'bg-blue-600 text-white'}`}>{n.message}</div>
        ))}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAP VIEW — Live Operations Map with 2D Leaflet + 3D Deck.gl toggle
// ═══════════════════════════════════════════════════════════════════════════════

function MapView({ filtered, loc, filterSeverity, setFilterSeverity, filterStatus, setFilterStatus, socket, user, setSelReport, activeLocation, setActiveLocation, availableLocations }: {
  filtered: any[]; loc: any; filterSeverity: string; setFilterSeverity: (v: string) => void; filterStatus: string; setFilterStatus: (v: string) => void; socket: any; user: any; setSelReport: (r: any) => void;
  activeLocation: string; setActiveLocation: (key: string) => void; availableLocations: { key: string; name: string }[]
}) {
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
              <h2 className="font-bold text-sm leading-tight">Live Operations Map</h2>
              <p className="text-[9px] text-gray-500 dark:text-gray-400 font-medium">Real-time multi-layer intelligence</p>
            </div>
          </div>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          {/* Panel Toggles — glassmorphism pill */}
          <div className="flex bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm rounded-lg p-0.5 ring-1 ring-gray-200/60 dark:ring-gray-700/40 shadow-sm">
            <button onClick={()=>setShowLeftPanel(!showLeftPanel)} className={`px-2.5 py-1.5 text-[10px] font-bold rounded-md transition-all ${showLeftPanel?'bg-blue-600 text-white shadow-md':'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`} title="Toggle Intelligence Panel">
              <span className="flex items-center gap-1"><Brain className="w-3 h-3"/> Intel</span>
            </button>
            <button onClick={()=>setShowRightPanel(!showRightPanel)} className={`px-2.5 py-1.5 text-[10px] font-bold rounded-md transition-all ${showRightPanel?'bg-blue-600 text-white shadow-md':'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`} title="Toggle Layer Controls">
              <span className="flex items-center gap-1"><Layers className="w-3 h-3"/> Layers</span>
            </button>
          </div>
          {/* Region Selector — styled */}
          <select
            value={activeLocation}
            onChange={e => setActiveLocation(e.target.value)}
            className="text-xs bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm px-3 py-1.5 rounded-lg ring-1 ring-gray-200/60 dark:ring-gray-700/40 font-semibold shadow-sm"
          >
            {availableLocations.map(l => (
              <option key={l.key} value={l.key}>{l.name}</option>
            ))}
          </select>
          {/* 2D / 3D Toggle — enhanced */}
          <div className="flex bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm rounded-lg p-0.5 ring-1 ring-gray-200/60 dark:ring-gray-700/40 shadow-sm">
            <button
              onClick={() => setMapMode('2d')}
              className={`px-3 py-1.5 text-[10px] font-bold rounded-md transition-all ${
                mapMode === '2d'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              2D
            </button>
            <button
              onClick={() => setMapMode('3d')}
              className={`px-3 py-1.5 text-[10px] font-bold rounded-md transition-all ${
                mapMode === '3d'
                  ? 'bg-purple-600 text-white shadow-md'
                  : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              3D
            </button>
          </div>
          {/* Filters — styled */}
          <select value={filterSeverity} onChange={e=>setFilterSeverity(e.target.value)} className="text-xs bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm px-2 py-1.5 rounded-lg ring-1 ring-gray-200/60 dark:ring-gray-700/40 shadow-sm"><option value="all">All Severity</option><option value="High">High</option><option value="Medium">Medium</option><option value="Low">Low</option></select>
          <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)} className="text-xs bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm px-2 py-1.5 rounded-lg ring-1 ring-gray-200/60 dark:ring-gray-700/40 shadow-sm"><option value="all">All Status</option><option value="Urgent">Urgent</option><option value="Verified">Verified</option></select>
          {/* Fullscreen Toggle */}
          <button onClick={toggleFullscreen} className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm ring-1 ring-gray-200/60 dark:ring-gray-700/40 shadow-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-all" title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}>
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5"/> : <Maximize2 className="w-3.5 h-3.5"/>}
          </button>
        </div>
      </div>
      <div className={`relative ${isFullscreen ? 'h-[calc(100vh-56px)]' : 'h-[calc(100vh-220px)]'}`}>
        {mapMode === '2d' ? (
          <LiveMap
            reports={filtered}
            center={loc.center}
            zoom={loc.zoom}
            height="100%"
            showFloodPredictions={showFloodPredictions}
            showEvacuationRoutes={showEvacuationRoutes}
            onReportClick={setSelReport}
          />
        ) : (
          <Suspense fallback={<div className="w-full h-full bg-gray-900 flex items-center justify-center"><div className="text-gray-400 text-sm animate-pulse">Loading 3D Engine...</div></div>}>
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
        
        {/* Left overlay: Intelligence + River Levels + Distress — collapsible */}
        {showLeftPanel && (
          <div className="absolute top-3 left-3 z-[1100] flex flex-col gap-2 w-64 xl:w-72 max-h-[calc(100%-24px)] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-600" style={{ pointerEvents: 'auto' }}>
            <IntelligenceDashboard socket={socket} collapsed={true} />
            <RiverLevelPanel socket={socket} />
            <DistressPanel socket={socket} operatorId={user?.id || ''} operatorName={user?.displayName || 'Operator'} />
          </div>
        )}
        
        {/* Right overlay: Layers + Predictions — collapsible */}
        {showRightPanel && (
          <div className="absolute top-14 right-14 z-[1100] flex flex-col gap-2 w-56 xl:w-64" style={{ pointerEvents: 'auto' }}>
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
// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN COMMUNITY SECTION — Live Chat + Posts Feed with sub-tabs + moderation
// ═══════════════════════════════════════════════════════════════════════════════
function AdminCommunitySection() {
  const [subTab, setSubTab] = useState<'chat' | 'posts'>('chat')
  return (
    <div className="space-y-4 animate-fade-in">
      {/* Premium Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-aegis-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-aegis-500/20">
            <Users className="w-5 h-5 text-white"/>
          </div>
          <div>
            <h2 className="font-bold text-xl text-gray-900 dark:text-white">Community Hub</h2>
            <p className="text-xs text-gray-500">Manage live chat and community posts</p>
          </div>
        </div>
      </div>

      {/* Sub-tab bar — Premium pill tabs */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-xl w-fit shadow-inner">
        <button
          onClick={() => setSubTab('chat')}
          className={`px-5 py-2.5 rounded-lg text-xs font-bold transition-all ${
            subTab === 'chat'
              ? 'bg-white dark:bg-gray-700 text-aegis-700 dark:text-white shadow-md'
              : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          <span className="flex items-center gap-1.5">
            <MessageSquare className="w-3.5 h-3.5" />
            Live Chat
          </span>
        </button>
        <button
          onClick={() => setSubTab('posts')}
          className={`px-5 py-2.5 rounded-lg text-xs font-bold transition-all ${
            subTab === 'posts'
              ? 'bg-white dark:bg-gray-700 text-aegis-700 dark:text-white shadow-md'
              : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          <span className="flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5" />
            Posts Feed
          </span>
        </button>
      </div>

      {subTab === 'chat' && <CommunityChatRoom />}
      {subTab === 'posts' && <CommunityChat />}
    </div>
  )
}
