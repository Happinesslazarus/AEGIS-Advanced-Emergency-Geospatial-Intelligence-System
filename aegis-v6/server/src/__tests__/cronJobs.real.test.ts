/**
 * What it tests:
 * Tests for the exported scheduler surface of cronJobs.ts.
  * Verifies that all scheduled jobs can be started and stopped cleanly
  * without leaking timers — guards against test-runner hangs.
  *
  * How it connects:
  * - Tests server/src/services/cronJobs.ts exported interface
  * - Mocks all external service calls (weather, threat level APIs)
  * - Run via: npm test -- cronJobs.real
 */

process.env.NODE_ENV = 'test'

const scheduledTasks: Array<{ expression: string; callback: () => void; stop: jest.Mock }> = []
const scheduleMock: jest.Mock = jest.fn((expression: string, callback: () => void) => {
  const task = { expression, callback, stop: jest.fn() }
  scheduledTasks.push(task)
  return task
})

const mockQuery: jest.Mock = jest.fn(async () => ({ rows: [], rowCount: 0 }))
const mockFetchAndBroadcastLevels: jest.Mock = jest.fn(async () => 3)
const mockCalculateThreatLevel: jest.Mock = jest.fn(async () => ({ level: 'warning' }))
const mockCollectModelRollingStats: jest.Mock = jest.fn(async () => 4)
const mockComputeAndPersistModelDriftSnapshots: jest.Mock = jest.fn(async () => 2)
const mockCheckDrift: jest.Mock = jest.fn(async () => ({ models: [] }))
const mockGetFloodWarnings: jest.Mock = jest.fn(async () => ([
  {
    id: 'warn-1',
    title: 'Flood Warning',
    description: 'River rising quickly',
    severity: 'warning',
    area: 'Aberdeen',
    source: 'uk-default',
  },
]))

jest.mock('node-cron', () => ({
  __esModule: true,
  default: { schedule: scheduleMock },
}))

jest.mock('../models/db.js', () => ({
  __esModule: true,
  default: { query: mockQuery },
}))

jest.mock('../config/regions.js', () => ({
  getActiveRegion: jest.fn(() => ({ id: 'uk-default' })),
}))

jest.mock('../adapters/regions/RegionRegistry.js', () => ({
  regionRegistry: {
    getActiveRegion: jest.fn(() => ({
      regionId: 'uk-default',
      getMetadata: () => ({ regionId: 'uk-default' }),
      getIngestionEndpoints: () => ({ flood_warnings: 'https://example.test/floods' }),
      getFloodWarnings: mockGetFloodWarnings,
    })),
  },
}))

jest.mock('../services/riverLevelService.js', () => ({
  fetchAndBroadcastLevels: mockFetchAndBroadcastLevels,
}))

jest.mock('../services/threatLevelService.js', () => ({
  calculateThreatLevel: mockCalculateThreatLevel,
}))

jest.mock('../services/aiClient.js', () => ({
  aiClient: {
    checkDrift: mockCheckDrift,
  },
}))

jest.mock('../services/socket.js', () => ({
  broadcastIncidentAlert: jest.fn(),
  broadcastPredictionUpdate: jest.fn(),
}))

jest.mock('../services/modelMonitoringService.js', () => ({
  collectModelRollingStats: mockCollectModelRollingStats,
  computeAndPersistModelDriftSnapshots: mockComputeAndPersistModelDriftSnapshots,
}))

import { afterEach, beforeEach, describe, expect, it, jest as jestGlobals } from '@jest/globals'

import { activateFallbackJobs, deactivateFallbackJobs, isFallbackActive, startCronJobs } from '../services/cronJobs'

function flushPromises() {
  return new Promise(resolve => setImmediate(resolve))
}

let setTimeoutSpy: ReturnType<typeof jestGlobals.spyOn>

describe('cronJobs exported scheduler surface', () => {
  beforeEach(() => {
    scheduledTasks.length = 0
    scheduleMock.mockClear()
    setTimeoutSpy = jestGlobals.spyOn(global, 'setTimeout').mockImplementation((() => 0) as any)
    mockQuery.mockClear()
    mockFetchAndBroadcastLevels.mockReset().mockResolvedValue(3)
    mockCalculateThreatLevel.mockReset().mockResolvedValue({ level: 'warning' })
    mockCollectModelRollingStats.mockReset().mockResolvedValue(4)
    mockComputeAndPersistModelDriftSnapshots.mockReset().mockResolvedValue(2)
    mockCheckDrift.mockReset().mockResolvedValue({ models: [] })
    mockGetFloodWarnings.mockReset().mockResolvedValue([
      {
        id: 'warn-1',
        title: 'Flood Warning',
        description: 'River rising quickly',
        severity: 'warning',
        area: 'Aberdeen',
        source: 'uk-default',
      },
    ])
    mockQuery.mockImplementation(async (...args: any[]) => {
      const sql = String(args[0] || '')
      if (sql.includes('INSERT INTO external_alerts')) return { rows: [], rowCount: 1 }
      if (sql.includes('INSERT INTO scheduled_jobs')) return { rows: [], rowCount: 1 }
      if (sql.includes('FROM reports')) {
        return {
          rows: [{
            avg_confidence: '0.5',
            min_confidence: '0.5',
            max_confidence: '0.5',
            stddev_confidence: '0.1',
            prediction_count: '0',
            low_confidence_count: '0',
          }],
          rowCount: 1,
        }
      }
      return { rows: [], rowCount: 0 }
    })
    deactivateFallbackJobs()
  })

  afterEach(() => {
    deactivateFallbackJobs()
    setTimeoutSpy.mockRestore()
  })

  it('schedules startup jobs and logs successful immediate ingestion runs', async () => {
    startCronJobs()
    await flushPromises()

    expect(scheduleMock).toHaveBeenCalled()
    expect(mockGetFloodWarnings).toHaveBeenCalled()
    expect(mockQuery.mock.calls.some((call: any) => String(call[0]).includes('INSERT INTO scheduled_jobs'))).toBe(true)
  })

  it('records failed and no-op jobs through scheduled callbacks', async () => {
    startCronJobs()
    await flushPromises()

    const riverLevelTask = scheduledTasks.find(task => task.expression === '*/5 * * * *')
    expect(riverLevelTask).toBeDefined()

    mockFetchAndBroadcastLevels.mockRejectedValueOnce(new Error('river service unavailable'))
    riverLevelTask!.callback()
    await flushPromises()

    const noOpTask = scheduledTasks.find(task => task.expression === '*/30 * * * *')
    expect(noOpTask).toBeDefined()

    noOpTask!.callback()
    await flushPromises()

    const scheduledJobInserts = mockQuery.mock.calls.filter((call: any) => String(call[0]).includes('INSERT INTO scheduled_jobs'))
    expect(scheduledJobInserts.some((call: any) => String(call[0]).includes("'failed'"))).toBe(true)
    expect(scheduledJobInserts.some((call: any) => String(call[0]).includes("'success'"))).toBe(true)
    expect(scheduledJobInserts.length).toBeGreaterThanOrEqual(3)
  })

  it('activates and deactivates fallback jobs without duplicating state', () => {
    expect(isFallbackActive()).toBe(false)

    activateFallbackJobs()
    expect(isFallbackActive()).toBe(true)

    const fallbackTaskCount = scheduledTasks.length
    activateFallbackJobs()
    expect(scheduledTasks.length).toBe(fallbackTaskCount)

    const tasksWithStops = [...scheduledTasks]
    deactivateFallbackJobs()

    expect(isFallbackActive()).toBe(false)
    expect(tasksWithStops.every(task => task.stop.mock.calls.length >= 1)).toBe(true)
  })
})