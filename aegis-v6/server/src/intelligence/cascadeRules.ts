/**
 * Cascade Rules
 *
 * Declarative cross-hazard reasoning. When a hazard is predicted above a
 * threshold, configured downstream hazards are automatically evaluated
 * and emitted as `cascade.triggered` events.
 *
 * This is the architectural property that makes AEGIS distinctive:
 * one detected hazard automatically reasons about its consequences
 * without bespoke route logic.
 *
 * Currently wired:
 *   flood (score >= 0.7) -> landslide risk in same region
 *
 * Adding a rule = appending a CascadeRule to RULES. No other code changes.
 */
import { eventBus } from '../events/eventBus.js'
import { AegisEventNames } from '../events/eventTypes.js'
import { logger } from '../services/logger.js'

interface CascadeRule {
  triggerHazard: string
  minScore: number
  cascadedHazard: string
  reason: string
}

const RULES: CascadeRule[] = [
  {
    triggerHazard: 'flood',
    minScore: 0.7,
    cascadedHazard: 'landslide',
    reason: 'Saturated soil downstream of high-probability flood zone elevates landslide risk',
  },
]

export function registerCascadeRules(): () => void {
  const unsub = eventBus.subscribe(
    AegisEventNames.HAZARD_PREDICTED,
    async (evt) => {
      const { hazardType, regionId, score } = evt.payload
      const matching = RULES.filter(
        (r) => r.triggerHazard === hazardType && score >= r.minScore,
      )
      for (const rule of matching) {
        logger.info(
          { trigger: hazardType, cascaded: rule.cascadedHazard, regionId, score },
          '[cascade] firing rule',
        )
        await eventBus.publish(
          AegisEventNames.CASCADE_TRIGGERED,
          {
            triggerEvent: AegisEventNames.HAZARD_PREDICTED,
            triggerEntityId: evt.payload.predictionId,
            cascadedHazard: rule.cascadedHazard,
            affectedRegionId: regionId,
            reason: rule.reason,
          },
          { source: 'ai-engine', severity: evt.severity, regionId: evt.regionId },
        )
      }
    },
  )
  return unsub
}
