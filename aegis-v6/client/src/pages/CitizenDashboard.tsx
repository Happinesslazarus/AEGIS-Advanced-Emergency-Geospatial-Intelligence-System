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
import { createPortal } from 'react-dom'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import {
  Shield, User, MessageSquare, Heart, Settings, Lock, LogOut,
  Bell, ChevronRight, Clock, MapPin, Phone, Mail, Camera,
  Send, Plus, AlertTriangle, CheckCircle, Circle, CircleDot,
  Loader2, Check, CheckCheck, ArrowLeft, Globe, Building2,
  Calendar, Edit3, Save, X, Mic, Volume2, Eye, EyeOff,
  Home, ShieldAlert, Zap, FileText, Activity, Ban, Pencil, Users,
  RefreshCw, ChevronDown, Trash2, AlertCircle as AlertCircleIcon,
  Search, ArrowUpDown, Crosshair, BookOpen, Newspaper, ExternalLink,
  Play, BookMarked, Printer, Share2, Bot, HelpCircle, Info, Filter,
  Smartphone, Wifi, Flame, Video, Droplets, Waves,
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
import { TRANSLATION_LANGUAGES, buildTranslationMap, clearTranslationCache } from '../utils/translateService'
import { useWebPush } from '../hooks/useWebPush'
import { apiSubscribe, apiGetNews, type NewsItem } from '../utils/api'
import { COUNTRY_CODES, type CountryCode, formatPhoneWithCountry } from '../data/countryCodes'
import ALL_COUNTRY_CODES from '../data/allCountryCodes'
import { REGION_MAP } from '../data/allCountries'
import ProfileCountryPicker from '../components/shared/ProfileCountryPicker'
import { getFlagUrl } from '../data/worldRegions'
import CommunityChat from '../components/citizen/CommunityChat'
import CommunityChatRoom from '../components/citizen/CommunityChatRoom'
import SOSButton from '../components/citizen/SOSButton'
import DisasterMap from '../components/shared/DisasterMap'
import ReportCard from '../components/shared/ReportCard'
import CitizenTwoFactorSettings from '../components/citizen/CitizenTwoFactorSettings'

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
const LiveIncidentMapPanel = lazy(() => import('../components/citizen/LiveIncidentMapPanel'))
const ShelterFinder = lazy(() => import('../components/citizen/ShelterFinder'))
const RiskAssessment = lazy(() => import('../components/citizen/RiskAssessment'))
const OfflineEmergencyCard = lazy(() => import('../components/citizen/OfflineEmergencyCard'))
const CitizenWelcome = lazy(() => import('../components/citizen/CitizenWelcome'))
import { API_BASE, timeAgo, getPasswordStrength } from '../utils/helpers'
import MessageStatusIcon from '../components/ui/MessageStatusIcon'
import { useAnnounce } from '../hooks/useAnnounce'
import { usePullToRefresh } from '../hooks/usePullToRefresh'
import CountrySearch from '../components/shared/CountrySearch'
import LanguageSelector from '../components/shared/LanguageSelector'
import ThemeSelector from '../components/ui/ThemeSelector'
import { EmptyMessages, EmptyReports, EmptySafety } from '../components/ui/EmptyState'
import { SkeletonCard, SkeletonStat, SkeletonList, Skeleton } from '../components/ui/Skeleton'
import AppLayout from '../components/layout/AppLayout'
import type { SidebarItem } from '../components/layout/Sidebar'

// Use relative paths so Vite's proxy handles API requests (avoids CORS)
// API_BASE imported from ../utils/helpers

type TabKey = 'overview' | 'livemap' | 'reports' | 'messages' | 'community' | 'prepare' | 'news' | 'safety' | 'shelters' | 'risk' | 'emergency' | 'profile' | 'security' | 'settings'

const TABS: { key: TabKey; labelKey: string; icon: any }[] = [
  { key: 'overview',  labelKey: 'citizen.tab.overview',  icon: Home },
  { key: 'livemap',   labelKey: 'citizen.tab.livemap',  icon: Globe },
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

// MAIN COMPONENT

export default function CitizenDashboard(): JSX.Element {
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

  const VALID_TABS = useMemo(() => new Set(TABS.map(t => t.key)), [])
  const tabFromUrl = searchParams.get('tab')
  const initialTab = (tabFromUrl && VALID_TABS.has(tabFromUrl as TabKey)) ? tabFromUrl as TabKey : 'overview'
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab)
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
  const [newsTotalPages, setNewsTotalPages] = useState(1)
  const [newsLastFetched, setNewsLastFetched] = useState<Date | null>(null)
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

  // Sync saved user preferences (language, dark mode, compact view) on load
  useEffect(() => {
    if (preferences) {
      if (preferences.language && preferences.language !== getLanguage()) {
        setLanguage(preferences.language)
      }
      if (typeof preferences.dark_mode === 'boolean') {
        setTheme(preferences.dark_mode ? 'default' : 'light')
      }
      if (typeof preferences.compact_view === 'boolean') {
        document.documentElement.classList.toggle('compact-view', preferences.compact_view)
      }
      if (preferences.caption_font_size) {
        document.documentElement.setAttribute('data-caption-size', preferences.caption_font_size)
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

  // Load news from API — pass fresh=true to bust server cache on manual refresh
  const loadNews = useCallback(async (notify = false, page = 1) => {
    setNewsRefreshing(true)
    try {
      // When user explicitly refreshes (notify=true), pass fresh=true so server bypasses its cache
      const payload = await apiGetNews(notify, page)
      if (Array.isArray(payload?.items) && payload.items.length > 0) {
        setNewsItems(prev => page > 1 ? [...prev, ...payload.items] : payload.items)
        setNewsTotalPages(payload.totalPages ?? 1)
        setNewsLastFetched(new Date())
        if (notify && page === 1) pushNotification?.(t('cdash.newsRefreshed', lang), 'success')
      } else if (notify) {
        pushNotification?.(t('cdash.noFreshNews', lang), 'warning')
      }
    } catch {
      if (notify) pushNotification?.(t('cdash.unableToLoadNews', lang), 'warning')
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
    announce(t('cdash.contentRefreshed', lang))
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
    setSearchParams(tab === 'overview' ? {} : { tab }, { replace: true })
    const tabDef = TABS.find(t => t.key === tab)
    if (tabDef) announce(`Navigated to ${t(tabDef.labelKey, lang)} tab`)
  }, [announce, lang, setSearchParams])

  // Sync tab when URL ?tab= param changes (e.g., browser back/forward)
  useEffect(() => {
    const urlTab = searchParams.get('tab')
    if (urlTab && VALID_TABS.has(urlTab as TabKey) && urlTab !== activeTab) {
      setActiveTab(urlTab as TabKey)
    } else if (!urlTab && activeTab !== 'overview') {
      setActiveTab('overview')
    }
  }, [searchParams]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubscribe = async () => {
    if (subChannels.length === 0) return
    try {
      const normalizedChannels = subChannels.map(ch => ch === 'webpush' ? 'web' : ch)
      const formattedPhone = subPhone ? formatPhoneWithCountry(selectedCountry, subPhone) : ''
      if (subChannels.includes('webpush')) {
        try {
          await subscribeToWebPush(subEmail)
          pushNotification?.(t('cdash.webPushEnabled', lang), 'success')
        } catch (err: any) {
          pushNotification?.(`${t('cdash.webPushFailed', lang)}: ${err.message}`, 'warning')
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
      pushNotification?.(`${t('cdash.subscribedTo', lang)}: ${normalizedChannels.join(', ')}`, 'success')
      setShowSubscribe(false)
    } catch (err: any) {
      pushNotification?.(err?.message || t('cdash.subscriptionFailed', lang), 'error')
    }
  }

  const handlePrintReport = (report: any) => {
    const printWindow = window.open('', '_blank')
    if (!printWindow) return
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>AEGIS Report ${report.id}</title>
      <style>body{font-family:system-ui,sans-serif;max-width:800px;margin:40px auto;padding:20px;line-height:1.6}.header{border-bottom:3px solid #1e40af;padding-bottom:20px;margin-bottom:20px}.logo{font-size:24px;font-weight:bold;color:#1e40af}.badge{display:inline-block;padding:4px 12px;border-radius:4px;font-size:12px;font-weight:600;margin-right:8px}.severity-high{background:#fee;color:#c00}.severity-medium{background:#ffc;color:#860}.severity-low{background:#efe;color:#060}@media print{body{margin:0}}</style></head>
      <body><div class="header"><div class="logo">${t('cdash.print.aegisTitle', lang)}</div><div>${t('cdash.print.reportId', lang)}: ${report.id}</div></div>
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
    if (item.key === 'alerts') { navigate('/alerts'); return }
    handleTabChange(item.key as TabKey)
  }

  return (
    <AppLayout activeKey={activeTab === 'livemap' ? 'map' : activeTab === 'overview' ? 'home' : activeTab} onNavigate={handleSidebarNav} unreadMessages={totalUnread} communityUnread={communityUnread}>
      {/* Email verification banner (#23) */}
      {user && !user.emailVerified && (
        <div className="bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800 px-4 py-2.5 flex items-center justify-between gap-3 rounded-xl mb-4">
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
                if (res.ok) announce(t('cdash.verificationSent', lang))
                else announce(data.error || t('cdash.verificationFailed', lang))
              } catch { announce(t('cdash.verificationFailed', lang)) }
            }}
            className="text-xs font-semibold text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/50 hover:bg-amber-200 dark:hover:bg-amber-900 px-3 py-1 rounded-lg transition whitespace-nowrap"
          >
            {t('citizen.verifyEmail.resend', lang) || 'Resend Email'}
          </button>
        </div>
      )}

      {/* Main Content */}
      <div ref={pullRef} className="relative">
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
          {activeTab === 'overview' && <CitizenWelcome user={user} threads={socket.threads} recentSafety={recentSafety} emergencyContacts={emergencyContacts} totalUnread={totalUnread} setActiveTab={(tab: string) => setActiveTab(tab as TabKey)} reportStats={reportStats} onReportEmergency={() => setShowReportForm(true)} onCommunityHelp={() => setShowCommunityHelp(true)} submitSafetyCheckIn={submitSafetyCheckIn} />}
          {activeTab === 'livemap' && <LiveMapTab reports={reports} loc={loc} userPosition={userPosition} detectLocation={detectLocation} alerts={alerts} setSelectedAlert={setSelectedAlert} />}
          {activeTab === 'reports' && <ReportsTab reports={sortedReports} loading={reportsLoading} searchTerm={reportSearchTerm} setSearchTerm={setReportSearchTerm} sortField={reportSortField} setSortField={setReportSortField} sortOrder={reportSortOrder} setSortOrder={setReportSortOrder} onViewReport={setSelectedReport} onPrintReport={handlePrintReport} onShareReport={handleShareReport} lang={lang} />}
          {activeTab === 'messages' && <MessagesTab socket={socket} user={user} />}
          {activeTab === 'community' && <CommunitySection parentSocket={socket.socket} />}
          {activeTab === 'prepare' && <PreparednessTab lang={lang} onOpenGuide={() => setShowPreparednessGuide(true)} />}
          {activeTab === 'news' && <NewsTab newsItems={newsItems} newsRefreshing={newsRefreshing} loadNews={loadNews} refreshReports={refreshReports} totalPages={newsTotalPages} lastFetched={newsLastFetched} />}
          {activeTab === 'safety' && <SafetyTab submitSafetyCheckIn={submitSafetyCheckIn} recentSafety={recentSafety} onEnterSafetyMode={() => setShowSafetyMode(true)} />}
          {activeTab === 'shelters' && <ShelterFinder />}
          {activeTab === 'risk' && <RiskAssessment />}
          {activeTab === 'emergency' && <OfflineEmergencyCard />}
          {activeTab === 'profile' && <ProfileTab user={user} updateProfile={updateProfile} uploadAvatar={uploadAvatar} refreshProfile={refreshProfile} />}
          {activeTab === 'security' && <SecurityTab changePassword={changePassword} />}
          {activeTab === 'settings' && <SettingsTab preferences={preferences} updatePreferences={updatePreferences} />}
          </Suspense>
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
      {showAssistant && <Suspense fallback={<div className="fixed bottom-4 left-4 z-50 bg-white dark:bg-gray-900 rounded-xl p-4 shadow-2xl"><Loader2 className="w-6 h-6 animate-spin text-aegis-600" /></div>}><Chatbot onClose={() => setShowAssistant(false)} anchor="left" /></Suspense>}

      {/* SOS Distress Beacon */}
      {socket.socket && <SOSButton socket={socket.socket} citizenId={user.id} citizenName={user.displayName || t('cdash.citizenFallback', lang)} />}

      {/* MODALS (code-split) */}
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
                <span className={`px-3 py-1 rounded-full text-xs font-medium ${selectedReport.status === 'Urgent' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' : selectedReport.status === 'Verified' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400'}`}>{selectedReport.status}</span>
                {selectedReport.confidence != null && <span className="px-3 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 flex items-center gap-1"><Bot className="w-3 h-3" /> AI: {selectedReport.confidence}%</span>}
              </div>
              <h4 className="text-xl font-bold text-gray-900 dark:text-white">{selectedReport.type}</h4>
              <p className="text-sm text-gray-700 dark:text-gray-400 leading-relaxed">{selectedReport.description}</p>
              <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4 space-y-2">
                <div className="flex items-center gap-2 text-sm"><MapPin className="w-4 h-4 text-gray-500 dark:text-gray-400 flex-shrink-0" /><span className="text-gray-700 dark:text-gray-400">{selectedReport.location}</span></div>
                <div className="flex items-center gap-2 text-sm"><Clock className="w-4 h-4 text-gray-500 dark:text-gray-400 flex-shrink-0" /><span className="text-gray-700 dark:text-gray-400">{selectedReport.displayTime || new Date(selectedReport.timestamp).toLocaleString()}</span></div>
                {selectedReport.reporter && <div className="flex items-center gap-2 text-sm"><User className="w-4 h-4 text-gray-500 dark:text-gray-400 flex-shrink-0" /><span className="text-gray-700 dark:text-gray-400">{selectedReport.reporter}</span></div>}
                <div className="flex items-center gap-2 text-sm"><Info className="w-4 h-4 text-gray-500 dark:text-gray-400 flex-shrink-0" /><span className="text-gray-500 dark:text-gray-400 font-mono text-xs">ID: {selectedReport.id}</span></div>
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

      {/* Subscribe Modal */}
      {showSubscribe && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={() => setShowSubscribe(false)}>
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h3 className="font-bold flex items-center gap-2"><Bell className="w-5 h-5 text-blue-600" /> {t('citizen.subscribe.subscribeTo', lang)}</h3>
              <button onClick={() => setShowSubscribe(false)} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-xs text-gray-500 dark:text-gray-400">{t('citizen.subscribe.chooseChannels', lang)}</p>
              {[
                { key: 'email', label: t('cdash.sub.email', lang), icon: Mail, color: 'text-red-500' },
                { key: 'sms', label: t('cdash.sub.sms', lang), icon: Smartphone, color: 'text-green-500' },
                { key: 'telegram', label: t('cdash.sub.telegram', lang), icon: Send, color: 'text-blue-500' },
                { key: 'whatsapp', label: t('cdash.sub.whatsapp', lang), icon: MessageSquare, color: 'text-green-600' },
                { key: 'webpush', label: t('cdash.sub.webpush', lang), icon: Wifi, color: 'text-purple-500' },
              ].map(ch => (
                <button key={ch.key} onClick={() => setSubChannels(p => p.includes(ch.key) ? p.filter(c => c !== ch.key) : [...p, ch.key])}
                  className={`w-full p-3 rounded-xl border-2 flex items-center gap-3 transition-all ${subChannels.includes(ch.key) ? 'border-aegis-500 bg-aegis-50 dark:bg-aegis-950/20' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'}`}>
                  <ch.icon className={`w-5 h-5 ${ch.color}`} /><span className="text-sm font-medium flex-1 text-left">{ch.label}</span>
                  {subChannels.includes(ch.key) && <CheckCircle className="w-5 h-5 text-aegis-500" />}
                </button>
              ))}
              {subChannels.includes('email') && <input className="w-full px-3 py-2 text-sm bg-gray-100 dark:bg-gray-800 rounded-lg border-none" placeholder={t('cdash.sub.emailPlaceholder', lang)} value={subEmail} onChange={e => setSubEmail(e.target.value)} />}
              {(subChannels.includes('sms') || subChannels.includes('whatsapp')) && (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <CountrySearch countries={ALL_COUNTRY_CODES} selected={selectedCountry} onChange={setSelectedCountry} />
                    <input className="flex-1 px-3 py-2 text-sm bg-gray-100 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700" placeholder={selectedCountry.format} value={subPhone} onChange={e => setSubPhone(e.target.value)} type="tel" />
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Example: {selectedCountry.dial} {selectedCountry.format}</p>
                </div>
              )}
              {subChannels.includes('telegram') && <input className="w-full px-3 py-2 text-sm bg-gray-100 dark:bg-gray-800 rounded-lg border-none" placeholder={t('cdash.sub.telegramPlaceholder', lang)} value={subTelegramId} onChange={e => setSubTelegramId(e.target.value)} />}
              {/* Topic filter */}
              <div>
                <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">{t('citizen.subscribe.alertTopics', lang) || 'Alert Topics'}</p>
                <div className="flex flex-wrap gap-1.5">
                  {(['flood', 'fire', 'storm', 'earthquake', 'heatwave', 'tsunami', 'general'] as const).map(topic => (
                    <button key={topic} onClick={() => setSubTopics(p => p.includes(topic) ? p.filter(t => t !== topic) : [...p, topic])}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-all ${
                        subTopics.includes(topic)
                          ? 'border-aegis-500 bg-aegis-50 dark:bg-aegis-950/20 text-aegis-700 dark:text-aegis-300'
                          : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300'
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
    </AppLayout>
  )
}

// TAB: REPORTS — Professional-grade report dashboard

type ReportFilterLevel = 'all' | 'High' | 'Medium' | 'Low'
type ReportStatusFilter = 'all' | 'Unverified' | 'Verified' | 'Urgent' | 'Resolved'

function ReportsTab({ reports, loading, searchTerm, setSearchTerm, sortField, setSortField, sortOrder, setSortOrder, onViewReport, onPrintReport, onShareReport, lang }: any) {
  const [severityFilter, setSeverityFilter] = useState<ReportFilterLevel>('all')
  const [statusFilter, setStatusFilter] = useState<ReportStatusFilter>('all')
  const [lastRefresh] = useState(Date.now())

  const filtered = useMemo(() => {
    let list = [...reports]
    if (severityFilter !== 'all') list = list.filter((r: any) => r.severity === severityFilter)
    if (statusFilter !== 'all') list = list.filter((r: any) => r.status === statusFilter)
    return list
  }, [reports, severityFilter, statusFilter])

  const stats = useMemo(() => {
    const high = reports.filter((r: any) => r.severity === 'High').length
    const medium = reports.filter((r: any) => r.severity === 'Medium').length
    const low = reports.filter((r: any) => r.severity === 'Low').length
    const urgent = reports.filter((r: any) => r.status === 'Urgent').length
    const verified = reports.filter((r: any) => r.status === 'Verified').length
    const unverified = reports.filter((r: any) => r.status === 'Unverified').length
    const resolved = reports.filter((r: any) => r.status === 'Resolved' || r.status === 'Archived').length
    const withMedia = reports.filter((r: any) => r.hasMedia).length
    const aiPowered = reports.filter((r: any) => r.confidence != null).length
    return { total: reports.length, high, medium, low, urgent, verified, unverified, resolved, withMedia, aiPowered }
  }, [reports])

  // Severity bar percentages
  const total = stats.total || 1
  const pH = (stats.high / total) * 100
  const pM = (stats.medium / total) * 100
  const pL = (stats.low / total) * 100

  return (
    <div className="max-w-5xl mx-auto animate-fade-in space-y-4">
      {/* HEADER */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-aegis-500 to-aegis-700 flex items-center justify-center shadow-lg shadow-aegis-600/20">
              <FileText className="w-5 h-5 text-white" />
            </div>
            {stats.urgent > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 border-2 border-white dark:border-gray-900 flex items-center justify-center">
                <span className="text-[7px] font-black text-white">{stats.urgent}</span>
              </span>
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-extrabold text-gray-900 dark:text-white tracking-tight">{t('cdash.reports.recentReports', lang)}</h2>
              <span className="px-2.5 py-0.5 rounded-full bg-aegis-100 dark:bg-aegis-900/40 text-aegis-700 dark:text-aegis-300 text-xs font-bold">{stats.total}</span>
            </div>
            <p className="text-[10px] text-gray-500 dark:text-gray-400 font-medium mt-0.5">
              {stats.high} {t('cdash.reports.critical', lang)} · {stats.verified} {t('cdash.reports.verified', lang)} · {stats.aiPowered} {t('cdash.reports.aiAnalysed', lang)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="flex items-center gap-1 px-2 py-1 rounded-full bg-green-100 dark:bg-green-900/40 text-[9px] font-bold text-green-700 dark:text-green-300 uppercase tracking-wider">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            Live
          </span>
        </div>
      </div>

      {/* STATS GRID */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <button
          onClick={() => { setSeverityFilter('High'); setStatusFilter('all') }}
          className={`glass-card rounded-xl p-3 text-left transition-all hover:scale-[1.02] ${severityFilter === 'High' ? 'ring-2 ring-red-500/50' : ''}`}
        >
          <div className="flex items-center justify-between mb-1">
            <AlertTriangle className={`w-4 h-4 ${stats.high > 0 ? 'text-red-500 animate-pulse' : 'text-gray-400 dark:text-gray-400'}`} />
            <span className="text-[8px] font-bold text-gray-400 dark:text-gray-400 uppercase">{t('cdash.reports.critical', lang)}</span>
          </div>
          <div className={`text-2xl font-black leading-none ${stats.high > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>{stats.high}</div>
          <div className="mt-1.5 w-full h-1 rounded-full bg-gray-200/60 dark:bg-gray-700/40 overflow-hidden">
            <div className="h-full bg-red-500 rounded-full transition-all duration-700" style={{ width: `${pH}%` }} />
          </div>
        </button>
        <button
          onClick={() => { setSeverityFilter('Medium'); setStatusFilter('all') }}
          className={`glass-card rounded-xl p-3 text-left transition-all hover:scale-[1.02] ${severityFilter === 'Medium' ? 'ring-2 ring-amber-500/50' : ''}`}
        >
          <div className="flex items-center justify-between mb-1">
            <Zap className="w-4 h-4 text-amber-500" />
            <span className="text-[8px] font-bold text-gray-400 dark:text-gray-400 uppercase">{t('cdash.reports.moderate', lang)}</span>
          </div>
          <div className="text-2xl font-black text-gray-900 dark:text-white leading-none">{stats.medium}</div>
          <div className="mt-1.5 w-full h-1 rounded-full bg-gray-200/60 dark:bg-gray-700/40 overflow-hidden">
            <div className="h-full bg-amber-500 rounded-full transition-all duration-700" style={{ width: `${pM}%` }} />
          </div>
        </button>
        <button
          onClick={() => { setSeverityFilter('Low'); setStatusFilter('all') }}
          className={`glass-card rounded-xl p-3 text-left transition-all hover:scale-[1.02] ${severityFilter === 'Low' ? 'ring-2 ring-blue-500/50' : ''}`}
        >
          <div className="flex items-center justify-between mb-1">
            <Shield className="w-4 h-4 text-blue-500" />
            <span className="text-[8px] font-bold text-gray-400 dark:text-gray-400 uppercase">{t('cdash.reports.low', lang)}</span>
          </div>
          <div className="text-2xl font-black text-gray-900 dark:text-white leading-none">{stats.low}</div>
          <div className="mt-1.5 w-full h-1 rounded-full bg-gray-200/60 dark:bg-gray-700/40 overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full transition-all duration-700" style={{ width: `${pL}%` }} />
          </div>
        </button>
        <button
          onClick={() => { setStatusFilter('Verified'); setSeverityFilter('all') }}
          className={`glass-card rounded-xl p-3 text-left transition-all hover:scale-[1.02] ${statusFilter === 'Verified' ? 'ring-2 ring-emerald-500/50' : ''}`}
        >
          <div className="flex items-center justify-between mb-1">
            <CheckCircle className="w-4 h-4 text-emerald-500" />
            <span className="text-[8px] font-bold text-gray-400 dark:text-gray-400 uppercase">{t('cdash.reports.verified', lang)}</span>
          </div>
          <div className="text-2xl font-black text-gray-900 dark:text-white leading-none">{stats.verified}</div>
          <div className="mt-1.5 w-full h-1 rounded-full bg-gray-200/60 dark:bg-gray-700/40 overflow-hidden">
            <div className="h-full bg-emerald-500 rounded-full transition-all duration-700" style={{ width: `${(stats.verified / total) * 100}%` }} />
          </div>
        </button>
      </div>

      {/* SEVERITY DISTRIBUTION BAR */}
      <div className="glass-card rounded-xl px-3 py-2.5">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[9px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('cdash.reports.severityDistribution', lang)}</span>
          {severityFilter !== 'all' || statusFilter !== 'all' ? (
            <button onClick={() => { setSeverityFilter('all'); setStatusFilter('all') }} className="text-[9px] font-bold text-aegis-600 dark:text-aegis-400 hover:underline">{t('cdash.reports.clearFilters', lang)}</button>
          ) : null}
        </div>
        <div className="flex h-2.5 rounded-full overflow-hidden bg-gray-200/60 dark:bg-gray-700/40">
          {pH > 0 && <div className="h-full bg-gradient-to-r from-red-500 to-red-600 transition-all duration-700 cursor-pointer hover:opacity-80" style={{ width: `${pH}%` }} onClick={() => setSeverityFilter('High')} title={`High: ${stats.high}`} />}
          {pM > 0 && <div className="h-full bg-gradient-to-r from-amber-400 to-amber-500 transition-all duration-700 cursor-pointer hover:opacity-80" style={{ width: `${pM}%` }} onClick={() => setSeverityFilter('Medium')} title={`Medium: ${stats.medium}`} />}
          {pL > 0 && <div className="h-full bg-gradient-to-r from-blue-400 to-blue-500 transition-all duration-700 cursor-pointer hover:opacity-80" style={{ width: `${pL}%` }} onClick={() => setSeverityFilter('Low')} title={`Low: ${stats.low}`} />}
        </div>
        <div className="flex justify-between mt-1">
          <div className="flex gap-3 text-[9px] font-medium">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" />{t('cdash.reports.high', lang)} {stats.high}</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" />{t('cdash.reports.medium', lang)} {stats.medium}</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500" />{t('cdash.reports.low', lang)} {stats.low}</span>
          </div>
          <div className="flex gap-3 text-[9px] font-medium text-gray-400 dark:text-gray-400">
            <span>{stats.withMedia} {t('cdash.reports.withMedia', lang)}</span>
            <span>{stats.aiPowered} {t('cdash.reports.ai', lang)}</span>
          </div>
        </div>
      </div>

      {/* STATUS PIPELINE */}
      <div className="flex items-center gap-1">
        {([
          { key: 'all' as const, label: t('cdash.reports.all', lang), count: stats.total, color: 'text-gray-600 dark:text-gray-400', activeBg: 'bg-gray-100 dark:bg-gray-700' },
          { key: 'Unverified' as const, label: t('cdash.reports.unverified', lang), count: stats.unverified, color: 'text-yellow-600', activeBg: 'bg-yellow-50 dark:bg-yellow-950/30' },
          { key: 'Verified' as const, label: t('cdash.reports.verifiedStatus', lang), count: stats.verified, color: 'text-emerald-600', activeBg: 'bg-emerald-50 dark:bg-emerald-950/30' },
          { key: 'Urgent' as const, label: t('cdash.reports.urgent', lang), count: stats.urgent, color: 'text-red-600', activeBg: 'bg-red-50 dark:bg-red-950/30' },
          { key: 'Resolved' as const, label: t('cdash.reports.resolved', lang), count: stats.resolved, color: 'text-blue-600', activeBg: 'bg-blue-50 dark:bg-blue-950/30' },
        ]).map(st => (
          <button
            key={st.key}
            onClick={() => { setStatusFilter(st.key); if (st.key !== 'all') setSeverityFilter('all') }}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-bold whitespace-nowrap transition-all ${
              statusFilter === st.key
                ? `${st.activeBg} ${st.color} ring-1 ring-current/20 shadow-sm`
                : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800/50'
            }`}
          >
            {st.label}
            {st.count > 0 && <span className={`ml-0.5 px-1.5 rounded-full text-[8px] ${statusFilter === st.key ? 'bg-current/10' : 'bg-gray-200/60 dark:bg-gray-700/40'}`}>{st.count}</span>}
          </button>
        ))}
      </div>

      {/* SEARCH + SORT */}
      <div className="glass-card rounded-2xl overflow-hidden">
        <div className="p-3 border-b border-gray-200/80 dark:border-gray-700/50 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-400" />
            <input className="w-full pl-10 pr-3 py-2.5 text-xs bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 focus:border-transparent transition text-gray-900 dark:text-white placeholder-gray-400" placeholder={t('reports.search', lang) || 'Search reports...'} value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
          </div>
          <select value={sortField} onChange={e => setSortField(e.target.value)} className="text-xs bg-gray-50 dark:bg-gray-800/60 px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 appearance-none text-gray-700 dark:text-gray-200">
            <option value="timestamp">{t('citizen.reports.newest', lang)}</option>
            <option value="severity">{t('severity', lang)}</option>
            <option value="confidence">{t('citizen.reports.aiConfidence', lang)}</option>
          </select>
          <button onClick={() => setSortOrder((o: string) => o === 'desc' ? 'asc' : 'desc')} className="p-2.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors" title={sortOrder === 'desc' ? t('cdash.reports.newestFirst', lang) : t('cdash.reports.oldestFirst', lang)}>
            <ArrowUpDown className="w-4 h-4 text-gray-500 dark:text-gray-400" />
          </button>
          <div className="text-[9px] font-medium text-gray-400 dark:text-gray-400 ml-auto">
            {filtered.length} of {stats.total} shown
          </div>
        </div>

        {/* REPORT LIST */}
        <div className="divide-y divide-gray-100/80 dark:divide-gray-800/60 max-h-[600px] overflow-y-auto custom-scrollbar">
          {loading ? (
            <SkeletonList count={3} />
          ) : filtered.length === 0 ? (
            reports.length > 0 ? (
              <div className="py-12 text-center">
                <Filter className="w-8 h-8 text-gray-300 dark:text-gray-400 mx-auto mb-2" />
                <p className="text-sm font-bold text-gray-700 dark:text-gray-200">{t('cdash.reports.noMatching', lang)}</p>
                <p className="text-xs text-gray-400 dark:text-gray-400 mt-1">{t('cdash.reports.tryAdjusting', lang)} <button onClick={() => { setSeverityFilter('all'); setStatusFilter('all') }} className="text-aegis-600 dark:text-aegis-400 font-bold hover:underline">{t('cdash.reports.clearingFilters', lang)}</button></p>
              </div>
            ) : (
              <EmptyReports />
            )
          ) : (
            filtered.map((r: any) => {
              const sevColor = r.severity === 'High' ? 'border-l-red-500 bg-red-50/40 dark:bg-red-950/10' : r.severity === 'Medium' ? 'border-l-amber-500 bg-amber-50/40 dark:bg-amber-950/10' : 'border-l-blue-500 bg-blue-50/40 dark:bg-blue-950/10'
              const timeAgoMs = Date.now() - new Date(r.timestamp).getTime()
              const isRecent = timeAgoMs < 3600_000 // less than 1 hour
              return (
                <div key={r.id} className={`relative group border-l-4 ${sevColor} transition-all hover:bg-gray-50/60 dark:hover:bg-gray-800/30`}>
                  {/* NEW badge for recent reports */}
                  {isRecent && (
                    <div className="absolute top-2.5 right-14 z-10">
                      <span className="px-1.5 py-0.5 rounded text-[7px] font-black bg-green-500 text-white uppercase tracking-wider animate-pulse">{t('cdash.reports.new', lang)}</span>
                    </div>
                  )}
                  <ReportCard report={r} onClick={onViewReport} />
                  <div className="absolute top-3 right-3 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                    <button onClick={(e) => { e.stopPropagation(); onShareReport(r) }} className="p-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-950/20 transition-all shadow-sm" title={t('cdash.reports.shareReport', lang)}>
                      <Share2 className="w-4 h-4 text-blue-600" />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); onPrintReport(r) }} className="p-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-all shadow-sm" title={t('cdash.reports.printReport', lang)}>
                      <Printer className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* FOOTER */}
        {filtered.length > 0 && (
          <div className="flex items-center justify-between px-3 py-2 border-t border-gray-100 dark:border-gray-800/50 bg-gray-50/50 dark:bg-gray-900/30">
            <div className="flex items-center gap-3 text-[9px] font-medium">
              <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                {t('cdash.reports.realTime', lang)}
              </span>
              <span className="text-gray-400 dark:text-gray-400">
                {stats.withMedia} {t('cdash.reports.withMedia', lang)} · {stats.aiPowered} {t('cdash.reports.aiAnalysed', lang)}
              </span>
            </div>
            <span className="text-[9px] font-bold text-gray-400 dark:text-gray-400 px-2 py-0.5 rounded bg-gray-200/60 dark:bg-gray-700/40">{filtered.length} {t('cdash.reports.reports', lang)}</span>
          </div>
        )}
      </div>
    </div>
  )
}

// TAB: PREPAREDNESS — Emergency Preparedness Guide + Resources

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
          { title: t('cdash.prep.sepaTitle', lang), source: 'SEPA', url: 'https://www.sepa.org.uk/environment/water/flooding/', type: 'article' },
          { title: t('cdash.prep.metOfficeTitle', lang), source: t('cdash.prep.metOffice', lang), url: 'https://www.metoffice.gov.uk/weather/warnings-and-advice', type: 'article' },
          { title: t('cdash.prep.floodPrepTitle', lang), source: t('cdash.prep.scottishGov', lang), url: 'https://www.floodscotland.org.uk/prepare-yourself/', type: 'article' },
          { title: t('cdash.prep.beforeFloodTitle', lang), source: t('cdash.prep.ukEnvAgency', lang), url: 'https://www.youtube.com/watch?v=43M5mZuzHF8', type: 'video' },
          { title: t('cdash.prep.emergencyKitTitle', lang), source: t('cdash.prep.britishRedCross', lang), url: 'https://www.youtube.com/watch?v=pFh-eEVadJU', type: 'video' },
          { title: t('cdash.prep.scottishFloodTitle', lang), source: t('cdash.prep.scottishFloodForum', lang), url: 'https://scottishfloodforum.org/', type: 'article' },
        ].map((r, i) => (
          <a key={i} href={r.url} target="_blank" rel="noopener noreferrer" className="glass-card rounded-2xl p-4 hover-lift transition-all flex items-start gap-3.5 group">
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${r.type === 'video' ? 'bg-gradient-to-br from-red-500 to-rose-600' : 'bg-gradient-to-br from-blue-500 to-indigo-600'} shadow-md`}>
              {r.type === 'video' ? <Play className="w-5 h-5 text-white" /> : <Droplets className="w-5 h-5 text-white" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 dark:text-white group-hover:text-aegis-600 dark:group-hover:text-aegis-400 transition-colors flex items-center gap-1.5">{r.title}<ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" /></p>
              <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">{r.source} · <span className={`font-semibold ${r.type === 'video' ? 'text-red-500' : 'text-blue-500'}`}>{r.type === 'video' ? t('cdash.prep.video', lang) : t('cdash.prep.article', lang)}</span></p>
            </div>
          </a>
        ))}
      </div>
    </div>
  )
}

// TAB: NEWS — Live news from API with category filters, pagination, auto-refresh

const NEWS_TYPE_CONFIG: Record<string, { color: string; bg: string; dot: string; textColor: string; label: string }> = {
  disaster:  { color: 'bg-rose-600',    bg: 'bg-rose-50 dark:bg-rose-950/20',    dot: 'bg-rose-600',    textColor: 'text-rose-600 dark:text-rose-400',    label: 'Disaster' },
  alert:     { color: 'bg-red-500',     bg: 'bg-red-50 dark:bg-red-950/20',     dot: 'bg-red-500',     textColor: 'text-red-600 dark:text-red-400',     label: 'Alert' },
  warning:   { color: 'bg-amber-500',   bg: 'bg-amber-50 dark:bg-amber-950/20',   dot: 'bg-amber-500',   textColor: 'text-amber-600 dark:text-amber-400',   label: 'Warning' },
  community: { color: 'bg-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-950/20', dot: 'bg-emerald-500', textColor: 'text-emerald-600 dark:text-emerald-400', label: 'Community' },
  tech:      { color: 'bg-violet-500',  bg: 'bg-violet-50 dark:bg-violet-950/20',  dot: 'bg-violet-500',  textColor: 'text-violet-600 dark:text-violet-400',  label: 'Tech' },
  info:      { color: 'bg-blue-500',    bg: 'bg-blue-50 dark:bg-blue-950/20',    dot: 'bg-blue-500',    textColor: 'text-blue-600 dark:text-blue-400',    label: 'Info' },
}

function NewsTab({ newsItems, newsRefreshing, loadNews, refreshReports, totalPages, lastFetched }: {
  newsItems: NewsItem[]
  newsRefreshing: boolean
  loadNews: (notify: boolean, page?: number) => Promise<void>
  refreshReports?: () => void
  totalPages: number
  lastFetched: Date | null
}) {
  const lang = useLanguage()
  const [activeFilter, setActiveFilter] = useState<string>('all')
  const [currentPage, setCurrentPage] = useState(1)
  const [newItemsCount, setNewItemsCount] = useState<number | null>(null)

  // Auto-refresh every 15 minutes silently
  useEffect(() => {
    const interval = setInterval(() => { loadNews(false, 1).catch(() => {}) }, 15 * 60 * 1000)
    return () => clearInterval(interval)
  }, [loadNews])

  const handleManualRefresh = async () => {
    const prevUrls = new Set(newsItems.map(n => n.url))
    setCurrentPage(1)
    setActiveFilter('all')
    setNewItemsCount(null)
    await loadNews(true, 1)
    // After load, compare new items — but newsItems state updates async so we rely on push notification
    // Count new items once updated
    const newCount = newsItems.filter(n => !prevUrls.has(n.url)).length
    setNewItemsCount(newCount)
    setTimeout(() => setNewItemsCount(null), 6000) // hide after 6s
    refreshReports?.()
  }

  const handleLoadMore = async () => {
    const next = currentPage + 1
    setCurrentPage(next)
    await loadNews(false, next)
  }

  // Count per type for filter badges
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = { all: newsItems.length }
    for (const n of newsItems) counts[n.type] = (counts[n.type] || 0) + 1
    return counts
  }, [newsItems])

  const filteredItems = useMemo(() => {
    if (activeFilter === 'all') return newsItems
    return newsItems.filter(n => n.type === activeFilter)
  }, [newsItems, activeFilter])

  const filterTypes = ['all', 'disaster', 'alert', 'warning', 'community', 'info', 'tech']

  const lastFetchedLabel = lastFetched
    ? `Updated ${lastFetched.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : null

  return (
    <div className="max-w-4xl mx-auto space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-extrabold text-gray-900 dark:text-white flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-aegis-500 to-aegis-700 flex items-center justify-center shadow-md">
              <Newspaper className="w-4 h-4 text-white" />
            </div>
            {t('citizen.news.newsResources', lang)}
          </h2>
          {lastFetchedLabel && (
            <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5 ml-[42px]">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block mr-1 align-middle" />
              {lastFetchedLabel} &middot; Auto-refreshes every 15 min
            </p>
          )}
        </div>
        <button
          onClick={handleManualRefresh}
          disabled={newsRefreshing}
          className="flex items-center gap-2 text-xs text-aegis-600 hover:text-aegis-700 bg-aegis-50/80 dark:bg-aegis-950/30 border border-aegis-200/80 dark:border-aegis-800/50 px-3.5 py-2 rounded-xl transition-all hover:shadow-sm disabled:opacity-60 font-semibold"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${newsRefreshing ? 'animate-spin' : ''}`} />
          {newsRefreshing ? 'Refreshing...' : t('citizen.news.refresh', lang)}
        </button>
      </div>

      {/* New-items banner */}
      {newItemsCount !== null && (
        <div className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold border ${
          newItemsCount > 0
            ? 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300 border-emerald-200/60 dark:border-emerald-800/40'
            : 'bg-gray-50 dark:bg-gray-800/40 text-gray-500 dark:text-gray-400 border-gray-200/60 dark:border-gray-700/40'
        }`}>
          {newItemsCount > 0
            ? <><CheckCircle className="w-3.5 h-3.5" /> {newItemsCount} new {newItemsCount === 1 ? 'story' : 'stories'} loaded</>
            : <><Info className="w-3.5 h-3.5" /> No new stories yet — feeds update hourly</>}
        </div>
      )}

      {/* Category filter pills */}
      {newsItems.length > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          {filterTypes.map(type => {
            const count = typeCounts[type] || 0
            if (type !== 'all' && type !== 'disaster' && count === 0) return null
            const cfg = type === 'all' ? null : NEWS_TYPE_CONFIG[type]
            const isActive = activeFilter === type
            return (
              <button
                key={type}
                onClick={() => setActiveFilter(type)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all border ${
                  isActive
                    ? type === 'all'
                      ? 'bg-gray-800 dark:bg-white text-white dark:text-gray-900 border-gray-800 dark:border-white'
                      : `${cfg!.color.replace('bg-', 'bg-').replace('-500', '-500')} text-white border-transparent`
                    : 'bg-white dark:bg-gray-800/60 text-gray-500 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                }`}
              >
                {cfg && <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-white' : cfg.dot}`} />}
                {type === 'all' ? 'All' : cfg!.label}
                <span className={`text-[9px] px-1 py-0.5 rounded ${
                  isActive ? 'bg-black/20' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                }`}>{count}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* News list */}
      {newsRefreshing && newsItems.length === 0 ? (
        <div className="glass-card rounded-2xl p-8 text-center">
          <Loader2 className="w-6 h-6 text-aegis-500 mx-auto mb-2 animate-spin" />
          <p className="text-xs text-gray-500 dark:text-gray-400">Fetching latest news...</p>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="glass-card rounded-2xl p-12 text-center">
          <div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mx-auto mb-4">
            <Newspaper className="w-8 h-8 text-gray-300 dark:text-gray-600" />
          </div>
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
            {activeFilter === 'all' ? t('citizen.news.noNews', lang) : `No ${NEWS_TYPE_CONFIG[activeFilter]?.label ?? activeFilter} items`}
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{t('cdash.news.checkBackLater', lang)}</p>
          {activeFilter !== 'all' && (
            <button onClick={() => setActiveFilter('all')} className="mt-3 text-xs text-aegis-600 dark:text-aegis-400 font-semibold hover:underline">Show all</button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredItems.map((n, i) => {
            const cfg = NEWS_TYPE_CONFIG[n.type] || NEWS_TYPE_CONFIG.info
            return (
              <div key={`${n.url}-${i}`} className="glass-card rounded-2xl p-4 hover-lift transition-all">
                <div className="flex items-start gap-3.5">
                  <div className={`w-10 h-10 rounded-xl ${cfg.bg} flex items-center justify-center flex-shrink-0`}>
                    <div className={`w-2.5 h-2.5 rounded-full ${cfg.dot}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md ${cfg.bg} ${cfg.textColor}`}>
                        {cfg.label}
                      </span>
                      <span className="text-[10px] text-gray-400 dark:text-gray-500">{n.time}</span>
                      <span className="text-[10px] text-gray-400 dark:text-gray-500 truncate max-w-[120px]">{n.source}</span>
                    </div>
                    <a
                      href={n.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-semibold text-gray-900 dark:text-white hover:text-aegis-600 dark:hover:text-aegis-400 transition-colors leading-snug block"
                    >
                      {n.title}
                    </a>
                  </div>
                  <a
                    href={n.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-[10px] text-aegis-600 hover:text-aegis-700 dark:text-aegis-400 dark:hover:text-aegis-300 bg-aegis-50/80 dark:bg-aegis-950/30 border border-aegis-200/60 dark:border-aegis-800/40 px-2.5 py-1.5 rounded-lg flex-shrink-0 transition-colors font-medium"
                    aria-label={`Read: ${n.title}`}
                  >
                    <ExternalLink className="w-3 h-3" />
                    <span className="hidden sm:inline">{t('cdash.news.read', lang)}</span>
                  </a>
                </div>
              </div>
            )
          })}

          {/* Load more */}
          {activeFilter === 'all' && currentPage < totalPages && (
            <button
              onClick={handleLoadMore}
              disabled={newsRefreshing}
              className="w-full py-3 text-xs font-bold text-aegis-600 dark:text-aegis-400 bg-white dark:bg-gray-800/60 border border-aegis-200/60 dark:border-aegis-800/40 rounded-2xl hover:bg-aegis-50/80 dark:hover:bg-aegis-950/20 transition-all disabled:opacity-50"
            >
              {newsRefreshing ? <span className="flex items-center justify-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading...</span> : `Load more (page ${currentPage + 1} of ${totalPages})`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// COMMUNITY SECTION — Chat Room + Posts Feed with sub-tabs

function CommunitySection({ parentSocket }: { parentSocket?: Socket | null }) {
  const lang = useLanguage()
  const [subTab, setSubTab] = useState<'chat' | 'posts'>('chat')
  return (
    <div className="max-w-5xl mx-auto space-y-4">
      {/* Premium Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-aegis-500 via-indigo-600 to-violet-600 flex items-center justify-center shadow-lg shadow-aegis-500/20">
            <Users className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="font-bold text-lg text-gray-900 dark:text-white">{t('citizen.tab.community', lang)}</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">{ t('cdash.community.subtitle', lang)}</p>
          </div>
        </div>
      </div>

      {/* Sub-tab bar */}
      <div className="flex gap-1 bg-gray-100/80 dark:bg-gray-800/60 p-1 rounded-xl w-fit backdrop-blur-sm shadow-inner">
        <button
          onClick={() => setSubTab('chat')}
          className={`px-5 py-2.5 rounded-lg text-xs font-bold transition-all duration-200 ${
            subTab === 'chat'
              ? 'bg-white dark:bg-gray-700 text-aegis-700 dark:text-white shadow-md'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 dark:text-gray-400'
          }`}
        >
          <span className="flex items-center gap-1.5">
            <MessageSquare className="w-3.5 h-3.5" />
            {t('citizen.community.liveChat', lang)}
          </span>
        </button>
        <button
          onClick={() => setSubTab('posts')}
          className={`px-5 py-2.5 rounded-lg text-xs font-bold transition-all duration-200 ${
            subTab === 'posts'
              ? 'bg-white dark:bg-gray-700 text-aegis-700 dark:text-white shadow-md'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 dark:text-gray-400'
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

// TAB: LIVE MAP — DisasterMap + Intelligence + Weather + River Levels

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
        <h2 className="text-lg font-bold text-primary flex items-center gap-2">
          <Globe className="w-5 h-5 icon-primary" />
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
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{a.message}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-400 dark:text-gray-400 flex-shrink-0" />
            </button>
          ))}
        </div>
      )}

      {/* Map — Professional Live Incident Map Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 px-2 md:px-4">
        <div className="lg:col-span-2">
          <Suspense fallback={<div className="h-[450px] rounded-2xl bg-gray-100 dark:bg-gray-800 animate-pulse" />}>
            <LiveIncidentMapPanel reports={reports} userPosition={userPosition} center={loc.center} zoom={loc.zoom} />
          </Suspense>
        </div>
        <div className="space-y-4">
          <IntelligenceDashboard collapsed={true} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700" />
          {showWeather && <WeatherPanel />}
        </div>
        {/* River Levels — full width below the map row for better readability */}
        {showRivers && (
          <div className="lg:col-span-3">
            <RiverGaugePanel />
          </div>
        )}
      </div>
    </div>
  )
}

// TAB 1: OVERVIEW

function OverviewTab({ user, threads, recentSafety, emergencyContacts, totalUnread, setActiveTab, reportStats, onReportEmergency, onCommunityHelp, submitSafetyCheckIn }: any) {
  const lang = useLanguage()
  const activeThreads = threads.filter((t: any) => t.status !== 'closed' && t.status !== 'resolved').length
  const hour = new Date().getHours()
  const greeting = hour < 12 ? t('cdash.overview.goodMorning', lang) : hour < 18 ? t('cdash.overview.goodAfternoon', lang) : t('cdash.overview.goodEvening', lang)
  const [quickSafety, setQuickSafety] = useState<'safe' | 'help' | 'unsure' | null>(null)
  const [safetySending, setSafetySending] = useState(false)

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-fade-in">

      {/* Hero Banner */}
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
              <AlertTriangle className="w-4 h-4" /> {t('cdash.overview.report', lang)}
            </button>
            <button onClick={() => setActiveTab('livemap')} className="bg-white text-aegis-700 hover:bg-white/90 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] flex items-center gap-2 shadow-lg shadow-black/10">
              <MapPin className="w-4 h-4" /> {t('cdash.overview.liveMap', lang)}
            </button>
          </div>
        </div>
      </div>

      {/* Quick Safety Check-In */}
      <div className="glass-card rounded-2xl p-4 shadow-lg">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-aegis-400 to-aegis-600 flex items-center justify-center">
              <ShieldAlert className="w-3.5 h-3.5 text-white" />
            </div>
            {t('cdash.overview.areYouSafe', lang)}
          </h3>
          {quickSafety && (
            <button onClick={() => setQuickSafety(null)} className="text-[10px] font-bold text-gray-400 dark:text-gray-400 hover:text-gray-600 transition-colors">{t('cdash.overview.update', lang)}</button>
          )}
        </div>
        {quickSafety ? (
          <div className={`p-3.5 rounded-xl text-sm font-semibold flex items-center gap-3 ${quickSafety === 'safe' ? 'bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-950/20 text-green-700 dark:text-green-300 border border-green-200/50 dark:border-green-800/50' : quickSafety === 'help' ? 'bg-gradient-to-r from-red-50 to-rose-50 dark:from-red-950/30 dark:to-rose-950/20 text-red-700 dark:text-red-300 border border-red-200/50 dark:border-red-800/50' : 'bg-gradient-to-r from-amber-50 to-yellow-50 dark:from-amber-950/30 dark:to-yellow-950/20 text-amber-700 dark:text-amber-300 border border-amber-200/50 dark:border-amber-800/50'}`}>
            {quickSafety === 'safe' && <><CheckCircle className="w-5 h-5" /> {t('cdash.overview.safeResponse', lang)}</>}
            {quickSafety === 'help' && <><AlertTriangle className="w-5 h-5" /> {t('cdash.overview.helpResponse', lang)}</>}
            {quickSafety === 'unsure' && <><HelpCircle className="w-5 h-5" /> {t('cdash.overview.unsureResponse', lang)}</>}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {[
              { status: 'safe' as const, label: t('cdash.overview.imSafe', lang), icon: CheckCircle, from: 'from-green-50', to: 'to-emerald-100', darkFrom: 'dark:from-green-900/30', darkTo: 'dark:to-emerald-900/20', text: 'text-green-800 dark:text-green-200', border: 'border-green-200/60 dark:border-green-800/50', hover: 'hover:shadow-green-500/10' },
              { status: 'help' as const, label: t('cdash.overview.needHelp', lang), icon: AlertTriangle, from: 'from-red-50', to: 'to-rose-100', darkFrom: 'dark:from-red-900/30', darkTo: 'dark:to-rose-900/20', text: 'text-red-800 dark:text-red-200', border: 'border-red-200/60 dark:border-red-800/50', hover: 'hover:shadow-red-500/10' },
              { status: 'unsure' as const, label: t('cdash.overview.unsure', lang), icon: HelpCircle, from: 'from-amber-50', to: 'to-yellow-100', darkFrom: 'dark:from-amber-900/30', darkTo: 'dark:to-yellow-900/20', text: 'text-amber-800 dark:text-amber-200', border: 'border-amber-200/60 dark:border-amber-800/50', hover: 'hover:shadow-amber-500/10' },
            ].map(btn => (
              <button
                key={btn.status}
                disabled={safetySending}
                onClick={async () => {
                  setSafetySending(true)
                  try { await submitSafetyCheckIn(btn.status) } catch {}
                  setQuickSafety(btn.status)
                  setSafetySending(false)
                }}
                className={`bg-gradient-to-br ${btn.from} ${btn.to} ${btn.darkFrom} ${btn.darkTo} ${btn.text} rounded-xl py-3.5 text-xs font-bold flex flex-col items-center justify-center gap-1.5 transition-all border ${btn.border} hover:shadow-lg ${btn.hover} hover:scale-[1.02] active:scale-[0.98]`}
              >
                <btn.icon className="w-5 h-5" />
                {btn.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Situation Stats (glass cards) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          { label: t('citizen.overview.activeReports', lang), value: reportStats?.total ?? 0,      icon: FileText,    gradient: 'from-blue-500 to-blue-700',     bg: 'bg-blue-50   dark:bg-blue-950/40',   border: 'border-blue-200   dark:border-blue-800/60',   num: 'text-blue-700   dark:text-blue-300',   lbl: 'text-blue-600   dark:text-blue-400' },
          { label: t('citizen.overview.urgent', lang),        value: reportStats?.urgent ?? 0,     icon: AlertTriangle, gradient: 'from-red-500 to-red-700',       bg: 'bg-red-50    dark:bg-red-950/40',    border: 'border-red-200    dark:border-red-800/60',    num: 'text-red-700    dark:text-red-300',    lbl: 'text-red-600    dark:text-red-400' },
          { label: t('citizen.overview.highSeverity', lang),  value: reportStats?.high ?? 0,       icon: Flame,       gradient: 'from-orange-500 to-orange-700', bg: 'bg-orange-50 dark:bg-orange-950/40', border: 'border-orange-200 dark:border-orange-800/60', num: 'text-orange-700 dark:text-orange-300', lbl: 'text-orange-600 dark:text-orange-400' },
          { label: t('citizen.overview.verified', lang),      value: reportStats?.verified ?? 0,   icon: CheckCircle, gradient: 'from-green-500 to-green-700',   bg: 'bg-green-50  dark:bg-green-950/40',  border: 'border-green-200  dark:border-green-800/60',  num: 'text-green-700  dark:text-green-300',  lbl: 'text-green-600  dark:text-green-400' },
          { label: t('citizen.overview.activeAlerts', lang),  value: reportStats?.alertCount ?? 0, icon: Bell,        gradient: 'from-purple-500 to-purple-700', bg: 'bg-purple-50 dark:bg-purple-950/40', border: 'border-purple-200 dark:border-purple-800/60', num: 'text-purple-700 dark:text-purple-300', lbl: 'text-purple-600 dark:text-purple-400' },
        ].map((s, i) => (
          <div key={i} className={`${s.bg} border ${s.border} rounded-2xl p-4 hover-lift transition-all duration-300 group`} style={{ animationDelay: `${i * 80}ms` }}>
            <div className="flex items-center justify-between mb-3">
              <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${s.gradient} flex items-center justify-center shadow-md`}>
                <s.icon className="w-4 h-4 text-white" />
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-gray-400 dark:text-gray-400 group-hover:translate-x-0.5 transition-all" />
            </div>
            <p className={`text-2xl sm:text-3xl font-extrabold tracking-tight ${s.num}`}>{s.value}</p>
            <p className={`text-[10px] font-semibold uppercase tracking-wider mt-0.5 ${s.lbl}`}>{s.label}</p>
          </div>
        ))}
      </div>

      {/* Your Activity + Quick Actions (side-by-side) */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Personal Stats */}
        <div className="lg:col-span-2 grid grid-cols-2 gap-3">
          {[
            { label: t('citizen.overview.unreadMessages', lang),   value: totalUnread,               icon: MessageSquare, gradient: 'from-sky-500 to-cyan-600',      tap: () => setActiveTab('messages'), bg: 'bg-sky-50     dark:bg-sky-950/40',     border: 'border-sky-200     dark:border-sky-800/60',     num: 'text-sky-700    dark:text-sky-300',    lbl: 'text-sky-600    dark:text-sky-400' },
            { label: t('citizen.overview.activeThreads', lang),     value: activeThreads,             icon: FileText,     gradient: 'from-violet-500 to-violet-700', tap: () => setActiveTab('messages'), bg: 'bg-violet-50  dark:bg-violet-950/40',  border: 'border-violet-200  dark:border-violet-800/60',  num: 'text-violet-700 dark:text-violet-300', lbl: 'text-violet-600 dark:text-violet-400' },
            { label: t('citizen.overview.safetyCheckins', lang),    value: recentSafety?.length || 0, icon: ShieldAlert,  gradient: 'from-emerald-500 to-teal-600', tap: () => setActiveTab('safety'),   bg: 'bg-emerald-50 dark:bg-emerald-950/40', border: 'border-emerald-200 dark:border-emerald-800/60', num: 'text-emerald-700 dark:text-emerald-300', lbl: 'text-emerald-600 dark:text-emerald-400' },
            { label: t('citizen.overview.emergencyContacts', lang), value: emergencyContacts?.length || 0, icon: Phone,   gradient: 'from-amber-500 to-amber-700',  tap: () => setActiveTab('profile'),  bg: 'bg-amber-50   dark:bg-amber-950/40',   border: 'border-amber-200   dark:border-amber-800/60',   num: 'text-amber-700  dark:text-amber-300',  lbl: 'text-amber-600  dark:text-amber-400' },
          ].map((s, i) => (
            <button key={i} onClick={s.tap} className={`${s.bg} border ${s.border} rounded-2xl p-4 text-left hover-lift transition-all duration-300 group cursor-pointer`}>
              <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${s.gradient} flex items-center justify-center mb-3 shadow-md group-hover:scale-110 transition-transform`}>
                <s.icon className="w-4 h-4 text-white" />
              </div>
              <p className={`text-xl font-extrabold ${s.num}`}>{s.value}</p>
              <p className={`text-[10px] font-medium mt-0.5 ${s.lbl}`}>{s.label}</p>
            </button>
          ))}
        </div>

        {/* Quick Actions */}
        <div className="lg:col-span-3 glass-card rounded-2xl p-4">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-500" /> {t('cdash.overview.quickActions', lang)}
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
                <p className="text-[10px] text-gray-400 dark:text-gray-400 mt-0.5 leading-snug line-clamp-2">{a.desc}</p>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Recent Conversations */}
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
                <span className="text-[10px] text-gray-400 dark:text-gray-400 flex-shrink-0">{th.updated_at ? timeAgo(th.updated_at) : ''}</span>
                <ChevronRight className="w-3.5 h-3.5 text-gray-300 dark:text-gray-400 group-hover:text-gray-500 dark:text-gray-400 group-hover:translate-x-0.5 transition-all flex-shrink-0" />
              </div>
            ))}
          </div>
          {threads.length === 0 && (
            <div className="px-5 py-8 text-center">
              <MessageSquare className="w-8 h-8 text-gray-300 dark:text-gray-400 mx-auto mb-2" />
              <p className="text-sm text-gray-400 dark:text-gray-400">{t('cdash.overview.noConversations', lang)}</p>
            </div>
          )}
        </div>
      )}

      {/* Preparedness Journey — Risk → Prepare → Emergency */}
      <div className="glass-card rounded-2xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-gray-100 dark:border-gray-800/80 flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-amber-400 to-orange-600 flex items-center justify-center">
              <BookOpen className="w-3.5 h-3.5 text-white" />
            </div>
            {t('cdash.overview.safetyJourney', lang)}
          </h3>
          <span className="text-[9px] font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 px-2.5 py-1 rounded-full border border-amber-200/50 dark:border-amber-800/50">{t('cdash.overview.recommended', lang)}</span>
        </div>
        <div className="p-5">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">{t('cdash.overview.journeyDesc', lang)}</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Step 1: Risk Assessment */}
            <button onClick={() => setActiveTab('risk')} className="group bg-gradient-to-br from-rose-50 to-red-50 dark:from-rose-950/20 dark:to-red-950/10 border border-rose-200/60 dark:border-rose-800/40 rounded-xl p-4 text-left hover:shadow-lg hover:border-rose-300 dark:hover:border-rose-700 transition-all duration-300">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-6 h-6 rounded-full bg-gradient-to-br from-rose-500 to-red-600 text-white text-[10px] font-black flex items-center justify-center shadow-sm">1</span>
                <span className="text-[9px] font-bold text-rose-600 dark:text-rose-400 uppercase tracking-wider">{t('cdash.overview.assess', lang)}</span>
              </div>
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-rose-500 to-red-700 flex items-center justify-center mb-2 shadow-md group-hover:scale-110 transition-transform">
                <Activity className="w-4.5 h-4.5 text-white" />
              </div>
              <p className="text-sm font-bold text-gray-900 dark:text-white">{t('cdash.overview.riskAssessment', lang)}</p>
              <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">{t('cdash.overview.riskAssessmentDesc', lang)}</p>
              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-600 dark:text-rose-400 mt-2 group-hover:translate-x-0.5 transition-transform">
                {t('cdash.overview.open', lang)} <ChevronRight className="w-3 h-3" />
              </span>
            </button>
            {/* Step 2: Preparedness Training */}
            <button onClick={() => setActiveTab('prepare')} className="group bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/20 dark:to-teal-950/10 border border-emerald-200/60 dark:border-emerald-800/40 rounded-xl p-4 text-left hover:shadow-lg hover:border-emerald-300 dark:hover:border-emerald-700 transition-all duration-300">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-6 h-6 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-white text-[10px] font-black flex items-center justify-center shadow-sm">2</span>
                <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">{t('cdash.overview.train', lang)}</span>
              </div>
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-700 flex items-center justify-center mb-2 shadow-md group-hover:scale-110 transition-transform">
                <BookOpen className="w-4.5 h-4.5 text-white" />
              </div>
              <p className="text-sm font-bold text-gray-900 dark:text-white">{t('cdash.overview.prepTraining', lang)}</p>
              <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">{t('cdash.overview.prepTrainingDesc', lang)}</p>
              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 mt-2 group-hover:translate-x-0.5 transition-transform">
                {t('cdash.overview.open', lang)} <ChevronRight className="w-3 h-3" />
              </span>
            </button>
            {/* Step 3: Emergency Card */}
            <button onClick={() => setActiveTab('emergency')} className="group bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/20 dark:to-orange-950/10 border border-amber-200/60 dark:border-amber-800/40 rounded-xl p-4 text-left hover:shadow-lg hover:border-amber-300 dark:hover:border-amber-700 transition-all duration-300">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-6 h-6 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 text-white text-[10px] font-black flex items-center justify-center shadow-sm">3</span>
                <span className="text-[9px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider">{t('cdash.overview.prepare', lang)}</span>
              </div>
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-amber-500 to-orange-700 flex items-center justify-center mb-2 shadow-md group-hover:scale-110 transition-transform">
                <Shield className="w-4.5 h-4.5 text-white" />
              </div>
              <p className="text-sm font-bold text-gray-900 dark:text-white">{t('cdash.overview.emergencyCard', lang)}</p>
              <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">{t('cdash.overview.emergencyCardDesc', lang)}</p>
              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-600 dark:text-amber-400 mt-2 group-hover:translate-x-0.5 transition-transform">
                {t('cdash.overview.open', lang)} <ChevronRight className="w-3 h-3" />
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Emergency Quick Dial */}
      {emergencyContacts && emergencyContacts.length > 0 && (
        <div className="glass-card rounded-2xl p-4">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
            <Phone className="w-4 h-4 text-red-500" /> {t('cdash.overview.emergencyContacts', lang)}
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
                  <p className="text-[10px] text-gray-400 dark:text-gray-400 truncate">{c.phone || c.relationship}</p>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// TAB 2: MESSAGES — Real-time Socket.IO Chat

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
  const hasAutoBootstrappedRef = useRef(false)

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

  const openThread = (thread: ChatThread, shouldMarkRead = true) => {
    setActiveThread(thread)
    joinThread(thread.id)
    loadThreadMessages(thread.id)
    if (shouldMarkRead) {
      markRead(thread.id, [])
    }
  }

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Auto-translate messages when language is not English
  useEffect(() => {
    if (!autoTranslate) return
    const untranslated = messages.filter((m: any) => m.content && !translations[m.id])
    if (untranslated.length === 0) return
    const batch = untranslated.slice(0, 10)
    let cancelled = false

    ;(async () => {
      try {
        const translatedByText = await buildTranslationMap(
          batch.map((msg: any) => msg.content),
          'auto',
          targetLang,
        )

        if (cancelled || Object.keys(translatedByText).length === 0) return

        setTranslations((prev) => {
          const next = { ...prev }
          batch.forEach((msg: any) => {
            const translated = translatedByText[msg.content]
            if (translated) next[msg.id] = translated
          })
          return next
        })
      } catch {
        /* skip */
      }
    })()

    return () => { cancelled = true }
  }, [autoTranslate, targetLang, messages, translations])

  // Update autoTranslate when language changes
  useEffect(() => {
    setTargetLang(lang || 'en')
    setTranslations({})
    if (lang !== 'en') {
      setAutoTranslate(true)
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

  // Proactively fetch conversations as soon as messaging socket is ready.
  useEffect(() => {
    if (!socket.connected) {
      hasAutoBootstrappedRef.current = false
      return
    }

    socket.fetchCitizenThreads()
    const followUp = setTimeout(() => {
      socket.fetchCitizenThreads()
    }, 1200)

    return () => clearTimeout(followUp)
  }, [socket.connected])

  // Auto-open the most recent thread once per connection so messages never appear blank on first load.
  useEffect(() => {
    if (!socket.connected || activeThread || threads.length === 0 || hasAutoBootstrappedRef.current) return
    const mostRecent = [...threads].sort((a, b) =>
      new Date(b.last_message_at || b.updated_at || b.created_at).getTime() -
      new Date(a.last_message_at || a.updated_at || a.created_at).getTime()
    )[0]
    if (!mostRecent) return
    hasAutoBootstrappedRef.current = true
    openThread(mostRecent, true)
  }, [socket.connected, threads, activeThread?.id])

  // If thread is active but messages were not hydrated yet, retry once via REST.
  useEffect(() => {
    if (!activeThread?.id || messages.length > 0) return
    const retry = setTimeout(() => loadThreadMessages(activeThread.id), 500)
    return () => clearTimeout(retry)
  }, [activeThread?.id, messages.length])

  const handleSelectThread = (thread: ChatThread) => {
    openThread(thread, true)
    
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

  // Thread List View
  if (!activeThread) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">{t('citizen.messages.title', lang)}</h2>
          <div className="flex items-center gap-2">
            {!socket.connected && (
              <span className="flex items-center gap-1.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 px-2.5 py-1.5 rounded-lg border border-amber-200 dark:border-amber-800/50">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                {t('cdash.messages.connecting', lang)}
              </span>
            )}
            {socket.connected && (
              <span className="flex items-center gap-1.5 text-[10px] font-semibold text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/30 px-2.5 py-1.5 rounded-lg border border-green-200 dark:border-green-800/50">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                {t('cdash.messages.connected', lang)}
              </span>
            )}
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
              <button onClick={() => setShowNewThread(false)} className="text-gray-400 dark:text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{t('citizen.messages.subject', lang)}</label>
              <input
                value={newSubject}
                onChange={e => setNewSubject(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 transition"
                placeholder={t('cdash.messages.subjectPlaceholder', lang)}
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
                placeholder={t('cdash.messages.messagePlaceholder', lang)}
              />
            </div>
            <div className="flex gap-2">
              <button onClick={handleCreateThread} disabled={!newSubject.trim() || !newMessage.trim() || creating}
                className="bg-aegis-600 hover:bg-aegis-700 disabled:bg-aegis-400 text-white text-xs font-semibold px-4 py-2 rounded-lg transition flex items-center gap-1.5">
                {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} {t('citizen.messages.send', lang)}
              </button>
              <button onClick={() => setShowNewThread(false)} className="text-gray-500 dark:text-gray-400 hover:text-gray-700 text-xs px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700">{t('citizen.messages.cancel', lang)}</button>
            </div>
          </div>
        )}

        {/* Thread List */}
        {!socket.connected ? (
          <div className="bg-white dark:bg-gray-900 border border-amber-200 dark:border-amber-800/50 rounded-xl p-12 text-center">
            <Wifi className="w-12 h-12 text-amber-400 mx-auto mb-3" />
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">{t('cdash.messages.connectingToServer', lang)}</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">{t('cdash.messages.connectingDesc', lang)}</p>
            <button onClick={handleRefresh} className="bg-amber-500 hover:bg-amber-400 text-white text-xs font-semibold px-4 py-2 rounded-lg transition flex items-center gap-1.5 mx-auto">
              <RefreshCw className="w-3.5 h-3.5" /> {t('cdash.messages.retryConnection', lang)}
            </button>
          </div>
        ) : threads.length === 0 ? (
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-12 text-center">
            <MessageSquare className="w-12 h-12 text-gray-300 dark:text-gray-400 mx-auto mb-3" />
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">{t('citizen.messages.noConversations', lang)}</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">{t('citizen.messages.startHelp', lang)}</p>
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
                    {th.is_emergency && <span className="text-[9px] bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300 px-1.5 py-0.5 rounded font-bold uppercase">{t('cdash.messages.emergency', lang)}</span>}
                  </div>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate mt-0.5">{th.last_message || t('citizen.messages.noMessages', lang)}</p>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  {th.citizen_unread > 0 && (
                    <span className="bg-aegis-600 text-white text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded-full">{th.citizen_unread}</span>
                  )}
                  <span className="text-[10px] text-gray-400 dark:text-gray-400">{th.updated_at ? timeAgo(th.updated_at) : ''}</span>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-400 flex-shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  // Chat View (Active Thread)
  return (
    <div className="max-w-3xl mx-auto flex flex-col h-[calc(100vh-140px)] md:h-[calc(100vh-100px)]">
      {/* Chat Header */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-t-xl px-4 py-3 flex items-center gap-3">
        <button onClick={() => { setActiveThread(null) }} className="text-gray-400 dark:text-gray-400 hover:text-gray-600 transition">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-gray-900 dark:text-white truncate">{activeThread.subject}</h3>
            {activeThread.is_emergency && (
              <span className="text-[9px] bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300 px-1.5 py-0.5 rounded font-bold uppercase flex-shrink-0">{t('cdash.messages.emergency', lang)}</span>
            )}
          </div>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            {activeThread.status === 'resolved' ? t('citizen.messages.resolved', lang) : activeThread.assigned_operator_name ? `${t('citizen.messages.assignedTo', lang)} ${activeThread.assigned_operator_name}` : t('citizen.messages.waitingOperator', lang)}
          </p>
        </div>
        <div className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase flex-shrink-0 hidden sm:block ${
          activeThread.status === 'resolved' ? 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300' :
          activeThread.status === 'in_progress' ? 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300' :
          'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300'
        }`}>{activeThread.status === 'resolved' ? t('cdash.messages.resolved', lang) : activeThread.status === 'in_progress' ? t('cdash.messages.inProgress', lang) : t('cdash.messages.open', lang)}</div>
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
            title={t('cdash.messages.translateTo', lang)}
          >
            {TRANSLATION_LANGUAGES.map(tl => (
              <option key={tl.code} value={tl.code}>
                {tl.name}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-[10px] text-gray-600 dark:text-gray-400">
            <input
              type="checkbox"
              checked={autoTranslate}
              onChange={() => setAutoTranslate(!autoTranslate)}
              className="w-3 h-3 rounded border-gray-300"
            />
            {t('cdash.messages.auto', lang)}
          </label>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-950 border-x border-gray-200 dark:border-gray-800 px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-center py-8 text-gray-400 dark:text-gray-400 text-sm">{t('citizen.messages.noMessages', lang)}</div>
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
                      {msg.sender_name || t('cdash.messages.supportTeam', lang)}
                    </p>
                    <p className="text-[9px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      {msg.sender_type === 'operator'
                        ? (msg.sender_role === 'admin' ? t('cdash.messages.admin', lang) : msg.sender_role ? msg.sender_role.replace('_', ' ') : t('cdash.messages.operator', lang))
                        : t('cdash.messages.citizen', lang)}
                    </p>
                  </div>
                )}
                {msg.content && <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>}
                {translations[msg.id] && (
                  <div className={`mt-1 pt-1 border-t ${isMine ? 'border-white/20' : 'border-gray-200 dark:border-gray-600'}`}>
                    <p className={`text-[9px] font-semibold ${isMine ? 'text-white/60' : 'text-blue-500'}`}>{t('cdash.messages.translated', lang)}</p>
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
                  <span className={`text-[10px] ${isMine ? 'text-white/60' : 'text-gray-400 dark:text-gray-400'}`}>
                    {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {isMine && <MessageStatusIcon status={msg.status} />}
                  {msg.content && (
                    <button
                      onClick={() => handleTranslateMsg(msg.id, msg.content)}
                      className={`ml-1 px-1 py-0.5 rounded transition-colors ${
                        translations[msg.id]
                          ? (isMine ? 'text-white/80 bg-white/10' : 'text-blue-500 bg-blue-50 dark:bg-blue-950/30')
                          : (isMine ? 'text-white/40 hover:text-white/70 hover:bg-white/10' : 'text-gray-400 dark:text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/30')
                      }`}
                      title={translations[msg.id] ? t('cdash.messages.removeTranslation', lang) : t('cdash.messages.translate', lang)}
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
                <span className="text-[10px] text-gray-400 dark:text-gray-400">{threadTypers[0].userName} {t('citizen.messages.isTyping', lang)}</span>
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
              className="p-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:text-aegis-600 hover:border-aegis-300 transition"
              title={t('cdash.messages.attachImage', lang)}
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
        <div className="bg-gray-100 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-b-xl px-4 py-3 text-center text-sm text-gray-500 dark:text-gray-400">
          {t('citizen.messages.conversationClosed', lang)} {activeThread.status}
        </div>
      )}
    </div>
  )
}

// TAB 3: SAFETY CHECK-IN

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
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('cdash.safety.subtitle', lang)}</p>
        </div>
      </div>

      {/* Check-in Card */}
      <div className="glass-card rounded-2xl p-6 space-y-5">
        <p className="text-sm text-gray-600 dark:text-gray-400">{t('cdash.safety.selectInstruction', lang)}</p>

        {/* Status Buttons — Large & Prominent */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { key: 'safe' as const, label: t('citizen.safety.safeButton', lang), icon: CheckCircle, desc: t('cdash.safety.iAmSafe', lang) },
            { key: 'unsure' as const, label: t('citizen.safety.unsureButton', lang), icon: CircleDot, desc: t('cdash.safety.notSure', lang) },
            { key: 'help' as const, label: t('citizen.safety.helpButton', lang), icon: AlertTriangle, desc: t('cdash.safety.needHelp', lang) },
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
                  <s.icon className={`w-6 h-6 ${isActive ? 'text-white' : 'text-gray-400 dark:text-gray-400'}`} />
                </div>
                <p className={`text-sm font-bold ${isActive ? cfg.text : 'text-gray-600 dark:text-gray-400'}`}>{s.label}</p>
                <p className={`text-[10px] mt-0.5 ${isActive ? cfg.text.replace('700', '500').replace('300', '400') : 'text-gray-400 dark:text-gray-400'}`}>{s.desc}</p>
              </button>
            )
          })}
        </div>

        {/* Message Input */}
        <div className="relative">
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder={t('cdash.safety.optionalMessage', lang)}
            className="w-full px-4 py-3 text-sm bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 focus:border-transparent transition resize-none"
            rows={2}
          />
          <MapPin className="absolute right-3 bottom-3 w-4 h-4 text-gray-300 dark:text-gray-400" />
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
            <p className="text-base font-bold text-red-700 dark:text-red-300 group-hover:text-red-600">{t('cdash.safety.publicSafetyMode', lang)}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t('cdash.safety.publicSafetyModeDesc', lang)}</p>
          </div>
          <ChevronRight className="w-5 h-5 text-gray-300 dark:text-gray-400 group-hover:text-red-400 group-hover:translate-x-1 transition-all" />
        </div>
      </button>

      {/* Recent Check-ins Timeline */}
      {recentSafety && recentSafety.length > 0 && (
        <div className="glass-card rounded-2xl overflow-hidden">
          <h3 className="px-5 py-3.5 border-b border-gray-100 dark:border-gray-800/80 text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Clock className="w-4 h-4 text-gray-400 dark:text-gray-400" /> {t('citizen.safety.recentCheckins', lang)}
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
                <span className="text-[10px] text-gray-400 dark:text-gray-400 flex-shrink-0">{timeAgo(c.created_at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// TAB 4: PROFILE

function ProfileRegionSelect({ value, onChange, country }: { value: string; onChange: (v: string) => void; country: string }) {
  const regions = REGION_MAP[country] || []
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = query.trim()
    ? regions.filter(r => r.label.toLowerCase().includes(query.toLowerCase()))
    : regions

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50)
    else setQuery('')
  }, [open])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (ref.current && !ref.current.contains(target) && (!dropdownRef.current || !dropdownRef.current.contains(target))) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // If no regions for this country, show free-text input
  if (regions.length === 0) {
    return (
      <input type="text" value={value} onChange={e => onChange(e.target.value)}
        placeholder="Type your region/city..."
        className="w-full px-3.5 py-2.5 text-sm bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 focus:border-transparent transition" />
    )
  }

  const selectedLabel = regions.find(r => r.value === value || r.label === value)?.label || value

  // Compute portal position
  const getPortalStyle = (): React.CSSProperties => {
    if (!ref.current) return {}
    const rect = ref.current.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    const goUp = spaceBelow < 260
    return {
      position: 'fixed',
      left: rect.left,
      width: rect.width,
      ...(goUp ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
      zIndex: 9999,
    }
  }

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3.5 py-2.5 text-sm bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-aegis-400 transition text-left">
        <MapPin className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
        <span className="flex-1 text-gray-900 dark:text-white truncate">{selectedLabel || 'Select region...'}</span>
        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && createPortal(
        <div ref={dropdownRef} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl overflow-hidden" style={getPortalStyle()}>
          <div className="p-2 border-b border-gray-100 dark:border-gray-800 flex items-center gap-2">
            <Search className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
            <input ref={inputRef} type="text" value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Search or type region..." className="flex-1 bg-transparent text-sm outline-none text-gray-900 dark:text-white placeholder-gray-400" />
            {query && <button type="button" onClick={() => setQuery('')}><X className="w-3.5 h-3.5 text-gray-400" /></button>}
          </div>
          <div className="max-h-52 overflow-y-auto">
            {filtered.map(r => (
              <button key={r.value} type="button"
                onClick={() => { onChange(r.label); setOpen(false) }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-aegis-50 dark:hover:bg-aegis-950/30 transition-colors text-left ${(r.value === value || r.label === value) ? 'bg-aegis-50 dark:bg-aegis-950/20 font-semibold' : ''}`}>
                <MapPin className="w-3 h-3 text-gray-400" />
                <span className="text-gray-900 dark:text-white">{r.label}</span>
              </button>
            ))}
            {filtered.length === 0 && query.trim() && (
              <button type="button" onClick={() => { onChange(query.trim()); setOpen(false) }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm hover:bg-aegis-50 dark:hover:bg-aegis-950/30 transition-colors text-left text-aegis-600 font-medium">
                <Plus className="w-3.5 h-3.5" /> Use "{query.trim()}"
              </button>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

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
      setMsg(t('cdash.profile.profileUpdated', lang))
      setEditing(false)
      refreshProfile()
      setTimeout(() => setMsg(''), 3000)
    } else {
      setMsg(t('cdash.profile.profileFailed', lang))
    }
  }

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    const result = await uploadAvatar(file)
    setUploading(false)
    if (result) {
      setMsg(t('cdash.profile.avatarUpdated', lang))
      refreshProfile()
      setTimeout(() => setMsg(''), 3000)
    } else {
      setMsg(t('cdash.profile.avatarFailed', lang))
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
                <Pencil className="w-3.5 h-3.5" /> {t('cdash.profile.editProfile', lang)}
              </button>
            ) : (
              <>
                <button onClick={handleSave} disabled={saving} className="flex items-center gap-1.5 bg-white text-aegis-700 text-xs font-bold px-3 py-2 rounded-xl transition-all hover:bg-white/90 shadow-lg">
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} {t('cdash.profile.save', lang)}
                </button>
                <button onClick={() => setEditing(false)} className="text-xs text-white/80 hover:text-white bg-white/15 backdrop-blur-sm border border-white/20 px-3 py-2 rounded-xl transition-all">{t('cdash.profile.cancel', lang)}</button>
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
                  <Heart className="w-3 h-3" /> {t('cdash.profile.prioritySupport', lang)}
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
          <User className="w-4 h-4 text-aegis-600" /> {t('cdash.profile.personalInfo', lang)}
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            { label: t('cdash.profile.displayName', lang), key: 'displayName', icon: User, value: user.displayName },
            { label: t('cdash.profile.phone', lang), key: 'phone', icon: Phone, value: user.phone, placeholder: '+44 7700 900000' },
            { label: t('cdash.profile.country', lang), key: 'country', icon: Globe, value: user.country },
            { label: t('cdash.profile.city', lang), key: 'city', icon: Building2, value: user.city, placeholder: t('cdash.profile.yourCity', lang) },
            { label: t('cdash.profile.preferredRegion', lang), key: 'preferredRegion', icon: MapPin, value: user.preferredRegion, placeholder: t('cdash.profile.regionPlaceholder', lang) },
            { label: t('cdash.profile.dateOfBirth', lang), key: 'dateOfBirth', icon: Calendar, type: 'date', value: user.dateOfBirth ? new Date(user.dateOfBirth).toLocaleDateString() : '' },
          ].map(field => (
            <div key={field.key}>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
                <field.icon className="w-3 h-3" /> {field.label}
              </label>
              {editing ? (
                field.key === 'country' ? (
                  <ProfileCountryPicker value={form.country} onChange={(name: string) => setForm(f => ({ ...f, country: name, preferredRegion: '' }))} />
                ) : field.key === 'preferredRegion' ? (
                  <ProfileRegionSelect value={form.preferredRegion} onChange={(v: string) => setForm(f => ({ ...f, preferredRegion: v }))} country={form.country} />
                ) : (
                  <input
                    type={field.type || 'text'}
                    value={field.type === 'date' ? (form as any)[field.key]?.split?.('T')?.[0] || '' : (form as any)[field.key]}
                    onChange={e => setForm(f => ({ ...f, [field.key]: e.target.value }))}
                    className="w-full px-3.5 py-2.5 text-sm bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 focus:border-transparent transition"
                    placeholder={field.placeholder}
                  />
                )
              ) : (
                field.key === 'country' && field.value ? (
                  <p className="text-sm text-gray-900 dark:text-white py-2.5 px-1 flex items-center gap-2">
                    {(() => { const c = ALL_COUNTRY_CODES.find(cc => cc.name === field.value); return c ? <img src={getFlagUrl(c.code.toLowerCase(), 20)} alt="" className="w-5 h-[14px] object-cover rounded-sm" /> : null })()}
                    {field.value}
                  </p>
                ) : (
                  <p className="text-sm text-gray-900 dark:text-white py-2.5 px-1 capitalize">{field.value || '—'}</p>
                )
              )}
            </div>
          ))}
        </div>

        <div>
          <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
            <Edit3 className="w-3 h-3" /> {t('cdash.profile.bio', lang)}
          </label>
          {editing ? (
            <textarea value={form.bio} onChange={e => setForm(f => ({ ...f, bio: e.target.value }))}
              className="w-full px-3.5 py-2.5 text-sm bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 focus:border-transparent transition resize-none" rows={3}
              placeholder={t('cdash.profile.bioPlaceholder', lang)} />
          ) : (
            <p className="text-sm text-gray-900 dark:text-white py-2.5 px-1">{user.bio || '—'}</p>
          )}
        </div>
      </div>

      {/* Vulnerability Section */}
      <div className="glass-card rounded-2xl p-6">
        <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
          <Heart className="w-4 h-4 text-amber-500" /> {t('cdash.profile.priorityAssistance', lang)}
        </h3>
        {editing ? (
          <div className="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/20 dark:to-orange-950/10 border border-amber-200/80 dark:border-amber-800/40 rounded-xl p-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={form.isVulnerable} onChange={e => setForm(f => ({ ...f, isVulnerable: e.target.checked }))}
                className="mt-0.5 w-4 h-4 rounded border-amber-300 text-amber-600 focus:ring-amber-500" />
              <div>
                <div className="flex items-center gap-1.5">
                  <Heart className="w-4 h-4 text-amber-600" />
                  <span className="text-sm font-bold text-amber-800 dark:text-amber-300">{t('cdash.profile.mayNeedPriority', lang)}</span>
                </div>
                <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                  {t('cdash.profile.priorityRoutingDesc', lang)}
                </p>
              </div>
            </label>
            {form.isVulnerable && (
              <textarea value={form.vulnerabilityDetails} onChange={e => setForm(f => ({ ...f, vulnerabilityDetails: e.target.value }))}
                placeholder={t('cdash.profile.vulnerabilityPlaceholder', lang)}
                className="w-full mt-3 p-3 text-sm bg-white dark:bg-gray-800 rounded-xl border border-amber-200 dark:border-amber-700 focus:ring-2 focus:ring-amber-500 resize-none" rows={2} />
            )}
          </div>
        ) : (
          <div className={`rounded-xl p-4 ${user.isVulnerable ? 'bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/20 dark:to-orange-950/10 border border-amber-200/80 dark:border-amber-800/40' : 'bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700'}`}>
            <div className="flex items-center gap-2">
              <Heart className={`w-4 h-4 ${user.isVulnerable ? 'text-amber-600' : 'text-gray-400 dark:text-gray-400'}`} />
              <span className={`text-sm font-semibold ${user.isVulnerable ? 'text-amber-800 dark:text-amber-300' : 'text-gray-500 dark:text-gray-400'}`}>
                {user.isVulnerable ? t('cdash.profile.priorityActive', lang) : t('cdash.profile.priorityNotActive', lang)}
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
          <Shield className="w-4 h-4 text-aegis-600" /> {t('cdash.profile.accountInfo', lang)}
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {[
            { label: t('cdash.profile.email', lang), value: user.email, icon: Mail },
            { label: t('cdash.profile.verified', lang), value: user.emailVerified ? t('cdash.profile.yes', lang) : t('cdash.profile.notYet', lang), icon: CheckCircle, color: user.emailVerified ? 'text-emerald-600' : 'text-amber-600' },
            { label: t('cdash.profile.role', lang), value: user.role, icon: Shield, capitalize: true },
            { label: t('cdash.profile.loginCount', lang), value: user.loginCount || 0, icon: Activity },
            { label: t('cdash.profile.lastLogin', lang), value: user.lastLogin ? new Date(user.lastLogin).toLocaleDateString() : '—', icon: Clock },
            { label: t('cdash.profile.memberSince', lang), value: user.createdAt ? new Date(user.createdAt).toLocaleDateString() : '—', icon: Calendar },
          ].map((item, i) => (
            <div key={i} className="bg-gray-50/80 dark:bg-gray-800/40 rounded-xl p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <item.icon className="w-3 h-3 text-gray-400 dark:text-gray-400" />
                <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-400 uppercase tracking-wider">{item.label}</p>
              </div>
              <p className={`text-sm font-semibold ${item.color || 'text-gray-900 dark:text-white'} ${item.capitalize ? 'capitalize' : ''} truncate`}>{item.value}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// TAB 5: SECURITY — Change Password

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
    if (newPw !== confirmPw) { setMsg(t('cdash.security.mismatch', lang)); setMsgType('error'); return }
    if (newPw.length < 8) { setMsg(t('cdash.security.minLength', lang)); setMsgType('error'); return }

    setSubmitting(true)
    const result = await changePassword(currentPw, newPw)
    setSubmitting(false)

    if (result.success) {
      setMsg(t('cdash.security.success', lang))
      setMsgType('success')
      setCurrentPw(''); setNewPw(''); setConfirmPw('')
    } else {
      setMsg(result.error || t('cdash.security.failed', lang))
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
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 ml-[42px]">{t('cdash.security.desc', lang)}</p>
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
              <Lock className="w-3.5 h-3.5 text-gray-400 dark:text-gray-400" />
            </div>
            <input
              type={showPw ? 'text' : 'password'}
              value={currentPw}
              onChange={e => setCurrentPw(e.target.value)}
              className="w-full pl-14 pr-12 py-3 text-sm bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 focus:border-transparent transition"
              required
            />
            <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-400 hover:text-gray-600 transition-colors p-1">
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
              <Lock className="w-3.5 h-3.5 text-gray-400 dark:text-gray-400" />
            </div>
            <input
              type={showPw ? 'text' : 'password'}
              value={newPw}
              onChange={e => setNewPw(e.target.value)}
              className="w-full pl-14 pr-4 py-3 text-sm bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 focus:border-transparent transition"
              placeholder={t('cdash.security.minChars', lang)}
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
              <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1 font-medium">{strength.label}</p>
            </div>
          )}
        </div>

        <div>
          <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">
            <Lock className="w-3 h-3" /> {t('citizen.security.confirmNewPassword', lang)}
          </label>
          <div className="relative">
            <div className="absolute left-3.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
              <Lock className="w-3.5 h-3.5 text-gray-400 dark:text-gray-400" />
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

      {/* Two-Factor Authentication */}
      <div className="glass-card rounded-2xl p-6">
        <CitizenTwoFactorSettings />
      </div>
    </div>
  )
}

// TAB 6: SETTINGS — Preferences

function SettingsTab({ preferences, updatePreferences }: any) {
  const lang = useLanguage()
  const { token, logout } = useCitizenAuth()
  const { setTheme } = useTheme()
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

  const buildForm = (prefs: any) => ({
    audioAlertsEnabled: prefs?.audio_alerts_enabled ?? true,
    autoPlayCritical: prefs?.auto_play_critical ?? true,
    audioVolume: (() => {
      const raw = prefs?.audio_volume ?? 70
      // Server stores as 0-1, display as 0-100
      return typeof raw === 'number' && raw <= 1 ? Math.round(raw * 100) : raw
    })(),
    captionsEnabled: prefs?.captions_enabled ?? false,
    captionFontSize: prefs?.caption_font_size ?? 'medium',
    darkMode: prefs?.dark_mode ?? false,
    compactView: prefs?.compact_view ?? false,
    language: prefs?.language ?? 'en',
  })

  // savedFormRef holds the last-saved snapshot for dirty-checking and cancel revert
  const savedFormRef = useRef(buildForm(preferences))
  const [form, setForm] = useState(() => buildForm(preferences))

  // Sync form AND savedFormRef when preferences arrive from server
  useEffect(() => {
    if (preferences) {
      const built = buildForm(preferences)
      setForm(built)
      savedFormRef.current = built
    }
  }, [preferences])

  // Live-apply dark mode immediately as user toggles
  useEffect(() => {
    setTheme(form.darkMode ? 'default' : 'light')
  }, [form.darkMode])

  // Live-apply compact view class on <html> immediately
  useEffect(() => {
    document.documentElement.classList.toggle('compact-view', form.compactView)
  }, [form.compactView])

  // Live-apply language immediately
  useEffect(() => {
    if (form.language) setLanguage(form.language)
  }, [form.language])

  // Dirty state tracking against the saved snapshot
  const isDirty = JSON.stringify(form) !== JSON.stringify(savedFormRef.current)

  const handleSave = async () => {
    setSaving(true)
    const ok = await updatePreferences(form)
    if (ok) {
      // Update the saved snapshot so isDirty resets
      savedFormRef.current = { ...form }
    }
    setSaving(false)
    setMsgType(ok ? 'success' : 'error')
    setMsg(ok ? t('cdash.settings.prefsSaved', lang) : t('cdash.settings.prefsFailed', lang))
    setTimeout(() => setMsg(''), 5000)
  }

  const handleCancel = () => {
    const reverted = { ...savedFormRef.current }
    setForm(reverted)
    // Revert live DOM state
    setTheme(reverted.darkMode ? 'default' : 'light')
    document.documentElement.classList.toggle('compact-view', reverted.compactView)
    document.documentElement.setAttribute('data-caption-size', reverted.captionFontSize)
    if (reverted.language) setLanguage(reverted.language)
    // Revert audio in localStorage
    const stored = JSON.parse(localStorage.getItem('aegis-audio-settings') || '{}')
    localStorage.setItem('aegis-audio-settings', JSON.stringify({
      ...stored, enabled: reverted.audioAlertsEnabled,
      volume: reverted.audioVolume / 100, autoPlayCritical: reverted.autoPlayCritical,
    }))
  }

  // Live-apply caption font size
  useEffect(() => {
    document.documentElement.setAttribute('data-caption-size', form.captionFontSize)
  }, [form.captionFontSize])

  // Sync audio settings to localStorage so useAudioAlerts picks them up
  useEffect(() => {
    const stored = JSON.parse(localStorage.getItem('aegis-audio-settings') || '{}')
    localStorage.setItem('aegis-audio-settings', JSON.stringify({
      ...stored, enabled: form.audioAlertsEnabled,
      volume: form.audioVolume / 100, autoPlayCritical: form.autoPlayCritical,
    }))
  }, [form.audioAlertsEnabled, form.audioVolume, form.autoPlayCritical])

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
          {isDirty && (
            <>
              <span className="text-[10px] text-amber-600 dark:text-amber-400 font-semibold bg-amber-50 dark:bg-amber-950/30 px-2 py-1 rounded-lg">{t('cdash.settings.unsaved', lang)}</span>
              <button onClick={handleCancel} disabled={saving}
                className="flex items-center gap-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs font-bold px-4 py-2.5 rounded-xl transition-all">
                {t('cdash.settings.cancel', lang)}
              </button>
            </>
          )}
          <button onClick={handleSave} disabled={saving || !isDirty}
            className="flex items-center gap-1.5 bg-gradient-to-r from-aegis-600 to-aegis-700 hover:from-aegis-700 hover:to-aegis-800 disabled:from-gray-300 disabled:to-gray-400 disabled:cursor-not-allowed text-white text-xs font-bold px-4 py-2.5 rounded-xl transition-all shadow-sm hover:shadow-md">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} {t('cdash.settings.save', lang)}
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
          {t('cdash.settings.audioAlerts', lang)}
        </h3>

        <div className="flex items-center justify-between py-1">
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">{t('cdash.settings.enableAudioAlerts', lang)}</p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">{t('cdash.settings.enableAudioAlertsDesc', lang)}</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" checked={form.audioAlertsEnabled} onChange={e => setForm(f => ({ ...f, audioAlertsEnabled: e.target.checked }))}
              className="sr-only peer" />
            <div className="w-11 h-6 bg-gray-200 peer-focus:ring-2 peer-focus:ring-aegis-300 dark:bg-gray-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all after:shadow-sm peer-checked:bg-gradient-to-r peer-checked:from-aegis-500 peer-checked:to-aegis-600"></div>
          </label>
        </div>

        <div className="flex items-center justify-between py-1">
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">{t('cdash.settings.autoPlayCritical', lang)}</p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">{t('cdash.settings.autoPlayCriticalDesc', lang)}</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" checked={form.autoPlayCritical} onChange={e => setForm(f => ({ ...f, autoPlayCritical: e.target.checked }))}
              className="sr-only peer" />
            <div className="w-11 h-6 bg-gray-200 peer-focus:ring-2 peer-focus:ring-aegis-300 dark:bg-gray-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all after:shadow-sm peer-checked:bg-gradient-to-r peer-checked:from-aegis-500 peer-checked:to-aegis-600"></div>
          </label>
        </div>

        <div className="py-1">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-gray-900 dark:text-white">{t('cdash.settings.volume', lang)}</p>
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
          {t('cdash.settings.accessibility', lang)}
        </h3>

        <div className="flex items-center justify-between py-1">
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">{t('cdash.settings.captionOverlay', lang)}</p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">{t('cdash.settings.captionOverlayDesc', lang)}</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" checked={form.captionsEnabled} onChange={e => setForm(f => ({ ...f, captionsEnabled: e.target.checked }))}
              className="sr-only peer" />
            <div className="w-11 h-6 bg-gray-200 peer-focus:ring-2 peer-focus:ring-aegis-300 dark:bg-gray-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all after:shadow-sm peer-checked:bg-gradient-to-r peer-checked:from-aegis-500 peer-checked:to-aegis-600"></div>
          </label>
        </div>

        <div>
          <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">{t('cdash.settings.captionFontSize', lang)}</label>
          <select value={form.captionFontSize} onChange={e => setForm(f => ({ ...f, captionFontSize: e.target.value }))}
            className="w-full px-3.5 py-2.5 text-sm bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 focus:border-transparent appearance-none transition">
            <option value="small">{t('cdash.settings.small', lang)}</option>
            <option value="medium">{t('cdash.settings.medium', lang)}</option>
            <option value="large">{t('cdash.settings.large', lang)}</option>
            <option value="xlarge">{t('cdash.settings.extraLarge', lang)}</option>
          </select>
          <p className="caption-size-preview mt-2 px-3 py-1.5 bg-gray-100 dark:bg-gray-800 rounded-lg text-gray-700 dark:text-gray-300 italic">
            Caption preview text — emergency alert overlay
          </p>
        </div>
      </div>

      {/* Display */}
      <div className="glass-card rounded-2xl p-6 space-y-4">
        <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
            <Eye className="w-3.5 h-3.5 text-white" />
          </div>
          {t('cdash.settings.display', lang)}
        </h3>

        <div className="flex items-center justify-between py-1">
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">{t('cdash.settings.darkMode', lang)}</p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">{t('cdash.settings.darkModeDesc', lang)}</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" checked={form.darkMode} onChange={e => setForm(f => ({ ...f, darkMode: e.target.checked }))}
              className="sr-only peer" />
            <div className="w-11 h-6 bg-gray-200 peer-focus:ring-2 peer-focus:ring-aegis-300 dark:bg-gray-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all after:shadow-sm peer-checked:bg-gradient-to-r peer-checked:from-aegis-500 peer-checked:to-aegis-600"></div>
          </label>
        </div>

        <div className="flex items-center justify-between py-1">
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">{t('cdash.settings.compactView', lang)}</p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">{t('cdash.settings.compactViewDesc', lang)}</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" checked={form.compactView} onChange={e => setForm(f => ({ ...f, compactView: e.target.checked }))}
              className="sr-only peer" />
            <div className="w-11 h-6 bg-gray-200 peer-focus:ring-2 peer-focus:ring-aegis-300 dark:bg-gray-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all after:shadow-sm peer-checked:bg-gradient-to-r peer-checked:from-aegis-500 peer-checked:to-aegis-600"></div>
          </label>
        </div>

        <div>
          <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">{t('cdash.settings.language', lang)}</label>
          <select value={form.language} onChange={e => setForm(f => ({ ...f, language: e.target.value }))}
            className="w-full px-3.5 py-2.5 text-sm bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 focus:border-transparent appearance-none transition">
            <option value="en">English</option>
            <option value="es">Español (Spanish)</option>
            <option value="fr">Français (French)</option>
            <option value="ar">العربية (Arabic)</option>
            <option value="zh">中文 (Chinese)</option>
            <option value="hi">हिन्दी (Hindi)</option>
            <option value="pt">Português (Portuguese)</option>
            <option value="pl">Polski (Polish)</option>
            <option value="ur">اردو (Urdu)</option>
          </select>
        </div>
      </div>

      {/* Account Deletion — 30-day grace period */}
      <div className="glass-card rounded-2xl p-6 space-y-4 border-2 border-red-200/50 dark:border-red-900/30">
        <h3 className="text-sm font-bold text-red-600 dark:text-red-400 flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-red-500 to-rose-600 flex items-center justify-center">
            <Trash2 className="w-3.5 h-3.5 text-white" />
          </div>
          {t('cdash.settings.deleteAccount', lang)}
        </h3>
        
        {deletionStatus?.deletion_requested ? (
          <div className="space-y-3">
            <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800/30 rounded-lg p-4">
              <div className="flex items-start gap-2">
                <AlertCircleIcon className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-red-700 dark:text-red-400">{t('cdash.settings.deletionScheduled', lang)}</p>
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
                    {t('cdash.settings.cancelDeleteInfo', lang)}
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
              {t('cdash.settings.cancelDeletion', lang)}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t('cdash.settings.deleteDesc', lang)}
            </p>
            <ul className="text-xs text-gray-500 dark:text-gray-400 space-y-1 ml-4 list-disc">
              <li>{t('cdash.settings.deleteBullet1', lang)}</li>
              <li>{t('cdash.settings.deleteBullet2', lang)}</li>
              <li>{t('cdash.settings.deleteBullet3', lang)}</li>
              <li>{t('cdash.settings.deleteBullet4', lang)}</li>
            </ul>
            {showDeleteConfirm ? (
              <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800/30 rounded-lg p-4 space-y-3">
                <p className="text-sm font-semibold text-red-700 dark:text-red-400">{t('cdash.settings.areYouSure', lang)}</p>
                <p className="text-xs text-red-600 dark:text-red-400">
                  {t('cdash.settings.confirmDeleteDesc', lang)}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={handleRequestDeletion}
                    disabled={deletionLoading}
                    className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white rounded-lg font-medium transition text-sm flex items-center justify-center gap-2"
                  >
                    {deletionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    {t('cdash.settings.yesDelete', lang)}
                  </button>
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    className="px-4 py-2 bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-400 rounded-lg font-medium transition text-sm"
                  >
                    {t('cdash.settings.cancel', lang)}
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="w-full px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition text-sm flex items-center justify-center gap-2"
              >
                <Trash2 className="w-4 h-4" /> {t('cdash.settings.requestDeletion', lang)}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

