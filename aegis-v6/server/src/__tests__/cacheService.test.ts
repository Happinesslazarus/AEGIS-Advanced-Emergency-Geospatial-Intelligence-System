/**
 * File: cacheService.test.ts
 *
 * What it tests:
 * Unit tests for the cacheService (in-memory LRU + Redis adapter).
  * Verifies get/set/delete, TTL expiry, Redis fallback logic,
  * and cache invalidation by prefix.
  *
  * How it connects:
  * - Tests server/src/services/cacheService.ts
  * - Redis connection mocked (no live Redis required)
  * - Run via: npm test -- cacheService
 */

// Mock Redis before any imports

const mockGet = jest.fn<Promise<string | null>, [string]>()
const mockSet = jest.fn<Promise<string>, [string, string, string, number]>()
const mockDel = jest.fn<Promise<number>, string[]>()
const mockScan = jest.fn<Promise<[string, string[]]>, [string, string, string, string, number]>()
const mockInfo = jest.fn<Promise<string>, [string]>()
const mockConnect = jest.fn<Promise<void>, []>()

const mockRedis: Record<string, any> = {
  get: mockGet,
  set: mockSet,
  del: mockDel,
  scan: mockScan,
  info: mockInfo,
  connect: mockConnect.mockResolvedValue(undefined),
  on: jest.fn((_event: string, cb: () => void): Record<string, any> => {
    if (_event === 'ready') setTimeout(cb, 0) // auto-fire ready
    return mockRedis
  }),
}

jest.mock('ioredis', () => {
  return {
    __esModule: true,
    default: jest.fn(() => mockRedis),
  }
})

jest.mock('../utils/logger.js', () => ({
  auditLog: jest.fn(),
  devLog: jest.fn(),
}))

jest.mock('./cacheMetrics.js', () => ({
  cacheHitsTotal: { inc: jest.fn() },
  cacheMissesTotal: { inc: jest.fn() },
  cacheSetsTotal: { inc: jest.fn() },
  cacheInvalidationsTotal: { inc: jest.fn() },
  cacheErrorsTotal: { inc: jest.fn() },
  cacheStaleServedTotal: { inc: jest.fn() },
  cacheOperationDuration: { startTimer: jest.fn(() => jest.fn()) },
  cacheNamespaceHitsTotal: { inc: jest.fn() },
  cacheNamespaceMissesTotal: { inc: jest.fn() },
}))

// Set environment BEFORE importing the module under test

const originalEnv = { ...process.env }

beforeAll(() => {
  process.env.REDIS_URL = 'redis://localhost:6379'
  process.env.REDIS_ENABLED = 'true'
  process.env.REDIS_DEFAULT_TTL_SECONDS = '300'
  process.env.REDIS_STALE_GRACE_SECONDS = '600'
})

afterAll(() => {
  process.env = originalEnv
})

// Now import the module (after mocks are in place)

import {
  buildCacheKey,
  cacheGet,
  cacheSet,
  cacheDel,
  cacheInvalidatePattern,
  remember,
  getCacheStats,
  isRedisConnected,
  CACHE_TTL,
} from '../services/cacheService.js'

// Tests

describe('cacheService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGet.mockResolvedValue(null)
    mockSet.mockResolvedValue('OK')
    mockDel.mockResolvedValue(1)
    mockScan.mockResolvedValue(['0', []])
  })

  // buildCacheKey

  describe('buildCacheKey', () => {
    it('builds a simple key without params', () => {
      const key = buildCacheKey('weather', ['scotland', 'forecast'])
      expect(key).toBe('aegis:v1:weather:scotland:forecast')
    })

    it('builds a key with params hash', () => {
      const key = buildCacheKey('weather', ['uk', 'current'], { lat: 55.9, lng: -3.2 })
      expect(key).toMatch(/^aegis:v1:weather:uk:current:[a-f0-9]{12}$/)
    })

    it('produces deterministic hashes regardless of param order', () => {
      const key1 = buildCacheKey('spatial', ['flood-risk'], { lat: 55.9, lng: -3.2, zoom: 12 })
      const key2 = buildCacheKey('spatial', ['flood-risk'], { zoom: 12, lng: -3.2, lat: 55.9 })
      expect(key1).toBe(key2)
    })

    it('produces different hashes for different param values', () => {
      const key1 = buildCacheKey('weather', ['forecast'], { lat: 55.9, lng: -3.2 })
      const key2 = buildCacheKey('weather', ['forecast'], { lat: 51.5, lng: -0.12 })
      expect(key1).not.toBe(key2)
    })

    it('handles empty params like no params', () => {
      const withEmpty = buildCacheKey('news', ['rss'], {})
      const withNone = buildCacheKey('news', ['rss'])
      expect(withEmpty).toBe(withNone)
    })
  })

  // CACHE_TTL

  describe('CACHE_TTL', () => {
    it('has expected TTL values', () => {
      expect(CACHE_TTL.WEATHER).toBe(900)         // 15 min
      expect(CACHE_TTL.RIVER_LEVELS).toBe(300)    // 5 min
      expect(CACHE_TTL.FLOOD_WARNINGS).toBe(300)  // 5 min
      expect(CACHE_TTL.FLOOD_PREDICTIONS).toBe(600)
      expect(CACHE_TTL.FLOOD_ZONES).toBe(86400)   // 24 hours
      expect(CACHE_TTL.SPATIAL).toBe(3600)         // 1 hour
      expect(CACHE_TTL.NEWS).toBe(1800)            // 30 min
      expect(CACHE_TTL.ALERT_LIST).toBe(60)        // 1 min
      expect(CACHE_TTL.NEGATIVE).toBe(120)         // 2 min
    })
  })

  // cacheGet / cacheSet

  describe('cacheGet and cacheSet', () => {
    it('returns null on cache miss', async () => {
      mockGet.mockResolvedValue(null)
      const result = await cacheGet('aegis:v1:test:missing')
      expect(result).toBeNull()
    })

    it('returns cached data on hit', async () => {
      const envelope = {
        data: { temperature: 15 },
        setAt: Date.now(),
        expiresAt: Date.now() + 60_000,
        namespace: 'weather',
      }
      mockGet.mockResolvedValue(JSON.stringify(envelope))
      const result = await cacheGet<{ temperature: number }>('aegis:v1:weather:test')
      expect(result).toEqual({ temperature: 15 })
    })

    it('returns null for expired entries', async () => {
      const envelope = {
        data: { temperature: 15 },
        setAt: Date.now() - 120_000,
        expiresAt: Date.now() - 60_000, // expired 60s ago
        namespace: 'weather',
      }
      mockGet.mockResolvedValue(JSON.stringify(envelope))
      const result = await cacheGet('aegis:v1:weather:expired')
      expect(result).toBeNull()
    })

    it('stores data with extended TTL for stale grace', async () => {
      await cacheSet('aegis:v1:test:set', { foo: 'bar' }, 300)
      expect(mockSet).toHaveBeenCalledWith(
        'aegis:v1:test:set',
        expect.any(String),
        'EX',
        300 + 600, // TTL + STALE_GRACE
      )
      // Verify envelope structure
      const storedJson = mockSet.mock.calls[0][1]
      const stored = JSON.parse(storedJson)
      expect(stored.data).toEqual({ foo: 'bar' })
      expect(stored.namespace).toBe('test')
      expect(stored.setAt).toBeDefined()
      expect(stored.expiresAt).toBeDefined()
    })
  })

  // cacheDel

  describe('cacheDel', () => {
    it('deletes a key from Redis', async () => {
      await cacheDel('aegis:v1:test:delete')
      expect(mockDel).toHaveBeenCalledWith('aegis:v1:test:delete')
    })
  })

  // cacheInvalidatePattern

  describe('cacheInvalidatePattern', () => {
    it('scans and deletes matching keys', async () => {
      mockScan
        .mockResolvedValueOnce(['42', ['aegis:v1:weather:a', 'aegis:v1:weather:b']])
        .mockResolvedValueOnce(['0', ['aegis:v1:weather:c']])

      const removed = await cacheInvalidatePattern('aegis:v1:weather:*')
      expect(mockScan).toHaveBeenCalledTimes(2)
      expect(mockDel).toHaveBeenCalledWith(
        'aegis:v1:weather:a',
        'aegis:v1:weather:b',
        'aegis:v1:weather:c',
      )
      expect(removed).toBeGreaterThanOrEqual(3)
    })

    it('dry-run does not delete keys', async () => {
      mockScan.mockResolvedValueOnce(['0', ['aegis:v1:weather:a']])

      const removed = await cacheInvalidatePattern('aegis:v1:weather:*', true)
      expect(mockDel).not.toHaveBeenCalled()
      expect(removed).toBeGreaterThanOrEqual(1)
    })
  })

  // remember()

  describe('remember()', () => {
    const key = 'aegis:v1:weather:test:remember'

    it('calls producer on cache miss and caches the result', async () => {
      mockGet.mockResolvedValue(null)
      const producer = jest.fn().mockResolvedValue({ temp: 20 })

      const { data, meta } = await remember(key, 300, producer)

      expect(producer).toHaveBeenCalledTimes(1)
      expect(data).toEqual({ temp: 20 })
      expect(meta.source).toBe('origin')
      expect(meta.stale).toBe(false)
      expect(mockSet).toHaveBeenCalledTimes(1)
    })

    it('returns cached data without calling producer', async () => {
      const envelope = {
        data: { temp: 15 },
        setAt: Date.now(),
        expiresAt: Date.now() + 60_000,
        namespace: 'weather',
      }
      mockGet.mockResolvedValue(JSON.stringify(envelope))
      const producer = jest.fn().mockResolvedValue({ temp: 99 })

      const { data, meta } = await remember(key, 300, producer)

      expect(producer).not.toHaveBeenCalled()
      expect(data).toEqual({ temp: 15 })
      expect(meta.source).toBe('cache')
      expect(meta.stale).toBe(false)
    })

    it('serves stale data when producer fails and staleOnError is true', async () => {
      const now = Date.now()
      const staleEnvelope = {
        data: { temp: 10 },
        setAt: now - 600_000,
        expiresAt: now - 300_000,  // expired 5 min ago
        namespace: 'weather',
      }
      // First call (cacheGet): miss because expired
      // Second call (cacheGetStale): returns stale data
      mockGet
        .mockResolvedValueOnce(JSON.stringify(staleEnvelope))  // cacheGet sees expired
        .mockResolvedValueOnce(JSON.stringify(staleEnvelope))  // cacheGetStale sees stale-but-within-grace

      const producer = jest.fn().mockRejectedValue(new Error('Upstream down'))

      const { data, meta } = await remember(key, 300, producer, {
        staleOnError: true,
        provider: 'open-meteo',
      })

      expect(data).toEqual({ temp: 10 })
      expect(meta.stale).toBe(true)
      expect(meta.staleSince).toBeDefined()
    })

    it('throws when producer fails and no stale data available', async () => {
      mockGet.mockResolvedValue(null)
      const producer = jest.fn().mockRejectedValue(new Error('API failure'))

      await expect(
        remember(key, 300, producer, { staleOnError: true }),
      ).rejects.toThrow('API failure')
    })

    it('throws when producer fails and staleOnError is false', async () => {
      mockGet.mockResolvedValue(null)
      const producer = jest.fn().mockRejectedValue(new Error('API failure'))

      await expect(
        remember(key, 300, producer),
      ).rejects.toThrow('API failure')
    })
  })

  // Diagnostics

  describe('getCacheStats', () => {
    it('returns stats object', async () => {
      mockInfo.mockResolvedValue(
        'used_memory_human:1.2M\r\ndb0:keys=42,expires=10\r\n',
      )
      const stats = await getCacheStats()
      expect(stats).toHaveProperty('redisConnected')
      expect(stats).toHaveProperty('memoryEntries')
      expect(stats).toHaveProperty('redisEnabled')
    })
  })

  // Admin endpoints (via adminCacheRoutes.ts)

  describe('isRedisConnected', () => {
    it('returns a boolean', () => {
      expect(typeof isRedisConnected()).toBe('boolean')
    })
  })
})

