import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react'
import { apiGetReports, apiUpdateReportStatus, apiSubmitReport } from '../utils/api'
import { useSharedSocket } from './SocketContext'
import type { Report, NewReportInput } from '../types'

interface ReportStats {
  total: number; unverified: number; verified: number; urgent: number
  flagged: number; high: number; medium: number; low: number
}

interface ReportsContextType {
  reports: Report[]; filteredReports: Report[]; stats: ReportStats
  addReport: (input: NewReportInput, files?: File[]) => Promise<Report | null>
  verifyReport: (id: string) => void; flagReport: (id: string) => void; markUrgent: (id: string) => void
  resolveReport: (id: string) => void; archiveReport: (id: string) => void; markFalseReport: (id: string) => void
  refreshReports: () => void
  loading: boolean
  filterSeverity: string; setFilterSeverity: (v: string) => void
  filterStatus: string; setFilterStatus: (v: string) => void
  filterType: string; setFilterType: (v: string) => void
  searchQuery: string; setSearchQuery: (v: string) => void
}

const ReportsContext = createContext<ReportsContextType | null>(null)

export function ReportsProvider({ children }: { children: ReactNode }): JSX.Element {
  const sharedSocket = useSharedSocket()
  const [reports, setReports] = useState<Report[]>([])
  const [loading, setLoading] = useState(true)
  const [filterSeverity, setFilterSeverity] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterType, setFilterType] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')

  // Fetch real reports from the server API
  const fetchReports = useCallback(() => {
    setLoading(true)
    apiGetReports()
      .then((data: any) => {
        const serverReports: Report[] = (Array.isArray(data) ? data : []).map((r: any) => ({
          id: r.id || r.reportNumber,
          reportNumber: r.reportNumber,
          incidentCategory: r.incidentCategory || 'Flood',
          incidentSubtype: r.incidentSubtype || '',
          type: r.type || r.incidentCategory || 'Flood',
          description: r.description || '',
          severity: r.severity || 'Medium',
          status: r.status || 'Unverified',
          trappedPersons: r.trappedPersons || 'no',
          location: r.location || r.locationText || 'Unknown',
          coordinates: r.coordinates || [57.15, -2.09],
          hasMedia: r.hasMedia || false,
          mediaType: r.mediaType || null,
          mediaUrl: r.mediaUrl || null,
          media: r.media || [],
          reporter: r.reporter || 'Anonymous Citizen',
          confidence: r.confidence || r.aiConfidence || null,
          aiAnalysis: r.aiAnalysis || null,
          locationMetadata: r.locationMetadata || null,
          timestamp: r.timestamp || r.createdAt || new Date().toISOString(),
          displayTime: formatTimeAgo(r.timestamp || r.createdAt),
          operatorNotes: r.operatorNotes || null,
        }))
        setReports(serverReports)
      })
      .catch((err: any) => {
        console.warn('[ReportsContext] Failed to fetch from server, starting with empty list:', err.message)
        setReports([])
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { fetchReports() }, [fetchReports])

  // WebSocket listener for real-time report updates (no manual refresh needed)
  useEffect(() => {
    const socket = sharedSocket.socket
    if (!socket) return

    // New report submitted by a citizen — add to list in real time
    socket.on('report:new', (report: any) => {
      // // console.log('[ReportsContext] Real-time report:new received', report?.reportNumber)
      const newReport: Report = {
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
        confidence: report.confidence || report.aiConfidence || null,
        aiAnalysis: report.aiAnalysis || null,
        locationMetadata: report.locationMetadata || null,
        timestamp: report.timestamp || report.createdAt || new Date().toISOString(),
        displayTime: 'Just now',
        operatorNotes: report.operatorNotes || null,
      }
      setReports(prev => {
        // Deduplicate — check if already in list
        if (prev.some(r => r.id === newReport.id)) return prev
        return [newReport, ...prev]
      })
    })

    // Report status updated — update in list
    socket.on('report:updated', (update: any) => {
      if (update?.id && update?.status) {
        setReports(prev => prev.map(r =>
          r.id === update.id ? { ...r, status: update.status } : r
        ))
      }
    })

    // Bulk status update — refresh the full list
    socket.on('report:bulk-updated', (update: any) => {
      if (Array.isArray(update?.reportIds) && update?.status) {
        setReports(prev => prev.map(r =>
          update.reportIds.includes(r.id) ? { ...r, status: update.status } : r
        ))
      }
    })

    return () => {
      socket.off('report:new')
      socket.off('report:updated')
      socket.off('report:bulk-updated')
    }
  }, [sharedSocket.socket])

  const addReport = useCallback(async (input: NewReportInput, files: File[] = []): Promise<Report | null> => {
    const fd = new FormData()
    fd.append('incidentCategory', input.incidentCategory)
    fd.append('incidentSubtype', input.incidentSubtype || '')
    fd.append('displayType', input.type || '')
    fd.append('description', input.description)
    fd.append('severity', input.severity)
    fd.append('trappedPersons', input.trappedPersons)
    fd.append('locationText', input.location)
    fd.append('lat', String(input.coordinates?.[0] ?? 57.15))
    fd.append('lng', String(input.coordinates?.[1] ?? -2.09))
    if (input.locationMetadata) {
      fd.append('locationMetadata', JSON.stringify(input.locationMetadata))
    }

    if (input.customFields && Object.keys(input.customFields).length > 0) {
      fd.append('customFields', JSON.stringify(input.customFields))
    }

    if (files.length > 0) {
      for (const file of files) {
        fd.append('evidence', file)
      }
    }

    const created: any = await apiSubmitReport(fd)
    await fetchReports()

    return {
      ...input,
      id: created?.id || `RPT-${Date.now()}`,
      reportNumber: created?.reportNumber,
      timestamp: created?.createdAt || new Date().toISOString(),
      displayTime: 'Just now',
      status: 'Unverified',
      reporter: 'Anonymous Citizen',
      confidence: created?.aiConfidence ?? null,
      aiAnalysis: null,
      locationMetadata: input.locationMetadata || null,
    } as Report
  }, [fetchReports])

  const verifyReport = useCallback((id: string) => {
    apiUpdateReportStatus(id, 'Verified').catch(() => {})
    setReports(p => p.map(r => r.id === id ? { ...r, status: 'Verified' as const } : r))
  }, [])
  const flagReport = useCallback((id: string) => {
    apiUpdateReportStatus(id, 'Flagged').catch(() => {})
    setReports(p => p.map(r => r.id === id ? { ...r, status: 'Flagged' as const } : r))
  }, [])
  const markUrgent = useCallback((id: string) => {
    apiUpdateReportStatus(id, 'Urgent').catch(() => {})
    setReports(p => p.map(r => r.id === id ? { ...r, status: 'Urgent' as const } : r))
  }, [])

  const filteredReports = reports.filter(r => {
    if (filterSeverity !== 'all' && r.severity !== filterSeverity) return false
    if (filterStatus !== 'all' && r.status !== filterStatus) return false
    if (filterType !== 'all' && r.incidentCategory !== filterType) return false
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      return r.description.toLowerCase().includes(q) || r.location.toLowerCase().includes(q) || r.id.toLowerCase().includes(q)
    }
    return true
  })

  const stats: ReportStats = {
    total: reports.length, unverified: reports.filter(r => r.status === 'Unverified').length,
    verified: reports.filter(r => r.status === 'Verified').length, urgent: reports.filter(r => r.status === 'Urgent').length,
    flagged: reports.filter(r => r.status === 'Flagged').length, high: reports.filter(r => r.severity === 'High').length,
    medium: reports.filter(r => r.severity === 'Medium').length, low: reports.filter(r => r.severity === 'Low').length,
  }

  const resolveReport = useCallback((id: string) => {
    apiUpdateReportStatus(id, 'Resolved').catch(() => {})
    setReports(p => p.map(r => r.id === id ? { ...r, status: 'Resolved' as const } : r))
  }, [])
  const archiveReport = useCallback((id: string) => {
    apiUpdateReportStatus(id, 'Archived').catch(() => {})
    setReports(p => p.map(r => r.id === id ? { ...r, status: 'Archived' as const } : r))
  }, [])
  const markFalseReport = useCallback((id: string) => {
    apiUpdateReportStatus(id, 'False_Report').catch(() => {})
    setReports(p => p.map(r => r.id === id ? { ...r, status: 'False_Report' as const } : r))
  }, [])
  const refreshReports = useCallback(() => { fetchReports() }, [fetchReports])

  return (
    <ReportsContext.Provider value={{ reports, filteredReports, stats, addReport, verifyReport, flagReport, markUrgent, resolveReport, archiveReport, markFalseReport, loading, refreshReports, filterSeverity, setFilterSeverity, filterStatus, setFilterStatus, filterType, setFilterType, searchQuery, setSearchQuery }}>
      {children}
    </ReportsContext.Provider>
  )
}

export function useReports(): ReportsContextType {
  const ctx = useContext(ReportsContext)
  if (!ctx) throw new Error('useReports must be within ReportsProvider')
  return ctx
}

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
