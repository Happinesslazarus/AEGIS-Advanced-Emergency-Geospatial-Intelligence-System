import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react'
import { apiGetReports, apiUpdateReportStatus, apiSubmitReport } from '../utils/api'
import { translateTexts } from '../utils/translateService'
import { useLanguage } from '../hooks/useLanguage'
import { useSharedSocket } from './SocketContext'
import type { Report, NewReportInput } from '../types'

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

function normalizeServerReport(report: any): Report {
  return {
    id: report.id || report.reportNumber,
    reportNumber: report.reportNumber,
    incidentCategory: report.incidentCategory || 'Flood',
    incidentSubtype: report.incidentSubtype || '',
    type: report.type || report.incidentCategory || 'Flood',
    description: report.description || '',
    severity: report.severity || 'Medium',
    status: report.status || 'Unverified',
    trappedPersons: report.trappedPersons || 'no',
    location: report.location || report.locationText || 'Unknown',
    coordinates: report.coordinates || [57.15, -2.09],
    hasMedia: report.hasMedia || false,
    mediaType: report.mediaType || null,
    mediaUrl: report.mediaUrl || null,
    media: report.media || [],
    reporter: report.reporter || 'Anonymous Citizen',
    confidence: (() => { const v = report.confidence ?? report.aiConfidence; if (v == null) return null; const n = parseFloat(String(v)); return isNaN(n) ? null : n; })(),
    aiAnalysis: report.aiAnalysis || null,
    locationMetadata: report.locationMetadata || null,
    timestamp: report.timestamp || report.createdAt || new Date().toISOString(),
    displayTime: formatTimeAgo(report.timestamp || report.createdAt),
    operatorNotes: report.operatorNotes || null,
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
        setRawReports(serverReports)
      })
      .catch((error: any) => {
        console.warn('[ReportsContext] Failed to fetch from server, starting with empty list:', error.message)
        setRawReports([])
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetchReports()
  }, [fetchReports])

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

    socket.on('report:new', (report: any) => {
      const newReport = normalizeServerReport({
        ...report,
        timestamp: report.timestamp || report.createdAt || new Date().toISOString(),
      })

      setRawReports((prev) => {
        if (prev.some((existing) => existing.id === newReport.id)) return prev
        return [newReport, ...prev]
      })
    })

    socket.on('report:updated', (update: any) => {
      if (!update?.id || !update?.status) return
      setRawReports((prev) =>
        prev.map((report) => (report.id === update.id ? { ...report, status: update.status } : report)),
      )
    })

    socket.on('report:bulk-updated', (update: any) => {
      if (!Array.isArray(update?.reportIds) || !update?.status) return
      setRawReports((prev) =>
        prev.map((report) =>
          update.reportIds.includes(report.id) ? { ...report, status: update.status } : report,
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

    const created: any = await apiSubmitReport(formData)
    await fetchReports()

    // Resolve the reporter name from the citizen JWT stored in localStorage
    let reporterName = 'Anonymous Citizen'
    try {
      const raw = localStorage.getItem('aegis-citizen-token')
      if (raw) {
        const payload = JSON.parse(atob(raw.split('.')[1]))
        if (payload?.displayName) reporterName = payload.displayName
      }
    } catch { /* ignore — malformed token */ }

    return {
      ...input,
      id: created?.id || `RPT-${Date.now()}`,
      reportNumber: created?.reportNumber,
      timestamp: created?.createdAt || new Date().toISOString(),
      displayTime: 'Just now',
      status: 'Unverified',
      reporter: reporterName,
      confidence: created?.aiConfidence ?? null,
      aiAnalysis: null,
      locationMetadata: input.locationMetadata || null,
    } as Report
  }, [fetchReports])

  const verifyReport = useCallback((id: string) => {
    apiUpdateReportStatus(id, 'Verified').catch(() => {})
    setRawReports((prev) => prev.map((report) => (report.id === id ? { ...report, status: 'Verified' as const } : report)))
  }, [])

  const flagReport = useCallback((id: string) => {
    apiUpdateReportStatus(id, 'Flagged').catch(() => {})
    setRawReports((prev) => prev.map((report) => (report.id === id ? { ...report, status: 'Flagged' as const } : report)))
  }, [])

  const markUrgent = useCallback((id: string) => {
    apiUpdateReportStatus(id, 'Urgent').catch(() => {})
    setRawReports((prev) => prev.map((report) => (report.id === id ? { ...report, status: 'Urgent' as const } : report)))
  }, [])

  const resolveReport = useCallback((id: string) => {
    apiUpdateReportStatus(id, 'Resolved').catch(() => {})
    setRawReports((prev) => prev.map((report) => (report.id === id ? { ...report, status: 'Resolved' as const } : report)))
  }, [])

  const archiveReport = useCallback((id: string) => {
    apiUpdateReportStatus(id, 'Archived').catch(() => {})
    setRawReports((prev) => prev.map((report) => (report.id === id ? { ...report, status: 'Archived' as const } : report)))
  }, [])

  const markFalseReport = useCallback((id: string) => {
    apiUpdateReportStatus(id, 'False_Report').catch(() => {})
    setRawReports((prev) => prev.map((report) => (report.id === id ? { ...report, status: 'False_Report' as const } : report)))
  }, [])

  const refreshReports = useCallback(() => {
    fetchReports()
  }, [fetchReports])

  const filteredReports = reports.filter((report) => {
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
  })

  const stats: ReportStats = {
    total: reports.length,
    unverified: reports.filter((report) => report.status === 'Unverified').length,
    verified: reports.filter((report) => report.status === 'Verified').length,
    urgent: reports.filter((report) => report.status === 'Urgent').length,
    flagged: reports.filter((report) => report.status === 'Flagged').length,
    high: reports.filter((report) => report.severity === 'High').length,
    medium: reports.filter((report) => report.severity === 'Medium').length,
    low: reports.filter((report) => report.severity === 'Low').length,
  }

  return (
    <ReportsContext.Provider
      value={{
        reports,
        filteredReports,
        stats,
        addReport,
        verifyReport,
        flagReport,
        markUrgent,
        resolveReport,
        archiveReport,
        markFalseReport,
        loading,
        refreshReports,
        filterSeverity,
        setFilterSeverity,
        filterStatus,
        setFilterStatus,
        filterType,
        setFilterType,
        searchQuery,
        setSearchQuery,
      }}
    >
      {children}
    </ReportsContext.Provider>
  )
}

export function useReports(): ReportsContextType {
  const context = useContext(ReportsContext)
  if (!context) throw new Error('useReports must be within ReportsProvider')
  return context
}
