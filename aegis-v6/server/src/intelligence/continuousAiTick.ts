/**
 * Continuous AI Tick
 *
 * Runs the existing flood prediction pipeline on a fixed cadence and
 * publishes typed `hazard.predicted` / `risk.updated` events whenever a
 * region's score moves by more than RISK_DELTA_THRESHOLD. This is the
 * behaviour that makes the operator map feel *alive* -- predictions
 * stream out without any user action.
 *
 * Design notes:
 *   - Reuses getFloodPredictions() so we don't re-implement the model
 *   - Threshold-based emission avoids flooding subscribers with no-ops
 *   - Each tick runs in its own correlation context so subscriber logs
 *     thread through cleanly
 *   - Failures are isolated -- one bad tick never kills the loop
 */
import { randomUUID } from 'crypto'
import { logger } from '../services/logger.js'
import { eventBus } from '../events/eventBus.js'
import { AegisEventNames } from '../events/eventTypes.js'
import { runWithCorrelation } from '../events/correlationContext.js'
import { getFloodPredictions } from '../services/floodPredictionService.js'
import type { AegisSeverity } from '../events/eventTypes.js'

const TICK_INTERVAL_MS = Number(process.env.AI_TICK_INTERVAL_MS ?? 60_000)
const RISK_DELTA_THRESHOLD = Number(process.env.AI_RISK_DELTA ?? 0.05)

const lastScoreByKey = new Map<string, number>()
let timer: NodeJS.Timeout | null = null

function severityFromProbability(p: number): AegisSeverity {
  if (p >= 0.85) return 'critical'
  if (p >= 0.6) return 'high'
  if (p >= 0.35) return 'medium'
  return 'low'
}

async function runOnce(): Promise<void> {
  const predictions = await getFloodPredictions()
  for (const pred of predictions) {
    const peak = pred.predictions.reduce(
      (m: number, p: { level: number }) => (p.level > m ? p.level : m),
      pred.currentLevel,
    )
    // Score in 0..1 -- normalised against a 5m flood ceiling. Same heuristic
    // floodPredictionService uses internally for its DB persistence.
    const score = Math.max(0, Math.min(1, peak / 5))
    const key = `${pred.regionId}:${pred.stationId}`
    const previous = lastScoreByKey.get(key) ?? 0
    const delta = score - previous

    if (Math.abs(delta) < RISK_DELTA_THRESHOLD) continue
    lastScoreByKey.set(key, score)

    const severity = severityFromProbability(score)
    const correlationId = randomUUID()

    runWithCorrelation({ correlationId, actor: 'ai-tick' }, () => {
      void eventBus.publish(
        AegisEventNames.HAZARD_PREDICTED,
        {
          predictionId: randomUUID(),
          hazardType: 'flood',
          regionId: key,
          score,
          confidence: pred.predictions[0]?.confidence ?? 0.5,
          modelVersion: 'flood-pipeline-v1',
        },
        { source: 'ai-engine', severity, regionId: pred.regionId },
      )
      void eventBus.publish(
        AegisEventNames.RISK_UPDATED,
        {
          regionId: key,
          previousScore: previous,
          newScore: score,
          delta,
          reason: `Flood prediction tick (${pred.riverName})`,
        },
        { source: 'ai-engine', severity, regionId: pred.regionId },
      )
    })
  }
}

export function startContinuousAiTick(): () => void {
  if (timer) return () => stopContinuousAiTick()
  logger.info(
    { intervalMs: TICK_INTERVAL_MS, deltaThreshold: RISK_DELTA_THRESHOLD },
    '[ai-tick] starting continuous prediction loop',
  )
  timer = setInterval(() => {
    runOnce().catch((err) =>
      logger.error({ err }, '[ai-tick] tick failed; loop continues'),
    )
  }, TICK_INTERVAL_MS)
  // Run an initial tick after startup so the first event isn't delayed by
  // a full interval.
  setTimeout(() => {
    runOnce().catch((err) =>
      logger.error({ err }, '[ai-tick] initial tick failed'),
    )
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
