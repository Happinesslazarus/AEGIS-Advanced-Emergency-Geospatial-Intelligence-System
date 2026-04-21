/**
 * Citizen messaging citizen component (public-facing UI element).
 *
 * - Rendered inside CitizenPage.tsx or CitizenDashboard.tsx */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import {
  MessageSquare, Send, Search, Plus, X, AlertTriangle, Clock, ChevronDown, Loader2,
  AlertCircle, ArrowLeft, Shield, Headphones, Inbox, RefreshCw,
  CheckCircle, Zap, Hash, Paperclip
} from 'lucide-react'
import { type ChatThread, type ChatMessage } from '../../hooks/useSocket'
import { useSharedSocket } from '../../contexts/SocketContext'
import { getSession } from '../../utils/auth'
import { getCitizenToken } from '../../contexts/CitizenAuthContext'
import { timeAgo } from '../../utils/helpers'
import MessageStatusIcon from '../ui/MessageStatusIcon'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'

// Helpers

function formatDateSeparator(dateStr: string, lang: string): string {
  const d = new Date(dateStr)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

function shouldShowDateSep(msgs: ChatMessage[], idx: number): boolean {
  if (idx === 0) return true
  const prev = new Date(msgs[idx - 1].created_at).toDateString()
  const curr = new Date(msgs[idx].created_at).toDateString()
  return prev !== curr
}

function isConsecutive(msgs: ChatMessage[], idx: number): boolean {
  if (idx === 0) return false
  const prev = msgs[idx - 1]
  const curr = msgs[idx]
  if (prev.sender_id !== curr.sender_id || prev.sender_type !== curr.sender_type) return false
  const gap = new Date(curr.created_at).getTime() - new Date(prev.created_at).getTime()
  return gap < 120000 // 2 min
}

function StatusBadge({ status, lang }: { status: string; lang: string }) {
  const map: Record<string, { bg: string; text: string }> = {
    open: { bg: 'bg-green-100 dark:bg-green-950/30', text: 'text-green-700 dark:text-green-300' },
    in_progress: { bg: 'bg-blue-100 dark:bg-blue-950/30', text: 'text-blue-700 dark:text-blue-300' },
    resolved: { bg: 'bg-purple-100 dark:bg-purple-950/30', text: 'text-purple-700 dark:text-purple-300' },
    closed: { bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-500 dark:text-gray-300' },
  }
  const s = map[status] || map.open
  return (
    <span className={`${s.bg} ${s.text} text-[9px] font-bold uppercase px-1.5 py-0.5 rounded`}>
      {status === 'open'
        ? 'Open'
        : status === 'in_progress'
          ? 'Active'
          : status === 'resolved'
            ? 'Resolved'
            : 'Closed'}
    </span>
  )
}

// Component

export default function CitizenMessaging(): JSX.Element {
  const lang = useLanguage()
  const socket = useSharedSocket()
  const user = getSession()
  const [searchTerm, setSearchTerm] = useState('')
  const [msgInput, setMsgInput] = useState('')
  const [selectedImage, setSelectedImage] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const [showNewThread, setShowNewThread] = useState(false)
  const [newSubject, setNewSubject] = useState('')
  const [newCategory, setNewCategory] = useState('general')
  const [newMessage, setNewMessage] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const hasAutoSelectedRef = useRef(false)

  const {
    threads, activeThread, messages, connected,
    connect, sendMessage, createThread, joinThread,
    fetchCitizenThreads,
    loadThreadMessages, markRead, setActiveThread
  } = socket

  //Connect on mount; also reconnect if the socket drops and comes back up
  useEffect(() => {
    const token = getCitizenToken() || localStorage.getItem('token')
    if (token && !connected) connect(token)
  }, [connected, connect])

  //Fetch threads once connected
  useEffect(() => {
    if (connected) fetchCitizenThreads()
  }, [connected, fetchCitizenThreads])

  //Auto-restore last thread
  useEffect(() => {
    if (!connected || threads.length === 0 || hasAutoSelectedRef.current) return
    const storedId = sessionStorage.getItem('aegis-active-thread-id')
    let sel: ChatThread | undefined
    if (storedId) {
      sel = threads.find(t => t.id === storedId)
      sessionStorage.removeItem('aegis-active-thread-id')
    }
    if (!sel) {
      sel = [...threads].sort((a, b) =>
        new Date(b.last_message_at || b.created_at).getTime() - new Date(a.last_message_at || a.created_at).getTime()
      )[0]
    }
    if (sel) {
      handleSelectThread(sel)
      hasAutoSelectedRef.current = true
    }
  }, [connected, threads])

  //Persist active thread
  useEffect(() => {
    if (activeThread) sessionStorage.setItem('aegis-active-thread-id', activeThread.id)
  }, [activeThread])

  //Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  //Scroll-to-bottom button visibility
  const handleScroll = useCallback(() => {
    const el = messagesContainerRef.current
    if (!el) return
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    setShowScrollBtn(distFromBottom > 200)
  }, [])

  //Mark incoming operator messages as read
  useEffect(() => {
    if (activeThread && messages.length > 0) {
      const unreadIds = messages
        .filter(m => m.status !== 'read' && m.sender_type === 'operator')
        .map(m => m.id)
      if (unreadIds.length > 0) markRead(activeThread.id, unreadIds)
    }
  }, [activeThread, messages, markRead])

  //Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px'
    }
  }, [msgInput])

  //Sorted + filtered threads
  const filteredThreads = useMemo(() => {
    let list = [...threads]
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase()
      list = list.filter(t =>
        t.subject?.toLowerCase().includes(q) ||
        t.last_message?.toLowerCase().includes(q)
      )
    }
    list.sort((a, b) => {
      if (a.is_emergency && !b.is_emergency) return -1
      if (!a.is_emergency && b.is_emergency) return 1
      return new Date(b.last_message_at || 0).getTime() - new Date(a.last_message_at || 0).getTime()
    })
    return list
  }, [threads, searchTerm])

  const handleSelectThread = (thread: ChatThread) => {
    setActiveThread(thread)
    joinThread(thread.id)
    loadThreadMessages(thread.id)
  }

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) { setError('Select image file'); return }
    if (file.size > 5 * 1024 * 1024) { setError('Image must be under 5MB'); return }
    setSelectedImage(file)
    const reader = new FileReader()
    reader.onload = (evt) => setPreviewUrl(evt.target?.result as string)
    reader.readAsDataURL(file)
  }

  const handleSendMessage = async () => {
    if (!msgInput.trim() && !selectedImage) return
    if (!activeThread) return
    setIsLoading(true)
    setError('')
    try {
      if (selectedImage) {
        const formData = new FormData()
        formData.append('file', selectedImage)
        const csrfUpload = document.cookie.split('; ').find(c => c.startsWith('aegis_csrf='))?.split('=')[1]
        const uploadRes = await fetch('/api/upload', {
          method: 'POST',
          body: formData,
          headers: {
            Authorization: `Bearer ${getCitizenToken() || localStorage.getItem('token')}`,
            ...(csrfUpload ? { 'X-CSRF-Token': csrfUpload } : {}),
          }
        })
        if (!uploadRes.ok) throw new Error('Upload failed')
        const { url: imageUrl } = await uploadRes.json()
        const content = msgInput.trim() ? `${msgInput}\n[Image: ${imageUrl}]` : `[Image: ${imageUrl}]`
        sendMessage(activeThread.id, content)
      } else {
        sendMessage(activeThread.id, msgInput.trim())
      }
      setMsgInput('')
      setSelectedImage(null)
      setPreviewUrl('')
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (err: any) {
      setError(err.message || 'Send failed')
    } finally {
      setIsLoading(false)
    }
  }

  const handleCreateThread = () => {
    if (!newSubject.trim() || !newMessage.trim()) return
    createThread(newSubject.trim(), newCategory, newMessage.trim())
    setShowNewThread(false)
    setNewSubject('')
    setNewCategory('general')
    setNewMessage('')
  }

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const openCount = threads.filter(t => t.status === 'open').length
  const activeCount = threads.filter(t => t.status === 'in_progress').length
  const totalUnread = threads.reduce((s, t) => s + (t.citizen_unread || 0), 0)

  // SPLIT-PANEL LAYOUT

  return (
    <div className="flex h-[calc(100vh-180px)] bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-950 dark:to-gray-900 rounded-2xl overflow-hidden shadow-xl border border-gray-200/80 dark:border-gray-800/80">
      {/*  LEFT: Thread Inbox  */}
      <div className={`w-full md:w-[380px] flex flex-col bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 ${activeThread ? 'hidden md:flex' : 'flex'}`}>
        {/* Header */}
        <div className="p-4 bg-gradient-to-r from-aegis-600 via-aegis-700 to-aegis-800 text-white">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-white/15 backdrop-blur-sm flex items-center justify-center">
                <Inbox className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-sm font-bold tracking-wide">{'My Messages'}</h2>
                <p className="text-[10px] text-white/60">{threads.length} {t(threads.length === 1 ? 'common.conversation' : 'common.conversations', lang)}</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {connected && <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse ring-2 ring-green-400/30" title={'Live'} />}
              <button onClick={() => fetchCitizenThreads()} className="p-1.5 hover:bg-white/10 rounded-lg transition" title={'Refresh'}>
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Stats */}
          <div className="flex gap-1.5 flex-wrap">
            {totalUnread > 0 && (
              <span className="bg-red-500/30 backdrop-blur-sm text-white text-[10px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1 border border-red-400/30">
                <MessageSquare className="w-3 h-3" /> {totalUnread} {'unread'}
              </span>
            )}
            <span className="bg-white/10 backdrop-blur-sm text-white/90 text-[10px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
              <Hash className="w-3 h-3" /> {openCount} {'Open'}
            </span>
            <span className="bg-white/10 backdrop-blur-sm text-white/90 text-[10px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
              <Zap className="w-3 h-3" /> {activeCount} {'Active'}
            </span>
          </div>
        </div>

        {/* Search + New Button */}
        <div className="p-3 space-y-2.5 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-gray-400 dark:text-gray-300" />
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-8 py-2.5 text-xs bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 focus:border-transparent transition shadow-sm"
              placeholder={'Search conversations...'}
            />
            {searchTerm && (
              <button onClick={() => setSearchTerm('')} className="absolute right-3 top-2.5 text-gray-400 dark:text-gray-300 hover:text-gray-600">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <button
            onClick={() => setShowNewThread(true)}
            className="w-full py-2 bg-gradient-to-r from-aegis-500 to-aegis-600 hover:from-aegis-600 hover:to-aegis-700 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition shadow-md shadow-aegis-500/20"
          >
            <Plus className="w-3.5 h-3.5" /> {'New Conversation'}
          </button>
        </div>

        {/* New Thread Form */}
        {showNewThread && (
          <div className="p-3 border-b border-gray-200 dark:border-gray-800 bg-aegis-50/50 dark:bg-aegis-950/10 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-gray-700 dark:text-gray-200">{'New Conversation'}</span>
              <button onClick={() => setShowNewThread(false)} className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded">
                <X className="w-3.5 h-3.5 text-gray-400 dark:text-gray-300" />
              </button>
            </div>
            <div className="relative">
              <input
                value={newSubject}
                onChange={(e) => setNewSubject(e.target.value.slice(0, 120))}
                placeholder={'Subject (e.g. Emergency help needed)'}
                maxLength={120}
                className="w-full px-3 py-2 pr-16 text-xs bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500"
              />
              {newSubject.length > 80 && (
                <span className={`absolute right-2 top-1/2 -translate-y-1/2 text-[9px] font-medium ${newSubject.length > 110 ? 'text-red-500' : 'text-amber-500'}`}>{newSubject.length}/120</span>
              )}
            </div>
            <select
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500"
            >
              <option value="general">{'General Inquiry'}</option>
              <option value="emergency">{'Emergency'}</option>
              <option value="report">{'Report Issue'}</option>
              <option value="feedback">{'Feedback'}</option>
            </select>
            <div className="relative">
              <textarea
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value.slice(0, 500))}
                placeholder={'Describe your issue...'}
                rows={2}
                maxLength={500}
                className="w-full px-3 py-2 text-xs bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 resize-none"
              />
              {newMessage.length > 300 && (
                <span className={`absolute bottom-1.5 right-2 text-[9px] font-medium ${newMessage.length > 470 ? 'text-red-500' : 'text-amber-500'}`}>{newMessage.length}/500</span>
              )}
            </div>
            <button
              onClick={handleCreateThread}
              disabled={!newSubject.trim() || !newMessage.trim()}
              className="w-full py-2 bg-aegis-600 hover:bg-aegis-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white text-xs font-bold rounded-lg transition"
            >
              {'Send'}
            </button>
          </div>
        )}

        {/* Thread List */}
        <div className="flex-1 overflow-y-auto">
          {filteredThreads.length === 0 ? (
            <div className="p-10 text-center">
              <div className="w-16 h-16 mx-auto mb-3 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                <MessageSquare className="w-8 h-8 text-gray-300 dark:text-gray-600" />
              </div>
              <p className="text-sm font-semibold text-gray-500 dark:text-gray-300">
                {searchTerm ? 'No conversations found' : 'No conversations yet'}
              </p>
              <p className="text-[11px] text-gray-400 dark:text-gray-300 mt-0.5">
                {searchTerm ? 'Try a different search term' : 'Start a new conversation with our team'}
              </p>
            </div>
          ) : (
            filteredThreads.map((thread) => {
              const isActive = activeThread?.id === thread.id
              return (
                <button
                  key={thread.id}
                  onClick={() => handleSelectThread(thread)}
                  className={`w-full px-4 py-3.5 text-left transition-all relative group ${
                    isActive
                      ? 'bg-aegis-50 dark:bg-aegis-950/20'
                      : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                  } ${thread.is_emergency ? 'bg-red-50/40 dark:bg-red-950/10' : ''}`}
                >
                  {/* Active indicator bar */}
                  <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-r transition-all ${
                    isActive ? 'bg-aegis-500' :
                    thread.is_emergency ? 'bg-red-500' :
                    thread.status === 'open' ? 'bg-green-400' :
                    thread.status === 'in_progress' ? 'bg-blue-400' : 'bg-transparent'
                  }`} />

                  <div className="flex items-start gap-3 pl-1">
                    {/* Avatar */}
                    <div className={`relative w-10 h-10 rounded-xl flex items-center justify-center text-xs font-bold flex-shrink-0 shadow-sm ${
                      thread.is_emergency
                        ? 'bg-gradient-to-br from-red-400 to-red-600 text-white'
                        : 'bg-gradient-to-br from-aegis-400 to-aegis-600 text-white'
                    }`}>
                      <Headphones className="w-5 h-5" />
                      {thread.is_emergency && (
                        <div className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center animate-pulse">
                          <AlertTriangle className="w-2.5 h-2.5 text-white" />
                        </div>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="text-xs font-bold text-gray-900 dark:text-white truncate">{thread.subject}</span>
                      </div>
                      <p className="text-[10px] text-gray-400 dark:text-gray-300 truncate mt-0.5 leading-relaxed">
                      {thread.last_message || 'No messages yet'}
                      </p>
                    </div>

                    <div className="flex flex-col items-end gap-1.5 flex-shrink-0 pt-0.5">
                      <StatusBadge status={thread.status} lang={lang} />
                      {thread.citizen_unread > 0 && (
                        <span className="bg-red-500 text-white text-[9px] font-bold min-w-[18px] h-[18px] flex items-center justify-center rounded-full shadow-sm shadow-red-500/30 animate-pulse">
                          {thread.citizen_unread}
                        </span>
                      )}
                      <span className="text-[9px] text-gray-400 dark:text-gray-300 flex items-center gap-0.5">
                        <Clock className="w-2.5 h-2.5" />
                        {timeAgo(thread.last_message_at || thread.created_at)}
                      </span>
                    </div>
                  </div>
                </button>
              )
            })
          )}
        </div>

        {/* Connection footer */}
        <div className="p-2.5 border-t border-gray-200 dark:border-gray-800 flex items-center gap-2 text-[10px]">
          <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
          <span className="text-gray-500 dark:text-gray-300">
            {connected ? 'Live - Real-time updates active' : 'Reconnecting...'}
          </span>
        </div>
      </div>

      {/*  RIGHT: Chat Panel  */}
      <div className={`flex-1 flex flex-col bg-white dark:bg-gray-900 ${!activeThread ? 'hidden md:flex' : 'flex'}`}>
        {!activeThread ? (
          /* Empty State */
          <div className="flex-1 flex items-center justify-center text-center p-8 bg-gradient-to-br from-gray-50 to-white dark:from-gray-950 dark:to-gray-900">
            <div>
              <div className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-aegis-100 to-aegis-200 dark:from-aegis-950/30 dark:to-aegis-900/20 flex items-center justify-center shadow-lg shadow-aegis-500/10">
                <MessageSquare className="w-10 h-10 text-aegis-500" />
              </div>
              <h3 className="text-base font-bold text-gray-900 dark:text-white mb-1">{'My Messages'}</h3>
              <p className="text-xs text-gray-500 dark:text-gray-300 max-w-xs">
                {'Select a conversation from the inbox to view messages and communicate with our emergency response team.'}
              </p>
              <div className="mt-4 flex items-center justify-center gap-4 text-[10px] text-gray-400 dark:text-gray-300">
                <span className="flex items-center gap-1"><Shield className="w-3 h-3" /> {'End-to-end secure'}</span>
                <span className="flex items-center gap-1"><Zap className="w-3 h-3" /> {'Live'}</span>
                <span className="flex items-center gap-1"><Headphones className="w-3 h-3" /> {'24/7 Support'}</span>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Chat Header */}
            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center gap-3 bg-gradient-to-r from-white to-gray-50 dark:from-gray-900 dark:to-gray-900/80">
              <button onClick={() => setActiveThread(null)} className="md:hidden p-1.5 text-gray-400 dark:text-gray-300 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition">
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold flex-shrink-0 shadow-sm ${
                activeThread.is_emergency
                  ? 'bg-gradient-to-br from-red-400 to-red-600 text-white'
                  : 'bg-gradient-to-br from-aegis-400 to-aegis-600 text-white'
              }`}>
                <Headphones className="w-5 h-5" />
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
                <div className="flex items-center gap-2 text-[11px] text-gray-500 dark:text-gray-300">
                  <StatusBadge status={activeThread.status} lang={lang} />
                  <span className="text-gray-300 dark:text-gray-600">|</span>
                  <span>{activeThread.status === 'in_progress' ? 'Operator assigned' : 'Waiting for operator'}</span>
                </div>
              </div>
            </div>

            {/* Emergency Banner */}
            {activeThread.is_emergency && (
              <div className="bg-gradient-to-r from-red-50 to-red-100 dark:from-red-950/30 dark:to-red-950/10 border-b border-red-200 dark:border-red-800/50 px-4 py-2.5 flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-red-500/20 flex items-center justify-center">
                  <AlertTriangle className="w-4 h-4 text-red-600 animate-pulse" />
                </div>
                <div className="flex-1">
                  <span className="text-xs font-bold text-red-700 dark:text-red-300">{'EMERGENCY THREAD'}</span>
                  <span className="text-[10px] text-red-500 ml-2">{'This conversation has been flagged as urgent'}</span>
                </div>
              </div>
            )}

            {/* Messages Area */}
            <div
              ref={messagesContainerRef}
              onScroll={handleScroll}
              className="flex-1 overflow-y-auto p-4 space-y-1 bg-gradient-to-b from-gray-50/50 to-gray-100/30 dark:from-gray-950 dark:to-gray-950/80 relative"
            >
              {messages.length === 0 && (
                <div className="text-center py-12">
                  <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                    <MessageSquare className="w-7 h-7 text-gray-300 dark:text-gray-600" />
                  </div>
                  <p className="text-sm font-semibold text-gray-500 dark:text-gray-300">{'No messages yet'}</p>
                  <p className="text-[11px] text-gray-400 dark:text-gray-300 mt-0.5">{'Send a message to start the conversation'}</p>
                </div>
              )}

              {messages.map((msg, idx) => {
                const isMine = msg.sender_type === 'citizen' && msg.sender_id === user?.id
                const consecutive = isConsecutive(messages, idx)
                const showDate = shouldShowDateSep(messages, idx)
                const senderName = msg.sender_name || (msg.sender_type === 'operator' ? 'Support Agent' : 'You')

                return (
                  <React.Fragment key={msg.id}>
                    {/* Date Separator */}
                    {showDate && (
                      <div className="flex items-center justify-center py-3">
                        <div className="bg-white dark:bg-gray-800 text-[10px] font-bold text-gray-500 dark:text-gray-300 px-3 py-1 rounded-full shadow-sm border border-gray-200 dark:border-gray-700">
                          {formatDateSeparator(msg.created_at, lang)}
                        </div>
                      </div>
                    )}

                    <div className={`flex ${isMine ? 'justify-end' : 'justify-start'} ${consecutive ? '' : 'mt-3'} group`}>
                      <div className={`max-w-[75%]`}>
                        {/* Sender label (non-consecutive, from operator) */}
                        {!isMine && !consecutive && (
                          <div className="flex items-center gap-1.5 mb-1 ml-1">
                            <div className="w-6 h-6 rounded-lg flex items-center justify-center text-[9px] font-bold bg-aegis-100 dark:bg-aegis-900/30 text-aegis-700 dark:text-aegis-300">
                              <Shield className="w-3 h-3" />
                            </div>
                            <span className="text-[10px] font-semibold text-aegis-600 dark:text-aegis-400">
                              {senderName}
                            </span>
                            <span className="text-[8px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-aegis-100 text-aegis-700 dark:bg-aegis-900/30 dark:text-aegis-300">
                              {'Operator'}
                            </span>
                          </div>
                        )}

                        {/* Message Bubble */}
                        <div className={`rounded-2xl px-4 py-2.5 shadow-sm ${
                          isMine
                            ? 'bg-gradient-to-br from-aegis-500 to-aegis-600 text-white rounded-br-md'
                            : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white border border-gray-200 dark:border-gray-700 rounded-bl-md'
                        }`}>
                          {msg.content && <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{msg.content}</p>}
                          {msg.attachment_url && (
                            <img src={msg.attachment_url} alt="attachment" className="mt-2 max-w-full max-h-56 rounded-xl border border-white/20 object-contain" />
                          )}

                          {/* Timestamp + Status */}
                          <div className={`flex items-center gap-1.5 mt-1 ${isMine ? 'justify-end' : 'justify-start'}`}>
                            <span className={`text-[10px] ${isMine ? 'text-white/50' : 'text-gray-400 dark:text-gray-300'}`}>
                              {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                            {isMine && <MessageStatusIcon status={msg.status || 'sent'} />}
                          </div>
                        </div>
                      </div>
                    </div>
                  </React.Fragment>
                )
              })}
              <div ref={messagesEndRef} />

              {/* Scroll-to-bottom FAB */}
              {showScrollBtn && (
                <button
                  onClick={scrollToBottom}
                  className="sticky bottom-2 left-1/2 -translate-x-1/2 w-9 h-9 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-full shadow-lg flex items-center justify-center hover:bg-gray-50 dark:hover:bg-gray-700 transition z-10"
                >
                  <ChevronDown className="w-5 h-5 text-gray-500 dark:text-gray-300" />
                </button>
              )}
            </div>

            {/* Image Preview */}
            {previewUrl && (
              <div className="px-4 pt-2 border-t border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900">
                <div className="relative inline-block">
                  <img src={previewUrl} alt="Preview" className="h-20 w-auto rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm" />
                  <button
                    onClick={() => { setSelectedImage(null); setPreviewUrl(''); if (fileInputRef.current) fileInputRef.current.value = '' }}
                    className="absolute -top-2 -right-2 bg-red-500 hover:bg-red-600 text-white rounded-full p-1 shadow-sm transition"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              </div>
            )}

            {/* Input Section */}
            {activeThread.status !== 'resolved' && activeThread.status !== 'closed' ? (
              <div className="border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
                {error && (
                  <div className="mx-4 mt-2 p-2 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-xs rounded-lg flex items-center gap-2">
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                    {error}
                    <button onClick={() => setError('')} className="ml-auto">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )}
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageSelect} />
                <div className="flex items-end gap-2 p-3">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isLoading}
                    className="p-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-300 hover:text-aegis-600 hover:border-aegis-300 hover:bg-aegis-50 dark:hover:bg-aegis-950/10 transition"
                    title={'Attach image'}
                  >
                    <Paperclip className="w-4 h-4" />
                  </button>
                  <div className="flex-1 relative">
                    <textarea
                      ref={textareaRef}
                      value={msgInput}
                      onChange={(e) => setMsgInput(e.target.value.slice(0, 1000))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          handleSendMessage()
                        }
                      }}
                      placeholder={'Type a message...'}
                      disabled={isLoading}
                      rows={1}
                      maxLength={1000}
                      className={`w-full px-4 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border focus:ring-2 focus:border-transparent transition resize-none max-h-28 ${
                        msgInput.length > 900 ? 'border-amber-400 focus:ring-amber-500' : 'border-gray-200 dark:border-gray-700 focus:ring-aegis-500'
                      }`}
                    />
                    {msgInput.length > 800 && (
                      <span className={`absolute bottom-1.5 right-2 text-[10px] font-medium pointer-events-none transition-colors ${msgInput.length > 950 ? 'text-red-500' : 'text-amber-500'}`}>
                        {msgInput.length}/1000
                      </span>
                    )}
                  </div>
                  <button
                    onClick={handleSendMessage}
                    disabled={(!msgInput.trim() && !selectedImage) || isLoading}
                    className="bg-gradient-to-r from-aegis-500 to-aegis-600 hover:from-aegis-600 hover:to-aegis-700 disabled:from-gray-300 disabled:to-gray-300 dark:disabled:from-gray-700 dark:disabled:to-gray-700 text-white p-2.5 rounded-xl transition flex-shrink-0 shadow-md shadow-aegis-500/20 disabled:shadow-none"
                    title={'Send'}
                  >
                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            ) : (
              <div className="px-4 py-4 border-t border-gray-200 dark:border-gray-800 text-center bg-gray-50 dark:bg-gray-900">
                <div className="flex items-center justify-center gap-2 text-sm text-gray-400 dark:text-gray-300">
                  <CheckCircle className="w-4 h-4 text-green-400" />
                  {'This conversation has been'} <span className="font-semibold capitalize">{activeThread.status}</span>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

