/*
 * FloatingChatWidget.tsx — Floating Chat Button + Mini Chat Window
 *
 * A persistent chat FAB that appears on citizen pages when authenticated.
 * Features:
 *   - Floating action button with unread badge
 *   - Expandable mini chat panel (bottom-right)
 *   - Thread list or active conversation
 *   - New thread creation
 *   - Real-time messaging via Socket.IO
 *   - Compact, mobile-friendly design
 *
 * NOTE: This widget is for CITIZENS to report issues to admin.
 *       Admin/operators should NOT see this widget.
 */

import { useState, useEffect, useRef, useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import {
  MessageSquare, X, Send, Plus, ArrowLeft, Loader2,
  AlertTriangle, Check, CheckCheck, ChevronDown
} from 'lucide-react'
import { useCitizenAuth } from '../contexts/CitizenAuthContext'
import { type ChatThread, type ChatMessage } from '../hooks/useSocket'
import { useSharedSocket } from '../contexts/SocketContext'
import { API_BASE, timeAgoCompact } from '../utils/helpers'
import { t } from '../utils/i18n'
import { useLanguage } from '../hooks/useLanguage'
import MessageStatusIcon from './ui/MessageStatusIcon'

// API_BASE imported from ../utils/helpers

const THREAD_CATEGORIES = [
  { value: 'general', labelKey: 'floatingChat.categories.general' },
  { value: 'emergency', labelKey: 'floatingChat.categories.emergency' },
  { value: 'report', labelKey: 'floatingChat.categories.report' },
  { value: 'feedback', labelKey: 'floatingChat.categories.feedback' },
  { value: 'account', labelKey: 'floatingChat.categories.account' },
]

// timeAgoCompact + MessageStatusIcon imported from shared modules

export default function FloatingChatWidget(): JSX.Element | null {
  const { user, token, isAuthenticated } = useCitizenAuth()
  const location = useLocation()
  const socket = useSharedSocket()
  const lang = useLanguage()

  const [isOpen, setIsOpen] = useState(false)
  const [view, setView] = useState<'threads' | 'chat' | 'new'>('threads')
  const [activeThread, setActiveThread] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [newSubject, setNewSubject] = useState('')
  const [newCategory, setNewCategory] = useState('general')
  const [newFirstMsg, setNewFirstMsg] = useState('')
  const [creating, setCreating] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Determine visibility early - BEFORE any effects
  const path = location.pathname
  const shouldHide = useMemo(() => {
    // Hide on admin pages
    if (path.startsWith('/admin')) return true
    // Hide on citizen dashboard (it has its own MessagesTab)
    if (path === '/citizen' || path === '/citizen/dashboard') return true
    // Hide on citizen login
    if (path === '/citizen/login') return true
    // Hide on landing page
    if (path === '/') return true
    // Only show if user is authenticated as a citizen
    if (!isAuthenticated || !user) return true
    return false
  }, [path, isAuthenticated, user])

  // Connect socket ONLY when visible and citizen token available
  useEffect(() => {
    if (shouldHide || !token) return
    if (!socket.connected) {
      socket.connect(token)
    }
    return () => {}
  }, [token, shouldHide])

  // Fetch threads on connect (only when visible)
  useEffect(() => {
    if (shouldHide) return
    if (socket.connected) {
      socket.fetchCitizenThreads()
    }
  }, [socket.connected, shouldHide])

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [socket.messages])

  // Return null early if should hide or not authenticated
  if (shouldHide) return null
  if (!isAuthenticated || !user) return null

  const totalUnread = socket.threads.reduce((a, t) => a + (t.citizen_unread || 0), 0)

  const openThread = (threadId: string) => {
    setActiveThread(threadId)
    setView('chat')
    socket.joinThread(threadId)
    socket.markRead(threadId, [])
  }

  const sendMsg = () => {
    if (!message.trim() || !activeThread) return
    socket.sendMessage(activeThread, message.trim())
    setMessage('')
  }

  const createThread = () => {
    if (!newSubject.trim() || !newFirstMsg.trim()) return
    setCreating(true)
    socket.createThread(newSubject.trim(), newCategory, newFirstMsg.trim())
    setTimeout(() => {
      setCreating(false)
      setView('threads')
      setNewSubject('')
      setNewCategory('general')
      setNewFirstMsg('')
    }, 500)
  }

  const currentThread = socket.threads.find(t => t.id === activeThread)

  return (
    <>
      {/* Floating Action Button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-aegis-600 hover:bg-aegis-700 text-white rounded-full shadow-2xl shadow-aegis-600/40 flex items-center justify-center transition-all hover:scale-105 active:scale-95"
        >
          <MessageSquare className="w-6 h-6" />
          {totalUnread > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] font-bold w-5 h-5 rounded-full flex items-center justify-center animate-bounce">
              {totalUnread > 9 ? '9+' : totalUnread}
            </span>
          )}
        </button>
      )}

      {/* Chat Panel */}
      {isOpen && (
        <div className="fixed bottom-6 right-6 z-50 w-[360px] max-w-[calc(100vw-2rem)] h-[500px] max-h-[calc(100vh-6rem)] bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden">
          {/* Panel Header */}
          <div className="bg-aegis-600 text-white px-4 py-3 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-2">
              {view === 'chat' && (
                <button onClick={() => { setView('threads'); setActiveThread(null) }} className="hover:bg-white/10 p-1 rounded-lg transition">
                  <ArrowLeft className="w-4 h-4" />
                </button>
              )}
              <MessageSquare className="w-5 h-5" />
              <span className="font-semibold text-sm">
                {view === 'threads'
                  ? t('floatingChat.messages', lang)
                  : view === 'new'
                    ? t('floatingChat.newConversation', lang)
                    : (currentThread?.subject || t('floatingChat.chat', lang))}
              </span>
            </div>
            <div className="flex items-center gap-1">
              {view === 'threads' && (
                <button onClick={() => setView('new')} className="hover:bg-white/10 p-1.5 rounded-lg transition" title={t('floatingChat.newMessage', lang)}>
                  <Plus className="w-4 h-4" />
                </button>
              )}
              <button onClick={() => setIsOpen(false)} className="hover:bg-white/10 p-1.5 rounded-lg transition" title={t('common.close', lang)}>
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Thread List View */}
          {view === 'threads' && (
            <div className="flex-1 overflow-y-auto">
              {socket.threads.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center px-6">
                  <MessageSquare className="w-10 h-10 text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-600 mb-3" />
                  <p className="text-sm font-medium text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300">{t('floatingChat.noConversations', lang)}</p>
                  <p className="text-xs text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 mt-1">{t('floatingChat.startConversation', lang)}</p>
                  <button onClick={() => setView('new')}
                    className="mt-4 bg-aegis-600 hover:bg-aegis-700 text-white text-xs font-semibold px-4 py-2 rounded-lg flex items-center gap-1.5 transition">
                    <Plus className="w-3.5 h-3.5" /> {t('floatingChat.newMessage', lang)}
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-gray-100 dark:divide-gray-800">
                  {socket.threads.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()).map(thread => (
                    <button key={thread.id} onClick={() => openThread(thread.id)}
                      className={`w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition ${thread.citizen_unread > 0 ? 'bg-aegis-50/50 dark:bg-aegis-950/20' : ''}`}>
                      <div className="flex items-center justify-between">
                        <p className={`text-sm truncate max-w-[200px] ${thread.citizen_unread > 0 ? 'font-bold text-gray-900 dark:text-white' : 'font-medium text-gray-700 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300'}`}>
                          {thread.subject}
                        </p>
                        <span className="text-[10px] text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 flex-shrink-0">{timeAgoCompact(thread.updated_at)}</span>
                      </div>
                      <div className="flex items-center justify-between mt-1">
                        <p className="text-[11px] text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 truncate max-w-[220px]">{thread.last_message || t('floatingChat.noMessages', lang)}</p>
                        {thread.citizen_unread > 0 && (
                          <span className="bg-aegis-600 text-white text-[9px] font-bold w-4.5 h-4.5 px-1.5 py-0.5 rounded-full flex-shrink-0">
                            {thread.citizen_unread}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        {thread.is_emergency && <span className="text-[9px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-medium">{t('common.emergency', lang).toUpperCase()}</span>}
                        <span className="text-[9px] text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 capitalize">{thread.category}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Chat View */}
          {view === 'chat' && activeThread && (
            <>
              {/* Messages area */}
              <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-gray-50 dark:bg-gray-950">
                {socket.messages.length === 0 && (
                  <div className="text-center text-xs text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 py-8">{t('floatingChat.noMessagesYet', lang)}</div>
                )}
                {socket.messages.map(msg => {
                  const isMine = msg.sender_type === 'citizen'
                  return (
                    <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[80%] px-3 py-2 rounded-2xl text-xs ${
                        isMine
                          ? 'bg-aegis-600 text-white rounded-br-md'
                          : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white border border-gray-100 dark:border-gray-700 rounded-bl-md'
                      }`}>
                        <p className="break-words">{msg.content}</p>
                        <div className={`flex items-center gap-1 mt-1 ${isMine ? 'justify-end' : 'justify-start'}`}>
                          <span className="text-[9px] opacity-60">{timeAgoCompact(msg.created_at)}</span>
                          {isMine && <MessageStatusIcon status={msg.status} size="sm" />}
                        </div>
                      </div>
                    </div>
                  )
                })}
                {socket.typingUsers.length > 0 && (
                  <div className="flex justify-start">
                    <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 px-3 py-2 rounded-2xl rounded-bl-md">
                      <div className="flex gap-1">
                        <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Input */}
              <div className="px-3 py-2 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 flex-shrink-0">
                <div className="flex items-center gap-2">
                  <input
                    value={message}
                    onChange={e => { setMessage(e.target.value); socket.startTyping(activeThread!) }}
                    onBlur={() => socket.stopTyping(activeThread!)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg() } }}
                    placeholder={t('floatingChat.typeMessage', lang)}
                    className="flex-1 text-xs bg-gray-50 dark:bg-gray-800 rounded-xl px-3 py-2 border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 focus:border-transparent transition"
                  />
                  <button onClick={sendMsg} disabled={!message.trim()}
                    className="w-8 h-8 flex items-center justify-center bg-aegis-600 hover:bg-aegis-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white rounded-xl transition">
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </>
          )}

          {/* New Thread View */}
          {view === 'new' && (
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              <div>
                <label className="block text-[10px] font-semibold text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 mb-1 uppercase tracking-wide">{t('floatingChat.subject', lang)}</label>
                <input value={newSubject} onChange={e => setNewSubject(e.target.value)}
                  className="w-full text-sm bg-gray-50 dark:bg-gray-800 rounded-xl px-3 py-2 border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 focus:border-transparent transition"
                  placeholder={t('floatingChat.subjectPlaceholder', lang)} />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 mb-1 uppercase tracking-wide">{t('common.category', lang)}</label>
                <select value={newCategory} onChange={e => setNewCategory(e.target.value)}
                  className="w-full text-sm bg-gray-50 dark:bg-gray-800 rounded-xl px-3 py-2 border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 focus:border-transparent transition appearance-none">
                  {THREAD_CATEGORIES.map(c => <option key={c.value} value={c.value}>{t(c.labelKey, lang)}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-500 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-400 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 mb-1 uppercase tracking-wide">{t('floatingChat.message', lang)}</label>
                <textarea value={newFirstMsg} onChange={e => setNewFirstMsg(e.target.value)}
                  className="w-full text-sm bg-gray-50 dark:bg-gray-800 rounded-xl px-3 py-2 border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-aegis-500 focus:border-transparent transition resize-none"
                  placeholder={t('floatingChat.messagePlaceholder', lang)}
                  rows={4} />
              </div>
              {newCategory === 'emergency' && (
                <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-xl p-3 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold text-red-700 dark:text-red-300">{t('floatingChat.emergencyThread', lang)}</p>
                    <p className="text-[10px] text-red-600 dark:text-red-400">{t('floatingChat.immediateAttention', lang)}</p>
                  </div>
                </div>
              )}
              <div className="flex gap-2 pt-1">
                <button onClick={() => { setView('threads'); setNewSubject(''); setNewFirstMsg(''); setNewCategory('general') }}
                  className="flex-1 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 dark:text-gray-300 py-2.5 rounded-xl text-xs font-semibold transition">
                  {t('common.cancel', lang)}
                </button>
                <button onClick={createThread} disabled={creating || !newSubject.trim() || !newFirstMsg.trim()}
                  className="flex-1 bg-aegis-600 hover:bg-aegis-700 disabled:bg-aegis-400 text-white py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition">
                  {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  {creating ? t('floatingChat.sending', lang) : t('common.send', lang)}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}




