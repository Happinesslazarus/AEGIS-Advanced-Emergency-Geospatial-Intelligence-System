/*
 * CitizenDashboard.tsx — Full Citizen Dashboard v6.8
 *
 * 6-tab dashboard with:
 *   1. Overview   — Welcome banner, stats, quick actions, recent activity
 *   2. Messages   — Real-time Socket.IO chat with admin (typing, status, emergency)
 *   3. Safety     — Check-in system (safe/help/unsure) with location
 *   4. Profile    — Edit profile, upload avatar, manage bio/location/vulnerability
 *   5. Security   — Change password
 *   6. Settings   — Notification/audio/caption preferences
 *
 * Features:
 *   - Socket.IO real-time messaging with typing indicators
 *   - Message status (sent/delivered/read) with tick marks
 *   - Create new support threads with category
 *   - Emergency chat auto-escalation
 *   - Profile photo upload with preview
 *   - Password change with strength meter
 *   - Vulnerability indicator management
 */

import { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import {
  Shield, User, MessageSquare, Heart, Settings, Lock, LogOut,
  Bell, ChevronRight, Clock, MapPin, Phone, Mail, Camera,
  Send, Plus, AlertTriangle, CheckCircle, Circle, CircleDot,
  Loader2, Check, CheckCheck, ArrowLeft, Globe, Building2,
  Calendar, Edit3, Save, X, Mic, Volume2, Eye, EyeOff,
  Home, ShieldAlert, Zap, FileText, Activity, Ban, Pencil, Users,
  RefreshCw, ChevronDown, Trash2, AlertCircle as AlertCircleIcon,
  Search, ArrowUpDown, Crosshair, BookOpen, Newspaper, ExternalLink,
  Play, BookMarked, Printer, Share2, Bot, HelpCircle, Info,
  Smartphone, Wifi, Sun, Moon, Flame, Video, Droplets, Waves,
  CloudLightning, ShieldCheck, Languages
} from 'lucide-react'
import { useCitizenAuth } from '../contexts/CitizenAuthContext'
import { type ChatThread, type ChatMessage } from '../hooks/useSocket'
import { useSharedSocket } from '../contexts/SocketContext'
import type { Socket } from 'socket.io-client'
import { useReports } from '../contexts/ReportsContext'
import { useAlerts } from '../contexts/AlertsContext'
import { useLocation } from '../contexts/LocationContext'
import { useTheme } from '../contexts/ThemeContext'
import { t, setLanguage, getLanguage, isRtl } from '../utils/i18n'
import { useLanguage } from '../hooks/useLanguage'
import { TRANSLATION_LANGUAGES, clearTranslationCache } from '../utils/translateService'
import { useWebPush } from '../hooks/useWebPush'
import { apiSubscribe, apiGetNews, type NewsItem } from '../utils/api'
import { COUNTRY_CODES, type CountryCode, formatPhoneWithCountry } from '../data/countryCodes'
import ALL_COUNTRY_CODES from '../data/allCountryCodes'
import CommunityChat from '../components/citizen/CommunityChat'
import CommunityChatRoom from '../components/citizen/CommunityChatRoom'
import SOSButton from '../components/citizen/SOSButton'
import DisasterMap from '../components/shared/DisasterMap'
import ReportCard from '../components/shared/ReportCard'

// Code-split heavy components (loaded on demand per tab)
const Chatbot = lazy(() => import('../components/citizen/Chatbot'))
const LiveMap = lazy(() => import('../components/shared/LiveMap'))
const WeatherPanel = lazy(() => import('../components/shared/WeatherPanel'))
const RiverGaugePanel = lazy(() => import('../components/shared/RiverGaugePanel'))
const IntelligenceDashboard = lazy(() => import('../components/shared/IntelligenceDashboard'))
const ReportForm = lazy(() => import('../components/citizen/ReportForm'))
const CommunityHelp = lazy(() => import('../components/citizen/CommunityHelp'))
const PreparednessGuide = lazy(() => import('../components/citizen/PreparednessGuide'))
const PublicSafetyMode = lazy(() => import('../components/shared/PublicSafetyMode'))
const ClimateRiskDashboard = lazy(() => import('../components/shared/ClimateRiskDashboard'))
import { API_BASE, timeAgo, getPasswordStrength } from '../utils/helpers'
import MessageStatusIcon from '../components/ui/MessageStatusIcon'
import { useAnnounce } from '../hooks/useAnnounce'
import { usePullToRefresh } from '../hooks/usePullToRefresh'
import CountrySearch from '../components/shared/CountrySearch'
import LanguageSelector from '../components/shared/LanguageSelector'
import { EmptyMessages, EmptyReports, EmptySafety } from '../components/ui/EmptyState'
import { SkeletonCard, SkeletonStat, SkeletonList, Skeleton } from '../components/ui/Skeleton'

// Use relative paths so Vite's proxy handles API requests (avoids CORS)
// API_BASE imported from ../utils/helpers

type TabKey = 'overview' | 'livemap' | 'reports' | 'messages' | 'community' | 'prepare' | 'news' | 'safety' | 'profile' | 'security' | 'settings'

const TABS: { key: TabKey; labelKey: string; icon: any }[] = [
  { key: 'overview',  labelKey: 'citizen.tab.overview',  icon: Home },
  { key: 'livemap',   labelKey: 'citizen.tab.livemap',  icon: Globe },
  { key: 'reports',   labelKey: 'citizen.tab.reports',   icon: FileText },
  { key: 'messages',  labelKey: 'citizen.tab.messages',  icon: MessageSquare },
  { key: 'community', labelKey: 'citizen.tab.community', icon: Users },
  { key: 'prepare',   labelKey: 'citizen.tab.prepare', icon: BookOpen },
  { key: 'news',      labelKey: 'citizen.tab.news',      icon: Newspaper },
  { key: 'safety',    labelKey: 'citizen.tab.safety',    icon: ShieldAlert },
  { key: 'profile',   labelKey: 'citizen.tab.profile',   icon: User },
  { key: 'security',  labelKey: 'citizen.tab.security',  icon: Lock },
  { key: 'settings',  labelKey: 'citizen.tab.settings',  icon: Settings },
]

const THREAD_CATEGORIES = [
  { value: 'general', labelKey: 'citizen.thread.generalInquiry' as const },
  { value: 'emergency', labelKey: 'citizen.thread.emergencyHelp' as const },
  { value: 'report', labelKey: 'citizen.thread.reportIssue' as const },
  { value: 'feedback', labelKey: 'citizen.thread.feedback' as const },
  { value: 'account', labelKey: 'citizen.thread.accountSupport' as const },
  { value: 'alert', labelKey: 'citizen.thread.alertFollowup' as const },
]

// getPasswordStrength + timeAgo imported from ../utils/helpers

// MessageStatusIcon imported from ../components/ui/MessageStatusIcon

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export default function CitizenDashboard(): JSX.Element {
  const { user, token, preferences, emergencyContacts, recentSafety, unreadMessages,
    isAuthenticated, loading, logout, updateProfile, uploadAvatar, changePassword,
    updatePreferences, submitSafetyCheckIn, refreshProfile, addEmergencyContact, removeEmergencyContact
  } = useCitizenAuth()

  const socket = useSharedSocket()
  const navigate = useNavigate()
  const lang = useLanguage()
  const { reports, loading: reportsLoading, refreshReports } = useReports()
  const { alerts, notifications, pushNotification, dismissNotification } = useAlerts()
  const { location: loc, availableLocations, activeLocation, setActiveLocation } = useLocation()
  const { dark, toggle: toggleTheme } = useTheme()
  const { status: webPushStatus, subscribe: subscribeToWebPush, loading: webPushLoading } = useWebPush()
  const announce = useAnnounce()

  const [activeTab, setActiveTab] = useState<TabKey>('overview')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [statusColor, setStatusColor] = useState<'green' | 'yellow' | 'red'>('green')
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false)
  const [showAlertPanel, setShowAlertPanel] = useState(false)
  const [showAssistant, setShowAssistant] = useState(false)
  const [communityUnread, setCommunityUnread] = useState(0)

  // New state for parity features
  const [showReportForm, setShowReportForm] = useState(false)
  const [showCommunityHelp, setShowCommunityHelp] = useState(false)
  const [showPreparednessGuide, setShowPreparednessGuide] = useState(false)
  const [showSubscribe, setShowSubscribe] = useState(false)
  const [showSafetyMode, setShowSafetyMode] = useState(false)
  const [selectedReport, setSelectedReport] = useState<any>(null)
  const [selectedAlert, setSelectedAlert] = useState<any>(null)
  const [reportSearchTerm, setReportSearchTerm] = useState('')
  const [reportSortField, setReportSortField] = useState('timestamp')
  const [reportSortOrder, setReportSortOrder] = useState('desc')
  const [newsItems, setNewsItems] = useState<NewsItem[]>([])
  const [newsRefreshing, setNewsRefreshing] = useState(false)
  const [subChannels, setSubChannels] = useState<string[]>([])
  const [subEmail, setSubEmail] = useState('')
  const [subPhone, setSubPhone] = useState('')
  const [subTelegramId, setSubTelegramId] = useState('')
  const [selectedCountry, setSelectedCountry] = useState<CountryCode>(ALL_COUNTRY_CODES.find(c => c.code === 'GB') || ALL_COUNTRY_CODES[0])
  const [subTopics, setSubTopics] = useState<string[]>(['flood', 'fire', 'storm', 'earthquake', 'heatwave', 'tsunami', 'general'])
  const [userPosition, setUserPosition] = useState<[number,number]|null>(null)

  // Connect socket on mount
  useEffect(() => {
    if (token && !socket.connected) {
      socket.connect(token)
    }
    return () => {
      if (socket.connected) socket.disconnect()
    }
  }, [token])

  // Sync saved user preferences (language, dark mode) on load
  useEffect(() => {
    if (preferences) {
      if (preferences.language && preferences.language !== getLanguage()) {
        setLanguage(preferences.language)
      }
      if (typeof preferences.dark_mode === 'boolean' && preferences.dark_mode !== dark) {
        toggleTheme()
      }
    }
  }, [preferences])

  // Fetch citizen threads when socket connects
  useEffect(() => {
    if (socket.connected) {
      socket.fetchCitizenThreads()
    }
  }, [socket.connected])

  // Track community chat + post notifications when NOT on community tab
  useEffect(() => {
    const s = socket.socket
    if (!s) return

    // Listen for the global notification event (sent to ALL sockets via io.emit)
    // This works even when user is NOT in the community-chat room
    const handleCommunityNotification = (data: { senderId?: string; senderName?: string }) => {
      // Don't count own messages
      if (data.senderId === user?.id) return
      if (activeTab !== 'community') {
        setCommunityUnread(prev => prev + 1)
      }
    }

    const handlePostNotification = () => {
      if (activeTab !== 'community') {
        setCommunityUnread(prev => prev + 1)
      }
    }

    s.on('community:chat:notification', handleCommunityNotification)
    s.on('community:post:notification', handlePostNotification)

    return () => {
      s.off('community:chat:notification', handleCommunityNotification)
      s.off('community:post:notification', handlePostNotification)
    }
  }, [socket.socket, activeTab, user?.id])

  // Clear community unread when switching to community tab
  useEffect(() => {
    if (activeTab === 'community') {
      setCommunityUnread(0)
    }
  }, [activeTab])

  // Redirect if not authenticated
  useEffect(() => {
    if (!loading && !isAuthenticated) {
      navigate('/citizen/login', { replace: true })
    }
  }, [loading, isAuthenticated, navigate])

  // Load news from API on mount
  const loadNews = useCallback(async (notify = false) => {
    setNewsRefreshing(true)
    try {
      const payload = await apiGetNews()
      if (Array.isArray(payload?.items) && payload.items.length > 0) {
        setNewsItems(payload.items)
        if (notify) pushNotification?.('News refreshed with latest sources', 'success')
      } else if (notify) {
        pushNotification?.('No fresh news available right now', 'warning')
      }
    } catch {
      if (notify) pushNotification?.('Unable to load news', 'warning')
    } finally {
      setNewsRefreshing(false)
    }
  }, [pushNotification])

  // Pull-to-refresh for mobile
  const handlePullRefresh = useCallback(async () => {
    await Promise.all([
      refreshReports(),
      loadNews(false),
    ])
    announce('Content refreshed')
  }, [refreshReports, loadNews, announce])

  const { containerRef: pullRef, pullDistance, refreshing: pullRefreshing, pastThreshold } = usePullToRefresh({
    onRefresh: handlePullRefresh,
    enabled: 'ontouchstart' in window,
  })

  useEffect(() => {
    loadNews(false)
  }, [])

  // Sorted reports (live from API)
  const sortedReports = useMemo(() => {
    let arr = [...reports]
    if (reportSearchTerm) {
      const s = reportSearchTerm.toLowerCase()
      arr = arr.filter(r => r.type?.toLowerCase().includes(s) || r.location?.toLowerCase().includes(s) || r.description?.toLowerCase().includes(s))
    }
    const SEV: Record<string, number> = { High: 3, Medium: 2, Low: 1 }
    arr.sort((a, b) => {
      let cmp = 0
      if (reportSortField === 'severity') cmp = (SEV[b.severity] || 0) - (SEV[a.severity] || 0)
      else if (reportSortField === 'confidence') cmp = (b.confidence || 0) - (a.confidence || 0)
      else cmp = new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      return reportSortOrder === 'asc' ? -cmp : cmp
    })
    return arr
  }, [reports, reportSortField, reportSortOrder, reportSearchTerm])

  const reportStats = useMemo(() => ({
    total: reports.length,
    urgent: reports.filter(r => r.status === 'Urgent').length,
    high: reports.filter(r => r.severity === 'High').length,
    verified: reports.filter(r => r.status === 'Verified').length,
    alertCount: alerts.length,
  }), [reports, alerts])

  const totalUnread = socket.threads.reduce((a, t) => a + (t.citizen_unread || 0), 0)

  // Accessible tab switching with screen reader announcement
  const handleTabChange = useCallback((tab: TabKey) => {
    setActiveTab(tab)
    const tabDef = TABS.find(t => t.key === tab)
    if (tabDef) announce(`Navigated to ${t(tabDef.labelKey, lang)} tab`)
  }, [announce, lang])

  const handleSubscribe = async () => {
    if (subChannels.length === 0) return
    try {
      const normalizedChannels = subChannels.map(ch => ch === 'webpush' ? 'web' : ch)
      const formattedPhone = subPhone ? formatPhoneWithCountry(selectedCountry, subPhone) : ''
      if (subChannels.includes('webpush')) {
        try {
          await subscribeToWebPush(subEmail)
          pushNotification?.('Web Push enabled successfully', 'success')
        } catch (err: any) {
          pushNotification?.(`Web Push setup failed: ${err.message}`, 'warning')
        }
      }
      await apiSubscribe({
        email: subEmail,
        phone: formattedPhone,
        whatsapp: formattedPhone,
        telegram_id: subTelegramId || undefined,
        channels: normalizedChannels,
        severity_filter: ['critical', 'warning', 'info'],
        topic_filter: subTopics,
      })
      pushNotification?.(`Subscribed to: ${normalizedChannels.join(', ')}`, 'success')
      setShowSubscribe(false)
    } catch (err: any) {
      pushNotification?.(err?.message || 'Subscription failed', 'error')
    }
  }

  const handlePrintReport = (report: any) => {
    const printWindow = window.open('', '_blank')
    if (!printWindow) return
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>AEGIS Report ${report.id}</title>
      <style>body{font-family:system-ui,sans-serif;max-width:800px;margin:40px auto;padding:20px;line-height:1.6}.header{border-bottom:3px solid #1e40af;padding-bottom:20px;margin-bottom:20px}.logo{font-size:24px;font-weight:bold;color:#1e40af}.badge{display:inline-block;padding:4px 12px;border-radius:4px;font-size:12px;font-weight:600;margin-right:8px}.severity-high{background:#fee;color:#c00}.severity-medium{background:#ffc;color:#860}.severity-low{background:#efe;color:#060}@media print{body{margin:0}}</style></head>
      <body><div class="header"><div class="logo">🛡️ AEGIS Emergency Management</div><div>Report ID: ${report.id}</div></div>
      <div><span class="badge severity-${report.severity?.toLowerCase()}">${report.severity}</span><span class="badge">${report.status}</span></div>
      <h2>${report.type}</h2><div><div>📍 ${report.location}</div><div>⏰ ${report.displayTime || new Date(report.timestamp).toLocaleString()}</div></div>
      <div><h3>Description</h3><p>${report.description}</p></div>
      <div style="margin-top:40px;padding-top:20px;border-top:1px solid #ddd;color:#666;font-size:12px">Generated from AEGIS on ${new Date().toLocaleString()}</div></body></html>`
    printWindow.document.write(html)
    printWindow.document.close()
    setTimeout(() => printWindow.print(), 250)
  }

  const handleShareReport = async (report: any) => {
    const shareData = { title: `AEGIS Report: ${report.type}`, text: `${report.type} - ${report.severity}\n📍 ${report.location}\n\n${report.description}`, url: window.location.href }
    if (navigator.share) {
      try { await navigator.share(shareData) } catch {}
    } else {
      try {
        await navigator.clipboard.writeText(`${shareData.title}\n\n${shareData.text}`)
        pushNotification?.('Report details copied to clipboard', 'success')
      } catch {}
    }
  }

  const detectLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        p => { setUserPosition([p.coords.latitude, p.coords.longitude]); pushNotification?.('Location detected', 'success') },
        () => pushNotification?.('Location access denied', 'warning')
      )
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 p-4 space-y-4" role="status" aria-label="Loading dashboard">
        {/* Skeleton nav bar */}
        <div className="flex items-center gap-3 mb-6">
          <Skeleton className="h-10 w-10 rounded-full" />
          <Skeleton className="h-5 w-40" />
          <div className="ml-auto"><Skeleton className="h-8 w-24 rounded" /></div>
        </div>
        {/* Skeleton stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <SkeletonStat /><SkeletonStat /><SkeletonStat /><SkeletonStat />
        </div>
        {/* Skeleton content cards */}
        <div className="grid md:grid-cols-2 gap-4">
          <SkeletonCard /><SkeletonCard />
        </div>
        <SkeletonList count={4} />
      </div>
    )
  }

  if (!user) return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
      <div className="text-center">
        <Loader2 className="w-8 h-8 animate-spin text-aegis-600 mx-auto mb-3" />
        <p className="text-sm text-gray-500">{t('citizen.loading', lang)}</p>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col">
      {/* Top Nav — Glassmorphism */}
      <nav className="relative bg-[#09090f] backdrop-blur-2xl text-white px-3 sm:px-5 flex items-center justify-between z-30 sticky top-0 border-b border-amber-500/15 shadow-2xl shadow-black/70" style={{height:'52px'}}>
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-amber-400/60 to-transparent pointer-events-none" />
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <Link to="/citizen" className="flex items-center gap-2.5 group flex-shrink-0">
            <div className="relative w-8 h-8 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shadow-md shadow-amber-500/35 group-hover:shadow-amber-400/55 transition-all group-hover:scale-105">
              <Shield className="w-4 h-4 text-white drop-shadow-sm" />
              <div className="absolute inset-0 rounded-xl bg-gradient-to-tr from-white/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            </div>
            <span className="font-black text-sm tracking-wide hidden sm:inline bg-gradient-to-r from-amber-300 via-yellow-200 to-amber-300 bg-clip-text text-transparent">AEGIS</span>
          </Link>
          {/* Location selector */}
          <select value={activeLocation} onChange={e => setActiveLocation(e.target.value)} className="bg-white/5 hover:bg-amber-500/10 text-white/70 hover:text-white text-[11px] px-2 py-1.5 rounded-lg border border-white/8 hover:border-amber-500/25 hidden md:block cursor-pointer transition-all focus:outline-none focus:ring-1 focus:ring-amber-500/35">
            {availableLocations.map(l => <option key={l.key} value={l.key} className="text-black">{l.name}</option>)}
          </select>
        </div>

        {/* Center — Quick Search */}
        <div className="hidden lg:flex items-center mx-4 flex-1 max-w-md">
          <div className="relative w-full group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/25 group-focus-within:text-amber-400 transition-colors" />
            <input
              type="text"
              placeholder="Search reports, messages, alerts..."
              className="w-full pl-9 pr-4 py-2 text-xs bg-white/5 hover:bg-white/8 focus:bg-amber-500/6 border border-white/8 focus:border-amber-500/35 rounded-xl text-white placeholder-white/20 focus:outline-none focus:ring-1 focus:ring-amber-500/25 transition-all"
              onFocus={e => { e.target.placeholder = 'Type to search...' }}
              onBlur={e => { e.target.placeholder = 'Search reports, messages, alerts...' }}
            />
            <kbd className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] text-white/15 bg-white/5 px-1.5 py-0.5 rounded font-mono hidden xl:inline">⌘K</kbd>
          </div>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Connection indicator */}
          {socket.connected && (
            <div className="flex items-center gap-1.5 bg-emerald-500/8 border border-emerald-500/20 px-2 py-1 rounded-full mr-1 hidden sm:flex">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[10px] text-emerald-400 font-semibold">Live</span>
            </div>
          )}

          {/* Report Emergency */}
          <button onClick={() => setShowReportForm(true)} className="flex items-center gap-1.5 bg-red-600 hover:bg-red-500 text-white text-[11px] font-semibold px-2.5 py-1.5 rounded-xl transition-all hover:scale-[1.02] shadow-md shadow-red-600/30 hover:shadow-red-500/40 active:scale-[0.97]">
            <AlertTriangle className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{t('citizen.action.report', lang)}</span>
          </button>

          {/* Alerts / Notification Panel */}
          <div className="relative">
            <button
              onClick={() => alerts.length > 0 ? setShowAlertPanel(v => !v) : setShowSubscribe(true)}
              className={`flex items-center gap-1.5 text-white text-[11px] font-semibold px-2.5 py-1.5 rounded-xl transition-all hover:scale-[1.02] active:scale-[0.98] ${showAlertPanel ? 'bg-amber-500/15 ring-1 ring-amber-500/30' : 'bg-white/5 hover:bg-amber-500/10 border border-white/8 hover:border-amber-500/20'}`}>
              <Bell className={`w-3.5 h-3.5 ${alerts.length > 0 ? 'animate-[ring_2s_ease-in-out_infinite]' : ''}`} />
              <span className="hidden sm:inline">{t('citizen.action.alerts', lang)}</span>
              {alerts.length > 0 && (
                <span className="w-4 h-4 bg-red-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center -ml-0.5 animate-pulse">
                  {alerts.length > 9 ? '9+' : alerts.length}
                </span>
              )}
            </button>

            {/* Alert notification panel */}
            {showAlertPanel && (
              <div className="absolute right-0 top-full mt-2 w-80 bg-white/95 dark:bg-gray-900/98 backdrop-blur-xl border border-white/20 dark:border-white/8 rounded-2xl shadow-2xl shadow-black/30 z-50 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-white/8">
                  <div className="flex items-center gap-2">
                    <Bell className="w-4 h-4 text-amber-500" />
                    <span className="text-sm font-bold text-gray-900 dark:text-white">Active Alerts</span>
                    <span className="bg-red-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">{alerts.length}</span>
                  </div>
                  <button onClick={() => setShowAlertPanel(false)} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-white/8 transition-colors">
                    <X className="w-3.5 h-3.5 text-gray-400" />
                  </button>
                </div>
                <div className="max-h-72 overflow-y-auto divide-y divide-gray-100 dark:divide-white/5">
                  {alerts.slice(0, 8).map((alert: any, i: number) => (
                    <div key={alert.id || i} className="px-4 py-3 hover:bg-gray-50 dark:hover:bg-white/4 transition-colors">
                      <div className="flex items-start gap-2.5">
                        <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
                          alert.severity === 'critical' ? 'bg-red-500 animate-pulse' :
                          alert.severity === 'warning' ? 'bg-amber-500' : 'bg-blue-500'
                        }`} />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-gray-900 dark:text-white leading-tight truncate">{alert.title}</p>
                          {alert.message && <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">{alert.message}</p>}
                          {alert.location && <p className="text-[10px] text-amber-500 dark:text-amber-400 mt-1 flex items-center gap-1"><MapPin className="w-2.5 h-2.5"/>{alert.location}</p>}
                        </div>
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md flex-shrink-0 ${
                          alert.severity === 'critical' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400' :
                          alert.severity === 'warning' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' :
                          'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                        }`}>{alert.severity}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="px-4 py-3 border-t border-gray-100 dark:border-white/8 flex gap-2">
                  <button onClick={() => { setShowAlertPanel(false); setShowSubscribe(true) }}
                    className="flex-1 text-xs font-semibold text-amber-600 dark:text-amber-400 py-1.5 rounded-xl bg-amber-50 dark:bg-amber-950/20 hover:bg-amber-100 dark:hover:bg-amber-950/40 transition-colors">
                    Manage Subscriptions
                  </button>
                  <button onClick={() => setShowAlertPanel(false)}
                    className="text-xs text-gray-400 py-1.5 px-3 rounded-xl hover:bg-gray-100 dark:hover:bg-white/8 transition-colors">
                    Close
                  </button>
                </div>
              </div>
            )}
          </div>

          <LanguageSelector darkNav className="hidden sm:flex" />

          {/* Theme toggle */}
          <button onClick={toggleTheme} className="p-1.5 hover:bg-amber-500/10 rounded-xl transition-all active:scale-95 group" aria-label="Toggle theme">
            {dark ? <Sun className="w-4 h-4 text-amber-300 group-hover:text-amber-200 transition-colors" /> : <Moon className="w-4 h-4 text-white/50 group-hover:text-white/80 transition-colors" />}
          </button>

          {/* Status Color Picker */}
          <div className="relative hidden sm:block">
            <button onClick={() => setStatusDropdownOpen(!statusDropdownOpen)}
              className="flex items-center gap-1.5 bg-white/5 hover:bg-amber-500/10 border border-white/8 hover:border-amber-500/20 px-2 py-1.5 rounded-xl transition-all"
              title="Your status">
              <div className={`w-2.5 h-2.5 rounded-full ${statusColor === 'green' ? 'bg-green-400' : statusColor === 'yellow' ? 'bg-amber-400' : 'bg-red-400'} ring-2 ring-white/20`} />
              <ChevronDown className={`w-3 h-3 opacity-50 transition-transform ${statusDropdownOpen ? 'rotate-180' : ''}`} />
            </button>
            {statusDropdownOpen && (
              <div className="absolute right-0 top-full mt-2 w-48 glass-card rounded-xl shadow-2xl py-1.5 z-50 animate-scale-in">
                {[
                  { val: 'green' as const, label: t('citizen.status.available', lang), color: 'bg-green-500', hover: 'hover:bg-green-50 dark:hover:bg-green-950/20' },
                  { val: 'yellow' as const, label: t('citizen.status.away', lang), color: 'bg-amber-500', hover: 'hover:bg-amber-50 dark:hover:bg-amber-950/20' },
                  { val: 'red' as const, label: t('citizen.status.needHelp', lang), color: 'bg-red-500', hover: 'hover:bg-red-50 dark:hover:bg-red-950/20' },
                ].map(s => (
                  <button key={s.val} onClick={() => { setStatusColor(s.val); setStatusDropdownOpen(false) }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium transition-colors ${s.hover} ${statusColor === s.val ? 'text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-400'}`}>
                    <div className={`w-3 h-3 rounded-full ${s.color} ${statusColor === s.val ? 'ring-2 ring-offset-1 ring-gray-400' : ''}`} />
                    {s.label}
                    {statusColor === s.val && <Check className="w-3 h-3 ml-auto text-amber-500" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* User Avatar */}
          <div className="flex items-center gap-1.5 sm:gap-2 ml-0.5">
            <div className="relative flex-shrink-0">
              {user.avatarUrl ? (
                <img src={`${API_BASE}${user.avatarUrl}`} className="w-8 h-8 rounded-xl object-cover border-2 border-white/20 shadow-sm" alt="" />
              ) : (
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-500/30 to-amber-700/20 flex items-center justify-center text-xs font-bold shadow-sm border border-amber-500/20 text-amber-200">
                  {user.displayName?.[0]?.toUpperCase()}
                </div>
              )}
              {/* Status dot on avatar */}
              <div className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#09090f] ${statusColor === 'green' ? 'bg-green-400' : statusColor === 'yellow' ? 'bg-amber-400' : 'bg-red-400'}`} />
            </div>
            <span className="text-xs font-medium hidden md:inline max-w-[80px] truncate">{user.displayName}</span>
          </div>
            <button onClick={() => { logout() }} className="text-xs bg-white/5 hover:bg-red-600/80 border border-white/6 hover:border-red-500/50 p-1.5 sm:px-2.5 sm:py-1.5 rounded-xl transition-all active:scale-95 group" title="Logout">
            <LogOut className="w-3.5 h-3.5 text-white/40 group-hover:text-white transition-colors" />
          </button>
        </div>
      </nav>

      {/* Email verification banner (#23) */}
      {user && !user.emailVerified && (
        <div className="bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800 px-4 py-2.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-amber-800 dark:text-amber-200 text-sm">
            <Mail className="w-4 h-4 flex-shrink-0" />
            <span>{t('citizen.verifyEmail.banner', lang) || 'Please verify your email address to unlock all features.'}</span>
          </div>
          <button
            onClick={async () => {
              try {
                const res = await fetch(`${API_BASE}/api/citizen-auth/resend-verification`, {
                  method: 'POST',
                  headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                  credentials: 'include',
                })
                const data = await res.json()
                if (res.ok) announce('Verification email sent')
                else announce(data.error || 'Failed to send verification email')
              } catch { announce('Failed to send verification email') }
            }}
            className="text-xs font-semibold text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/50 hover:bg-amber-200 dark:hover:bg-amber-900 px-3 py-1 rounded-lg transition whitespace-nowrap"
          >
            {t('citizen.verifyEmail.resend', lang) || 'Resend Email'}
          </button>
        </div>
      )}

      <div className="flex flex-1">
        {/* Sidebar (desktop) — Grouped sections with elegant hierarchy */}
        <aside className="hidden md:flex flex-col w-60 bg-white dark:bg-[#0a0a12] border-r border-gray-200 dark:border-amber-500/8 py-4 sticky top-[52px] h-[calc(100vh-52px)] custom-scrollbar overflow-y-auto">
          <div className="px-4 mb-5">
            <div className="flex items-center gap-3">
              {user.avatarUrl ? (
                <img src={`${API_BASE}${user.avatarUrl}`} className="w-11 h-11 rounded-xl object-cover ring-2 ring-amber-200 dark:ring-amber-500/20 shadow-sm" alt="" />
              ) : (
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center text-black font-bold shadow-sm shadow-amber-500/30 text-sm">
                  {user.displayName?.[0]?.toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{user.displayName}</p>
                <p className="text-[10px] text-amber-700/50 dark:text-amber-500/60 truncate">{user.email}</p>
              </div>
            </div>
            {user.isVulnerable && (
              <div className="mt-2.5 bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/20 border border-amber-200/80 dark:border-amber-800/40 rounded-xl px-2.5 py-1.5 flex items-center gap-1.5">
                <Heart className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                <span className="text-[10px] font-semibold text-amber-700 dark:text-amber-300">{t('citizen.prioritySupport', lang)}</span>
              </div>
            )}
          </div>

          {/* Main Navigation */}
          <div className="px-3 mb-1">
            <p className="px-2 text-[9px] font-bold text-amber-700/50 dark:text-amber-500/50 uppercase tracking-[0.15em] mb-1.5">Main</p>
          </div>
          <nav className="px-2 space-y-0.5">
            {TABS.slice(0, 3).map(tab => (
              <button
                key={tab.key}
                onClick={() => handleTabChange(tab.key)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-200 ${
                  activeTab === tab.key
                    ? 'bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 shadow-sm shadow-amber-200/50 dark:shadow-amber-500/10'
                    : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-gray-200'
                }`}
              >
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${
                  activeTab === tab.key ? 'bg-amber-200 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400' : 'bg-gray-100 dark:bg-white/5 text-gray-400 dark:text-gray-500'
                }`}>
                  <tab.icon className="w-3.5 h-3.5" />
                </div>
                {t(tab.labelKey, lang)}
                {tab.key === 'reports' && reportStats.urgent > 0 && (
                  <span className="ml-auto bg-red-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full animate-pulse">{reportStats.urgent}</span>
                )}
              </button>
            ))}
          </nav>

          {/* Communication */}
          <div className="px-3 mt-4 mb-1">
            <p className="px-2 text-[9px] font-bold text-amber-700/50 dark:text-amber-500/50 uppercase tracking-[0.15em] mb-1.5">Communication</p>
          </div>
          <nav className="px-2 space-y-0.5">
            {TABS.slice(3, 5).map(tab => (
              <button
                key={tab.key}
                onClick={() => handleTabChange(tab.key)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-200 ${
                  activeTab === tab.key
                    ? 'bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 shadow-sm shadow-amber-200/50 dark:shadow-amber-500/10'
                    : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-gray-200'
                }`}
              >
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${
                  activeTab === tab.key ? 'bg-amber-200 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400' : 'bg-gray-100 dark:bg-white/5 text-gray-400 dark:text-gray-500'
                }`}>
                  <tab.icon className="w-3.5 h-3.5" />
                </div>
                {t(tab.labelKey, lang)}
                {tab.key === 'messages' && totalUnread > 0 && (
                  <span className="ml-auto bg-red-500 text-white text-[9px] font-bold min-w-[18px] h-[18px] flex items-center justify-center rounded-full">{totalUnread}</span>
                )}
                {tab.key === 'community' && communityUnread > 0 && (
                  <span className="ml-auto bg-amber-500 text-black text-[9px] font-bold min-w-[18px] h-[18px] flex items-center justify-center rounded-full">{communityUnread}</span>
                )}
              </button>
            ))}
          </nav>

          {/* Resources */}
          <div className="px-3 mt-4 mb-1">
            <p className="px-2 text-[9px] font-bold text-amber-700/50 dark:text-amber-500/50 uppercase tracking-[0.15em] mb-1.5">Resources</p>
          </div>
          <nav className="px-2 space-y-0.5">
            {TABS.slice(5, 8).map(tab => (
              <button
                key={tab.key}
                onClick={() => handleTabChange(tab.key)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-200 ${
                  activeTab === tab.key
                    ? 'bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 shadow-sm shadow-amber-200/50 dark:shadow-amber-500/10'
                    : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-gray-200'
                }`}
              >
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${
                  activeTab === tab.key ? 'bg-amber-200 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400' : 'bg-gray-100 dark:bg-white/5 text-gray-400 dark:text-gray-500'
                }`}>
                  <tab.icon className="w-3.5 h-3.5" />
                </div>
                {t(tab.labelKey, lang)}
              </button>
            ))}
          </nav>

          {/* Account */}
          <div className="px-3 mt-4 mb-1">
            <p className="px-2 text-[9px] font-bold text-amber-700/50 dark:text-amber-500/50 uppercase tracking-[0.15em] mb-1.5">Account</p>
          </div>
          <nav className="px-2 space-y-0.5 mb-4">
            {TABS.slice(8).map(tab => (
              <button
                key={tab.key}
                onClick={() => handleTabChange(tab.key)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-200 ${
                  activeTab === tab.key
                    ? 'bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 shadow-sm shadow-amber-200/50 dark:shadow-amber-500/10'
                    : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-gray-200'
                }`}
              >
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${
                  activeTab === tab.key ? 'bg-amber-200 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400' : 'bg-gray-100 dark:bg-white/5 text-gray-400 dark:text-gray-500'
                }`}>
                  <tab.icon className="w-3.5 h-3.5" />
                </div>
                {t(tab.labelKey, lang)}
              </button>
            ))}
          </nav>
        </aside>

        {/* Mobile tab bar — glassmorphism with active indicator */}
        <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-[#09090f] border-t border-gray-200 dark:border-amber-500/12 flex z-30 safe-area-bottom backdrop-blur-2xl">
          {TABS.slice(0, 5).map(tab => (
            <button
              key={tab.key}
              onClick={() => handleTabChange(tab.key)}
              className={`flex-1 py-2.5 flex flex-col items-center gap-0.5 transition-all duration-200 relative ${
                activeTab === tab.key ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400 dark:text-gray-600'
              }`}
            >
              {activeTab === tab.key && (
                <div className="absolute -top-px left-1/2 -translate-x-1/2 w-8 h-0.5 bg-gradient-to-r from-amber-400 to-yellow-400 rounded-full transition-all shadow-sm shadow-amber-400/50" />
              )}
              <div className={`relative transition-transform duration-200 ${activeTab === tab.key ? 'scale-110' : ''}`}>
                <tab.icon className="w-5 h-5" />
                {tab.key === 'messages' && totalUnread > 0 && (
                  <span className="absolute -top-1.5 -right-2.5 bg-red-500 text-white text-[7px] font-bold min-w-[14px] h-3.5 rounded-full flex items-center justify-center px-0.5 shadow-sm">{totalUnread > 99 ? '99+' : totalUnread}</span>
                )}
                {tab.key === 'community' && communityUnread > 0 && (
                  <span className="absolute -top-1.5 -right-2.5 bg-amber-500 text-black text-[7px] font-bold min-w-[14px] h-3.5 rounded-full flex items-center justify-center px-0.5 shadow-sm">{communityUnread > 9 ? '9+' : communityUnread}</span>
                )}
              </div>
              <span className={`text-[9px] font-semibold ${activeTab === tab.key ? '' : 'font-medium'}`}>{t(tab.labelKey, lang)}</span>
            </button>
          ))}
          {/* More button for remaining tabs (#46 tab discovery) */}
          <div className="relative flex-1">
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className={`w-full py-2.5 flex flex-col items-center gap-0.5 transition-all duration-200 relative ${
                TABS.slice(5).some(t => t.key === activeTab) ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400 dark:text-gray-600'
              }`}
            >
              {TABS.slice(5).some(t => t.key === activeTab) && (
                <div className="absolute -top-px left-1/2 -translate-x-1/2 w-8 h-0.5 bg-gradient-to-r from-amber-400 to-yellow-300 rounded-full shadow-sm shadow-amber-400/50" />
              )}
              <ChevronDown className={`w-5 h-5 transition-transform duration-200 ${mobileMenuOpen ? 'rotate-180' : ''}`} />
              <span className="text-[9px] font-medium">{t('citizen.tab.more', lang) || 'More'}</span>
            </button>
            {mobileMenuOpen && (
              <div className="absolute bottom-full right-0 mb-2 bg-white dark:bg-[#0d0d1a] rounded-2xl shadow-2xl py-2 min-w-[180px] animate-scale-in border border-gray-200 dark:border-amber-500/15">
                {TABS.slice(5).map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => { handleTabChange(tab.key); setMobileMenuOpen(false) }}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-[13px] font-medium transition-all ${
                      activeTab === tab.key
                        ? 'text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-500/10'
                        : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-gray-200'
                    }`}
                  >
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                      activeTab === tab.key ? 'bg-amber-200 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400' : 'bg-gray-100 dark:bg-white/5 text-gray-400 dark:text-gray-500'
                    }`}>
                      <tab.icon className="w-3.5 h-3.5" />
                    </div>
                    {t(tab.labelKey, lang)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Main Content */}
        <main ref={pullRef} className="flex-1 p-4 md:p-6 pb-20 md:pb-6 overflow-y-auto relative">
          {/* Pull-to-refresh indicator */}
          {(pullDistance > 0 || pullRefreshing) && (
            <div
              className="flex items-center justify-center transition-all"
              style={{ height: pullDistance, minHeight: pullRefreshing ? 40 : 0 }}
            >
              <div className={`w-6 h-6 border-2 rounded-full ${
                pullRefreshing
                  ? 'border-aegis-600 border-t-transparent animate-spin'
                  : pastThreshold
                    ? 'border-aegis-600 border-t-transparent'
                    : 'border-gray-300 border-t-gray-400'
              }`} style={{ transform: `rotate(${pullDistance * 3}deg)` }} />
            </div>
          )}
          <Suspense fallback={<div className="flex items-center justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-aegis-600" /></div>}>
          {activeTab === 'overview' && <OverviewTab user={user} threads={socket.threads} recentSafety={recentSafety} emergencyContacts={emergencyContacts} totalUnread={totalUnread} setActiveTab={setActiveTab} reportStats={reportStats} onReportEmergency={() => setShowReportForm(true)} onCommunityHelp={() => setShowCommunityHelp(true)} />}
          {activeTab === 'livemap' && <LiveMapTab reports={reports} loc={loc} userPosition={userPosition} detectLocation={detectLocation} alerts={alerts} setSelectedAlert={setSelectedAlert} />}
          {activeTab === 'reports' && <ReportsTab reports={sortedReports} loading={reportsLoading} searchTerm={reportSearchTerm} setSearchTerm={setReportSearchTerm} sortField={reportSortField} setSortField={setReportSortField} sortOrder={reportSortOrder} setSortOrder={setReportSortOrder} onViewReport={setSelectedReport} onPrintReport={handlePrintReport} onShareReport={handleShareReport} lang={lang} />}
          {activeTab === 'messages' && <MessagesTab socket={socket} user={user} />}
          {activeTab === 'community' && <CommunitySection parentSocket={socket.socket} />}
          {activeTab === 'prepare' && <PreparednessTab lang={lang} onOpenGuide={() => setShowPreparednessGuide(true)} />}
          {activeTab === 'news' && <NewsTab newsItems={newsItems} newsRefreshing={newsRefreshing} loadNews={loadNews} refreshReports={refreshReports} />}
          {activeTab === 'safety' && <SafetyTab submitSafetyCheckIn={submitSafetyCheckIn} recentSafety={recentSafety} onEnterSafetyMode={() => setShowSafetyMode(true)} />}
          {activeTab === 'profile' && <ProfileTab user={user} updateProfile={updateProfile} uploadAvatar={uploadAvatar} refreshProfile={refreshProfile} />}
          {activeTab === 'security' && <SecurityTab changePassword={changePassword} />}
          {activeTab === 'settings' && <SettingsTab preferences={preferences} updatePreferences={updatePreferences} />}
          </Suspense>
        </main>
      </div>

      {!showAssistant && (
        <button
          onClick={() => setShowAssistant(true)}
          className="fixed bottom-24 left-6 z-[90] w-14 h-14 bg-aegis-600 hover:bg-aegis-700 text-white rounded-full shadow-2xl shadow-aegis-600/30 flex items-center justify-center transition-all hover:scale-105"
          aria-label="Open AI Assistant"
        >
          <MessageSquare className="w-6 h-6" />
        </button>
      )}
      {showAssistant && <Suspense fallback={<div className="fixed bottom-4 left-4 z-50 bg-white dark:bg-gray-900 rounded-xl p-4 shadow-2xl"><Loader2 className="w-6 h-6 animate-spin text-aegis-600" /></div>}><Chatbot onClose={() => setShowAssistant(false)} anchor="left" /></Suspense>}

      {/* SOS Distress Beacon */}
      {socket.socket && <SOSButton socket={socket.socket} citizenId={user.id} citizenName={user.displayName || 'Citizen'} />}

      {/* ═══ MODALS (code-split) ═══ */}
      <Suspense fallback={<div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50"><Loader2 className="w-8 h-8 animate-spin text-white" /></div>}>
        {showReportForm && <ReportForm onClose={() => setShowReportForm(false)} />}
        {showCommunityHelp && <CommunityHelp onClose={() => setShowCommunityHelp(false)} />}
        {showPreparednessGuide && <PreparednessGuide onClose={() => setShowPreparednessGuide(false)} lang={lang} />}
        {showSafetyMode && <PublicSafetyMode onClose={() => setShowSafetyMode(false)} />}
      </Suspense>

      {/* Report Detail Modal */}
      {selectedReport && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={() => setSelectedReport(null)}>
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h3 className="font-bold text-lg flex items-center gap-2"><FileText className="w-5 h-5 text-aegis-600" /> {t('citizen.reportDetail.title', lang)}</h3>
              <button onClick={() => setSelectedReport(null)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`px-3 py-1 rounded-full text-xs font-bold ${selectedReport.severity === 'High' ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' : selectedReport.severity === 'Medium' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' : 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'}`}>{selectedReport.severity}</span>
                <span className={`px-3 py-1 rounded-full text-xs font-medium ${selectedReport.status === 'Urgent' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' : selectedReport.status === 'Verified' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'}`}>{selectedReport.status}</span>
                {selectedReport.confidence != null && <span className="px-3 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 flex items-center gap-1"><Bot className="w-3 h-3" /> AI: {selectedReport.confidence}%</span>}
              </div>
              <h4 className="text-xl font-bold text-gray-900 dark:text-white">{selectedReport.type}</h4>
              <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{selectedReport.description}</p>
              <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4 space-y-2">
                <div className="flex items-center gap-2 text-sm"><MapPin className="w-4 h-4 text-gray-500 flex-shrink-0" /><span className="text-gray-700 dark:text-gray-300">{selectedReport.location}</span></div>
                <div className="flex items-center gap-2 text-sm"><Clock className="w-4 h-4 text-gray-500 flex-shrink-0" /><span className="text-gray-700 dark:text-gray-300">{selectedReport.displayTime || new Date(selectedReport.timestamp).toLocaleString()}</span></div>
                {selectedReport.reporter && <div className="flex items-center gap-2 text-sm"><User className="w-4 h-4 text-gray-500 flex-shrink-0" /><span className="text-gray-700 dark:text-gray-300">{selectedReport.reporter}</span></div>}
                <div className="flex items-center gap-2 text-sm"><Info className="w-4 h-4 text-gray-500 flex-shrink-0" /><span className="text-gray-500 font-mono text-xs">ID: {selectedReport.id}</span></div>
              </div>
              {selectedReport.aiAnalysis && (
                <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4 space-y-2">
                  <h5 className="font-semibold text-sm text-blue-800 dark:text-blue-200 flex items-center gap-1.5"><Bot className="w-4 h-4" /> {t('admin.ai.title', lang)}</h5>
                  {selectedReport.aiAnalysis.summary && <p className="text-xs text-blue-700 dark:text-blue-300">{selectedReport.aiAnalysis.summary}</p>}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {selectedReport.aiAnalysis.sentimentScore != null && <div><span className="text-blue-600 dark:text-blue-400 font-medium">Sentiment:</span> {selectedReport.aiAnalysis.sentimentScore.toFixed(2)}</div>}
                    {selectedReport.aiAnalysis.panicLevel && <div><span className="text-blue-600 dark:text-blue-400 font-medium">Panic:</span> {selectedReport.aiAnalysis.panicLevel}</div>}
                    {selectedReport.aiAnalysis.fakeProbability != null && <div><span className="text-blue-600 dark:text-blue-400 font-medium">Fake Risk:</span> {(selectedReport.aiAnalysis.fakeProbability * 100).toFixed(0)}%</div>}
                  </div>
                  {selectedReport.aiAnalysis.vulnerablePersonAlert && <div className="flex items-center gap-1.5 text-xs bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-200 px-3 py-1.5 rounded-lg mt-1"><AlertTriangle className="w-3.5 h-3.5" /> Vulnerable Person Alert</div>}
                </div>
              )}
            </div>
            <div className="p-5 border-t border-gray-200 dark:border-gray-700 flex gap-3">
              <button onClick={() => setSelectedReport(null)} className="flex-1 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-xl py-2.5 text-sm font-semibold transition-colors">Close</button>
              <button onClick={() => handleShareReport(selectedReport)} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white rounded-xl py-2.5 text-sm font-semibold transition-colors flex items-center justify-center gap-2"><Share2 className="w-4 h-4" /> Share</button>
              <button onClick={() => handlePrintReport(selectedReport)} className="flex-1 bg-gray-600 hover:bg-gray-700 text-white rounded-xl py-2.5 text-sm font-semibold transition-colors flex items-center justify-center gap-2"><Printer className="w-4 h-4" /> Print</button>
            </div>
          </div>
        </div>
      )}

      {/* Alert Detail Modal */}
      {selectedAlert && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={() => setSelectedAlert(null)}>
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h3 className="font-bold text-lg flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-red-600" /> {t('citizen.alertDetail.title', lang)}</h3>
              <button onClick={() => setSelectedAlert(null)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase ${selectedAlert.severity === 'critical' ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' : selectedAlert.severity === 'high' ? 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300' : selectedAlert.severity === 'warning' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' : 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'}`}>{selectedAlert.severity?.toUpperCase()}</span>
              </div>
              <h4 className="text-xl font-bold text-gray-900 dark:text-white">{selectedAlert.title}</h4>
              <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{selectedAlert.message}</p>
              <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4 space-y-2">
                {selectedAlert.locationText && <div className="flex items-center gap-2 text-sm"><MapPin className="w-4 h-4 text-gray-500 flex-shrink-0" /><span className="text-gray-700 dark:text-gray-300">{selectedAlert.locationText}</span></div>}
                <div className="flex items-center gap-2 text-sm"><Clock className="w-4 h-4 text-gray-500 flex-shrink-0" /><span className="text-gray-700 dark:text-gray-300">{new Date(selectedAlert.createdAt).toLocaleString()}</span></div>
              </div>
              <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4">
                <h5 className="font-semibold text-sm text-amber-800 dark:text-amber-200 mb-1">{t('citizen.alertDetail.safetyAdvice', lang)}</h5>
                <p className="text-xs text-amber-700 dark:text-amber-300">{t('citizen.alertDetail.safetyMsg', lang)}</p>
              </div>
            </div>
            <div className="p-5 border-t border-gray-200 dark:border-gray-700 flex gap-3">
              <button onClick={() => setSelectedAlert(null)} className="flex-1 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-xl py-2.5 text-sm font-semibold transition-colors">Close</button>
              <button onClick={() => { setSelectedAlert(null); setShowReportForm(true) }} className="flex-1 bg-red-600 hover:bg-red-700 text-white rounded-xl py-2.5 text-sm font-semibold transition-colors flex items-center justify-center gap-2"><AlertTriangle className="w-4 h-4" /> {t('citizen.alertDetail.reportIncident', lang)}</button>
            </div>
          </div>
        </div>
      )}

      {/* Subscribe Modal */}
      {showSubscribe && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={() => setShowSubscribe(false)}>
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h3 className="font-bold flex items-center gap-2"><Bell className="w-5 h-5 text-blue-600" /> {t('citizen.subscribe.subscribeTo', lang)}</h3>
              <button onClick={() => setShowSubscribe(false)} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-xs text-gray-500">{t('citizen.subscribe.chooseChannels', lang)}</p>
              {[
                { key: 'email', label: 'Email', icon: Mail, color: 'text-red-500' },
                { key: 'sms', label: 'SMS', icon: Smartphone, color: 'text-green-500' },
                { key: 'telegram', label: 'Telegram', icon: Send, color: 'text-blue-500' },
                { key: 'whatsapp', label: 'WhatsApp', icon: MessageSquare, color: 'text-green-600' },
                { key: 'webpush', label: 'Web Push', icon: Wifi, color: 'text-purple-500' },
              ].map(ch => (
                <button key={ch.key} onClick={() => setSubChannels(p => p.includes(ch.key) ? p.filter(c => c !== ch.key) : [...p, ch.key])}
                  className={`w-full p-3 rounded-xl border-2 flex items-center gap-3 transition-all ${subChannels.includes(ch.key) ? 'border-aegis-500 bg-aegis-50 dark:bg-aegis-950/20' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'}`}>
                  <ch.icon className={`w-5 h-5 ${ch.color}`} /><span className="text-sm font-medium flex-1 text-left">{ch.label}</span>
                  {subChannels.includes(ch.key) && <CheckCircle className="w-5 h-5 text-aegis-500" />}
                </button>
              ))}
              {subChannels.includes('email') && <input className="w-full px-3 py-2 text-sm bg-gray-100 dark:bg-gray-800 rounded-lg border-none" placeholder="Email address" value={subEmail} onChange={e => setSubEmail(e.target.value)} />}
              {(subChannels.includes('sms') || subChannels.includes('whatsapp')) && (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <CountrySearch countries={ALL_COUNTRY_CODES} selected={selectedCountry} onChange={setSelectedCountry} />
                    <input className="flex-1 px-3 py-2 text-sm bg-gray-100 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700" placeholder={selectedCountry.format} value={subPhone} onChange={e => setSubPhone(e.target.value)} type="tel" />
                  </div>
                  <p className="text-xs text-gray-500">Example: {selectedCountry.dial} {selectedCountry.format}</p>
                </div>
              )}
              {subChannels.includes('telegram') && <input className="w-full px-3 py-2 text-sm bg-gray-100 dark:bg-gray-800 rounded-lg border-none" placeholder="Telegram User ID" value={subTelegramId} onChange={e => setSubTelegramId(e.target.value)} />}
              {/* Topic filter */}
              <div>
                <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">{t('citizen.subscribe.alertTopics', lang) || 'Alert Topics'}</p>
                <div className="flex flex-wrap gap-1.5">
                  {(['flood', 'fire', 'storm', 'earthquake', 'heatwave', 'tsunami', 'general'] as const).map(topic => (
                    <button key={topic} onClick={() => setSubTopics(p => p.includes(topic) ? p.filter(t => t !== topic) : [...p, topic])}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-all ${
                        subTopics.includes(topic)
                          ? 'border-aegis-500 bg-aegis-50 dark:bg-aegis-950/20 text-aegis-700 dark:text-aegis-300'
                          : 'border-gray-200 dark:border-gray-700 text-gray-500 hover:border-gray-300'
                      }`}>
                      {topic.charAt(0).toUpperCase() + topic.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <button onClick={handleSubscribe} disabled={subChannels.length === 0} className="w-full bg-aegis-600 hover:bg-aegis-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white py-2.5 rounded-xl font-semibold text-sm transition-all">
                {webPushLoading ? t('citizen.subscribe.settingUp', lang) : t('citizen.subscribe.subscribeTo', lang)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toasts */}
      <div className="fixed top-16 right-4 z-50 space-y-2">
        {notifications?.map(n => (
          <div key={n.id} onClick={() => dismissNotification?.(n.id)} className={`px-4 py-2.5 rounded-xl text-sm shadow-lg cursor-pointer animate-fade-in max-w-xs ${n.type === 'success' ? 'bg-green-600 text-white' : n.type === 'warning' ? 'bg-amber-500 text-white' : n.type === 'error' ? 'bg-red-600 text-white' : 'bg-blue-600 text-white'}`}>{n.message}</div>
        ))}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB: REPORTS — Searchable report list with live data
// ═══════════════════════════════════════════════════════════════════════════════

function ReportsTab({ reports, loading, searchTerm, setSearchTerm, sortField, setSortField, sortOrder, setSortOrder, onViewReport, onPrintReport, onShareReport, lang }: any) {
  return (
    <div className="max-w-5xl mx-auto animate-fade-in space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-aegis-500 to-aegis-700 flex items-center justify-center shadow-md">
          <FileText className="w-4 h-4 text-white" />
        </div>
        <h2 className="text-xl font-extrabold text-gray-900 dark:text-white">Reports</h2>
        <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-lg">{reports.length}</span>
      </div>

      <div className="glass-card rounded-2xl overflow-hidden">
        {/* Search & Sort Bar */}
        <div className="p-3.5 border-b border-gray-200/80 dark:border-gray-700/50 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input className="w-full pl-10 pr-3 py-2.5 text-xs bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 focus:border-transparent transition" placeholder={t('reports.search', lang) || 'Search reports...'} value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
          </div>
          <select value={sortField} onChange={e => setSortField(e.target.value)} className="text-xs bg-gray-50 dark:bg-gray-800/60 px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 appearance-none">
            <option value="timestamp">{t('citizen.reports.newest', lang)}</option>
            <option value="severity">{t('severity', lang)}</option>
            <option value="confidence">{t('citizen.reports.aiConfidence', lang)}</option>
          </select>
          <button onClick={() => setSortOrder((o: string) => o === 'desc' ? 'asc' : 'desc')} className="p-2.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors">
            <ArrowUpDown className="w-4 h-4 text-gray-500" />
          </button>
        </div>
        <div className="divide-y divide-gray-100/80 dark:divide-gray-800/60 max-h-[600px] overflow-y-auto custom-scrollbar">
          {loading ? (
            <SkeletonList count={3} />
          ) : reports.length === 0 ? (
            <EmptyReports />
          ) : (
            reports.map((r: any) => (
              <div key={r.id} className="relative group">
                <ReportCard report={r} onClick={onViewReport} />
                <div className="absolute top-3 right-3 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={(e) => { e.stopPropagation(); onShareReport(r) }} className="p-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-950/20 transition-all shadow-sm" title="Share Report">
                    <Share2 className="w-4 h-4 text-blue-600" />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); onPrintReport(r) }} className="p-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-all shadow-sm" title="Print Report">
                    <Printer className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB: PREPAREDNESS — Emergency Preparedness Guide + Resources
// ═══════════════════════════════════════════════════════════════════════════════

function PreparednessTab({ lang, onOpenGuide }: { lang: string; onOpenGuide: () => void }) {
  return (
    <div className="max-w-4xl mx-auto space-y-5 animate-fade-in">
      {/* Header */}
      <div>
        <h2 className="text-xl font-extrabold text-gray-900 dark:text-white flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-md">
            <BookOpen className="w-4 h-4 text-white" />
          </div>
          {t('citizen.prep.emergencyPrep', lang)}
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 ml-[42px]">{t('citizen.prep.emergencyPrepDesc', lang)}</p>
      </div>

      {/* Open Guide CTA */}
      <button onClick={onOpenGuide} className="w-full bg-gradient-to-r from-aegis-600 to-aegis-700 hover:from-aegis-700 hover:to-aegis-800 text-white rounded-2xl p-5 text-sm font-bold flex items-center justify-center gap-2.5 transition-all shadow-lg shadow-aegis-600/20 hover:shadow-aegis-600/30 hover:scale-[1.01] active:scale-[0.99]">
        <BookMarked className="w-5 h-5" /> {t('nav.preparedness', lang) || 'Open Full Preparedness Guide'}
      </button>

      {/* Resources Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {[
          { title: 'SEPA Flood Warnings', source: 'SEPA', url: 'https://www.sepa.org.uk/environment/water/flooding/', type: 'article' },
          { title: 'Met Office Weather Warnings', source: 'Met Office', url: 'https://www.metoffice.gov.uk/weather/warnings-and-advice', type: 'article' },
          { title: 'Flood Preparation Guide', source: 'Scottish Government', url: 'https://www.floodscotland.org.uk/prepare-yourself/', type: 'article' },
          { title: 'What To Do Before A Flood', source: 'UK Environment Agency', url: 'https://www.youtube.com/watch?v=43M5mZuzHF8', type: 'video' },
          { title: 'How to Make an Emergency Kit', source: 'British Red Cross', url: 'https://www.youtube.com/watch?v=pFh-eEVadJU', type: 'video' },
          { title: 'Scottish Flood Forum', source: 'Scottish Flood Forum', url: 'https://scottishfloodforum.org/', type: 'article' },
        ].map((r, i) => (
          <a key={i} href={r.url} target="_blank" rel="noopener noreferrer" className="glass-card rounded-2xl p-4 hover-lift transition-all flex items-start gap-3.5 group">
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${r.type === 'video' ? 'bg-gradient-to-br from-red-500 to-rose-600' : 'bg-gradient-to-br from-blue-500 to-indigo-600'} shadow-md`}>
              {r.type === 'video' ? <Play className="w-5 h-5 text-white" /> : <Droplets className="w-5 h-5 text-white" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 dark:text-white group-hover:text-aegis-600 dark:group-hover:text-aegis-400 transition-colors flex items-center gap-1.5">{r.title}<ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" /></p>
              <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">{r.source} · <span className={`font-semibold ${r.type === 'video' ? 'text-red-500' : 'text-blue-500'}`}>{r.type === 'video' ? 'Video' : 'Article'}</span></p>
            </div>
          </a>
        ))}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB: NEWS — Live news from API
// ═══════════════════════════════════════════════════════════════════════════════

function NewsTab({ newsItems, newsRefreshing, loadNews, refreshReports }: { newsItems: NewsItem[]; newsRefreshing: boolean; loadNews: (notify: boolean) => Promise<void>; refreshReports?: () => void }) {
  const lang = useLanguage()
  const typeConfig: Record<string, { color: string; bg: string; label: string }> = {
    alert: { color: 'bg-red-500', bg: 'bg-red-50 dark:bg-red-950/20', label: 'Alert' },
    warning: { color: 'bg-amber-500', bg: 'bg-amber-50 dark:bg-amber-950/20', label: 'Warning' },
    community: { color: 'bg-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-950/20', label: 'Community' },
    tech: { color: 'bg-violet-500', bg: 'bg-violet-50 dark:bg-violet-950/20', label: 'Tech' },
    info: { color: 'bg-blue-500', bg: 'bg-blue-50 dark:bg-blue-950/20', label: 'Info' },
  }

  return (
    <div className="max-w-4xl mx-auto space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-extrabold text-gray-900 dark:text-white flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-aegis-500 to-aegis-700 flex items-center justify-center shadow-md">
              <Newspaper className="w-4 h-4 text-white" />
            </div>
            {t('citizen.news.newsResources', lang)}
          </h2>
        </div>
        <button onClick={async () => { await loadNews(true); refreshReports?.() }} disabled={newsRefreshing}
          className="flex items-center gap-2 text-xs text-aegis-600 hover:text-aegis-700 bg-aegis-50/80 dark:bg-aegis-950/30 border border-aegis-200/80 dark:border-aegis-800/50 px-3.5 py-2 rounded-xl transition-all hover:shadow-sm disabled:opacity-60 font-semibold">
          <RefreshCw className={`w-3.5 h-3.5 ${newsRefreshing ? 'animate-spin' : ''}`} /> {t('citizen.news.refresh', lang)}
        </button>
      </div>

      {newsItems.length === 0 ? (
        <div className="glass-card rounded-2xl p-12 text-center">
          <div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mx-auto mb-4">
            <Newspaper className="w-8 h-8 text-gray-300 dark:text-gray-600" />
          </div>
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{t('citizen.news.noNews', lang)}</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Check back later for updates</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {newsItems.map((n, i) => {
            const cfg = typeConfig[n.type] || typeConfig.info
            return (
              <div key={i} className="glass-card rounded-2xl p-4 hover-lift transition-all group">
                <div className="flex items-start gap-3.5">
                  <div className={`w-10 h-10 rounded-xl ${cfg.bg} flex items-center justify-center flex-shrink-0`}>
                    <div className={`w-2.5 h-2.5 rounded-full ${cfg.color}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md ${cfg.bg} ${cfg.color.replace('bg-', 'text-').replace('-500', '-600')}`}>
                        {cfg.label}
                      </span>
                      <span className="text-[10px] text-gray-400 dark:text-gray-500">{n.time}</span>
                    </div>
                    <a href={n.url} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-gray-900 dark:text-white hover:text-aegis-600 dark:hover:text-aegis-400 transition-colors leading-snug">
                      {n.title}
                    </a>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{n.source}</p>
                  </div>
                  <a href={n.url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1 text-[10px] text-aegis-600 hover:text-aegis-700 bg-aegis-50/80 dark:bg-aegis-950/30 border border-aegis-200/60 dark:border-aegis-800/40 px-2.5 py-1.5 rounded-lg flex-shrink-0 transition-colors opacity-0 group-hover:opacity-100 font-medium">
                    <ExternalLink className="w-3 h-3" /> Read
                  </a>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMMUNITY SECTION — Chat Room + Posts Feed with sub-tabs
// ═══════════════════════════════════════════════════════════════════════════════

function CommunitySection({ parentSocket }: { parentSocket?: Socket | null }) {
  const lang = useLanguage()
  const [subTab, setSubTab] = useState<'chat' | 'posts'>('chat')
  return (
    <div className="max-w-5xl mx-auto">
      {/* Sub-tab bar */}
      <div className="flex gap-1 bg-gray-100/80 dark:bg-gray-800/60 p-1 rounded-xl mb-4 w-fit backdrop-blur-sm">
        <button
          onClick={() => setSubTab('chat')}
          className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all duration-200 ${
            subTab === 'chat'
              ? 'bg-white dark:bg-gray-700 text-aegis-700 dark:text-white shadow-md'
              : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          <span className="flex items-center gap-1.5">
            <MessageSquare className="w-3.5 h-3.5" />
            {t('citizen.community.liveChat', lang)}
          </span>
        </button>
        <button
          onClick={() => setSubTab('posts')}
          className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all duration-200 ${
            subTab === 'posts'
              ? 'bg-white dark:bg-gray-700 text-aegis-700 dark:text-white shadow-md'
              : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          <span className="flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5" />
            {t('citizen.community.postsFeed', lang)}
          </span>
        </button>
      </div>

      {subTab === 'chat' && <CommunityChatRoom parentSocket={parentSocket} />}
      {subTab === 'posts' && <CommunityChat parentSocket={parentSocket} />}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB: LIVE MAP — DisasterMap + Intelligence + Weather + River Levels
// ═══════════════════════════════════════════════════════════════════════════════

function LiveMapTab({ reports, loc, userPosition, detectLocation, alerts, setSelectedAlert }: {
  reports: any[]; loc: any; userPosition: [number,number]|null; detectLocation: () => void; alerts: any[]; setSelectedAlert: (a: any) => void
}) {
  const [showWeather, setShowWeather] = useState(true)
  const [showRivers, setShowRivers] = useState(false)
  const lang = useLanguage()

  return (
    <div className="space-y-4 -mx-2 md:-mx-4">
      {/* Controls bar */}
      <div className="flex items-center gap-2 px-2 md:px-4 flex-wrap">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <Globe className="w-5 h-5 text-aegis-600" />
          {t('citizen.map.operations', lang)}
        </h2>
        <div className="ml-auto flex gap-2">
          <button onClick={detectLocation} className="text-xs bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors">
            <Crosshair className="w-3.5 h-3.5" /> {t('citizen.map.myLocationBtn', lang)}
          </button>
          <button
            onClick={() => setShowWeather(v => !v)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              showWeather ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
            }`}
          >
            {t('citizen.map.weather', lang)}
          </button>
          <button
            onClick={() => setShowRivers(v => !v)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              showRivers ? 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
            }`}
          >
            {t('citizen.map.riverLevels', lang)}
          </button>
        </div>
      </div>

      {/* Alerts Banner */}
      {alerts.length > 0 && (
        <div className="px-2 md:px-4 space-y-2">
          {alerts.slice(0, 3).map((a: any, i: number) => (
            <button key={a.id || i} onClick={() => setSelectedAlert(a)} className={`w-full text-left p-3 rounded-xl border flex items-center gap-3 transition hover:shadow-md ${
              a.severity === 'critical' ? 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800' :
              a.severity === 'warning' ? 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800' :
              'bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800'
            }`}>
              <AlertTriangle className={`w-5 h-5 flex-shrink-0 ${a.severity === 'critical' ? 'text-red-600' : a.severity === 'warning' ? 'text-amber-600' : 'text-blue-600'}`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{a.title}</p>
                <p className="text-xs text-gray-500 truncate">{a.message}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
            </button>
          ))}
        </div>
      )}

      {/* Map — full DisasterMap with reports, predictions, risk layers */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 px-2 md:px-4">
        <div className="lg:col-span-2">
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden shadow-sm">
            <div className="h-[300px] sm:h-[400px] lg:h-[450px]">
              <DisasterMap reports={reports} center={userPosition || loc.center} zoom={userPosition ? 14 : loc.zoom} showDistress showPredictions showRiskLayer showFloodMonitoring />
            </div>
            {userPosition && <div className="px-3 py-2 bg-green-50 dark:bg-green-950/20 text-xs text-green-700 dark:text-green-300 flex items-center gap-1"><Crosshair className="w-3 h-3" /> Location: {userPosition[0].toFixed(4)}, {userPosition[1].toFixed(4)}</div>}
          </div>
        </div>
        <div className="space-y-4">
          <IntelligenceDashboard collapsed={true} className="bg-gray-900 rounded-xl border border-gray-700" />
          {showWeather && <WeatherPanel />}
          {showRivers && <RiverGaugePanel />}
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 1: OVERVIEW
// ═══════════════════════════════════════════════════════════════════════════════

function OverviewTab({ user, threads, recentSafety, emergencyContacts, totalUnread, setActiveTab, reportStats, onReportEmergency, onCommunityHelp }: any) {
  const lang = useLanguage()
  const activeThreads = threads.filter((t: any) => t.status !== 'closed' && t.status !== 'resolved').length
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-fade-in">

      {/* ── Hero Banner ────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-aegis-600 via-aegis-700 to-aegis-800 p-6 sm:p-8 text-white shadow-xl shadow-aegis-600/20">
        {/* Decorative elements */}
        <div className="absolute -top-24 -right-24 w-64 h-64 bg-white/5 rounded-full blur-2xl" />
        <div className="absolute -bottom-16 -left-16 w-48 h-48 bg-white/5 rounded-full blur-2xl" />
        <div className="absolute top-0 right-0 w-full h-full bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImciIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTTAgMGg2MHY2MEgweiIgZmlsbD0ibm9uZSIvPjxjaXJjbGUgY3g9IjMwIiBjeT0iMzAiIHI9IjEiIGZpbGw9InJnYmEoMjU1LDI1NSwyNTUsMC4wNSkiLz48L3BhdHRlcm4+PC9kZWZzPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9InVybCgjZykiLz48L3N2Zz4=')] opacity-40" />

        <div className="relative z-10 flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className="flex-1">
            <p className="text-white/60 text-xs font-medium tracking-wider uppercase mb-1">{greeting}</p>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">{t('citizen.welcome', lang)} {user.displayName}!</h1>
            <p className="text-sm text-white/70 mt-1.5 max-w-lg">{t('citizen.dashboardDesc', lang)}</p>
            {user.isVulnerable && (
              <div className="mt-3 inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl px-3.5 py-2 text-sm">
                <Heart className="w-4 h-4 text-pink-300" /> <span className="text-white/90">{t('citizen.prioritySupportDesc', lang)}</span>
              </div>
            )}
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button onClick={onReportEmergency} className="bg-white/15 hover:bg-white/25 backdrop-blur-sm border border-white/20 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> Report
            </button>
            <button onClick={() => setActiveTab('livemap')} className="bg-white text-aegis-700 hover:bg-white/90 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] flex items-center gap-2 shadow-lg shadow-black/10">
              <MapPin className="w-4 h-4" /> Live Map
            </button>
          </div>
        </div>
      </div>

      {/* ── Situation Stats (glass cards) ──────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          { label: t('citizen.overview.activeReports', lang), value: reportStats?.total ?? 0, icon: FileText, gradient: 'from-slate-500 to-slate-700', bg: 'bg-slate-50 dark:bg-slate-950/30', ring: 'ring-slate-200 dark:ring-slate-800' },
          { label: t('citizen.overview.urgent', lang), value: reportStats?.urgent ?? 0, icon: AlertTriangle, gradient: 'from-red-500 to-rose-600', bg: 'bg-red-50 dark:bg-red-950/20', ring: 'ring-red-200 dark:ring-red-900' },
          { label: t('citizen.overview.highSeverity', lang), value: reportStats?.high ?? 0, icon: Flame, gradient: 'from-amber-500 to-orange-600', bg: 'bg-amber-50 dark:bg-amber-950/20', ring: 'ring-amber-200 dark:ring-amber-900' },
          { label: t('citizen.overview.verified', lang), value: reportStats?.verified ?? 0, icon: CheckCircle, gradient: 'from-emerald-500 to-green-600', bg: 'bg-emerald-50 dark:bg-emerald-950/20', ring: 'ring-emerald-200 dark:ring-emerald-900' },
          { label: t('citizen.overview.activeAlerts', lang), value: reportStats?.alertCount ?? 0, icon: Bell, gradient: 'from-blue-500 to-indigo-600', bg: 'bg-blue-50 dark:bg-blue-950/20', ring: 'ring-blue-200 dark:ring-blue-900' },
        ].map((s, i) => (
          <div key={i} className={`${s.bg} rounded-2xl p-4 ring-1 ${s.ring} hover-lift transition-all duration-300 group`} style={{ animationDelay: `${i * 80}ms` }}>
            <div className="flex items-center justify-between mb-3">
              <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${s.gradient} flex items-center justify-center shadow-lg shadow-black/10`}>
                <s.icon className="w-4 h-4 text-white" />
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-gray-300 dark:text-gray-600 group-hover:text-gray-500 group-hover:translate-x-0.5 transition-all" />
            </div>
            <p className="text-2xl sm:text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">{s.value}</p>
            <p className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* ── Your Activity + Quick Actions (side-by-side) ───────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Personal Stats */}
        <div className="lg:col-span-2 grid grid-cols-2 gap-3">
          {[
            { label: t('citizen.overview.unreadMessages', lang), value: totalUnread, icon: MessageSquare, gradient: 'from-blue-500 to-cyan-500', tap: () => setActiveTab('messages') },
            { label: t('citizen.overview.activeThreads', lang), value: activeThreads, icon: FileText, gradient: 'from-violet-500 to-purple-600', tap: () => setActiveTab('messages') },
            { label: t('citizen.overview.safetyCheckins', lang), value: recentSafety?.length || 0, icon: ShieldAlert, gradient: 'from-emerald-500 to-teal-600', tap: () => setActiveTab('safety') },
            { label: t('citizen.overview.emergencyContacts', lang), value: emergencyContacts?.length || 0, icon: Phone, gradient: 'from-amber-500 to-orange-500', tap: () => setActiveTab('profile') },
          ].map((s, i) => (
            <button key={i} onClick={s.tap} className="glass-card rounded-2xl p-4 text-left hover-lift transition-all duration-300 group cursor-pointer">
              <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${s.gradient} flex items-center justify-center mb-3 shadow-md group-hover:scale-110 transition-transform`}>
                <s.icon className="w-4 h-4 text-white" />
              </div>
              <p className="text-xl font-extrabold text-gray-900 dark:text-white">{s.value}</p>
              <p className="text-[10px] text-gray-500 dark:text-gray-400 font-medium mt-0.5">{s.label}</p>
            </button>
          ))}
        </div>

        {/* Quick Actions */}
        <div className="lg:col-span-3 glass-card rounded-2xl p-4">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-500" /> Quick Actions
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {[
              { label: t('citizen.quickAction.reportEmergency', lang), desc: t('citizen.quickAction.reportEmergencyDesc', lang), icon: AlertTriangle, color: 'text-red-600', hoverBorder: 'hover:border-red-300 dark:hover:border-red-800', action: onReportEmergency },
              { label: t('citizen.quickAction.liveMap', lang), desc: t('citizen.quickAction.liveMapDesc', lang), icon: MapPin, color: 'text-aegis-600', hoverBorder: 'hover:border-aegis-300 dark:hover:border-aegis-800', action: () => setActiveTab('livemap') },
              { label: t('citizen.quickAction.newMessage', lang), desc: t('citizen.quickAction.newMessageDesc', lang), icon: MessageSquare, color: 'text-blue-600', hoverBorder: 'hover:border-blue-300 dark:hover:border-blue-800', action: () => setActiveTab('messages') },
              { label: t('citizen.quickAction.communityHelp', lang), desc: t('citizen.quickAction.communityHelpDesc', lang), icon: Heart, color: 'text-pink-600', hoverBorder: 'hover:border-pink-300 dark:hover:border-pink-800', action: onCommunityHelp },
              { label: t('citizen.quickAction.safetyCheckin', lang), desc: t('citizen.quickAction.safetyCheckinDesc', lang), icon: ShieldAlert, color: 'text-emerald-600', hoverBorder: 'hover:border-emerald-300 dark:hover:border-emerald-800', action: () => setActiveTab('safety') },
              { label: t('citizen.quickAction.editProfile', lang), desc: t('citizen.quickAction.editProfileDesc', lang), icon: User, color: 'text-violet-600', hoverBorder: 'hover:border-violet-300 dark:hover:border-violet-800', action: () => setActiveTab('profile') },
            ].map((a, i) => (
              <button key={i} onClick={a.action} className={`bg-white dark:bg-gray-800/60 border border-gray-200/80 dark:border-gray-700/50 rounded-xl p-3 text-left ${a.hoverBorder} transition-all duration-200 group hover:shadow-md`}>
                <a.icon className={`w-4.5 h-4.5 ${a.color} mb-1.5 group-hover:scale-110 transition-transform`} />
                <p className="text-xs font-semibold text-gray-900 dark:text-white leading-tight">{a.label}</p>
                <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5 leading-snug line-clamp-2">{a.desc}</p>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Recent Conversations ───────────────────────────────────────── */}
      {threads.length > 0 && (
        <div className="glass-card rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 dark:border-gray-800/80">
            <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-aegis-600" /> {t('citizen.conversations.recent', lang)}
            </h3>
            <button onClick={() => setActiveTab('messages')} className="text-[11px] text-aegis-600 hover:text-aegis-700 dark:hover:text-aegis-400 font-semibold flex items-center gap-1 transition-colors">
              {t('citizen.conversations.viewAll', lang)}
              <ChevronRight className="w-3 h-3" />
            </button>
          </div>
          <div className="divide-y divide-gray-100/80 dark:divide-gray-800/60">
            {threads.slice(0, 4).map((th: any) => (
              <div key={th.id} className="px-5 py-3.5 flex items-center gap-3 hover:bg-gray-50/80 dark:hover:bg-gray-800/40 cursor-pointer transition-colors group" onClick={() => setActiveTab('messages')}>
                <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ring-4 ${
                  th.is_emergency ? 'bg-red-500 ring-red-100 dark:ring-red-950/50' : th.status === 'open' ? 'bg-emerald-500 ring-emerald-100 dark:ring-emerald-950/50' : th.status === 'in_progress' ? 'bg-blue-500 ring-blue-100 dark:ring-blue-950/50' : 'bg-gray-300 ring-gray-100 dark:ring-gray-800'
                }`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate group-hover:text-aegis-700 dark:group-hover:text-aegis-300 transition-colors">{th.subject}</p>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{th.last_message || t('citizen.messages.noMessages', lang)}</p>
                </div>
                {th.citizen_unread > 0 && (
                  <span className="bg-gradient-to-r from-aegis-600 to-aegis-700 text-white text-[10px] font-bold min-w-[20px] h-5 flex items-center justify-center rounded-full px-1.5 shadow-sm">{th.citizen_unread}</span>
                )}
                <span className="text-[10px] text-gray-400 dark:text-gray-500 flex-shrink-0">{th.updated_at ? timeAgo(th.updated_at) : ''}</span>
                <ChevronRight className="w-3.5 h-3.5 text-gray-300 dark:text-gray-600 group-hover:text-gray-500 group-hover:translate-x-0.5 transition-all flex-shrink-0" />
              </div>
            ))}
          </div>
          {threads.length === 0 && (
            <div className="px-5 py-8 text-center">
              <MessageSquare className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
              <p className="text-sm text-gray-400 dark:text-gray-500">No conversations yet</p>
            </div>
          )}
        </div>
      )}

      {/* ── Emergency Quick Dial ───────────────────────────────────────── */}
      {emergencyContacts && emergencyContacts.length > 0 && (
        <div className="glass-card rounded-2xl p-4">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
            <Phone className="w-4 h-4 text-red-500" /> Emergency Contacts
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {emergencyContacts.slice(0, 4).map((c: any, i: number) => (
              <a
                key={i}
                href={`tel:${c.phone}`}
                className="flex items-center gap-2.5 bg-white dark:bg-gray-800/60 border border-gray-200/80 dark:border-gray-700/50 rounded-xl px-3 py-2.5 hover:border-red-300 dark:hover:border-red-800 transition-all group hover:shadow-sm"
              >
                <div className="w-8 h-8 rounded-lg bg-red-50 dark:bg-red-950/30 flex items-center justify-center group-hover:bg-red-100 dark:group-hover:bg-red-900/30 transition-colors">
                  <Phone className="w-3.5 h-3.5 text-red-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-gray-900 dark:text-white truncate">{c.name}</p>
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 truncate">{c.phone || c.relationship}</p>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 2: MESSAGES — Real-time Socket.IO Chat
// ═══════════════════════════════════════════════════════════════════════════════

function MessagesTab({ socket, user }: { socket: any; user: any }) {
  const lang = useLanguage()
  const [showNewThread, setShowNewThread] = useState(false)
  const [newSubject, setNewSubject] = useState('')
  const [newCategory, setNewCategory] = useState('general')
  const [newMessage, setNewMessage] = useState('')
  const [msgInput, setMsgInput] = useState('')
  const [selectedImage, setSelectedImage] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string>('')
  const [sendingAttachment, setSendingAttachment] = useState(false)
  const [creating, setCreating] = useState(false)
  const [translations, setTranslations] = useState<Record<string, string>>({})
  const [translatingId, setTranslatingId] = useState<string | null>(null)
  const [autoTranslate, setAutoTranslate] = useState(() => getLanguage() !== 'en')
  const [targetLang, setTargetLang] = useState(() => getLanguage() || 'en')
  const [showLangPicker, setShowLangPicker] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const typingTimeoutRef = useRef<any>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const langPickerRef = useRef<HTMLDivElement>(null)

  const handleTranslateMsg = async (msgId: string, text: string) => {
    if (translations[msgId]) {
      setTranslations(prev => { const n = { ...prev }; delete n[msgId]; return n })
      return
    }
    setTranslatingId(msgId)
    try {
      const { translateText } = await import('../utils/translateService')
      const result = await translateText(text, 'auto', targetLang)
      setTranslations(prev => ({ ...prev, [msgId]: result.translatedText }))
    } catch { /* ignore */ }
    setTranslatingId(null)
  }

  const { threads, activeThread, messages, typingUsers, sendMessage, createThread, joinThread, loadThreadMessages, markRead, startTyping, stopTyping, setActiveThread } = socket

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Auto-translate messages when language is not English
  useEffect(() => {
    if (!autoTranslate) return
    const untranslated = messages.filter(
      (m: any) => m.content && !translations[m.id]
    )
    if (untranslated.length === 0) return
    const batch = untranslated.slice(0, 5)
    let cancelled = false
    ;(async () => {
      for (const msg of batch) {
        if (cancelled) break
        try {
          const { translateText } = await import('../utils/translateService')
          const result = await translateText(msg.content, 'auto', targetLang)
          if (!cancelled && result.translatedText && result.translatedText !== msg.content) {
            setTranslations(prev => ({ ...prev, [msg.id]: result.translatedText }))
          }
        } catch { /* skip */ }
      }
    })()
    return () => { cancelled = true }
  }, [autoTranslate, targetLang, messages.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // Update autoTranslate when language changes
  useEffect(() => {
    if (lang !== 'en') {
      setTargetLang(lang)
      setAutoTranslate(true)
      setTranslations({})
    }
  }, [lang])

  // Close lang picker on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (langPickerRef.current && !langPickerRef.current.contains(e.target as Node)) setShowLangPicker(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Mark as read when viewing a thread
  useEffect(() => {
    if (activeThread) {
      markRead(activeThread.id, [])
    }
  }, [activeThread?.id, messages.length])

  const handleSelectThread = (thread: ChatThread) => {
    setActiveThread(thread)
    joinThread(thread.id)
    loadThreadMessages(thread.id)
    markRead(thread.id, [])
    
    // Also mark via REST to ensure server-side sync
    const token = localStorage.getItem('aegis-citizen-token') || localStorage.getItem('token')
    if (token) {
      fetch(`/api/citizen/threads/${thread.id}/read`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}` }
      }).catch(() => {})
    }
  }

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) return
    if (file.size > 5 * 1024 * 1024) return
    setSelectedImage(file)
    const reader = new FileReader()
    reader.onload = (evt) => setImagePreview((evt.target?.result as string) || '')
    reader.readAsDataURL(file)
  }

  const handleSendMessage = async () => {
    if ((!msgInput.trim() && !selectedImage) || !activeThread) return

    let attachmentUrl: string | undefined
    if (selectedImage) {
      try {
        setSendingAttachment(true)
        const formData = new FormData()
        formData.append('file', selectedImage)
        const token = localStorage.getItem('aegis-citizen-token') || localStorage.getItem('token')
        const uploadRes = await fetch('/api/upload', {
          method: 'POST',
          body: formData,
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        })
        if (!uploadRes.ok) throw new Error('Failed to upload image')
        const uploadData = await uploadRes.json()
        attachmentUrl = uploadData.url
      } catch {
        setSendingAttachment(false)
        return
      }
    }

    sendMessage(activeThread.id, msgInput.trim(), attachmentUrl)
    setMsgInput('')
    setSelectedImage(null)
    setImagePreview('')
    if (fileInputRef.current) fileInputRef.current.value = ''
    setSendingAttachment(false)
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
    stopTyping(activeThread.id)
  }

  const handleRefresh = () => {
    socket.fetchCitizenThreads()
    if (activeThread) loadThreadMessages(activeThread.id)
  }

  const handleTyping = (val: string) => {
    setMsgInput(val)
    if (!activeThread) return
    startTyping(activeThread.id)
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
    typingTimeoutRef.current = setTimeout(() => stopTyping(activeThread.id), 2000)
  }

  const handleCreateThread = () => {
    if (!newSubject.trim() || !newMessage.trim()) return
    setCreating(true)
    createThread(newSubject.trim(), newCategory, newMessage.trim())
    setNewSubject('')
    setNewMessage('')
    setNewCategory('general')
    setShowNewThread(false)
    setCreating(false)
  }

  const threadTypers = typingUsers.filter((t: any) => t.threadId === activeThread?.id && t.userId !== user.id)

  // ── Thread List View ─────────────────────────────────────────────────
  if (!activeThread) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">{t('citizen.messages.title', lang)}</h2>
          <div className="flex items-center gap-2">
            <button onClick={handleRefresh} className="flex items-center gap-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 text-xs font-semibold px-3 py-2 rounded-lg transition">
              <RefreshCw className="w-3.5 h-3.5" /> {t('citizen.messages.refresh', lang)}
            </button>
            <button onClick={() => setShowNewThread(true)} className="flex items-center gap-1.5 bg-aegis-600 hover:bg-aegis-700 text-white text-xs font-semibold px-3 py-2 rounded-lg transition">
              <Plus className="w-3.5 h-3.5" /> {t('citizen.messages.newThread', lang)}
            </button>
          </div>
        </div>

        {/* New Thread Modal */}
        {showNewThread && (
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 mb-4 shadow-lg space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{t('citizen.messages.startConversation', lang)}</h3>
              <button onClick={() => setShowNewThread(false)} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{t('citizen.messages.subject', lang)}</label>
              <input
                value={newSubject}
                onChange={e => setNewSubject(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 transition"
                placeholder="Brief description of your inquiry..."
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{t('citizen.messages.category', lang)}</label>
              <select value={newCategory} onChange={e => setNewCategory(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 transition appearance-none">
                {THREAD_CATEGORIES.map(c => <option key={c.value} value={c.value}>{t(c.labelKey, lang)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{t('citizen.messages.message', lang)}</label>
              <textarea
                value={newMessage}
                onChange={e => setNewMessage(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 transition resize-none"
                rows={3}
                placeholder="Describe your situation or question..."
              />
            </div>
            <div className="flex gap-2">
              <button onClick={handleCreateThread} disabled={!newSubject.trim() || !newMessage.trim() || creating}
                className="bg-aegis-600 hover:bg-aegis-700 disabled:bg-aegis-400 text-white text-xs font-semibold px-4 py-2 rounded-lg transition flex items-center gap-1.5">
                {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} {t('citizen.messages.send', lang)}
              </button>
              <button onClick={() => setShowNewThread(false)} className="text-gray-500 hover:text-gray-700 text-xs px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700">{t('citizen.messages.cancel', lang)}</button>
            </div>
          </div>
        )}

        {/* Thread List */}
        {threads.length === 0 ? (
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-12 text-center">
            <MessageSquare className="w-12 h-12 text-gray-300 dark:text-gray-700 mx-auto mb-3" />
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">{t('citizen.messages.noConversations', lang)}</h3>
            <p className="text-xs text-gray-500 mb-4">{t('citizen.messages.startHelp', lang)}</p>
            <button onClick={() => setShowNewThread(true)} className="bg-aegis-600 hover:bg-aegis-700 text-white text-xs font-semibold px-4 py-2 rounded-lg transition">
              {t('citizen.messages.startButton', lang)}
            </button>
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden">
            {threads.map((th: ChatThread) => (
              <button key={th.id} onClick={() => handleSelectThread(th)}
                className="w-full px-4 py-3.5 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition text-left">
                <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                  th.is_emergency ? 'bg-red-500 animate-pulse' : th.status === 'open' ? 'bg-green-500' : th.status === 'in_progress' ? 'bg-blue-500' : th.status === 'resolved' ? 'bg-purple-500' : 'bg-gray-300'
                }`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{th.subject}</p>
                    {th.is_emergency && <span className="text-[9px] bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300 px-1.5 py-0.5 rounded font-bold uppercase">Emergency</span>}
                  </div>
                  <p className="text-[11px] text-gray-500 truncate mt-0.5">{th.last_message || t('citizen.messages.noMessages', lang)}</p>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  {th.citizen_unread > 0 && (
                    <span className="bg-aegis-600 text-white text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded-full">{th.citizen_unread}</span>
                  )}
                  <span className="text-[10px] text-gray-400">{th.updated_at ? timeAgo(th.updated_at) : ''}</span>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ── Chat View (Active Thread) ──────────────────────────────────────────
  return (
    <div className="max-w-3xl mx-auto flex flex-col h-[calc(100vh-140px)] md:h-[calc(100vh-100px)]">
      {/* Chat Header */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-t-xl px-4 py-3 flex items-center gap-3">
        <button onClick={() => { setActiveThread(null) }} className="text-gray-400 hover:text-gray-600 transition">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-gray-900 dark:text-white truncate">{activeThread.subject}</h3>
            {activeThread.is_emergency && (
              <span className="text-[9px] bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300 px-1.5 py-0.5 rounded font-bold uppercase flex-shrink-0">Emergency</span>
            )}
          </div>
          <p className="text-[11px] text-gray-500">
            {activeThread.status === 'resolved' ? t('citizen.messages.resolved', lang) : activeThread.assigned_operator_name ? `${t('citizen.messages.assignedTo', lang)} ${activeThread.assigned_operator_name}` : t('citizen.messages.waitingOperator', lang)}
          </p>
        </div>
        <div className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase flex-shrink-0 hidden sm:block ${
          activeThread.status === 'resolved' ? 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300' :
          activeThread.status === 'in_progress' ? 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300' :
          'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300'
        }`}>{activeThread.status?.replace('_', ' ')}</div>
        {/* Translation controls */}
        <div className="hidden sm:flex items-center gap-1.5 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 flex-shrink-0">
          <Languages className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
          <select
            value={targetLang}
            onChange={(e) => {
              setTargetLang(e.target.value)
              clearTranslationCache()
              setTranslations({})
              setAutoTranslate(true)
            }}
            className="text-[10px] bg-transparent text-gray-700 dark:text-gray-200 outline-none"
            title="Translate messages to"
          >
            {TRANSLATION_LANGUAGES.map(tl => (
              <option key={tl.code} value={tl.code}>
                {tl.name}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-[10px] text-gray-600 dark:text-gray-300">
            <input
              type="checkbox"
              checked={autoTranslate}
              onChange={() => setAutoTranslate(!autoTranslate)}
              className="w-3 h-3 rounded border-gray-300"
            />
            Auto
          </label>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-950 border-x border-gray-200 dark:border-gray-800 px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-center py-8 text-gray-400 text-sm">{t('citizen.messages.noMessages', lang)}</div>
        )}
        {messages.map((msg: ChatMessage) => {
          const isMine = msg.sender_id === user.id && msg.sender_type === 'citizen'
          return (
            <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 ${
                isMine
                  ? 'bg-aegis-600 text-white rounded-br-md'
                  : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white border border-gray-200 dark:border-gray-700 rounded-bl-md'
              }`}>
                {!isMine && (
                  <div className="mb-0.5">
                    <p className="text-[10px] font-semibold text-aegis-600 dark:text-aegis-400">
                      {msg.sender_name || 'Support Team'}
                    </p>
                    <p className="text-[9px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      {msg.sender_type === 'operator'
                        ? (msg.sender_role === 'admin' ? 'Admin' : msg.sender_role ? msg.sender_role.replace('_', ' ') : 'Operator')
                        : 'Citizen'}
                    </p>
                  </div>
                )}
                {msg.content && <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>}
                {translations[msg.id] && (
                  <div className={`mt-1 pt-1 border-t ${isMine ? 'border-white/20' : 'border-gray-200 dark:border-gray-600'}`}>
                    <p className={`text-[9px] font-semibold ${isMine ? 'text-white/60' : 'text-blue-500'}`}>Translated</p>
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">{translations[msg.id]}</p>
                  </div>
                )}
                {msg.attachment_url && (
                  <img
                    src={msg.attachment_url}
                    alt="attachment"
                    className="mt-2 max-w-full max-h-56 rounded-lg border border-gray-200 dark:border-gray-700 object-contain"
                  />
                )}
                <div className={`flex items-center gap-1 mt-1 ${isMine ? 'justify-end' : 'justify-start'}`}>
                  <span className={`text-[10px] ${isMine ? 'text-white/60' : 'text-gray-400'}`}>
                    {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {isMine && <MessageStatusIcon status={msg.status} />}
                  {msg.content && (
                    <button
                      onClick={() => handleTranslateMsg(msg.id, msg.content)}
                      className={`ml-1 px-1 py-0.5 rounded transition-colors ${
                        translations[msg.id]
                          ? (isMine ? 'text-white/80 bg-white/10' : 'text-blue-500 bg-blue-50 dark:bg-blue-950/30')
                          : (isMine ? 'text-white/40 hover:text-white/70 hover:bg-white/10' : 'text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/30')
                      }`}
                      title={translations[msg.id] ? 'Remove translation' : 'Translate'}
                    >
                      {translatingId === msg.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Languages className="w-3 h-3" />}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        })}

        {/* Typing indicator */}
        {threadTypers.length > 0 && (
          <div className="flex justify-start">
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl rounded-bl-md px-3.5 py-2.5">
              <div className="flex items-center gap-2">
                <div className="flex gap-1">
                  <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '200ms' }} />
                  <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '400ms' }} />
                </div>
                <span className="text-[10px] text-gray-400">{threadTypers[0].userName} {t('citizen.messages.isTyping', lang)}</span>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Message Input */}
      {activeThread.status !== 'resolved' && activeThread.status !== 'closed' ? (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-b-xl px-4 py-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleImageSelect}
          />
          {imagePreview && (
            <div className="mb-2 relative inline-block">
              <img src={imagePreview} alt="preview" className="h-20 w-auto rounded border border-gray-200 dark:border-gray-700" />
              <button
                type="button"
                onClick={() => { setSelectedImage(null); setImagePreview(''); if (fileInputRef.current) fileInputRef.current.value = '' }}
                className="absolute -top-2 -right-2 bg-black/70 text-white rounded-full p-1"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="p-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-500 hover:text-aegis-600 hover:border-aegis-300 transition"
              title="Attach image"
            >
              <Camera className="w-4 h-4" />
            </button>
            <textarea
              value={msgInput}
              onChange={e => handleTyping(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage() } }}
              placeholder={t('citizen.messages.typeMessage', lang)}
              rows={1}
              className="flex-1 px-3 py-2 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 transition resize-none max-h-24"
            />
            <button onClick={handleSendMessage} disabled={(!msgInput.trim() && !selectedImage) || sendingAttachment}
              className="bg-aegis-600 hover:bg-aegis-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white p-2.5 rounded-xl transition flex-shrink-0">
              {sendingAttachment ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-gray-100 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-b-xl px-4 py-3 text-center text-sm text-gray-500">
          {t('citizen.messages.conversationClosed', lang)} {activeThread.status}
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 3: SAFETY CHECK-IN
// ═══════════════════════════════════════════════════════════════════════════════

function SafetyTab({ submitSafetyCheckIn, recentSafety, onEnterSafetyMode }: any) {
  const lang = useLanguage()
  const [status, setStatus] = useState<'safe' | 'help' | 'unsure'>('safe')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)

  const handleSubmit = async () => {
    setSubmitting(true)
    setSuccess(false)
    let lat: number | undefined, lng: number | undefined
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 })
      )
      lat = pos.coords.latitude
      lng = pos.coords.longitude
    } catch {}
    const ok = await submitSafetyCheckIn(status, message || undefined, lat, lng)
    setSubmitting(false)
    if (ok) { setSuccess(true); setMessage(''); setTimeout(() => setSuccess(false), 3000) }
  }

  const statusConfig = {
    safe: { gradient: 'from-emerald-500 to-green-600', bg: 'bg-emerald-50 dark:bg-emerald-950/20', border: 'border-emerald-500', text: 'text-emerald-700 dark:text-emerald-300', ring: 'ring-emerald-200 dark:ring-emerald-900' },
    unsure: { gradient: 'from-amber-500 to-orange-500', bg: 'bg-amber-50 dark:bg-amber-950/20', border: 'border-amber-500', text: 'text-amber-700 dark:text-amber-300', ring: 'ring-amber-200 dark:ring-amber-900' },
    help: { gradient: 'from-red-500 to-rose-600', bg: 'bg-red-50 dark:bg-red-950/20', border: 'border-red-500', text: 'text-red-700 dark:text-red-300', ring: 'ring-red-200 dark:ring-red-900' },
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-extrabold text-gray-900 dark:text-white flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center shadow-md">
              <ShieldAlert className="w-4 h-4 text-white" />
            </div>
            {t('citizen.safety.title', lang)}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Let us know your current safety status</p>
        </div>
      </div>

      {/* Check-in Card */}
      <div className="glass-card rounded-2xl p-6 space-y-5">
        <p className="text-sm text-gray-600 dark:text-gray-400">Select your status and submit. Location is shared automatically if available.</p>

        {/* Status Buttons — Large & Prominent */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { key: 'safe' as const, label: t('citizen.safety.safeButton', lang), icon: CheckCircle, desc: 'I am safe' },
            { key: 'unsure' as const, label: t('citizen.safety.unsureButton', lang), icon: CircleDot, desc: 'Not sure' },
            { key: 'help' as const, label: t('citizen.safety.helpButton', lang), icon: AlertTriangle, desc: 'Need help' },
          ].map(s => {
            const cfg = statusConfig[s.key]
            const isActive = status === s.key
            return (
              <button key={s.key} onClick={() => setStatus(s.key)}
                className={`relative p-5 rounded-2xl border-2 transition-all duration-300 text-center group ${
                  isActive
                    ? `${cfg.border} ${cfg.bg} shadow-lg`
                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 bg-white dark:bg-gray-800/50'
                }`}>
                {isActive && <div className="absolute -top-px -left-px -right-px h-1 rounded-t-2xl bg-gradient-to-r ${cfg.gradient}" />}
                <div className={`w-12 h-12 rounded-2xl mx-auto mb-2 flex items-center justify-center transition-all ${
                  isActive ? `bg-gradient-to-br ${cfg.gradient} shadow-lg` : 'bg-gray-100 dark:bg-gray-700'
                }`}>
                  <s.icon className={`w-6 h-6 ${isActive ? 'text-white' : 'text-gray-400'}`} />
                </div>
                <p className={`text-sm font-bold ${isActive ? cfg.text : 'text-gray-600 dark:text-gray-400'}`}>{s.label}</p>
                <p className={`text-[10px] mt-0.5 ${isActive ? cfg.text.replace('700', '500').replace('300', '400') : 'text-gray-400'}`}>{s.desc}</p>
              </button>
            )
          })}
        </div>

        {/* Message Input */}
        <div className="relative">
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder="Optional message (e.g., location details, situation)..."
            className="w-full px-4 py-3 text-sm bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 focus:border-transparent transition resize-none"
            rows={2}
          />
          <MapPin className="absolute right-3 bottom-3 w-4 h-4 text-gray-300 dark:text-gray-600" />
        </div>

        {/* Submit Button */}
        <button onClick={handleSubmit} disabled={submitting}
          className={`w-full py-3.5 rounded-xl font-bold text-sm text-white flex items-center justify-center gap-2 transition-all duration-200 hover:scale-[1.01] active:scale-[0.99] shadow-lg ${
            status === 'help' ? 'bg-gradient-to-r from-red-600 to-rose-600 shadow-red-200/50 dark:shadow-red-900/30' : status === 'unsure' ? 'bg-gradient-to-r from-amber-500 to-orange-500 shadow-amber-200/50 dark:shadow-amber-900/30' : 'bg-gradient-to-r from-emerald-500 to-green-600 shadow-emerald-200/50 dark:shadow-emerald-900/30'
          } disabled:opacity-50 disabled:scale-100`}>
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          {t('citizen.safety.submitCheckin', lang) || 'Submit Check-in'}
        </button>

        {/* Success Message */}
        {success && (
          <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-emerald-700 p-3.5 rounded-xl flex items-center gap-2 text-sm animate-scale-in">
            <CheckCircle className="w-4 h-4 flex-shrink-0" /> {t('citizen.safety.checkinSuccess', lang) || 'Check-in submitted successfully!'}
          </div>
        )}
      </div>

      {/* Public Safety Mode — Prominent CTA */}
      <button onClick={onEnterSafetyMode}
        className="w-full glass-card rounded-2xl p-5 text-left transition-all duration-300 group hover-lift border-2 border-transparent hover:border-red-300 dark:hover:border-red-800">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-gradient-to-br from-red-500 to-rose-600 rounded-2xl flex items-center justify-center text-white group-hover:scale-110 transition-transform shadow-lg shadow-red-200/50 dark:shadow-red-900/30">
            <ShieldAlert className="w-7 h-7" />
          </div>
          <div className="flex-1">
            <p className="text-base font-bold text-red-700 dark:text-red-300 group-hover:text-red-600">Public Safety Mode</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Full-screen emergency display with live alerts, shelters, and weather</p>
          </div>
          <ChevronRight className="w-5 h-5 text-gray-300 dark:text-gray-600 group-hover:text-red-400 group-hover:translate-x-1 transition-all" />
        </div>
      </button>

      {/* Recent Check-ins Timeline */}
      {recentSafety && recentSafety.length > 0 && (
        <div className="glass-card rounded-2xl overflow-hidden">
          <h3 className="px-5 py-3.5 border-b border-gray-100 dark:border-gray-800/80 text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Clock className="w-4 h-4 text-gray-400" /> {t('citizen.safety.recentCheckins', lang)}
          </h3>
          <div className="divide-y divide-gray-100/80 dark:divide-gray-800/60">
            {recentSafety.map((c: any, idx: number) => (
              <div key={c.id} className="px-5 py-3.5 flex items-center gap-3.5 hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-colors">
                <div className="flex flex-col items-center">
                  <div className={`w-3 h-3 rounded-full ring-4 ${
                    c.status === 'safe' ? 'bg-emerald-500 ring-emerald-100 dark:ring-emerald-950/50' : c.status === 'help' ? 'bg-red-500 ring-red-100 dark:ring-red-950/50' : 'bg-amber-500 ring-amber-100 dark:ring-amber-950/50'
                  }`} />
                  {idx < recentSafety.length - 1 && <div className="w-px h-full bg-gray-200 dark:bg-gray-700 mt-1" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white capitalize">{c.status}</p>
                  {c.message && <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate mt-0.5">{c.message}</p>}
                </div>
                <span className="text-[10px] text-gray-400 dark:text-gray-500 flex-shrink-0">{timeAgo(c.created_at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 4: PROFILE
// ═══════════════════════════════════════════════════════════════════════════════

function ProfileTab({ user, updateProfile, uploadAvatar, refreshProfile }: any) {
  const lang = useLanguage()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [msg, setMsg] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [form, setForm] = useState({
    displayName: user.displayName || '',
    phone: user.phone || '',
    bio: user.bio || '',
    country: user.country || 'United Kingdom',
    city: user.city || '',
    preferredRegion: user.preferredRegion || '',
    isVulnerable: user.isVulnerable || false,
    vulnerabilityDetails: user.vulnerabilityDetails || '',
    dateOfBirth: user.dateOfBirth || '',
  })

  const handleSave = async () => {
    setSaving(true)
    setMsg('')
    const ok = await updateProfile(form)
    setSaving(false)
    if (ok) {
      setMsg('Profile updated successfully!')
      setEditing(false)
      refreshProfile()
      setTimeout(() => setMsg(''), 3000)
    } else {
      setMsg('Failed to update profile.')
    }
  }

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    const result = await uploadAvatar(file)
    setUploading(false)
    if (result) {
      setMsg('Avatar updated!')
      refreshProfile()
      setTimeout(() => setMsg(''), 3000)
    } else {
      setMsg('Failed to upload avatar. Max 2MB, images only.')
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
      {/* Profile Header with Cover */}
      <div className="glass-card rounded-2xl overflow-hidden">
        {/* Cover gradient */}
        <div className="h-28 sm:h-36 bg-gradient-to-br from-aegis-500 via-aegis-600 to-aegis-800 relative">
          <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImciIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTTAgMGg2MHY2MEgweiIgZmlsbD0ibm9uZSIvPjxjaXJjbGUgY3g9IjMwIiBjeT0iMzAiIHI9IjEiIGZpbGw9InJnYmEoMjU1LDI1NSwyNTUsMC4wNSkiLz48L3BhdHRlcm4+PC9kZWZzPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9InVybCgjZykiLz48L3N2Zz4=')] opacity-40" />
          {/* Edit/Save buttons on cover */}
          <div className="absolute top-3 right-3 flex gap-2">
            {!editing ? (
              <button onClick={() => setEditing(true)} className="flex items-center gap-1.5 bg-white/15 hover:bg-white/25 backdrop-blur-sm border border-white/20 text-white text-xs font-semibold px-3 py-2 rounded-xl transition-all">
                <Pencil className="w-3.5 h-3.5" /> Edit Profile
              </button>
            ) : (
              <>
                <button onClick={handleSave} disabled={saving} className="flex items-center gap-1.5 bg-white text-aegis-700 text-xs font-bold px-3 py-2 rounded-xl transition-all hover:bg-white/90 shadow-lg">
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save
                </button>
                <button onClick={() => setEditing(false)} className="text-xs text-white/80 hover:text-white bg-white/15 backdrop-blur-sm border border-white/20 px-3 py-2 rounded-xl transition-all">Cancel</button>
              </>
            )}
          </div>
        </div>

        {/* Avatar + Name overlapping cover */}
        <div className="px-6 pb-5 -mt-12 sm:-mt-14 relative z-10">
          <div className="flex items-end gap-4">
            <div className="relative group flex-shrink-0">
              {user.avatarUrl ? (
                <img src={`${API_BASE}${user.avatarUrl}`} className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl object-cover border-4 border-white dark:border-gray-900 shadow-xl" alt="" />
              ) : (
                <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl bg-gradient-to-br from-aegis-400 to-aegis-700 flex items-center justify-center text-white text-2xl sm:text-3xl font-bold border-4 border-white dark:border-gray-900 shadow-xl">
                  {user.displayName?.[0]?.toUpperCase()}
                </div>
              )}
              <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
                className="absolute -bottom-1 -right-1 bg-aegis-600 hover:bg-aegis-700 text-white p-2 rounded-xl shadow-lg transition-all opacity-0 group-hover:opacity-100 hover:scale-110">
                {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleAvatarChange} className="hidden" />
            </div>
            <div className="min-w-0 pb-1">
              <h3 className="text-lg sm:text-xl font-extrabold text-gray-900 dark:text-white truncate">{user.displayName}</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{user.email}</p>
              {user.isVulnerable && (
                <span className="inline-flex items-center gap-1 mt-1.5 text-[10px] font-semibold bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded-lg">
                  <Heart className="w-3 h-3" /> Priority Support
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Status Message */}
      {msg && (
        <div className={`p-3.5 rounded-xl text-sm flex items-center gap-2 animate-scale-in ${msg.includes('success') || msg.includes('updated') ? 'bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-emerald-700' : 'bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-700'}`}>
          <CheckCircle className="w-4 h-4 flex-shrink-0" />{msg}
        </div>
      )}

      {/* Profile Fields */}
      <div className="glass-card rounded-2xl p-6 space-y-4">
        <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <User className="w-4 h-4 text-aegis-600" /> Personal Information
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            { label: 'Display Name', key: 'displayName', icon: User, value: user.displayName },
            { label: 'Phone', key: 'phone', icon: Phone, value: user.phone, placeholder: '+44 7700 900000' },
            { label: 'Country', key: 'country', icon: Globe, value: user.country },
            { label: 'City', key: 'city', icon: Building2, value: user.city, placeholder: 'Your city' },
            { label: 'Preferred Region', key: 'preferredRegion', icon: MapPin, value: user.preferredRegion, placeholder: 'e.g. Edinburgh, Scotland' },
            { label: 'Date of Birth', key: 'dateOfBirth', icon: Calendar, type: 'date', value: user.dateOfBirth ? new Date(user.dateOfBirth).toLocaleDateString() : '' },
          ].map(field => (
            <div key={field.key}>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
                <field.icon className="w-3 h-3" /> {field.label}
              </label>
              {editing ? (
                <input
                  type={field.type || 'text'}
                  value={field.type === 'date' ? (form as any)[field.key]?.split?.('T')?.[0] || '' : (form as any)[field.key]}
                  onChange={e => setForm(f => ({ ...f, [field.key]: e.target.value }))}
                  className="w-full px-3.5 py-2.5 text-sm bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 focus:border-transparent transition"
                  placeholder={field.placeholder}
                />
              ) : (
                <p className="text-sm text-gray-900 dark:text-white py-2.5 px-1 capitalize">{field.value || '—'}</p>
              )}
            </div>
          ))}
        </div>

        <div>
          <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
            <Edit3 className="w-3 h-3" /> Bio
          </label>
          {editing ? (
            <textarea value={form.bio} onChange={e => setForm(f => ({ ...f, bio: e.target.value }))}
              className="w-full px-3.5 py-2.5 text-sm bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 focus:border-transparent transition resize-none" rows={3}
              placeholder="Tell us a little about yourself..." />
          ) : (
            <p className="text-sm text-gray-900 dark:text-white py-2.5 px-1">{user.bio || '—'}</p>
          )}
        </div>
      </div>

      {/* Vulnerability Section */}
      <div className="glass-card rounded-2xl p-6">
        <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
          <Heart className="w-4 h-4 text-amber-500" /> Priority Assistance
        </h3>
        {editing ? (
          <div className="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/20 dark:to-orange-950/10 border border-amber-200/80 dark:border-amber-800/40 rounded-xl p-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={form.isVulnerable} onChange={e => setForm(f => ({ ...f, isVulnerable: e.target.checked }))}
                className="mt-0.5 w-4 h-4 rounded border-amber-300 text-amber-600 focus:ring-amber-500" />
              <div>
                <div className="flex items-center gap-1.5">
                  <Heart className="w-4 h-4 text-amber-600" />
                  <span className="text-sm font-bold text-amber-800 dark:text-amber-300">I may need priority assistance</span>
                </div>
                <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                  Enables priority routing for your support messages. Your messages will be flagged for faster response.
                </p>
              </div>
            </label>
            {form.isVulnerable && (
              <textarea value={form.vulnerabilityDetails} onChange={e => setForm(f => ({ ...f, vulnerabilityDetails: e.target.value }))}
                placeholder="Describe your needs (e.g., wheelchair user, hearing impaired)..."
                className="w-full mt-3 p-3 text-sm bg-white dark:bg-gray-800 rounded-xl border border-amber-200 dark:border-amber-700 focus:ring-2 focus:ring-amber-500 resize-none" rows={2} />
            )}
          </div>
        ) : (
          <div className={`rounded-xl p-4 ${user.isVulnerable ? 'bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/20 dark:to-orange-950/10 border border-amber-200/80 dark:border-amber-800/40' : 'bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700'}`}>
            <div className="flex items-center gap-2">
              <Heart className={`w-4 h-4 ${user.isVulnerable ? 'text-amber-600' : 'text-gray-400'}`} />
              <span className={`text-sm font-semibold ${user.isVulnerable ? 'text-amber-800 dark:text-amber-300' : 'text-gray-500'}`}>
                {user.isVulnerable ? 'Priority support is active' : 'Priority support is not active'}
              </span>
            </div>
            {user.isVulnerable && user.vulnerabilityDetails && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1.5 ml-6">{user.vulnerabilityDetails}</p>
            )}
          </div>
        )}
      </div>

      {/* Account Info */}
      <div className="glass-card rounded-2xl p-6">
        <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
          <Shield className="w-4 h-4 text-aegis-600" /> Account Information
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {[
            { label: 'Email', value: user.email, icon: Mail },
            { label: 'Verified', value: user.emailVerified ? 'Yes' : 'Not yet', icon: CheckCircle, color: user.emailVerified ? 'text-emerald-600' : 'text-amber-600' },
            { label: 'Role', value: user.role, icon: Shield, capitalize: true },
            { label: 'Login Count', value: user.loginCount || 0, icon: Activity },
            { label: 'Last Login', value: user.lastLogin ? new Date(user.lastLogin).toLocaleDateString() : '—', icon: Clock },
            { label: 'Member Since', value: user.createdAt ? new Date(user.createdAt).toLocaleDateString() : '—', icon: Calendar },
          ].map((item, i) => (
            <div key={i} className="bg-gray-50/80 dark:bg-gray-800/40 rounded-xl p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <item.icon className="w-3 h-3 text-gray-400" />
                <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">{item.label}</p>
              </div>
              <p className={`text-sm font-semibold ${item.color || 'text-gray-900 dark:text-white'} ${item.capitalize ? 'capitalize' : ''} truncate`}>{item.value}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 5: SECURITY — Change Password
// ═══════════════════════════════════════════════════════════════════════════════

function SecurityTab({ changePassword }: any) {
  const lang = useLanguage()
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [msg, setMsg] = useState('')
  const [msgType, setMsgType] = useState<'success' | 'error'>('success')

  const strength = getPasswordStrength(newPw, lang)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setMsg('')
    if (newPw !== confirmPw) { setMsg('Passwords do not match.'); setMsgType('error'); return }
    if (newPw.length < 8) { setMsg('Password must be at least 8 characters.'); setMsgType('error'); return }

    setSubmitting(true)
    const result = await changePassword(currentPw, newPw)
    setSubmitting(false)

    if (result.success) {
      setMsg('Password changed successfully!')
      setMsgType('success')
      setCurrentPw(''); setNewPw(''); setConfirmPw('')
    } else {
      setMsg(result.error || 'Failed to change password.')
      setMsgType('error')
    }
  }

  return (
    <div className="max-w-lg mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h2 className="text-xl font-extrabold text-gray-900 dark:text-white flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-md">
            <Lock className="w-4 h-4 text-white" />
          </div>
          {t('citizen.security.title', lang)}
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 ml-[42px]">Update your password to keep your account secure</p>
      </div>

      {msg && (
        <div className={`p-3.5 rounded-xl text-sm flex items-center gap-2 animate-scale-in ${
          msgType === 'success'
            ? 'bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-emerald-700'
            : 'bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-700'
        }`}>
          {msgType === 'success' ? <CheckCircle className="w-4 h-4 flex-shrink-0" /> : <AlertTriangle className="w-4 h-4 flex-shrink-0" />}
          {msg}
        </div>
      )}

      <form onSubmit={handleSubmit} className="glass-card rounded-2xl p-6 space-y-5">
        <div>
          <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">
            <Lock className="w-3 h-3" /> {t('citizen.security.currentPassword', lang)}
          </label>
          <div className="relative">
            <div className="absolute left-3.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
              <Lock className="w-3.5 h-3.5 text-gray-400" />
            </div>
            <input
              type={showPw ? 'text' : 'password'}
              value={currentPw}
              onChange={e => setCurrentPw(e.target.value)}
              className="w-full pl-14 pr-12 py-3 text-sm bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 focus:border-transparent transition"
              required
            />
            <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors p-1">
              {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <div>
          <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">
            <Lock className="w-3 h-3" /> {t('citizen.security.newPassword', lang)}
          </label>
          <div className="relative">
            <div className="absolute left-3.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
              <Lock className="w-3.5 h-3.5 text-gray-400" />
            </div>
            <input
              type={showPw ? 'text' : 'password'}
              value={newPw}
              onChange={e => setNewPw(e.target.value)}
              className="w-full pl-14 pr-4 py-3 text-sm bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 focus:border-transparent transition"
              placeholder="Min 8 characters"
              required
            />
          </div>
          {newPw.length > 0 && (
            <div className="mt-2.5">
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map(i => (
                  <div key={i} className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${i <= strength.score ? strength.color : 'bg-gray-200 dark:bg-gray-700'}`} />
                ))}
              </div>
              <p className="text-[10px] text-gray-500 mt-1 font-medium">{strength.label}</p>
            </div>
          )}
        </div>

        <div>
          <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">
            <Lock className="w-3 h-3" /> {t('citizen.security.confirmNewPassword', lang)}
          </label>
          <div className="relative">
            <div className="absolute left-3.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
              <Lock className="w-3.5 h-3.5 text-gray-400" />
            </div>
            <input
              type={showPw ? 'text' : 'password'}
              value={confirmPw}
              onChange={e => setConfirmPw(e.target.value)}
              className={`w-full pl-14 pr-12 py-3 text-sm bg-gray-50 dark:bg-gray-800/60 rounded-xl border focus:ring-2 focus:ring-aegis-500 focus:border-transparent transition ${
                confirmPw && confirmPw !== newPw ? 'border-red-300 dark:border-red-700' : confirmPw && confirmPw === newPw ? 'border-emerald-300 dark:border-emerald-700' : 'border-gray-200 dark:border-gray-700'
              }`}
              required
            />
            {confirmPw && confirmPw === newPw && <CheckCircle className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-500" />}
          </div>
        </div>

        <button type="submit" disabled={submitting || !currentPw || !newPw || !confirmPw}
          className="w-full bg-gradient-to-r from-aegis-600 to-aegis-700 hover:from-aegis-700 hover:to-aegis-800 disabled:from-gray-300 disabled:to-gray-400 disabled:cursor-not-allowed text-white py-3.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all duration-200 shadow-lg shadow-aegis-600/20 hover:shadow-aegis-600/30 hover:scale-[1.01] active:scale-[0.99]">
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
          {t('citizen.security.changePassword', lang)}
        </button>
      </form>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 6: SETTINGS — Preferences
// ═══════════════════════════════════════════════════════════════════════════════

function SettingsTab({ preferences, updatePreferences }: any) {
  const lang = useLanguage()
  const { token, logout } = useCitizenAuth()
  const { dark, toggle: toggleTheme } = useTheme()
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [msgType, setMsgType] = useState<'success' | 'error'>('success')
  const [deletionStatus, setDeletionStatus] = useState<{
    deletion_requested: boolean
    deletion_requested_at: string | null
    deletion_scheduled_at: string | null
  } | null>(null)
  const [deletionLoading, setDeletionLoading] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const initialForm = {
    audioAlertsEnabled: preferences?.audio_alerts_enabled ?? true,
    autoPlayCritical: preferences?.auto_play_critical ?? true,
    audioVolume: (() => {
      const raw = preferences?.audio_volume ?? 70
      // Server stores as 0-1, display as 0-100
      return typeof raw === 'number' && raw <= 1 ? Math.round(raw * 100) : raw
    })(),
    captionsEnabled: preferences?.captions_enabled ?? false,
    captionFontSize: preferences?.caption_font_size ?? 'medium',
    darkMode: preferences?.dark_mode ?? false,
    compactView: preferences?.compact_view ?? false,
    language: preferences?.language ?? 'en',
  }
  const [form, setForm] = useState(initialForm)

  // Dirty state tracking
  const isDirty = JSON.stringify(form) !== JSON.stringify(initialForm)

  const handleSave = async () => {
    setSaving(true)
    const ok = await updatePreferences(form)
    if (ok) {
      // Apply dark mode immediately
      if (form.darkMode !== dark) toggleTheme()
      // Apply language immediately
      if (form.language) setLanguage(form.language)
    }
    setSaving(false)
    setMsgType(ok ? 'success' : 'error')
    setMsg(ok ? '✅ Preferences saved successfully!' : '❌ Failed to save. Please try again.')
    setTimeout(() => setMsg(''), 5000)
  }

  // Fetch account deletion status
  useEffect(() => {
    if (!token) return
    fetch('/api/citizens/deletion-status', {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setDeletionStatus(data) })
      .catch(() => {})
  }, [token])

  const handleRequestDeletion = async () => {
    if (!token) return
    setDeletionLoading(true)
    try {
      const res = await fetch('/api/citizens/request-deletion', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
      })
      if (res.ok) {
        const data = await res.json()
        setDeletionStatus({
          deletion_requested: true,
          deletion_requested_at: new Date().toISOString(),
          deletion_scheduled_at: data.deletion_scheduled_at
        })
        setShowDeleteConfirm(false)
      }
    } catch (err) {
      console.error('Deletion request failed:', err)
    } finally {
      setDeletionLoading(false)
    }
  }

  const handleCancelDeletion = async () => {
    if (!token) return
    setDeletionLoading(true)
    try {
      const res = await fetch('/api/citizens/cancel-deletion', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
      })
      if (res.ok) {
        setDeletionStatus({ deletion_requested: false, deletion_requested_at: null, deletion_scheduled_at: null })
      }
    } catch (err) {
      console.error('Cancel deletion failed:', err)
    } finally {
      setDeletionLoading(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-extrabold text-gray-900 dark:text-white flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-gray-600 to-gray-800 flex items-center justify-center shadow-md">
              <Settings className="w-4 h-4 text-white" />
            </div>
            {t('citizen.tab.settings', lang)}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {isDirty && <span className="text-[10px] text-amber-600 dark:text-amber-400 font-semibold bg-amber-50 dark:bg-amber-950/30 px-2 py-1 rounded-lg">Unsaved</span>}
          <button onClick={handleSave} disabled={saving || !isDirty}
            className="flex items-center gap-1.5 bg-gradient-to-r from-aegis-600 to-aegis-700 hover:from-aegis-700 hover:to-aegis-800 disabled:from-gray-300 disabled:to-gray-400 disabled:cursor-not-allowed text-white text-xs font-bold px-4 py-2.5 rounded-xl transition-all shadow-sm hover:shadow-md">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save
          </button>
        </div>
      </div>

      {msg && (
        <div className={`border p-3.5 rounded-xl text-sm flex items-center gap-2 animate-scale-in ${
          msgType === 'success'
            ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-700'
            : 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800 text-red-700'
        }`}>
          <CheckCircle className="w-4 h-4 flex-shrink-0" />{msg}
        </div>
      )}

      {/* Audio Alerts */}
      <div className="glass-card rounded-2xl p-6 space-y-4">
        <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
            <Volume2 className="w-3.5 h-3.5 text-white" />
          </div>
          Audio Alerts
        </h3>

        <div className="flex items-center justify-between py-1">
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">Enable Audio Alerts</p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">Speak alerts aloud using text-to-speech</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" checked={form.audioAlertsEnabled} onChange={e => setForm(f => ({ ...f, audioAlertsEnabled: e.target.checked }))}
              className="sr-only peer" />
            <div className="w-11 h-6 bg-gray-200 peer-focus:ring-2 peer-focus:ring-aegis-300 dark:bg-gray-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all after:shadow-sm peer-checked:bg-gradient-to-r peer-checked:from-aegis-500 peer-checked:to-aegis-600"></div>
          </label>
        </div>

        <div className="flex items-center justify-between py-1">
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">Auto-play Critical Alerts</p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">Automatically speak critical-severity alerts</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" checked={form.autoPlayCritical} onChange={e => setForm(f => ({ ...f, autoPlayCritical: e.target.checked }))}
              className="sr-only peer" />
            <div className="w-11 h-6 bg-gray-200 peer-focus:ring-2 peer-focus:ring-aegis-300 dark:bg-gray-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all after:shadow-sm peer-checked:bg-gradient-to-r peer-checked:from-aegis-500 peer-checked:to-aegis-600"></div>
          </label>
        </div>

        <div className="py-1">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-gray-900 dark:text-white">Volume</p>
            <span className="text-xs font-bold text-aegis-600 bg-aegis-50 dark:bg-aegis-950/30 px-2 py-0.5 rounded-lg">{form.audioVolume}%</span>
          </div>
          <input type="range" min={0} max={100} value={form.audioVolume}
            onChange={e => setForm(f => ({ ...f, audioVolume: parseInt(e.target.value) }))}
            className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full appearance-none cursor-pointer accent-aegis-600" />
        </div>
      </div>

      {/* Accessibility */}
      <div className="glass-card rounded-2xl p-6 space-y-4">
        <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
            <FileText className="w-3.5 h-3.5 text-white" />
          </div>
          Accessibility
        </h3>

        <div className="flex items-center justify-between py-1">
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">Caption Overlay</p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">Show text captions for audio alerts</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" checked={form.captionsEnabled} onChange={e => setForm(f => ({ ...f, captionsEnabled: e.target.checked }))}
              className="sr-only peer" />
            <div className="w-11 h-6 bg-gray-200 peer-focus:ring-2 peer-focus:ring-aegis-300 dark:bg-gray-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all after:shadow-sm peer-checked:bg-gradient-to-r peer-checked:from-aegis-500 peer-checked:to-aegis-600"></div>
          </label>
        </div>

        <div>
          <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">Caption Font Size</label>
          <select value={form.captionFontSize} onChange={e => setForm(f => ({ ...f, captionFontSize: e.target.value }))}
            className="w-full px-3.5 py-2.5 text-sm bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 focus:border-transparent appearance-none transition">
            <option value="small">Small</option>
            <option value="medium">Medium</option>
            <option value="large">Large</option>
            <option value="xlarge">Extra Large</option>
          </select>
        </div>
      </div>

      {/* Display */}
      <div className="glass-card rounded-2xl p-6 space-y-4">
        <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
            <Eye className="w-3.5 h-3.5 text-white" />
          </div>
          Display
        </h3>

        <div className="flex items-center justify-between py-1">
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">Dark Mode</p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">Use dark theme</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" checked={form.darkMode} onChange={e => setForm(f => ({ ...f, darkMode: e.target.checked }))}
              className="sr-only peer" />
            <div className="w-11 h-6 bg-gray-200 peer-focus:ring-2 peer-focus:ring-aegis-300 dark:bg-gray-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all after:shadow-sm peer-checked:bg-gradient-to-r peer-checked:from-aegis-500 peer-checked:to-aegis-600"></div>
          </label>
        </div>

        <div className="flex items-center justify-between py-1">
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">Compact View</p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">Reduce spacing for more content</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" checked={form.compactView} onChange={e => setForm(f => ({ ...f, compactView: e.target.checked }))}
              className="sr-only peer" />
            <div className="w-11 h-6 bg-gray-200 peer-focus:ring-2 peer-focus:ring-aegis-300 dark:bg-gray-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all after:shadow-sm peer-checked:bg-gradient-to-r peer-checked:from-aegis-500 peer-checked:to-aegis-600"></div>
          </label>
        </div>

        <div>
          <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">Language</label>
          <select value={form.language} onChange={e => setForm(f => ({ ...f, language: e.target.value }))}
            className="w-full px-3.5 py-2.5 text-sm bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 focus:border-transparent appearance-none transition">
            <option value="en">English</option>
            <option value="cy">Cymraeg (Welsh)</option>
            <option value="gd">Gaidhlig (Scottish Gaelic)</option>
            <option value="fr">Francais</option>
            <option value="es">Espanol</option>
          </select>
        </div>
      </div>

      {/* Account Deletion — 30-day grace period */}
      <div className="glass-card rounded-2xl p-6 space-y-4 border-2 border-red-200/50 dark:border-red-900/30">
        <h3 className="text-sm font-bold text-red-600 dark:text-red-400 flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-red-500 to-rose-600 flex items-center justify-center">
            <Trash2 className="w-3.5 h-3.5 text-white" />
          </div>
          Delete Account
        </h3>
        
        {deletionStatus?.deletion_requested ? (
          <div className="space-y-3">
            <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800/30 rounded-lg p-4">
              <div className="flex items-start gap-2">
                <AlertCircleIcon className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-red-700 dark:text-red-400">Account Deletion Scheduled</p>
                  <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                    Your account will be permanently deleted on{' '}
                    <span className="font-bold">
                      {deletionStatus.deletion_scheduled_at
                        ? new Date(deletionStatus.deletion_scheduled_at).toLocaleDateString('en-GB', {
                            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
                          })
                        : '30 days from request'}
                    </span>.
                  </p>
                  <p className="text-xs text-red-500 dark:text-red-300 mt-2">
                    You can cancel this at any time before the scheduled date. Logging in will also automatically cancel the deletion.
                  </p>
                </div>
              </div>
            </div>
            <button
              onClick={handleCancelDeletion}
              disabled={deletionLoading}
              className="w-full px-4 py-2.5 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white rounded-lg font-medium transition text-sm flex items-center justify-center gap-2"
            >
              {deletionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              Cancel Account Deletion
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Permanently delete your account and all associated data. After requesting deletion, you have a <span className="font-bold text-gray-700 dark:text-gray-300">30-day grace period</span> to change your mind. Simply logging back in will cancel the deletion.
            </p>
            <ul className="text-xs text-gray-500 dark:text-gray-400 space-y-1 ml-4 list-disc">
              <li>Your profile and personal data will be erased</li>
              <li>Your community chat messages will be anonymized</li>
              <li>Community memberships will be removed</li>
              <li>This action is irreversible after 30 days</li>
            </ul>
            {showDeleteConfirm ? (
              <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800/30 rounded-lg p-4 space-y-3">
                <p className="text-sm font-semibold text-red-700 dark:text-red-400">Are you sure?</p>
                <p className="text-xs text-red-600 dark:text-red-400">
                  Your account will be scheduled for permanent deletion in 30 days. You can cancel anytime before then.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={handleRequestDeletion}
                    disabled={deletionLoading}
                    className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white rounded-lg font-medium transition text-sm flex items-center justify-center gap-2"
                  >
                    {deletionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    Yes, Delete My Account
                  </button>
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    className="px-4 py-2 bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg font-medium transition text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="w-full px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition text-sm flex items-center justify-center gap-2"
              >
                <Trash2 className="w-4 h-4" /> Request Account Deletion
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

