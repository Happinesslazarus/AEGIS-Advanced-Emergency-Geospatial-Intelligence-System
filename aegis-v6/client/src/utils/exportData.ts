import type { Report } from '../types'

export function exportReportsCSV(reports: Report[], filename = 'aegis-reports.csv'): void {
  const headers = ['ID', 'Type', 'Category', 'Subtype', 'Location', 'Lat', 'Lng', 'Severity', 'Status', 'Description', 'Trapped', 'Media', 'Media Type', 'AI Confidence', 'Panic Level', 'Fake Probability', 'Reporter', 'Timestamp']

  const rows = reports.map(r => [
    r.id, r.type, r.incidentCategory, r.incidentSubtype,
    `"${r.location.replace(/"/g, '""')}"`,
    r.coordinates[0], r.coordinates[1],
    r.severity, r.status,
    `"${r.description.replace(/"/g, '""')}"`,
    r.trappedPersons, r.hasMedia, r.mediaType || '',
    r.confidence ?? '', r.aiAnalysis?.panicLevel ?? '', r.aiAnalysis?.fakeProbability ?? '',
    r.reporter, r.timestamp,
  ])

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  link.click()
  URL.revokeObjectURL(link.href)
}

export function exportReportJSON(reports: Report[], filename = 'aegis-reports.json'): void {
  const json = JSON.stringify(reports, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  link.click()
  URL.revokeObjectURL(link.href)
}
