import React, { useState, useEffect, useRef } from 'react'
import {
  MessageSquare, Plus, X, RefreshCw, Send, Camera, Loader2,
  ArrowLeft, Languages, Wifi, ChevronRight,
} from 'lucide-react'
import { getCitizenToken } from '../../contexts/CitizenAuthContext'
import type { ChatThread, ChatMessage } from '../../hooks/useSocket'
import { buildTranslationMap, clearTranslationCache, TRANSLATION_LANGUAGES } from '../../utils/translateService'
import { t, getLanguage } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'
import MessageStatusIcon from '../../components/ui/MessageStatusIcon'
import { timeAgo } from '../../utils/helpers'

const THREAD_CATEGORIES = [
  { value: 'general', labelKey: 'citizen.thread.generalInquiry' as const },
  { value: 'emergency', labelKey: 'citizen.thread.emergencyHelp' as const },
  { value: 'report', labelKey: 'citizen.thread.reportIssue' as const },
  { value: 'feedback', labelKey: 'citizen.thread.feedback' as const },
  { value: 'account', labelKey: 'citizen.thread.accountSupport' as const },
  { value: 'alert', labelKey: 'citizen.thread.alertFollowup' as const },
]

export default function MessagesTab({ socket, user }: { socket: any; user: any }) {
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
      const { translateText } = await import('../../utils/translateService')
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

  //Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  //Auto-translate messages when language is not English
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

  //Update autoTranslate when language changes
  useEffect(() => {
    setTargetLang(lang || 'en')
    setTranslations({})
    if (lang !== 'en') {
      setAutoTranslate(true)
    }
  }, [lang])

  //Close lang picker on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (langPickerRef.current && !langPickerRef.current.contains(e.target as Node)) setShowLangPicker(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  //Mark as read when viewing a thread
  useEffect(() => {
    if (activeThread) {
      markRead(activeThread.id, [])
    }
  }, [activeThread?.id, messages.length])

  //Proactively fetch conversations as soon as messaging socket is ready.
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

  //Auto-open the most recent thread once per connection so messages never appear blank on first load.
  useEffect(() => {
    if (!socket.connected || activeThread || threads.length === 0 || hasAutoBootstrappedRef.current) return
    const mostRecent = [...threads].sort((a: ChatThread, b: ChatThread) =>
      new Date((b as any).last_message_at || (b as any).updated_at || (b as any).created_at).getTime() -
      new Date((a as any).last_message_at || (a as any).updated_at || (a as any).created_at).getTime()
    )[0]
    if (!mostRecent) return
    hasAutoBootstrappedRef.current = true
    openThread(mostRecent, true)
  }, [socket.connected, threads, activeThread?.id])

  //If thread is active but messages were not hydrated yet, retry once via REST.
  useEffect(() => {
    if (!activeThread?.id || messages.length > 0) return
    const retry = setTimeout(() => loadThreadMessages(activeThread.id), 500)
    return () => clearTimeout(retry)
  }, [activeThread?.id, messages.length])

  const handleSelectThread = (thread: ChatThread) => {
    openThread(thread, true)
    
    //Also mark via REST to ensure server-side sync
    const token = getCitizenToken()
    if (token) {
      const csrfToken = document.cookie.split('; ').find(c => c.startsWith('aegis_csrf='))?.split('=')[1]
      fetch(`/api/citizen/threads/${thread.id}/read`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}`, ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) }
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
        const token = getCitizenToken()
        const csrfTok = document.cookie.split('; ').find(c => c.startsWith('aegis_csrf='))?.split('=')[1]
        const uploadRes = await fetch('/api/upload', {
          method: 'POST',
          body: formData,
          headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(csrfTok ? { 'X-CSRF-Token': csrfTok } : {}) },
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

  //Thread List View
  if (!activeThread) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">{'Messages'}</h2>
          <div className="flex items-center gap-2">
            {!socket.connected && (
              <span className="flex items-center gap-1.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 px-2.5 py-1.5 rounded-lg border border-amber-200 dark:border-amber-800/50">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                {'Connecting'}
              </span>
            )}
            {socket.connected && (
              <span className="flex items-center gap-1.5 text-[10px] font-semibold text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/30 px-2.5 py-1.5 rounded-lg border border-green-200 dark:border-green-800/50">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                {'Connected'}
              </span>
            )}
            <button onClick={handleRefresh} className="flex items-center gap-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 text-xs font-semibold px-3 py-2 rounded-lg transition">
              <RefreshCw className="w-3.5 h-3.5" /> {'Refresh'}
            </button>
            <button onClick={() => setShowNewThread(true)} className="flex items-center gap-1.5 bg-aegis-600 hover:bg-aegis-700 text-white text-xs font-semibold px-3 py-2 rounded-lg transition">
              <Plus className="w-3.5 h-3.5" /> {'New Thread'}
            </button>
          </div>
        </div>

        {/* New Thread Modal */}
        {showNewThread && (
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 mb-4 shadow-lg space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{'Start a New Conversation'}</h3>
              <button onClick={() => setShowNewThread(false)} className="text-gray-400 dark:text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{'Subject'}</label>
              <input
                value={newSubject}
                onChange={e => setNewSubject(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 transition"
                placeholder={'Subject of your inquiry'}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{'Category'}</label>
              <select value={newCategory} onChange={e => setNewCategory(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 transition appearance-none">
                {THREAD_CATEGORIES.map(c => <option key={c.value} value={c.value}>{t(c.labelKey, lang)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{'Message'}</label>
              <textarea
                value={newMessage}
                onChange={e => setNewMessage(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 transition resize-none"
                rows={3}
                placeholder={'Type your message...'}
              />
            </div>
            <div className="flex gap-2">
              <button onClick={handleCreateThread} disabled={!newSubject.trim() || !newMessage.trim() || creating}
                className="bg-aegis-600 hover:bg-aegis-700 disabled:bg-aegis-400 text-white text-xs font-semibold px-4 py-2 rounded-lg transition flex items-center gap-1.5">
                {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} {'Send'}
              </button>
              <button onClick={() => setShowNewThread(false)} className="text-gray-500 dark:text-gray-400 hover:text-gray-700 text-xs px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700">{'Cancel'}</button>
            </div>
          </div>
        )}

        {/* Thread List */}
        {!socket.connected ? (
          <div className="bg-white dark:bg-gray-900 border border-amber-200 dark:border-amber-800/50 rounded-xl p-12 text-center">
            <Wifi className="w-12 h-12 text-amber-400 mx-auto mb-3" />
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">{'Connecting to server'}</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">{'Please wait while we establish a secure connection...'}</p>
            <button onClick={handleRefresh} className="bg-amber-500 hover:bg-amber-400 text-white text-xs font-semibold px-4 py-2 rounded-lg transition flex items-center gap-1.5 mx-auto">
              <RefreshCw className="w-3.5 h-3.5" /> {'Retry connection'}
            </button>
          </div>
        ) : threads.length === 0 ? (
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-12 text-center">
            <MessageSquare className="w-12 h-12 text-gray-300 dark:text-gray-400 mx-auto mb-3" />
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">{'No conversations yet'}</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">{'Start a new conversation to get help from our team'}</p>
            <button onClick={() => setShowNewThread(true)} className="bg-aegis-600 hover:bg-aegis-700 text-white text-xs font-semibold px-4 py-2 rounded-lg transition">
              {'Start a Conversation'}
            </button>
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden">
            {threads.map((th: ChatThread) => (
              <button key={th.id} onClick={() => handleSelectThread(th)}
                className="w-full px-4 py-3.5 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition text-left">
                <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                  (th as any).is_emergency ? 'bg-red-500 animate-pulse' : (th as any).status === 'open' ? 'bg-green-500' : (th as any).status === 'in_progress' ? 'bg-blue-500' : (th as any).status === 'resolved' ? 'bg-purple-500' : 'bg-gray-300'
                }`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{(th as any).subject}</p>
                    {(th as any).is_emergency && <span className="text-[9px] bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300 px-1.5 py-0.5 rounded font-bold uppercase">{'Emergency'}</span>}
                  </div>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate mt-0.5">{(th as any).last_message || 'No messages yet'}</p>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  {(th as any).citizen_unread > 0 && (
                    <span className="bg-aegis-600 text-white text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded-full">{(th as any).citizen_unread}</span>
                  )}
                  <span className="text-[10px] text-gray-400 dark:text-gray-400">{(th as any).updated_at ? timeAgo((th as any).updated_at) : ''}</span>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-400 flex-shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  //Chat View (Active Thread)
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
              <span className="text-[9px] bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300 px-1.5 py-0.5 rounded font-bold uppercase flex-shrink-0">{'Emergency'}</span>
            )}
          </div>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            {activeThread.status === 'resolved' ? 'Resolved' : activeThread.assigned_operator_name ? `${'Assigned to'} ${activeThread.assigned_operator_name}` : 'Waiting for operator'}
          </p>
        </div>
        <div className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase flex-shrink-0 hidden sm:block ${
          activeThread.status === 'resolved' ? 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300' :
          activeThread.status === 'in_progress' ? 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300' :
          'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300'
        }`}>{activeThread.status === 'resolved' ? 'Resolved' : activeThread.status === 'in_progress' ? 'In Progress' : 'Open'}</div>
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
            title={'Translate messages to'}
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
            {'Auto'}
          </label>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-950 border-x border-gray-200 dark:border-gray-800 px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-center py-8 text-gray-400 dark:text-gray-400 text-sm">{'No messages yet'}</div>
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
                    <p className={`text-[9px] font-semibold ${isMine ? 'text-white/60' : 'text-blue-500'}`}>{'Translated'}</p>
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
                <span className="text-[10px] text-gray-400 dark:text-gray-400">{threadTypers[0].userName} {'is typing...'}</span>
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
              title={'Attach image'}
            >
              <Camera className="w-4 h-4" />
            </button>
            <textarea
              value={msgInput}
              onChange={e => handleTyping(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage() } }}
              placeholder={'Type a message...'}
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
          {'This conversation has been'} {activeThread.status}
        </div>
      )}
    </div>
  )
}
