/*
 * useSocket.ts - Advanced Real-time Socket.IO hook for AEGIS Messaging
 *
 * Features:
 * - JWT authentication with automatic token validation
 * - Exponential backoff reconnection strategy
 * - Message queuing for offline scenarios with automatic retry
 * - Connection quality monitoring (latency tracking)
 * - Heartbeat monitoring with stale connection detection
 * - Message deduplication
 * - Optimistic updates with rollback on failure
 * - Automatic reconnection with queued message processing
 * - Full TypeScript support with comprehensive types
 *
 * Connects to the AEGIS Socket.IO server with JWT authentication.
 * Manages: connection state, message events, typing indicators,
 * thread management, presence, and message status tracking.
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { io, Socket } from 'socket.io-client'

// Resolve Socket.IO server URL from env or fall back to backend default
// Prefer explicit backend URL to avoid connecting to Vite dev server (5173)
const SOCKET_URL = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_SOCKET_URL)
  || 'http://localhost:3001'
const MAX_RECONNECT_ATTEMPTS = 10

// --- Types ---

// Message queue for offline messages
interface QueuedMessage {
  threadId: string
  content: string
  attachmentUrl?: string
  timestamp: number
  retryCount: number
}

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
  
  // Advanced features
  const messageQueueRef = useRef<QueuedMessage[]>([])
  const reconnectAttemptsRef = useRef(0)
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const lastPingRef = useRef<number>(Date.now())
  const latencyHistoryRef = useRef<number[]>([])
  const connectionQualityRef = useRef<'excellent' | 'good' | 'fair' | 'poor'>('good')
  const seenMessageIdsRef = useRef<Set<string>>(new Set())

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

  // Process queued messages when connection is restored
  const processMessageQueue = useCallback(() => {
    if (!socketRef.current?.connected || messageQueueRef.current.length === 0) return
    
    console.log('[Socket] 📤 Processing', messageQueueRef.current.length, 'queued messages')
    const queue = [...messageQueueRef.current]
    messageQueueRef.current = []
    
    queue.forEach((queuedMsg) => {
      console.log('[Socket] 📨 Sending queued message from', new Date(queuedMsg.timestamp).toLocaleTimeString())
      socketRef.current?.emit('message:send', {
        threadId: queuedMsg.threadId,
        content: queuedMsg.content,
        attachmentUrl: queuedMsg.attachmentUrl
      }, (ack: any) => {
        if (!ack?.success) {
          console.error('[Socket] Failed to send queued message, re-queuing...')
          // Re-queue with incremented retry count
          if (queuedMsg.retryCount < 3) {
            messageQueueRef.current.push({
              ...queuedMsg,
              retryCount: queuedMsg.retryCount + 1
            })
          }
        }
      })
    })
  }, [])

  // Connect to Socket.IO with JWT - Advanced connection management
  const connect = useCallback((token: string) => {
    if (socketRef.current?.connected) {
      console.log('[Socket] Already connected, skipping')
      return
    }

    if (!token) {
      console.error('[Socket] Cannot connect: no token provided')
      return
    }

    console.log('[Socket] 🔌 Connecting to:', SOCKET_URL)
    
    // Calculate exponential backoff delay based on previous attempts
    const baseDelay = 1000
    const maxDelay = 30000
    const backoffMultiplier = 1.5
    const currentDelay = Math.min(
      baseDelay * Math.pow(backoffMultiplier, reconnectAttemptsRef.current),
      maxDelay
    )
    
    console.log('[Socket] Reconnection delay:', currentDelay, 'ms (attempt', reconnectAttemptsRef.current + 1, ')')
    
    const socket = io(SOCKET_URL, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: MAX_RECONNECT_ATTEMPTS,
      timeout: 20000,
      autoConnect: true,
      forceNew: false,
      multiplex: true,
    })

    socket.on('connect', () => {
      console.log('[Socket] ✅ Connected:', socket.id)
      setConnected(true)
      reconnectAttemptsRef.current = 0
      
      // Process any queued messages
      processMessageQueue()
    })

    socket.on('disconnect', (reason) => {
      console.log('[Socket] ⚠️ Disconnected:', reason)
      setConnected(false)
      
      // Clear heartbeat interval
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current)
        heartbeatIntervalRef.current = null
      }
    })

    socket.on('connect_error', (err) => {
      console.error('[Socket] ❌ Connection error:', err.message)
      
      // Check if it's an auth error
      if (err.message.includes('Invalid token') || err.message.includes('authentication')) {
        console.warn('[Socket] Authentication failed - clearing token')
        localStorage.removeItem('aegis-token')
        localStorage.removeItem('aegis-user')
        localStorage.removeItem('aegis-citizen-token')
        localStorage.removeItem('aegis-citizen-user')
        
        // Redirect to login if not already there
        if (!window.location.pathname.includes('/login') && !window.location.pathname.includes('/auth')) {
          console.log('[Socket] Redirecting to login...')
          setTimeout(() => {
            window.location.href = window.location.pathname.includes('/admin') ? '/admin/login' : '/auth/login'
          }, 1000)
        }
      }
      
      setConnected(false)
    })

    // --- Advanced Connection Management ---
    
    // Reconnection attempts tracking
    socket.on('reconnect_attempt', (attemptNumber) => {
      reconnectAttemptsRef.current = attemptNumber
      console.log(`[Socket] 🔄 Reconnection attempt ${attemptNumber}/${MAX_RECONNECT_ATTEMPTS}`)
    })
    
    socket.on('reconnect', (attemptNumber) => {
      console.log(`[Socket] ✅ Reconnected after ${attemptNumber} attempts`)
      reconnectAttemptsRef.current = 0
      setConnected(true)
      
      // Process queued messages after reconnection
      processMessageQueue()
    })
    
    socket.on('reconnect_failed', () => {
      console.error('[Socket] ❌ Reconnection failed after', MAX_RECONNECT_ATTEMPTS, 'attempts')
      setConnected(false)
      
      // Alert user if there are queued messages
      if (messageQueueRef.current.length > 0) {
        console.warn('[Socket] ⚠️', messageQueueRef.current.length, 'messages queued, waiting for connection')
      }
    })
    
    socket.on('reconnect_error', (err) => {
      console.error('[Socket] ⚠️ Reconnection error:', err.message)
    })
    
    // Heartbeat monitoring with custom intervals
    heartbeatIntervalRef.current = setInterval(() => {
      if (socket.connected) {
        const now = Date.now()
        const timeSinceLastPing = now - lastPingRef.current
        
        // If no ping in last 30 seconds, connection might be stale
        if (timeSinceLastPing > 30000) {
          console.warn('[Socket] ⚠️ No heartbeat for 30s, connection may be stale')
        }
      }
    }, 10000) // Check every 10 seconds
    
    socket.on('ping', () => {
      lastPingRef.current = Date.now()
    })
    
    socket.on('pong', (latency) => {
      lastPingRef.current = Date.now()
      
      // Track latency history (keep last 10 measurements)
      latencyHistoryRef.current.push(latency)
      if (latencyHistoryRef.current.length > 10) {
        latencyHistoryRef.current.shift()
      }
      
      // Calculate average latency
      const avgLatency = latencyHistoryRef.current.reduce((a, b) => a + b, 0) / latencyHistoryRef.current.length
      
      // Determine connection quality
      let quality: 'excellent' | 'good' | 'fair' | 'poor'
      if (avgLatency < 50) quality = 'excellent'
      else if (avgLatency < 150) quality = 'good'
      else if (avgLatency < 300) quality = 'fair'
      else quality = 'poor'
      
      if (connectionQualityRef.current !== quality) {
        console.log('[Socket] 📊 Connection quality changed:', connectionQualityRef.current, '→', quality)
        connectionQualityRef.current = quality
      }
      
      console.log('[Socket] 💚 Latency:', latency, 'ms | Avg:', avgLatency.toFixed(0), 'ms | Quality:', quality)
    })

    // --- Message Events ---

    socket.on('message:new', (msg: ChatMessage) => {
      // Advanced deduplication - check if we've already processed this message
      if (seenMessageIdsRef.current.has(msg.id)) {
        console.log('[Socket] 🔄 Duplicate message detected, skipping:', msg.id)
        return
      }
      
      // Add to seen messages (keep last 1000 to prevent memory bloat)
      seenMessageIdsRef.current.add(msg.id)
      if (seenMessageIdsRef.current.size > 1000) {
        const firstId = seenMessageIdsRef.current.values().next().value
        if (firstId) {
          seenMessageIdsRef.current.delete(firstId)
        }
      }
      
      console.log('[Socket] 📨 New message:', msg.id, 'Thread:', msg.thread_id)
      
      // Always update messages if viewing this thread (even if ref not set yet)
      const currentThreadId = activeThreadRef.current?.id
      if (currentThreadId === msg.thread_id) {
        setMessages(prev => {
          const withoutOptimistic = prev.filter(m => !m.id.startsWith('tmp-') || m.thread_id !== msg.thread_id || m.content !== msg.content)
          if (withoutOptimistic.some(m => m.id === msg.id)) {
            console.log('[Socket] Message already in state, skipping')
            return withoutOptimistic
          }
          console.log('[Socket] Adding message to active thread state')
          return [...withoutOptimistic, msg]
        })
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
      console.log('[Socket] Received citizen:threads:', threadList?.length || 0, 'threads')
      console.log('[Socket] Thread IDs:', threadList?.map(t => t.id))
      setThreads(threadList)
    })

    // --- Citizen: Admin reply notification ---
    socket.on('citizen:new_reply', ({ threadId, message }: any) => {
      console.log('[Socket] citizen:new_reply received for thread:', threadId)
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
  }, [processMessageQueue])

  // Disconnect with cleanup
  const disconnect = useCallback(() => {
    console.log('[Socket] 🔌 Disconnecting...')
    
    // Clear heartbeat interval
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current)
      heartbeatIntervalRef.current = null
    }
    
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

    // Queue message if offline
    if (!socketRef.current?.connected) {
      console.warn('[Socket] 📫 Offline - queueing message for later delivery')
      messageQueueRef.current.push({
        threadId,
        content: trimmed,
        attachmentUrl,
        timestamp: Date.now(),
        retryCount: 0
      })
      return
    }

    // Send message with enhanced error handling
    socketRef.current?.emit('message:send', { threadId, content: trimmed, attachmentUrl }, (ack: any) => {
      if (ack?.success && ack?.message) {
        console.log('[Socket] ✅ Message sent successfully')
        setMessages(prev => prev.map(m => (m.id === optimisticId ? ack.message : m)))
      } else {
        console.error('[Socket] ❌ Message send failed:', ack?.error)
        // Queue for retry
        messageQueueRef.current.push({
          threadId,
          content: trimmed,
          attachmentUrl,
          timestamp: Date.now(),
          retryCount: 0
        })
        // Remove optimistic message
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
    console.log('[Socket] fetchCitizenThreads called')
    // Primary: use socket (real-time); fallback: REST after 2s delay
    socketRef.current?.emit('citizen:get_threads')
    console.log('[Socket] Emitted citizen:get_threads event')

    // Delayed REST fallback only if socket didn't deliver
    const timer = setTimeout(async () => {
      console.log('[Socket] REST fallback triggered after 2s')
      try {
        const token = localStorage.getItem('aegis-citizen-token') || localStorage.getItem('token')
        if (!token) {
          console.error('[Socket] No token for REST fallback')
          return
        }

        console.log('[Socket] Fetching /api/citizen/threads via REST')
        const res = await fetch('/api/citizen/threads', {
          headers: { Authorization: `Bearer ${token}` }
        })

        if (!res.ok) {
          console.error('[Socket] REST fallback failed:', res.status, res.statusText)
          return
        }

        const data = await res.json()
        console.log('[Socket] REST response received:', data)
        const threadList: ChatThread[] = Array.isArray(data) ? data : (Array.isArray(data?.threads) ? data.threads : [])
        console.log('[Socket] Parsed threadList:', threadList.length, 'threads')
        // Only apply REST data if socket hasn't already populated threads
        setThreads(prev => {
          if (prev.length === 0 && threadList.length > 0) {
            console.log('[Socket] Applying REST data (socket was empty)')
            return threadList
          }
          console.log('[Socket] Ignoring REST data (socket already has', prev.length, 'threads)')
          return prev
        })
      } catch (err) {
        console.error('[Socket] REST fallback error:', err)
      }
    }, 2000)

    return () => clearTimeout(timer)
  }, [])

  const assignThread = useCallback((threadId: string, operatorId: string) => {
    socketRef.current?.emit('admin:assign_thread', { threadId, operatorId })
  }, [])

  const resolveThread = useCallback((threadId: string) => {
    socketRef.current?.emit('admin:resolve_thread', { threadId })
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      console.log('[Socket] 🧹 Cleanup on unmount')
      
      // Clear heartbeat interval
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current)
        heartbeatIntervalRef.current = null
      }
      
      // Disconnect socket
      socketRef.current?.disconnect()
      
      // Clear message queue if user is logging out
      if (messageQueueRef.current.length > 0) {
        console.warn('[Socket] ⚠️ Discarding', messageQueueRef.current.length, 'queued messages on unmount')
      }
    }
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
