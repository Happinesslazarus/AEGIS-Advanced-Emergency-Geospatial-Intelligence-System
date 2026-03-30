/* UserAccessManagement.tsx — Enterprise User & Access Management Console
   RBAC, full audit trail, account lifecycle, session monitoring, bulk ops. */

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import {
  Shield, Users, Activity, Eye, Search, RefreshCw, Clock, ChevronDown,
  ChevronRight, Edit2, Ban, CheckCircle2, Trash2, Key,
  AlertTriangle, Lock, UserPlus, ArrowUpDown, ArrowUp,
  ArrowDown, Fingerprint, Building2,
  ShieldAlert, History, BarChart3, User, XCircle, Check, X, FileText
} from 'lucide-react'
import { t } from '../../utils/i18n'
import { useLanguage } from '../../hooks/useLanguage'
import { apiInviteOperator } from '../../utils/api'

/*  types  */
interface Props {
  users: any[]
  setUsers: React.Dispatch<React.SetStateAction<any[]>>
  auditLog: any[]
  setAuditLog: React.Dispatch<React.SetStateAction<any[]>>
  currentUser: any
  pushNotification: (msg: string, type?: 'success' | 'warning' | 'error' | 'info' | string, duration?: number) => void | number
  askConfirm: (title: string, message: string, type: string, action: () => void) => void
  apiGetUsers: () => Promise<any>
  apiUpdateUser: (id: string, data: any) => Promise<any>
  apiSuspendUser: (id: string, data: any) => Promise<any>
  apiActivateUser: (id: string) => Promise<any>
  apiResetUserPassword: (id: string) => Promise<any>
  apiDeleteUser: (id: string) => Promise<any>
  apiAuditLog: (data: any) => Promise<any>
  apiGetAuditLog: (filters?: any) => Promise<any[]>
}

type Tab = 'directory' | 'audit' | 'roles' | 'sessions'
type SortField = 'name' | 'role' | 'department' | 'status' | 'lastLogin' | 'created'

const UNASSIGNED_VALUE = '__unassigned__'

function getRoleMeta(lang: string): Record<string, { label: string; color: string; bg: string; ring: string; icon: typeof Shield; desc: string; perms: string[] }> {
  return {
    admin: {
      label: t('users.administrator', lang),
      color: 'text-purple-600 dark:text-purple-400',
      bg: 'bg-purple-50 dark:bg-purple-900/20',
      ring: 'ring-purple-500/20',
      icon: Shield,
      desc: t('users.roleAdminDesc', lang),
      perms: [
        t('users.roleAdminPermManageOperators', lang),
        t('users.roleAdminPermAccessAuditLogs', lang),
        t('users.roleAdminPermConfigureRbac', lang),
        t('users.roleAdminPermDeployResources', lang),
        t('users.roleAdminPermSendEmergencyAlerts', lang),
        t('users.roleAdminPermManageSystemSettings', lang),
        t('users.roleAdminPermBulkOperations', lang),
        t('users.roleAdminPermDeleteAccounts', lang),
      ],
    },
    operator: {
      label: t('users.operator', lang),
      color: 'text-blue-600 dark:text-blue-400',
      bg: 'bg-blue-50 dark:bg-blue-900/20',
      ring: 'ring-blue-500/20',
      icon: Activity,
      desc: t('users.roleOperatorDesc', lang),
      perms: [
        t('users.roleOperatorPermViewReports', lang),
        t('users.roleOperatorPermVerifyEscalate', lang),
        t('users.roleOperatorPermDeployResources', lang),
        t('users.roleOperatorPermSendAlerts', lang),
        t('users.roleOperatorPermViewAnalytics', lang),
        t('users.roleOperatorPermAccessCommunityChat', lang),
      ],
    },
    viewer: {
      label: t('users.viewer', lang),
      color: 'text-slate-600 dark:text-slate-400',
      bg: 'bg-slate-50 dark:bg-slate-900/20',
      ring: 'ring-slate-500/20',
      icon: Eye,
      desc: t('users.roleViewerDesc', lang),
      perms: [
        t('users.roleViewerPermViewDashboard', lang),
        t('users.roleViewerPermViewReportsReadOnly', lang),
        t('users.roleViewerPermViewAnalytics', lang),
        t('users.roleViewerPermViewDeploymentMap', lang),
      ],
    },
  }
}

function getStatusMeta(lang: string): Record<string, { label: string; color: string; bg: string; dot: string }> {
  return {
    active: { label: t('common.active', lang), color: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-50 dark:bg-emerald-900/20', dot: 'bg-emerald-500' },
    suspended: { label: t('users.suspended', lang), color: 'text-red-700 dark:text-red-300', bg: 'bg-red-50 dark:bg-red-900/20', dot: 'bg-red-500' },
    inactive: { label: t('users.inactive', lang), color: 'text-gray-600 dark:text-gray-300', bg: 'bg-gray-100 dark:bg-gray-800', dot: 'bg-gray-400' },
  }
}

function getDepartments(lang: string): Array<{ value: string; label: string }> {
  return [
    { value: 'Emergency Operations', label: t('users.departmentEmergencyOperations', lang) },
    { value: 'Fire & Rescue', label: t('users.departmentFireRescue', lang) },
    { value: 'Police', label: t('users.departmentPolice', lang) },
    { value: 'Health & Medical', label: t('users.departmentHealthMedical', lang) },
    { value: 'Infrastructure', label: t('users.departmentInfrastructure', lang) },
    { value: 'Environmental', label: t('users.departmentEnvironmental', lang) },
    { value: 'Community Liaison', label: t('users.departmentCommunityLiaison', lang) },
    { value: 'IT & Communications', label: t('users.departmentItCommunications', lang) },
    { value: 'Logistics', label: t('users.departmentLogistics', lang) },
    { value: 'Command & Control', label: t('users.departmentCommandControl', lang) },
  ]
}

function getAuditTypes(lang: string): Record<string, { label: string; color: string; icon: typeof Shield }> {
  return {
    user_create: { label: t('users.auditTypeCreated', lang), color: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600', icon: UserPlus },
    user_update: { label: t('users.auditTypeUpdated', lang), color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-600', icon: Edit2 },
    user_suspend: { label: t('users.suspended', lang), color: 'bg-amber-100 dark:bg-amber-900/30 text-amber-600', icon: Ban },
    user_activate: { label: t('users.auditTypeActivated', lang), color: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600', icon: CheckCircle2 },
    user_delete: { label: t('users.auditTypeDeleted', lang), color: 'bg-red-100 dark:bg-red-900/30 text-red-600', icon: Trash2 },
    password_reset_generate: { label: t('users.auditTypePasswordReset', lang), color: 'bg-purple-100 dark:bg-purple-900/30 text-purple-600', icon: Key },
    login: { label: t('users.auditTypeLogin', lang), color: 'bg-sky-100 dark:bg-sky-900/30 text-sky-600', icon: Fingerprint },
    logout: { label: t('users.auditTypeLogout', lang), color: 'bg-gray-100 dark:bg-gray-800 text-gray-600', icon: XCircle },
    role_change: { label: t('users.auditTypeRoleChange', lang), color: 'bg-violet-100 dark:bg-violet-900/30 text-violet-600', icon: Shield },
  }
}

function timeAgo(date: string | Date, lang: string): string {
  const ms = Date.now() - new Date(date).getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return t('common.justNow', lang)
  if (mins < 60) return `${mins}${t('common.minutesShort', lang)} ${t('common.ago', lang)}`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}${t('common.hoursShort', lang)} ${t('common.ago', lang)}`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}${t('common.daysShort', lang)} ${t('common.ago', lang)}`
  return new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function getSecurityChecks(lang: string) {
  return [
    { check: t('users.securityJwtTokenExpiryCheck', lang), status: t('users.securityJwtTokenExpiryStatus', lang), ok: true, detail: t('users.securityJwtTokenExpiryDetail', lang) },
    { check: t('users.securityRefreshTokenRotationCheck', lang), status: t('users.securityRefreshTokenRotationStatus', lang), ok: true, detail: t('users.securityRefreshTokenRotationDetail', lang) },
    { check: t('users.securityPasswordHashingCheck', lang), status: t('users.securityPasswordHashingStatus', lang), ok: true, detail: t('users.securityPasswordHashingDetail', lang) },
    { check: t('users.securityAuditLoggingCheck', lang), status: t('users.securityAuditLoggingStatus', lang), ok: true, detail: t('users.securityAuditLoggingDetail', lang) },
    { check: t('users.securityRateLimitingCheck', lang), status: t('users.securityRateLimitingStatus', lang), ok: true, detail: t('users.securityRateLimitingDetail', lang) },
    { check: t('users.securitySuspendedAccountCheck', lang), status: t('users.securitySuspendedAccountStatus', lang), ok: true, detail: t('users.securitySuspendedAccountDetail', lang) },
    { check: t('users.securityRoleEnforcementCheck', lang), status: t('users.securityRoleEnforcementStatus', lang), ok: true, detail: t('users.securityRoleEnforcementDetail', lang) },
    { check: t('users.securityPasswordResetTokensCheck', lang), status: t('users.securityPasswordResetTokensStatus', lang), ok: true, detail: t('users.securityPasswordResetTokensDetail', lang) },
  ]
}

function getUserStatus(u: any): 'active' | 'suspended' | 'inactive' {
  if (u.is_suspended) return 'suspended'
  if (u.is_active) return 'active'
  return 'inactive'
}

export default function UserAccessManagement({
  users, setUsers, auditLog, setAuditLog, currentUser,
  pushNotification, askConfirm,
  apiGetUsers, apiUpdateUser, apiSuspendUser, apiActivateUser,
  apiResetUserPassword, apiDeleteUser, apiAuditLog, apiGetAuditLog,
}: Props) {
  const lang = useLanguage()
  const STATUS_META = useMemo(() => getStatusMeta(lang), [lang])
  const AUDIT_TYPES = useMemo(() => getAuditTypes(lang), [lang])
  const roleMeta = useMemo(() => getRoleMeta(lang), [lang])
  const departments = useMemo(() => getDepartments(lang), [lang])
  const departmentLabels = useMemo(() => Object.fromEntries(departments.map((dept) => [dept.value, dept.label])), [departments])
  const securityChecks = useMemo(() => getSecurityChecks(lang), [lang])

  /*  state  */
  const [tab, setTab] = useState<Tab>('directory')
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [deptFilter, setDeptFilter] = useState('all')
  const [sortField, setSortField] = useState<SortField>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [expandedUser, setExpandedUser] = useState<string | null>(null)
  const [editModal, setEditModal] = useState<any | null>(null)
  const [editForm, setEditForm] = useState({ role: '', department: '', phone: '', displayName: '' })
  const [suspendModal, setSuspendModal] = useState<any | null>(null)
  const [suspendForm, setSuspendForm] = useState({ until: '', reason: '' })
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set())
  const [bulkAction, setBulkAction] = useState('')
  const [auditSearch, setAuditSearch] = useState('')
  const [auditTypeFilter, setAuditTypeFilter] = useState('all')
  const [refreshing, setRefreshing] = useState(false)
  const [fullAuditLog, setFullAuditLog] = useState<any[]>([])
  const searchRef = useRef<HTMLInputElement>(null)

  /* invite operator state */
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteForm, setInviteForm] = useState({ email: '', password: '', displayName: '', role: 'operator', department: '', phone: '' })
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteError, setInviteError] = useState('')

  /*  load full audit on audit tab  */
  useEffect(() => {
    if (tab === 'audit') {
      apiGetAuditLog({ limit: 200 }).then(logs => setFullAuditLog(Array.isArray(logs) ? logs : [])).catch(() => {})
    }
  }, [tab])

  /*  refresh  */
  const doRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const d = await apiGetUsers()
      setUsers(d.users || [])
      pushNotification(t('users.directoryRefreshed', lang), 'success')
    } catch {
      pushNotification(t('users.refreshUsersFailed', lang), 'error')
    }
    setRefreshing(false)
  }, [apiGetUsers, lang, pushNotification, setUsers])

  /* invite operator handler */
  const handleInvite = useCallback(async () => {
    setInviteError('')
    if (!inviteForm.email || !inviteForm.password || !inviteForm.displayName) {
      setInviteError('Email, password, and display name are required.')
      return
    }
    // Basic email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(inviteForm.email)) {
      setInviteError('Please enter a valid email address.')
      return
    }
    setInviteLoading(true)
    try {
      const fd = new FormData()
      fd.append('email', inviteForm.email)
      fd.append('password', inviteForm.password)
      fd.append('displayName', inviteForm.displayName)
      fd.append('role', inviteForm.role)
      if (inviteForm.department) fd.append('department', inviteForm.department)
      if (inviteForm.phone) fd.append('phone', inviteForm.phone)
      await apiInviteOperator(fd)
      pushNotification(`Operator "${inviteForm.displayName}" invited successfully. Verification email sent.`, 'success')
      setShowInviteModal(false)
      setInviteForm({ email: '', password: '', displayName: '', role: 'operator', department: '', phone: '' })
      doRefresh()
    } catch (err: any) {
      setInviteError(err?.message || 'Failed to invite operator.')
    } finally {
      setInviteLoading(false)
    }
  }, [inviteForm, pushNotification, doRefresh])

  /*  keyboard shortcut  */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus() }
      if (e.key === 'r' && !e.ctrlKey) { e.preventDefault(); doRefresh() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [doRefresh])

  /*  computed  */
  const stats = useMemo(() => {
    const roleStats = { admin: 0, operator: 0, viewer: 0 }
    let active = 0, suspended = 0, inactive = 0, recentLogin = 0
    const now = Date.now()
    for (const u of users) {
      if (u.role === 'admin') roleStats.admin++
      else if (u.role === 'operator') roleStats.operator++
      else roleStats.viewer++
      if (u.is_suspended) suspended++
      else if (u.is_active) active++
      else inactive++
      if (u.last_login && (now - new Date(u.last_login).getTime()) < 86400000) recentLogin++
    }
    return { total: users.length, ...roleStats, active, suspended, inactive, recentLogin }
  }, [users])

  const deptDistribution = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const u of users) {
      const d = u.department || UNASSIGNED_VALUE
      counts[d] = (counts[d] || 0) + 1
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])
  }, [users])

  const filteredUsers = useMemo(() => {
    const q = search.toLowerCase()
    let items = users.filter(u => {
      if (q && !u.display_name?.toLowerCase().includes(q) && !u.email?.toLowerCase().includes(q) && !u.department?.toLowerCase().includes(q) && !u.id?.toLowerCase().includes(q)) return false
      if (roleFilter !== 'all' && u.role !== roleFilter) return false
      if (statusFilter !== 'all' && getUserStatus(u) !== statusFilter) return false
      if (deptFilter !== 'all' && (u.department || UNASSIGNED_VALUE) !== deptFilter) return false
      return true
    })
    items.sort((a: any, b: any) => {
      let cmp = 0
      if (sortField === 'name') cmp = (a.display_name || '').localeCompare(b.display_name || '')
      else if (sortField === 'role') cmp = (a.role || '').localeCompare(b.role || '')
      else if (sortField === 'department') cmp = (a.department || 'zzz').localeCompare(b.department || 'zzz')
      else if (sortField === 'status') cmp = (getUserStatus(a)).localeCompare(getUserStatus(b))
      else if (sortField === 'lastLogin') cmp = new Date(b.last_login || 0).getTime() - new Date(a.last_login || 0).getTime()
      else if (sortField === 'created') cmp = new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
      return sortDir === 'desc' ? -cmp : cmp
    })
    return items
  }, [users, search, roleFilter, statusFilter, deptFilter, sortField, sortDir])

  const filteredAudit = useMemo(() => {
    const source = fullAuditLog.length > 0 ? fullAuditLog : auditLog
    const q = auditSearch.toLowerCase()
    return source.filter(a => {
      if (auditTypeFilter !== 'all' && a.action_type !== auditTypeFilter) return false
      if (q && !a.action?.toLowerCase().includes(q) && !a.operator_name?.toLowerCase().includes(q) && !a.target_id?.toLowerCase().includes(q)) return false
      return true
    }).slice(0, 100)
  }, [fullAuditLog, auditLog, auditSearch, auditTypeFilter])

  /*  handlers  */
  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }

  const toggleBulk = (id: string) => {
    setBulkSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const toggleBulkAll = () => {
    if (bulkSelected.size === filteredUsers.length) setBulkSelected(new Set())
    else setBulkSelected(new Set(filteredUsers.map(u => u.id)))
  }

  const executeBulk = () => {
    if (!bulkAction || bulkSelected.size === 0) return
    const ids = Array.from(bulkSelected).filter(id => id !== currentUser.id)
    const count = ids.length
    const selectedUsersLabel = t(count === 1 ? 'users.selectedUser' : 'users.selectedUsers', lang)
    if (count === 0) { pushNotification(t('users.bulkSelfBlocked', lang), 'error'); return }

    if (bulkAction === 'suspend') {
      askConfirm(t('users.bulkSuspendTitle', lang), `${t('users.bulkSuspendPrompt', lang)} ${count} ${selectedUsersLabel}? ${t('users.bulkSuspendSuffix', lang)}`, 'warning', async () => {
        let ok = 0
        for (const id of ids) { try { await apiSuspendUser(id, { reason: 'Bulk suspension by admin' }); ok++ } catch {} }
        setUsers(prev => prev.map(u => ids.includes(u.id) ? { ...u, is_suspended: true } : u))
        pushNotification(`${ok}/${count} ${t('users.bulkSuspendedResult', lang)}`, 'warning')
        setBulkSelected(new Set()); setBulkAction('')
      })
    } else if (bulkAction === 'activate') {
      askConfirm(t('users.bulkActivateTitle', lang), `${t('users.bulkActivatePrompt', lang)} ${count} ${selectedUsersLabel}?`, 'success', async () => {
        let ok = 0
        for (const id of ids) { try { await apiActivateUser(id); ok++ } catch {} }
        setUsers(prev => prev.map(u => ids.includes(u.id) ? { ...u, is_suspended: false, is_active: true } : u))
        pushNotification(`${ok}/${count} ${t('users.bulkActivatedResult', lang)}`, 'success')
        setBulkSelected(new Set()); setBulkAction('')
      })
    } else if (bulkAction === 'delete') {
      askConfirm(t('users.bulkDeleteTitle', lang), `${t('users.bulkDeletePrompt', lang)} ${count} ${t(count === 1 ? 'users.user' : 'users.accounts', lang)}? ${t('users.bulkDeleteSuffix', lang)}`, 'danger', async () => {
        let ok = 0
        for (const id of ids) { try { await apiDeleteUser(id); ok++ } catch {} }
        setUsers(prev => prev.filter(u => !ids.includes(u.id)))
        pushNotification(`${ok}/${count} ${t('users.bulkDeletedResult', lang)}`, 'error')
        setBulkSelected(new Set()); setBulkAction('')
      })
    }
  }

  const handleSave = async () => {
    if (!editModal) return
    try {
      await apiUpdateUser(editModal.id, {
        role: editForm.role, department: editForm.department || null,
        phone: editForm.phone || null, displayName: editForm.displayName,
      })
      setUsers(prev => prev.map(u => u.id === editModal.id ? { ...u, ...editForm, display_name: editForm.displayName, role: editForm.role, department: editForm.department } : u))
      apiAuditLog({ operator_name: currentUser?.displayName, action: `Updated user ${editModal.display_name}`, action_type: 'user_update', target_type: 'operator', target_id: editModal.id }).catch(() => {})
      pushNotification(t('users.updateSuccess', lang), 'success')
      setEditModal(null)
    } catch {
      pushNotification(t('users.updateFailed', lang), 'error')
    }
  }

  const handleSuspend = async () => {
    if (!suspendModal || !suspendForm.reason.trim()) {
      pushNotification(t('users.suspensionReasonRequired', lang), 'error'); return
    }
    try {
      await apiSuspendUser(suspendModal.id, suspendForm)
      setUsers(prev => prev.map(u => u.id === suspendModal.id ? { ...u, is_suspended: true, suspended_until: suspendForm.until || null } : u))
      apiAuditLog({ operator_name: currentUser?.displayName, action: `Suspended ${suspendModal.display_name}: ${suspendForm.reason}`, action_type: 'user_suspend', target_type: 'operator', target_id: suspendModal.id }).catch(() => {})
      pushNotification(`${suspendModal.display_name} ${t('users.suspendSuccessSuffix', lang)}`, 'warning')
      setSuspendModal(null); setSuspendForm({ until: '', reason: '' })
    } catch {
      pushNotification(t('users.suspendFailed', lang), 'error')
    }
  }

  /*  sort button  */
  const SortBtn = ({ field, children }: { field: SortField; children: React.ReactNode }) => (
    <button onClick={() => toggleSort(field)} className="inline-flex items-center gap-1 hover:text-gray-900 dark:hover:text-white transition-colors">
      {children}
      {sortField === field ? (sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-30" />}
    </button>
  )

  /*  RENDER  */
  return (
    <div className="space-y-5 animate-fade-in">

      {/*  HEADER  */}
      <div className="bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-950 rounded-2xl shadow-xl overflow-hidden">
        <div className="relative px-6 pt-6 pb-5">
          <div className="absolute inset-0 opacity-[0.04]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)', backgroundSize: '24px 24px' }} />
          <div className="relative z-10">
            {/* title row */}
            <div className="flex items-start justify-between flex-wrap gap-4">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/20 flex items-center justify-center shadow-lg">
                  <Shield className="w-7 h-7 text-white" />
                </div>
                <div>
                  <h2 className="text-slate-900 dark:text-white font-extrabold text-xl tracking-tight">{t('users.identityAccessMgmt', lang)}</h2>
                  <div className="text-blue-300/80 text-sm mt-0.5 flex items-center gap-2 flex-wrap">
                    <span>{t('users.subtitle', lang)}</span>
                    <span aria-hidden="true" className="w-1 h-1 rounded-full bg-blue-300/60" />
                    <span>{t('users.auditCompliance', lang)}</span>
                    <span aria-hidden="true" className="w-1 h-1 rounded-full bg-blue-300/60" />
                    <span>{t('users.accountLifecycle', lang)}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {currentUser?.role === 'admin' && (
                  <button onClick={() => setShowInviteModal(true)} className="px-3.5 py-2 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 rounded-xl text-xs font-semibold transition-all flex items-center gap-2 border border-emerald-500/20 hover:border-emerald-500/40">
                    <UserPlus className="w-3.5 h-3.5" /> {t('users.inviteOperator', lang) || 'Invite Operator'}
                  </button>
                )}
                <button onClick={doRefresh} className={`px-3.5 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-semibold transition-all flex items-center gap-2 border border-white/10 ${refreshing ? 'opacity-60 pointer-events-none' : ''}`}>
                  <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} /> {t('common.refresh', lang)}
                </button>
              </div>
            </div>

            {/* KPI strip */}
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-8 gap-2.5 mt-5">
              {[
                { label: t('common.total', lang), value: stats.total, color: 'text-cyan-300', icon: Users },
                { label: t('common.active', lang), value: stats.active, color: 'text-emerald-300', icon: CheckCircle2 },
                { label: t('users.suspended', lang), value: stats.suspended, color: stats.suspended > 0 ? 'text-red-300' : 'text-gray-500 dark:text-gray-300', icon: Ban },
                { label: t('users.inactive', lang), value: stats.inactive, color: 'text-gray-400 dark:text-gray-300', icon: XCircle },
                { label: t('users.admins', lang), value: stats.admin, color: 'text-purple-300', icon: Shield },
                { label: t('users.operators', lang), value: stats.operator, color: 'text-blue-300', icon: Activity },
                { label: t('users.viewers', lang), value: stats.viewer, color: 'text-slate-300', icon: Eye },
                { label: t('users.24hLogins', lang), value: stats.recentLogin, color: 'text-amber-300', icon: Fingerprint },
              ].map((s, i) => (
                <div key={i} className="bg-white/[0.06] backdrop-blur-sm rounded-xl px-3 py-2.5 border border-white/[0.08] hover:bg-white/[0.1] transition-colors">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[9px] text-blue-300/70 uppercase tracking-widest font-bold">{s.label}</span>
                    <s.icon className={`w-3 h-3 ${s.color} opacity-60`} />
                  </div>
                  <p className={`text-lg font-extrabold tabular-nums ${s.color}`}>{s.value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* tab bar */}
        <div className="px-6 flex items-center gap-1 border-t border-white/[0.08]">
          {([
            { id: 'directory' as Tab, label: t('users.userDirectory', lang), icon: Users },
            { id: 'audit' as Tab, label: t('users.auditTrail', lang), icon: History },
            { id: 'roles' as Tab, label: t('users.rolesPermissions', lang), icon: Shield },
            { id: 'sessions' as Tab, label: t('users.accessOverview', lang), icon: Fingerprint },
          ]).map(item => (
            <button key={item.id} onClick={() => setTab(item.id)} className={`flex items-center gap-2 px-4 py-3 text-xs font-bold transition-all border-b-2 ${tab === item.id ? 'text-white border-white' : 'text-blue-300/50 border-transparent hover:text-blue-200/80 hover:border-white/30'}`}>
              <item.icon className="w-3.5 h-3.5" /> {item.label}
            </button>
          ))}
        </div>
      </div>

      {/*  TAB: USER DIRECTORY  */}
      {tab === 'directory' && (
        <>
          {/* Toolbar */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm">
            <div className="px-5 py-3 flex flex-col lg:flex-row items-stretch lg:items-center gap-2.5">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 dark:text-gray-300" />
                <input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)} placeholder={t('users.searchPlaceholder', lang)} className="w-full pl-9 pr-3 py-2.5 text-xs bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 transition-all placeholder:text-gray-400 dark:text-gray-300" />
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} className="px-2.5 py-2.5 text-[11px] font-semibold bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
                  <option value="all">{t('users.allRoles', lang)}</option>
                  <option value="admin">{t('users.admin', lang)}</option>
                  <option value="operator">{t('users.operator', lang)}</option>
                  <option value="viewer">{t('users.viewer', lang)}</option>
                </select>
                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="px-2.5 py-2.5 text-[11px] font-semibold bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
                  <option value="all">{t('users.allStatus', lang)}</option>
                  <option value="active">{t('common.active', lang)}</option>
                  <option value="suspended">{t('users.suspended', lang)}</option>
                  <option value="inactive">{t('users.inactive', lang)}</option>
                </select>
                <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)} className="px-2.5 py-2.5 text-[11px] font-semibold bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
                  <option value="all">{t('users.allDepartments', lang)}</option>
                  {departments.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                  <option value={UNASSIGNED_VALUE}>{t('users.unassigned', lang)}</option>
                </select>
                <div className="h-5 w-px bg-gray-200 dark:bg-gray-700 hidden lg:block" />
                <span className="text-[11px] text-gray-400 dark:text-gray-300 font-medium">{filteredUsers.length} {t('common.of', lang)} {users.length}</span>
              </div>
            </div>

            {/* Bulk actions bar */}
            {bulkSelected.size > 0 && (
              <div className="px-5 py-2.5 bg-blue-50 dark:bg-blue-900/10 border-t border-blue-100 dark:border-blue-900/30 flex items-center gap-3 flex-wrap">
                <span className="text-xs font-bold text-blue-700 dark:text-blue-300">{bulkSelected.size} {t('common.selected', lang)}</span>
                <select value={bulkAction} onChange={e => setBulkAction(e.target.value)} className="px-2.5 py-1.5 text-[11px] font-semibold bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
                  <option value="">{t('users.bulkAction', lang)}</option>
                  <option value="suspend">{t('users.suspend', lang)}</option>
                  <option value="activate">{t('users.activate', lang)}</option>
                  <option value="delete">{t('common.delete', lang)}</option>
                </select>
                <button onClick={executeBulk} disabled={!bulkAction} className="px-3 py-1.5 text-[11px] font-bold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">{t('common.apply', lang)}</button>
                <button onClick={() => { setBulkSelected(new Set()); setBulkAction('') }} className="text-[11px] text-gray-500 dark:text-gray-300 hover:text-gray-700 dark:hover:text-gray-300 dark:text-gray-300 transition-colors">{t('common.clear', lang)}</button>
              </div>
            )}
          </div>

          {/* Table */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-[10px] font-bold text-gray-500 dark:text-gray-300 uppercase tracking-wider border-b border-gray-100 dark:border-gray-800">
                    <th className="px-4 py-3 text-left w-10">
                      <input type="checkbox" checked={bulkSelected.size === filteredUsers.length && filteredUsers.length > 0} onChange={toggleBulkAll} className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                    </th>
                    <th className="px-3 py-3 text-left"><SortBtn field="name">{t('users.user', lang)}</SortBtn></th>
                    <th className="px-3 py-3 text-left"><SortBtn field="role">{t('users.role', lang)}</SortBtn></th>
                    <th className="px-3 py-3 text-left"><SortBtn field="department">{t('users.department', lang)}</SortBtn></th>
                    <th className="px-3 py-3 text-left"><SortBtn field="status">{t('common.status', lang)}</SortBtn></th>
                    <th className="px-3 py-3 text-left"><SortBtn field="lastLogin">{t('users.lastLogin', lang)}</SortBtn></th>
                    <th className="px-3 py-3 text-left"><SortBtn field="created">{t('common.created', lang)}</SortBtn></th>
                    <th className="px-4 py-3 text-right">{t('common.actions', lang)}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-800/50">
                  {filteredUsers.map((u: any) => {
                    const status = getUserStatus(u)
                    const sm = STATUS_META[status]
                    const rm = roleMeta[u.role] || roleMeta.viewer
                    const isExpanded = expandedUser === u.id
                    const isSelf = u.id === currentUser?.id
                    return (
                      <React.Fragment key={u.id}>
                        <tr className={`group text-xs hover:bg-gray-50 dark:hover:bg-gray-800/20 transition-colors ${status === 'suspended' ? 'bg-red-50/30 dark:bg-red-950/5' : ''}`}>
                          <td className="px-4 py-3">
                            <input type="checkbox" checked={bulkSelected.has(u.id)} onChange={() => toggleBulk(u.id)} className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                          </td>
                          <td className="px-3 py-3">
                            <button onClick={() => setExpandedUser(isExpanded ? null : u.id)} className="flex items-center gap-2.5 group/user">
                              {isExpanded ? <ChevronDown className="w-3 h-3 text-gray-400 dark:text-gray-300 flex-shrink-0" /> : <ChevronRight className="w-3 h-3 text-gray-400 dark:text-gray-300 flex-shrink-0" />}
                              {u.avatar_url
                                ? <img src={u.avatar_url} alt="" className="w-8 h-8 rounded-lg object-cover border border-gray-200 dark:border-gray-700 flex-shrink-0" />
                                : <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-xs flex-shrink-0 ${u.role === 'admin' ? 'bg-gradient-to-br from-purple-500 to-indigo-600' : u.role === 'operator' ? 'bg-gradient-to-br from-blue-500 to-cyan-600' : 'bg-gradient-to-br from-gray-400 to-gray-500'}`}>{u.display_name?.charAt(0) || '?'}</div>
                              }
                              <div className="text-left min-w-0">
                                <p className="font-bold text-gray-900 dark:text-white group-hover/user:text-blue-600 dark:group-hover/user:text-blue-400 transition-colors truncate whitespace-nowrap">
                                  {u.display_name}{isSelf && <span className="ml-1.5 text-[9px] px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-bold">{t('users.youBadge', lang)}</span>}
                                </p>
                                <p className="text-[10px] text-gray-400 dark:text-gray-300 truncate font-mono">{u.email}</p>
                              </div>
                            </button>
                          </td>
                          <td className="px-3 py-3">
                            <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md font-bold ring-1 ${rm.bg} ${rm.color} ${rm.ring}`}>
                              <rm.icon className="w-3 h-3" /> {rm.label}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-gray-600 dark:text-gray-300 truncate max-w-[140px]">{u.department ? (departmentLabels[u.department] || u.department) : <span className="text-gray-400 dark:text-gray-300 italic">{t('users.unassigned', lang)}</span>}</td>
                          <td className="px-3 py-3">
                            <span className={`inline-flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded-full font-bold ${sm.bg} ${sm.color}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${sm.dot} ${status === 'active' ? 'animate-pulse' : ''}`} /> {sm.label}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-gray-500 dark:text-gray-300 whitespace-nowrap">{u.last_login ? timeAgo(u.last_login, lang) : <span className="text-gray-400 dark:text-gray-300 italic">{t('common.never', lang)}</span>}</td>
                          <td className="px-3 py-3 text-gray-400 dark:text-gray-300 whitespace-nowrap text-[10px]">{u.created_at ? new Date(u.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }) : '—'}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1 justify-end">
                              <button onClick={() => { setEditModal(u); setEditForm({ role: u.role, department: u.department || '', phone: u.phone || '', displayName: u.display_name }) }} title={t('users.editUser', lang)} className="p-1.5 rounded-lg text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"><Edit2 className="w-3.5 h-3.5" /></button>
                              {u.is_suspended ? (
                                <button onClick={() => askConfirm(t('users.activate', lang), `${t('users.activate', lang)} ${u.display_name}?`, 'success', async () => {
                                  await apiActivateUser(u.id); setUsers(prev => prev.map(x => x.id === u.id ? { ...x, is_suspended: false } : x)); pushNotification(t('users.activatedSuccess', lang), 'success')
                                })} title={t('users.activate', lang)} className="p-1.5 rounded-lg text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors"><CheckCircle2 className="w-3.5 h-3.5" /></button>
                              ) : (
                                <button onClick={() => { setSuspendModal(u); setSuspendForm({ until: '', reason: '' }) }} title={t('users.suspend', lang)} className="p-1.5 rounded-lg text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"><Ban className="w-3.5 h-3.5" /></button>
                              )}
                              <button onClick={() => askConfirm(t('users.resetPassword', lang), `${t('users.resetPassword', lang)} ${u.display_name}?`, 'info', async () => {
                                await apiResetUserPassword(u.id); pushNotification(t('users.resetLinkGenerated', lang), 'success')
                              })} title={t('users.resetPassword', lang)} className="p-1.5 rounded-lg text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors"><Key className="w-3.5 h-3.5" /></button>
                              {!isSelf && (
                                <button onClick={() => askConfirm(t('users.deleteUser', lang), `${t('users.bulkDeletePrompt', lang)} ${u.display_name}? ${t('users.bulkDeleteSuffix', lang)}`, 'danger', async () => {
                                  await apiDeleteUser(u.id); setUsers(prev => prev.filter(x => x.id !== u.id)); pushNotification(t('users.deletedSuccess', lang), 'success')
                                })} title={t('common.delete', lang)} className="p-1.5 rounded-lg text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                              )}
                            </div>
                          </td>
                        </tr>

                        {/* Expanded profile detail */}
                        {isExpanded && (
                          <tr>
                            <td colSpan={8} className="bg-gray-50/50 dark:bg-gray-800/20 px-5 py-4">
                              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 text-xs">
                                <div><span className="text-gray-400 dark:text-gray-300 font-medium block mb-0.5">{t('users.accountId', lang)}</span><div className="flex items-center gap-1.5 group/aid"><span className="font-mono text-[10px] font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/30 px-2 py-0.5 rounded-md border border-indigo-200 dark:border-indigo-800">ACC-{(u.id || '').slice(0, 6).toUpperCase()}</span><button className="opacity-0 group-hover/aid:opacity-100 transition-opacity text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(u.id || '') }} title={u.id || ''}><svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg></button></div></div>
                                <div><span className="text-gray-400 dark:text-gray-300 font-medium block mb-0.5">{t('common.email', lang)}</span><p className="font-bold text-gray-700 dark:text-gray-300 truncate">{u.email}</p></div>
                                <div><span className="text-gray-400 dark:text-gray-300 font-medium block mb-0.5">{t('common.phone', lang)}</span><p className="font-bold text-gray-700 dark:text-gray-300">{u.phone || '—'}</p></div>
                                <div><span className="text-gray-400 dark:text-gray-300 font-medium block mb-0.5">{t('users.role', lang)}</span><p className={`font-bold ${rm.color}`}>{rm.label}</p></div>
                                <div><span className="text-gray-400 dark:text-gray-300 font-medium block mb-0.5">{t('users.department', lang)}</span><p className="font-bold text-gray-700 dark:text-gray-300">{u.department || t('users.unassigned', lang)}</p></div>
                                <div><span className="text-gray-400 dark:text-gray-300 font-medium block mb-0.5">{t('users.accountCreated', lang)}</span><p className="font-bold text-gray-700 dark:text-gray-300">{u.created_at ? new Date(u.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'}</p></div>
                              </div>
                              {u.is_suspended && u.suspended_until && (
                                <div className="mt-3 p-2.5 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/30 rounded-lg">
                                  <p className="text-[11px] text-red-700 dark:text-red-300 flex items-center gap-1.5"><Ban className="w-3 h-3" /> {t('users.suspendedUntil', lang)} {new Date(u.suspended_until).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                                </div>
                              )}
                              {/* Mini audit for this user */}
                              <div className="mt-3">
                                <p className="text-[10px] font-bold text-gray-400 dark:text-gray-300 uppercase tracking-wider mb-2">{t('users.accountActivity', lang)}</p>
                                {auditLog.filter(a => a.target_id === u.id || (a.operator_id === u.id && (a.action_type === 'login' || a.action_type === 'logout'))).slice(0, 5).map((log, li) => (
                                  <div key={li} className="flex items-center gap-2 text-[11px] py-1">
                                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${log.action_type?.includes('delete') ? 'bg-red-500' : log.action_type?.includes('suspend') ? 'bg-amber-500' : 'bg-blue-500'}`} />
                                    <span className="text-gray-700 dark:text-gray-300">{log.action}</span>
                                    <span className="ml-auto text-gray-400 dark:text-gray-300 text-[10px] whitespace-nowrap">{timeAgo(log.created_at, lang)}</span>
                                  </div>
                                ))}
                                {auditLog.filter(a => a.target_id === u.id).length === 0 && <p className="text-[11px] text-gray-400 dark:text-gray-300">{t('users.noAccountActivity', lang)}</p>}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    )
                  })}
                </tbody>
              </table>
              {filteredUsers.length === 0 && (
                <div className="text-center py-16">
                  <Users className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
                  <p className="font-semibold text-gray-600 dark:text-gray-300">{t('users.noUsersMatch', lang)}</p>
                  <p className="text-xs text-gray-400 dark:text-gray-300 mt-1">{search ? t('users.tryDifferentSearch', lang) : t('users.noUsersRegistered', lang)}</p>
                </div>
              )}
            </div>
            {/* Footer */}
            <div className="px-5 py-2.5 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-100 dark:border-gray-800 text-[11px] text-gray-500 dark:text-gray-300 flex items-center justify-between">
              <span>{t('common.showing', lang)} {filteredUsers.length} {t('common.of', lang)} {users.length} {t('users.accounts', lang)}</span>
              <span className="flex items-center gap-3">
                <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> {stats.active} {t('common.active', lang).toLowerCase()}</span>
                <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-red-500" /> {stats.suspended} {t('users.suspended', lang).toLowerCase()}</span>
                <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-gray-400" /> {stats.inactive} {t('users.inactive', lang).toLowerCase()}</span>
              </span>
            </div>
          </div>
        </>
      )}

      {/*  TAB: AUDIT TRAIL  */}
      {tab === 'audit' && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm px-5 py-3 flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 dark:text-gray-300" />
              <input value={auditSearch} onChange={e => setAuditSearch(e.target.value)} placeholder={t('admin.auditTrail.search', lang)} className="w-full pl-9 pr-3 py-2.5 text-xs bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500/40 transition-all placeholder:text-gray-400 dark:text-gray-300" />
            </div>
            <select value={auditTypeFilter} onChange={e => setAuditTypeFilter(e.target.value)} className="px-2.5 py-2.5 text-[11px] font-semibold bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
              <option value="all">{t('audit.allTypes', lang)}</option>
              {Object.entries(AUDIT_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>

          {/* Audit table */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-[10px] font-bold text-gray-500 dark:text-gray-300 uppercase tracking-wider border-b border-gray-100 dark:border-gray-800">
                    <th className="px-5 py-3 text-left">{t('audit.action', lang)}</th>
                    <th className="px-3 py-3 text-left">{t('common.type', lang)}</th>
                    <th className="px-3 py-3 text-left">{t('users.operator', lang)}</th>
                    <th className="px-3 py-3 text-left">{t('common.target', lang)}</th>
                    <th className="px-3 py-3 text-left">{t('common.details', lang)}</th>
                    <th className="px-5 py-3 text-right">{t('common.timestamp', lang)}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-800/50">
                  {filteredAudit.map((log: any, i: number) => {
                    const at = AUDIT_TYPES[log.action_type] || { label: log.action_type || t('common.unknown', lang), color: 'bg-gray-100 dark:bg-gray-800 text-gray-600', icon: FileText }
                    const AtIcon = at.icon
                    return (
                      <tr key={log.id || i} className="text-xs hover:bg-gray-50 dark:hover:bg-gray-800/20 transition-colors">
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2.5">
                            <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${at.color}`}>
                              <AtIcon className="w-3.5 h-3.5" />
                            </div>
                            <span className="font-medium text-gray-900 dark:text-white truncate max-w-[260px]">{log.action}</span>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <span className={`inline-flex text-[10px] px-2 py-0.5 rounded-md font-bold ${at.color}`}>{at.label}</span>
                        </td>
                        <td className="px-3 py-3 text-gray-600 dark:text-gray-300">{log.operator_name || t('common.system', lang)}</td>
                        <td className="px-3 py-3">{log.target_id ? <span className="font-mono text-[10px] font-bold text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/30 px-1.5 py-0.5 rounded border border-purple-200 dark:border-purple-800 cursor-pointer hover:bg-purple-100 dark:hover:bg-purple-900/40 transition-colors" title={log.target_id} onClick={() => navigator.clipboard.writeText(log.target_id || '')}>TGT-{(log.target_id || '').slice(0, 6).toUpperCase()}</span> : <span className="text-[10px] text-gray-400 dark:text-gray-300">—</span>}</td>
                        <td className="px-3 py-3 text-gray-400 dark:text-gray-300 text-[10px] truncate max-w-[160px]">{log.before_state ? t('common.stateChangeCaptured', lang) : log.ip_address || '-'}</td>
                        <td className="px-5 py-3 text-right text-gray-500 dark:text-gray-300 whitespace-nowrap">
                          <div>{new Date(log.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}</div>
                          <div className="text-[10px] text-gray-400 dark:text-gray-300">{new Date(log.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {filteredAudit.length === 0 && (
                <div className="text-center py-16">
                  <History className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
                  <p className="font-semibold text-gray-600 dark:text-gray-300">{t('audit.noEntriesFound', lang)}</p>
                </div>
              )}
            </div>
            <div className="px-5 py-2.5 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-100 dark:border-gray-800 text-[11px] text-gray-400 dark:text-gray-300 flex items-center justify-between">
              <span>{filteredAudit.length} {t('common.entries', lang)}</span>
              <span className="flex items-center gap-1"><Lock className="w-3 h-3" /> {t('users.immutableAuditLog', lang)}</span>
            </div>
          </div>
        </div>
      )}

      {/*  TAB: ROLES & PERMISSIONS  */}
      {tab === 'roles' && (
        <div className="space-y-4">
          {/* Permission matrix */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {Object.entries(roleMeta).map(([key, role]) => {
              const RIcon = role.icon
              const count = key === 'admin' ? stats.admin : key === 'operator' ? stats.operator : stats.viewer
              return (
                <div key={key} className={`bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden`}>
                  <div className={`p-5 ${role.bg} border-b border-gray-100 dark:border-gray-800`}>
                    <div className="flex items-center justify-between mb-3">
                      <div className={`w-10 h-10 rounded-xl ${role.bg} ring-1 ${role.ring} flex items-center justify-center`}>
                        <RIcon className={`w-5 h-5 ${role.color}`} />
                      </div>
                      <span className={`text-2xl font-extrabold tabular-nums ${role.color}`}>{count}</span>
                    </div>
                    <h3 className={`font-extrabold text-base ${role.color}`}>{role.label}</h3>
                    <p className="text-[11px] text-gray-500 dark:text-gray-300 mt-1">{role.desc}</p>
                  </div>
                  <div className="p-4">
                    <p className="text-[10px] font-bold text-gray-400 dark:text-gray-300 uppercase tracking-wider mb-2.5">{t('users.permissions', lang)}</p>
                    <div className="space-y-1.5">
                      {role.perms.map((perm, pi) => (
                        <div key={pi} className="flex items-center gap-2 text-xs">
                          <Check className={`w-3.5 h-3.5 flex-shrink-0 ${role.color}`} />
                          <span className="text-gray-700 dark:text-gray-300">{perm}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Role distribution chart */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm p-5">
            <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2 mb-4"><BarChart3 className="w-4 h-4 text-blue-500" /> {t('users.roleDistribution', lang)}</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {Object.entries(roleMeta).map(([key, role]) => {
                const count = key === 'admin' ? stats.admin : key === 'operator' ? stats.operator : stats.viewer
                const pct = stats.total > 0 ? Math.round(count / stats.total * 100) : 0
                return (
                  <div key={key}>
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <span className={`font-bold ${role.color}`}>{role.label}</span>
                      <span className="font-bold text-gray-500 dark:text-gray-300 tabular-nums">{count} ({pct}%)</span>
                    </div>
                    <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-3 overflow-hidden">
                      <div className={`h-3 rounded-full transition-all duration-700 ${key === 'admin' ? 'bg-gradient-to-r from-purple-500 to-indigo-500' : key === 'operator' ? 'bg-gradient-to-r from-blue-500 to-cyan-500' : 'bg-gradient-to-r from-gray-400 to-gray-500'}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>

            {/* RBAC enforcement note */}
            <div className="mt-5 p-3.5 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-xl">
              <div className="flex items-start gap-2">
                <Shield className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-bold text-blue-800 dark:text-blue-200 mb-1">{t('users.rbacEnforcement', lang)}</p>
                  <p className="text-[11px] text-blue-700 dark:text-blue-300">{t('users.rbacEnforcementPrefix', lang)} <code className="px-1 py-0.5 bg-blue-100 dark:bg-blue-900/40 rounded text-[10px] font-mono">{'requireSuperAdmin'}</code> {t('users.rbacEnforcementSuffix', lang)}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/*  TAB: ACCESS OVERVIEW  */}
      {tab === 'sessions' && (
        <div className="space-y-4">
          {/* Department breakdown */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2"><Building2 className="w-4 h-4 text-teal-500" /> {t('users.departmentAccessMatrix', lang)}</h3>
              <span className="text-[11px] text-gray-400 dark:text-gray-300">{deptDistribution.length} {t('users.departments', lang).toLowerCase()}</span>
            </div>
            <div className="p-5">
              <div className="space-y-2.5">
                {deptDistribution.map(([dept, count]) => {
                  const pct = stats.total > 0 ? Math.round(count / stats.total * 100) : 0
                  const deptUsers = users.filter(u => (u.department || UNASSIGNED_VALUE) === dept)
                  const deptAdmins = deptUsers.filter(u => u.role === 'admin').length
                  const deptOps = deptUsers.filter(u => u.role === 'operator').length
                  const deptViewers = deptUsers.filter(u => u.role !== 'admin' && u.role !== 'operator').length
                  return (
                    <div key={dept} className="group">
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="font-semibold text-gray-700 dark:text-gray-300">{dept === UNASSIGNED_VALUE ? t('users.unassigned', lang) : (departmentLabels[dept] || dept)}</span>
                        <div className="flex items-center gap-3">
                          <div className="hidden sm:flex items-center gap-2 text-[10px] text-gray-400 dark:text-gray-300">
                            {deptAdmins > 0 && <span className="flex items-center gap-0.5"><Shield className="w-2.5 h-2.5 text-purple-500" />{deptAdmins}</span>}
                            {deptOps > 0 && <span className="flex items-center gap-0.5"><Activity className="w-2.5 h-2.5 text-blue-500" />{deptOps}</span>}
                            {deptViewers > 0 && <span className="flex items-center gap-0.5"><Eye className="w-2.5 h-2.5 text-gray-400 dark:text-gray-300" />{deptViewers}</span>}
                          </div>
                          <span className="font-bold text-gray-500 dark:text-gray-300 tabular-nums">{count} ({pct}%)</span>
                        </div>
                      </div>
                      <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-2.5 overflow-hidden">
                        <div className="h-2.5 rounded-full bg-gradient-to-r from-teal-500 to-cyan-500 transition-all duration-700" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Security overview + recent activity */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Security posture */}
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm p-5">
              <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2 mb-4"><ShieldAlert className="w-4 h-4 text-amber-500" /> {t('users.securityPosture', lang)}</h3>
              <div className="space-y-3">
                {securityChecks.map((item, i) => (
                  <div key={i} className="flex items-center gap-3 py-1.5">
                    <div className={`w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 ${item.ok ? 'bg-emerald-50 dark:bg-emerald-900/20' : 'bg-red-50 dark:bg-red-900/20'}`}>
                      {item.ok ? <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> : <X className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">{item.check}</p>
                      <p className="text-[10px] text-gray-400 dark:text-gray-300">{item.detail}</p>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${item.ok ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400' : 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'}`}>{item.status}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Recent access events */}
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm p-5">
              <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2 mb-4"><Clock className="w-4 h-4 text-purple-500" /> {t('users.recentAccountEvents', lang)}</h3>
              <div className="space-y-0 border-l-2 border-gray-100 dark:border-gray-800 ml-2 pl-5 max-h-[360px] overflow-y-auto pr-1">
                {auditLog.filter(a => a.action_type?.includes('user_') || a.action_type === 'login' || a.action_type === 'logout' || a.action_type === 'password_reset_generate').slice(0, 20).map((log, i) => {
                  const at = AUDIT_TYPES[log.action_type] || { label: log.action_type || '?', color: 'bg-gray-100 text-gray-600', icon: FileText }
                  const AtIcon = at.icon
                  return (
                    <div key={log.id || i} className="relative pb-3.5 last:pb-0 group">
                      <div className={`absolute -left-[25px] top-1 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-gray-900 ${log.action_type?.includes('delete') ? 'bg-red-500' : log.action_type?.includes('suspend') ? 'bg-amber-500' : log.action_type?.includes('activate') || log.action_type === 'login' ? 'bg-emerald-500' : 'bg-blue-500'} group-hover:scale-125 transition-transform`} />
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${at.color}`}>{at.label}</span>
                            <span className="text-xs font-medium text-gray-900 dark:text-white truncate">{log.action}</span>
                          </div>
                          <div className="text-[10px] text-gray-400 dark:text-gray-300 flex items-center gap-1.5 flex-wrap">
                            <span>{log.operator_name || t('common.system', lang)}</span>
                            <span aria-hidden="true" className="w-1 h-1 rounded-full bg-gray-300 dark:bg-gray-600" />
                            <span>{new Date(log.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                        </div>
                        <span className="text-[10px] text-gray-400 dark:text-gray-300 font-mono tabular-nums whitespace-nowrap">{timeAgo(log.created_at, lang)}</span>
                      </div>
                    </div>
                  )
                })}
                {auditLog.filter(a => a.action_type?.includes('user_') || a.action_type === 'login' || a.action_type === 'password_reset_generate').length === 0 && (
                  <div className="text-center py-8">
                    <Clock className="w-6 h-6 text-gray-300 dark:text-gray-600 mx-auto mb-1.5" />
                    <p className="text-xs text-gray-400 dark:text-gray-300">{t('users.noAccountEvents', lang)}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/*  EDIT USER MODAL  */}
      {editModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-[60]" onClick={() => setEditModal(null)}>
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-5">
              <div className="flex items-center gap-3">
                {editModal.avatar_url
                  ? <img src={editModal.avatar_url} alt="" className="w-12 h-12 rounded-xl object-cover border-2 border-white/30" />
                  : <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center text-white font-bold text-lg">{editModal.display_name?.charAt(0) || '?'}</div>
                }
                <div>
                  <h3 className="font-bold text-white text-lg">{editModal.display_name}</h3>
                  <p className="text-blue-200 text-sm">{editModal.email}</p>
                </div>
                <button onClick={() => setEditModal(null)} className="ml-auto p-2 hover:bg-white/10 rounded-xl transition-colors"><X className="w-5 h-5 text-white" /></button>
              </div>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-xs font-bold text-gray-600 dark:text-gray-300 block mb-1.5">{t('admin.users.displayName', lang)}</label>
                <input className="w-full px-4 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-blue-500 outline-none" value={editForm.displayName} onChange={e => setEditForm(f => ({ ...f, displayName: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs font-bold text-gray-600 dark:text-gray-300 block mb-1.5">{t('users.roleAssignment', lang)}</label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {Object.entries(roleMeta).map(([key, r]) => {
                    const RIcon = r.icon
                    return (
                      <button key={key} onClick={() => setEditForm(f => ({ ...f, role: key }))} className={`py-3 rounded-xl text-xs font-bold transition-all flex flex-col items-center gap-1.5 ${editForm.role === key ? `${r.bg} ${r.color} ring-2 ${r.ring}` : 'bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'}`}>
                        <RIcon className="w-4 h-4" />
                        {r.label}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-gray-600 dark:text-gray-300 block mb-1.5">{t('users.department', lang)}</label>
                <select className="w-full px-4 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-blue-500 outline-none" value={editForm.department} onChange={e => setEditForm(f => ({ ...f, department: e.target.value }))}>
                  <option value="">{t('users.selectDepartment', lang)}</option>
                  {departments.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-gray-600 dark:text-gray-300 block mb-1.5">{t('common.phone', lang)}</label>
                <input className="w-full px-4 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-blue-500 outline-none" placeholder="+44 1234 567890" value={editForm.phone} onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setEditModal(null)} className="flex-1 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-xl py-3 text-sm font-semibold transition-colors">{t('common.cancel', lang)}</button>
                <button onClick={handleSave} className="flex-1 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl py-3 text-sm font-bold shadow-lg shadow-blue-500/20 transition-all">{t('common.saveChanges', lang)}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/*  SUSPEND MODAL  */}
      {suspendModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-[60]" onClick={() => setSuspendModal(null)}>
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="bg-gradient-to-r from-amber-500 to-red-500 p-5">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center"><Ban className="w-6 h-6 text-white" /></div>
                <div>
                  <h3 className="font-bold text-white text-lg">{t('users.suspendAccount', lang)}</h3>
                  <div className="text-amber-100 text-sm flex items-center gap-1.5 flex-wrap">
                    <span>{suspendModal.display_name}</span>
                    <span aria-hidden="true" className="w-1 h-1 rounded-full bg-amber-100/70" />
                    <span>{suspendModal.email}</span>
                  </div>
                </div>
                <button onClick={() => setSuspendModal(null)} className="ml-auto p-2 hover:bg-white/10 rounded-xl transition-colors"><X className="w-5 h-5 text-white" /></button>
              </div>
            </div>
            <div className="p-5 space-y-4">
              <div className="p-3 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-900/30 rounded-xl">
                <p className="text-xs text-amber-800 dark:text-amber-200 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" /> {t('users.suspensionWarning', lang)}</p>
              </div>
              <div>
                <label className="text-xs font-bold text-gray-600 dark:text-gray-300 block mb-1.5">{t('common.reason', lang)} <span className="text-red-500">*</span></label>
                <textarea rows={3} className="w-full px-4 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-amber-500 outline-none resize-none" placeholder={t('users.reasonPlaceholder', lang)} value={suspendForm.reason} onChange={e => setSuspendForm(f => ({ ...f, reason: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs font-bold text-gray-600 dark:text-gray-300 block mb-1.5">{t('users.suspendUntilOptional', lang)}</label>
                <input type="datetime-local" className="w-full px-4 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-amber-500 outline-none" value={suspendForm.until} onChange={e => setSuspendForm(f => ({ ...f, until: e.target.value }))} />
                <p className="text-[10px] text-gray-400 dark:text-gray-300 mt-1">{t('users.leaveBlankIndefinite', lang)}</p>
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setSuspendModal(null)} className="flex-1 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-xl py-3 text-sm font-semibold transition-colors">{t('common.cancel', lang)}</button>
                <button onClick={handleSuspend} className="flex-1 bg-gradient-to-r from-amber-500 to-red-500 hover:from-amber-600 hover:to-red-600 text-white rounded-xl py-3 text-sm font-bold shadow-lg shadow-amber-500/20 transition-all">{t('users.confirmSuspension', lang)}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/*  INVITE OPERATOR MODAL  */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-[60]" onClick={() => setShowInviteModal(false)}>
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="bg-gradient-to-r from-emerald-500 to-teal-600 p-5">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center"><UserPlus className="w-6 h-6 text-white" /></div>
                <div>
                  <h3 className="font-bold text-white text-lg">Invite Operator</h3>
                  <p className="text-emerald-100 text-sm">Create a new operator account</p>
                </div>
                <button onClick={() => setShowInviteModal(false)} className="ml-auto p-2 hover:bg-white/10 rounded-xl transition-colors"><X className="w-5 h-5 text-white" /></button>
              </div>
            </div>
            <div className="p-5 space-y-4">
              {inviteError && (
                <div className="p-3 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/30 rounded-xl">
                  <p className="text-xs text-red-700 dark:text-red-300 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" /> {inviteError}</p>
                </div>
              )}
              <div>
                <label className="text-xs font-bold text-gray-600 dark:text-gray-300 block mb-1.5">Display Name <span className="text-red-500">*</span></label>
                <input className="w-full px-4 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-emerald-500 outline-none" placeholder="Jane Smith" value={inviteForm.displayName} onChange={e => setInviteForm(f => ({ ...f, displayName: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs font-bold text-gray-600 dark:text-gray-300 block mb-1.5">Email <span className="text-red-500">*</span></label>
                <input type="email" className="w-full px-4 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-emerald-500 outline-none" placeholder="operator@aegis.gov.uk" value={inviteForm.email} onChange={e => setInviteForm(f => ({ ...f, email: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs font-bold text-gray-600 dark:text-gray-300 block mb-1.5">Initial Password <span className="text-red-500">*</span></label>
                <input type="password" className="w-full px-4 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-emerald-500 outline-none" placeholder="Min 12 chars, mixed case + number + symbol" value={inviteForm.password} onChange={e => setInviteForm(f => ({ ...f, password: e.target.value }))} />
                <p className="text-[10px] text-gray-400 dark:text-gray-300 mt-1">Operator will receive a verification email. They can change this password after first login.</p>
              </div>
              <div>
                <label className="text-xs font-bold text-gray-600 dark:text-gray-300 block mb-1.5">Role</label>
                <div className="grid grid-cols-2 gap-2">
                  {['operator', 'manager'].map(r => (
                    <button key={r} onClick={() => setInviteForm(f => ({ ...f, role: r }))}
                      className={`py-2.5 rounded-xl text-xs font-bold transition-all capitalize ${inviteForm.role === r ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 ring-2 ring-emerald-500/30' : 'bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'}`}>
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-gray-600 dark:text-gray-300 block mb-1.5">{t('users.department', lang)}</label>
                <select className="w-full px-4 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-emerald-500 outline-none" value={inviteForm.department} onChange={e => setInviteForm(f => ({ ...f, department: e.target.value }))}>
                  <option value="">{t('users.selectDepartment', lang)}</option>
                  {departments.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-gray-600 dark:text-gray-300 block mb-1.5">{t('common.phone', lang)}</label>
                <input className="w-full px-4 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-emerald-500 outline-none" placeholder="+44 1234 567890" value={inviteForm.phone} onChange={e => setInviteForm(f => ({ ...f, phone: e.target.value }))} />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setShowInviteModal(false)} className="flex-1 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-xl py-3 text-sm font-semibold transition-colors">{t('common.cancel', lang)}</button>
                <button onClick={handleInvite} disabled={inviteLoading} className="flex-1 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 disabled:from-gray-400 disabled:to-gray-400 text-white rounded-xl py-3 text-sm font-bold shadow-lg shadow-emerald-500/20 transition-all flex items-center justify-center gap-2">
                  {inviteLoading ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Creating...</> : <><UserPlus className="w-3.5 h-3.5" /> Send Invite</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

