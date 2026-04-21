/**
 * Continuous AI Tick
 *
 * Runs all 11 hazard prediction pipelines on a fixed cadence and publishes
 * typed `hazard.predicted` / `risk.updated` events whenever a region's score
 * moves by more than RISK_DELTA_THRESHOLD. This makes every operator map
 * feel alive -- predictions stream out without any user action.
 *
 * Flood uses getFloodPredictions() (real river-sensor data).
 * The remaining 10 hazards use aiClient.predict() against HAZARD_TARGETS --
 * a curated set of globally distributed high-risk monitoring locations.
 *
 * Concurrency: hazard targets run in batches of 5 to avoid overwhelming the
 * AI engine. Failures are isolated -- one bad prediction never kills the loop.
 */
import { randomUUID } from 'crypto'
import { logger } from '../services/logger.js'
import { eventBus } from '../events/eventBus.js'
import { AegisEventNames } from '../events/eventTypes.js'
import { runWithCorrelation } from '../events/correlationContext.js'
import { getFloodPredictions } from '../services/floodPredictionService.js'
import { aiClient } from '../services/aiClient.js'
import type { AegisSeverity } from '../events/eventTypes.js'

const TICK_INTERVAL_MS = Number(process.env.AI_TICK_INTERVAL_MS ?? 60_000)
const RISK_DELTA_THRESHOLD = Number(process.env.AI_RISK_DELTA ?? 0.05)
const BATCH_SIZE = 5

interface HazardTarget {
  hazardType: string
  regionId: string
  latitude: number
  longitude: number
}

// Representative global monitoring locations per hazard.
// Chosen to cover distinct climate zones and historical incident records.
const HAZARD_TARGETS: HazardTarget[] = [
  // Drought -- arid/semi-arid belt + agricultural zones
  { hazardType: 'drought', regionId: 'sahel-niger',        latitude: 14.5,  longitude: 17.5   },
  { hazardType: 'drought', regionId: 'california-central', latitude: 36.7,  longitude: -119.4 },
  { hazardType: 'drought', regionId: 'australia-east',     latitude: -33.8, longitude: 151.2  },

  // Heatwave -- urban heat islands + high-population zones
  { hazardType: 'heatwave', regionId: 'phoenix-az',          latitude: 33.4, longitude: -112.0 },
  { hazardType: 'heatwave', regionId: 'delhi-india',         latitude: 28.6, longitude: 77.2   },
  { hazardType: 'heatwave', regionId: 'mediterranean-south', latitude: 37.0, longitude: 14.0   },

  // Wildfire -- fire-prone biomes
  { hazardType: 'wildfire', regionId: 'california-north', latitude: 39.5, longitude: -122.0 },
  { hazardType: 'wildfire', regionId: 'iberia-portugal',  latitude: 39.7, longitude: -8.0   },
  { hazardType: 'wildfire', regionId: 'greece-attica',    latitude: 38.0, longitude: 23.7   },

  // Landslide -- steep terrain + high-rainfall zones
  { hazardType: 'landslide', regionId: 'nepal-kathmandu',   latitude: 27.7, longitude: 85.3  },
  { hazardType: 'landslide', regionId: 'philippines-luzon', latitude: 14.5, longitude: 121.0 },
  { hazardType: 'landslide', regionId: 'colombia-andes',    latitude: 6.2,  longitude: -75.6 },

  // Severe storm -- cyclone basins + storm corridors
  { hazardType: 'severe_storm', regionId: 'gulf-mexico',      latitude: 29.0, longitude: -90.0  },
  { hazardType: 'severe_storm', regionId: 'bay-bengal',       latitude: 13.0, longitude: 80.3   },
  { hazardType: 'severe_storm', regionId: 'nw-pacific-japan', latitude: 34.7, longitude: 135.5  },

  // Power outage -- grid-stressed regions
  { hazardType: 'power_outage', regionId: 'texas-grid',         latitude: 31.9, longitude: -99.0 },
  { hazardType: 'power_outage', regionId: 'uk-national-grid',   latitude: 51.5, longitude: -0.1  },
  { hazardType: 'power_outage', regionId: 'india-central-grid', latitude: 22.6, longitude: 78.0  },

  // Water supply disruption -- water-stressed cities
  { hazardType: 'water_supply_disruption', regionId: 'cape-town',     latitude: -33.9, longitude: 18.4  },
  { hazardType: 'water_supply_disruption', regionId: 'chennai-india', latitude: 13.0,  longitude: 80.3  },
  { hazardType: 'water_supply_disruption', regionId: 'sao-paulo',     latitude: -23.5, longitude: -46.6 },

  // Infrastructure damage -- seismic + flood-prone zones
  { hazardType: 'infrastructure_damage', regionId: 'turkey-anatolia',  latitude: 39.9, longitude: 32.9  },
  { hazardType: 'infrastructure_damage', regionId: 'japan-kanto',      latitude: 35.7, longitude: 139.7 },
  { hazardType: 'infrastructure_damage', regionId: 'bangladesh-delta', latitude: 23.7, longitude: 90.4  },

  // Public safety incident -- high-density urban + adverse-weather zones
  { hazardType: 'public_safety_incident', regionId: 'london-uk',    latitude: 51.5, longitude: -0.1  },
  { hazardType: 'public_safety_incident', regionId: 'new-york-us',  latitude: 40.7, longitude: -74.0 },
  { hazardType: 'public_safety_incident', regionId: 'lagos-nigeria', latitude: 6.5,  longitude: 3.4   },

  // Environmental hazard -- pollution hotspots
  { hazardType: 'environmental_hazard', regionId: 'delhi-air',     latitude: 28.6, longitude: 77.2  },
  { hazardType: 'environmental_hazard', regionId: 'amazon-basin',  latitude: -3.4, longitude: -60.0 },
  { hazardType: 'environmental_hazard', regionId: 'yangtze-delta', latitude: 31.2, longitude: 121.5 },
]

const lastScoreByKey = new Map<string, number>()
let timer: NodeJS.Timeout | null = null

function severityFromProbability(p: number): AegisSeverity {
  if (p >= 0.85) return 'critical'
  if (p >= 0.6)  return 'high'
  if (p >= 0.35) return 'medium'
  return 'low'
}

function emitScoredPrediction(
  hazardType: string,
  regionId: string,
  score: number,
  confidence: number,
  modelVersion: string,
  previous: number,
): void {
  const delta = score - previous
  const severity = severityFromProbability(score)
  runWithCorrelation({ correlationId: randomUUID(), actor: 'ai-tick' }, () => {
    void eventBus.publish(
      AegisEventNames.HAZARD_PREDICTED,
      { predictionId: randomUUID(), hazardType, regionId, score, confidence, modelVersion },
      { source: 'ai-engine', severity, regionId },
    )
    void eventBus.publish(
      AegisEventNames.RISK_UPDATED,
      { regionId, previousScore: previous, newScore: score, delta, reason: `${hazardType} prediction tick` },
      { source: 'ai-engine', severity, regionId },
    )
  })
}

async function runFloodTick(): Promise<void> {
  const predictions = await getFloodPredictions()
  for (const pred of predictions) {
    const peak = pred.predictions.reduce(
      (m: number, p: { level: number }) => (p.level > m ? p.level : m),
      pred.currentLevel,
    )
    const score = Math.max(0, Math.min(1, peak / 5))
    const key = `${pred.regionId}:${pred.stationId}`
    const previous = lastScoreByKey.get(key) ?? 0
    if (Math.abs(score - previous) < RISK_DELTA_THRESHOLD) continue
    lastScoreByKey.set(key, score)
    emitScoredPrediction('flood', key, score, pred.predictions[0]?.confidence ?? 0.5, 'flood-pipeline-v1', previous)
  }
}

async function runHazardTargetTick(): Promise<void> {
  for (let i = 0; i < HAZARD_TARGETS.length; i += BATCH_SIZE) {
    await Promise.allSettled(
      HAZARD_TARGETS.slice(i, i + BATCH_SIZE).map(async (target) => {
        try {
          const result = await aiClient.predict({
            hazard_type: target.hazardType as never,
            region_id: target.regionId,
            latitude: target.latitude,
            longitude: target.longitude,
            include_contributing_factors: false,
          })
          const score = result.probability ?? 0
          const previous = lastScoreByKey.get(target.regionId) ?? 0
          if (Math.abs(score - previous) < RISK_DELTA_THRESHOLD) return
          lastScoreByKey.set(target.regionId, score)
          emitScoredPrediction(
            target.hazardType, target.regionId, score,
            result.confidence ?? 0.5,
            result.model_version ?? `${target.hazardType}-v1`,
            previous,
          )
        } catch (err) {
          logger.warn({ err, target }, '[ai-tick] target prediction failed; skipping')
        }
      }),
    )
  }
}

async function runOnce(): Promise<void> {
  await Promise.allSettled([runFloodTick(), runHazardTargetTick()])
}

export function startContinuousAiTick(): () => void {
  if (timer) return stopContinuousAiTick
  logger.info(
    { intervalMs: TICK_INTERVAL_MS, deltaThreshold: RISK_DELTA_THRESHOLD, targets: HAZARD_TARGETS.length + 1 },
    '[ai-tick] starting -- flood (river sensors) + 10 hazards (30 targets)',
  )
  timer = setInterval(() => {
    runOnce().catch((err) => logger.error({ err }, '[ai-tick] tick failed; loop continues'))
  }, TICK_INTERVAL_MS)
  setTimeout(() => {
    runOnce().catch((err) => logger.error({ err }, '[ai-tick] initial tick failed'))
  }, 5_000)
  return stopContinuousAiTick
}

export function stopContinuousAiTick(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
    logger.info('[ai-tick] stopped')
  }
}
