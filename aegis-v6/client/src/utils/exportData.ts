/**
 * File: exportData.ts
 *
 * What this file does:
 * Exports incident reports to CSV for offline analysis. Builds a
 * comma-separated file in memory, triggers a browser download, and
 * revokes the object URL afterwards to free memory.
 *
 * How it connects:
 * - Called by AdminPage.tsx export button
 * - Imports the Report type from client/src/types/index.ts
 * - No server call needed -- works entirely from in-memory report data
 */

import type { Report } from '../types'

export function exportReportsCSV(reports: Report[], filename = 'aegis-reports.csv'): void {
  const headers = ['ID', 'Type', 'Category', 'Subtype', 'Location', 'Lat', 'Lng', 'Severity', 'Status', 'Description', 'Trapped', 'Media', 'Media Type', 'AI Confidence', 'Panic Level', 'Fake Probability', 'Reporter', 'Timestamp']

  const rows = reports.map(r => [
    r.id, r.type, r.incidentCategory, r.incidentSubtype,
    // Wrap the location string in quotes and escape any embedded quotes (‘"’ → '""')
    // so the CSV parser doesn't mistake a comma inside the location as a column delimiter.
    `"${r.location.replace(/"/g, '""')}"`,
    r.coordinates[0], r.coordinates[1],
    r.severity, r.status,
    `"${r.description.replace(/"/g, '""')}"`,
    r.trappedPersons, r.hasMedia, r.mediaType || '',
    r.confidence ?? '', r.aiAnalysis?.panicLevel ?? '', r.aiAnalysis?.fakeProbability ?? '',
    r.reporter, r.timestamp,
  ])

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')

  // Blob = an in-memory file-like object.  We create one containing the CSV
  // text, then generate a temporary 'blob:' URL pointing to it.
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  // URL.createObjectURL creates a temporary download URL valid only for this
  // browser session.  We click it to trigger the Save-File dialog.
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  link.click()
  // revokeObjectURL frees the memory held by the blob URL once the
  // download has been initiated (the file still completes downloading).
  URL.revokeObjectURL(link.href)
}

export function exportReportJSON(reports: Report[], filename = 'aegis-reports.json'): void {
  // null, 2 = pretty-print with 2-space indentation for human readability.
  const json = JSON.stringify(reports, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  link.click()
  URL.revokeObjectURL(link.href)
}
