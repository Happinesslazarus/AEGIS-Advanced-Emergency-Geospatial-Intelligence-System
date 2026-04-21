/**
 * The authenticated citizen's personal dashboard. Provides access to their
 * submitted reports, messaging with operators, the SOS distress button,
 * community feeds, preparedness guides, safety check-ins, and profile settings.
 * Citizens log in via CitizenAuthPage and land here after successful auth.
 *
 * - Routed by client/src/App.tsx at /citizen/dashboard
 * - Protected: redirects unauthenticated users to /citizen (CitizenPage)
 * - Authenticated user context from client/src/contexts/CitizenAuthContext.tsx
 * - Real-time messaging via SocketContext + useSocket hook
 * - Report data from client/src/contexts/ReportsContext.tsx
 * - Makes API calls via client/src/utils/api.ts (messages, check-ins, profile)
 * - SOSButton component triggers POST /api/distress/activate
 *
 * Key sections (tabbed):
 * - Home         -- safety summary and quick links
 * - My Reports   -- citizen's own submitted reports
 * - Messages     -- direct chat thread with operators
 * - Community    -- community posts and events
 * - Preparedness -- guides, checklists, risk scores
 * - Profile      -- account settings and 2FA
 *
 * - client/src/contexts/CitizenAuthContext.tsx -- authenticated citizen state
 * - client/src/components/citizen/SOSButton.tsx -- the emergency distress trigger
 * - client/src/hooks/useDistress.ts             -- distress beacon state management
 * - server/src/routes/citizenRoutes.ts          -- citizen-specific API endpoints
 * - server/src/routes/distressRoutes.ts         -- SOS beacon backend
 * */

import React, { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from 'react'
import { usePageTitle } from '../hooks/usePageTitle'
import { createPortal } from 'react-dom'
import { useNavigate, useSearchParams} from 'react-router-dom'
import {
  Shield, User, MessageSquare, Heart, Settings, Lock,
  Bell, ChevronRight, Clock, MapPin, Phone, Mail, Camera,
  Send, Plus, AlertTriangle, CheckCircle, CircleDot,
  Loader2, ArrowLeft, Globe, Building2,
  Calendar, Edit3, Save, X, Volume2, Eye, EyeOff,
  Home, ShieldAlert, Zap, FileText, Activity, Pencil, Users,
  RefreshCw, ChevronDown, Trash2, AlertCircle as AlertCircleIcon,
  Search, ArrowUpDown, Crosshair, BookOpen, Newspaper, ExternalLink,
  Play, BookMarked, Printer, Share2, Bot, HelpCircle, Info, Filter, Wifi, Flame, Droplets, Waves,
  CloudLightning, Languages
} from 'lucide-react'
import { useCitizenAuth, getCitizenToken } from '../contexts/CitizenAuthContext'
import { type ChatThread, type ChatMessage } from '../hooks/useSocket'
import { useSharedSocket } from '../contexts/SocketContext'
import type { Socket } from 'socket.io-client'
import { useReports } from '../contexts/ReportsContext'
import { useAlerts } from '../contexts/AlertsContext'
import { useLocation } from '../contexts/LocationContext'
import { useTheme } from '../contexts/ThemeContext'
import { t, setLanguage, getLanguage} from '../utils/i18n'
import { useLanguage } from '../hooks/useLanguage'
import { TRANSLATION_LANGUAGES, buildTranslationMap, clearTranslationCache } from '../utils/translateService'
import { useWebPush } from '../hooks/useWebPush'
import { apiGetNews, type NewsItem } from '../utils/api'
import ALL_COUNTRY_CODES from '../data/allCountryCodes'
import { REGION_MAP } from '../data/allCountries'
import ProfileCountryPicker from '../components/shared/ProfileCountryPicker'
import { getFlagUrl } from '../data/worldRegions'
import CommunityChat from '../components/citizen/CommunityChat'
import CommunityChatRoom from '../components/citizen/CommunityChatRoom'
import SOSButton from '../components/citizen/SOSButton'
import ReportCard from '../components/shared/ReportCard'
import CitizenTwoFactorSettings from '../components/citizen/CitizenTwoFactorSettings'
import ErrorBoundary from '../components/shared/ErrorBoundary'
import AlertsPanel from '../components/shared/AlertsPanel'
import AlertCaptionOverlay, { showAlertCaption } from '../components/shared/AlertCaptionOverlay'
import { useAudioAlerts } from '../hooks/useAudioAlerts'

//Code-split heavy components (loaded on demand per tab)
const Chatbot = lazy(() => import('../components/citizen/Chatbot'))
const LiveMap = lazy(() => import('../components/shared/LiveMap'))
const WeatherPanel = lazy(() => import('../components/shared/WeatherPanel'))
const RiverGaugePanel = lazy(() => import('../components/shared/RiverGaugePanel'))
const IntelligenceDashboard = lazy(() => import('../components/shared/IntelligenceDashboard'))
const ReportForm = lazy(() => import('../components/citizen/ReportForm'))
const CommunityHelp = lazy(() => import('../components/citizen/CommunityHelp'))
const PreparednessGuide = lazy(() => import('../components/citizen/PreparednessGuide'))
const FamilyCheckIn = lazy(() => import('../components/citizen/FamilyCheckIn'))
const ClimateRiskDashboard = lazy(() => import('../components/shared/ClimateRiskDashboard'))
const LiveIncidentMapPanel = lazy(() => import('../components/citizen/LiveIncidentMapPanel'))
const ShelterFinder = lazy(() => import('../components/citizen/ShelterFinder'))
const RiskAssessment = lazy(() => import('../components/citizen/RiskAssessment'))
const OfflineEmergencyCard = lazy(() => import('../components/citizen/OfflineEmergencyCard'))
const CitizenWelcome = lazy(() => import('../components/citizen/CitizenWelcome'))
import { API_BASE, timeAgo, getPasswordStrength } from '../utils/helpers'
import MessageStatusIcon from '../components/ui/MessageStatusIcon'
import { useAnnounce } from '../hooks/useAnnounce'
import { usePullToRefresh } from '../hooks/usePullToRefresh'
import { useSwipeGesture } from '../hooks/useSwipeGesture'
import SubscribeModal from '../components/shared/SubscribeModal'
import { EmptyReports} from '../components/ui/EmptyState'
import { SkeletonCard, SkeletonStat, SkeletonList, Skeleton } from '../components/ui/Skeleton'
import AppLayout from '../components/layout/AppLayout'
import type { SidebarItem } from '../components/layout/Sidebar'
import SessionExpiryHandler from '../components/shared/SessionExpiryHandler'

//Use relative paths so Vite's proxy handles API requests (avoids CORS)
//API_BASE imported from ../utils/helpers

type TabKey = 'overview' | 'livemap' | 'alerts' | 'reports' | 'messages' | 'community' | 'prepare' | 'news' | 'safety' | 'shelters' | 'risk' | 'emergency' | 'profile' | 'security' | 'settings'

const TABS: { key: TabKey; labelKey: string; icon: any }[] = [
  { key: 'overview',  labelKey: 'citizen.tab.overview',  icon: Home },
  { key: 'livemap',   labelKey: 'citizen.tab.livemap',  icon: Globe },
  { key: 'alerts',    labelKey: 'alerts.pageTitle',      icon: Bell },
  { key: 'reports',   labelKey: 'citizen.tab.reports',   icon: FileText },
  { key: 'messages',  labelKey: 'citizen.tab.messages',  icon: MessageSquare },
  { key: 'community', labelKey: 'citizen.tab.community', icon: Users },
  { key: 'prepare',   labelKey: 'citizen.tab.prepare', icon: BookOpen },
  { key: 'news',      labelKey: 'citizen.tab.news',      icon: Newspaper },
  { key: 'safety',    labelKey: 'citizen.tab.safety',    icon: ShieldAlert },
  { key: 'shelters',  labelKey: 'citizen.tab.shelters',  icon: Home },
  { key: 'risk',      labelKey: 'citizen.tab.risk',      icon: Activity },
  { key: 'emergency', labelKey: 'citizen.tab.emergency', icon: AlertTriangle },
  { key: 'profile',   labelKey: 'citizen.tab.profile',   icon: User },
  { key: 'security',  labelKey: 'citizen.tab.security',  icon: Lock },
  { key: 'settings',  labelKey: 'citizen.tab.settings',  icon: Settings },
]

import EmailVerificationBanner from '../components/citizen/EmailVerificationBanner'
import ReportsTab from './citizen/ReportsTab'
import PreparednessTab from './citizen/PreparednessTab'
import NewsTab from './citizen/NewsTab'
import CommunitySection from './citizen/CommunitySection'
import LiveMapTab from './citizen/LiveMapTab'
import MessagesTab from './citizen/MessagesTab'
import SafetyTab from './citizen/SafetyTab'
import ProfileTab from './citizen/ProfileTab'
import SecurityTab from './citizen/SecurityTab'
import SettingsTab from './citizen/SettingsTab'

//MAIN COMPONENT

export default function CitizenDashboard(): JSX.Element {
  usePageTitle('My Dashboard')
  const { user, token, preferences, emergencyContacts, recentSafety, unreadMessages,
    isAuthenticated, loading, logout, updateProfile, uploadAvatar, changePassword,
    updatePreferences, submitSafetyCheckIn, refreshProfile, addEmergencyContact, removeEmergencyContact
  } = useCitizenAuth()

  const socket = useSharedSocket()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const lang = useLanguage()
  const { reports, loading: reportsLoading, refreshReports } = useReports()
  const { alerts, notifications, pushNotification, dismissNotification } = useAlerts()
  const { location: loc, availableLocations, activeLocation, setActiveLocation } = useLocation()
  const { setTheme } = useTheme()
  const { status: webPushStatus, subscribe: subscribeToWebPush, loading: webPushLoading } = useWebPush()
  const announce = useAnnounce()

  const handleRefreshSession = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch(`${API_BASE}/api/citizen-auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      })
      return res.ok
    } catch {
      return false
    }
  }, [])

  const VALID_TABS = useMemo(() => new Set(TABS.map(t => t.key)), [])
  const tabFromUrl = searchParams.get('tab')
  const initialTab = (tabFromUrl && VALID_TABS.has(tabFromUrl as TabKey)) ? tabFromUrl as TabKey : 'overview'
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab)
  const [showAssistant, setShowAssistant] = useState(false)
  const [communityUnread, setCommunityUnread] = useState(0)

  //New state for parity features
  const [showReportForm, setShowReportForm] = useState(false)
  const [showCommunityHelp, setShowCommunityHelp] = useState(false)
  const [showPreparednessGuide, setShowPreparednessGuide] = useState(false)
  const [showSubscribe, setShowSubscribe] = useState(false)
  const [showFamilyCheckIn, setShowFamilyCheckIn] = useState(false)
  const [selectedReport, setSelectedReport] = useState<any>(null)
  const [selectedAlert, setSelectedAlert] = useState<any>(null)
  const [reportSearchTerm, setReportSearchTerm] = useState('')
  const [reportSortField, setReportSortField] = useState('timestamp')
  const [reportSortOrder, setReportSortOrder] = useState('desc')
  const [newsPool, setNewsPool] = useState<NewsItem[]>([])
  const [newsOffset, setNewsOffset] = useState(0)
  const [newsServerPage, setNewsServerPage] = useState(1)
  const [newsTotalPages, setNewsTotalPages] = useState(1)
  const [newsTotal, setNewsTotal] = useState(0)
  const [newsRefreshing, setNewsRefreshing] = useState(false)
  const [newsLastFetched, setNewsLastFetched] = useState<Date | null>(null)
  const [newsHazardFilter, setNewsHazardFilter] = useState('all')
  const newsLoadingRef = useRef(false)

  const [userPosition, setUserPosition] = useState<[number,number]|null>(null)

  //Connect socket on mount
  useEffect(() => {
    if (token && !socket.connected) {
      socket.connect(token)
    }
    return () => {
      if (socket.connected) socket.disconnect()
    }
  }, [token])

  //Fetch citizen threads when socket connects
  useEffect(() => {
    if (socket.connected) {
      socket.fetchCitizenThreads()
    }
  }, [socket.connected])

  //Track community chat + post notifications when NOT on community tab
  useEffect(() => {
    const s = socket.socket
    if (!s) return

    //Listen for the global notification event (sent to ALL sockets via io.emit)
    //This works even when user is NOT in the community-chat room
    const handleCommunityNotification = (data: { senderId?: string; senderName?: string }) => {
      //Don't count own messages
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

  //Clear community unread when switching to community tab
  useEffect(() => {
    if (activeTab === 'community') {
      setCommunityUnread(0)
    }
  }, [activeTab])

  //Redirect if not authenticated
  useEffect(() => {
    if (!loading && !isAuthenticated) {
      navigate('/citizen/login', { replace: true })
    }
  }, [loading, isAuthenticated, navigate])

  //Load news from API -- pool-based with batch pagination
  const loadNews = useCallback(async (forceRefresh = false): Promise<void> => {
    if (newsLoadingRef.current) return
    newsLoadingRef.current = true
    setNewsRefreshing(true)
    try {
      const payload = await apiGetNews(forceRefresh, 1)
      if (Array.isArray(payload?.items) && payload.items.length > 0) {
        setNewsPool(payload.items)
        setNewsOffset(0)
        setNewsServerPage(1)
        setNewsTotalPages(payload.totalPages ?? 1)
        setNewsTotal(payload.total ?? payload.items.length)
        setNewsLastFetched(new Date())
      }
    } catch { /* silent */ } finally {
      setNewsRefreshing(false)
      newsLoadingRef.current = false
    }
  }, [])

  const NEWS_BATCH = 10
  const hasNextBatchInPool = newsOffset + NEWS_BATCH < newsPool.length
  const hasMoreFromServer = newsServerPage < newsTotalPages

  const nextNews = useCallback(async (): Promise<void> => {
    if (newsLoadingRef.current) return
    if (newsOffset + NEWS_BATCH < newsPool.length) {
      setNewsOffset(o => o + NEWS_BATCH)
      return
    }
    if (newsServerPage < newsTotalPages) {
      newsLoadingRef.current = true
      setNewsRefreshing(true)
      try {
        const next = newsServerPage + 1
        const payload = await apiGetNews(false, next)
        if (Array.isArray(payload?.items) && payload.items.length > 0) {
          setNewsPool(prev => [...prev, ...payload.items])
          setNewsOffset(o => o + NEWS_BATCH)
          setNewsServerPage(next)
          setNewsTotalPages(payload.totalPages ?? 1)
        }
      } catch { /* silent */ } finally {
        setNewsRefreshing(false)
        newsLoadingRef.current = false
      }
      return
    }
    //Wrap around -- fetch fresh from server
    newsLoadingRef.current = true
    setNewsRefreshing(true)
    try {
      const payload = await apiGetNews(true, 1)
      if (Array.isArray(payload?.items) && payload.items.length > 0) {
        setNewsPool(payload.items)
        setNewsOffset(0)
        setNewsServerPage(1)
        setNewsTotalPages(payload.totalPages ?? 1)
        setNewsTotal(payload.total ?? payload.items.length)
        setNewsLastFetched(new Date())
      }
    } catch { /* silent */ } finally {
      setNewsRefreshing(false)
      newsLoadingRef.current = false
    }
  }, [newsOffset, newsPool.length, newsServerPage, newsTotalPages])

  const newsItems = newsPool.slice(newsOffset, newsOffset + NEWS_BATCH)

  const filteredNewsItems = useMemo(() => {
    if (newsHazardFilter === 'all') return newsItems
    const KWMAP: Record<string, string[]> = {
      flood:      ['flood', 'flooding', 'river', 'surge', 'inundation'],
      earthquake: ['earthquake', 'quake', 'seismic', 'tremor', 'magnitude'],
      storm:      ['storm', 'hurricane', 'cyclone', 'tornado', 'typhoon', 'wind'],
      wildfire:   ['wildfire', 'fire', 'blaze', 'bushfire', 'burn'],
      drought:    ['drought', 'heatwave', 'heat wave', 'dry', 'arid'],
    }
    const kws = KWMAP[newsHazardFilter] || []
    return newsItems.filter(n => kws.some(k => (n.title + ' ' + n.source).toLowerCase().includes(k)))
  }, [newsItems, newsHazardFilter])

  //Pull-to-refresh for mobile
  const handlePullRefresh = useCallback(async () => {
    await Promise.all([
      refreshReports(),
      loadNews(false),
    ])
    announce(t('cdash.contentRefreshed', lang))
  }, [refreshReports, loadNews, announce])

  const { containerRef: pullRef, pullDistance, refreshing: pullRefreshing, pastThreshold } = usePullToRefresh({
    onRefresh: handlePullRefresh,
    enabled: 'ontouchstart' in window,
  })

  useEffect(() => {
    loadNews(false)
  }, [loadNews])

  //Sorted reports (live from API)
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

  //Accessible tab switching with screen reader announcement
  const handleTabChange = useCallback((tab: TabKey) => {
    setActiveTab(tab)
    setSearchParams(tab === 'overview' ? {} : { tab }, { replace: true })
    const tabDef = TABS.find(t => t.key === tab)
    if (tabDef) announce(`Navigated to ${t(tabDef.labelKey, lang)} tab`)
  }, [announce, lang, setSearchParams])

  //Swipe left/right to navigate between tabs on mobile
  const SWIPABLE_TABS: TabKey[] = ['overview', 'livemap', 'alerts', 'reports', 'messages', 'community']
  const swipeRef = useSwipeGesture<HTMLDivElement>({
    onSwipe: useCallback((dir) => {
      const idx = SWIPABLE_TABS.indexOf(activeTab)
      if (idx < 0) return
      if (dir === 'left' && idx < SWIPABLE_TABS.length - 1) handleTabChange(SWIPABLE_TABS[idx + 1])
      if (dir === 'right' && idx > 0) handleTabChange(SWIPABLE_TABS[idx - 1])
    }, [activeTab, handleTabChange]),
    threshold: 60,
  })

  //Sync tab when URL ?tab= param changes (e.g., browser back/forward)
  useEffect(() => {
    const urlTab = searchParams.get('tab')
    if (urlTab && VALID_TABS.has(urlTab as TabKey) && urlTab !== activeTab) {
      setActiveTab(urlTab as TabKey)
    } else if (!urlTab && activeTab !== 'overview') {
      setActiveTab('overview')
    }
  }, [searchParams, activeTab, VALID_TABS]) // activeTab needed to avoid stale comparison in urlTab !== activeTab check

  const handlePrintReport = (report: any) => {
    const printWindow = window.open('', '_blank')
    if (!printWindow) return
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>AEGIS Report ${report.reportNumber || report.id}</title>
      <style>body{font-family:system-ui,sans-serif;max-width:800px;margin:40px auto;padding:20px;line-height:1.6}.header{border-bottom:3px solid #1e40af;padding-bottom:20px;margin-bottom:20px}.logo{font-size:24px;font-weight:bold;color:#1e40af}.badge{display:inline-block;padding:4px 12px;border-radius:4px;font-size:12px;font-weight:600;margin-right:8px}.severity-high{background:#fee;color:#c00}.severity-medium{background:#ffc;color:#860}.severity-low{background:#efe;color:#060}@media print{body{margin:0}}</style></head>
      <body><div class="header"><div class="logo">${t('cdash.print.aegisTitle', lang)}</div><div>${t('cdash.print.reportId', lang)}: ${report.reportNumber || report.id}</div></div>
      <div><span class="badge severity-${report.severity?.toLowerCase()}">${report.severity}</span><span class="badge">${report.status}</span></div>
      <h2>${report.type}</h2><div><div>${report.location}</div><div>${report.displayTime || new Date(report.timestamp).toLocaleString()}</div></div>
      <div><h3>${t('cdash.print.description', lang)}</h3><p>${report.description}</p></div>
      <div style="margin-top:40px;padding-top:20px;border-top:1px solid #ddd;color:#666;font-size:12px">${t('cdash.print.generatedFrom', lang)} ${new Date().toLocaleString()}</div></body></html>`
    printWindow.document.write(html)
    printWindow.document.close()
    setTimeout(() => printWindow.print(), 250)
  }

  const handleShareReport = async (report: any) => {
    const shareData = { title: `${t('cdash.print.aegisTitle', lang)}: ${report.type}`, text: `${report.type} - ${report.severity}\n${report.location}\n\n${report.description}`, url: window.location.href }
    if (navigator.share) {
      try { await navigator.share(shareData) } catch {}
    } else {
      try {
        await navigator.clipboard.writeText(`${shareData.title}\n\n${shareData.text}`)
        pushNotification?.(t('cdash.copiedToClipboard', lang), 'success')
      } catch {}
    }
  }

  const detectLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        p => { setUserPosition([p.coords.latitude, p.coords.longitude]); pushNotification?.(t('cdash.locationDetected', lang), 'success') },
        () => pushNotification?.(t('cdash.locationDenied', lang), 'warning')
      )
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 p-4 space-y-4" role="status" aria-label={t('cdash.loadingDashboard', lang)}>
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
        <p className="text-sm text-gray-500 dark:text-gray-400">{t('citizen.loading', lang)}</p>
      </div>
    </div>
  )

  const handleSidebarNav = (item: SidebarItem) => {
    if (item.key === 'report_emergency') { setShowReportForm(true); return }
    if (item.key === 'map') { handleTabChange('livemap'); return }
    if (item.key === 'home') { handleTabChange('overview'); return }
    if (item.key === 'alerts') { handleTabChange('alerts'); return }
    handleTabChange(item.key as TabKey)
  }

  return (
    <AppLayout activeKey={activeTab === 'livemap' ? 'map' : activeTab === 'overview' ? 'home' : activeTab === 'alerts' ? 'alerts' : activeTab} onNavigate={handleSidebarNav} unreadMessages={totalUnread} communityUnread={communityUnread}>
      <SessionExpiryHandler
        isAuthenticated={isAuthenticated}
        onRefresh={handleRefreshSession}
        onExpire={logout}
      />
      {/* Email verification banner (#23) */}
      {user && !user.emailVerified && (
        <EmailVerificationBanner token={token} lang={lang} announce={announce} />
      )}

      {/* Main Content */}
      <div ref={(el) => { (pullRef as React.MutableRefObject<HTMLDivElement | null>).current = el; (swipeRef as React.MutableRefObject<HTMLDivElement | null>).current = el }} className="relative">
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
          <ErrorBoundary name="TabContent" fallback={<div className="flex items-center justify-center py-12 text-sm text-gray-500 dark:text-gray-400">Failed to load this section. Please refresh.</div>}>
          <Suspense fallback={<div className="space-y-4 p-4 animate-enter"><SkeletonCard /><SkeletonCard /><SkeletonList count={3} /></div>}>
          {activeTab === 'overview' && <CitizenWelcome user={user} threads={socket.threads} recentSafety={recentSafety} emergencyContacts={emergencyContacts} totalUnread={totalUnread} setActiveTab={(tab: string) => handleTabChange(tab as TabKey)} reportStats={reportStats} onReportEmergency={() => setShowReportForm(true)} onCommunityHelp={() => setShowCommunityHelp(true)} onSubscribe={() => setShowSubscribe(true)} submitSafetyCheckIn={submitSafetyCheckIn} />}
          {activeTab === 'livemap' && <LiveMapTab reports={reports} loc={loc} userPosition={userPosition} detectLocation={detectLocation} alerts={alerts} setSelectedAlert={setSelectedAlert} />}
          {activeTab === 'alerts' && <AlertsPanel />}
          {activeTab === 'reports' && <ReportsTab reports={sortedReports} loading={reportsLoading} searchTerm={reportSearchTerm} setSearchTerm={setReportSearchTerm} sortField={reportSortField} setSortField={setReportSortField} sortOrder={reportSortOrder} setSortOrder={setReportSortOrder} onViewReport={setSelectedReport} onPrintReport={handlePrintReport} onShareReport={handleShareReport} lang={lang} />}
          {activeTab === 'messages' && <MessagesTab socket={socket} user={user} />}
          {activeTab === 'community' && <CommunitySection parentSocket={socket.socket} />}
          {activeTab === 'prepare' && <PreparednessTab lang={lang} onOpenGuide={() => setShowPreparednessGuide(true)} />}
          {activeTab === 'news' && <NewsTab newsPool={newsPool} newsOffset={newsOffset} setNewsOffset={setNewsOffset} NEWS_BATCH={NEWS_BATCH} filteredNewsItems={filteredNewsItems} newsHazardFilter={newsHazardFilter} setNewsHazardFilter={setNewsHazardFilter} newsRefreshing={newsRefreshing} loadNews={loadNews} nextNews={nextNews} newsTotal={newsTotal} hasNextBatchInPool={hasNextBatchInPool} hasMoreFromServer={hasMoreFromServer} lastFetched={newsLastFetched} />}
          {activeTab === 'safety' && <SafetyTab submitSafetyCheckIn={submitSafetyCheckIn} recentSafety={recentSafety} onFamilyCheckIn={() => setShowFamilyCheckIn(true)} />}
          {activeTab === 'shelters' && <ShelterFinder />}
          {activeTab === 'risk' && <RiskAssessment />}
          {activeTab === 'emergency' && <OfflineEmergencyCard />}
          {activeTab === 'profile' && <ProfileTab user={user} updateProfile={updateProfile} uploadAvatar={uploadAvatar} refreshProfile={refreshProfile} />}
          {activeTab === 'security' && <SecurityTab changePassword={changePassword} />}
          {activeTab === 'settings' && <SettingsTab preferences={preferences} updatePreferences={updatePreferences} />}
          </Suspense>
          </ErrorBoundary>
      </div>

      {!showAssistant && (
        <button
          onClick={() => setShowAssistant(true)}
          className="fixed bottom-24 left-6 z-[90] w-14 h-14 bg-aegis-600 hover:bg-aegis-700 text-white rounded-full shadow-2xl shadow-aegis-600/30 flex items-center justify-center transition-all hover:scale-105"
          aria-label={t('cdash.openAiAssistant', lang)}
        >
          <MessageSquare className="w-6 h-6" />
        </button>
      )}
      {showAssistant && (
        <ErrorBoundary name="Chatbot" fallback={null}>
          <Suspense fallback={<div className="fixed bottom-4 left-4 z-50 bg-white dark:bg-gray-900 rounded-xl p-4 shadow-2xl w-80 space-y-3"><Skeleton className="h-4 w-32" /><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-3/4" /></div>}>
            <Chatbot
              onClose={() => setShowAssistant(false)}
              anchor="left"
              authToken={token}
              citizenName={user?.displayName}
              alertCount={alerts.length}
            />
          </Suspense>
        </ErrorBoundary>
      )}

      {/* SOS Distress Beacon */}
      {socket.socket && <SOSButton socket={socket.socket} citizenId={user.id} citizenName={user.displayName || t('cdash.citizenFallback', lang)} />}

      {/* MODALS (code-split) */}
      <ErrorBoundary name="Modals" fallback={null}>
        <Suspense fallback={<div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50"><div className="bg-white dark:bg-gray-900 rounded-2xl p-6 w-96 max-w-[90vw] space-y-4 shadow-2xl"><Skeleton className="h-6 w-48" /><SkeletonCard /><Skeleton className="h-10 w-full rounded-lg" /></div></div>}>
          {showReportForm && <ReportForm onClose={() => setShowReportForm(false)} />}
          {showCommunityHelp && <CommunityHelp onClose={() => setShowCommunityHelp(false)} />}
          {showPreparednessGuide && <PreparednessGuide onClose={() => setShowPreparednessGuide(false)} lang={lang} />}
          {showFamilyCheckIn && <FamilyCheckIn onClose={() => setShowFamilyCheckIn(false)} userName={user?.displayName || 'Citizen'} />}
        </Suspense>
      </ErrorBoundary>

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
                <span className={`px-3 py-1 rounded-full text-xs font-medium ${selectedReport.status === 'Urgent' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' : selectedReport.status === 'Verified' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400'}`}>{selectedReport.status}</span>
                {selectedReport.confidence != null && <span className="px-3 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 flex items-center gap-1"><Bot className="w-3 h-3" /> AI: {selectedReport.confidence}%</span>}
              </div>
              <h4 className="text-xl font-bold text-gray-900 dark:text-white">{selectedReport.type}</h4>
              <p className="text-sm text-gray-700 dark:text-gray-400 leading-relaxed">{selectedReport.description}</p>
              <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4 space-y-2">
                <div className="flex items-center gap-2 text-sm"><MapPin className="w-4 h-4 text-gray-500 dark:text-gray-400 flex-shrink-0" /><span className="text-gray-700 dark:text-gray-400">{selectedReport.location}</span></div>
                <div className="flex items-center gap-2 text-sm"><Clock className="w-4 h-4 text-gray-500 dark:text-gray-400 flex-shrink-0" /><span className="text-gray-700 dark:text-gray-400">{selectedReport.displayTime || new Date(selectedReport.timestamp).toLocaleString()}</span></div>
                {selectedReport.reporter && <div className="flex items-center gap-2 text-sm"><User className="w-4 h-4 text-gray-500 dark:text-gray-400 flex-shrink-0" /><span className="text-gray-700 dark:text-gray-400">{selectedReport.reporter}</span></div>}
                <div className="flex items-center gap-2 text-sm"><Info className="w-4 h-4 text-gray-500 dark:text-gray-400 flex-shrink-0" /><span className="text-gray-500 dark:text-gray-400 font-mono text-xs">ID: {selectedReport.reportNumber || selectedReport.id}</span></div>
              </div>
              {selectedReport.aiAnalysis && (
                <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4 space-y-2">
                  <h5 className="font-semibold text-sm text-blue-800 dark:text-blue-200 flex items-center gap-1.5"><Bot className="w-4 h-4" /> {t('admin.ai.title', lang)}</h5>
                  {selectedReport.aiAnalysis.summary && <p className="text-xs text-blue-700 dark:text-blue-300">{selectedReport.aiAnalysis.summary}</p>}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {selectedReport.aiAnalysis.sentimentScore != null && <div><span className="text-blue-600 dark:text-blue-400 font-medium">{t('cdash.sentiment', lang)}:</span> {selectedReport.aiAnalysis.sentimentScore.toFixed(2)}</div>}
                    {selectedReport.aiAnalysis.panicLevel && <div><span className="text-blue-600 dark:text-blue-400 font-medium">{t('cdash.panic', lang)}:</span> {selectedReport.aiAnalysis.panicLevel}</div>}
                    {selectedReport.aiAnalysis.fakeProbability != null && <div><span className="text-blue-600 dark:text-blue-400 font-medium">{t('cdash.fakeRisk', lang)}:</span> {(selectedReport.aiAnalysis.fakeProbability * 100).toFixed(0)}%</div>}
                  </div>
                  {selectedReport.aiAnalysis.vulnerablePersonAlert && <div className="flex items-center gap-1.5 text-xs bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-200 px-3 py-1.5 rounded-lg mt-1"><AlertTriangle className="w-3.5 h-3.5" /> {t('cdash.vulnerablePersonAlert', lang)}</div>}
                </div>
              )}
              {/* Media Attachments */}
              {(selectedReport.media?.length > 0 || selectedReport.mediaUrl) && (
                <div className="space-y-2">
                  <h5 className="font-semibold text-sm text-gray-800 dark:text-gray-200 flex items-center gap-1.5">
                    <Eye className="w-4 h-4" /> Media Attachments
                  </h5>
                  <div className="grid grid-cols-2 gap-2">
                    {selectedReport.media?.map((file: any, i: number) => (
                      <a key={file.id || i} href={file.url || file.file_url} target="_blank" rel="noopener noreferrer" className="group relative rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 hover:border-aegis-500 transition-colors">
                        {file.type === 'video' ? (
                          <video src={file.url || file.file_url} className="w-full h-32 object-cover" />
                        ) : (
                          <img src={file.url || file.file_url} alt={file.originalFilename || `Attachment ${i + 1}`} className="w-full h-32 object-cover" loading="lazy" />
                        )}
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                          <Eye className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      </a>
                    ))}
                    {!selectedReport.media?.length && selectedReport.mediaUrl && (
                      <a href={selectedReport.mediaUrl} target="_blank" rel="noopener noreferrer" className="group relative rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 hover:border-aegis-500 transition-colors">
                        <img src={selectedReport.mediaUrl} alt="Report attachment" className="w-full h-32 object-cover" loading="lazy" />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                          <Eye className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="p-5 border-t border-gray-200 dark:border-gray-700 flex gap-3">
              <button onClick={() => setSelectedReport(null)} className="flex-1 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-400 rounded-xl py-2.5 text-sm font-semibold transition-colors">{t('cdash.close', lang)}</button>
              <button onClick={() => handleShareReport(selectedReport)} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white rounded-xl py-2.5 text-sm font-semibold transition-colors flex items-center justify-center gap-2"><Share2 className="w-4 h-4" /> {t('cdash.share', lang)}</button>
              <button onClick={() => handlePrintReport(selectedReport)} className="flex-1 bg-gray-600 hover:bg-gray-700 text-white rounded-xl py-2.5 text-sm font-semibold transition-colors flex items-center justify-center gap-2"><Printer className="w-4 h-4" /> {t('cdash.print', lang)}</button>
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
              <p className="text-sm text-gray-700 dark:text-gray-400 leading-relaxed">{selectedAlert.message}</p>
              <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4 space-y-2">
                {selectedAlert.locationText && <div className="flex items-center gap-2 text-sm"><MapPin className="w-4 h-4 text-gray-500 dark:text-gray-400 flex-shrink-0" /><span className="text-gray-700 dark:text-gray-400">{selectedAlert.locationText}</span></div>}
                <div className="flex items-center gap-2 text-sm"><Clock className="w-4 h-4 text-gray-500 dark:text-gray-400 flex-shrink-0" /><span className="text-gray-700 dark:text-gray-400">{new Date(selectedAlert.createdAt).toLocaleString()}</span></div>
              </div>
              <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4">
                <h5 className="font-semibold text-sm text-amber-800 dark:text-amber-200 mb-1">{t('citizen.alertDetail.safetyAdvice', lang)}</h5>
                <p className="text-xs text-amber-700 dark:text-amber-300">{t('citizen.alertDetail.safetyMsg', lang)}</p>
              </div>
            </div>
            <div className="p-5 border-t border-gray-200 dark:border-gray-700 flex gap-3">
              <button onClick={() => setSelectedAlert(null)} className="flex-1 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-400 rounded-xl py-2.5 text-sm font-semibold transition-colors">{t('cdash.close', lang)}</button>
              <button onClick={() => { setSelectedAlert(null); setShowReportForm(true) }} className="flex-1 bg-red-600 hover:bg-red-700 text-white rounded-xl py-2.5 text-sm font-semibold transition-colors flex items-center justify-center gap-2"><AlertTriangle className="w-4 h-4" /> {t('citizen.alertDetail.reportIncident', lang)}</button>
            </div>
          </div>
        </div>
      )}

      <SubscribeModal
        isOpen={showSubscribe}
        onClose={() => setShowSubscribe(false)}
        user={user}
        pushNotification={pushNotification}
      />

      {/* Toasts */}
      <div className="fixed top-16 right-4 z-50 space-y-2">
        {notifications?.map(n => (
          <div key={n.id} onClick={() => dismissNotification?.(n.id)} className={`px-4 py-2.5 rounded-xl text-sm shadow-lg cursor-pointer animate-fade-in max-w-[calc(100vw-2rem)] sm:max-w-xs ${n.type === 'success' ? 'bg-green-600 text-white' : n.type === 'warning' ? 'bg-amber-500 text-white' : n.type === 'error' ? 'bg-red-600 text-white' : 'bg-blue-600 text-white'}`}>{n.message}</div>
        ))}
      </div>
    </AppLayout>
  )
}

