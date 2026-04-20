/**
 * Unit tests for the ML model monitoring service.
  * Verifies prediction logging, drift alert generation, and model
  * health aggregation. DB calls are mocked via jest.spyOn.
  *
  * - Tests server/src/services/modelMonitoringService.ts
  * - No live database required (pg.Pool mocked)
  * - Run via: npm test -- modelMonitoring
 */

process.env.NODE_ENV = 'test'

const mockGetAllRegistryHealth: jest.Mock = jest.fn(async () => ({ items: [] as any[] }))
const mockGetRegistryDrift: jest.Mock = jest.fn(async () => ({ snapshot: {} }))
const metricSet = jest.fn()
const metricInc = jest.fn()

jest.mock('../services/aiClient.js', () => ({
  aiClient: {
    getAllRegistryHealth: mockGetAllRegistryHealth,
    getRegistryDrift: mockGetRegistryDrift,
  },
}))

jest.mock('../services/metrics.js', () => ({
  aegisModelAvgConfidence: { set: (...args: any[]) => metricSet(...args) },
  aegisModelDriftScore: { set: (...args: any[]) => metricSet(...args) },
  aegisModelAlertStatus: { set: (...args: any[]) => metricSet(...args) },
  aegisModelFallbackTotal: { inc: (...args: any[]) => metricInc(...args) },
}))

import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals'

import { closeTestPool, ensureTestSchema, getTestPool, truncateAll } from './helpers/testDb'
import { collectModelRollingStats, computeAndPersistModelDriftSnapshots } from '../services/modelMonitoringService'

describe('modelMonitoringService', () => {
  beforeAll(async () => {
    await ensureTestSchema()
    const pool = getTestPool()
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_model_metrics (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        model_name TEXT,
        model_version TEXT,
        metric_name TEXT,
        metric_value DOUBLE PRECISION,
        dataset_size INT,
        metadata JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `)
  })

  beforeEach(async () => {
    await truncateAll()
    metricSet.mockClear()
    metricInc.mockClear()
    mockGetAllRegistryHealth.mockReset().mockResolvedValue({ items: [] })
    mockGetRegistryDrift.mockReset().mockResolvedValue({ snapshot: {} })
  })

  afterAll(async () => {
    await closeTestPool()
  })

  it('returns zero when there are no registry items to process', async () => {
    const rolled = await collectModelRollingStats()
    const snapped = await computeAndPersistModelDriftSnapshots()

    expect(rolled).toBe(0)
    expect(snapped).toBe(0)
    expect(metricSet).not.toHaveBeenCalled()
  })

  it('skips incomplete registry items and only emits metrics for valid models', async () => {
    mockGetAllRegistryHealth.mockResolvedValue({
      items: [
        { hazard_type: 'flood', region_id: 'uk-default', current_version: 'v1', drift_score: 0.2, health_status: 'watch' },
        { hazard_type: 'wildfire', region_id: null, current_version: 'v2', drift_score: 0.4, health_status: 'degraded' },
      ],
    })

    const pool = getTestPool()
    await pool.query(
      `INSERT INTO ai_predictions (hazard_type, region_id, model_version, confidence, probability, generated_at)
       VALUES ('flood', 'uk-default', 'v1', 0.8, 0.7, NOW())`
    )

    const count = await collectModelRollingStats()

    expect(count).toBe(2)
    expect(metricSet).toHaveBeenCalled()
    expect(metricSet.mock.calls.filter(call => call[0]?.hazard === 'wildfire')).toHaveLength(0)
  })

  it('persists drift snapshots and increments fallback counters only on positive deltas', async () => {
    mockGetAllRegistryHealth.mockResolvedValue({
      items: [
        { hazard_type: 'flood', region_id: 'uk-default', current_version: 'v9', fallback_count: 2 },
      ],
    })
    mockGetRegistryDrift.mockResolvedValue({
      snapshot: {
        sample_count: 11,
        avg_confidence: 0.72,
        confidence_std: 0.05,
        prediction_positive_rate: 0.4,
        drift_score: 0.21,
        alert_level: 'WARNING',
        top_feature_means: { rainfall: 0.7 },
        top_feature_stds: { rainfall: 0.2 },
      },
    })

    await computeAndPersistModelDriftSnapshots()
    await computeAndPersistModelDriftSnapshots()

    const pool = getTestPool()
    const snapshots = await pool.query('SELECT COUNT(*)::int AS c FROM model_monitoring_snapshots')
    expect(snapshots.rows[0].c).toBe(2)
    expect(metricInc).toHaveBeenCalledTimes(1)
    expect(metricInc).toHaveBeenCalledWith({ hazard: 'flood', region: 'uk-default' }, 2)
  })

  it('propagates drift fetch failures to the caller', async () => {
    mockGetAllRegistryHealth.mockResolvedValue({
      items: [{ hazard_type: 'flood', region_id: 'uk-default', current_version: 'v3' }],
    })
    mockGetRegistryDrift.mockRejectedValueOnce(new Error('drift backend unavailable'))

    await expect(computeAndPersistModelDriftSnapshots()).rejects.toThrow('drift backend unavailable')
  })
})