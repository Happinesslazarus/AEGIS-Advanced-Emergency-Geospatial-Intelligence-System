/**
 * Community chat room citizen component (public-facing UI element).
 *
 * - Rendered inside CitizenPage.tsx or CitizenDashboard.tsx */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  MessageSquare, Send, Users, Loader2, Trash2, Shield,
  AlertCircle, ArrowDown, Hash, Radio, UserCheck,
  Image as ImageIcon, Smile, X, Reply,
  Edit2, Flag, Check, Ban, RefreshCw, LogOut, LogIn, VolumeX, Volume2, Languages, Search
} from 'lucide-react'
import { Socket } from 'socket.io-client'
import { useLocation } from 'react-router-dom'
import { getToken } from '../../utils/api'
import { useCitizenAuth } from '../../contexts/CitizenAuthContext'
import { useSharedSocket } from '../../contexts/SocketContext'
import { translateText, buildTranslationMap, TRANSLATION_LANGUAGES } from '../../utils/translateService'
import { getLanguage, t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'
import { API_BASE } from '../../utils/helpers'

//API_BASE imported from ../../utils/helpers

/* Emoji Data */
const EMOJI_CATEGORIES = [
  {
    key: 'communityChat.emojiCategorySmileys',
    emojis: ['\u{1f600}','\u{1f603}','\u{1f604}','\u{1f601}','\u{1f605}','\u{1f602}','\u{1f923}','\u{1f60a}','\u{1f607}','\u{1f642}','\u{1f609}','\u{1f60d}','\u{1f970}','\u{1f618}','\u{1f60b}','\u{1f60e}','\u{1f913}','\u{1f917}','\u{1f929}','\u{1f60f}','\u{1f914}','\u{1f610}','\u{1f611}','\u{1f644}','\u{1f636}','\u{1f62c}','\u{1f62e}','\u{1f62f}','\u{1f632}','\u{1f92f}','\u{1f633}','\u{1f97a}','\u{1f622}','\u{1f62d}','\u{1f624}','\u{1f621}','\u{1f92c}','\u{1f608}','\u{1f480}','\u{1f921}','\u{1f47b}','\u{1f47d}','\u{1f916}','\u{1f4a9}','\u{1f63a}','\u{1f638}','\u{1f63b}']
  },
  {
    key: 'communityChat.emojiCategoryGestures',
    emojis: ['\u{1f44d}','\u{1f44e}','\u{1f44b}','\u{1f91d}','\u{1f44f}','\u{1f64c}','\u{1f4aa}','\u{1f91e}','\u270c\ufe0f','\u{1f91f}','\u{1f919}','\u{1faf6}','\u2764\ufe0f','\u{1f9e1}','\u{1f49b}','\u{1f49a}','\u{1f499}','\u{1f49c}','\u{1f90d}','\u{1f5a4}','\u{1f494}','\u2763\ufe0f','\u{1f495}','\u{1f49e}','\u{1f493}','\u{1f497}','\u{1f496}','\u{1f498}','\u{1f49d}','\u{1f49f}','\u2665\ufe0f','\u{1fac2}']
  },
  {
    key: 'communityChat.emojiCategoryAlerts',
    emojis: ['\u{1f327}\ufe0f','\u26c8\ufe0f','\u{1f30a}','\u{1f525}','\u{1f4a8}','\u{1f32a}\ufe0f','\u2744\ufe0f','\u2600\ufe0f','\u{1f324}\ufe0f','\u26a1','\u{1f3e0}','\u{1f697}','\u{1f6a8}','\u26a0\ufe0f','\u{1f198}','\u{1f4cd}','\u{1f4e2}','\u{1f514}','\u2705','\u274c','\u{1f692}','\u{1f691}','\u{1f3e5}','\u26d1\ufe0f','\u{1f9ef}','\u{1f321}\ufe0f','\u{1f4a7}','\u{1f3d4}\ufe0f','\u{1f30b}','\u{1f5fa}\ufe0f']
  },
]

/* Report Reasons */
const REPORT_REASONS = [
  { value: 'Spam or misleading', key: 'communityChat.reason.spam.label' },
  { value: 'Harassment or bullying', key: 'communityChat.reason.harassment.label' },
  { value: 'Hate speech or discrimination', key: 'communityChat.reason.violence.label' },
  { value: 'Inappropriate content', key: 'communityChat.reason.inappropriate.label' },
  { value: 'False emergency information', key: 'communityChat.reason.misinformation.label' },
  { value: 'Personal information shared', key: 'communityChat.reason.other.label' },
  { value: 'Other', key: 'communityChat.reason.other.label' },
]

const DELETE_REASONS = [
  { value: 'Violated community policy', key: 'communityChat.reason.deletePolicy.label' },
  { value: 'Inappropriate content', key: 'communityChat.reason.inappropriate.label' },
  { value: 'Spam or advertising', key: 'communityChat.reason.deleteSpam.label' },
  { value: 'Harassment or bullying', key: 'communityChat.reason.harassment.label' },
  { value: 'Misinformation', key: 'communityChat.reason.misinformation.label' },
  { value: 'Personal information shared', key: 'communityChat.reason.deletePersonalInfo.label' },
  { value: 'Off-topic content', key: 'communityChat.reason.deleteOffTopic.label' },
]

const BAN_DURATIONS = [
  { value: '24h', key: 'communityChat.duration24Hours' },
  { value: '7d', key: 'communityChat.duration7Days' },
  { value: '2w', key: 'communityChat.duration2Weeks' },
  { value: '1m', key: 'communityChat.duration1Month' },
  { value: '3m', key: 'communityChat.duration3Months' },
  { value: 'permanent', key: 'communityChat.durationPermanent' },
]

const MUTE_DURATIONS = [
  { value: '1h', key: 'communityChat.duration1Hour' },
  { value: '24h', key: 'communityChat.duration24Hours' },
  { value: '7d', key: 'communityChat.duration7Days' },
  { value: '2w', key: 'communityChat.duration2Weeks' },
  { value: '1m', key: 'communityChat.duration1Month' },
  { value: '3m', key: 'communityChat.duration3Months' },
]

/* Types */
interface ChatMsg {
  id: string
  sender_id: string
  sender_type: 'citizen' | 'operator'
  sender_name: string
  sender_role?: string | null
  sender_avatar?: string
  content: string
  image_url?: string | null
  reply_to_id?: string | null
  reply_content?: string | null
  reply_sender_name?: string | null
  created_at: string
  deleted_at?: string | null
  edited_at?: string | null
  read_by?: Array<{ user_id: string; user_type: string; read_at: string }>
  //Deletion audit fields
  deleted_by?: string | null
  deleted_by_name?: string | null
  delete_reason?: string | null
}

interface OnlineUser {
  userId: string
  displayName: string
  role: string
}

interface TypingInfo {
  userId: string
  displayName: string
}

/* Helpers */
function timeStr(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function dateLabel(dateStr: string): string {
  const lang = getLanguage()
  const d = new Date(dateStr)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return 'Today'
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

function groupByDate(messages: ChatMsg[]): { date: string; msgs: ChatMsg[] }[] {
  const groups: { date: string; msgs: ChatMsg[] }[] = []
  let currentDate = ''
  for (const msg of messages) {
    const d = new Date(msg.created_at).toDateString()
    if (d !== currentDate) {
      currentDate = d
      groups.push({ date: msg.created_at, msgs: [msg] })
    } else {
      groups[groups.length - 1].msgs.push(msg)
    }
  }
  return groups
}

/* Render message text with auto-linked URLs */
function RenderContent({ text, isMine }: { text: string; isMine: boolean }) {
  if (!text) return null
  const urlRe = /(https?:\/\/[^\s<]+)/g
  const parts = text.split(urlRe)
  return (
    <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
      {parts.map((part: string, i: number) =>
        /^https?:\/\//.test(part) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className={`underline break-all ${isMine ? 'text-white/90 hover:text-white' : 'text-blue-600 dark:text-blue-400 hover:text-blue-700'}`}
          >
            {part.length > 60 ? part.slice(0, 57) + '...' : part}
          </a>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        )
      )}
    </p>
  )
}

/* Loading Skeleton */
function MessageSkeleton() {
  return (
    <div className="space-y-4 p-4">
      {[...Array(6)].map((_, i) => (
        <div key={i} className={`flex ${i % 3 === 0 ? 'justify-end' : 'justify-start'} animate-pulse`}>
          <div className="flex items-start gap-2 max-w-[70%]">
            {i % 3 !== 0 && <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 flex-shrink-0" />}
            <div className="space-y-1.5">
              {i % 3 !== 0 && <div className="h-3 w-16 bg-gray-200 dark:bg-gray-700 rounded" />}
              <div className="h-8 rounded-xl bg-gray-200 dark:bg-gray-700" style={{ width: `${100 + Math.random() * 150}px` }} />
              <div className="h-2.5 w-10 bg-gray-100 dark:bg-gray-800 rounded" />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

/* Emoji Picker */
function EmojiPicker({ onSelect, onClose }: { onSelect: (emoji: string) => void; onClose: () => void }) {
  const [activeCategory, setActiveCategory] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  return (
    <div
      ref={ref}
      className="absolute bottom-full mb-2 left-0 w-72 max-w-[calc(100vw-2rem)] bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 z-30 overflow-hidden"
    >
      {/* Category tabs */}
      <div className="flex border-b border-gray-100 dark:border-gray-700 px-1 pt-1">
        {EMOJI_CATEGORIES.map((cat, idx) => (
          <button
            key={cat.key}
            onClick={() => setActiveCategory(idx)}
            className={`flex-1 text-[10px] font-semibold px-2 py-1.5 rounded-t-lg transition ${
              activeCategory === idx
                ? 'bg-aegis-50 dark:bg-aegis-950/30 text-aegis-600 border-b-2 border-aegis-500'
                : 'text-gray-500 dark:text-gray-300 hover:text-gray-700 dark:hover:text-gray-300 dark:text-gray-300'
            }`}
          >
            {t(cat.key, getLanguage())}
          </button>
        ))}
      </div>
      {/* Emoji grid */}
      <div className="p-2 max-h-40 overflow-y-auto">
        <div className="grid grid-cols-8 gap-0.5">
          {EMOJI_CATEGORIES[activeCategory].emojis.map((emoji) => (
            <button
              key={emoji}
              onClick={() => onSelect(emoji)}
              className="w-8 h-8 flex items-center justify-center text-lg hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition"
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/* Image Lightbox */
function ImageLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  const lang = getLanguage()
  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 w-10 h-10 bg-white/20 hover:bg-white/30 text-white rounded-full flex items-center justify-center transition"
      >
        <X className="w-5 h-5" />
      </button>
      <img
        src={src}
        alt={'Expanded image'}
        className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      />
    </div>
  )
}

/* Confirm Dialog */
function ConfirmDialog({ title, message, onConfirm, onCancel }: {
  title: string; message: string; onConfirm: () => void; onCancel: () => void
}) {
  const lang = getLanguage()
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[90] flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-sm w-full p-6" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">{title}</h3>
        <p className="text-sm text-gray-600 dark:text-gray-300 mb-5">{message}</p>
        <div className="flex justify-end gap-3">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 dark:text-gray-300 dark:hover:text-gray-200 transition">{'Cancel'}</button>
          <button onClick={onConfirm} className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg transition font-medium">{'Delete'}</button>
        </div>
      </div>
    </div>
  )
}

/* Report Dialog */
function ReportDialog({ onSubmit, onCancel }: {
  onSubmit: (reason: string, details: string) => void; onCancel: () => void
}) {
  const lang = getLanguage()
  const [reason, setReason] = useState('')
  const [details, setDetails] = useState('')
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[90] flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1 flex items-center gap-2"><Flag className="w-5 h-5 text-red-500" /> {'Report Message'}</h3>
        <p className="text-xs text-gray-500 dark:text-gray-300 mb-4">{'Select a reason for reporting this message.'}</p>
        <div className="space-y-2 mb-4">
          {REPORT_REASONS.map(r => (
            <label key={r.value} className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition border ${reason === r.value ? 'border-red-400 bg-red-50 dark:bg-red-950/20' : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}>
              <input type="radio" name="reason" value={r.value} checked={reason === r.value} onChange={() => setReason(r.value)} className="text-red-600" />
              <span className="text-sm text-gray-700 dark:text-gray-300">{t(r.key, lang)}</span>
            </label>
          ))}
        </div>
        <textarea
          value={details}
          onChange={e => setDetails(e.target.value)}
          placeholder={'Additional details (optional)...'}
          rows={2}
          className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600 mb-4 resize-none"
        />
        <div className="flex justify-end gap-3">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 dark:text-gray-300 dark:hover:text-gray-200 transition">{'Cancel'}</button>
          <button onClick={() => { if (reason) onSubmit(reason, details) }} disabled={!reason} className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white rounded-lg transition font-medium">{'Submit Report'}</button>
        </div>
      </div>
    </div>
  )
}

//Main exported component
export default function CommunityChatRoom({ parentSocket }: { parentSocket?: Socket | null } = {}): JSX.Element {
  const { user: citizenUser, token: citizenToken } = useCitizenAuth()
  const location = useLocation()
  const isAdminPage = location.pathname.startsWith('/admin')
  const adminUserStr = localStorage.getItem('aegis-user')
  const adminToken = getToken()
  let adminUser: any = null
  try { adminUser = adminUserStr ? JSON.parse(adminUserStr) : null } catch {}
  const user = isAdminPage ? (adminUser || citizenUser) : (citizenUser || adminUser)
  const activeToken = isAdminPage
    ? (adminToken || citizenToken || '')
    : (citizenToken || adminToken || '')
  //Treat all non-citizen roles as staff/operator in community chat
  const isAdmin = !!user && !['citizen', 'verified_citizen', 'community_leader'].includes(String(user?.role || '').toLowerCase())
  const userRole = user?.role || 'citizen'

  //Use shared socket from existing useSocket hook (only for admin, when no parentSocket)
  const { socket: hookSocket, connected: hookConnected, connect: hookConnect } = useSharedSocket()
  const [socket, setSocket] = useState<Socket | null>(null)
  const [connected, setConnected] = useState(false)

  //State
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([])
  const [typingUsers, setTypingUsers] = useState<TypingInfo[]>([])
  const [msgInput, setMsgInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showOnlinePanel, setShowOnlinePanel] = useState(false)
  const [showScrollDown, setShowScrollDown] = useState(false)
  const [joined, setJoined] = useState(false)

  //Image upload state
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  //Reply state
  const [replyTo, setReplyTo] = useState<ChatMsg | null>(null)

  //Emoji picker
  const [showEmoji, setShowEmoji] = useState(false)

  //Lightbox
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)

  //Edit state (FIX #3d)
  const [editingMsg, setEditingMsg] = useState<ChatMsg | null>(null)
  const [editContent, setEditContent] = useState('')

  //Confirm delete dialog (FIX #3c) -- now includes reason for admin audit
  const [deleteTarget, setDeleteTarget] = useState<{ messageId: string; senderName: string; isOwnMessage: boolean } | null>(null)
  const [deleteReason, setDeleteReason] = useState('')

  //Report dialog (FIX #9)
  const [reportTarget, setReportTarget] = useState<ChatMsg | null>(null)

  //Translation state (Issue #12 -- real-time translation)
  const [translations, setTranslations] = useState<Record<string, string>>({})
  const [translatingId, setTranslatingId] = useState<string | null>(null)
  const [autoTranslate, setAutoTranslate] = useState(() => {
    const lang = getLanguage()
    return lang !== 'en'
  })
  const [targetLang, setTargetLang] = useState(() => getLanguage() || 'en')
  const [showLangPicker, setShowLangPicker] = useState(false)
  const currentLang = useLanguage()
  const langPickerRef = useRef<HTMLDivElement>(null)

  //Profile view modal state
  const [chatSearch, setChatSearch] = useState('')
  const [showChatSearch, setShowChatSearch] = useState(false)
  const [profileView, setProfileView] = useState<{
    userId: string
    name: string
    role: string
    type: 'citizen' | 'operator'
    joinedAt?: string | null
    status?: string | null
    loading?: boolean
    profilePhoto?: string | null
    bio?: string | null
    messageCount?: number
  } | null>(null)

  //Moderation state
  const [isMuted, setIsMuted] = useState(false)
  const [muteExpiresAt, setMuteExpiresAt] = useState<string | null>(null)
  const [isBanned, setIsBanned] = useState(false)
  const [banReason, setBanReason] = useState<string | null>(null)
  const [isMember, setIsMember] = useState<boolean | null>(null) // null = loading
  const [previewMessages, setPreviewMessages] = useState<ChatMsg[]>([])
  const [showBanModal, setShowBanModal] = useState<{ userId: string; name: string } | null>(null)
  const [showMuteModal, setShowMuteModal] = useState<{ userId: string; name: string } | null>(null)
  const [joiningCommunity, setJoiningCommunity] = useState(false)

  //Refs
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const chatContainerRef = useRef<HTMLDivElement>(null)
  const typingTimeoutRef = useRef<any>(null)
  const isAtBottomRef = useRef(true)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const userRef = useRef(user)
  userRef.current = user
  const hasMarkedInitialMessagesRef = useRef(false)
  const hasJoinedRef = useRef(false)
  const isMountedRef = useRef(true)
  const lastMessageTimeRef = useRef<string | null>(null) // Track latest message time for reconnect sync

  //Helper function to mark messages as read
  const markMessagesAsRead = useCallback((msgs: ChatMsg[]) => {
    if (!socket || !user?.id) return
    
    //Filter messages that need to be marked as read:
    //Not sent by current user
    //Not already read by current user
    //Not temporary/pending
    const messagesToMark = msgs.filter((msg) => {
      if (msg.sender_id === user.id) return false
      if (msg.id.startsWith('tmp-')) return false
      const readBy = msg.read_by || []
      const alreadyRead = readBy.some((r: any) => r.user_id === user.id)
      return !alreadyRead
    })

    if (messagesToMark.length === 0) return

    const messageIds = messagesToMark.map((m) => m.id)
    socket.emit('community:chat:mark_read', { messageIds })
  }, [socket, user])

  //Helper: fetch and merge missed messages from REST (for reconnection sync)
  const fetchAndMergeMissedMessages = useCallback(async () => {
    if (!activeToken) {
      return
    }
    try {
      const res = await fetch('/api/community/chat/messages?limit=50', {
        headers: { Authorization: `Bearer ${activeToken}` }
      })
      if (!res.ok) {
        return
      }
      const freshMsgs: ChatMsg[] = await res.json()
      if (!Array.isArray(freshMsgs) || freshMsgs.length === 0) return

      setMessages((prev: ChatMsg[]) => {
        //Build a Set of existing real message IDs (skip tmp-)
        const existingIds = new Set(prev.filter((m: ChatMsg) => !m.id.startsWith('tmp-')).map((m: ChatMsg) => m.id))
        const newMsgs = freshMsgs.filter((m: ChatMsg) => !existingIds.has(m.id))
        if (newMsgs.length === 0) {
          return prev
        }
        //Merge & sort chronologically
        const merged = [...prev.filter((m: ChatMsg) => !m.id.startsWith('tmp-')), ...newMsgs]
        merged.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        return merged
      })
    } catch {
      //fetch failed -- will retry on next reconnect
    }
  }, [activeToken])

  //Keep lastMessageTimeRef in sync with latest message
  useEffect(() => {
    if (messages.length > 0) {
      const latest = messages[messages.length - 1]
      if (latest && !latest.id.startsWith('tmp-')) {
        lastMessageTimeRef.current = latest.created_at
      }
    }
  }, [messages])

  //Load messages from REST on mount (primary)
  //Check community membership on mount (citizens only)
  useEffect(() => {
    if (isAdmin) {
      setIsMember(true) // Admins always have access
      return
    }
    if (!activeToken) return

    const checkMembership = async () => {
      try {
        const res = await fetch('/api/community/membership', {
          headers: { Authorization: `Bearer ${activeToken}` }
        })
        if (res.ok) {
          const data = await res.json()
          setIsMember(data.isMember)
          if (data.isBanned) {
            setIsBanned(true)
            setBanReason(data.ban?.reason || 'You have been banned from community chat')
          }
          if (data.isMuted) {
            setIsMuted(true)
            setMuteExpiresAt(data.mute?.expires_at || null)
          }
        }
      } catch {
        //Default to member on error for backwards compat
        setIsMember(true)
      }
    }
    checkMembership()

    //If not a member, load preview messages
    const loadPreview = async () => {
      try {
        const res = await fetch('/api/community/chat/preview', {
          headers: { Authorization: `Bearer ${activeToken}` }
        })
        if (res.ok) {
          const data = await res.json()
          const msgs = Array.isArray(data) ? data : (Array.isArray(data?.messages) ? data.messages : [])
          setPreviewMessages(msgs)
        }
      } catch {}
    }
    loadPreview()
  }, [activeToken, isAdmin])

  //Join/Leave community handlers
  const handleJoinCommunity = async () => {
    if (!activeToken) return
    setJoiningCommunity(true)
    try {
      const csrfToken = document.cookie.split('; ').find(c => c.startsWith('aegis_csrf='))?.split('=')[1]
      const res = await fetch('/api/community/join', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${activeToken}`,
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        }
      })
      if (res.ok) {
        setIsMember(true)
        //Re-join the Socket.IO room so we receive broadcasts again
        if (socket?.connected) {
          hasJoinedRef.current = false
          // // console.log('[CommunityChat] After REST join, re-joining Socket.IO room')
          socket.emit('community:chat:join', (ack: any) => {
            // // console.log('[CommunityChat] Re-join ack:', ack)
            if (ack?.success) {
              setJoined(true)
              hasJoinedRef.current = true
              if (ack.users && Array.isArray(ack.users)) setOnlineUsers(ack.users)
            } else if (ack?.banned) {
              setIsBanned(true)
              setBanReason(ack.reason || 'You have been banned from community chat')
              setIsMember(false)
            }
          })
        }
      } else {
        const data = await res.json()
        if (data.banned) {
          setIsBanned(true)
          setBanReason(data.reason || 'You have been banned from community chat')
        }
      }
    } catch {
      //join failed
    } finally {
      setJoiningCommunity(false)
    }
  }

  const handleLeaveCommunity = async () => {
    if (!activeToken) return
    if (!window.confirm('Are you sure you want to leave the community chat? You can rejoin anytime.')) return
    try {
      const csrfToken = document.cookie.split('; ').find(c => c.startsWith('aegis_csrf='))?.split('=')[1]
      const res = await fetch('/api/community/leave', {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${activeToken}`,
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        }
      })
      if (res.ok) {
        //Leave Socket.IO room first, then update UI
        socket?.emit('community:chat:leave')
        hasJoinedRef.current = false
        setJoined(false)
        setOnlineUsers([])
        setIsMember(false)
      }
    } catch {
      //leave failed
    }
  }

  useEffect(() => {
    let isCancelled = false
    
    const loadMessagesFromREST = async () => {
      try {
        const token = activeToken
        
        // // console.log('[CommunityChat] REST load starting, token exists:', !!token)
        
        if (!token) {
          if (!isCancelled) setLoading(false)
          return
        }
        
        // // console.log('[CommunityChat] Fetching /api/community/chat/messages')
        const res = await fetch('/api/community/chat/messages?limit=50', {
          headers: { Authorization: `Bearer ${token}` }
        })
        
        // // console.log('[CommunityChat] REST response:', res.status, res.ok)
        
        if (res.ok) {
          const msgs = await res.json()
          // // console.log('[CommunityChat] Loaded messages:', msgs.length, 'messages')
          // // console.log('[CommunityChat] First message:', msgs[0])
          
          if (!isCancelled && Array.isArray(msgs)) {
            setMessages(msgs)
            setLoading(false)
            // // console.log('[CommunityChat] State updated successfully - messages:', msgs.length)
          }
        } else {
          if (!isCancelled) setLoading(false)
        }
      } catch {
        if (!isCancelled) setLoading(false)
      }
    }
    
    loadMessagesFromREST()
    
    return () => {
      isCancelled = true
    }
  }, [activeToken])

  //Determine which socket to use: parentSocket (citizen) or hookSocket (admin)
  useEffect(() => {
    //PRIORITY 1: Use parentSocket from CitizenDashboard if available
    if (parentSocket?.connected) {
      const wasDisconnected = !connected && socket === parentSocket
      // // console.log('[CommunityChat] Using PARENT socket:', parentSocket.id, wasDisconnected ? '(reconnected)' : '')
      setSocket(parentSocket)
      setConnected(true)
      setLoading(false)
      //If the socket was previously set but disconnected, resync on reconnect
      if (wasDisconnected) {
        // // console.log('[CommunityChat] Parent socket reconnected -- resyncing messages')
        fetchAndMergeMissedMessages()
      }
      return
    }

    //Track disconnect state for parent socket
    if (parentSocket && !parentSocket.connected && socket === parentSocket) {
      setConnected(false)
    }

    //PRIORITY 2: No parent socket provided (admin page) -- use internal hook socket
    if (parentSocket === undefined || parentSocket === null) {
      if (!activeToken) {
        setLoading(false)
        return
      }

 //Track hookSocket disconnect -> update connected state
      if (hookSocket && !hookSocket.connected && socket === hookSocket) {
        setConnected(false)
      }

      if (hookSocket?.connected) {
        // // console.log('[CommunityChat] Using HOOK socket:', hookSocket.id)
        setSocket(hookSocket)
        setConnected(true)
        setLoading(false)
      } else if (!hookSocket) {
        // // console.log('[CommunityChat] No hook socket, connecting internally (admin mode)')
        hookConnect(activeToken)
      }
    }
  }, [parentSocket?.id, parentSocket?.connected, hookSocket?.id, hookConnected, activeToken])

  //Register all socket event listeners when socket connects
  useEffect(() => {
    if (!socket || !connected) {
      // // console.log('[CommunityChat] Waiting for socket connection...')
      return
    }

    // // console.log('[CommunityChat] Socket connected:', socket.id, 'for user:', user?.displayName, 'isAdmin:', isAdmin, 'socket.connected:', socket.connected)
    console.log('[CommunityChat] [OK] Socket connected:', socket.id, 'User:', user?.displayName, 'Admin:', isAdmin)
    setLoading(false)
    setError('')

    //Named handler functions for precise cleanup (avoids removing other components' handlers)

    const handleMessage = (msg: ChatMsg) => {
      console.log('[CommunityChat] Message received:', msg.sender_name, 'ID:', msg.id)
      setMessages((prev: ChatMsg[]) => {
        //If message has tempId and sender is current user, replace optimistic message
        if (msg.sender_id === userRef.current?.id) {
          const optimisticIdx = prev.findIndex(
            (m: ChatMsg) => m.id.startsWith('tmp-') && m.sender_id === msg.sender_id
          )
          if (optimisticIdx !== -1) {
            // // console.log('[CommunityChat] Replacing optimistic message at index:', optimisticIdx)
            const updated = [...prev]
            updated[optimisticIdx] = msg
            return updated
          }
        }
        //Skip if message already exists
        if (prev.some((m: ChatMsg) => m.id === msg.id)) {
          console.log('[CommunityChat] Duplicate message, skipping')
          return prev
        }
        console.log('[CommunityChat] Adding new message, total:', prev.length + 1)
        return [...prev, msg]
      })
      //Mark new messages as read if not from current user
      if (msg.sender_id !== userRef.current?.id) {
        setTimeout(() => markMessagesAsRead([msg]), 100)
      }
      if (isAtBottomRef.current) {
        setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
      } else {
        setShowScrollDown(true)
      }
    }

    const handleDeleted = (data: { messageId: string; deletedBy?: string; deletedByName?: string; reason?: string; originalSenderName?: string }) => {
      setMessages((prev: ChatMsg[]) => prev.map((m: ChatMsg) => {
        if (m.id !== data.messageId) return m
        return {
          ...m,
          sender_id: 'deleted',
          content: '',
          image_url: null,
          deleted_at: new Date().toISOString(),
          deleted_by: data.deletedBy || null,
          deleted_by_name: data.deletedByName || null,
          delete_reason: data.reason || null,
        }
      }))
    }

    const handleEdited = (data: { messageId: string; content: string; edited_at: string }) => {
      setMessages((prev: ChatMsg[]) => prev.map((m: ChatMsg) =>
        m.id === data.messageId ? { ...m, content: data.content, edited_at: data.edited_at } : m
      ))
    }

    const handleUserJoined = (u: OnlineUser) => {
      setOnlineUsers((prev: OnlineUser[]) => prev.some((p: OnlineUser) => p.userId === u.userId) ? prev : [...prev, u])
      //System message: user joined
      if (u.userId !== userRef.current?.id) {
        setMessages((prev: ChatMsg[]) => {
          //Dedup: skip if a join message for same user appeared in the last 5 seconds
          const recent = prev.filter(m => m.id.startsWith(`sys-join-${u.userId}`) && Date.now() - new Date(m.created_at).getTime() < 5000)
          if (recent.length > 0) return prev
          return [...prev, {
            id: `sys-join-${u.userId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            sender_id: 'system',
            sender_type: 'citizen' as const,
            sender_name: 'System',
            content: `${u.displayName || 'A user'} joined the chat`,
            created_at: new Date().toISOString(),
          }]
        })
      }
    }

    const handleUserLeft = ({ userId, displayName }: { userId: string; displayName?: string }) => {
      setOnlineUsers((prev: OnlineUser[]) => {
        const leftUser = prev.find((p: OnlineUser) => p.userId === userId)
        const name = displayName || leftUser?.displayName || 'A user'
        //System message: user left (outside the updater to avoid batching issues)
        if (userId !== userRef.current?.id) {
          setTimeout(() => {
            setMessages((prevMsgs: ChatMsg[]) => {
              //Dedup: skip if a leave message for same user appeared in the last 5 seconds
              const recent = prevMsgs.filter(m => m.id.startsWith(`sys-leave-${userId}`) && Date.now() - new Date(m.created_at).getTime() < 5000)
              if (recent.length > 0) return prevMsgs
              return [...prevMsgs, {
                id: `sys-leave-${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                sender_id: 'system',
                sender_type: 'citizen' as const,
                sender_name: 'System',
                content: `${name} left the chat`,
                created_at: new Date().toISOString(),
              }]
            })
          }, 0)
        }
        return prev.filter((p: OnlineUser) => p.userId !== userId)
      })
    }

    const handleOnlineUpdate = ({ users }: { users: OnlineUser[] }) => {
      console.log('[CommunityChat] Online users update:', users?.length || 0, 'users')
      setOnlineUsers(Array.isArray(users) ? users : [])
    }

    const handleTyping = (info: TypingInfo) => {
      if (info.userId === userRef.current?.id) return
      setTypingUsers((prev: TypingInfo[]) => prev.some((p: TypingInfo) => p.userId === info.userId) ? prev : [...prev, info])
      setTimeout(() => {
        setTypingUsers((prev: TypingInfo[]) => prev.filter((p: TypingInfo) => p.userId !== info.userId))
      }, 3000)
    }

    const handleStopTyping = ({ userId }: { userId: string }) => {
      setTypingUsers((prev: TypingInfo[]) => prev.filter((p: TypingInfo) => p.userId !== userId))
    }

    const handleMessagesRead = (data: { messages: Array<{ id: string; read_by: any[] }> }) => {
      if (!data.messages) return
      setMessages((prev: ChatMsg[]) => {
        const updated = [...prev]
        data.messages.forEach((readMsg) => {
          const idx = updated.findIndex((m) => m.id === readMsg.id)
          if (idx !== -1) {
            updated[idx] = { ...updated[idx], read_by: readMsg.read_by }
          }
        })
        return updated
      })
    }

    //Moderation: removed from chat (kick/ban)
    const handleRemoved = (data: { reason?: string }) => {
      // // console.log('[CommunityChat] Removed from chat:', data.reason)
      setJoined(false)
      hasJoinedRef.current = false
      setError(data.reason || 'You have been removed from the community chat.')
      if (data.reason?.toLowerCase().includes('ban')) {
        setIsBanned(true)
        setBanReason(data.reason)
        setIsMember(false)
      }
    }

    const handleMuted = (data: { expires_at?: string; reason?: string }) => {
      // // console.log('[CommunityChat] Muted:', data)
      setIsMuted(true)
      setMuteExpiresAt(data.expires_at || null)
    }

    const handleUnmuted = () => {
      // // console.log('[CommunityChat] Unmuted')
      setIsMuted(false)
      setMuteExpiresAt(null)
    }

    //Register all named event listeners
    socket.off('community:chat:message', handleMessage)
    socket.off('community:chat:deleted', handleDeleted)
    socket.off('community:chat:edited', handleEdited)
    socket.off('community:chat:user_joined', handleUserJoined)
    socket.off('community:chat:user_left', handleUserLeft)
    socket.off('community:chat:online_update', handleOnlineUpdate)
    socket.off('community:chat:typing', handleTyping)
    socket.off('community:chat:stop_typing', handleStopTyping)
    socket.off('community:chat:messages_read', handleMessagesRead)
    socket.off('community:removed', handleRemoved)
    socket.off('community:chat:muted', handleMuted)
    socket.off('community:chat:unmuted', handleUnmuted)

    socket.on('community:chat:message', handleMessage)
    socket.on('community:chat:deleted', handleDeleted)
    socket.on('community:chat:edited', handleEdited)
    socket.on('community:chat:user_joined', handleUserJoined)
    socket.on('community:chat:user_left', handleUserLeft)
    socket.on('community:chat:online_update', handleOnlineUpdate)
    socket.on('community:chat:typing', handleTyping)
    socket.on('community:chat:stop_typing', handleStopTyping)
    socket.on('community:chat:messages_read', handleMessagesRead)
    socket.on('community:removed', handleRemoved)
    socket.on('community:chat:muted', handleMuted)
    socket.on('community:chat:unmuted', handleUnmuted)

    //Join room (only once per connection)
    if (!hasJoinedRef.current) {
      console.log('[CommunityChat] EMITTING JOIN REQUEST, socket:', socket.id, 'connected:', socket.connected)
      socket.emit('community:chat:join', (ack: any) => {
        console.log('[CommunityChat] [OK] join ack received:', ack)
        if (ack?.success) {
          setJoined(true)
          hasJoinedRef.current = true
          console.log('[CommunityChat] Joined community-chat room, initial users:', ack.users?.length || 0)
          if (ack.users && Array.isArray(ack.users)) {
            setOnlineUsers(ack.users)
          }
          //Fetch any messages missed during disconnect/reconnect window
          fetchAndMergeMissedMessages()
        } else if (ack?.banned) {
          setIsBanned(true)
          setBanReason(ack.reason || 'You have been banned from community chat')
          setIsMember(false)
          console.log('[CommunityChat] ⛔ Banned from chat')
        } else {
          console.error('[CommunityChat] [ERR] join ack failed:', ack)
        }
      })

    }

    //Handle socket reconnection -- rejoin room and resync messages
    //Handle socket disconnect -- track state for admin socket
    const handleDisconnect = () => {
      console.log('[CommunityChat] [WARN] Socket disconnected')
      setConnected(false)
      setJoined(false)
      hasJoinedRef.current = false
    }
    socket.off('disconnect', handleDisconnect)
    socket.on('disconnect', handleDisconnect)

    const handleReconnect = () => {
      console.log('[CommunityChat] Socket reconnected, re-joining room and syncing messages')
      setConnected(true)
      hasJoinedRef.current = false
      socket.emit('community:chat:join', (ack: any) => {
        if (ack?.success) {
          console.log('[CommunityChat] [OK] Rejoined successfully')
          setJoined(true)
          hasJoinedRef.current = true
          if (ack.users && Array.isArray(ack.users)) {
            setOnlineUsers(ack.users)
          }
          fetchAndMergeMissedMessages()
        }
      })
    }
    socket.off('connect', handleReconnect)
    socket.on('connect', handleReconnect)

    //Periodic online user refresh + safety re-join if somehow not in room
    const onlineInterval = setInterval(() => {
      if (!socket.connected) return
      socket.emit('community:chat:online', (ack: any) => {
        if (ack?.success && Array.isArray(ack.users)) {
          setOnlineUsers(ack.users)
          //Safety check: if we think we joined but we're not in the online list, rejoin
          if (hasJoinedRef.current && ack.users.length > 0) {
            const isInList = ack.users.some((u: any) => u.userId === userRef.current?.id)
            if (!isInList) {
              console.log('[CommunityChat] [WARN] Not in online list despite joined -- re-joining room')
              hasJoinedRef.current = false
              socket.emit('community:chat:join', (joinAck: any) => {
                if (joinAck?.success) {
                  console.log('[CommunityChat] [OK] Re-joined successfully')
                  hasJoinedRef.current = true
                  setJoined(true)
                  if (joinAck.users) setOnlineUsers(joinAck.users)
                }
              })
            }
          }
        }
      })
    }, 5000)

    //Cleanup on unmount or reconnect
    //Use deferred leave to avoid React StrictMode double-mount breaking room membership
    isMountedRef.current = true

    return () => {
      clearInterval(onlineInterval)
      isMountedRef.current = false
      //Deferred leave -- if component re-mounts quickly (StrictMode), cancel the leave
      setTimeout(() => {
        if (!isMountedRef.current) {
          socket.emit('community:chat:leave')
        }
      }, 500)
      //Use socket.off with specific handler references -- NEVER use removeListener('connect')
      //which would remove useSocket's internal connect handler too
      socket.off('community:chat:message', handleMessage)
      socket.off('community:chat:deleted', handleDeleted)
      socket.off('community:chat:edited', handleEdited)
      socket.off('community:chat:user_joined', handleUserJoined)
      socket.off('community:chat:user_left', handleUserLeft)
      socket.off('community:chat:online_update', handleOnlineUpdate)
      socket.off('community:chat:typing', handleTyping)
      socket.off('community:chat:stop_typing', handleStopTyping)
      socket.off('community:chat:messages_read', handleMessagesRead)
      socket.off('community:removed', handleRemoved)
      socket.off('community:chat:muted', handleMuted)
      socket.off('community:chat:unmuted', handleUnmuted)
      socket.off('connect', handleReconnect)
      socket.off('disconnect', handleDisconnect)
      hasJoinedRef.current = false
      setJoined(false)
    }
  }, [socket?.id, connected, fetchAndMergeMissedMessages]) // Added connected as dependency

  //Mark messages as read once socket is connected and messages are loaded (ONCE)
  useEffect(() => {
    if (connected && socket && messages.length > 0 && !hasMarkedInitialMessagesRef.current) {
      hasMarkedInitialMessagesRef.current = true
      markMessagesAsRead(messages)
    }
  }, [connected, messages.length]) // Only watch connection and message count, not the function itself

  //Scroll to bottom on initial load -- use rAF + timeout to ensure DOM is fully rendered
  const hasScrolledInitialRef = useRef(false)
  useEffect(() => {
    if (!loading && messages.length > 0 && !hasScrolledInitialRef.current) {
      hasScrolledInitialRef.current = true
      //Double rAF ensures React has committed the DOM and the browser has painted
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const el = chatContainerRef.current
          if (el) {
            el.scrollTop = el.scrollHeight
          } else {
            messagesEndRef.current?.scrollIntoView()
          }
        })
      })
    }
  }, [loading, messages.length])

  //Track scroll position
  const handleScroll = useCallback(() => {
    const el = chatContainerRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    isAtBottomRef.current = atBottom
    if (atBottom) setShowScrollDown(false)
  }, [])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    setShowScrollDown(false)
  }

  const openProfile = useCallback(async (msg: ChatMsg) => {
    // // console.log('[Profile] Opening profile for:', msg.sender_name, msg.sender_id, msg.sender_type)
    // // console.log('[Profile] activeToken:', !!activeToken)
    
    setProfileView({
      userId: msg.sender_id,
      name: msg.sender_name || 'Anonymous',
      role: msg.sender_type === 'citizen' ? 'Citizen' : (msg.sender_role || 'Ops'),
      type: msg.sender_type,
      joinedAt: null,
      status: null,
      loading: true,
    })

    try {
      if (!activeToken) {
        console.error('[Profile] No activeToken available')
        setProfileView((prev) => prev ? { ...prev, loading: false } : prev)
        return
      }

      const url = `/api/community/chat/profile/${msg.sender_type}/${msg.sender_id}`
      // // console.log('[Profile] Fetching:', url)
      
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${activeToken}` }
      })
      // // console.log('[Profile] Response:', res.status, res.ok)
      
      if (!res.ok) {
        const errText = await res.text()
        console.error('[Profile] Error response:', res.status, errText)
        setProfileView((prev) => prev ? { ...prev, loading: false } : prev)
        return
      }

      const data = await res.json()
      // // console.log('[Profile] Data received:', data)
      
      setProfileView((prev) => prev ? {
        ...prev,
        name: data?.name || prev.name,
        role: data?.role || prev.role,
        joinedAt: data?.joined_at || null,
        status: data?.status || null,
        profilePhoto: data?.profile_photo || null,
        bio: data?.bio || null,
        messageCount: data?.message_count ?? 0,
        loading: false,
      } : prev)
    } catch (err) {
      console.error('[Profile] Fetch error:', err)
      setProfileView((prev) => prev ? { ...prev, loading: false } : prev)
    }
  }, [activeToken])

  //Image Upload
  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      alert('Only image files are supported')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      alert('Image must be less than 10MB')
      return
    }
    setImageFile(file)
    const reader = new FileReader()
    reader.onload = (ev) => setImagePreview(ev.target?.result as string)
    reader.readAsDataURL(file)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const clearImage = () => {
    setImageFile(null)
    setImagePreview(null)
  }

  const uploadImage = async (): Promise<string | null> => {
    if (!imageFile) return null
    setUploading(true)
    try {
      const token = activeToken
      const formData = new FormData()
      formData.append('image', imageFile)
      const csrfToken = document.cookie.split('; ').find(c => c.startsWith('aegis_csrf='))?.split('=')[1]
      const res = await fetch(`${API_BASE}/api/community/chat/upload`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        },
        body: formData,
      })
      const data = await res.json()
      if (data.success && data.image_url) {
        return data.image_url
      } else {
        console.error('[CommunityChat] Upload failed:', data.error)
        return null
      }
    } catch (err) {
      console.error('[CommunityChat] Upload error:', err)
      return null
    } finally {
      setUploading(false)
    }
  }

  //Reply
  const handleReply = (msg: ChatMsg) => {
    setReplyTo(msg)
    textareaRef.current?.focus()
  }

  const clearReply = () => setReplyTo(null)

  //Emoji
  const handleEmojiSelect = (emoji: string) => {
    setMsgInput((prev: string) => prev + emoji)
    setShowEmoji(false)
    textareaRef.current?.focus()
  }

  //Send Message (FIX #3a -- optimistic msg replaced via ack, no duplicate from broadcast)
  const handleSend = async () => {
    const content = msgInput.trim()
    if (!content && !imageFile) return
    if (!socket) return
    if (isMuted) return // Don't allow sending while muted

    let imageUrl: string | null = null
    if (imageFile) {
      imageUrl = await uploadImage()
      if (!imageUrl && !content) return
    }

    const optimisticMsg: ChatMsg = {
      id: `tmp-${Date.now()}`,
      sender_id: user?.id || '',
      sender_type: isAdmin ? 'operator' : 'citizen',
      sender_name: user?.displayName || user?.display_name || 'You',
      sender_role: isAdmin ? userRole : null,
      content: content || '',
      image_url: imageUrl,
      reply_to_id: replyTo?.id || null,
      reply_content: replyTo?.content || null,
      reply_sender_name: replyTo?.sender_name || null,
      created_at: new Date().toISOString(),
    }
    // // console.log('[CommunityChat] Sending message:', optimisticMsg.sender_name, 'id:', optimisticMsg.id)
    setMessages((prev: ChatMsg[]) => [...prev, optimisticMsg])
    setMsgInput('')
    clearImage()
    clearReply()
    setShowEmoji(false)
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)

    if (!socket || !socket.connected) {
      console.error('[CommunityChat] Socket not connected! socket:', !!socket, 'connected:', socket?.connected)
      setMessages((prev: ChatMsg[]) => prev.filter((m: ChatMsg) => m.id !== optimisticMsg.id))
      setError('Socket disconnected. Please refresh.')
      return
    }

    // // console.log('[CommunityChat] Emitting send event, socket id:', socket?.id, 'connected:', socket?.connected)
    socket.emit('community:chat:send', {
      content: content || '',
      image_url: imageUrl,
      reply_to_id: replyTo?.id || null,
    }, (ack: any) => {
      // // console.log('[CommunityChat] ACK callback fired with:', ack)
      // // console.log('[CommunityChat] Send acknowledgment received:', ack?.success, 'has message:', !!ack?.message)
      if (ack?.success && ack?.message) {
        // // console.log('[CommunityChat] Replacing optimistic message, new id:', ack.message.id)
        //Replace our optimistic message with the real one from the server
        setMessages((prev: ChatMsg[]) => prev.map((m: ChatMsg) => m.id === optimisticMsg.id ? ack.message : m))
      } else if (ack?.muted) {
        // // console.log('[CommunityChat] Message rejected -- muted until:', ack.expires_at)
        setMessages((prev: ChatMsg[]) => prev.filter((m: ChatMsg) => m.id !== optimisticMsg.id))
        setIsMuted(true)
        setMuteExpiresAt(ack.expires_at || null)
      } else {
        console.error('[CommunityChat] Send failed, removing optimistic message')
        setMessages((prev: ChatMsg[]) => prev.filter((m: ChatMsg) => m.id !== optimisticMsg.id))
      }
    })

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
    socket.emit('community:chat:stop_typing')
  }

  const handleTypingInput = (value: string) => {
    setMsgInput(value)
    if (!socket) return
    socket.emit('community:chat:typing')
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
    typingTimeoutRef.current = setTimeout(() => {
      socket.emit('community:chat:stop_typing')
    }, 2000)
  }

  //FIX #3c: Confirm before delete -- admin gets reason field for audit
  const handleDeleteMessage = (messageId: string) => {
    if (messageId.startsWith('tmp-')) return
    //Find the message to check ownership
    const msg = messages.find(m => m.id === messageId)
    const isOwnMessage = msg?.sender_id === userId
    setDeleteTarget({ messageId, senderName: msg?.sender_name || 'Unknown', isOwnMessage })
    setDeleteReason('')
  }
  const confirmDelete = () => {
    if (!socket || !deleteTarget) return
    const payload: any = { messageId: deleteTarget.messageId }
    //Include reason for admin audit trail
    if (isAdmin && !deleteTarget.isOwnMessage && deleteReason.trim()) {
      payload.reason = deleteReason.trim()
    }
    socket.emit('community:chat:delete', payload, (ack: any) => {
      if (!ack?.success) console.error('[CommunityChat] Delete failed:', ack?.error)
    })
    setDeleteTarget(null)
    setDeleteReason('')
  }

  //FIX #3d: Edit message
  const startEdit = (msg: ChatMsg) => {
    setEditingMsg(msg)
    setEditContent(msg.content)
  }
  const cancelEdit = () => {
    setEditingMsg(null)
    setEditContent('')
  }
  const saveEdit = () => {
    if (!socket || !editingMsg || !editContent.trim()) return
    socket.emit('community:chat:edit', {
      messageId: editingMsg.id,
      content: editContent.trim(),
    }, (ack: any) => {
      if (ack?.success) {
        //Update locally immediately
        setMessages((prev: ChatMsg[]) => prev.map((m: ChatMsg) =>
          m.id === editingMsg.id ? { ...m, content: editContent.trim(), edited_at: new Date().toISOString() } : m
        ))
      } else {
        console.error('[CommunityChat] Edit failed:', ack?.error)
      }
    })
    cancelEdit()
  }

  //FIX #12: Translate message via MyMemory API
  const handleTranslate = async (msgId: string, text: string) => {
    //Toggle off if already translated
    if (translations[msgId]) {
      setTranslations(prev => {
        const next = { ...prev }
        delete next[msgId]
        return next
      })
      return
    }
    setTranslatingId(msgId)
    try {
      const { translatedText } = await translateText(text, 'auto', targetLang)
      if (translatedText && translatedText !== text) {
        setTranslations(prev => ({ ...prev, [msgId]: translatedText }))
      } else {
        //Same language -- show the original text (no translation needed)
        setTranslations(prev => ({ ...prev, [msgId]: ` ${text}` }))
      }
    } catch {
      //silently skip
    } finally {
      setTranslatingId(null)
    }
  }

  //Close lang picker on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (langPickerRef.current && !langPickerRef.current.contains(e.target as Node)) setShowLangPicker(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  //Auto-translate: when autoTranslate is on, translate all un-translated messages
  useEffect(() => {
    if (!autoTranslate) return
    const untranslated = [...messages, ...previewMessages].filter(
      (m) => m.content && !translations[m.id] && !m.id.startsWith('tmp-'),
    )
    if (untranslated.length === 0) return
    const batch = untranslated.slice(0, 10)
    let cancelled = false

    ;(async () => {
      try {
        const translatedByText = await buildTranslationMap(
          batch.map((msg) => msg.content),
          'auto',
          targetLang,
        )

        if (cancelled || Object.keys(translatedByText).length === 0) return

        setTranslations((prev) => {
          const next = { ...prev }
          batch.forEach((msg) => {
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
  }, [autoTranslate, targetLang, messages, previewMessages, translations])

  //Update autoTranslate when language changes
  useEffect(() => {
    setTargetLang(currentLang || 'en')
    setTranslations({})
    if (currentLang !== 'en') {
      setAutoTranslate(true)
    }
  }, [currentLang])

  //FIX #9: Report message
  const handleReport = (msg: ChatMsg) => {
    setReportTarget(msg)
  }
  const submitReport = (reason: string, details: string) => {
    if (!socket || !reportTarget) return
    socket.emit('community:chat:report', {
      messageId: reportTarget.id,
      reason,
      details,
    }, (ack: any) => {
      if (ack?.success) {
        // // console.log('[CommunityChat] Report submitted')
      } else {
        console.error('[CommunityChat] Report failed:', ack?.error)
      }
    })
    setReportTarget(null)
  }

  const handleRefresh = async () => {
    setLoading(true)
    //Primary: REST API (works regardless of socket state)
    try {
      const token = activeToken
      if (token) {
        const res = await fetch('/api/community/chat/messages?limit=50', {
          headers: { Authorization: `Bearer ${token}` }
        })
        if (res.ok) {
          const msgs = await res.json()
          if (Array.isArray(msgs)) {
            setMessages(msgs)
            setError('')
            setLoading(false)
            //Also refresh online users via socket if available
            if (socket?.connected) {
              socket.emit('community:chat:online', (ack: any) => {
                if (ack?.success) setOnlineUsers(ack.users || [])
              })
            }
            return
          }
        }
      }
    } catch (err) {
      console.error('[CommunityChat] REST refresh failed:', err)
    }
    //Fallback: socket-based history
    if (socket?.connected) {
      socket.emit('community:chat:history', { limit: 50 }, (ack: any) => {
        if (ack?.success) {
          setMessages(ack.messages || [])
          setError('')
        } else {
          setError(ack?.error || 'Failed to refresh chat history')
        }
        setLoading(false)
      })
      socket.emit('community:chat:online', (ack: any) => {
        if (ack?.success) setOnlineUsers(ack.users || [])
      })
    } else {
      setError('Not connected. Please wait and try again.')
      setLoading(false)
    }
  }

  const userId = user?.id || ''
  //Search-filtered messages
  const filteredMessages = useMemo(() => {
    if (!chatSearch.trim()) return messages
    const q = chatSearch.toLowerCase()
    return messages.filter(m =>
      m.content?.toLowerCase().includes(q) ||
      m.sender_name?.toLowerCase().includes(q)
    )
  }, [messages, chatSearch])
  const messageGroups = useMemo(() => groupByDate(filteredMessages), [filteredMessages])

  //Not signed in
  if (!user) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Shield className="w-12 h-12 text-gray-300 dark:text-gray-700 mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">{'Sign in Required'}</h3>
          <p className="text-xs text-gray-500 dark:text-gray-300">{'You must be signed in to access the community chat.'}</p>
        </div>
      </div>
    )
  }

  //Banned state
  if (isBanned) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center max-w-sm">
          <Ban className="w-12 h-12 text-red-400 mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-red-600 dark:text-red-400 mb-1">{'Banned from Community Chat'}</h3>
          <p className="text-xs text-gray-500 dark:text-gray-300">{banReason || 'You have been banned from the community chat. Contact an administrator for more information.'}</p>
        </div>
      </div>
    )
  }

  //Not a member -- show preview + join button
  if (isMember === false && !isAdmin) {
    return (
      <div className="max-w-5xl mx-auto">
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
          {/* Header */}
          <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 bg-gradient-to-r from-aegis-50 to-white dark:from-gray-900 dark:to-gray-900">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-aegis-100 dark:bg-aegis-950/30 flex items-center justify-center">
                <Hash className="w-5 h-5 text-aegis-600" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-gray-900 dark:text-white">{'Community Chat'}</h2>
                <p className="text-[11px] text-gray-500 dark:text-gray-300">{'Join the community to participate in discussions'}</p>
              </div>
            </div>
          </div>

          {/* Preview messages */}
          <div className="px-4 py-3 bg-gray-50 dark:bg-gray-950 max-h-64 overflow-y-auto relative">
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-gray-50 dark:to-gray-950 z-10 pointer-events-none" />
            {previewMessages.length > 0 ? (
              <div className="space-y-3 opacity-60 blur-[1px]">
                {previewMessages.map((msg: ChatMsg) => (
                  <div key={msg.id} className="flex items-start gap-2">
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-aegis-400 to-aegis-600 flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0">
                      {msg.sender_name?.charAt(0)?.toUpperCase() || '?'}
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold text-gray-700 dark:text-gray-300">{msg.sender_name}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-300">{(translations[msg.id] || msg.content)?.slice(0, 80) || '(image)'}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-400 dark:text-gray-300 text-center py-8">{'No preview available'}</p>
            )}
          </div>

          {/* Join CTA */}
          <div className="px-4 py-6 text-center border-t border-gray-100 dark:border-gray-800">
            <Users className="w-10 h-10 text-aegis-500 mx-auto mb-2" />
            <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-1">{'Join the Community'}</h3>
            <p className="text-xs text-gray-500 dark:text-gray-300 mb-4">{'Become a member to send messages, share images, and connect with other community members.'}</p>
            <button
              onClick={handleJoinCommunity}
              disabled={joiningCommunity}
              className="inline-flex items-center gap-2 px-6 py-2.5 bg-aegis-600 hover:bg-aegis-700 disabled:bg-gray-300 text-white rounded-lg font-medium transition shadow-sm"
            >
              {joiningCommunity ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
              {joiningCommunity ? 'Joining...' : 'Join Community'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  //Still loading membership
  if (isMember === null && !isAdmin) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-aegis-500 animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex h-[calc(100vh-160px)] md:h-[calc(100vh-120px)] max-w-5xl mx-auto gap-0">
      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-l-xl overflow-hidden shadow-xl">

        {/* Premium Header */}
        <div className="border-b border-gray-100 dark:border-gray-800 bg-gradient-to-r from-aegis-600 via-aegis-700 to-indigo-700 text-white">
          <div className="px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/15 backdrop-blur-sm flex items-center justify-center shadow-inner">
                <Hash className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-sm font-bold tracking-wide flex items-center gap-2">
                  {'Community Chat'}
                  {connected && joined && (
                    <span className="flex items-center gap-1 text-[10px] font-medium text-green-300 bg-green-500/20 px-2 py-0.5 rounded-full">
                      <Radio className="w-2.5 h-2.5 animate-pulse" /> {'Live'}
                    </span>
                  )}
                  {!connected && (
                    <span className="flex items-center gap-1 text-[10px] font-medium text-amber-300 bg-amber-500/20 px-2 py-0.5 rounded-full">
                      <AlertCircle className="w-2.5 h-2.5" /> {'Reconnecting...'}
                    </span>
                  )}
                </h2>
                <p className="text-[11px] text-white/60">{onlineUsers.length} {'members online - Open community discussion'}</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {/* Leave community button (citizens only) */}
              {!isAdmin && (
                <button
                  onClick={handleLeaveCommunity}
                  className="flex items-center gap-1.5 text-[10px] font-bold text-red-700 dark:text-red-200 hover:text-red-900 dark:hover:text-white bg-red-100 dark:bg-red-500/20 hover:bg-red-200 dark:hover:bg-red-500/30 px-2.5 py-1.5 rounded-lg transition border border-red-300 dark:border-red-400/20"
                  title={'Leave community'}
                >
                  <LogOut className="w-3 h-3" />
                  <span className="hidden sm:inline">{'Leave community'}</span>
                </button>
              )}
              {/* Translation controls */}
              <div className="flex items-center gap-1 bg-white/10 backdrop-blur-sm px-2 py-1.5 rounded-lg border border-white/10">
                <Languages className="w-3 h-3 text-blue-200" />
                <select
                  value={targetLang}
                  onChange={(e) => {
                    setTargetLang(e.target.value)
                    setTranslations({})
                    setAutoTranslate(true)
                  }}
                  className="text-[10px] bg-transparent text-white/90 outline-none cursor-pointer [&>option]:text-gray-900"
                  title={'Translate messages to'}
                >
                  {TRANSLATION_LANGUAGES.map(lang => (
                    <option key={lang.code} value={lang.code}>
                      {lang.name}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-1 text-[10px] text-white/60">
                  <input
                    type="checkbox"
                    checked={autoTranslate}
                    onChange={() => setAutoTranslate(!autoTranslate)}
                    className="w-3 h-3 rounded border-white/30"
                  />
                  {'Auto'}
                </label>
              </div>
              <button
                onClick={() => { setShowChatSearch(!showChatSearch); if (showChatSearch) setChatSearch('') }}
                className={`p-1.5 rounded-lg transition ${showChatSearch ? 'bg-white/20 text-white' : 'hover:bg-white/10'}`}
                title={'Search messages'}
              >
                <Search className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleRefresh}
                className="p-1.5 hover:bg-white/10 rounded-lg transition"
                title={'Refresh chat'}
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setShowOnlinePanel(!showOnlinePanel)}
                className={`flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1.5 rounded-lg transition ${
                  showOnlinePanel ? 'bg-white/20 dark:bg-white/20 text-gray-900 dark:text-white' : 'bg-gray-200/80 dark:bg-white/10 text-gray-700 dark:text-white/80 hover:bg-gray-300/80 dark:hover:bg-white/15'
                }`}
              >
                <Users className="w-3 h-3" />
                <span>{onlineUsers.length}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Search Bar -- slides in when active */}
        {showChatSearch && (
          <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 flex items-center gap-2">
            <Search className="w-4 h-4 text-gray-400 dark:text-gray-300 flex-shrink-0" />
            <input
              type="text"
              value={chatSearch}
              onChange={e => setChatSearch(e.target.value)}
              placeholder={'Search messages or usernames...'}
              autoFocus
              className="flex-1 text-sm bg-transparent border-none outline-none text-gray-900 dark:text-white placeholder:text-gray-400 dark:text-gray-300"
            />
            {chatSearch && (
              <span className="text-[10px] text-gray-400 dark:text-gray-300 flex-shrink-0">
                {filteredMessages.length} {t(filteredMessages.length === 1 ? 'communityChat.result' : 'common.results', currentLang)}
              </span>
            )}
            <button onClick={() => { setShowChatSearch(false); setChatSearch('') }} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition">
              <X className="w-3.5 h-3.5 text-gray-400 dark:text-gray-300" />
            </button>
          </div>
        )}

        {/* Messages Area */}
        <div
          ref={chatContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto px-4 py-3 space-y-1 bg-gradient-to-b from-gray-50/50 to-gray-100/30 dark:from-gray-950 dark:to-gray-950/80 relative"
        >
          {loading ? (
            <MessageSkeleton />
          ) : error ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-red-100 dark:bg-red-950/30 flex items-center justify-center">
                  <AlertCircle className="w-7 h-7 text-red-400" />
                </div>
                <p className="text-sm font-semibold text-red-500">{error}</p>
                <button onClick={() => window.location.reload()} className="mt-3 text-xs text-aegis-600 hover:underline font-medium bg-aegis-50 dark:bg-aegis-950/20 px-4 py-1.5 rounded-lg">
                  {'Retry Connection'}
                </button>
              </div>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="w-16 h-16 mx-auto mb-3 rounded-2xl bg-gradient-to-br from-aegis-100 to-aegis-200 dark:from-aegis-950/30 dark:to-aegis-900/20 flex items-center justify-center shadow-lg shadow-aegis-500/10">
                  <MessageSquare className="w-8 h-8 text-aegis-500" />
                </div>
                <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-1">{'No messages yet'}</h3>
                <p className="text-xs text-gray-500 dark:text-gray-300">{'Be the first to start the conversation!'}</p>
              </div>
            </div>
          ) : (
            <>
              {messageGroups.map((group: { date: string; msgs: ChatMsg[] }, gi: number) => (
                <React.Fragment key={gi}>
                  {/* Date separator */}
                  <div className="flex items-center gap-3 py-2">
                    <div className="flex-1 border-t border-gray-200 dark:border-gray-800" />
                    <span className="text-[10px] font-medium text-gray-400 dark:text-gray-300 uppercase tracking-wider px-2">
                      {dateLabel(group.date)}
                    </span>
                    <div className="flex-1 border-t border-gray-200 dark:border-gray-800" />
                  </div>

                  {group.msgs.map((msg: ChatMsg, mi: number) => {
                    //System messages (join/leave notifications)
                    if (msg.sender_id === 'system') {
                      return (
                        <div key={msg.id} className="flex justify-center my-1">
                          <span className="text-[10px] text-gray-400 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 px-3 py-1 rounded-full">
                            {msg.content}
                          </span>
                        </div>
                      )
                    }

                    //Deleted message tombstone -- shows notification instead of message content
                    if (msg.sender_id === 'deleted' || msg.deleted_at) {
                      return (
                        <div key={msg.id} className="flex justify-center my-2">
                          <div className="bg-red-50 dark:bg-red-950/20 border border-red-200/50 dark:border-red-800/30 rounded-xl px-4 py-2.5 max-w-md text-center">
                            <div className="flex items-center justify-center gap-1.5 mb-0.5">
                              <Trash2 className="w-3 h-3 text-red-400" />
                              <span className="text-[10px] font-bold text-red-500 dark:text-red-400 uppercase tracking-wider">{'Delete Message'}</span>
                            </div>
                            <p className="text-[11px] text-red-600/80 dark:text-red-400/70">
                              {msg.deleted_by_name
                                ? `${'This message was removed by'} ${msg.deleted_by_name}`
                                : 'This message was deleted'}
                              {msg.delete_reason ? ` - ${msg.delete_reason}` : msg.deleted_by_name ? ` - ${'Violated community policy'}` : ''}
                            </p>
                            {/* Admin-only audit detail */}
                            {isAdmin && msg.delete_reason && (
                              <div className="mt-1.5 pt-1.5 border-t border-red-200/30 dark:border-red-800/20">
                                <p className="text-[9px] text-red-400/70 dark:text-red-500/50 uppercase tracking-wider font-semibold">{'Audit'}</p>
                                <p className="text-[10px] text-red-500/60 dark:text-red-400/50">{'Reason'}: {msg.delete_reason}</p>
                                {msg.deleted_by_name && <p className="text-[10px] text-red-500/60 dark:text-red-400/50">{'By:'} {msg.deleted_by_name}</p>}
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    }

                    //Role-based layout: operators/staff on right, citizens on left
                    const isOperator = msg.sender_type === 'operator'
                    const isCitizen = msg.sender_type === 'citizen'
                    const isConsecutive = mi > 0 && group.msgs[mi - 1].sender_type === msg.sender_type && group.msgs[mi - 1].sender_id === msg.sender_id
                    const hasImage = !!msg.image_url
                    const hasReply = !!msg.reply_to_id && (msg.reply_content || msg.reply_sender_name)
                    const isEditing = editingMsg?.id === msg.id

                    return (
                      <div
                        key={msg.id}
                        className={`flex ${isOperator ? 'justify-end' : 'justify-start'} ${isConsecutive ? 'mt-0.5' : 'mt-3'} group/msg`}
                      >
                        {/* Avatar - clickable for profile */}
                        {isCitizen && !isConsecutive && (
                          <div
                            onClick={() => openProfile(msg)}
                            className="w-8 h-8 rounded-full bg-gradient-to-br from-aegis-400 to-aegis-600 flex items-center justify-center text-white text-[10px] font-bold mr-2 flex-shrink-0 mt-0.5 cursor-pointer hover:ring-2 hover:ring-aegis-400/50 transition"
                          >
                            {msg.sender_avatar ? (
                              <img src={`${API_BASE}${msg.sender_avatar}`} className="w-8 h-8 rounded-full object-cover" alt="" />
                            ) : (
                              msg.sender_name?.charAt(0)?.toUpperCase() || '?'
                            )}
                          </div>
                        )}
                        {isCitizen && isConsecutive && <div className="w-8 mr-2 flex-shrink-0" />}

                        <div className="max-w-[70%]">
                          {/* Sender name + role badge - CLICKABLE for profile view (only show for citizens on left) */}
                          {isCitizen && (
                            <div className="flex items-center gap-1.5 mb-1 ml-1">
                              <button
                                onClick={() => openProfile(msg)}
                                className="text-[11px] font-semibold text-gray-700 dark:text-gray-300 hover:text-aegis-600 dark:hover:text-aegis-400 transition-colors cursor-pointer"
                              >
                                {msg.sender_name || 'Anonymous'}
                              </button>
                              <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-950/30 dark:text-green-400">
                                {'Citizen'}
                              </span>
                            </div>
                          )}

                          {/* Operator/Staff header (right side) */}
                          {isOperator && (
                            <div className="flex items-center gap-1.5 mb-1 mr-1 justify-end">
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-aegis-100 text-aegis-700 dark:bg-aegis-950/30 dark:text-aegis-400">
                                {msg.sender_role || 'Ops'}
                              </span>
                              <button
                                onClick={() => openProfile(msg)}
                                className="text-[11px] font-semibold text-gray-700 dark:text-gray-300 hover:text-aegis-600 dark:hover:text-aegis-400 transition-colors cursor-pointer"
                              >
                                {msg.sender_name || 'Anonymous'}
                              </button>
                            </div>
                          )}

                          {/* Message bubble */}
                          <div
                            className={`relative rounded-2xl px-3.5 py-2 ${
                              isOperator
                                ? 'bg-gradient-to-br from-amber-50 to-white dark:from-amber-950/20 dark:to-gray-800 text-gray-900 dark:text-white border border-amber-200/50 dark:border-amber-800/30 rounded-bl-md'
                                : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white border border-gray-200 dark:border-gray-700 rounded-br-md'
                            }`}
                          >
                            {/* Reply quote */}
                            {hasReply && (
                              <div className={`mb-1.5 px-2.5 py-1.5 rounded-lg border-l-2 ${
                                isOperator
                                  ? 'bg-gray-100 dark:bg-gray-700/50 border-aegis-400'
                                  : 'bg-gray-100 dark:bg-gray-700/50 border-aegis-400'
                              }`}>
                                <p className={`text-[10px] font-semibold ${isOperator ? 'text-aegis-600 dark:text-aegis-400' : 'text-aegis-600 dark:text-aegis-400'}`}>
                                  <Reply className="w-3 h-3 inline mr-0.5" />
                                  {msg.reply_sender_name}
                                </p>
                                <p className={`text-[11px] truncate ${isOperator ? 'text-gray-500 dark:text-gray-300' : 'text-gray-500 dark:text-gray-300'}`}>
                                  {msg.reply_content || '(image)'}
                                </p>
                              </div>
                            )}

                            {/* Image */}
                            {hasImage && (
                              <div className="mb-1.5">
                                <img
                                  src={`${API_BASE}${msg.image_url}`}
                                  alt={'Post image'}
                                  className="rounded-lg max-w-full max-h-64 object-cover cursor-pointer hover:opacity-90 transition"
                                  onClick={() => setLightboxSrc(`${API_BASE}${msg.image_url}`)}
                                  loading="lazy"
                                />
                              </div>
                            )}

                            {/* Text content OR edit input */}
                            {isEditing ? (
                              <div className="space-y-2">
                                <textarea
                                  value={editContent}
                                  onChange={e => setEditContent(e.target.value)}
                                  className="w-full px-2 py-1 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg border border-gray-300 dark:border-gray-600 resize-none"
                                  rows={2}
                                  autoFocus
                                  onKeyDown={e => {
                                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit() }
                                    if (e.key === 'Escape') cancelEdit()
                                  }}
                                />
                                <div className="flex items-center gap-1.5 justify-end">
                                  <button onClick={cancelEdit} className="text-[10px] px-2 py-1 text-gray-500 dark:text-gray-300 hover:text-gray-700 dark:hover:text-gray-300 dark:text-gray-300 transition">{'Cancel'}</button>
                                  <button onClick={saveEdit} className="text-[10px] px-2 py-1 bg-aegis-600 hover:bg-aegis-700 text-white rounded transition flex items-center gap-0.5"><Check className="w-3 h-3" /> {'Save'}</button>
                                </div>
                              </div>
                            ) : (
                              <>
                                {msg.content && <RenderContent text={msg.content} isMine={isOperator} />}
                                {msg.edited_at && (
                                  <span className={`text-[9px] italic text-gray-400 dark:text-gray-300`}> ({'edited'})</span>
                                )}
                                {/* Translated text */}
                                {translations[msg.id] && (
                                  <div className="mt-1.5 pt-1.5 border-t border-gray-200/50 dark:border-gray-600/50">
                                    <p className="text-[10px] text-blue-500 dark:text-blue-400 font-semibold flex items-center gap-0.5 mb-0.5">
                                      <Languages className="w-3 h-3" /> {'Translated'}
                                    </p>
                                    <p className="text-sm text-gray-700 dark:text-gray-300">{translations[msg.id]}</p>
                                  </div>
                                )}
                              </>
                            )}

                            {/* Timestamp + actions */}
                            {!isEditing && (
                              <div className={`flex items-center gap-1.5 mt-0.5 justify-between`}>
                                <div className="flex items-center gap-1">
                                  <span className={`text-[10px] text-gray-400 dark:text-gray-300`}>
                                    {timeStr(msg.created_at)}
                                  </span>
                                  {/* Read receipt ticks (only for own messages) */}
                                  {msg.sender_id === userId && (
                                    <span className={`text-[10px] ${msg.read_by && msg.read_by.some((r: any) => r.user_id !== userId) ? 'text-blue-500' : 'text-gray-400 dark:text-gray-300'}`} title={msg.read_by && msg.read_by.some((r: any) => r.user_id !== userId) ? 'Read' : 'Sent'}>
                                      {msg.read_by && msg.read_by.some((r: any) => r.user_id !== userId) ? '' : ''}
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-0.5 opacity-0 group-hover/msg:opacity-100 transition">
                                  {!msg.id.startsWith('tmp-') && (
                                    <button
                                      onClick={() => handleReply(msg)}
                                      className={`text-[10px] flex items-center gap-0.5 p-0.5 rounded text-gray-400 dark:text-gray-300 hover:text-gray-600`}
                                      title={'Reply'}
                                    >
                                      <Reply className="w-3 h-3" />
                                    </button>
                                  )}
                                  {/* Edit button -- own messages only */}
                                  {msg.sender_id === userId && !msg.id.startsWith('tmp-') && (
                                    <button
                                      onClick={() => startEdit(msg)}
                                      className="text-[10px] flex items-center gap-0.5 p-0.5 rounded text-gray-400 dark:text-gray-300 hover:text-gray-600"
                                      title={'Edit'}
                                    >
                                      <Edit2 className="w-3 h-3" />
                                    </button>
                                  )}
                                  {/* Translate button -- always visible */}
                                  {msg.content && !msg.id.startsWith('tmp-') && (
                                    <button
                                      onClick={() => handleTranslate(msg.id, msg.content)}
                                      className={`text-[10px] flex items-center gap-0.5 px-1 py-0.5 rounded transition ${translations[msg.id] ? 'text-blue-500 bg-blue-50 dark:bg-blue-950/30' : translatingId === msg.id ? 'text-blue-400 animate-pulse' : 'text-gray-400 dark:text-gray-300 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/30'}`}
                                      title={translations[msg.id] ? 'Remove translation' : 'Translate'}
                                      disabled={translatingId === msg.id}
                                    >
                                      <Languages className="w-3 h-3" />
                                    </button>
                                  )}
                                  {/* Report button -- others' messages only */}
                                  {msg.sender_id !== userId && !msg.id.startsWith('tmp-') && (
                                    <button
                                      onClick={() => handleReport(msg)}
                                      className="text-[10px] flex items-center gap-0.5 p-0.5 rounded text-gray-400 dark:text-gray-300 hover:text-red-500"
                                      title={'Report'}
                                    >
                                      <Flag className="w-3 h-3" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            )}

                            {/* Delete button (FIX #3c -- now uses confirm dialog) */}
                            {(msg.sender_id === userId || isAdmin) && !msg.id.startsWith('tmp-') && !isEditing && (
                              <button
                                onClick={() => handleDeleteMessage(msg.id)}
                                className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center opacity-0 group-hover/msg:opacity-100 transition-all shadow-lg"
                                title={'Delete Message'}
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </React.Fragment>
              ))}

              {/* Typing indicator */}
              {typingUsers.length > 0 && (
                <div className="flex items-center gap-2 px-1 py-1">
                  <div className="flex gap-0.5">
                    <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                  <span className="text-[10px] text-gray-400 dark:text-gray-300">
                    {typingUsers.map((t: TypingInfo) => t.displayName).join(', ')} {t(typingUsers.length === 1 ? 'communityChat.typingSingular' : 'communityChat.typingPlural', currentLang)}
                  </span>
                </div>
              )}

              <div ref={messagesEndRef} />
            </>
          )}

          {/* Scroll to bottom button */}
          {showScrollDown && (
            <button
              onClick={scrollToBottom}
              className="sticky bottom-2 left-1/2 -translate-x-1/2 w-10 h-10 bg-aegis-600 hover:bg-aegis-700 text-white rounded-full shadow-xl flex items-center justify-center transition-all z-20"
            >
              <ArrowDown className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Reply Preview */}
        {replyTo && (
          <div className="px-4 py-2 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-100 dark:border-gray-800 flex items-center gap-2">
            <Reply className="w-4 h-4 text-aegis-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-semibold text-aegis-600 dark:text-aegis-400">{replyTo.sender_name}</p>
              <p className="text-[11px] text-gray-500 dark:text-gray-300 truncate">{replyTo.content || '(image)'}</p>
            </div>
            <button onClick={clearReply} className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition">
              <X className="w-3.5 h-3.5 text-gray-400 dark:text-gray-300" />
            </button>
          </div>
        )}

        {/* Image Preview */}
        {imagePreview && (
          <div className="px-4 py-2 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-100 dark:border-gray-800 flex items-center gap-3">
            <div className="relative">
              <img src={imagePreview} alt={'Image preview'} className="w-16 h-16 object-cover rounded-lg border border-gray-200 dark:border-gray-700" />
              <button
                onClick={clearImage}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center shadow"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">{imageFile?.name}</p>
              <p className="text-[10px] text-gray-400 dark:text-gray-300">{imageFile ? (imageFile.size / 1024).toFixed(0) + ' KB' : ''}</p>
            </div>
          </div>
        )}

        {/* Message Input -- Premium */}
        <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900">
          {isMuted ? (
            <div className="flex items-center gap-2.5 px-4 py-3 bg-red-50 dark:bg-red-950/20 rounded-xl border border-red-200 dark:border-red-800/30">
              <div className="w-8 h-8 rounded-lg bg-red-100 dark:bg-red-900/30 flex items-center justify-center flex-shrink-0">
                <VolumeX className="w-4 h-4 text-red-500" />
              </div>
              <div>
                <p className="text-xs font-semibold text-red-600 dark:text-red-400">{'You are muted'}</p>
                <p className="text-[10px] text-red-500/70">{muteExpiresAt ? `${'Expires:'} ${new Date(muteExpiresAt).toLocaleString()}` : 'Contact an admin for more information.'}</p>
              </div>
            </div>
          ) : (
          <>
          <div className="flex items-end gap-2 relative">
            {/* Emoji picker toggle */}
            <div className="relative">
              <button
                onClick={() => setShowEmoji(!showEmoji)}
                className={`p-2.5 rounded-xl transition ${
                  showEmoji
                    ? 'bg-aegis-100 dark:bg-aegis-950/30 text-aegis-600 shadow-sm'
                    : 'text-gray-400 dark:text-gray-300 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
                title={'Emoji'}
              >
                <Smile className="w-5 h-5" />
              </button>
              {showEmoji && (
                <EmojiPicker
                  onSelect={handleEmojiSelect}
                  onClose={() => setShowEmoji(false)}
                />
              )}
            </div>

            {/* Image upload button */}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="p-2.5 text-gray-400 dark:text-gray-300 hover:text-aegis-600 hover:bg-aegis-50 dark:hover:bg-aegis-950/10 rounded-xl transition"
              title={'Share image'}
            >
              <ImageIcon className="w-5 h-5" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageSelect}
              className="hidden"
            />

            {/* Text input */}
            <textarea
              ref={textareaRef}
              value={msgInput}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => handleTypingInput(e.target.value)}
              onKeyDown={(e: React.KeyboardEvent) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
              placeholder={replyTo ? `${'Reply to'} ${replyTo.sender_name}...` : 'Type a message...'}
              rows={1}
              className="flex-1 px-4 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 focus:border-transparent transition resize-none max-h-28 placeholder:text-gray-400 dark:text-gray-300"
            />

            {/* Send button */}
            <button
              onClick={handleSend}
              disabled={(!msgInput.trim() && !imageFile) || !connected || uploading}
              className="bg-gradient-to-r from-aegis-500 to-aegis-600 hover:from-aegis-600 hover:to-aegis-700 disabled:from-gray-300 disabled:to-gray-300 dark:disabled:from-gray-700 dark:disabled:to-gray-700 text-white p-2.5 rounded-xl transition flex-shrink-0 shadow-md shadow-aegis-500/20 disabled:shadow-none"
            >
              {uploading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>
          </div>
          {!connected && (
            <p className="text-[10px] text-amber-500 mt-1 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> {'Reconnecting...'}
            </p>
          )}
          <p className="text-[9px] text-gray-300 dark:text-gray-700 mt-1">
            {'Shift+Enter for new line'} - {'Image must be less than 10MB'}
          </p>
          </>
          )}
        </div>
      </div>

      {/* Right Panel: Online Users -- Premium Design */}
      <div className={`w-60 bg-white dark:bg-gray-900 border border-l-0 border-gray-200 dark:border-gray-800 rounded-r-xl flex-col shadow-xl ${showOnlinePanel ? 'hidden md:flex' : 'hidden lg:flex'}`}>
        <div className="p-3 border-b border-gray-100 dark:border-gray-800 bg-gradient-to-r from-aegis-50 to-white dark:from-gray-900 dark:to-gray-900">
          <h3 className="text-xs font-bold text-gray-700 dark:text-gray-300 flex items-center gap-1.5 uppercase tracking-wider">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            {'Online'} ({onlineUsers.length})
          </h3>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {onlineUsers.length === 0 ? (
            <div className="text-center py-6">
              <Users className="w-8 h-8 text-gray-200 dark:text-gray-700 mx-auto mb-2" />
              <p className="text-[11px] text-gray-400 dark:text-gray-300">{'No users online'}</p>
            </div>
          ) : (
            <>
              {/* Staff/Operators first */}
              {onlineUsers.filter((u: OnlineUser) => String(u.role).toLowerCase() !== 'citizen').length > 0 && (
                <div className="px-2 pt-2 pb-1">
                  <p className="text-[9px] font-bold text-aegis-500 uppercase tracking-wider flex items-center gap-1"><Shield className="w-2.5 h-2.5" /> {'Staff'}</p>
                </div>
              )}
              {onlineUsers.filter((u: OnlineUser) => String(u.role).toLowerCase() !== 'citizen').map((u: OnlineUser) => (
                <div key={u.userId} className="flex items-center gap-2 px-2.5 py-2 rounded-xl hover:bg-aegis-50 dark:hover:bg-aegis-950/20 transition group/user">
                  <div className="relative">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-aegis-400 to-aegis-600 flex items-center justify-center text-white text-[10px] font-bold shadow-sm">
                      {u.displayName?.charAt(0)?.toUpperCase() || '?'}
                    </div>
                    <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-white dark:border-gray-900" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-semibold text-gray-800 dark:text-gray-200 truncate">{u.displayName}</p>
                    <p className="text-[9px] font-bold text-aegis-600 dark:text-aegis-400">{u.role}</p>
                  </div>
                </div>
              ))}
              {/* Citizens */}
              {onlineUsers.filter((u: OnlineUser) => String(u.role).toLowerCase() === 'citizen').length > 0 && (
                <div className="px-2 pt-3 pb-1">
                  <p className="text-[9px] font-bold text-green-500 uppercase tracking-wider flex items-center gap-1"><UserCheck className="w-2.5 h-2.5" /> {'Members'}</p>
                </div>
              )}
              {onlineUsers.filter((u: OnlineUser) => String(u.role).toLowerCase() === 'citizen').map((u: OnlineUser) => (
                <div key={u.userId} className="flex items-center gap-2 px-2.5 py-2 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800/50 transition">
                  <div className="relative">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center text-white text-[10px] font-bold shadow-sm">
                      {u.displayName?.charAt(0)?.toUpperCase() || '?'}
                    </div>
                    <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-white dark:border-gray-900" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-medium text-gray-800 dark:text-gray-200 truncate">{u.displayName}</p>
                    <p className="text-[9px] font-bold text-green-600 dark:text-green-400">{'Citizen'}</p>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
        {/* Features & Guidelines */}
        <div className="p-3 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900">
          <h4 className="text-[9px] font-bold text-gray-500 dark:text-gray-300 uppercase tracking-wider mb-2">{'Chat Features'}</h4>
          <div className="grid grid-cols-2 gap-1">
            {[
              { icon: ImageIcon, label: 'Images' },
              { icon: Reply, label: 'Reply' },
              { icon: Edit2, label: 'Edit' },
              { icon: Flag, label: 'Report' },
              { icon: Smile, label: 'Emoji' },
              { icon: Languages, label: 'Translate' },
            ].map((f, i) => (
              <div key={i} className="flex items-center gap-1 text-[9px] text-gray-400 dark:text-gray-300 bg-white dark:bg-gray-800 px-2 py-1.5 rounded-lg">
                <f.icon className="w-2.5 h-2.5 text-aegis-500 flex-shrink-0" />
                <span>{f.label}</span>
              </div>
            ))}
          </div>
          <div className="mt-2.5 pt-2.5 border-t border-gray-100 dark:border-gray-700">
            <h4 className="text-[9px] font-bold text-gray-500 dark:text-gray-300 uppercase tracking-wider mb-1.5">{'Guidelines'}</h4>
            <ul className="space-y-1">
              {[
                { icon: UserCheck, text: 'Be respectful' },
                { icon: Shield, text: 'No personal info' },
                { icon: AlertCircle, text: 'Emergencies: call 999' },
              ].map((g, i) => (
                <li key={i} className="flex items-start gap-1 text-[9px] text-gray-400 dark:text-gray-300">
                  <g.icon className="w-2.5 h-2.5 mt-0.5 flex-shrink-0 text-gray-400 dark:text-gray-300" />
                  <span>{g.text}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Confirm Delete Dialog (FIX #3c) -- Admin gets audit reason field */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[90] flex items-center justify-center p-4" onClick={() => { setDeleteTarget(null); setDeleteReason('') }}>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-sm w-full p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-full bg-red-100 dark:bg-red-950/30 flex items-center justify-center">
                <Trash2 className="w-4 h-4 text-red-600" />
              </div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                  {isAdmin && !deleteTarget.isOwnMessage ? 'Moderate Message' : 'Delete Message'}
              </h3>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-3">
              {isAdmin && !deleteTarget.isOwnMessage
                ? `${'Delete message from'} ${deleteTarget.senderName}? ${'A notification will appear in the chat.'}`
                : 'Delete your message?'}
            </p>
            {/* Admin reason field for audit -- only shown when deleting someone else's message */}
            {isAdmin && !deleteTarget.isOwnMessage && (
              <div className="mb-4">
                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider mb-1.5">{'Reason for deletion (audit log)'}</label>
                <select
                  value={deleteReason}
                  onChange={e => setDeleteReason(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white mb-2 focus:ring-2 focus:ring-red-400 focus:border-transparent"
                >
                  <option value="">{'Select a reason...'}</option>
                  {DELETE_REASONS.map((reason) => (
                    <option key={reason.value} value={reason.value}>{t(reason.key, currentLang)}</option>
                  ))}
                </select>
                <input
                  type="text"
                  value={!DELETE_REASONS.map((reason) => reason.value).concat('').includes(deleteReason) ? deleteReason : ''}
                  onChange={e => setDeleteReason(e.target.value)}
                  placeholder={'Or type a custom reason...'}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-red-400 focus:border-transparent"
                />
              </div>
            )}
            <div className="flex justify-end gap-3">
              <button onClick={() => { setDeleteTarget(null); setDeleteReason('') }} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 dark:text-gray-300 dark:hover:text-gray-200 transition">{'Cancel'}</button>
              <button
                onClick={confirmDelete}
                disabled={isAdmin && !deleteTarget.isOwnMessage && !deleteReason.trim()}
                className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 disabled:bg-gray-300 disabled:dark:bg-gray-600 text-white rounded-lg transition font-medium"
              >
                {t(isAdmin && !deleteTarget.isOwnMessage ? 'communityChat.deleteAndNotify' : 'common.delete', currentLang)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Report Dialog (FIX #9) */}
      {reportTarget && (
        <ReportDialog
          onSubmit={submitReport}
          onCancel={() => setReportTarget(null)}
        />
      )}

      {/* Image Lightbox */}
      {lightboxSrc && <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}

      {/* User Profile Modal -- Premium */}
      {profileView && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999]" onClick={() => setProfileView(null)}>
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-800 max-w-md w-full mx-4 overflow-hidden" onClick={(e) => e.stopPropagation()}>
            {/* Profile Header Gradient */}
            <div className="h-20 bg-gradient-to-r from-aegis-500 via-aegis-600 to-indigo-600 relative">
              <button
                onClick={() => setProfileView(null)}
                className="absolute top-3 right-3 p-1.5 bg-black/20 hover:bg-black/30 text-white rounded-lg transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-6 pb-6">
              {/* Avatar overlapping the gradient */}
              <div className="-mt-10 mb-3 flex items-end gap-3">
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-aegis-400 to-aegis-600 flex items-center justify-center text-white text-2xl font-bold overflow-hidden border-4 border-white dark:border-gray-900 shadow-lg">
                  {profileView.profilePhoto ? (
                    <img src={`${API_BASE}${profileView.profilePhoto}`} className="w-20 h-20 rounded-2xl object-cover" alt="" />
                  ) : (
                    profileView.name?.charAt(0)?.toUpperCase() || '?'
                  )}
                </div>
                <div className="pb-1">
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white">{profileView.name}</h3>
                  {profileView.type === 'operator' ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-aegis-100 text-aegis-700 dark:bg-aegis-950/30 dark:text-aegis-400">
                      <Shield className="w-3 h-3" /> {profileView.role || 'Ops'}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-950/30 dark:text-green-400">
                      <UserCheck className="w-3 h-3" /> {'Citizen'}
                    </span>
                  )}
                </div>
              </div>
            
            <div className="space-y-3 border-t border-gray-200 dark:border-gray-800 pt-4">
              {profileView.bio && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider mb-1">{'Bio'}</p>
                  <p className="text-sm text-gray-900 dark:text-white">{profileView.bio}</p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider mb-1">{'Joined'}</p>
                  <p className="text-sm text-gray-900 dark:text-white">{profileView.joinedAt ? new Date(profileView.joinedAt).toLocaleDateString() : (profileView.loading ? 'Loading...' : 'N/A')}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider mb-1">{'Messages'}</p>
                  <p className="text-sm text-gray-900 dark:text-white">{profileView.loading ? 'Loading...' : (profileView.messageCount ?? 0)}</p>
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider mb-1">{'Status'}</p>
                <p className="text-sm text-gray-900 dark:text-white">{profileView.status || (profileView.loading ? 'Loading...' : 'Active')}</p>
              </div>
            </div>
            
            <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-800 space-y-2">
              {/* Admin/Operator moderation actions for citizens */}
              {isAdmin && profileView.type === 'citizen' && (
                <>
                  <button
                    onClick={() => {
                      if (window.confirm(`${'Remove from community chat'} ${profileView.name}?`)) {
                        socket?.emit('community:chat:remove_member', { memberId: profileView.userId, memberType: 'citizen' }, (ack: any) => {
                          if (ack?.success) {
                            setProfileView(null)
                            socket?.emit('community:chat:online', (ack2: any) => {
                              if (ack2?.success) setOnlineUsers(ack2.users || [])
                            })
                          }
                        })
                      }
                    }}
                    className="w-full px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg font-medium transition text-sm flex items-center justify-center gap-2"
                  >
                    <LogOut className="w-4 h-4" /> {'Remove from Chat'}
                  </button>
                  <button
                    onClick={() => setShowMuteModal({ userId: profileView.userId, name: profileView.name })}
                    className="w-full px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg font-medium transition text-sm flex items-center justify-center gap-2"
                  >
                    <VolumeX className="w-4 h-4" /> {'Mute User'}
                  </button>
                  <button
                    onClick={() => {
                      socket?.emit('community:chat:unmute_user', { userId: profileView.userId }, (ack: any) => {
                        if (ack?.success) alert(`${profileView.name} ${'has been unmuted.'}`)
                      })
                    }}
                    className="w-full px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition text-sm flex items-center justify-center gap-2"
                  >
                    <Volume2 className="w-4 h-4" /> {'Unmute User'}
                  </button>
                  <button
                    onClick={() => setShowBanModal({ userId: profileView.userId, name: profileView.name })}
                    className="w-full px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition text-sm flex items-center justify-center gap-2"
                  >
                    <Ban className="w-4 h-4" /> {'Ban User'}
                  </button>
                  <button
                    onClick={() => {
                      if (window.confirm(`${'Unban'} ${profileView.name}?`)) {
                        socket?.emit('community:chat:unban_user', { userId: profileView.userId }, (ack: any) => {
                          if (ack?.success) alert(`${profileView.name} ${'has been unbanned.'}`)
                        })
                      }
                    }}
                    className="w-full px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition text-sm flex items-center justify-center gap-2"
                  >
                    <UserCheck className="w-4 h-4" /> {'Unban User'}
                  </button>
                </>
              )}
              
              <button
                onClick={() => setProfileView(null)}
                className="w-full px-4 py-2 bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg font-medium transition"
              >
                {'Close'}
              </button>
            </div>
          </div>
          </div>
        </div>
      )}

      {/* Ban Modal with Duration Picker */}
      {showBanModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[10000]" onClick={() => setShowBanModal(null)}>
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-800 p-6 max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1 flex items-center gap-2">
              <Ban className="w-5 h-5 text-red-500" /> {'Ban User'} {showBanModal.name}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-300 mb-4">{'Select ban duration and reason.'}</p>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">{'Reason'}</label>
                <input
                  id="ban-reason"
                  type="text"
                  placeholder={'Reason for ban...'}
                  className="w-full mt-1 px-3 py-2 text-sm bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">{'Duration'}</label>
                <div className="grid grid-cols-3 gap-2 mt-1">
                  {BAN_DURATIONS.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => {
                        const reason = (document.getElementById('ban-reason') as HTMLInputElement)?.value || ''
                        socket?.emit('community:chat:ban_user', {
                          userId: showBanModal.userId,
                          reason: reason || 'Banned by admin',
                          duration: opt.value === 'permanent' ? undefined : opt.value,
                          permanent: opt.value === 'permanent',
                        }, (ack: any) => {
                          if (ack?.success) {
                            alert(`${showBanModal.name} ${'has been banned'} (${opt.value}).`)
                            setShowBanModal(null)
                            setProfileView(null)
                            socket?.emit('community:chat:online', (ack2: any) => {
                              if (ack2?.success) setOnlineUsers(ack2.users || [])
                            })
                          } else {
                            alert(ack?.error || 'Ban failed')
                          }
                        })
                      }}
                      className={`px-3 py-2 text-xs font-medium rounded-lg border transition ${
                        opt.value === 'permanent'
                          ? 'bg-red-600 hover:bg-red-700 text-white border-red-600'
                          : 'bg-white dark:bg-gray-800 hover:bg-red-50 dark:hover:bg-red-950/20 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-red-300'
                      }`}
                    >
                      {opt.value}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <button
              onClick={() => setShowBanModal(null)}
              className="w-full mt-4 px-4 py-2 bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg font-medium transition text-sm"
            >
              {'Cancel'}
            </button>
          </div>
        </div>
      )}

      {/* Mute Modal with Duration Picker */}
      {showMuteModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[10000]" onClick={() => setShowMuteModal(null)}>
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-800 p-6 max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1 flex items-center gap-2">
              <VolumeX className="w-5 h-5 text-yellow-500" /> {'Mute User'} {showMuteModal.name}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-300 mb-4">{'Select mute duration.'}</p>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">{'Reason'}</label>
                <input
                  id="mute-reason"
                  type="text"
                  placeholder={'Reason for muting...'}
                  className="w-full mt-1 px-3 py-2 text-sm bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">{'Duration'}</label>
                <div className="grid grid-cols-3 gap-2 mt-1">
                  {MUTE_DURATIONS.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => {
                        const reason = (document.getElementById('mute-reason') as HTMLInputElement)?.value || ''
                        socket?.emit('community:chat:mute_user', {
                          userId: showMuteModal.userId,
                          reason: reason || 'Muted by admin',
                          duration: opt.value,
                        }, (ack: any) => {
                          if (ack?.success) {
                            alert(`${showMuteModal.name} ${'has been muted'} (${opt.value}).`)
                            setShowMuteModal(null)
                            setProfileView(null)
                          } else {
                            alert(ack?.error || 'Mute failed')
                          }
                        })
                      }}
                      className="px-3 py-2 text-xs font-medium rounded-lg border transition bg-white dark:bg-gray-800 hover:bg-yellow-50 dark:hover:bg-yellow-950/20 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-yellow-300"
                    >
                      {opt.value}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <button
              onClick={() => setShowMuteModal(null)}
              className="w-full mt-4 px-4 py-2 bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg font-medium transition text-sm"
            >
              {'Cancel'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

