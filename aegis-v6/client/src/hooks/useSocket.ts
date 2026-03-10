/*
 * useSocket.ts - Real-time Socket.IO hook for Citizen <-> Admin messaging
 *
 * Connects to the AEGIS Socket.IO server with JWT authentication.
 * Manages: connection state, message events, typing indicators,
 * thread management, presence, and message status tracking.
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { io, Socket } from 'socket.io-client'

// Resolve Socket.IO server URL from env or fall back to window.location origin
const SOCKET_URL = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_SOCKET_URL)
  || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3001')

// --- Types ---

export interface ChatMessage {
  id: string
  thread_id: string
  sender_id: string
  sender_type: 'citizen' | 'operator'
  sender_name: string
  sender_role?: string
  content: string
  attachment_url?: string
  attachment_type?: string
  status: 'sent' | 'delivered' | 'read'
  created_at: string
  delivered_at?: string
  read_at?: string
}

export interface ChatThread {
  id: string
  citizen_id: string
  citizen_name?: string
  citizen_email?: string
  citizen_phone?: string
  citizen_avatar?: string
  is_vulnerable?: boolean
  subject: string
  status: 'open' | 'in_progress' | 'resolved' | 'closed'
  priority: 'low' | 'medium' | 'high' | 'critical'
  category: string
  assigned_operator_id?: string
  assigned_operator_name?: string
  citizen_unread: number
  operator_unread: number
  is_emergency: boolean
  auto_escalated: boolean
  escalation_keywords?: string[]
  last_message?: string
  last_message_at?: string
  created_at: string
  updated_at: string
}

export interface TypingUser {
  threadId: string
  userId: string
  userName: string
  userType: 'citizen' | 'operator'
}

export interface SocketState {
  connected: boolean
  socket: Socket | null
  threads: ChatThread[]
  activeThread: ChatThread | null
  messages: ChatMessage[]
  typingUsers: TypingUser[]
  adminThreads: ChatThread[]
  unreadCount: number
  connect: (token: string) => void
  disconnect: () => void
  sendMessage: (threadId: string, content: string, attachmentUrl?: string) => void
  createThread: (subject: string, category: string, initialMessage: string) => void
  joinThread: (threadId: string) => void
  markRead: (threadId: string, messageIds: string[]) => void
  startTyping: (threadId: string) => void
  stopTyping: (threadId: string) => void
  fetchAdminThreads: () => void
  fetchCitizenThreads: () => void
  assignThread: (threadId: string, operatorId: string) => void
  resolveThread: (threadId: string) => void
  setActiveThread: (thread: ChatThread | null) => void
  loadThreadMessages: (threadId: string) => void
}

// --- Hook ---

export function useSocket(): SocketState {
  const socketRef = useRef<Socket | null>(null)
  const [connected, setConnected] = useState(false)
  const [threads, setThreads] = useState<ChatThread[]>([])
  const [activeThread, setActiveThread] = useState<ChatThread | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([])
  const [adminThreads, setAdminThreads] = useState<ChatThread[]>([])
  const [unreadCount, setUnreadCount] = useState(0)

  // Active thread ref - updated synchronously to avoid race conditions
  const activeThreadRef = useRef<ChatThread | null>(null)
  useEffect(() => { activeThreadRef.current = activeThread }, [activeThread])

  // Wrap setActiveThread - update ref synchronously + clear messages when switching threads
  const setActiveThreadFn = useCallback((thread: ChatThread | null) => {
    const currentId = activeThreadRef.current?.id
    const newId = thread?.id
    
    // // console.log('[Socket] setActiveThread called - current:', currentId, 'new:', newId)
    
    // Only clear messages when ACTUALLY switching to a different thread
    // Don't clear if: going from null → thread, or same thread ID
    if (currentId && newId && currentId !== newId) {
      // // console.log('[Socket] Switching threads - clearing messages')
      setMessages([])
    }
    
    activeThreadRef.current = thread
    setActiveThread(thread)
  }, [])

  // Connect to Socket.IO with JWT
  const connect = useCallback((token: string) => {
    if (socketRef.current?.connected) return

    const socket = io(SOCKET_URL, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 10,
    })

    socket.on('connect', () => {
      // // console.log('[Socket] Connected:', socket.id, '- waiting for server data...')
      setConnected(true)
    })

    socket.on('disconnect', (reason) => {
      // // console.log('[Socket] Disconnected:', reason)
      setConnected(false)
    })

    socket.on('connect_error', (err) => {
      console.error('[Socket] Connection error:', err.message, '- check token & server')
      setConnected(false)
    })

    // --- Message Events ---

    socket.on('message:new', (msg: ChatMessage) => {
      // // console.log('[Socket] message:new received:', msg.id, 'for thread:', msg.thread_id, 'active thread:', activeThreadRef.current?.id)
      
      // Always update messages if viewing this thread (even if ref not set yet)
      const currentThreadId = activeThreadRef.current?.id
      if (currentThreadId === msg.thread_id) {
        // // console.log('[Socket] Adding message to active thread')
        setMessages(prev => {
          const withoutOptimistic = prev.filter(m => !m.id.startsWith('tmp-') || m.thread_id !== msg.thread_id || m.content !== msg.content)
          if (withoutOptimistic.some(m => m.id === msg.id)) {
            // // console.log('[Socket] Message already exists, skipping')
            return withoutOptimistic
          }
          // // console.log('[Socket] Adding new message to state')
          return [...withoutOptimistic, msg]
        })
      } else {
        // // console.log('[Socket] Message for different thread, updating metadata only')
      }
      // Update and sort citizen threads
      setThreads(prev => {
        const updated = prev.map(t =>
          t.id === msg.thread_id
            ? { ...t, last_message: msg.content, last_message_at: msg.created_at, updated_at: msg.created_at,
                citizen_unread: msg.sender_type === 'operator' ? (t.citizen_unread || 0) + 1 : t.citizen_unread }
            : t
        )
        return updated.sort((a, b) => 
          new Date(b.last_message_at || b.created_at).getTime() - 
          new Date(a.last_message_at || a.created_at).getTime()
        )
      })
      // Update and sort admin threads
      setAdminThreads(prev => {
        const updated = prev.map(t =>
          t.id === msg.thread_id
            ? { ...t, last_message: msg.content, last_message_at: msg.created_at, updated_at: msg.created_at,
                operator_unread: msg.sender_type === 'citizen' ? (t.operator_unread || 0) + 1 : t.operator_unread }
            : t
        )
        return updated.sort((a, b) => 
          new Date(b.last_message_at || b.created_at).getTime() - 
          new Date(a.last_message_at || a.created_at).getTime()
        )
      })
    })

    socket.on('message:status', ({ messageId, status, timestamp }: any) => {
      setMessages(prev => prev.map(m =>
        m.id === messageId ? { ...m, status, ...(status === 'delivered' ? { delivered_at: timestamp } : { read_at: timestamp }) } : m
      ))
    })

    // --- Thread Events ---

    socket.on('thread:created', (thread: ChatThread) => {
      setThreads(prev => {
        if (prev.some(t => t.id === thread.id)) return prev
        return [thread, ...prev]
      })
    })

    socket.on('thread:updated', (thread: ChatThread) => {
      setThreads(prev => prev.map(t => t.id === thread.id ? { ...t, ...thread } : t))
      setAdminThreads(prev => prev.map(t => t.id === thread.id ? { ...t, ...thread } : t))
      if (activeThreadRef.current?.id === thread.id) {
        setActiveThread(prev => prev ? { ...prev, ...thread } : prev)
      }
    })

    socket.on('admin:new_thread', (thread: ChatThread) => {
      // // console.log('[Socket] admin:new_thread received:', thread.id)
      setAdminThreads(prev => {
        if (prev.some(t => t.id === thread.id)) return prev
        // Add to top and sort by created_at
        return [thread, ...prev].sort((a, b) => 
          new Date(b.last_message_at || b.created_at).getTime() - 
          new Date(a.last_message_at || a.created_at).getTime()
        )
      })
      setThreads(prev => {
        if (prev.some(t => t.id === thread.id)) return prev
        // Add to top and sort by created_at
        return [thread, ...prev].sort((a, b) => 
          new Date(b.last_message_at || b.created_at).getTime() - 
          new Date(a.last_message_at || a.created_at).getTime()
        )
      })
    })

    socket.on('admin:new_message', ({ threadId, message }: any) => {
      // // console.log('[Socket] admin:new_message received for thread:', threadId)
      // Only update metadata + unread if NOT currently viewing this thread
      // (message:new already handles it when admin is in the thread room)
      const inThreadRoom = activeThreadRef.current?.id === threadId
      
      // Update adminThreads and re-sort
      setAdminThreads(prev => {
        const updated = prev.map(t =>
          t.id === threadId
            ? { ...t, last_message: message.content, last_message_at: message.created_at,
                operator_unread: inThreadRoom ? t.operator_unread : t.operator_unread + 1,
                updated_at: message.created_at }
            : t
        )
        // Sort by last_message_at to bring updated thread to top
        return updated.sort((a, b) => 
          new Date(b.last_message_at || b.created_at).getTime() - 
          new Date(a.last_message_at || a.created_at).getTime()
        )
      })
      
      // Update threads (for compatibility) and re-sort
      setThreads(prev => {
        const updated = prev.map(t =>
          t.id === threadId
            ? { ...t, last_message: message.content, last_message_at: message.created_at,
                operator_unread: inThreadRoom ? (t.operator_unread || 0) : (t.operator_unread || 0) + 1,
                updated_at: message.created_at }
            : t
        )
        // Sort by last_message_at to bring updated thread to top
        return updated.sort((a, b) => 
          new Date(b.last_message_at || b.created_at).getTime() - 
          new Date(a.last_message_at || a.created_at).getTime()
        )
      })
    })

    socket.on('admin:threads', (threadList: ChatThread[]) => {
      // // console.log('[Socket] Received admin:threads:', threadList?.length || 0, 'threads')
      setAdminThreads(threadList)
      setThreads(threadList)
    })

    // --- Typing Events ---

    socket.on('typing:start', ({ threadId, userId, displayName, role }: any) => {
      setTypingUsers(prev => {
        if (prev.some(t => t.userId === userId && t.threadId === threadId)) return prev
        return [...prev, { threadId, userId, userName: displayName, userType: role === 'citizen' ? 'citizen' : 'operator' }]
      })
    })

    socket.on('typing:stop', ({ threadId, userId }: any) => {
      setTypingUsers(prev => prev.filter(t => !(t.userId === userId && t.threadId === threadId)))
    })

    // --- Messages loaded ---

    socket.on('thread:messages', ({ threadId, messages: msgs }: any) => {
      const current = activeThreadRef.current
      if (!current || current.id !== threadId) return

      const incoming = Array.isArray(msgs) ? msgs : []
      setMessages(prev => {
        if (incoming.length === 0 && prev.length > 0) {
          // // console.log('[Socket] Ignoring empty thread:messages payload for active thread:', threadId)
          return prev
        }
        return incoming
      })
    })

    // --- Citizen thread list ---

    // --- Admin: Thread assigned ---
    socket.on('admin:thread_assigned', ({ threadId, operatorName }: any) => {
      // // console.log('[Socket] Thread assigned:', threadId, 'to', operatorName)
      setThreads(prev => prev.map(t =>
        t.id === threadId ? { ...t, status: 'in_progress', assigned_operator_id: operatorName } : t
      ))
      setAdminThreads(prev => prev.map(t =>
        t.id === threadId ? { ...t, status: 'in_progress', assigned_operator_id: operatorName } : t
      ))
      // Update active thread if viewing it
      const current = activeThreadRef.current
      if (current?.id === threadId) {
        setActiveThread({ ...current, status: 'in_progress' } as ChatThread)
      }
    })

    // --- Admin: Thread resolved ---
    socket.on('admin:thread_resolved', ({ threadId }: any) => {
      // // console.log('[Socket] Thread resolved:', threadId)
      setThreads(prev => prev.map(t =>
        t.id === threadId ? { ...t, status: 'resolved' } : t
      ))
      setAdminThreads(prev => prev.map(t =>
        t.id === threadId ? { ...t, status: 'resolved' } : t
      ))
      const current = activeThreadRef.current
      if (current?.id === threadId) {
        setActiveThread({ ...current, status: 'resolved' } as ChatThread)
      }
    })

    // --- Thread resolved (for citizens in thread room) ---
    socket.on('thread:resolved', ({ threadId }: any) => {
      setThreads(prev => prev.map(t =>
        t.id === threadId ? { ...t, status: 'resolved' } : t
      ))
      const current = activeThreadRef.current
      if (current?.id === threadId) {
        setActiveThread({ ...current, status: 'resolved' } as ChatThread)
      }
    })

    socket.on('citizen:threads', (threadList: ChatThread[]) => {
      // // console.log('[Socket] Received citizen:threads:', threadList?.length || 0, 'threads')
      setThreads(threadList)
    })

    // --- Citizen: Admin reply notification ---
    socket.on('citizen:new_reply', ({ threadId, message }: any) => {
      // // console.log('[Socket] citizen:new_reply received for thread:', threadId)
      // Update thread list with new reply info and re-sort
      setThreads(prev => {
        const updated = prev.map(t =>
          t.id === threadId
            ? { ...t, last_message: message.content, last_message_at: message.created_at,
                citizen_unread: (t.citizen_unread || 0) + 1, updated_at: message.created_at }
            : t
        )
        // Sort by last_message_at to bring updated thread to top
        return updated.sort((a, b) => 
          new Date(b.last_message_at || b.created_at).getTime() - 
          new Date(a.last_message_at || a.created_at).getTime()
        )
      })
      // If viewing this thread, add the message (dedup with message:new)
      if (activeThreadRef.current?.id === threadId) {
        setMessages(prev => {
          if (prev.some(m => m.id === message.id)) return prev
          return [...prev, message]
        })
      }
    })

    // --- Citizen: Authoritative unread count from server ---
    socket.on('citizen:unread_count', ({ total }: { total: number }) => {
      setUnreadCount(total)
    })

    socketRef.current = socket
  }, [])

  // Disconnect
  const disconnect = useCallback(() => {
    socketRef.current?.disconnect()
    socketRef.current = null
    setConnected(false)
    setThreads([])
    setMessages([])
    setTypingUsers([])
    setAdminThreads([])
    setActiveThread(null)
    activeThreadRef.current = null
  }, [])

  // Send message (with optional attachment)
  const sendMessage = useCallback((threadId: string, content: string, attachmentUrl?: string) => {
    const trimmed = content.trim()
    if (!trimmed && !attachmentUrl) return

    const optimisticId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const adminToken = localStorage.getItem('aegis-token') || localStorage.getItem('token')
    const citizenToken = localStorage.getItem('aegis-citizen-token')
    const isAdminUser = !!adminToken && !citizenToken

    // Get real user ID for proper message alignment
    let realUserId = 'me'
    try {
      if (isAdminUser) {
        const stored = localStorage.getItem('aegis-user')
        if (stored) realUserId = JSON.parse(stored).id || 'me'
      } else {
        // Decode citizen token to get user ID
        const tk = localStorage.getItem('aegis-citizen-token')
        if (tk) {
          const payload = JSON.parse(atob(tk.split('.')[1]))
          realUserId = payload.id || 'me'
        }
      }
    } catch { /* fallback to 'me' */ }

    const msgContent = trimmed || ''
    const threadPreview = trimmed || (attachmentUrl ? '[Image]' : '')
    const optimisticMsg: ChatMessage = {
      id: optimisticId,
      thread_id: threadId,
      sender_id: realUserId,
      sender_type: isAdminUser ? 'operator' : 'citizen',
      sender_name: 'You',
      content: msgContent,
      attachment_url: attachmentUrl,
      status: 'sent',
      created_at: new Date().toISOString(),
    }

    if (activeThreadRef.current?.id === threadId) {
      setMessages(prev => [...prev, optimisticMsg])
    }

    const now = new Date().toISOString()
    setThreads(prev => prev.map(t =>
      t.id === threadId ? { ...t, last_message: threadPreview, last_message_at: now, updated_at: now } : t
    ))
    setAdminThreads(prev => prev.map(t =>
      t.id === threadId ? { ...t, last_message: threadPreview, last_message_at: now, updated_at: now } : t
    ))

    socketRef.current?.emit('message:send', { threadId, content: trimmed, attachmentUrl }, (ack: any) => {
      if (ack?.success && ack?.message) {
        setMessages(prev => prev.map(m => (m.id === optimisticId ? ack.message : m)))
      } else {
        setMessages(prev => prev.filter(m => m.id !== optimisticId))
      }
    })
  }, [])

  const createThread = useCallback((subject: string, category: string, initialMessage: string) => {
    socketRef.current?.emit('thread:create', { subject, category, message: initialMessage, isEmergency: false }, (ack: any) => {
      // Add the new thread to list immediately via ack
      if (ack?.success && ack?.thread) {
        setThreads(prev => {
          if (prev.some(t => t.id === ack.thread.id)) return prev
          return [ack.thread, ...prev]
        })
      }
    })
  }, [])

  const joinThread = useCallback((threadId: string) => {
    // // console.log('[Socket] Joining thread room:', threadId)
    socketRef.current?.emit('thread:join', { threadId })
  }, [])

  const loadThreadMessages = useCallback(async (threadId: string) => {
    // Use REST API only — socket 'thread:join' already triggers 'thread:messages' event
    // This eliminates the race condition of dual REST + socket fetch (#21)
    try {
      const citizenToken = localStorage.getItem('aegis-citizen-token')
      const operatorToken = localStorage.getItem('aegis-token') || localStorage.getItem('token')
      const token = citizenToken || operatorToken
      if (!token) return
      
      // Use admin endpoint if operator token, citizen endpoint if citizen token
      const endpoint = operatorToken && !citizenToken 
        ? `/api/admin/threads/${threadId}`
        : `/api/citizen/threads/${threadId}`
      
      const res = await fetch(endpoint, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      
      if (res.ok) {
        const data = await res.json()
        if (data.messages) {
          setMessages(data.messages)
        }
      }
    } catch (err) {
      console.error('[Socket] Failed to load messages:', err)
    }
  }, [])

  const markRead = useCallback((threadId: string, messageIds: string[]) => {
    socketRef.current?.emit('messages:read', { threadId, messageIds })
  }, [])

  const startTyping = useCallback((threadId: string) => {
    socketRef.current?.emit('typing:start', { threadId })
  }, [])

  const stopTyping = useCallback((threadId: string) => {
    socketRef.current?.emit('typing:stop', { threadId })
  }, [])

  const fetchAdminThreads = useCallback(() => {
    socketRef.current?.emit('admin:get_threads')
  }, [])

  const fetchCitizenThreads = useCallback(async () => {
    // Primary: use socket (real-time); fallback: REST after 2s delay
    socketRef.current?.emit('citizen:get_threads')

    // Delayed REST fallback only if socket didn't deliver
    const timer = setTimeout(async () => {
      try {
        const token = localStorage.getItem('aegis-citizen-token') || localStorage.getItem('token')
        if (!token) return

        const res = await fetch('/api/citizen/threads', {
          headers: { Authorization: `Bearer ${token}` }
        })

        if (!res.ok) return

        const data = await res.json()
        const threadList: ChatThread[] = Array.isArray(data) ? data : (Array.isArray(data?.threads) ? data.threads : [])
        // Only apply REST data if socket hasn't already populated threads
        setThreads(prev => prev.length === 0 && threadList.length > 0 ? threadList : prev)
      } catch {}
    }, 2000)

    return () => clearTimeout(timer)
  }, [])

  const assignThread = useCallback((threadId: string, operatorId: string) => {
    socketRef.current?.emit('admin:assign_thread', { threadId, operatorId })
  }, [])

  const resolveThread = useCallback((threadId: string) => {
    socketRef.current?.emit('admin:resolve_thread', { threadId })
  }, [])

  useEffect(() => {
    return () => { socketRef.current?.disconnect() }
  }, [])

  return {
    connected,
    socket: socketRef.current,
    threads,
    activeThread,
    messages,
    typingUsers,
    adminThreads,
    unreadCount,
    connect,
    disconnect,
    sendMessage,
    createThread,
    joinThread,
    markRead,
    startTyping,
    stopTyping,
    fetchAdminThreads,
    fetchCitizenThreads,
    assignThread,
    resolveThread,
    setActiveThread: setActiveThreadFn,
    loadThreadMessages,
  }
}
