import type { CityRegionConfig } from '../config/regions/types.js'

export interface EvidenceEvent {
  id: string
  source: 'citizen_report' | 'sensor' | 'external_feed' | 'model'
  signalType: string
  lat: number
  lng: number
  occurredAt: Date
  confidence: number
  freshness: number
  provenance: string
  severity?: string
}

export interface IncidentCluster {
  cluster_id: string
  incident_type: string
  reports: number
  confidence: number
  center: { lat: number; lng: number }
  radius_m: number
  time_window_minutes: number
  report_ids: string[]
}

export interface CascadingInsight {
  chain: string[]
  confidence: number
  recommended_actions: string[]
}

export interface RegionalProviderAdapter {
  weatherProvider: string
  riverAuthority: string
  satelliteSource: string
  routingProfile: 'conservative' | 'balanced' | 'aggressive'
  legalContacts: string[]
  language: string
  units: 'metric' | 'imperial'
}

export type ConfidenceLifecycleState = 'weak' | 'possible' | 'probable' | 'high' | 'confirmed'

export interface IncidentObject {
  incident_id: string
  incident_type: string
  center: { lat: number; lng: number }
  radius_m: number
  time_window_minutes: number
  confidence: number
  lifecycle_state: ConfidenceLifecycleState
  evidence_count: number
  evidence_ids: string[]
  last_updated_at: string
  explanation: {
    summary: string
    drivers: string[]
    trace: Array<{ step: string; value: string }>
  }
}

interface ClusterOptions {
  radiusMeters: number
  minReports: number
}

interface RouteRiskMaskOptions {
  maxDistanceMeters: number
  maxEvents: number
  lookbackHours: number
}

type MultiPolygonMask = {
  type: 'MultiPolygon'
  coordinates: number[][][][]
}

const DEFAULT_CASCADE_RULES: Array<{ chain: string[]; trigger: (signals: Record<string, number>) => boolean }> = [
  {
    chain: ['severe_storm', 'flood', 'infrastructure_damage', 'evacuation'],
    trigger: (s) => (s.severe_storm || 0) >= 2 && (s.flood || 0) >= 3,
  },
  {
    chain: ['wildfire', 'environmental_hazard', 'public_safety', 'evacuation'],
    trigger: (s) => (s.wildfire || 0) >= 2,
  },
  {
    chain: ['flood', 'power_outage', 'water_supply', 'public_safety'],
    trigger: (s) => (s.flood || 0) >= 2 && (s.power_outage || 0) >= 2,
  },
]

const FUSION_PROFILES: Record<string, { sensor: number; reports: number; external: number; model: number }> = {
  flood: { sensor: 0.45, reports: 0.25, external: 0.2, model: 0.1 },
  severe_storm: { sensor: 0.35, reports: 0.3, external: 0.2, model: 0.15 },
  heatwave: { sensor: 0.33, reports: 0.22, external: 0.25, model: 0.2 },
  wildfire: { sensor: 0.3, reports: 0.3, external: 0.25, model: 0.15 },
  landslide: { sensor: 0.36, reports: 0.28, external: 0.2, model: 0.16 },
  drought: { sensor: 0.3, reports: 0.2, external: 0.3, model: 0.2 },
  power_outage: { sensor: 0.25, reports: 0.38, external: 0.2, model: 0.17 },
  water_supply: { sensor: 0.28, reports: 0.3, external: 0.24, model: 0.18 },
  water_supply_disruption: { sensor: 0.28, reports: 0.32, external: 0.22, model: 0.18 },
  infrastructure_damage: { sensor: 0.3, reports: 0.34, external: 0.2, model: 0.16 },
  public_safety: { sensor: 0.18, reports: 0.46, external: 0.2, model: 0.16 },
  public_safety_incident: { sensor: 0.18, reports: 0.46, external: 0.2, model: 0.16 },
  environmental_hazard: { sensor: 0.34, reports: 0.24, external: 0.25, model: 0.17 },
  default: { sensor: 0.3, reports: 0.35, external: 0.2, model: 0.15 },
}

export class IncidentIntelligenceCore {
  constructor(private readonly region: CityRegionConfig) {}

  getRegionalProviderAdapter(): RegionalProviderAdapter {
    return {
      weatherProvider: this.region.weatherProvider,
      riverAuthority: this.region.riverAuthority || this.region.alertingAuthority,
      satelliteSource: this.region.satelliteSource || 'unknown',
      routingProfile: this.region.populationDensity === 'urban' ? 'conservative' : 'balanced',
      legalContacts: [this.region.alertingAuthority, this.region.emergencyNumber],
      language: this.region.language || 'en',
      units: this.region.units || 'metric',
    }
  }

  buildEvidenceEvents(rows: Array<any>): EvidenceEvent[] {
    const now = Date.now()
    return rows
      .filter((r) => Number.isFinite(Number(r.lat)) && Number.isFinite(Number(r.lng)))
      .map((r) => {
        const signalType = String(r.signal_type || r.incident_subtype || r.incident_category || 'unknown')
        const occurredAt = new Date(r.created_at || Date.now())
        const ai = Number(r.ai_confidence ?? 50)
        const baseConfidence = this.scoreConfidence(signalType, ai, r.severity)
        const ageMs = Math.max(0, now - occurredAt.getTime())
        const freshness = Math.max(0.05, Math.min(1, 1 - (ageMs / (24 * 60 * 60 * 1000))))
        return {
          id: String(r.id),
          source: 'citizen_report',
          signalType,
          lat: Number(r.lat),
          lng: Number(r.lng),
          occurredAt,
          confidence: Number((baseConfidence * freshness).toFixed(2)),
          freshness: Number(freshness.toFixed(2)),
          provenance: 'reports_table',
          severity: r.severity ? String(r.severity) : undefined,
        }
      })
  }

  clusterEvidence(events: EvidenceEvent[], options: ClusterOptions): IncidentCluster[] {
    if (events.length === 0) return []

    const parent = events.map((_, i) => i)
    const find = (x: number): number => {
      let n = x
      while (parent[n] !== n) {
        parent[n] = parent[parent[n]]
        n = parent[n]
      }
      return n
    }
    const union = (a: number, b: number): void => {
      const ra = find(a)
      const rb = find(b)
      if (ra !== rb) parent[rb] = ra
    }

    for (let i = 0; i < events.length; i++) {
      for (let j = i + 1; j < events.length; j++) {
        const dist = this.haversineMeters(events[i].lat, events[i].lng, events[j].lat, events[j].lng)
        if (dist <= options.radiusMeters) union(i, j)
      }
    }

    const groups = new Map<number, EvidenceEvent[]>()
    events.forEach((event, idx) => {
      const root = find(idx)
      if (!groups.has(root)) groups.set(root, [])
      groups.get(root)!.push(event)
    })

    return Array.from(groups.values())
      .filter((group) => group.length >= options.minReports)
      .map((group, idx) => {
        const centerLat = group.reduce((acc, e) => acc + e.lat, 0) / group.length
        const centerLng = group.reduce((acc, e) => acc + e.lng, 0) / group.length
        const radius = Math.max(...group.map((e) => this.haversineMeters(centerLat, centerLng, e.lat, e.lng)))

        const typeCount: Record<string, number> = {}
        for (const e of group) typeCount[e.signalType] = (typeCount[e.signalType] || 0) + 1
        const dominantType = Object.entries(typeCount).sort((a, b) => b[1] - a[1])[0]?.[0] || 'mixed'

        const avgConf = group.reduce((acc, e) => acc + e.confidence, 0) / group.length
        const confidence = Math.max(0.05, Math.min(0.99, Number((avgConf * 0.8 + Math.min(group.length / 15, 0.19)).toFixed(2))))

        const ts = group.map((e) => e.occurredAt.getTime())
        return {
          cluster_id: `cluster_${Date.now()}_${idx}`,
          incident_type: dominantType,
          reports: group.length,
          confidence,
          center: { lat: Number(centerLat.toFixed(6)), lng: Number(centerLng.toFixed(6)) },
          radius_m: Math.max(50, Math.round(radius)),
          time_window_minutes: Math.max(1, Math.round((Math.max(...ts) - Math.min(...ts)) / 60000)),
          report_ids: group.map((e) => e.id),
        }
      })
      .sort((a, b) => b.reports - a.reports)
  }

  inferCascades(events: EvidenceEvent[]): { activeSignals: Record<string, { count: number; avg: number }>; inferred: CascadingInsight[] } {
    const activeSignals: Record<string, { count: number; avg: number }> = {}
    for (const e of events) {
      const existing = activeSignals[e.signalType] || { count: 0, avg: 0 }
      const nextCount = existing.count + 1
      const nextAvg = ((existing.avg * existing.count) + e.confidence * 100) / nextCount
      activeSignals[e.signalType] = { count: nextCount, avg: Number(nextAvg.toFixed(2)) }
    }

    const signalCounts: Record<string, number> = Object.fromEntries(
      Object.entries(activeSignals).map(([k, v]) => [k, v.count]),
    )

    const inferred = DEFAULT_CASCADE_RULES
      .filter((rule) => rule.trigger(signalCounts))
      .map((rule) => {
        const chainSignals = rule.chain
          .filter((k) => activeSignals[k])
          .map((k) => activeSignals[k])

        const avgCount = chainSignals.length ? chainSignals.reduce((a, b) => a + b.count, 0) / chainSignals.length : 0
        const avgConf = chainSignals.length ? chainSignals.reduce((a, b) => a + b.avg, 0) / chainSignals.length : 50
        const confidence = Math.max(0.1, Math.min(0.99, Number(((avgConf / 100) * 0.7 + Math.min(avgCount / 20, 0.25)).toFixed(2))))

        return {
          chain: rule.chain,
          confidence,
          recommended_actions: [
            'Activate regional incident command watch',
            'Validate route safety and evacuation corridors',
            'Push targeted public alerts for at-risk zones',
          ],
        }
      })

    return { activeSignals, inferred }
  }

  promoteIncidentObjects(events: EvidenceEvent[], options: ClusterOptions): IncidentObject[] {
    const clusters = this.clusterEvidence(events, options)
    return clusters.map((cluster) => {
      const lifecycle = this.toLifecycleState(cluster.confidence, cluster.reports)
      const explanation = this.buildExplanationForCluster(cluster)
      return {
        incident_id: `incident_${cluster.cluster_id}`,
        incident_type: cluster.incident_type,
        center: cluster.center,
        radius_m: cluster.radius_m,
        time_window_minutes: cluster.time_window_minutes,
        confidence: cluster.confidence,
        lifecycle_state: lifecycle,
        evidence_count: cluster.reports,
        evidence_ids: cluster.report_ids,
        last_updated_at: new Date().toISOString(),
        explanation,
      }
    })
  }

  explainIncidentObject(incident: IncidentObject): IncidentObject['explanation'] {
    return incident.explanation
  }

  buildRouteRiskMask(events: EvidenceEvent[], options?: Partial<RouteRiskMaskOptions>): MultiPolygonMask | null {
    const settings: RouteRiskMaskOptions = {
      maxDistanceMeters: options?.maxDistanceMeters ?? 10000,
      maxEvents: options?.maxEvents ?? 20,
      lookbackHours: options?.lookbackHours ?? 4,
    }

    const cutoff = Date.now() - settings.lookbackHours * 60 * 60 * 1000
    const prioritized = events
      .filter((e) => e.occurredAt.getTime() >= cutoff)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, settings.maxEvents)

    if (prioritized.length === 0) return null

    const polygons = prioritized.map((e) => {
      const radiusMeters = e.severity?.toLowerCase() === 'critical' ? 250 : 140
      return this.createCirclePolygon(e.lng, e.lat, radiusMeters)
    })

    return {
      type: 'MultiPolygon',
      coordinates: polygons,
    }
  }

  getFusionProfile(incidentType: string): { sensor: number; reports: number; external: number; model: number } {
    return FUSION_PROFILES[incidentType] || FUSION_PROFILES.default
  }

  private toLifecycleState(confidence: number, evidenceCount: number): ConfidenceLifecycleState {
    if (confidence >= 0.9 && evidenceCount >= 6) return 'confirmed'
    if (confidence >= 0.78 && evidenceCount >= 4) return 'high'
    if (confidence >= 0.62 && evidenceCount >= 3) return 'probable'
    if (confidence >= 0.42 && evidenceCount >= 2) return 'possible'
    return 'weak'
  }

  private buildExplanationForCluster(cluster: IncidentCluster): IncidentObject['explanation'] {
    const profile = this.getFusionProfile(cluster.incident_type)
    return {
      summary: `${cluster.incident_type.replace(/_/g, ' ')} incident promoted from ${cluster.reports} fused evidence events.`,
      drivers: [
        `Cluster density within ${cluster.radius_m}m radius`,
        `Evidence volume: ${cluster.reports} reports`,
        `Fusion profile weights: sensor ${profile.sensor}, reports ${profile.reports}, external ${profile.external}, model ${profile.model}`,
      ],
      trace: [
        { step: 'evidence_normalization', value: `${cluster.report_ids.length} events normalized` },
        { step: 'spatiotemporal_clustering', value: `window ${cluster.time_window_minutes} min, radius ${cluster.radius_m}m` },
        { step: 'confidence_fusion', value: `cluster confidence ${Math.round(cluster.confidence * 100)}%` },
      ],
    }
  }

  private scoreConfidence(signalType: string, aiConfidence: number, severity?: string): number {
    const profile = this.getFusionProfile(signalType)
    const ai = Math.max(0, Math.min(1, aiConfidence > 1 ? aiConfidence / 100 : aiConfidence))
    const sevBoost = severity?.toLowerCase() === 'critical' ? 0.08 : severity?.toLowerCase() === 'high' ? 0.04 : 0
    return Math.max(0.05, Math.min(0.99, Number((ai * (profile.reports + profile.model) + 0.15 + sevBoost).toFixed(2))))
  }

  private haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const toRad = (v: number): number => (v * Math.PI) / 180
    const earthRadiusM = 6371000
    const dLat = toRad(lat2 - lat1)
    const dLon = toRad(lon2 - lon1)
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2)
      + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2))
      * Math.sin(dLon / 2) * Math.sin(dLon / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return earthRadiusM * c
  }

  private createCirclePolygon(centerLng: number, centerLat: number, radiusMeters: number): number[][][] {
    const points: number[][] = []
    const segments = 20
    const earthRadius = 6378137
    const latRad = (centerLat * Math.PI) / 180

    for (let i = 0; i <= segments; i++) {
      const theta = (i / segments) * Math.PI * 2
      const dx = radiusMeters * Math.cos(theta)
      const dy = radiusMeters * Math.sin(theta)
      const dLat = (dy / earthRadius) * (180 / Math.PI)
      const dLng = (dx / (earthRadius * Math.cos(latRad))) * (180 / Math.PI)
      points.push([centerLng + dLng, centerLat + dLat])
    }

    return [points]
  }
}
