/**
 * Leaflet popup HTML builders. Centralises inline-styled popup markup
 * shared across LiveMap, DisasterMap, Map3DView. Each builder returns a
 * trusted HTML string passed to layer.bindPopup().
 *
 * All callers should pre-sanitise any free-form text fields - these
 * builders assume short, safe operator/feed-controlled strings.
 */

//Shared style fragments (kept inline to avoid runtime concat overhead)
const TXT_MUTED = 'color:#9ca3af;font-size:9px;'
const TXT_DIM = 'color:#6b7280;font-size:9px;'
const DIVIDER = 'border-top:1px solid #374151;padding-top:6px;margin-top:4px;'

//Reusable atoms

/** Coloured pill / status badge */
export function chip(text: string, color: string, opts: { bg?: string; size?: number } = {}): string {
  const bg = opts.bg ?? `${color}30`
  const size = opts.size ?? 9
  return `<span style="background:${bg};color:${color};font-size:${size}px;font-weight:700;padding:2px 8px;border-radius:99px;text-transform:uppercase;">${text}</span>`
}

/** Horizontal progress bar (0-100). */
export function progressBar(percent: number, color: string, height = 6): string {
  const w = Math.max(0, Math.min(100, percent))
  return `<div style="height:${height}px;background:#374151;border-radius:99px;overflow:hidden;"><div style="height:100%;width:${w}%;background:${color};border-radius:99px;transition:width 0.5s;"></div></div>`
}

/** Label + value row (e.g. "Flood Risk    78%") */
export function labelValue(label: string, value: string, valueColor = '#fff'): string {
  return `<div style="display:flex;justify-content:space-between;font-size:9px;color:#9ca3af;margin-bottom:2px;"><span>${label}</span><span style="color:${valueColor};font-weight:600;">${value}</span></div>`
}

//Severity colour resolver shared across popup types
export function severityColour(severity: string): string {
  const s = String(severity).toLowerCase()
  if (s === 'critical' || s === 'severe') return '#dc2626'
  if (s === 'high' || s === 'warning') return '#f97316'
  if (s === 'medium' || s === 'above normal') return '#eab308'
  if (s === 'low' || s === 'normal') return '#22c55e'
  return '#6b7280'
}

//Domain builders

export interface ReportPopupData {
  id: string | number
  title?: string
  category?: string
  type?: string
  severity?: string
  location?: string
  description?: string
  status?: string
  created_at?: string | number | Date
}

export function reportPopup(r: ReportPopupData): string {
  const sev = r.severity || 'Low'
  const color = severityColour(sev)
  const desc = r.description
    ? `<p style="color:#d1d5db;font-size:10px;margin:0 0 6px;max-height:40px;overflow:hidden;">${r.description.substring(0, 120)}${r.description.length > 120 ? '--' : ''}</p>`
    : ''
  return `<div style="min-width:180px;">
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
      ${chip(sev, color, { bg: color })}
      <span style="${TXT_DIM}">#${r.id}</span>
    </div>
    <p style="font-weight:600;font-size:13px;margin:0 0 4px;">${r.title || r.category || r.type || 'Incident Report'}</p>
    <p style="${TXT_MUTED}margin:0 0 4px;">${r.location || ''}</p>
    ${desc}
    <div style="display:flex;justify-content:space-between;align-items:center;${DIVIDER}">
      <span style="${TXT_DIM}">${r.status || ''}</span>
      <span style="${TXT_DIM}">${r.created_at ? new Date(r.created_at).toLocaleString() : ''}</span>
    </div>
  </div>`
}

export interface RiverPopupData {
  stationName?: string
  riverName?: string
  levelMetres?: number
  flowCumecs?: number
  percentageOfFloodLevel?: number
  status?: string
  trend?: string
  dataSource?: string
}

export function riverPopup(s: RiverPopupData): string {
  const colour = severityColour(s.status || 'normal')
  const pct = s.percentageOfFloodLevel || 0
  return `<div style="min-width:200px;">
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${colour}" stroke-width="2"><path d="M7 16.3c2.2 0 4-1.83 6.2-1.83 2.2 0 4 1.83 6.2 1.83"/><path d="M7 11.3c2.2 0 4-1.83 6.2-1.83 2.2 0 4 1.83 6.2 1.83"/></svg>
      <span style="font-weight:700;font-size:13px;">${s.stationName || s.riverName || ''}</span>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
      <div><span style="${TXT_MUTED}text-transform:uppercase;">Level</span><div style="font-size:18px;font-weight:800;font-family:monospace;">${s.levelMetres?.toFixed(2) ?? '--'}m</div></div>
      <div><span style="${TXT_MUTED}text-transform:uppercase;">Flow</span><div style="font-size:14px;font-weight:700;font-family:monospace;">${s.flowCumecs?.toFixed(1) ?? '--'} m--/s</div></div>
    </div>
    <div style="margin-bottom:6px;">${labelValue('Flood Risk', `${pct}%`, colour)}${progressBar(pct, colour)}</div>
    <div style="display:flex;justify-content:space-between;border-top:1px solid #374151;padding-top:6px;">${chip(s.status || 'normal', colour)}<span style="${TXT_DIM}">Trend: ${s.trend || 'Steady'}</span></div>
    <div style="margin-top:4px;font-size:8px;color:#4b5563;">${s.dataSource || ''}</div>
  </div>`
}

export interface DistressPopupData {
  citizenName?: string
  citizen_name?: string
  message?: string
  activatedAt?: string | number | Date
}

export function distressPopup(b: DistressPopupData): string {
  return `<div style="min-width:180px;">
    <div style="color:#ef4444;font-weight:700;font-size:14px;margin-bottom:4px;">🚨 DISTRESS BEACON</div>
    <p style="font-size:12px;margin:0 0 4px;">${b.citizenName || b.citizen_name || 'Citizen'}</p>
    <p style="${TXT_MUTED}margin:0;">${b.message || 'Emergency assistance requested'}</p>
    <div style="margin-top:6px;${DIVIDER}font-size:9px;color:#6b7280;">${b.activatedAt ? new Date(b.activatedAt).toLocaleString() : ''}</div>
  </div>`
}

export function evacuationRoutePopup(r: { name?: string; description?: string }): string {
  return `<div>
    <p style="font-weight:700;font-size:13px;margin:0 0 4px;">${r.name || 'Evacuation Route'}</p>
    <p style="${TXT_MUTED}margin:0;">${r.description || ''}</p>
  </div>`
}

export interface StationPopupData {
  station_name?: string
  station_id?: string
  river_name?: string
  jurisdiction?: string
  level_m?: number | string
  typical_high_m?: number | string
  level_status?: string
  trend?: string
}

export function stationPopup(p: StationPopupData): string {
  const level = parseFloat(String(p.level_m ?? '')) || 0
  const typical = parseFloat(String(p.typical_high_m ?? '')) || 0
  const pct = typical > 0 ? Math.round((level / typical) * 100) : 0
  const status = p.level_status || 'normal'
  const colour = severityColour(status)
  const levelBlock = level > 0
    ? `<div style="margin-bottom:6px;">${labelValue(`Level: ${level.toFixed(2)}m`, `${pct}% of typical high`, colour)}${progressBar(pct, colour, 5)}</div>`
    : `<div style="font-size:9px;color:#6b7280;margin-bottom:4px;">No level reading available</div>`
  return `<div style="min-width:190px;">
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${colour}" stroke-width="2"><path d="M7 16.3c2.2 0 4-1.83 6.2-1.83 2.2 0 4 1.83 6.2 1.83"/><path d="M7 11.3c2.2 0 4-1.83 6.2-1.83 2.2 0 4 1.83 6.2 1.83"/></svg>
      <span style="font-weight:700;font-size:12px;">${p.station_name || p.station_id || ''}</span>
    </div>
    <div style="${TXT_MUTED}margin-bottom:4px;">${p.river_name || ''} -- ${p.jurisdiction || 'EA'}</div>
    ${levelBlock}
    <div style="display:flex;justify-content:space-between;border-top:1px solid #374151;padding-top:4px;">${chip(status, colour, { size: 8 })}<span style="font-size:8px;color:#6b7280;">Trend: ${p.trend || 'Steady'}</span></div>
  </div>`
}

export interface PredictionPopupData {
  area?: string
  severity?: string
  probability?: number | string
  time_to_flood?: string
  matched_pattern?: string
  next_areas?: string[]
  confidence?: number | string
  model_version?: string
}

export function predictionPopup(p: PredictionPopupData): string {
  const prob = parseFloat(String(p.probability ?? '')) || 0
  const colour = prob >= 0.75 ? '#dc2626' : prob >= 0.5 ? '#f97316' : '#eab308'
  const pctLabel = `${Math.round(prob * 100)}%`
  const downstream = p.next_areas?.length
    ? `<div style="font-size:9px;color:#fbbf24;display:flex;align-items:center;gap:3px;"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2" style="flex-shrink:0;"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>Downstream: ${p.next_areas.join(', ')}</div>`
    : ''
  return `<div style="min-width:210px;">
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">${chip(`${p.severity || 'MEDIUM'} RISK`, colour)}<span style="${TXT_MUTED}">AI Prediction</span></div>
    <p style="font-weight:700;font-size:13px;margin:0 0 2px;">${p.area || ''}</p>
    <div style="margin-bottom:6px;">${labelValue('Flood Probability', pctLabel, colour)}${progressBar(prob * 100, colour, 5)}</div>
    <div style="font-size:9px;color:#9ca3af;margin-bottom:4px;display:flex;align-items:center;gap:3px;"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="2" style="flex-shrink:0;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>${p.time_to_flood || 'Unknown'}</div>
    <div style="font-size:9px;color:#60a5fa;margin-bottom:4px;display:flex;align-items:center;gap:3px;"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" stroke-width="2" style="flex-shrink:0;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>${p.matched_pattern || ''}</div>
    ${downstream}
    <div style="${DIVIDER}font-size:8px;color:#6b7280;">Confidence: ${p.confidence ?? '--'}% -- ${p.model_version ?? ''}</div>
  </div>`
}

export interface RiskZonePopupData {
  name?: string
  area_name?: string
  risk_level?: string
  severity?: string
  description?: string
}

export function riskZonePopup(p: RiskZonePopupData): string {
  const name = p.name || p.area_name || 'Risk Zone'
  const risk = p.risk_level || p.severity || 'medium'
  const colour = severityColour(risk)
  return `<div style="min-width:180px;">
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">${chip(`${risk} RISK`, colour)}</div>
    <p style="font-weight:700;font-size:13px;margin:0 0 2px;">${name}</p>
    ${p.description ? `<p style="${TXT_MUTED}margin:0;">${p.description}</p>` : ''}
  </div>`
}

/** Simple title + severity popup used by DisasterMap flood areas. */
export function simpleSeverityPopup(name: string, severity: string): string {
  return `<strong>${name}</strong><br/><span style="font-size:11px">Severity: ${String(severity).toUpperCase()}</span>`
}

/** Station popup used by DisasterMap (smaller variant). */
export function simpleStationPopup(name: string, levelM: number | undefined, status: string): string {
  const level = levelM != null ? `${levelM.toFixed(2)}m` : 'N/A'
  return `<strong>${name}</strong><br/><span style="font-size:11px">Level: ${level}</span><br/><span style="font-size:11px">Status: ${String(status).toUpperCase()}</span>`
}

/** Risk area polygon popup used by DisasterMap. */
export function riskAreaPopup(name: string, risk: string, description?: string): string {
  const colour = severityColour(risk)
  return `<strong>${name}</strong><br/><span style="font-size:11px;color:${colour}">Risk: ${String(risk).toUpperCase()}</span>${description ? `<br/><span style="font-size:10px;">${description}</span>` : ''}`
}
