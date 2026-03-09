/*
 * CitizenMessaging.tsx — Citizen-to-Admin Messaging
 * 
 * Allows citizens to:
 *   - See all conversations with admins
 *   - Send messages and attach photos
 *   - Receive real-time admin replies
 *   - Mark messages as read
 *   - See message delivery status
 */

import React, { useState, useEffect, useRef, useMemo } from 'react'
import {
  MessageSquare, Send, Search, Plus, X, AlertTriangle, Clock,
  User, ChevronLeft, Loader2, Check, CheckCheck, Image as ImageIcon,
  Phone, AlertCircle
} from 'lucide-react'
import { useSocket, ChatThread, ChatMessage } from '../../hooks/useSocket'
import { getSession } from '../../utils/auth'
import { timeAgo } from '../../utils/helpers'
import MessageStatusIcon from '../ui/MessageStatusIcon'

type View = 'list' | 'chat'

// timeAgo + MessageStatusIcon imported from shared utils/components

interface LocalMessage extends ChatMessage {
  imageUrl?: string
}

export default function CitizenMessaging(): JSX.Element {
  const socket = useSocket()
  const user = getSession()
  const [view, setView] = useState<View>('list')
  const [searchTerm, setSearchTerm] = useState('')
  const [msgInput, setMsgInput] = useState('')
  const [selectedImage, setSelectedImage] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string>('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string>('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const hasAutoSelectedRef = useRef(false)

  const {
    threads, activeThread, messages, connected,
    connect, sendMessage, createThread, joinThread,
    fetchCitizenThreads,
    loadThreadMessages, markRead, setActiveThread
  } = socket

  // Connect on mount
  useEffect(() => {
    const token = localStorage.getItem('aegis-citizen-token') || localStorage.getItem('token')
    if (token && !connected) {
      // // console.log('[CitizenMessaging] Connecting socket')
      connect(token)
    }
  }, [])

  // Always fetch citizen threads once connected (prevents blank list on first load)
  useEffect(() => {
    if (connected) {
      fetchCitizenThreads()
    }
  }, [connected, fetchCitizenThreads])

  // Auto-restore last thread (or fall back to most recent) once threads are available
  useEffect(() => {
    if (!connected || threads.length === 0 || hasAutoSelectedRef.current) return

    // Check if there's a stored active thread ID from previous session
    const storedThreadId = sessionStorage.getItem('aegis-active-thread-id')
    let selectedThread: ChatThread | undefined

    if (storedThreadId) {
      const thread = threads.find(t => t.id === storedThreadId)
      if (thread) {
        // // console.log('[CitizenMessaging] Restoring thread from session:', storedThreadId)
        selectedThread = thread
      } else {
        // // console.log('[CitizenMessaging] Stored thread not found, falling back to latest thread:', storedThreadId)
      }
      sessionStorage.removeItem('aegis-active-thread-id')
    }

    // No stored thread (or stale ID): auto-open most recent thread so messages appear immediately
    if (!selectedThread) {
      const sortedThreads = [...threads].sort(
        (a, b) => new Date(b.last_message_at || b.created_at).getTime() - new Date(a.last_message_at || a.created_at).getTime()
      )
      selectedThread = sortedThreads[0]
    }

    if (selectedThread) {
      // // console.log('[CitizenMessaging] Auto-selecting thread:', selectedThread.id)
      handleSelectThread(selectedThread)
      hasAutoSelectedRef.current = true
    }
  }, [connected, threads])

  // Store active thread ID when user selects a thread
  useEffect(() => {
    if (activeThread) {
      sessionStorage.setItem('aegis-active-thread-id', activeThread.id)
    }
  }, [activeThread])

  // Scroll to bottom
  useEffect(() => {
    // // console.log('[CitizenMessaging] Messages updated, count:', messages.length)
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Mark messages as read
  useEffect(() => {
    if (activeThread && messages.length > 0) {
      const unreadIds = messages.filter(m => m.status !== 'read' && m.sender_type === 'operator').map(m => m.id)
      if (unreadIds.length > 0) {
        markRead(activeThread.id, unreadIds)
      }
    }
  }, [activeThread?.id, messages.length])

  // Filter threads
  const filteredThreads = useMemo(() => {
    let list = [...threads]
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase()
      list = list.filter(t =>
        t.subject?.toLowerCase().includes(q) ||
        t.last_message?.toLowerCase().includes(q)
      )
    }
    // Sort by last message date
    list.sort((a, b) =>
      new Date(b.last_message_at || 0).getTime() - new Date(a.last_message_at || 0).getTime()
    )
    return list
  }, [threads, searchTerm])

  const handleSelectThread = (thread: ChatThread) => {
    // // console.log('[CitizenMessaging] Selecting thread:', thread.id)
    setActiveThread(thread)
    joinThread(thread.id)
    loadThreadMessages(thread.id)
    setView('chat')
  }

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Image must be less than 5MB')
      return
    }
    setSelectedImage(file)
    const reader = new FileReader()
    reader.onload = (evt) => {
      setPreviewUrl(evt.target?.result as string)
    }
    reader.readAsDataURL(file)
  }

  const handleSendMessage = async () => {
    if (!msgInput.trim() && !selectedImage) return
    if (!activeThread) return

    setIsLoading(true)
    setError('')

    try {
      // If there's an image, upload it first
      if (selectedImage) {
        const formData = new FormData()
        formData.append('file', selectedImage)
        const uploadRes = await fetch('/api/upload', {
          method: 'POST',
          body: formData,
          headers: {
            Authorization: `Bearer ${localStorage.getItem('aegis-citizen-token') || localStorage.getItem('token')}`
          }
        })
        if (!uploadRes.ok) throw new Error('Failed to upload image')
        const { url: imageUrl } = await uploadRes.json()

        // Send message with image
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
      setError(err.message || 'Failed to send message')
    } finally {
      setIsLoading(false)
    }
  }

  const handleCreateThread = async () => {
    const subject = prompt('What is this about? (e.g., "Emergency help needed", "Question about alerts")')
    if (!subject?.trim()) return
    createThread(subject, 'citizen-support', 'I need help with the following...')
  }

  const handleBackToList = () => {
    setView('list')
    setActiveThread(null)
    hasAutoSelectedRef.current = false
  }

  // ═══ LIST VIEW ═══
  if (view === 'list') {
    return (
      <div className="h-[600px] bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-gray-200 dark:border-gray-800">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h3 className="font-bold text-lg flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-aegis-600" />
              Messages
            </h3>
            <button
              onClick={handleCreateThread}
              className="px-3 py-1.5 bg-aegis-600 hover:bg-aegis-700 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> New
            </button>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search messages..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm bg-gray-100 dark:bg-gray-800 rounded-lg border-none focus:outline-none focus:ring-2 focus:ring-aegis-600"
            />
          </div>
        </div>

        {/* Threads List */}
        <div className="flex-1 overflow-y-auto">
          {filteredThreads.length === 0 ? (
            <div className="p-8 text-center">
              <MessageSquare className="w-12 h-12 text-gray-300 dark:text-gray-700 mx-auto mb-3" />
              <p className="text-sm text-gray-500">
                {searchTerm ? 'No conversations found' : 'No conversations yet'}
              </p>
              {!searchTerm && (
                <button
                  onClick={handleCreateThread}
                  className="mt-3 text-sm text-aegis-600 hover:text-aegis-700 font-medium"
                >
                  Start a new conversation →
                </button>
              )}
            </div>
          ) : (
            filteredThreads.map((thread) => (
              <button
                key={thread.id}
                onClick={() => handleSelectThread(thread)}
                className="w-full px-4 py-3 text-left border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm truncate">{thread.subject}</p>
                      {thread.citizen_unread > 0 && (
                        <span className="bg-aegis-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                          {thread.citizen_unread}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 truncate mt-1">{thread.last_message}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-400 whitespace-nowrap">
                      {timeAgo(thread.last_message_at || thread.created_at)}
                    </p>
                    {thread.is_emergency && (
                      <AlertTriangle className="w-4 h-4 text-red-600 mt-1" />
                    )}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>

        {/* Connection Status */}
        <div className="p-3 border-t border-gray-200 dark:border-gray-800 text-xs flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
          <span className="text-gray-500">{connected ? 'Connected' : 'Offline'}</span>
        </div>
      </div>
    )
  }

  // ═══ CHAT VIEW ═══
  return (
    <div className="h-[600px] bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-800 flex items-center gap-3">
        <button
          onClick={handleBackToList}
          className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h3 className="font-bold text-sm">{activeThread?.subject}</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {activeThread?.last_message_at ? `Updated ${timeAgo(activeThread.last_message_at)}` : 'Just created'}
          </p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 ? (
          <div className="text-center py-8">
            <MessageSquare className="w-12 h-12 text-gray-300 dark:text-gray-700 mx-auto mb-2" />
            <p className="text-sm text-gray-500">No messages yet. Start the conversation!</p>
          </div>
        ) : (
          messages.map((msg) => {
            const isMine = msg.sender_type === 'citizen' && msg.sender_id === user?.id
            const senderName = msg.sender_name || (msg.sender_type === 'operator' ? 'Admin' : 'You')
            
            return (
            <div
              key={msg.id}
              className={`flex gap-3 ${isMine ? 'justify-end' : 'justify-start'}`}
            >
              {!isMine && (
                <div className="w-8 h-8 rounded-full bg-aegis-100 dark:bg-aegis-900 flex items-center justify-center flex-shrink-0">
                  <User className="w-4 h-4 text-aegis-600" />
                </div>
              )}
              <div className="max-w-xs">
                {/* Show sender name for admin messages */}
                {!isMine && (
                  <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    {senderName} <span className="text-aegis-600">(Admin)</span>
                  </p>
                )}
                <div
                  className={`px-3 py-2 rounded-lg text-sm break-words ${
                    isMine
                      ? 'bg-aegis-600 text-white rounded-br-none'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-bl-none'
                  }`}
                >
                  {msg.content}
                </div>
                <div
                  className={`flex items-center gap-1.5 mt-1 text-xs ${
                    isMine ? 'justify-end text-gray-500' : 'text-gray-500'
                  }`}
                >
                  <Clock className="w-3 h-3" />
                  <span>{new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  {isMine && <MessageStatusIcon status={msg.status || 'sent'} size="lg" />}
                </div>
              </div>
            </div>
          )
          })
        )
        }
        <div ref={messagesEndRef} />
      </div>

      {/* Image Preview */}
      {previewUrl && (
        <div className="px-4 pt-2">
          <div className="relative inline-block">
            <img src={previewUrl} alt="Preview" className="h-24 rounded-lg object-cover" />
            <button
              onClick={() => {
                setSelectedImage(null)
                setPreviewUrl('')
              }}
              className="absolute -top-2 -right-2 p-1 bg-red-600 text-white rounded-full hover:bg-red-700 transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}

      {/* Input */}
      <div className="p-4 border-t border-gray-200 dark:border-gray-800 space-y-2">
        {error && (
          <div className="p-2 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-xs rounded-lg flex items-center gap-2">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            {error}
          </div>
        )}
        <div className="flex items-end gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-50"
            title="Attach image"
          >
            <ImageIcon className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleImageSelect}
            className="hidden"
          />
          <textarea
            value={msgInput}
            onChange={(e) => setMsgInput(e.target.value)}
            onKeyPress={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSendMessage()
              }
            }}
            placeholder="Type your message... (Shift+Enter for new line)"
            disabled={isLoading}
            className="flex-1 px-3 py-2 text-sm bg-gray-100 dark:bg-gray-800 rounded-lg border-none resize-none max-h-24 focus:outline-none focus:ring-2 focus:ring-aegis-600 disabled:opacity-50"
            rows={1}
          />
          <button
            onClick={handleSendMessage}
            disabled={!msgInput.trim() && !selectedImage || isLoading}
            className="p-2 bg-aegis-600 hover:bg-aegis-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Send message"
          >
            {isLoading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Send className="w-5 h-5" />
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
