/*
 * CommunityChat.tsx — Community Discussion Board (Advanced UI)
 *
 * Features:
 *   - Modern social-media-style post feed
 *   - Lucide icon system (no Unicode emojis)
 *   - Report posts with reason selection
 *   - Admin can delete only reported posts
 *   - Animated like interactions
 *   - Glassmorphism cards and gradients
 *   - Skeleton loading, rich post creation
 *   - Beautiful comment section
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  MessageSquare, Send, Search, Heart, MessageCircle,
  Share2, Loader2, X, AlertCircle, ZoomIn, MapPin, User,
  Trash2, Flag, MoreHorizontal, Shield,
  AlertTriangle, Sparkles,
  CheckCircle2, EyeOff, Camera,
  Globe, ShieldAlert, Ban, Flame, Pencil, Bell
} from 'lucide-react'
import { useCitizenAuth } from '../../contexts/CitizenAuthContext'
import type { Socket } from 'socket.io-client'
import { API_BASE, timeAgo } from '../../utils/helpers'

interface Post {
  id: string
  author_id: string
  author_name: string
  author_role?: string
  author_avatar?: string
  content: string
  image_url?: string
  likes_count: number
  comments_count: number
  shares_count: number
  is_liked_by_user: boolean
  reports_count: number
  is_reported_by_user: boolean
  created_at: string
  updated_at: string
  location?: string
  is_hazard_update?: boolean
}

interface Comment {
  id: string
  post_id: string
  author_id: string
  author_name: string
  author_role?: string
  author_avatar?: string
  content: string
  image_url?: string
  created_at: string
}

function getInitials(name: string): string {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
}

const AVATAR_GRADIENTS = [
  'from-violet-500 to-purple-600',
  'from-blue-500 to-cyan-500',
  'from-emerald-500 to-teal-500',
  'from-orange-500 to-red-500',
  'from-pink-500 to-rose-500',
  'from-indigo-500 to-blue-600',
  'from-amber-500 to-orange-500',
  'from-fuchsia-500 to-pink-600',
]

function getAvatarGradient(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length]
}

const REPORT_REASONS = [
  { value: 'spam', label: 'Spam', icon: Ban, desc: 'Repetitive or irrelevant content' },
  { value: 'harassment', label: 'Harassment', icon: ShieldAlert, desc: 'Bullying or targeted attacks' },
  { value: 'misinformation', label: 'Misinformation', icon: AlertTriangle, desc: 'False or misleading information' },
  { value: 'inappropriate', label: 'Inappropriate', icon: EyeOff, desc: 'Adult or offensive content' },
  { value: 'violence', label: 'Violence', icon: AlertTriangle, desc: 'Threats or graphic violence' },
  { value: 'other', label: 'Other', icon: Flag, desc: 'Something else not listed' },
]

function PostSkeleton() {
  return (
    <div className="bg-white dark:bg-gray-900/80 rounded-2xl border border-gray-100 dark:border-gray-800/60 overflow-hidden animate-pulse">
      <div className="p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-11 h-11 rounded-full bg-gray-200 dark:bg-gray-700" />
          <div className="flex-1">
            <div className="h-3.5 w-28 bg-gray-200 dark:bg-gray-700 rounded-full mb-2" />
            <div className="h-2.5 w-20 bg-gray-200 dark:bg-gray-700 rounded-full" />
          </div>
        </div>
        <div className="space-y-2 mb-4">
          <div className="h-3 w-full bg-gray-200 dark:bg-gray-700 rounded-full" />
          <div className="h-3 w-3/4 bg-gray-200 dark:bg-gray-700 rounded-full" />
        </div>
        <div className="h-48 w-full bg-gray-200 dark:bg-gray-700 rounded-xl" />
      </div>
      <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-800/60 flex gap-8">
        <div className="h-4 w-16 bg-gray-200 dark:bg-gray-700 rounded-full" />
        <div className="h-4 w-20 bg-gray-200 dark:bg-gray-700 rounded-full" />
        <div className="h-4 w-14 bg-gray-200 dark:bg-gray-700 rounded-full" />
      </div>
    </div>
  )
}

export default function CommunityChat({ parentSocket }: { parentSocket?: Socket | null }): JSX.Element {
  const { user: citizenUser } = useCitizenAuth()
  const adminUserStr = localStorage.getItem('aegis-user')
  let adminUser: any = null
  try { adminUser = adminUserStr ? JSON.parse(adminUserStr) : null } catch { adminUser = null }
  const user = citizenUser || adminUser
  const isAdmin = user && ['admin', 'operator'].includes(String(user?.role || '').toLowerCase())

  const [posts, setPosts] = useState<Post[]>([])
  const [filteredPosts, setFilteredPosts] = useState<Post[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [filterMode, setFilterMode] = useState<'all' | 'hazards' | 'reported'>('all')
  const [postContent, setPostContent] = useState('')
  const [selectedImage, setSelectedImage] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string>('')
  const [location, setLocation] = useState('')
  const [isHazardUpdate, setIsHazardUpdate] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isInitialLoad, setIsInitialLoad] = useState(true)
  const [error, setError] = useState<string>('')
  const [successMsg, setSuccessMsg] = useState<string>('')
  const [expandedPost, setExpandedPost] = useState<string | null>(null)
  const [comments, setComments] = useState<{ [key: string]: Comment[] }>({})
  const [commentInput, setCommentInput] = useState<{ [key: string]: string }>({})
  const [imageZoom, setImageZoom] = useState<string | null>(null)
  const [showDropdown, setShowDropdown] = useState<string | null>(null)
  const [likeAnimating, setLikeAnimating] = useState<string | null>(null)
  const [showCreateAdvanced, setShowCreateAdvanced] = useState(false)
  const [reportModal, setReportModal] = useState<{ postId: string } | null>(null)
  const [reportReason, setReportReason] = useState('')
  const [reportDetails, setReportDetails] = useState('')
  const [reportLoading, setReportLoading] = useState(false)
  const [deleteModal, setDeleteModal] = useState<{ postId: string; isOwner: boolean } | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [editModal, setEditModal] = useState<{ postId: string; content: string; location: string } | null>(null)
  const [editContent, setEditContent] = useState('')
  const [editLocation, setEditLocation] = useState('')
  const [editLoading, setEditLoading] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const authHeaders = useCallback(() => ({
    Authorization: `Bearer ${localStorage.getItem('aegis-citizen-token') || localStorage.getItem('aegis-token') || localStorage.getItem('token')}`
  }), [])

  // Close dropdown on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Auto-clear success message
  useEffect(() => {
    if (successMsg) {
      const t = setTimeout(() => setSuccessMsg(''), 3000)
      return () => clearTimeout(t)
    }
  }, [successMsg])

  // ─── Real-time Socket Listeners for Likes & Comments ───────────────
  useEffect(() => {
    if (!parentSocket) return

    // Listen for real-time like updates from other users
    const handleLiked = (data: { postId: string; userId: string; liked: boolean; likes_count: number; likerName?: string }) => {
      setPosts(prev => prev.map(p =>
        p.id === data.postId
          ? {
              ...p,
              likes_count: data.likes_count,
              // Update is_liked_by_user only if the event is about the current user
              is_liked_by_user: data.userId === user?.id ? data.liked : p.is_liked_by_user,
            }
          : p
      ))
    }

    // Listen for real-time comment updates from other users
    const handleCommented = (data: { postId: string; comment: Comment; comments_count: number }) => {
      setPosts(prev => prev.map(p =>
        p.id === data.postId ? { ...p, comments_count: data.comments_count } : p
      ))
      // Add comment to local cache if we have comments loaded for this post
      setComments(prev => {
        if (!prev[data.postId]) return prev
        // Avoid duplicates
        if (prev[data.postId].some(c => c.id === data.comment.id)) return prev
        return { ...prev, [data.postId]: [...prev[data.postId], data.comment] }
      })
    }

    // Listen for notifications about interactions on YOUR posts
    const handleNotification = (data: { type: string; postId: string; actorName: string; message: string }) => {
      setSuccessMsg(`${data.message}`)
    }

    parentSocket.on('community:post:liked', handleLiked)
    parentSocket.on('community:post:commented', handleCommented)
    parentSocket.on('community:post:notification', handleNotification)

    return () => {
      parentSocket.off('community:post:liked', handleLiked)
      parentSocket.off('community:post:commented', handleCommented)
      parentSocket.off('community:post:notification', handleNotification)
    }
  }, [parentSocket, user?.id])

  useEffect(() => {
    fetchPosts()
    const interval = setInterval(fetchPosts, 12000)
    return () => clearInterval(interval)
  }, [])

  // Filter posts
  useEffect(() => {
    let filtered = [...posts]
    if (filterMode === 'hazards') {
      filtered = filtered.filter(p => p.is_hazard_update)
    } else if (filterMode === 'reported' && isAdmin) {
      filtered = filtered.filter(p => Number(p.reports_count) > 0)
    }
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase()
      filtered = filtered.filter(p =>
        p.content.toLowerCase().includes(q) ||
        p.author_name.toLowerCase().includes(q) ||
        p.location?.toLowerCase().includes(q)
      )
    }
    filtered.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    setFilteredPosts(filtered)
  }, [posts, searchTerm, filterMode, isAdmin])

  const fetchPosts = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/community/posts`, { headers: authHeaders() })
      if (res.ok) {
        const data = await res.json()
        // Normalize counts — PostgreSQL returns COUNT as string
        const normalized = (data.posts || []).map((p: any) => ({
          ...p,
          likes_count: Number(p.likes_count) || 0,
          comments_count: Number(p.comments_count) || 0,
          shares_count: Number(p.shares_count) || 0,
          reports_count: Number(p.reports_count) || 0,
        }))
        setPosts(normalized)
      }
    } catch (err) {
      console.error('Failed to fetch posts:', err)
    } finally {
      setIsInitialLoad(false)
    }
  }

  const fetchComments = async (postId: string) => {
    if (comments[postId]) return
    try {
      const res = await fetch(`${API_BASE}/api/community/posts/${postId}/comments`, { headers: authHeaders() })
      if (res.ok) {
        const data = await res.json()
        setComments(prev => ({ ...prev, [postId]: data.comments || [] }))
      }
    } catch (err) {
      console.error('Failed to fetch comments:', err)
    }
  }

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) { setError('Please select an image file'); return }
    if (file.size > 10 * 1024 * 1024) { setError('Image must be less than 10MB'); return }
    setSelectedImage(file)
    const reader = new FileReader()
    reader.onload = (evt) => setPreviewUrl(evt.target?.result as string)
    reader.readAsDataURL(file)
  }

  const handlePostMessage = async () => {
    if (!postContent.trim() && !selectedImage) {
      setError('Please enter a message or select an image')
      return
    }
    setIsLoading(true)
    setError('')
    try {
      const formData = new FormData()
      formData.append('content', postContent.trim())
      if (location.trim()) formData.append('location', location.trim())
      if (isHazardUpdate) formData.append('is_hazard_update', 'true')
      if (selectedImage) formData.append('image', selectedImage)
      const res = await fetch(`${API_BASE}/api/community/posts`, {
        method: 'POST',
        body: formData,
        headers: authHeaders()
      })
      if (!res.ok) throw new Error('Failed to post message')
      const newPost = await res.json()
      setPosts(prev => [{ ...newPost, reports_count: 0, is_reported_by_user: false }, ...prev])
      setPostContent('')
      setSelectedImage(null)
      setPreviewUrl('')
      setLocation('')
      setIsHazardUpdate(false)
      setShowCreateAdvanced(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
      setSuccessMsg('Post shared successfully!')
    } catch (err: any) {
      setError(err.message || 'Failed to post message')
    } finally {
      setIsLoading(false)
    }
  }

  const handleLikePost = async (postId: string) => {
    const post = posts.find(p => p.id === postId)
    const wasLiked = post?.is_liked_by_user || false
    setLikeAnimating(postId)
    // Optimistic update
    setPosts(prev =>
      prev.map(p =>
        p.id === postId
          ? { ...p, is_liked_by_user: !p.is_liked_by_user, likes_count: p.is_liked_by_user ? Number(p.likes_count) - 1 : Number(p.likes_count) + 1 }
          : p
      )
    )
    setTimeout(() => setLikeAnimating(null), 600)
    try {
      const res = await fetch(`${API_BASE}/api/community/posts/${postId}/like`, { method: 'POST', headers: authHeaders() })
      if (!res.ok) {
        // Revert optimistic update
        setPosts(prev =>
          prev.map(p =>
            p.id === postId
              ? { ...p, is_liked_by_user: wasLiked, likes_count: wasLiked ? Number(p.likes_count) + 1 : Number(p.likes_count) - 1 }
              : p
          )
        )
      } else {
        const data = await res.json()
        // Update with server-confirmed count
        setPosts(prev =>
          prev.map(p =>
            p.id === postId
              ? { ...p, likes_count: Number(data.likes_count), is_liked_by_user: data.liked }
              : p
          )
        )
        // Show toast
        setSuccessMsg(data.liked ? 'Post liked!' : 'Like removed')
      }
    } catch {
      // Revert on network error
      setPosts(prev =>
        prev.map(p =>
          p.id === postId
            ? { ...p, is_liked_by_user: wasLiked, likes_count: wasLiked ? Number(p.likes_count) + 1 : Number(p.likes_count) - 1 }
            : p
        )
      )
    }
  }

  const handlePostComment = async (postId: string) => {
    const content = commentInput[postId]?.trim()
    if (!content) return
    try {
      const res = await fetch(`${API_BASE}/api/community/posts/${postId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ content })
      })
      if (!res.ok) throw new Error('Failed to post comment')
      const newComment = await res.json()
      setComments(prev => {
        const existing = prev[postId] || []
        if (existing.some(c => c.id === newComment.id)) return prev
        return { ...prev, [postId]: [...existing, newComment] }
      })
      setCommentInput(prev => ({ ...prev, [postId]: '' }))
      setPosts(prev => prev.map(p => p.id === postId ? { ...p, comments_count: Number(p.comments_count) + 1 } : p))
      setSuccessMsg('Comment posted!')
    } catch (err) {
      console.error('Failed to post comment:', err)
    }
  }

  const handleReportPost = async () => {
    if (!reportModal || !reportReason) return
    setReportLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/community/posts/${reportModal.postId}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ reason: reportReason, details: reportDetails.trim() || undefined })
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to report post')
      }
      const data = await res.json()
      setPosts(prev => prev.map(p =>
        p.id === reportModal.postId ? { ...p, reports_count: data.reports_count, is_reported_by_user: true } : p
      ))
      setReportModal(null)
      setReportReason('')
      setReportDetails('')
      setSuccessMsg('Post reported. Our team will review it.')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setReportLoading(false)
    }
  }

  const handleDeletePost = async () => {
    if (!deleteModal) return
    setDeleteLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/community/posts/${deleteModal.postId}`, {
        method: 'DELETE',
        headers: authHeaders()
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to delete post')
      }
      setPosts(prev => prev.filter(p => p.id !== deleteModal.postId))
      setDeleteModal(null)
      setSuccessMsg('Post deleted successfully')
    } catch (err: any) {
      setError(err.message)
      setDeleteModal(null)
    } finally {
      setDeleteLoading(false)
    }
  }

  const openEditModal = (post: Post) => {
    setEditModal({ postId: post.id, content: post.content, location: post.location || '' })
    setEditContent(post.content)
    setEditLocation(post.location || '')
    setShowDropdown(null)
  }

  const handleEditPost = async () => {
    if (!editModal || !editContent.trim()) return
    setEditLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/community/posts/${editModal.postId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ content: editContent.trim(), location: editLocation.trim() || null })
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to edit post')
      }
      const data = await res.json()
      setPosts(prev => prev.map(p =>
        p.id === editModal.postId
          ? { ...p, content: data.content, location: data.location, updated_at: data.updated_at }
          : p
      ))
      setEditModal(null)
      setEditContent('')
      setEditLocation('')
      setSuccessMsg('Post updated successfully!')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setEditLoading(false)
    }
  }

  const charCount = postContent.length
  const maxChars = 2000
  const userName = user?.displayName || user?.display_name || 'You'

  return (
    <div className="max-w-2xl mx-auto space-y-5 pb-8">

      {/* Success Toast */}
      {successMsg && (
        <div className="fixed top-4 right-4 z-[100]">
          <div className="flex items-center gap-2.5 px-4 py-3 bg-emerald-50 dark:bg-emerald-900/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 rounded-xl shadow-lg shadow-emerald-100/50 dark:shadow-emerald-900/30 text-sm font-medium">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            {successMsg}
          </div>
        </div>
      )}

      {/* ═══ CREATE POST CARD ═══ */}
      <div className="bg-white dark:bg-gray-900/80 rounded-2xl border border-gray-100 dark:border-gray-800/60 shadow-sm hover:shadow-md transition-shadow duration-300 overflow-hidden backdrop-blur-sm">
        <div className="p-5 pb-0">
          <div className="flex items-center gap-3 mb-4">
            <div className={`w-11 h-11 rounded-full bg-gradient-to-br ${getAvatarGradient(userName)} flex items-center justify-center flex-shrink-0 ring-2 ring-white dark:ring-gray-800 shadow-md`}>
              <span className="text-white font-bold text-sm">{getInitials(userName)}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm text-gray-900 dark:text-gray-100 truncate">{userName}</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1">
                <Globe className="w-3 h-3" />
                Share with the community
              </p>
            </div>
          </div>

          <div className="relative">
            <textarea
              value={postContent}
              onChange={(e) => { if (e.target.value.length <= maxChars) setPostContent(e.target.value) }}
              placeholder="What's happening in your area? Report hazards, share updates, ask for help..."
              className="w-full px-0 py-2 bg-transparent border-none resize-none text-[15px] leading-relaxed text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none min-h-[80px]"
              rows={3}
            />
            {charCount > 0 && (
              <div className={`absolute bottom-1 right-0 text-[10px] font-medium transition-colors ${charCount > maxChars * 0.9 ? 'text-amber-500' : 'text-gray-300 dark:text-gray-600'}`}>
                {charCount}/{maxChars}
              </div>
            )}
          </div>
        </div>

        {/* Image Preview */}
        {previewUrl && (
          <div className="px-5 pb-3">
            <div className="relative group rounded-xl overflow-hidden border border-gray-100 dark:border-gray-800">
              <img src={previewUrl} alt="Preview" className="w-full h-48 object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <button
                onClick={() => { setSelectedImage(null); setPreviewUrl('') }}
                className="absolute top-2 right-2 p-1.5 bg-black/50 hover:bg-black/70 text-white rounded-full transition-all duration-200 backdrop-blur-sm"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Advanced Options */}
        {showCreateAdvanced && (
          <div className="px-5 pb-3 space-y-3">
            <label className="flex items-center gap-3 p-3 rounded-xl bg-amber-50/60 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-900/30 cursor-pointer hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors">
              <input
                type="checkbox"
                checked={isHazardUpdate}
                onChange={(e) => setIsHazardUpdate(e.target.checked)}
                className="w-4 h-4 rounded accent-amber-600"
              />
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              <div>
                <span className="text-sm font-medium text-amber-800 dark:text-amber-300">Hazard Update</span>
                <p className="text-[11px] text-amber-600/70 dark:text-amber-400/60">Mark as an emergency or hazard report</p>
              </div>
            </label>
            <div className="relative">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Add location (optional)"
                className="w-full pl-10 pr-3 py-2.5 text-sm bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-100 dark:border-gray-700/50 focus:outline-none focus:ring-2 focus:ring-aegis-500/30 focus:border-aegis-500 transition-all"
              />
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mx-5 mb-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800/40 text-red-600 dark:text-red-400 text-xs rounded-xl flex items-center gap-2">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            <span>{error}</span>
            <button onClick={() => setError('')} className="ml-auto p-0.5 hover:bg-red-100 dark:hover:bg-red-800/30 rounded-full transition-colors">
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* Action Bar */}
        <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-800/60 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading}
              className="p-2.5 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-xl transition-all duration-200 group disabled:opacity-50"
              title="Add photo"
            >
              <Camera className="w-5 h-5 text-blue-500 group-hover:text-blue-600 transition-colors" />
            </button>
            <button
              onClick={() => setShowCreateAdvanced(!showCreateAdvanced)}
              className={`p-2.5 rounded-xl transition-all duration-200 group ${showCreateAdvanced ? 'bg-aegis-50 dark:bg-aegis-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'}`}
              title="More options"
            >
              <Sparkles className={`w-5 h-5 transition-colors ${showCreateAdvanced ? 'text-aegis-600' : 'text-gray-400 group-hover:text-gray-500'}`} />
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageSelect} className="hidden" />
          </div>
          <button
            onClick={handlePostMessage}
            disabled={(!postContent.trim() && !selectedImage) || isLoading}
            className="px-5 py-2 bg-gradient-to-r from-aegis-600 to-aegis-700 hover:from-aegis-700 hover:to-aegis-800 text-white text-sm font-semibold rounded-xl transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm hover:shadow-md disabled:shadow-none flex items-center gap-2 active:scale-[0.97]"
          >
            {isLoading ? (
              <><Loader2 className="w-4 h-4 animate-spin" /><span>Posting...</span></>
            ) : (
              <><Send className="w-4 h-4" /><span>Post</span></>
            )}
          </button>
        </div>
      </div>

      {/* ═══ FILTER PILLS + SEARCH ═══ */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 flex-1 overflow-x-auto">
          <button
            onClick={() => setFilterMode('all')}
            className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl whitespace-nowrap transition-all duration-200 ${filterMode === 'all'
              ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900 shadow-sm'
              : 'bg-gray-100 dark:bg-gray-800/60 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700/60'}`}
          >
            <Flame className="w-3.5 h-3.5" />
            All Posts
          </button>
          <button
            onClick={() => setFilterMode('hazards')}
            className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl whitespace-nowrap transition-all duration-200 ${filterMode === 'hazards'
              ? 'bg-amber-500 text-white shadow-sm shadow-amber-200 dark:shadow-amber-900/30'
              : 'bg-amber-50 dark:bg-amber-900/15 text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/25'}`}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            Hazards
          </button>
          {isAdmin && (
            <button
              onClick={() => setFilterMode('reported')}
              className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl whitespace-nowrap transition-all duration-200 ${filterMode === 'reported'
                ? 'bg-red-500 text-white shadow-sm shadow-red-200 dark:shadow-red-900/30'
                : 'bg-red-50 dark:bg-red-900/15 text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/25'}`}
            >
              <Flag className="w-3.5 h-3.5" />
              Reported
              {posts.filter(p => Number(p.reports_count) > 0).length > 0 && (
                <span className="ml-0.5 px-1.5 py-0.5 text-[10px] font-bold bg-white/20 rounded-full">
                  {posts.filter(p => Number(p.reports_count) > 0).length}
                </span>
              )}
            </button>
          )}
        </div>
        <div className="relative flex-shrink-0">
          <button
            onClick={() => setSearchTerm(searchTerm ? '' : ' ')}
            className="p-2.5 rounded-xl bg-gray-100 dark:bg-gray-800/60 hover:bg-gray-200 dark:hover:bg-gray-700 transition-all"
          >
            <Search className="w-4 h-4 text-gray-500" />
          </button>
        </div>
      </div>

      {/* Search Bar */}
      {searchTerm !== '' && (
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search posts, names, locations..."
            value={searchTerm.trim() ? searchTerm : ''}
            onChange={(e) => setSearchTerm(e.target.value)}
            autoFocus
            className="w-full pl-10 pr-10 py-2.5 text-sm bg-white dark:bg-gray-900/80 rounded-xl border border-gray-200 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-aegis-500/30 focus:border-aegis-500 transition-all shadow-sm"
          />
          <button onClick={() => setSearchTerm('')} className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors">
            <X className="w-3.5 h-3.5 text-gray-400" />
          </button>
        </div>
      )}

      {/* ═══ POST FEED ═══ */}
      <div className="space-y-4">
        {isInitialLoad ? (
          <div className="space-y-4">
            <PostSkeleton />
            <PostSkeleton />
            <PostSkeleton />
          </div>
        ) : filteredPosts.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-gray-100 to-gray-50 dark:from-gray-800 dark:to-gray-800/50 flex items-center justify-center shadow-inner">
              <MessageSquare className="w-8 h-8 text-gray-300 dark:text-gray-600" />
            </div>
            <h3 className="text-base font-semibold text-gray-700 dark:text-gray-300 mb-1">
              {filterMode === 'hazards' ? 'No hazard updates' : filterMode === 'reported' ? 'No reported posts' : 'No posts yet'}
            </h3>
            <p className="text-sm text-gray-400 dark:text-gray-500 max-w-xs mx-auto">
              {filterMode === 'all' ? 'Be the first to share something with the community!' : 'Nothing to show for this filter.'}
            </p>
          </div>
        ) : (
          filteredPosts.map((post) => {
            const isOwner = user?.id === post.author_id
            const reportCount = Number(post.reports_count) || 0
            const isReported = reportCount > 0
            const canAdminDelete = isAdmin && isReported

            return (
              <div
                key={post.id}
                className={`bg-white dark:bg-gray-900/80 rounded-2xl border overflow-hidden transition-all duration-300 backdrop-blur-sm group/card ${isReported && isAdmin
                  ? 'border-red-200 dark:border-red-900/40 shadow-sm shadow-red-100/50 dark:shadow-red-900/20'
                  : 'border-gray-100 dark:border-gray-800/60 shadow-sm hover:shadow-md'}`}
              >
                {/* Report Banner (admin only) */}
                {isAdmin && isReported && (
                  <div className="px-4 py-2 bg-gradient-to-r from-red-50 to-orange-50 dark:from-red-900/20 dark:to-orange-900/10 border-b border-red-100 dark:border-red-900/30 flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 text-red-500" />
                    <span className="text-xs font-semibold text-red-700 dark:text-red-400">
                      {reportCount} report{reportCount !== 1 ? 's' : ''} received
                    </span>
                    <span className="text-[10px] text-red-500/60 dark:text-red-400/40 ml-1">Review &amp; take action</span>
                  </div>
                )}

                {/* Post Header */}
                <div className="p-4 pb-0">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-11 h-11 rounded-full bg-gradient-to-br ${getAvatarGradient(post.author_name)} flex items-center justify-center flex-shrink-0 ring-2 ring-white dark:ring-gray-800 shadow-sm`}>
                        <span className="text-white font-bold text-xs">{getInitials(post.author_name)}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-sm text-gray-900 dark:text-gray-100 truncate">{post.author_name}</p>
                          {post.author_role && post.author_role !== 'citizen' ? (
                            <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-md ${post.author_role === 'admin'
                              ? 'bg-gradient-to-r from-red-100 to-rose-100 text-red-700 dark:from-red-900/30 dark:to-rose-900/30 dark:text-red-300'
                              : 'bg-gradient-to-r from-blue-100 to-cyan-100 text-blue-700 dark:from-blue-900/30 dark:to-cyan-900/30 dark:text-blue-300'}`}>
                              <Shield className="w-2.5 h-2.5" />
                              {post.author_role === 'admin' ? 'Admin' : 'Ops'}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-0.5 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-md bg-gradient-to-r from-emerald-50 to-green-50 text-emerald-700 dark:from-emerald-900/20 dark:to-green-900/20 dark:text-emerald-400">
                              <User className="w-2.5 h-2.5" />
                              Citizen
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 text-[11px] text-gray-400 dark:text-gray-500 mt-0.5 flex-wrap">
                          <span>{timeAgo(post.created_at)}</span>
                          {post.location && (
                            <>
                              <span className="text-gray-300 dark:text-gray-600">&middot;</span>
                              <span className="flex items-center gap-0.5"><MapPin className="w-2.5 h-2.5" />{post.location}</span>
                            </>
                          )}
                          {post.is_hazard_update && (
                            <>
                              <span className="text-gray-300 dark:text-gray-600">&middot;</span>
                              <span className="flex items-center gap-0.5 text-amber-500 font-semibold"><AlertTriangle className="w-2.5 h-2.5" />HAZARD</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* More Menu */}
                    <div className="relative" ref={showDropdown === post.id ? dropdownRef : null}>
                      <button
                        onClick={() => setShowDropdown(showDropdown === post.id ? null : post.id)}
                        className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-all opacity-0 group-hover/card:opacity-100 focus:opacity-100"
                      >
                        <MoreHorizontal className="w-5 h-5 text-gray-400" />
                      </button>

                      {showDropdown === post.id && (
                        <div className="absolute right-0 top-full mt-1 w-52 bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-xl shadow-gray-200/50 dark:shadow-black/30 z-30 overflow-hidden">
                          {isOwner && (
                            <button
                              onClick={() => openEditModal(post)}
                              className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                            >
                              <Pencil className="w-4 h-4" />
                              Edit post
                            </button>
                          )}
                          {isOwner && (
                            <button
                              onClick={() => { setDeleteModal({ postId: post.id, isOwner: true }); setShowDropdown(null) }}
                              className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                              Delete post
                            </button>
                          )}
                          {canAdminDelete && !isOwner && (
                            <button
                              onClick={() => { setDeleteModal({ postId: post.id, isOwner: false }); setShowDropdown(null) }}
                              className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                            >
                              <ShieldAlert className="w-4 h-4" />
                              Remove (reported)
                            </button>
                          )}
                          {!isOwner && !post.is_reported_by_user && (
                            <button
                              onClick={() => { setReportModal({ postId: post.id }); setShowDropdown(null) }}
                              className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                            >
                              <Flag className="w-4 h-4" />
                              Report post
                            </button>
                          )}
                          {!isOwner && post.is_reported_by_user && (
                            <div className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-400 dark:text-gray-500">
                              <CheckCircle2 className="w-4 h-4 text-amber-500" />
                              Already reported
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Post Content */}
                <div className="px-4 pt-3 pb-2">
                  <p className="text-[15px] leading-relaxed text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words">{post.content}</p>
                  {post.updated_at && post.updated_at !== post.created_at && new Date(post.updated_at).getTime() - new Date(post.created_at).getTime() > 2000 && (
                    <span className="inline-flex items-center gap-1 mt-1.5 text-[10px] text-gray-400 dark:text-gray-500 italic">
                      <Pencil className="w-2.5 h-2.5" /> edited
                    </span>
                  )}
                </div>

                {/* Post Image */}
                {post.image_url && (
                  <div className="px-4 pb-3">
                    <button
                      onClick={() => setImageZoom(post.image_url!)}
                      className="relative group/img w-full cursor-zoom-in rounded-xl overflow-hidden border border-gray-100 dark:border-gray-800/50"
                    >
                      <img src={post.image_url} alt="Post" className="w-full h-auto max-h-[28rem] object-cover transition-transform duration-500 group-hover/img:scale-[1.02]" loading="lazy" />
                      <div className="absolute inset-0 bg-black/0 group-hover/img:bg-black/10 transition-all duration-300 flex items-center justify-center">
                        <div className="w-10 h-10 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover/img:opacity-100 transition-all duration-300 scale-75 group-hover/img:scale-100">
                          <ZoomIn className="w-5 h-5 text-white" />
                        </div>
                      </div>
                    </button>
                  </div>
                )}

                {/* Engagement Stats */}
                {(Number(post.likes_count) > 0 || Number(post.comments_count) > 0) && (
                  <div className="px-4 pb-2 flex items-center justify-between text-[11px] text-gray-400 dark:text-gray-500">
                    {Number(post.likes_count) > 0 && (
                      <div className="flex items-center gap-1">
                        <div className="w-4 h-4 rounded-full bg-gradient-to-br from-pink-500 to-red-500 flex items-center justify-center">
                          <Heart className="w-2.5 h-2.5 text-white fill-white" />
                        </div>
                        <span>{post.likes_count}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-3 ml-auto">
                      {Number(post.comments_count) > 0 && (
                        <button onClick={() => { setExpandedPost(expandedPost === post.id ? null : post.id); if (!comments[post.id]) fetchComments(post.id) }} className="hover:underline">
                          {post.comments_count} comment{Number(post.comments_count) !== 1 ? 's' : ''}
                        </button>
                      )}
                      {Number(post.shares_count) > 0 && (
                        <span>{post.shares_count} share{Number(post.shares_count) !== 1 ? 's' : ''}</span>
                      )}
                    </div>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="mx-4 py-1 border-t border-gray-100 dark:border-gray-800/60 flex items-center">
                  <button
                    onClick={() => handleLikePost(post.id)}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg transition-all duration-200 text-[13px] font-medium group/btn ${post.is_liked_by_user
                      ? 'text-pink-600 dark:text-pink-400 hover:bg-pink-50 dark:hover:bg-pink-900/15'
                      : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/50 hover:text-pink-500'}`}
                  >
                    <Heart className={`w-[18px] h-[18px] transition-all duration-300 ${post.is_liked_by_user ? 'fill-pink-500 text-pink-500' : 'group-hover/btn:scale-110'} ${likeAnimating === post.id ? 'scale-125' : ''}`} />
                    <span>{post.is_liked_by_user ? 'Liked' : 'Like'}</span>
                  </button>
                  <button
                    onClick={() => { setExpandedPost(expandedPost === post.id ? null : post.id); if (!comments[post.id]) fetchComments(post.id) }}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-blue-50 dark:hover:bg-blue-900/15 hover:text-blue-600 dark:hover:text-blue-400 transition-all duration-200 text-[13px] font-medium"
                  >
                    <MessageCircle className="w-[18px] h-[18px]" />
                    <span>Comment</span>
                  </button>
                  <button className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/15 hover:text-emerald-600 dark:hover:text-emerald-400 transition-all duration-200 text-[13px] font-medium">
                    <Share2 className="w-[18px] h-[18px]" />
                    <span>Share</span>
                  </button>
                </div>

                {/* Comments Section */}
                {expandedPost === post.id && (
                  <div className="border-t border-gray-100 dark:border-gray-800/60 bg-gray-50/50 dark:bg-gray-950/30">
                    <div className="px-4 pt-3 space-y-3 max-h-72 overflow-y-auto">
                      {!comments[post.id] ? (
                        <div className="flex items-center justify-center py-4">
                          <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                        </div>
                      ) : comments[post.id].length === 0 ? (
                        <p className="text-center text-xs text-gray-400 py-4">No comments yet. Be the first!</p>
                      ) : (
                        comments[post.id].map((comment) => (
                          <div key={comment.id} className="flex gap-2.5">
                            <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${getAvatarGradient(comment.author_name)} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                              <span className="text-white font-bold text-[10px]">{getInitials(comment.author_name)}</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="inline-block bg-white dark:bg-gray-800 rounded-2xl rounded-tl-md px-3.5 py-2 shadow-sm border border-gray-100 dark:border-gray-700/50">
                                <p className="text-xs font-semibold text-gray-900 dark:text-gray-100">{comment.author_name}</p>
                                <p className="text-[13px] text-gray-700 dark:text-gray-300 mt-0.5 break-words">{comment.content}</p>
                              </div>
                              <div className="flex items-center gap-3 mt-1 ml-1">
                                <span className="text-[10px] text-gray-400">{timeAgo(comment.created_at)}</span>
                                <button className="text-[10px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 font-semibold transition-colors">Like</button>
                                <button className="text-[10px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 font-semibold transition-colors">Reply</button>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                    <div className="px-4 py-3 flex items-center gap-2.5">
                      <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${getAvatarGradient(userName)} flex items-center justify-center flex-shrink-0`}>
                        <span className="text-white font-bold text-[10px]">{getInitials(userName)}</span>
                      </div>
                      <div className="flex-1 relative">
                        <input
                          type="text"
                          value={commentInput[post.id] || ''}
                          onChange={(e) => setCommentInput(prev => ({ ...prev, [post.id]: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handlePostComment(post.id) } }}
                          placeholder="Write a comment..."
                          className="w-full px-4 py-2.5 pr-10 text-[13px] bg-white dark:bg-gray-800 rounded-full border border-gray-200 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-aegis-500/30 focus:border-aegis-500 transition-all placeholder:text-gray-400"
                        />
                        <button
                          onClick={() => handlePostComment(post.id)}
                          disabled={!commentInput[post.id]?.trim()}
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded-full text-aegis-600 hover:bg-aegis-50 dark:hover:bg-aegis-900/20 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          <Send className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* ═══ IMAGE ZOOM MODAL ═══ */}
      {imageZoom && (
        <div
          className="fixed inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center z-50"
          onClick={() => setImageZoom(null)}
        >
          <div className="relative max-w-5xl max-h-[90vh] p-4" onClick={(e) => e.stopPropagation()}>
            <img src={imageZoom} alt="Zoomed" className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl" />
            <button
              onClick={() => setImageZoom(null)}
              className="absolute top-6 right-6 p-2.5 bg-black/40 hover:bg-black/60 text-white rounded-full transition-all backdrop-blur-sm"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      {/* ═══ REPORT POST MODAL ═══ */}
      {reportModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => { setReportModal(null); setReportReason(''); setReportDetails('') }}>
          <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-md shadow-2xl border border-gray-100 dark:border-gray-800 overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 pb-4 border-b border-gray-100 dark:border-gray-800">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-red-50 dark:bg-red-900/20 flex items-center justify-center">
                    <Flag className="w-5 h-5 text-red-500" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">Report Post</h3>
                    <p className="text-xs text-gray-400">Help us keep the community safe</p>
                  </div>
                </div>
                <button onClick={() => { setReportModal(null); setReportReason(''); setReportDetails('') }} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors">
                  <X className="w-4 h-4 text-gray-400" />
                </button>
              </div>
            </div>
            <div className="p-5 space-y-2 max-h-[50vh] overflow-y-auto">
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">Select a reason</p>
              {REPORT_REASONS.map((r) => {
                const Icon = r.icon
                return (
                  <button
                    key={r.value}
                    onClick={() => setReportReason(r.value)}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all duration-200 text-left ${reportReason === r.value
                      ? 'border-red-300 dark:border-red-700 bg-red-50/50 dark:bg-red-900/15 ring-1 ring-red-200 dark:ring-red-800'
                      : 'border-gray-100 dark:border-gray-800 hover:border-gray-200 dark:hover:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50'}`}
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${reportReason === r.value ? 'bg-red-100 dark:bg-red-900/30 text-red-600' : 'bg-gray-100 dark:bg-gray-800 text-gray-500'}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1">
                      <p className={`text-sm font-medium ${reportReason === r.value ? 'text-red-700 dark:text-red-300' : 'text-gray-700 dark:text-gray-300'}`}>{r.label}</p>
                      <p className="text-[11px] text-gray-400">{r.desc}</p>
                    </div>
                    {reportReason === r.value && <CheckCircle2 className="w-5 h-5 text-red-500 flex-shrink-0" />}
                  </button>
                )
              })}
              {reportReason && (
                <div className="pt-3">
                  <textarea
                    value={reportDetails}
                    onChange={(e) => setReportDetails(e.target.value)}
                    placeholder="Add details (optional)..."
                    className="w-full px-3 py-2.5 text-sm bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-100 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-300 min-h-[60px] resize-none transition-all"
                    rows={2}
                  />
                </div>
              )}
            </div>
            <div className="p-5 pt-3 border-t border-gray-100 dark:border-gray-800 flex items-center gap-3">
              <button onClick={() => { setReportModal(null); setReportReason(''); setReportDetails('') }} className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 rounded-xl hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">
                Cancel
              </button>
              <button
                onClick={handleReportPost}
                disabled={!reportReason || reportLoading}
                className="flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-red-600 to-red-700 rounded-xl hover:from-red-700 hover:to-red-800 transition-all shadow-sm disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {reportLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Flag className="w-4 h-4" />}
                Report
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ EDIT POST MODAL ═══ */}
      {editModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => { setEditModal(null); setEditContent(''); setEditLocation('') }}>
          <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-lg shadow-2xl border border-gray-100 dark:border-gray-800 overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 pb-4 border-b border-gray-100 dark:border-gray-800">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
                    <Pencil className="w-5 h-5 text-blue-500" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">Edit Post</h3>
                    <p className="text-xs text-gray-400">Update your post content or location</p>
                  </div>
                </div>
                <button onClick={() => { setEditModal(null); setEditContent(''); setEditLocation('') }} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors">
                  <X className="w-4 h-4 text-gray-400" />
                </button>
              </div>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 block">Content</label>
                <textarea
                  value={editContent}
                  onChange={(e) => { if (e.target.value.length <= maxChars) setEditContent(e.target.value) }}
                  className="w-full px-3.5 py-3 text-[15px] leading-relaxed bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-200 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 min-h-[120px] resize-none transition-all text-gray-900 dark:text-gray-100"
                  rows={4}
                />
                <div className="flex justify-end mt-1">
                  <span className={`text-[10px] font-medium ${editContent.length > maxChars * 0.9 ? 'text-amber-500' : 'text-gray-300 dark:text-gray-600'}`}>
                    {editContent.length}/{maxChars}
                  </span>
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 block">Location</label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={editLocation}
                    onChange={(e) => setEditLocation(e.target.value)}
                    placeholder="Add location (optional)"
                    className="w-full pl-10 pr-3 py-2.5 text-sm bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-200 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all text-gray-900 dark:text-gray-100"
                  />
                </div>
              </div>
            </div>
            <div className="p-5 pt-3 border-t border-gray-100 dark:border-gray-800 flex items-center gap-3">
              <button onClick={() => { setEditModal(null); setEditContent(''); setEditLocation('') }} className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 rounded-xl hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">
                Cancel
              </button>
              <button
                onClick={handleEditPost}
                disabled={!editContent.trim() || editLoading}
                className="flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-blue-600 to-blue-700 rounded-xl hover:from-blue-700 hover:to-blue-800 transition-all shadow-sm disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {editLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Pencil className="w-4 h-4" />}
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ DELETE CONFIRMATION MODAL ═══ */}
      {deleteModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setDeleteModal(null)}>
          <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-sm shadow-2xl border border-gray-100 dark:border-gray-800 overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 text-center">
              <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-red-50 to-red-100 dark:from-red-900/20 dark:to-red-900/10 flex items-center justify-center">
                <Trash2 className="w-7 h-7 text-red-500" />
              </div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-2">
                {deleteModal.isOwner ? 'Delete your post?' : 'Remove reported post?'}
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 leading-relaxed">
                {deleteModal.isOwner
                  ? 'This action cannot be undone. Your post will be permanently removed.'
                  : 'This post has been reported by community members. This action cannot be undone.'}
              </p>
              <div className="flex items-center gap-3">
                <button onClick={() => setDeleteModal(null)} className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 rounded-xl hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">
                  Cancel
                </button>
                <button
                  onClick={handleDeletePost}
                  disabled={deleteLoading}
                  className="flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-red-600 to-red-700 rounded-xl hover:from-red-700 hover:to-red-800 transition-all shadow-sm disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {deleteLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
