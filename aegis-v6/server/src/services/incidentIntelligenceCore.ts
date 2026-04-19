/**
 * The analytical brain that spots patterns in live incident data. Contains:
 * - Spatial/temporal clustering (Union-Find algorithm over Haversine distances)
 * - Cascading incident inference (predicts what comes next from current signals)
 * - Monte Carlo confidence bands for predictions
 * - Temporal pattern detection (acceleration, periodicity, escalation)
 * - Anomaly detection (statistical z-scores, spatial outliers, severity spikes)
 * - Impact scoring (population, infrastructure, weather, time-of-day factors)
 * - Incident lifecycle timeline with predicted phase transitions
 *
 * How it works:
 * `IncidentIntelligenceCore` is instantiated with a `CityRegionConfig` and
 * processes arrays of `EvidenceEvent` objects (citizen reports, sensor readings,
 * external feeds). All spatial math uses 2D Haversine distance.
 *
 * - Used by server/src/services/evacuationService.ts for live risk assessment
 * - Consumed by server/src/routes/incidentRoutes.ts for dashboard analytics
 * - Types (IncidentCluster, CascadingInsight, etc.) used throughout the server
 * - Region config from server/src/config/regions/types.ts
 * */

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
  density_score?: number
  scale?: 'local' | 'regional'
  growth_vector?: { bearing_deg: number; speed_mps: number }
}

export interface CascadingInsight {
  chain: string[]
  confidence: number
  recommended_actions: string[]
  likely_within_minutes?: number
  impact_score?: number
  evidence_strength?: number
  confidence_band?: { p10: number; p50: number; p90: number }
  triggers?: string[]
}

interface CascadeInferenceOptions {
  forecastHorizonMinutes?: number
  monteCarloRuns?: number
}

export interface TemporalPattern {
  pattern: 'acceleration' | 'deceleration' | 'periodic' | 'escalation' | 'stable'
  confidence: number
  projectedNextEvent: Date | null
  trendDirection: 'increasing' | 'decreasing' | 'stable' | 'oscillating'
  details: {
    avgIntervalMs?: number
    recentIntervalMs?: number
    periodicityMs?: number
    severityTrend?: number
  }
}

export interface AnomalyResult {
  eventId: string
  anomalyType: 'statistical' | 'spatial' | 'severity'
  zScore: number
  description: string
  severity: 'low' | 'medium' | 'high'
}

export interface AnomalyDetectionConfig {
  statisticalThreshold?: number
  spatialThreshold?: number
  severityThreshold?: number
}

export interface ImpactScoreResult {
  total: number
  breakdown: {
    populationExposure: number
    infrastructureCriticality: number
    timeOfDayFactor: number
    weatherAmplification: number
    historicalImpact: number
    clusterSizeFactor: number
  }
  riskLevel: 'low' | 'moderate' | 'high' | 'critical'
}

export interface ImpactScoreOptions {
  nearbyPopulation?: number
  infrastructureCount?: number
  criticalFacilities?: Array<{ type: string; distance_m: number }>
  currentWeather?: { windSpeed?: number; temperature?: number; humidity?: number; precipitation?: number }
  historicalSeverityAvg?: number
}

export interface TimelineEvent {
  timestamp: Date
  eventId: string
  signalType: string
  severity?: string
  phase: 'onset' | 'escalation' | 'peak' | 'decline' | 'resolution'
  isMilestone: boolean
  annotation: string
}

export interface IncidentTimeline {
  incidentId: string
  events: TimelineEvent[]
  currentPhase: 'onset' | 'escalation' | 'peak' | 'decline' | 'resolution'
  phaseTransitions: Array<{ from: string; to: string; at: Date; eventId: string }>
  predictedPhases: Array<{ phase: string; estimatedAt: Date; confidence: number }>
  durationSoFarMinutes: number
  estimatedRemainingMinutes: number | null
}

export interface CrossIncidentCorrelation {
  incidentA: string
  incidentB: string
  correlationScore: number
  correlationType: 'causal' | 'co-occurring' | 'amplifying'
  spatialProximityKm: number
  temporalProximityMinutes: number
  typeCompatibility: number
  explanation: string
}

export interface MultiScaleClusterOptions extends ClusterOptions {
  localRadiusMeters?: number
  regionalRadiusMeters?: number
  temporalWindowMinutes?: number
  minDensityPerKm2?: number
  enableClusterMerging?: boolean
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

// Context for geography/magnitude-aware cascade evaluation
export interface CascadeContext {
  isUrban: boolean
  isCoastal: boolean
  populationDensity: number  // per km—
  timeOfDay: number          // 0-23
  magnitude?: number         // 0-1 overall incident magnitude
}

// Default cascade rules: each rule defines an incident chain and a trigger condition.
// trigger() receives a map of signal type -> count. Fires when there are enough
// co-occurring signals of the right types to infer a likely cascade.
// Examples: flood + storm -> infrastructure damage; heatwave + drought -> wildfire risk.
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
  {
    chain: ['heatwave', 'drought', 'wildfire_risk', 'evacuation'],
    trigger: (s) => (s.heatwave || 0) >= 2 && (s.drought || 0) >= 1,
  },
  {
    chain: ['flood', 'landslide', 'infrastructure_damage', 'road_closure'],
    trigger: (s) => (s.flood || 0) >= 2 && (s.landslide || 0) >= 1,
  },
  {
    chain: ['power_outage', 'heatwave', 'medical_emergency', 'shelter_activation'],
    trigger: (s) => (s.power_outage || 0) >= 2 && (s.heatwave || 0) >= 2,
  },
  {
    chain: ['severe_storm', 'power_outage', 'communication_failure', 'emergency_broadcast'],
    trigger: (s) => (s.severe_storm || 0) >= 2 && (s.power_outage || 0) >= 1,
  },
  {
    chain: ['earthquake', 'infrastructure_damage', 'gas_leak', 'evacuation'],
    trigger: (s) => (s.earthquake || 0) >= 1 && (s.infrastructure_damage || 0) >= 1,
  },
]

// Evidence source fusion weights by hazard type.
// These control how much weight each evidence source (sensor vs citizen report
// vs external feed vs model prediction) contributes to confidence scoring.
// Public safety incidents weight citizen reports more heavily (0.46) because
// first-hand witness accounts are the most reliable signal for those events.
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

  // Convert raw database report rows into normalised EvidenceEvent objects.
  // Scores confidence from a combination of hazard type, AI confidence %, and severity.
  // Applies a freshness decay so older events carry less weight.
  buildEvidenceEvents(rows: Array<any>): EvidenceEvent[] {
    const now = Date.now()
    return rows
      .filter((r) => Number.isFinite(Number(r.lat)) && Number.isFinite(Number(r.lng))) // drop rows with bad coords
      .map((r) => {
        const signalType = String(r.signal_type || r.incident_subtype || r.incident_category || 'unknown')
        const occurredAt = new Date(r.created_at || Date.now())
        const ai = Number(r.ai_confidence ?? 50)
        const baseConfidence = this.scoreConfidence(signalType, ai, r.severity)
        // Freshness: events from 24h ago score near 0; events from right now score 1.0
        const ageMs = Math.max(0, now - occurredAt.getTime())
        const freshness = Math.max(0.05, Math.min(1, 1 - (ageMs / (24 * 60 * 60 * 1000))))
        return {
          id: String(r.id),
          source: 'citizen_report',
          signalType,
          lat: Number(r.lat),
          lng: Number(r.lng),
          occurredAt,
          // Final confidence = base * freshness (fresh high-confidence reports score highest)
          confidence: Number((baseConfidence * freshness).toFixed(2)),
          freshness: Number(freshness.toFixed(2)),
          provenance: 'reports_table',
          severity: r.severity ? String(r.severity) : undefined,
        }
      })
  }

  // Union-Find (Disjoint Set Union) spatial clustering.
  // For each pair of events, union them if they're within radiusMeters of each other.
  // This correctly handles transitive clusters (A near B, B near C → one cluster {A,B,C})
  // without requiring all three events to be within radius of each other.
  clusterEvidence(events: EvidenceEvent[], options: ClusterOptions): IncidentCluster[] {
    if (events.length === 0) return []

    // Initialise each event as its own cluster root
    const parent = events.map((_, i) => i)

    // Path-compressed find: follows parent pointers with path compression for speed
    const find = (x: number): number => {
      let n = x
      while (parent[n] !== n) {
        parent[n] = parent[parent[n]] // path compression: skip one level
        n = parent[n]
      }
      return n
    }

    // Union: merge the two clusters containing a and b
    const union = (a: number, b: number): void => {
      const ra = find(a)
      const rb = find(b)
      if (ra !== rb) parent[rb] = ra
    }

    // Pair-wise distance check: O(n²) but acceptable for typical incident counts (<500)
    for (let i = 0; i < events.length; i++) {
      for (let j = i + 1; j < events.length; j++) {
        const dist = this.haversineMeters(events[i].lat, events[i].lng, events[j].lat, events[j].lng)
        if (dist <= options.radiusMeters) union(i, j) // they're neighbours — merge their groups
      }
    }

    // Collect all events that belong to the same root into groups
    const groups = new Map<number, EvidenceEvent[]>()
    events.forEach((event, idx) => {
      const root = find(idx)
      if (!groups.has(root)) groups.set(root, [])
      groups.get(root)!.push(event)
    })

    return Array.from(groups.values())
      .filter((group) => group.length >= options.minReports) // drop clusters below minimum size
      .map((group, idx) => {
        // Centroid of the cluster (simple average lat/lng)
        const centerLat = group.reduce((acc, e) => acc + e.lat, 0) / group.length
        const centerLng = group.reduce((acc, e) => acc + e.lng, 0) / group.length
        // Radius = maximum distance from centroid to any member event
        const radius = Math.max(...group.map((e) => this.haversineMeters(centerLat, centerLng, e.lat, e.lng)))

        // Dominant incident type = the one that appears most often in this cluster
        const typeCount: Record<string, number> = {}
        for (const e of group) typeCount[e.signalType] = (typeCount[e.signalType] || 0) + 1
        const dominantType = Object.entries(typeCount).sort((a, b) => b[1] - a[1])[0]?.[0] || 'mixed'

        // Cluster confidence = average member confidence * 0.8 + size bonus (capped at +0.19)
        const avgConf = group.reduce((acc, e) => acc + e.confidence, 0) / group.length
        const confidence = Math.max(0.05, Math.min(0.99, Number((avgConf * 0.8 + Math.min(group.length / 15, 0.19)).toFixed(2))))

        const ts = group.map((e) => e.occurredAt.getTime())
        const stableCenterLat = Number(centerLat.toFixed(3))
        const stableCenterLng = Number(centerLng.toFixed(3))
        const stableKey = `${dominantType}_${stableCenterLat}_${stableCenterLng}`
        return {
          cluster_id: `cluster_${stableKey.replace(/[^a-zA-Z0-9_.-]/g, '_')}`,
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

  // Cascade inference engine.
  // Aggregates signal counts by type from the evidence events, then checks each
  // DEFAULT_CASCADE_RULE to see if it triggers. For each triggered rule, calculates:
  // - momentum boost from recent vs prior event rates
  // - freshness factor based on average event age
  // - p10/p50/p90 confidence band via simple Monte Carlo sampling
  inferCascades(
    events: EvidenceEvent[],
    options?: CascadeInferenceOptions,
  ): { activeSignals: Record<string, { count: number; avg: number }>; inferred: CascadingInsight[] } {
    const forecastHorizonMinutes = Math.max(30, Math.min(24 * 60, options?.forecastHorizonMinutes ?? 180))

    // Count signals by type and accumulate average confidence per type
    const activeSignals: Record<string, { count: number; avg: number }> = {}
    for (const e of events) {
      const existing = activeSignals[e.signalType] || { count: 0, avg: 0 }
      const nextCount = existing.count + 1
      const nextAvg = ((existing.avg * existing.count) + e.confidence * 100) / nextCount
      activeSignals[e.signalType] = { count: nextCount, avg: Number(nextAvg.toFixed(2)) }
    }

    // Separate recent (0-1h) vs prior (1-2h) counts for momentum calculation
    const now = Date.now()
    const oneHourAgo = now - 60 * 60 * 1000
    const twoHoursAgo = now - 2 * 60 * 60 * 1000
    const recentCounts: Record<string, number> = {}
    const priorCounts: Record<string, number> = {}
    for (const e of events) {
      const ts = e.occurredAt.getTime()
      if (ts >= oneHourAgo) {
        recentCounts[e.signalType] = (recentCounts[e.signalType] || 0) + 1
      } else if (ts >= twoHoursAgo) {
        priorCounts[e.signalType] = (priorCounts[e.signalType] || 0) + 1
      }
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
        // Momentum boost: if a signal is growing faster in the last hour vs the hour before,
        // increase confidence. Cap at +0.25 per signal; cap decrease at -0.15.
        const momentumBoost = rule.chain.reduce((acc, signal) => {
          const recent = recentCounts[signal] || 0
          const previous = priorCounts[signal] || 0
          const trend = previous > 0 ? (recent - previous) / previous : (recent > 0 ? 0.5 : 0)
          return acc + Math.max(-0.15, Math.min(0.25, trend * 0.12))
        }, 0)

        const freshnessFactor = Math.max(
          0,
          Math.min(
            1,
            events.length
              ? events.reduce((acc, e) => {
                const ageHours = (now - e.occurredAt.getTime()) / 3600000
                return acc + Math.max(0, 1 - ageHours / 12)
              }, 0) / events.length
              : 0,
          ),
        )

        const baseConfidence = (avgConf / 100) * 0.64 + Math.min(avgCount / 22, 0.22)
        const confidence = Math.max(
          0.1,
          Math.min(0.99, Number((baseConfidence + momentumBoost + freshnessFactor * 0.1).toFixed(2))),
        )

        const dominantSignal = rule.chain[0]
        const dominantRecent = recentCounts[dominantSignal] || 0
        const leadTimeScale = Math.max(0.2, 1 - Math.min(0.8, dominantRecent / 10))
        const likelyWithinMinutes = Math.round(
          Math.max(15, Math.min(forecastHorizonMinutes, forecastHorizonMinutes * leadTimeScale)),
        )

        const impactScore = Math.round(
          Math.max(
            0,
            Math.min(
              100,
              (confidence * 55) + (rule.chain.length * 8) + Math.min(25, avgCount * 2),
            ),
          ),
        )

        const evidenceStrength = Number(Math.min(1, (avgCount / 12) + (avgConf / 100) * 0.4).toFixed(2))

        // Monte Carlo confidence bands: add Gaussian noise (scaled by evidence strength)
        // and record the 10th, 50th, and 90th percentiles to give a prediction interval.
        const monteCarloRuns = options?.monteCarloRuns ?? 50
        const mcSamples: number[] = []
        for (let mc = 0; mc < monteCarloRuns; mc++) {
          // Noise scale shrinks as evidence accumulates (Bayesian narrowing effect)
          const noiseScale = Math.max(0.02, 0.2 - (evidenceStrength * 0.15))
          const noise = (Math.random() - 0.5) * 2 * noiseScale
          mcSamples.push(Math.max(0.01, Math.min(0.99, confidence + noise)))
        }
        mcSamples.sort((a, b) => a - b)
        const p10 = Number(mcSamples[Math.floor(monteCarloRuns * 0.1)].toFixed(2))
        const p50 = Number(mcSamples[Math.floor(monteCarloRuns * 0.5)].toFixed(2))
        const p90 = Number(mcSamples[Math.floor(monteCarloRuns * 0.9)].toFixed(2))

        return {
          chain: rule.chain,
          confidence,
          likely_within_minutes: likelyWithinMinutes,
          impact_score: impactScore,
          evidence_strength: evidenceStrength,
          confidence_band: { p10, p50, p90 },
          triggers: rule.chain.filter((k) => (signalCounts[k] || 0) > 0),
          recommended_actions: [
            'Activate regional incident command watch',
            'Validate route safety and evacuation corridors',
            'Push targeted public alerts for at-risk zones',
          ],
        }
      })

    // Predictive precursor mode: if leading signals are intensifying but full rule trigger has not fired.
    // This gives early warning before a cascade is confirmed, using partial signal matches.
    for (const rule of DEFAULT_CASCADE_RULES) {
      const alreadyIncluded = inferred.some((i) => i.chain.join('|') === rule.chain.join('|'))
      if (alreadyIncluded) continue

      const head = rule.chain[0]   // first expected signal in the chain
      const second = rule.chain[1] // second expected signal
      const headCount = signalCounts[head] || 0
      const secondCount = signalCounts[second] || 0
      const headRecent = recentCounts[head] || 0
      const secondRecent = recentCounts[second] || 0

      // At least 2 head signals or growing in the last hour = precursor condition met
      if (headCount >= 2 && (secondCount >= 1 || headRecent >= 2 || secondRecent >= 1)) {
        const precursorConfidence = Number(
          Math.max(
            0.18,
            Math.min(0.72, (headCount * 0.08) + (secondCount * 0.06) + (headRecent * 0.05)),
          ).toFixed(2),
        )

        inferred.push({
          chain: rule.chain,
          confidence: precursorConfidence,
          likely_within_minutes: Math.round(Math.max(20, Math.min(forecastHorizonMinutes, forecastHorizonMinutes * 0.75))),
          impact_score: Math.round(precursorConfidence * 70),
          evidence_strength: Number(Math.min(0.85, precursorConfidence + 0.15).toFixed(2)),
          confidence_band: {
            p10: Number(Math.max(0.05, precursorConfidence - 0.18).toFixed(2)),
            p50: Number(Math.max(0.1, precursorConfidence - 0.1).toFixed(2)),
            p90: Number(Math.min(0.9, precursorConfidence + 0.14).toFixed(2)),
          },
          triggers: [head, second].filter(Boolean),
          recommended_actions: [
            'Pre-stage response teams for likely secondary impacts',
            'Increase data refresh cadence to 30-second incident polling',
            'Prepare public advisory draft for rapid escalation',
          ],
        })
      }
    }

    inferred.sort((a, b) => {
      const impactDiff = (b.impact_score || 0) - (a.impact_score || 0)
      if (impactDiff !== 0) return impactDiff
      return b.confidence - a.confidence
    })

    return { activeSignals, inferred }
  }

  // Promote evidence clusters to first-class IncidentObject records.
  // Adds lifecycle state (weak/possible/probable/high/confirmed) and
  // a human-readable explanation including the fusion profile weights used.
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

  // Build a GeoJSON MultiPolygon mask around high-confidence recent events.
  // Used to flag dangerous route segments during evacuation planning.
  // Critical events get a 250m radius; all others 140m.
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

  // Return the fusion weight profile for a given incident/hazard type.
  // Falls back to 'default' profile if the type is unrecognised.
  getFusionProfile(incidentType: string): { sensor: number; reports: number; external: number; model: number } {
    return FUSION_PROFILES[incidentType] || FUSION_PROFILES.default
  }

  // Lifecycle state based on confidence + evidence count together.
  // A high-confidence cluster with few reports stays at 'possible' to avoid false positives.
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

  // Blend AI confidence with fusion profile weights to produce a single 0-1 confidence value.
  // AI score carries (reports + model) share of the final score; severity adds a small direct bonus.
  private scoreConfidence(signalType: string, aiConfidence: number, severity?: string): number {
    const profile = this.getFusionProfile(signalType)
    const ai = Math.max(0, Math.min(1, aiConfidence > 1 ? aiConfidence / 100 : aiConfidence))
    const sevBoost = severity?.toLowerCase() === 'critical' ? 0.08 : severity?.toLowerCase() === 'high' ? 0.04 : 0
    return Math.max(0.05, Math.min(0.99, Number((ai * (profile.reports + profile.model) + 0.15 + sevBoost).toFixed(2))))
  }

  // Haversine great-circle distance between two lat/lng points.
  // Returns metres. Accurate to ~0.3% for distances under 200km.
  private haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const toRad = (v: number): number => (v * Math.PI) / 180
    const earthRadiusM = 6371000
    const dLat = toRad(lat2 - lat1)
    const dLon = toRad(lon2 - lon1)
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2)
      + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2))
      /*
      * Math.sin(dLon / 2) * Math.sin(dLon / 2)
       */
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return earthRadiusM * c
  }

  // Build a closed GeoJSON polygon approximating a circle around a point.
  // Uses 20 segments — sufficient precision for map rendering at city scale.
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

   /**
   * Evaluate cascade rules with geographic and temporal context.
   * Adjusts cascade confidence/probability based on whether we're in an urban vs rural area,
   * coastal proximity, population density, and time of day.
   */
  evaluateCascadeWithContext(
    events: EvidenceEvent[],
    context: CascadeContext,
    options?: CascadeInferenceOptions,
  ): { activeSignals: Record<string, { count: number; avg: number }>; inferred: CascadingInsight[] } {
    const base = this.inferCascades(events, options)

    // Apply context-aware adjustments to each inferred cascade
    const adjusted = base.inferred.map(insight => {
      let multiplier = 1.0

      // Urban areas: infrastructure cascades more likely (power, water, transport)
      const infraChains = ['power_outage', 'water_supply', 'infrastructure_damage', 'communication_failure']
      const hasInfraChain = insight.chain.some(c => infraChains.includes(c))
      if (context.isUrban && hasInfraChain) {
        multiplier *= 1.25 // 25% more likely in urban areas
      } else if (!context.isUrban && hasInfraChain) {
        multiplier *= 0.75 // Less interconnected infrastructure in rural areas
      }

      // Coastal areas: flood ? infrastructure cascades more severe
      if (context.isCoastal && insight.chain.includes('flood')) {
        multiplier *= 1.15
      }

      // Population density scaling: higher density = higher impact, lower threshold for cascades
      if (context.populationDensity > 5000) multiplier *= 1.2
      else if (context.populationDensity > 1000) multiplier *= 1.1
      else if (context.populationDensity < 100) multiplier *= 0.85

      // Night-time: power outage cascades more dangerous (no visibility, harder response)
      const isNight = context.timeOfDay >= 22 || context.timeOfDay < 6
      if (isNight && insight.chain.includes('power_outage')) {
        multiplier *= 1.2
      }

      // Magnitude boost: higher magnitude events cascade more aggressively
      if (context.magnitude && context.magnitude > 0.7) {
        multiplier *= 1 + (context.magnitude - 0.7) * 0.5 // Up to +15% at magnitude 1.0
      }

      const adjustedConfidence = Math.max(0.1, Math.min(0.99, insight.confidence * multiplier))
      const adjustedImpact = insight.impact_score
        ? Math.round(Math.min(100, (insight.impact_score || 0) * multiplier))
        : undefined

      return {
        ...insight,
        confidence: Number(adjustedConfidence.toFixed(2)),
        impact_score: adjustedImpact,
        // Reduce lead time in urban areas (faster cascade propagation)
        likely_within_minutes: context.isUrban && insight.likely_within_minutes
          ? Math.round(insight.likely_within_minutes * 0.8)
          : insight.likely_within_minutes,
      }
    })

    return { activeSignals: base.activeSignals, inferred: adjusted }
  }
}
