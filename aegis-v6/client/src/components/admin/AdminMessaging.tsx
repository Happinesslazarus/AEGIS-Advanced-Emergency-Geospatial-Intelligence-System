/*
 * AdminMessaging.tsx — Admin Citizen Messaging Panel
 * 
 * Real-time Socket.IO inbox for operators/admins to handle citizen
 * support threads. Features:
 *   - Thread list sorted by: emergency > vulnerable > priority > date
 *   - Conversation view with reply
 *   - Assign/resolve controls
 *   - Emergency highlighting
 *   - Typing indicators
 *   - Message status (sent/delivered/read)
 *   - Vulnerability badges
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  MessageSquare, Send, Search, AlertTriangle, Heart, CheckCircle,
  Clock, User, ChevronRight, ArrowLeft, Loader2, Check, CheckCheck,
  X, Shield, Filter, RefreshCw, UserCheck, Ban, ChevronDown,
  Zap, Bell, CircleDot, FileText, Users, Image as ImageIcon, Languages,
  Sparkles, Pin, Star, Timer, Inbox, Archive, MailOpen, Reply, Bookmark, Hash
} from 'lucide-react'
import { useSocket, ChatThread, ChatMessage } from '../../hooks/useSocket'
import { getSession } from '../../utils/auth'
import { translateText, TRANSLATION_LANGUAGES, clearTranslationCache } from '../../utils/translateService'
import { getLanguage } from '../../utils/i18n'
import { API_BASE, timeAgo } from '../../utils/helpers'
import MessageStatusIcon from '../ui/MessageStatusIcon'

type FilterMode = 'all' | 'emergency' | 'open' | 'in_progress' | 'resolved' | 'mine'

// timeAgo, API_BASE, MessageStatusIcon imported from shared modules

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; text: string }> = {
    open: { bg: 'bg-green-100 dark:bg-green-950/30', text: 'text-green-700 dark:text-green-300' },
    in_progress: { bg: 'bg-blue-100 dark:bg-blue-950/30', text: 'text-blue-700 dark:text-blue-300' },
    resolved: { bg: 'bg-purple-100 dark:bg-purple-950/30', text: 'text-purple-700 dark:text-purple-300' },
    closed: { bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-500' },
  }
  const s = map[status] || map.open
  return (
    <span className={`${s.bg} ${s.text} text-[9px] font-bold uppercase px-1.5 py-0.5 rounded`}>
      {status?.replace('_', ' ')}
    </span>
  )
}

export default function AdminMessaging(): JSX.Element {
  const socket = useSocket()
  const user = getSession()
  const [filter, setFilter] = useState<FilterMode>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [msgInput, setMsgInput] = useState('')
  const [selectedImage, setSelectedImage] = useState<File | null>(null)
  const [showQuickReplies, setShowQuickReplies] = useState(false)

  // Quick reply templates for common responses
  const QUICK_REPLIES = [
    { label: 'Acknowledged', text: 'Thank you for reaching out. We have received your message and are looking into it.', icon: '✅' },
    { label: 'On It', text: 'Our team is actively working on this. We will update you as soon as we have more information.', icon: '⚡' },
    { label: 'Stay Safe', text: 'Please stay safe and follow local emergency guidelines. Avoid flood-prone areas and keep emergency supplies ready.', icon: '🛡️' },
    { label: 'Need Info', text: 'Could you please provide more details? Specifically your exact location, the severity of the situation, and any immediate dangers.', icon: '📋' },
    { label: 'Resources Sent', text: 'Emergency resources have been dispatched to your area. Please stay where you are if it is safe to do so.', icon: '🚑' },
    { label: 'Update', text: 'We have an update on your situation. The emergency services are aware and coordinating response efforts.', icon: '📢' },
    { label: 'Resolved', text: 'This issue has been resolved. If you need any further assistance, please do not hesitate to reach out again.', icon: '✨' },
    { label: 'Escalated', text: 'Your case has been escalated to a senior operator for priority handling. You will hear back shortly.', icon: '🔺' },
  ]
  const [previewUrl, setPreviewUrl] = useState('')
  const [uploadingImage, setUploadingImage] = useState(false)
  const [showAssignDropdown, setShowAssignDropdown] = useState(false)
  // Translation state
  const [translations, setTranslations] = useState<Record<string, string>>({})
  const [translatingId, setTranslatingId] = useState<string | null>(null)
  const [targetLang, setTargetLang] = useState(() => getLanguage() || 'en')
  const [autoTranslate, setAutoTranslate] = useState(() => (getLanguage() || 'en') !== 'en')
  const [showLangPicker, setShowLangPicker] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const typingTimeoutRef = useRef<any>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const langPickerRef = useRef<HTMLDivElement>(null)

  const { threads, activeThread, messages, typingUsers, connected,
    connect, disconnect, sendMessage, joinThread, loadThreadMessages,
    markRead, startTyping, stopTyping, fetchAdminThreads,
    assignThread, resolveThread, setActiveThread
  } = socket

  // Connect on mount with operator token
  useEffect(() => {
    const token = localStorage.getItem('aegis-token') || localStorage.getItem('token')
    if (token && !connected) {
      // // console.log('[AdminMessaging] Connecting socket with admin token...')
      connect(token)
    } else if (!token) {
      console.warn('[AdminMessaging] No admin token found in localStorage')
    }
    return () => {
      // Don't disconnect — shared across admin page
    }
  }, [])

  // Fetch admin threads when connected
  useEffect(() => {
    if (connected) {
      // // console.log('[AdminMessaging] Socket connected! Fetching admin threads...')
      fetchAdminThreads()
      // Refresh every 30 seconds
      const interval = setInterval(() => fetchAdminThreads(), 30000)
      return () => clearInterval(interval)
    }
  }, [connected])

  // Scroll to bottom on messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Mark messages as read when viewing thread
  useEffect(() => {
    if (activeThread) {
      markRead(activeThread.id, [])
    }
  }, [activeThread?.id, messages.length])

  // Close lang picker on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (langPickerRef.current && !langPickerRef.current.contains(e.target as Node)) setShowLangPicker(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Per-message translate handler
  const handleTranslateMsg = async (msgId: string, text: string) => {
    if (translations[msgId]) {
      setTranslations(prev => { const n = { ...prev }; delete n[msgId]; return n })
      return
    }
    setTranslatingId(msgId)
    try {
      const result = await translateText(text, 'auto', targetLang)
      if (result.translatedText && result.translatedText !== text) {
        setTranslations(prev => ({ ...prev, [msgId]: result.translatedText }))
      } else {
        setTranslations(prev => ({ ...prev, [msgId]: `✓ ${text}` }))
      }
    } catch { /* skip */ }
    setTranslatingId(null)
  }

  // Auto-translate incoming messages
  useEffect(() => {
    if (!autoTranslate) return
    const untranslated = messages.filter(
      (m: ChatMessage) => m.content && !translations[m.id]
    )
    if (untranslated.length === 0) return
    const batch = untranslated.slice(0, 5)
    let cancelled = false
    ;(async () => {
      for (const msg of batch) {
        if (cancelled) break
        try {
          const result = await translateText(msg.content, 'auto', targetLang)
          if (!cancelled && result.translatedText && result.translatedText !== msg.content) {
            setTranslations(prev => ({ ...prev, [msg.id]: result.translatedText }))
          }
        } catch { /* skip */ }
      }
    })()
    return () => { cancelled = true }
  }, [autoTranslate, targetLang, messages.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // When target language changes, clear cached translations and re-translate
  const handleLangChange = (code: string) => {
    setTargetLang(code)
    clearTranslationCache()
    setTranslations({})
    setShowLangPicker(false)
    setAutoTranslate(true)
  }

  // Sort and filter threads
  const filteredThreads = useMemo(() => {
    let list = [...threads]

    // Filter
    if (filter === 'emergency') list = list.filter(t => t.is_emergency)
    else if (filter === 'open') list = list.filter(t => t.status === 'open')
    else if (filter === 'in_progress') list = list.filter(t => t.status === 'in_progress')
    else if (filter === 'resolved') list = list.filter(t => t.status === 'resolved')
    else if (filter === 'mine') list = list.filter(t => (t as any).assigned_to === user?.id || t.assigned_operator_id === user?.id)

    // Search
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase()
      list = list.filter(t =>
        t.subject?.toLowerCase().includes(q) ||
        t.citizen_name?.toLowerCase().includes(q) ||
        t.last_message?.toLowerCase().includes(q)
      )
    }

    // Sort: emergency first, then vulnerable, then by updated_at
    list.sort((a, b) => {
      if (a.is_emergency && !b.is_emergency) return -1
      if (!a.is_emergency && b.is_emergency) return 1
      if (a.is_vulnerable && !b.is_vulnerable) return -1
      if (!a.is_vulnerable && b.is_vulnerable) return 1
      return new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime()
    })

    return list
  }, [threads, filter, searchTerm, user?.id])

  const handleSelectThread = (thread: ChatThread) => {
    setActiveThread(thread)
    joinThread(thread.id)
    loadThreadMessages(thread.id)
    
    // Mark thread as read to clear unread badge
    const token = localStorage.getItem('aegis-token') || localStorage.getItem('token')
    if (token) {
      fetch(`/api/citizen/threads/${thread.id}/read`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}` }
      }).catch(err => console.error('[AdminMessaging] Mark read error:', err))
    }
  }

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) return
    if (file.size > 5 * 1024 * 1024) return
    setSelectedImage(file)
    const reader = new FileReader()
    reader.onload = (evt) => setPreviewUrl((evt.target?.result as string) || '')
    reader.readAsDataURL(file)
  }

  const handleSendMessage = async () => {
    if ((!msgInput.trim() && !selectedImage) || !activeThread) return

    let attachmentUrl: string | undefined
    if (selectedImage) {
      try {
        setUploadingImage(true)
        const formData = new FormData()
        formData.append('file', selectedImage)
        const token = localStorage.getItem('aegis-token') || localStorage.getItem('token')
        const uploadRes = await fetch('/api/upload', {
          method: 'POST',
          body: formData,
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        })
        if (!uploadRes.ok) throw new Error('Failed to upload image')
        const data = await uploadRes.json()
        attachmentUrl = data.url
      } catch {
        setUploadingImage(false)
        return
      }
    }

    sendMessage(activeThread.id, msgInput.trim(), attachmentUrl)
    setMsgInput('')
    setSelectedImage(null)
    setPreviewUrl('')
    if (fileInputRef.current) fileInputRef.current.value = ''
    setUploadingImage(false)
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
    stopTyping(activeThread.id)
  }

  const handleRefresh = () => {
    fetchAdminThreads()
    if (activeThread) loadThreadMessages(activeThread.id)
  }

  const handleTyping = (val: string) => {
    setMsgInput(val)
    if (!activeThread) return
    startTyping(activeThread.id)
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
    typingTimeoutRef.current = setTimeout(() => stopTyping(activeThread.id), 2000)
  }

  const handleAssign = () => {
    if (!activeThread || !user) return
    assignThread(activeThread.id, user.id)
    setShowAssignDropdown(false)
  }

  const handleResolve = () => {
    if (!activeThread) return
    resolveThread(activeThread.id)
  }

  const threadTypers = typingUsers.filter(t => t.threadId === activeThread?.id && t.userId !== user?.id)

  const resolvedCount = threads.filter(t => t.status === 'resolved').length
  const totalThreads = threads.length
  const emergencyCount = threads.filter(t => t.priority === 'critical' || t.priority === 'high').length
  const openCount = threads.filter(t => t.status === 'open').length
  const inProgressCount = threads.filter(t => t.status === 'in_progress').length

  // ── PROFESSIONAL SPLIT LAYOUT ───────────────────────────────────

  return (
    <div className="flex h-[calc(100vh-180px)] bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-950 dark:to-gray-900 rounded-2xl overflow-hidden shadow-xl border border-gray-200/80 dark:border-gray-800/80">
      {/* ══════ LEFT: Thread Inbox Panel ══════ */}
      <div className={`w-full md:w-[420px] flex flex-col bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 ${activeThread ? 'hidden md:flex' : 'flex'}`}>
        {/* Premium Header */}
        <div className="p-4 bg-gradient-to-r from-aegis-600 via-aegis-700 to-indigo-700 text-white">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-white/15 backdrop-blur-sm flex items-center justify-center">
                <Inbox className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-sm font-bold tracking-wide">Citizen Inbox</h2>
                <p className="text-[10px] text-white/60">{totalThreads} total conversations</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {connected && <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse ring-2 ring-green-400/30" title="Live" />}
              <button onClick={handleRefresh} className="p-1.5 hover:bg-white/10 rounded-lg transition" title="Refresh">
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Stat Pills */}
          <div className="flex gap-1.5 flex-wrap">
            {emergencyCount > 0 && (
              <span className="bg-red-500/30 backdrop-blur-sm text-white text-[10px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1 border border-red-400/30">
                <AlertTriangle className="w-3 h-3 animate-pulse" /> {emergencyCount} Emergency
              </span>
            )}
            <span className="bg-white/10 backdrop-blur-sm text-white/90 text-[10px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
              <MailOpen className="w-3 h-3" /> {openCount} Open
            </span>
            <span className="bg-white/10 backdrop-blur-sm text-white/90 text-[10px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
              <Zap className="w-3 h-3" /> {inProgressCount} Active
            </span>
            <span className="bg-white/10 backdrop-blur-sm text-white/90 text-[10px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
              <Archive className="w-3 h-3" /> {resolvedCount} Done
            </span>
          </div>
        </div>

        {/* Search + Filter */}
        <div className="p-3 space-y-2.5 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-gray-400" />
            <input
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-8 py-2.5 text-xs bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 focus:border-transparent transition shadow-sm"
              placeholder="Search by name, subject, or message..."
            />
            {searchTerm && (
              <button onClick={() => setSearchTerm('')} className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="flex gap-1 overflow-x-auto pb-0.5 scrollbar-thin">
            {[
              { key: 'all', label: 'All', icon: Hash, count: totalThreads },
              { key: 'emergency', label: 'SOS', icon: AlertTriangle, count: emergencyCount },
              { key: 'open', label: 'Open', icon: MailOpen, count: openCount },
              { key: 'in_progress', label: 'Active', icon: Zap, count: inProgressCount },
              { key: 'mine', label: 'Mine', icon: UserCheck, count: null },
              { key: 'resolved', label: 'Done', icon: CheckCircle, count: resolvedCount },
            ].map(f => (
              <button key={f.key} onClick={() => setFilter(f.key as FilterMode)}
                className={`text-[10px] font-bold px-3 py-1.5 rounded-lg whitespace-nowrap transition flex items-center gap-1 ${
                  filter === f.key
                    ? 'bg-aegis-600 text-white shadow-md shadow-aegis-600/25'
                    : 'bg-white dark:bg-gray-800 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 border border-gray-200 dark:border-gray-700 hover:border-aegis-300'
                }`}>
                <f.icon className="w-3 h-3" />
                {f.label}
                {f.count !== null && f.count > 0 && (
                  <span className={`text-[8px] px-1 py-0.5 rounded-full ${filter === f.key ? 'bg-white/20' : 'bg-gray-100 dark:bg-gray-700'}`}>{f.count}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Thread List */}
        <div className="flex-1 overflow-y-auto">
          {filteredThreads.length === 0 ? (
            <div className="p-10 text-center">
              <div className="w-16 h-16 mx-auto mb-3 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                <MessageSquare className="w-8 h-8 text-gray-300 dark:text-gray-600" />
              </div>
              <p className="text-sm font-semibold text-gray-500 dark:text-gray-400">No conversations</p>
              <p className="text-[11px] text-gray-400 mt-0.5">Matching threads will appear here</p>
            </div>
          ) : filteredThreads.map(thread => {
            const isActive = activeThread?.id === thread.id
            return (
              <button key={thread.id} onClick={() => handleSelectThread(thread)}
                className={`w-full px-4 py-3.5 text-left transition-all relative group ${
                  isActive 
                    ? 'bg-aegis-50 dark:bg-aegis-950/20' 
                    : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                } ${thread.is_emergency ? 'bg-red-50/40 dark:bg-red-950/10' : ''}`}>
                {/* Active/Priority indicator bar */}
                <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-r transition-all ${
                  isActive ? 'bg-aegis-500' :
                  thread.is_emergency ? 'bg-red-500' :
                  thread.is_vulnerable ? 'bg-amber-400' :
                  thread.status === 'open' ? 'bg-green-400' :
                  thread.status === 'in_progress' ? 'bg-blue-400' : 'bg-transparent'
                }`} />

                <div className="flex items-start gap-3 pl-1">
                  {/* Avatar */}
                  <div className={`relative w-10 h-10 rounded-xl flex items-center justify-center text-xs font-bold flex-shrink-0 shadow-sm ${
                    thread.is_emergency ? 'bg-gradient-to-br from-red-400 to-red-600 text-white' :
                    thread.is_vulnerable ? 'bg-gradient-to-br from-amber-400 to-amber-600 text-white' :
                    'bg-gradient-to-br from-gray-200 to-gray-300 dark:from-gray-700 dark:to-gray-600 text-gray-700 dark:text-gray-200'
                  }`}>
                    {thread.citizen_name?.[0]?.toUpperCase() || '?'}
                    {thread.is_emergency && (
                      <div className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center animate-pulse">
                        <AlertTriangle className="w-2.5 h-2.5 text-white" />
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-xs font-bold text-gray-900 dark:text-white truncate">{thread.citizen_name || 'Unknown Citizen'}</span>
                      {thread.is_vulnerable && <Heart className="w-3 h-3 text-amber-500 flex-shrink-0" />}
                    </div>
                    <p className="text-[11px] font-semibold text-gray-700 dark:text-gray-300 truncate">{thread.subject}</p>
                    <p className="text-[10px] text-gray-400 dark:text-gray-500 truncate mt-0.5 leading-relaxed">{thread.last_message || 'No messages yet'}</p>
                  </div>

                  <div className="flex flex-col items-end gap-1.5 flex-shrink-0 pt-0.5">
                    <StatusBadge status={thread.status} />
                    {thread.operator_unread > 0 && (
                      <span className="bg-red-500 text-white text-[9px] font-bold min-w-[18px] h-[18px] flex items-center justify-center rounded-full shadow-sm shadow-red-500/30 animate-pulse">{thread.operator_unread}</span>
                    )}
                    <span className="text-[9px] text-gray-400 flex items-center gap-0.5">
                      <Clock className="w-2.5 h-2.5" />
                      {thread.updated_at ? timeAgo(thread.updated_at) : ''}
                    </span>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* ══════ RIGHT: Chat Panel ══════ */}
      <div className={`flex-1 flex flex-col bg-white dark:bg-gray-900 ${!activeThread ? 'hidden md:flex' : 'flex'}`}>
        {!activeThread ? (
          /* Premium Empty State */
          <div className="flex-1 flex items-center justify-center text-center p-8 bg-gradient-to-br from-gray-50 to-white dark:from-gray-950 dark:to-gray-900">
            <div>
              <div className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-aegis-100 to-aegis-200 dark:from-aegis-950/30 dark:to-aegis-900/20 flex items-center justify-center shadow-lg shadow-aegis-500/10">
                <MessageSquare className="w-10 h-10 text-aegis-500" />
              </div>
              <h3 className="text-base font-bold text-gray-900 dark:text-white mb-1">Citizen Support Inbox</h3>
              <p className="text-xs text-gray-500 max-w-xs">Select a conversation from the inbox to view messages, respond to citizens, and manage support threads.</p>
              <div className="mt-4 flex items-center justify-center gap-4 text-[10px] text-gray-400">
                <span className="flex items-center gap-1"><Sparkles className="w-3 h-3" /> Quick Replies</span>
                <span className="flex items-center gap-1"><Languages className="w-3 h-3" /> Translation</span>
                <span className="flex items-center gap-1"><Shield className="w-3 h-3" /> Priority</span>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Enhanced Chat Header */}
            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center gap-3 bg-gradient-to-r from-white to-gray-50 dark:from-gray-900 dark:to-gray-900/80">
              <button onClick={() => setActiveThread(null)} className="md:hidden p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition">
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold flex-shrink-0 shadow-sm ${
                activeThread.is_emergency ? 'bg-gradient-to-br from-red-400 to-red-600 text-white' : 
                activeThread.is_vulnerable ? 'bg-gradient-to-br from-amber-400 to-amber-600 text-white' : 
                'bg-gradient-to-br from-gray-200 to-gray-300 dark:from-gray-700 dark:to-gray-600 text-gray-700 dark:text-gray-200'
              }`}>
                {activeThread.citizen_name?.[0]?.toUpperCase() || '?'}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-gray-900 dark:text-white truncate">{activeThread.subject}</h3>
                  {activeThread.is_emergency && (
                    <span className="text-[9px] bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300 px-2 py-0.5 rounded-full font-bold uppercase animate-pulse flex items-center gap-0.5">
                      <AlertTriangle className="w-2.5 h-2.5" /> SOS
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-[11px] text-gray-500">
                  <span className="font-medium">{activeThread.citizen_name}</span>
                  {activeThread.is_vulnerable && (
                    <span className="flex items-center gap-0.5 text-amber-600 dark:text-amber-400"><Heart className="w-3 h-3" /> Vulnerable</span>
                  )}
                  <span className="text-gray-300 dark:text-gray-600">|</span>
                  <span className="capitalize">{activeThread.category || 'general'}</span>
                  <span className="text-gray-300 dark:text-gray-600">|</span>
                  <StatusBadge status={activeThread.status} />
                </div>
              </div>

              {/* Action Cluster */}
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {/* Translation Control */}
                <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700">
                  <Languages className="w-3 h-3 text-blue-500" />
                  <select
                    value={targetLang}
                    onChange={(e) => handleLangChange(e.target.value)}
                    className="text-[10px] bg-transparent text-gray-700 dark:text-gray-200 outline-none cursor-pointer"
                    title="Translate to"
                  >
                    {TRANSLATION_LANGUAGES.map(lang => (
                      <option key={lang.code} value={lang.code}>{lang.name}</option>
                    ))}
                  </select>
                  <label className="flex items-center gap-1 text-[10px] text-gray-500">
                    <input type="checkbox" checked={autoTranslate} onChange={() => setAutoTranslate(!autoTranslate)} className="w-3 h-3 rounded border-gray-300 text-aegis-600" />
                    Auto
                  </label>
                </div>
                {activeThread.status !== 'resolved' && activeThread.status !== 'closed' && (
                  <>
                    <button onClick={handleAssign}
                      className="text-[10px] font-bold px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition flex items-center gap-1 border border-blue-200/50 dark:border-blue-800/30"
                      title="Assign to me">
                      <UserCheck className="w-3 h-3" /> Assign
                    </button>
                    <button onClick={handleResolve}
                      className="text-[10px] font-bold px-3 py-2 rounded-lg bg-green-50 dark:bg-green-950/30 text-green-600 dark:text-green-300 hover:bg-green-100 dark:hover:bg-green-900/40 transition flex items-center gap-1 border border-green-200/50 dark:border-green-800/30"
                      title="Mark resolved">
                      <CheckCircle className="w-3 h-3" /> Resolve
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Emergency Banner */}
            {activeThread.is_emergency && (
              <div className="bg-gradient-to-r from-red-50 to-red-100 dark:from-red-950/30 dark:to-red-950/10 border-b border-red-200 dark:border-red-800/50 px-4 py-2.5 flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-red-500/20 flex items-center justify-center">
                  <AlertTriangle className="w-4 h-4 text-red-600 animate-pulse" />
                </div>
                <div className="flex-1">
                  <span className="text-xs font-bold text-red-700 dark:text-red-300">EMERGENCY THREAD</span>
                  <span className="text-[10px] text-red-500 ml-2">Auto-escalated due to emergency keywords</span>
                </div>
                {activeThread.escalation_keywords && activeThread.escalation_keywords.length > 0 && (
                  <div className="flex gap-1">
                    {activeThread.escalation_keywords.map((kw: string, i: number) => (
                      <span key={i} className="text-[9px] bg-red-200 dark:bg-red-900/50 text-red-700 dark:text-red-300 px-1.5 py-0.5 rounded font-bold">{kw}</span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Vulnerability Banner */}
            {activeThread.is_vulnerable && !activeThread.is_emergency && (
              <div className="bg-gradient-to-r from-amber-50 to-amber-100/50 dark:from-amber-950/20 dark:to-amber-950/5 border-b border-amber-200 dark:border-amber-800/50 px-4 py-2.5 flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-amber-500/20 flex items-center justify-center">
                  <Heart className="w-4 h-4 text-amber-600" />
                </div>
                <span className="text-xs font-bold text-amber-700 dark:text-amber-300">Priority Support</span>
                <span className="text-[10px] text-amber-500">Vulnerable citizen — respond with care and urgency</span>
              </div>
            )}

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gradient-to-b from-gray-50/50 to-gray-100/30 dark:from-gray-950 dark:to-gray-950/80">
              {messages.length === 0 && (
                <div className="text-center py-12">
                  <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                    <MessageSquare className="w-7 h-7 text-gray-300 dark:text-gray-600" />
                  </div>
                  <p className="text-sm font-semibold text-gray-500">No messages yet</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">Start the conversation by sending a message below</p>
                </div>
              )}
              {messages.map((msg: ChatMessage, idx: number) => {
                const isMine = msg.sender_id === user?.id && msg.sender_type === 'operator'
                const isCitizen = msg.sender_type === 'citizen'
                const isConsecutive = idx > 0 && messages[idx - 1].sender_id === msg.sender_id && messages[idx - 1].sender_type === msg.sender_type
                return (
                  <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'} ${isConsecutive ? '' : 'mt-1'} group`}>
                    <div className={`max-w-[75%] ${isConsecutive ? '' : ''}`}>
                      {/* Sender label */}
                      {!isMine && !isConsecutive && (
                        <div className="flex items-center gap-1.5 mb-1 ml-1">
                          <div className={`w-6 h-6 rounded-lg flex items-center justify-center text-[9px] font-bold ${
                            isCitizen ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                          }`}>{(msg.sender_name || '?')[0].toUpperCase()}</div>
                          <span className={`text-[10px] font-semibold ${isCitizen ? 'text-amber-600 dark:text-amber-400' : 'text-blue-600 dark:text-blue-400'}`}>
                            {msg.sender_name || (isCitizen ? 'Citizen' : 'Operator')}
                          </span>
                          <span className={`text-[8px] font-bold uppercase px-1.5 py-0.5 rounded-full ${
                            isCitizen ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                          }`}>{msg.sender_type}</span>
                        </div>
                      )}

                      {/* Message Bubble */}
                      <div className={`rounded-2xl px-4 py-2.5 shadow-sm ${
                        isMine
                          ? 'bg-gradient-to-br from-aegis-500 to-aegis-600 text-white rounded-br-md'
                          : isCitizen
                            ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white border border-gray-200 dark:border-gray-700 rounded-bl-md'
                            : 'bg-blue-50 dark:bg-blue-950/20 text-gray-900 dark:text-white border border-blue-200/50 dark:border-blue-800/30 rounded-bl-md'
                      }`}>
                        {msg.content && <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>}
                        {/* Translation */}
                        {translations[msg.id] && (
                          <div className={`mt-1.5 pt-1.5 border-t ${isMine ? 'border-white/20' : 'border-gray-200 dark:border-gray-600'}`}>
                            <p className={`text-[9px] font-bold ${isMine ? 'text-white/50' : 'text-blue-500'} flex items-center gap-0.5`}><Languages className="w-2.5 h-2.5" /> Translated</p>
                            <p className="text-sm leading-relaxed whitespace-pre-wrap">{translations[msg.id]}</p>
                          </div>
                        )}
                        {msg.attachment_url && (
                          <img src={msg.attachment_url} alt="attachment" className="mt-2 max-w-full max-h-56 rounded-xl border border-white/20 object-contain" />
                        )}
                        <div className={`flex items-center gap-1.5 mt-1 ${isMine ? 'justify-end' : 'justify-start'}`}>
                          <span className={`text-[10px] ${isMine ? 'text-white/50' : 'text-gray-400'}`}>
                            {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          {isMine && <MessageStatusIcon status={msg.status} />}
                          {msg.content && (
                            <button
                              onClick={() => handleTranslateMsg(msg.id, msg.content)}
                              className={`px-1 py-0.5 rounded transition-colors ${
                                translations[msg.id]
                                  ? (isMine ? 'text-white/70 bg-white/10' : 'text-blue-500 bg-blue-50 dark:bg-blue-950/30')
                                  : (isMine ? 'text-white/30 hover:text-white/60 hover:bg-white/10' : 'text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/30')
                              } opacity-0 group-hover:opacity-100`}
                              title={translations[msg.id] ? 'Remove translation' : 'Translate'}
                            >
                              {translatingId === msg.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Languages className="w-3 h-3" />}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}

              {/* Typing indicator */}
              {threadTypers.length > 0 && (
                <div className="flex justify-start">
                  <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl rounded-bl-md px-4 py-3 shadow-sm">
                    <div className="flex items-center gap-2.5">
                      <div className="flex gap-1">
                        <div className="w-2 h-2 bg-aegis-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <div className="w-2 h-2 bg-aegis-400 rounded-full animate-bounce" style={{ animationDelay: '200ms' }} />
                        <div className="w-2 h-2 bg-aegis-400 rounded-full animate-bounce" style={{ animationDelay: '400ms' }} />
                      </div>
                      <span className="text-[10px] text-gray-400 font-medium">{threadTypers[0].userName} is typing...</span>
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Section */}
            {activeThread.status !== 'resolved' && activeThread.status !== 'closed' ? (
              <div className="border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
                {/* Quick Replies Bar */}
                <div className="px-4 pt-2.5">
                  <button
                    onClick={() => setShowQuickReplies(!showQuickReplies)}
                    className={`text-[10px] font-bold px-2.5 py-1 rounded-lg transition flex items-center gap-1 ${
                      showQuickReplies
                        ? 'bg-aegis-100 dark:bg-aegis-950/30 text-aegis-600'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                    }`}
                  >
                    <Sparkles className="w-3 h-3" /> Quick Replies
                    <ChevronDown className={`w-3 h-3 transition-transform ${showQuickReplies ? 'rotate-180' : ''}`} />
                  </button>
                  {showQuickReplies && (
                    <div className="mt-2 grid grid-cols-4 gap-1.5 pb-2">
                      {QUICK_REPLIES.map((qr, i) => (
                        <button
                          key={i}
                          onClick={() => { setMsgInput(qr.text); setShowQuickReplies(false) }}
                          className="px-2.5 py-2 text-[10px] font-medium bg-gray-50 dark:bg-gray-800 hover:bg-aegis-50 dark:hover:bg-aegis-950/20 border border-gray-200 dark:border-gray-700 hover:border-aegis-300 dark:hover:border-aegis-700 rounded-lg transition text-left group/qr"
                          title={qr.text}
                        >
                          <span className="text-base">{qr.icon}</span>
                          <span className="block text-gray-600 dark:text-gray-300 group-hover/qr:text-aegis-600 dark:group-hover/qr:text-aegis-400 truncate">{qr.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* File input */}
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageSelect} />

                {/* Image Preview */}
                {previewUrl && (
                  <div className="mx-4 mt-2 mb-1 relative inline-block">
                    <img src={previewUrl} alt="preview" className="h-20 w-auto rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm" />
                    <button
                      type="button"
                      onClick={() => { setSelectedImage(null); setPreviewUrl(''); if (fileInputRef.current) fileInputRef.current.value = '' }}
                      className="absolute -top-2 -right-2 bg-red-500 hover:bg-red-600 text-white rounded-full p-1 shadow-sm transition"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )}

                {/* Input Row */}
                <div className="flex items-end gap-2 p-3 pt-1.5">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="p-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-400 hover:text-aegis-600 hover:border-aegis-300 hover:bg-aegis-50 dark:hover:bg-aegis-950/10 transition"
                    title="Attach image"
                  >
                    <ImageIcon className="w-4 h-4" />
                  </button>
                  <textarea
                    value={msgInput}
                    onChange={e => handleTyping(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage() } }}
                    placeholder="Type a professional reply..."
                    rows={1}
                    className="flex-1 px-4 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 focus:border-transparent transition resize-none max-h-28"
                  />
                  <button onClick={handleSendMessage} disabled={(!msgInput.trim() && !selectedImage) || uploadingImage}
                    className="bg-gradient-to-r from-aegis-500 to-aegis-600 hover:from-aegis-600 hover:to-aegis-700 disabled:from-gray-300 disabled:to-gray-300 dark:disabled:from-gray-700 dark:disabled:to-gray-700 text-white p-2.5 rounded-xl transition flex-shrink-0 shadow-md shadow-aegis-500/20 disabled:shadow-none">
                    {uploadingImage ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            ) : (
              <div className="px-4 py-4 border-t border-gray-200 dark:border-gray-800 text-center bg-gray-50 dark:bg-gray-900">
                <div className="flex items-center justify-center gap-2 text-sm text-gray-400">
                  <CheckCircle className="w-4 h-4 text-green-400" />
                  This conversation has been <span className="font-semibold capitalize">{activeThread.status}</span>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
