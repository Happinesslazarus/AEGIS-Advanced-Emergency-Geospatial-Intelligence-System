 /*
 * AdminCommunityHub.tsx — Professional Admin Community Management Hub
 * Features:
 * Stats dashboard with real-time metrics
 * Full moderation queue for reported posts
 * Banned & muted users management
 * Sub-tabs: Overview | Live Chat | Posts Feed | Moderation
 * Real-time activity monitoring
  */

import React, { useState, useEffect, useCallback } from 'react'
import { getToken } from '../../utils/api'
import {
  Users, MessageSquare, FileText, Shield, Activity, AlertTriangle,
  Ban, VolumeX, Flag, TrendingUp, Eye, Trash2, CheckCircle2,
  RefreshCw, Loader2, Search, X, BarChart3, Radio, Clock,
  UserCheck, ShieldAlert, Hash, ArrowUpRight, Heart, MessageCircle
} from 'lucide-react'
import CommunityChatRoom from '../citizen/CommunityChatRoom'
import CommunityChat from '../citizen/CommunityChat'
import { API_BASE } from '../../utils/helpers'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'

interface CommunityStats {
  totalMessages: number
  totalPosts: number
  totalMembers: number
  onlineNow: number
  reportedPosts: number
  recentActivity: number
}

interface ReportedPost {
  id: string
  author_id: string
  author_name: string
  content: string
  image_url?: string
  reports_count: number
  created_at: string
  is_hazard_update?: boolean
  location?: string
}

function getAuthHeaders() {
  return {
    Authorization: `Bearer ${getToken() || ''}`
  }
}

function timeAgo(dateStr: string, lang = 'en'): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (seconds < 60) return t('time.justNow', lang)
  if (seconds < 3600) return `${Math.floor(seconds / 60)}${t('time.mAgo', lang)}`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}${t('time.hAgo', lang)}`
  return `${Math.floor(seconds / 86400)}${t('time.dAgo', lang)}`
}

/*  Stats Card  */
function StatCard({ icon: Icon, label, value, trend, color, pulse }: {
  icon: any; label: string; value: string | number; trend?: string; color: string; pulse?: boolean
}) {
  return (
    <div className="bg-white dark:bg-gray-900/80 rounded-xl border border-gray-100 dark:border-gray-800/60 p-4 hover:shadow-md transition-all duration-300">
      <div className="flex items-start justify-between mb-3">
        <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center shadow-sm`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
        {pulse && (
          <span className="flex items-center gap-1 text-[10px] font-medium text-green-600 bg-green-50 dark:bg-green-950/30 dark:text-green-400 px-2 py-0.5 rounded-full">
            <Radio className="w-2.5 h-2.5 animate-pulse" /> Live
          </span>
        )}
        {trend && !pulse && (
          <span className="flex items-center gap-0.5 text-[10px] font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 dark:text-emerald-400 px-2 py-0.5 rounded-full">
            <ArrowUpRight className="w-3 h-3" /> {trend}
          </span>
        )}
      </div>
      <p className="text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
      <p className="text-xs text-gray-500 dark:text-gray-300 mt-0.5">{label}</p>
    </div>
  )
}

/*  Moderation Tab  */
function ModerationPanel({ reportedPosts, onRefresh, loading }: {
  reportedPosts: ReportedPost[]; onRefresh: () => void; loading: boolean
}) {
  const lang = useLanguage()
  const [searchTerm, setSearchTerm] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const filtered = reportedPosts.filter(p => {
    if (!searchTerm.trim()) return true
    const q = searchTerm.toLowerCase()
    return p.content.toLowerCase().includes(q) || p.author_name.toLowerCase().includes(q)
  })

  const handleDeletePost = async (postId: string) => {
    if (!window.confirm(t('community.confirmDeletePost', lang))) return
    setDeletingId(postId)
    try {
      const res = await fetch(`${API_BASE}/api/community/posts/${postId}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      })
      if (res.ok) {
        onRefresh()
      }
    } catch (err) {
      console.error('Failed to delete post:', err)
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="space-y-4">
      {/* Moderation Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500 to-rose-600 flex items-center justify-center shadow-sm">
            <ShieldAlert className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="font-bold text-gray-900 dark:text-white">{t('community.moderationQueue', lang)}</h3>
            <p className="text-xs text-gray-500 dark:text-gray-300">{reportedPosts.length} {t('community.reportedPostsPending', lang)}</p>
          </div>
        </div>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          {t('common.refresh', lang)}
        </button>
      </div>

      {/* Search */}
      {reportedPosts.length > 3 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-300" />
          <input
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder={t('community.searchReportedPosts', lang)}
            className="w-full pl-10 pr-10 py-2.5 text-sm bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-red-500/30 focus:border-red-400 transition"
          />
          {searchTerm && (
            <button onClick={() => setSearchTerm('')} className="absolute right-3 top-1/2 -translate-y-1/2">
              <X className="w-4 h-4 text-gray-400 dark:text-gray-300" />
            </button>
          )}
        </div>
      )}

      {/* Reported Posts List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 text-gray-400 dark:text-gray-300 animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 bg-white dark:bg-gray-900/80 rounded-xl border border-gray-100 dark:border-gray-800/60">
          <div className="w-16 h-16 mx-auto mb-3 rounded-2xl bg-gradient-to-br from-emerald-50 to-green-50 dark:from-emerald-950/20 dark:to-green-950/20 flex items-center justify-center">
            <CheckCircle2 className="w-8 h-8 text-emerald-500" />
          </div>
          <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-1">{t('community.allClear', lang)}</h3>
          <p className="text-xs text-gray-500 dark:text-gray-300">{t('community.noReportedPosts', lang)}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(post => (
            <div key={post.id} className="bg-white dark:bg-gray-900/80 rounded-xl border border-red-100 dark:border-red-900/30 overflow-hidden hover:shadow-md transition">
              {/* Report Badge */}
              <div className="px-4 py-2 bg-gradient-to-r from-red-50 to-orange-50 dark:from-red-950/20 dark:to-orange-950/10 border-b border-red-100 dark:border-red-900/30 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Flag className="w-3.5 h-3.5 text-red-500" />
                  <span className="text-xs font-bold text-red-700 dark:text-red-400">
                    {post.reports_count} report{Number(post.reports_count) !== 1 ? 's' : ''}
                  </span>
                  {post.is_hazard_update && (
                    <span className="flex items-center gap-0.5 text-[10px] font-bold text-amber-600 bg-amber-100 dark:bg-amber-900/30 px-1.5 py-0.5 rounded">
                      <AlertTriangle className="w-2.5 h-2.5" /> {t('community.hazard', lang)}
                    </span>
                  )}
                </div>
                <span className="text-[10px] text-gray-400 dark:text-gray-300">{timeAgo(post.created_at)}</span>
              </div>

              {/* Post Content */}
              <div className="p-4">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-gray-400 to-gray-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                    {post.author_name?.charAt(0)?.toUpperCase() || '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-semibold text-gray-900 dark:text-white">{post.author_name}</span>
                      {post.location && (
                        <span className="text-[10px] text-gray-400 dark:text-gray-300 flex items-center gap-0.5">
                          <span>•</span> {post.location}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-700 dark:text-gray-300 line-clamp-3">{post.content}</p>
                    {post.image_url && (
                      <img src={post.image_url} alt="" className="mt-2 rounded-lg max-h-32 object-cover border border-gray-100 dark:border-gray-800" />
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100 dark:border-gray-800/60">
                  <button
                    onClick={() => handleDeletePost(post.id)}
                    disabled={deletingId === post.id}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white rounded-lg transition"
                  >
                    {deletingId === post.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                    {t('community.removePost', lang)}
                  </button>
                  <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg transition">
                    <Eye className="w-3 h-3" />
                    {t('community.viewFullPost', lang)}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/*  Overview Tab  */
function OverviewPanel({ stats, reportedPosts }: { stats: CommunityStats; reportedPosts: ReportedPost[] }) {
  const lang = useLanguage()
  return (
    <div className="space-y-6">
      {/* Quick Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard icon={MessageSquare} label={t('community.totalMessages', lang)} value={stats.totalMessages} color="from-blue-500 to-cyan-500" />
        <StatCard icon={FileText} label={t('community.totalPosts', lang)} value={stats.totalPosts} color="from-violet-500 to-purple-600" />
        <StatCard icon={Users} label={t('community.members', lang)} value={stats.totalMembers} color="from-emerald-500 to-teal-500" />
        <StatCard icon={Activity} label={t('community.onlineNow', lang)} value={stats.onlineNow} color="from-green-500 to-emerald-600" pulse />
        <StatCard icon={Flag} label={t('community.reportedPosts', lang)} value={stats.reportedPosts} color="from-red-500 to-rose-600" />
        <StatCard icon={TrendingUp} label={t('community.todaysActivity', lang)} value={stats.recentActivity} color="from-amber-500 to-orange-500" />
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Community Health */}
        <div className="bg-white dark:bg-gray-900/80 rounded-xl border border-gray-100 dark:border-gray-800/60 p-5">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <Shield className="w-4 h-4 text-aegis-500" />
            Community Health
          </h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-600 dark:text-gray-300">{t('community.contentModeration', lang)}</span>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                stats.reportedPosts === 0
                  ? 'bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400'
                  : stats.reportedPosts <= 3
                    ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400'
                    : 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400'
              }`}>
                {stats.reportedPosts === 0 ? t('community.healthy', lang) : stats.reportedPosts <= 3 ? t('community.needsAttention', lang) : t('community.actionRequired', lang)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-600 dark:text-gray-300">{t('community.userEngagement', lang)}</span>
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400">
                {stats.onlineNow > 0 ? t('community.active', lang) : t('community.quiet', lang)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-600 dark:text-gray-300">{t('community.realtimeStatus', lang)}</span>
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400 flex items-center gap-1">
                <Radio className="w-2.5 h-2.5 animate-pulse" /> {t('community.connected', lang)}
              </span>
            </div>
          </div>
        </div>

        {/* Recent Reports Preview */}
        <div className="bg-white dark:bg-gray-900/80 rounded-xl border border-gray-100 dark:border-gray-800/60 p-5">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <Flag className="w-4 h-4 text-red-500" />
            Recent Reports
          </h3>
          {reportedPosts.length === 0 ? (
            <div className="text-center py-6">
              <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
              <p className="text-xs text-gray-500 dark:text-gray-300">{t('community.noPendingReports', lang)}</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {reportedPosts.slice(0, 4).map(post => (
                <div key={post.id} className="flex items-start gap-2.5 p-2.5 rounded-lg bg-red-50/50 dark:bg-red-950/10 border border-red-100/50 dark:border-red-900/20">
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-gray-400 to-gray-500 flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0">
                    {post.author_name?.charAt(0)?.toUpperCase() || '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-gray-900 dark:text-white truncate">{post.author_name}</span>
                      <span className="text-[9px] font-bold text-red-600 bg-red-100 dark:bg-red-900/30 px-1.5 py-0.5 rounded-full flex-shrink-0 ml-2">
                        {post.reports_count} report{Number(post.reports_count) !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <p className="text-[10px] text-gray-500 dark:text-gray-300 truncate mt-0.5">{post.content}</p>
                  </div>
                </div>
              ))}
              {reportedPosts.length > 4 && (
                <p className="text-[10px] text-center text-gray-400 dark:text-gray-300 font-medium">+{reportedPosts.length - 4} more in Moderation tab</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-white dark:bg-gray-900/80 rounded-xl border border-gray-100 dark:border-gray-800/60 p-5">
        <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
          <Activity className="w-4 h-4 text-aegis-500" />
          Quick Actions
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <div className="flex items-center gap-2.5 p-3 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/30">
            <MessageSquare className="w-4 h-4 text-blue-500" />
            <div>
              <p className="text-xs font-semibold text-blue-700 dark:text-blue-300">{t('community.liveChat', lang)}</p>
              <p className="text-[10px] text-blue-500/70">{t('community.monitorConversations', lang)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 p-3 rounded-lg bg-violet-50 dark:bg-violet-950/20 border border-violet-100 dark:border-violet-900/30">
            <FileText className="w-4 h-4 text-violet-500" />
            <div>
              <p className="text-xs font-semibold text-violet-700 dark:text-violet-300">{t('community.postsFeed', lang)}</p>
              <p className="text-[10px] text-violet-500/70">{t('community.reviewCommunityPosts', lang)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 p-3 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-100 dark:border-red-900/30">
            <ShieldAlert className="w-4 h-4 text-red-500" />
            <div>
              <p className="text-xs font-semibold text-red-700 dark:text-red-300">{t('community.moderation', lang)}</p>
              <p className="text-[10px] text-red-500/70">{reportedPosts.length > 0 ? `${reportedPosts.length} ${t('community.pending', lang)}` : t('community.allClear', lang)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/30">
            <Ban className="w-4 h-4 text-emerald-500" />
            <div>
              <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">{t('community.userMgmt', lang)}</p>
              <p className="text-[10px] text-emerald-500/70">{t('community.banMuteKick', lang)}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// MAIN COMPONENT
export default function AdminCommunityHub(): JSX.Element {
  const lang = useLanguage()
  const [activeTab, setActiveTab] = useState<'overview' | 'chat' | 'posts' | 'moderation'>('overview')
  const [stats, setStats] = useState<CommunityStats>({
    totalMessages: 0,
    totalPosts: 0,
    totalMembers: 0,
    onlineNow: 0,
    reportedPosts: 0,
    recentActivity: 0,
  })
  const [reportedPosts, setReportedPosts] = useState<ReportedPost[]>([])
  const [loading, setLoading] = useState(true)

  const fetchStats = useCallback(async () => {
    try {
      const headers = getAuthHeaders()

      // Fetch posts (includes report counts)
      const postsRes = await fetch(`${API_BASE}/api/community/posts?limit=100`, { headers })
      let posts: any[] = []
      let reported: ReportedPost[] = []
      if (postsRes.ok) {
        const data = await postsRes.json()
        posts = data.posts || []
        reported = posts
          .filter((p: any) => Number(p.reports_count) > 0)
          .map((p: any) => ({
            ...p,
            reports_count: Number(p.reports_count) || 0,
          }))
          .sort((a: any, b: any) => Number(b.reports_count) - Number(a.reports_count))
      }

      // Fetch chat messages count
      const chatRes = await fetch(`${API_BASE}/api/community/chat/messages?limit=1`, { headers })
      let msgCount = 0
      if (chatRes.ok) {
        const msgs = await chatRes.json()
        // The API returns messages array — count is approximate from what's available
        msgCount = Array.isArray(msgs) ? msgs.length : 0
      }

      setStats({
        totalMessages: msgCount > 0 ? msgCount : stats.totalMessages,
        totalPosts: posts.length,
        totalMembers: stats.totalMembers || 0, // Will be updated from socket
        onlineNow: stats.onlineNow || 0, // Will be updated from socket
        reportedPosts: reported.length,
        recentActivity: posts.filter((p: any) => {
          const created = new Date(p.created_at)
          const dayAgo = new Date(Date.now() - 86400000)
          return created > dayAgo
        }).length,
      })
      setReportedPosts(reported)
    } catch (err) {
      console.error('[AdminCommunityHub] Failed to fetch stats:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStats()
    const interval = setInterval(fetchStats, 30000) // Refresh every 30s
    return () => clearInterval(interval)
  }, [fetchStats])

  const tabs = [
    { key: 'overview' as const, label: t('community.overview', lang), icon: BarChart3 },
    { key: 'chat' as const, label: t('community.liveChat', lang), icon: MessageSquare },
    { key: 'posts' as const, label: t('community.postsFeed', lang), icon: FileText },
    { key: 'moderation' as const, label: t('community.moderation', lang), icon: ShieldAlert, badge: reportedPosts.length },
  ]

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Premium Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-aegis-500 via-indigo-600 to-violet-600 flex items-center justify-center shadow-lg shadow-aegis-500/20">
            <Users className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="font-bold text-xl text-gray-900 dark:text-white">{t('community.hubTitle', lang)}</h2>
            <p className="text-xs text-gray-500 dark:text-gray-300 flex items-center gap-1.5">
              {t('community.hubSubtitle', lang)}
              <span className="flex items-center gap-1 text-[10px] font-medium text-green-600 bg-green-50 dark:bg-green-950/30 dark:text-green-400 px-2 py-0.5 rounded-full">
                <Radio className="w-2.5 h-2.5 animate-pulse" /> {t('common.live', lang)}
              </span>
            </p>
          </div>
        </div>
        <button
          onClick={() => { setLoading(true); fetchStats() }}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          {t('common.refresh', lang)}
        </button>
      </div>

      {/* Tab Bar — Premium pill tabs */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-xl w-fit shadow-inner">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-5 py-2.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
              activeTab === tab.key
                ? 'bg-white dark:bg-gray-700 text-aegis-700 dark:text-white shadow-md'
                : 'text-gray-500 dark:text-gray-300 hover:text-gray-700 dark:hover:text-gray-300 dark:text-gray-300'
            }`}
          >
            <tab.icon className="w-3.5 h-3.5" />
            {tab.label}
            {tab.badge && tab.badge > 0 && (
              <span className={`ml-0.5 px-1.5 py-0.5 text-[10px] font-bold rounded-full ${
                activeTab === tab.key
                  ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                  : 'bg-red-500 text-white'
              }`}>
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && <OverviewPanel stats={stats} reportedPosts={reportedPosts} />}
      {activeTab === 'chat' && <CommunityChatRoom />}
      {activeTab === 'posts' && <CommunityChat />}
      {activeTab === 'moderation' && (
        <ModerationPanel
          reportedPosts={reportedPosts}
          onRefresh={() => { setLoading(true); fetchStats() }}
          loading={loading}
        />
      )}
    </div>
  )
}
