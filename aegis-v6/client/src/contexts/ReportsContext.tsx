/**
 * Fetches citizen-submitted incident reports from /api/reports with
 * cursor-based pagination. Caches pages locally and exposes
 * submitReport / updateReport helpers.
 */

import { createContext, useContext, useState, useCallback, useEffect, useMemo, type ReactNode } from 'react'
import { apiGetReports, apiUpdateReportStatus, apiSubmitReport } from '../utils/api'
import { translateTexts } from '../utils/translateService'
import { useLanguage } from '../hooks/useLanguage'
import { useSharedSocket } from './SocketContext'
import { getCitizenToken } from './CitizenAuthContext'
import type { Report, NewReportInput, ServerReport, NewReportResponse } from '../types'

interface ReportStats {
  total: number
  unverified: number
  verified: number
  urgent: number
  flagged: number
  high: number
  medium: number
  low: number
}

interface ReportsContextType {
  reports: Report[]
  filteredReports: Report[]
  stats: ReportStats
  addReport: (input: NewReportInput, files?: File[]) => Promise<Report | null>
  verifyReport: (id: string) => void
  flagReport: (id: string) => void
  markUrgent: (id: string) => void
  resolveReport: (id: string) => void
  archiveReport: (id: string) => void
  markFalseReport: (id: string) => void
  refreshReports: () => void
  loading: boolean
  filterSeverity: string
  setFilterSeverity: (value: string) => void
  filterStatus: string
  setFilterStatus: (value: string) => void
  filterType: string
  setFilterType: (value: string) => void
  searchQuery: string
  setSearchQuery: (value: string) => void
}

const ReportsContext = createContext<ReportsContextType | null>(null)

function formatTimeAgo(dateStr?: string): string {
  if (!dateStr) return 'Unknown'
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function normalizeServerReport(report: ServerReport | Record<string, unknown>): Report {
  const r = report as Record<string, unknown>
  return {
    id: String(r.id || r.report_number || r.reportNumber || ''),
    reportNumber: String(r.report_number || r.reportNumber || ''),
    incidentCategory: (r.incident_category || r.incidentCategory || 'Flood') as Report['incidentCategory'],
    incidentSubtype: String(r.incident_subtype || r.incidentSubtype || ''),
    type: String(r.type || r.incident_category || r.incidentCategory || 'Flood'),
    description: String(r.description || ''),
    severity: (r.severity || 'Medium') as Report['severity'],
    status: (r.status || 'Unverified') as Report['status'],
    trappedPersons: (r.trapped_persons || r.trappedPersons || 'no') as Report['trappedPersons'],
    location: String(r.location || r.location_text || r.locationText || 'Unknown'),
    coordinates: (r.coordinates as [number, number]) || [57.15, -2.09],
    hasMedia: Boolean(r.has_media || r.hasMedia),
    mediaType: (r.media_type || r.mediaType || null) as Report['mediaType'],
    mediaUrl: (r.media_url || r.mediaUrl || null) as string | undefined,
    media: (r.media as Report['media']) || [],
    reporter: String(r.reporter || r.reporter_name || 'Anonymous Citizen'),
    confidence: (() => { const v = r.confidence ?? r.aiConfidence; if (v == null) return null; const n = typeof v === 'number' ? v : parseFloat(String(v)); return (Number.isFinite(n) && n >= 0 && n <= 1) ? n : null; })(),
    aiAnalysis: (r.ai_analysis || r.aiAnalysis || null) as Report['aiAnalysis'],
    locationMetadata: (r.location_metadata || r.locationMetadata || null) as Report['locationMetadata'],
    timestamp: String(r.timestamp || r.created_at || r.createdAt || new Date().toISOString()),
    displayTime: formatTimeAgo(String(r.timestamp || r.created_at || r.createdAt || '')),
    operatorNotes: (r.operator_notes || r.operatorNotes || null) as string | null,
  }
}

async function translateReportFields(reports: Report[], language: string): Promise<Report[]> {
  if (language === 'en' || reports.length === 0) return reports

  const textQueue: string[] = []
  for (const report of reports) {
    if (report.description?.trim()) textQueue.push(report.description)
    const reasoning = report.aiAnalysis?.reasoning?.trim()
    if (reasoning) textQueue.push(reasoning)
    const operatorNotes = report.operatorNotes?.trim()
    if (operatorNotes) textQueue.push(operatorNotes)
  }

  if (textQueue.length === 0) return reports

  const uniqueTexts = [...new Set(textQueue)]
  const translationResults = await translateTexts(uniqueTexts, 'auto', language)
  const translations = new Map<string, string>()

  translationResults.forEach((result, index) => {
    const sourceText = uniqueTexts[index]
    if (!sourceText) return
    if (result.available && result.translatedText && result.translatedText !== sourceText) {
      translations.set(sourceText, result.translatedText)
    }
  })

  return reports.map((report) => {
    const translatedDescription = translations.get(report.description) || report.description
    const translatedReasoning = report.aiAnalysis?.reasoning
      ? translations.get(report.aiAnalysis.reasoning) || report.aiAnalysis.reasoning
      : report.aiAnalysis?.reasoning
    const translatedOperatorNotes = report.operatorNotes
      ? translations.get(report.operatorNotes) || report.operatorNotes
      : report.operatorNotes

    return {
      ...report,
      description: translatedDescription,
      operatorNotes: translatedOperatorNotes,
      aiAnalysis: report.aiAnalysis
        ? { ...report.aiAnalysis, reasoning: translatedReasoning }
        : report.aiAnalysis,
    }
  })
}

export function ReportsProvider({ children }: { children: ReactNode }): JSX.Element {
  const sharedSocket = useSharedSocket()
  const language = useLanguage()
  const [rawReports, setRawReports] = useState<Report[]>([])
  const [reports, setReports] = useState<Report[]>([])
  const [loading, setLoading] = useState(true)
  const [filterSeverity, setFilterSeverity] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterType, setFilterType] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')

  const fetchReports = useCallback(() => {
    setLoading(true)
    apiGetReports()
      .then((data: any) => {
        const arr = Array.isArray(data) ? data : (data?.data ?? [])
        const serverReports = arr.map((report: any) => normalizeServerReport(report))
        //Merge: preserve any optimistically-added reports not yet returned by server
        // (e.g. submitted just before this fetch completed, or server cache not yet invalidated)
        setRawReports(prev => {
          const serverIds = new Set(serverReports.map((r: Report) => r.id))
          const pending = prev.filter(r => !serverIds.has(r.id))
          return [...pending, ...serverReports]
        })
      })
      .catch((error: any) => {
        console.warn('[ReportsContext] Failed to fetch from server, starting with empty list:', error.message)
        //On error, keep existing state rather than wiping to empty
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetchReports()
  }, [fetchReports])

  //Polling fallback: re-fetch every 30s when the socket is not connected.
  //This ensures anonymous users and users whose socket hasn't yet authenticated
  // (latent silent-refresh) still see live counts without needing a socket event.
  useEffect(() => {
    if (sharedSocket.connected) return   // socket is live -- no need to poll
    const id = setInterval(fetchReports, 30_000)
    return () => clearInterval(id)
  }, [sharedSocket.connected, fetchReports])

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      const translated = await translateReportFields(rawReports, language)
      if (!cancelled) setReports(translated)
    })().catch(() => {
      if (!cancelled) setReports(rawReports)
    })

    return () => {
      cancelled = true
    }
  }, [rawReports, language])

  useEffect(() => {
    const socket = sharedSocket.socket
    if (!socket) return

    socket.on('report:new', (report: Record<string, unknown>) => {
      const newReport = normalizeServerReport({
        ...report,
        timestamp: report.timestamp || report.createdAt || new Date().toISOString(),
      } as Record<string, unknown>)

      setRawReports((prev) => {
        const existingIdx = prev.findIndex((r) => r.id === newReport.id)
        if (existingIdx !== -1) {
          //Report already exists (optimistic update or prior fetch).
          //Merge in media data from the socket broadcast -- the socket version
          //carries the authoritative media URLs that the public API omits.
          const existing = prev[existingIdx]
          const hasNewMedia = (newReport.media?.length ?? 0) > 0 || !!newReport.mediaUrl
          const hasCachedMedia = (existing.media?.length ?? 0) > 0 || !!existing.mediaUrl
          if (hasNewMedia && !hasCachedMedia) {
            const updated = [...prev]
            updated[existingIdx] = { ...existing, media: newReport.media, mediaUrl: newReport.mediaUrl, hasMedia: true }
            return updated
          }
          return prev
        }
        return [newReport, ...prev]
      })
    })

    socket.on('report:updated', (update: { id?: string; status?: string }) => {
      if (!update?.id || !update?.status) return
      setRawReports((prev) =>
        prev.map((report) => (report.id === update.id ? { ...report, status: update.status as Report['status'] } : report)),
      )
    })

    socket.on('report:bulk-updated', (update: { reportIds?: string[]; status?: string }) => {
      if (!Array.isArray(update?.reportIds) || !update?.status) return
      setRawReports((prev) =>
        prev.map((report) =>
          update.reportIds!.includes(report.id) ? { ...report, status: update.status as Report['status'] } : report,
        ),
      )
    })

    return () => {
      socket.off('report:new')
      socket.off('report:updated')
      socket.off('report:bulk-updated')
    }
  }, [sharedSocket.socket])

  const addReport = useCallback(async (input: NewReportInput, files: File[] = []): Promise<Report | null> => {
    const formData = new FormData()
    formData.append('incidentCategory', input.incidentCategory)
    formData.append('incidentSubtype', input.incidentSubtype || '')
    formData.append('displayType', input.type || '')
    formData.append('description', input.description)
    formData.append('severity', input.severity)
    formData.append('trappedPersons', input.trappedPersons)
    formData.append('locationText', input.location)
    formData.append('lat', String(input.coordinates?.[0] ?? 57.15))
    formData.append('lng', String(input.coordinates?.[1] ?? -2.09))

    if (input.locationMetadata) {
      formData.append('locationMetadata', JSON.stringify(input.locationMetadata))
    }

    if (input.customFields && Object.keys(input.customFields).length > 0) {
      formData.append('customFields', JSON.stringify(input.customFields))
    }

    if (files.length > 0) {
      for (const file of files) {
        formData.append('evidence', file)
      }
    }

    const created = (await apiSubmitReport(formData)) as NewReportResponse | null

    //Resolve the reporter name from the citizen JWT stored in localStorage
    let reporterName = 'Anonymous Citizen'
    try {
      const raw = getCitizenToken()
      if (raw && raw.split('.').length === 3) {
        const payload = JSON.parse(atob(raw.split('.')[1]))
        if (payload?.displayName) reporterName = payload.displayName
      }
    } catch { /* ignore -- malformed token */ }

    const newReport: Report = {
      ...input,
      id: created?.id || `RPT-${Date.now()}`,
      reportNumber: created?.reportNumber,
      timestamp: created?.createdAt || new Date().toISOString(),
      displayTime: 'Just now',
      status: 'Unverified',
      reporter: reporterName,
      confidence: created?.confidence ?? null,
      aiAnalysis: created?.aiAnalysis ?? null,
      locationMetadata: input.locationMetadata || null,
    } as Report

    //Optimistically prepend the new report so stats update immediately in the UI,
    //then do a background refresh to get the authoritative server-side record.
    setRawReports(prev => prev.some(r => r.id === newReport.id) ? prev : [newReport, ...prev])
    fetchReports()

    return newReport
  }, [fetchReports])

  //Optimistic update helper: applies status locally, rolls back on API failure
  const optimisticStatusUpdate = useCallback((id: string, newStatus: string) => {
    setRawReports((prev) => {
      const original = prev.find(r => r.id === id)
      if (!original) return prev
      const oldStatus = original.status
      //Apply optimistic update
      const updated = prev.map((report) => (report.id === id ? { ...report, status: newStatus as Report['status'] } : report))
      //Fire API call, rollback on failure
      apiUpdateReportStatus(id, newStatus).catch((err) => {
        console.error(`[Reports] Failed to update report ${id} to ${newStatus}:`, err.message)
        setRawReports((cur) => cur.map((report) => (report.id === id ? { ...report, status: oldStatus } : report)))
      })
      return updated
    })
  }, [])

  const verifyReport = useCallback((id: string) => optimisticStatusUpdate(id, 'Verified'), [optimisticStatusUpdate])
  const flagReport = useCallback((id: string) => optimisticStatusUpdate(id, 'Flagged'), [optimisticStatusUpdate])
  const markUrgent = useCallback((id: string) => optimisticStatusUpdate(id, 'Urgent'), [optimisticStatusUpdate])
  const resolveReport = useCallback((id: string) => optimisticStatusUpdate(id, 'Resolved'), [optimisticStatusUpdate])
  const archiveReport = useCallback((id: string) => optimisticStatusUpdate(id, 'Archived'), [optimisticStatusUpdate])
  const markFalseReport = useCallback((id: string) => optimisticStatusUpdate(id, 'False_Report'), [optimisticStatusUpdate])

  const refreshReports = useCallback(() => {
    fetchReports()
  }, [fetchReports])

  const filteredReports = useMemo(() => reports.filter((report) => {
    if (filterSeverity !== 'all' && report.severity !== filterSeverity) return false
    if (filterStatus !== 'all' && report.status !== filterStatus) return false
    if (filterType !== 'all' && report.incidentCategory !== filterType) return false
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      return (
        report.description.toLowerCase().includes(query) ||
        report.location.toLowerCase().includes(query) ||
        report.id.toLowerCase().includes(query)
      )
    }
    return true
  }), [reports, filterSeverity, filterStatus, filterType, searchQuery])

  const stats: ReportStats = useMemo(() => ({
    total: reports.length,
    unverified: reports.filter((report) => report.status === 'Unverified').length,
    verified: reports.filter((report) => report.status === 'Verified').length,
    urgent: reports.filter((report) => report.status === 'Urgent').length,
    flagged: reports.filter((report) => report.status === 'Flagged').length,
    high: reports.filter((report) => report.severity === 'High').length,
    medium: reports.filter((report) => report.severity === 'Medium').length,
    low: reports.filter((report) => report.severity === 'Low').length,
  }), [reports])

  const value = useMemo(() => ({
    reports, filteredReports, stats,
    addReport, verifyReport, flagReport, markUrgent, resolveReport, archiveReport, markFalseReport,
    loading, refreshReports,
    filterSeverity, setFilterSeverity, filterStatus, setFilterStatus, filterType, setFilterType,
    searchQuery, setSearchQuery,
  }), [reports, filteredReports, stats, addReport, verifyReport, flagReport, markUrgent, resolveReport, archiveReport, markFalseReport, loading, refreshReports, filterSeverity, filterStatus, filterType, searchQuery])

  return (
    <ReportsContext.Provider value={value}>
      {children}
    </ReportsContext.Provider>
  )
}

const REPORTS_DEFAULTS: ReportsContextType = {
  reports: [], filteredReports: [], stats: { total: 0, unverified: 0, verified: 0, urgent: 0, flagged: 0, high: 0, medium: 0, low: 0 },
  addReport: async () => null, verifyReport: () => {}, flagReport: () => {}, markUrgent: () => {},
  resolveReport: () => {}, archiveReport: () => {}, markFalseReport: () => {}, refreshReports: () => {},
  loading: false, filterSeverity: '', setFilterSeverity: () => {}, filterStatus: '', setFilterStatus: () => {},
  filterType: '', setFilterType: () => {}, searchQuery: '', setSearchQuery: () => {},
}

export function useReports(): ReportsContextType {
  const context = useContext(ReportsContext)
  if (!context) {
    if (import.meta.env.DEV) console.warn('[Reports] Context unavailable -- returning safe defaults.')
    return REPORTS_DEFAULTS
  }
  return context
}
