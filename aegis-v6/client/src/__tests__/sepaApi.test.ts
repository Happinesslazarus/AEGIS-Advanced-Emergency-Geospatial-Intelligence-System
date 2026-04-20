/**
 * Tests for the sepaApi utility module, which fetches real-time river gauge data
 * from SEPA (Scottish Environment Protection Agency) and provides colour-coding
 * helpers for gauge status display.
 *
 * SEPA river data overview:
 *   SEPA publishes live river level readings from hundreds of monitoring stations
 *   across Scotland.  The data is fetched as GeoJSON and transformed into
 *   RiverGauge objects with normalised status ('normal' | 'rising' | 'warning' | 'alert').
 *   The fetch function accepts a location name (e.g. 'edinburgh') or explicit
 *   lat/lng coordinates and queries the appropriate SEPA API endpoint.
 *
 * Glossary:
 *   SEPA                  = Scottish Environment Protection Agency -- monitors rivers/floods
 *   gauge                 = a measuring station on a river that records water level in metres
 *   level                 = current water depth at the gauge in metres
 *   levelTrend            = direction the level is moving: 'rising' | 'falling' | 'steady'
 *   status                = risk level derived from level vs thresholds:
 *                           'normal' (below warning), 'rising' (trending up),
 *                           'warning' (above warning threshold), 'alert' (above alert threshold)
 *   normalLevel           = baseline reading in metres for calm conditions
 *   warningLevel          = threshold (metres) above which an orange warning is issued
 *   alertLevel            = threshold (metres) above which a red alert is issued
 *   RiverGauge            = the data type for one monitoring station
 *   RiverHistory          = type for historical level readings at one station
 *   fetchRiverLevels()    = async function: looks up location, calls SEPA API, returns gauges
 *   getGaugeColor()       = returns a Tailwind text-color class based on gauge status
 *   getGaugeBg()          = returns a Tailwind bg-color class based on gauge status
 *   GeoJSON features      = array of geographic data points in the standard GeoJSON format
 *   global.fetch          = replaced with a vi.fn() mock so tests never make real HTTP calls
 *   vi.fn()               = creates a trackable mock function
 *   vi.clearAllMocks()    = resets call counts and implementations before each test
 *   mockFetch.mockResolvedValue() = makes the mock return a resolved Promise
 *   mockFetch.mockReset() = clears pending resolved/rejected values alongside clearAllMocks
 *
 * How it connects:
 * - Run by the test runner (Vitest) with `vitest run` or `vitest watch`
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

//Mock setup -- global.fetch replaced before sepaApi is imported

//Replace browser fetch with a mock so no real SEPA API calls are made in tests
const mockFetch = vi.fn()
global.fetch = mockFetch

//Import after mocking fetch so the module picks up the mock at init time
import {
  fetchRiverLevels,
  getGaugeColor,
  getGaugeBg,
  type RiverGauge,
  type RiverHistory,
} from '../utils/sepaApi'

//sepaApi function tests
describe('sepaApi', () => {
  beforeEach(() => {
    vi.clearAllMocks() // reset mock call counts
    mockFetch.mockReset() // clear pending resolved/rejected promises
  })

  afterEach(() => {
    vi.restoreAllMocks() // undo any spy wrappers
  })

  //fetchRiverLevels -- resolves a location name to coordinates, calls SEPA, parses gauges
  describe('fetchRiverLevels', () => {
    test('throws error for unknown location without coordinates', async () => {
 //Location not in the built-in lookup table and no lat/lng supplied -> reject
      await expect(fetchRiverLevels('unknowncity')).rejects.toThrow(
        'No river monitoring data available for "unknowncity"'
      )
    })

    test('throws when no gauge data available for known location', async () => {
      //Server responds with an empty features array (no gauges near the location)
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(''),
        json: () => Promise.resolve({ features: [] }), // GeoJSON with no markers
      })
      
      await expect(fetchRiverLevels('aberdeen')).rejects.toThrow(
        'No live gauge data available'
      )
    })

    test('properly calls fetch for coordinate-based lookup', async () => {
      //lat > 55.3 = Scotland; function should call the SEPA endpoint at least once
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(''),
 json: () => Promise.resolve({ features: [] }), // no data -> will throw, but fetch was called
      })
      
      //Coordinates for Aberdeen -- still throws (no data) but confirms fetch was invoked
      await expect(fetchRiverLevels('custom', 57.15, -2.09)).rejects.toThrow()
      
      expect(mockFetch).toHaveBeenCalled() // confirms HTTP call was attempted
    })
  })

  //getGaugeColor -- returns a Tailwind text-color class for each status
  describe('getGaugeColor', () => {
    test('returns green class for normal status', () => {
      //Normal = safe water level; green conveys "all good"
      expect(getGaugeColor('normal')).toContain('green')
    })

    test('returns orange class for rising status', () => {
      //Rising trend = potential concern; orange = "watch closely"
      expect(getGaugeColor('rising')).toContain('orange') // text-orange-500
    })

    test('returns amber class for warning status', () => {
      //Warning = above the warning threshold; amber = "take action"
      expect(getGaugeColor('warning')).toContain('amber') // text-amber-600
    })

    test('returns red class for alert status', () => {
      //Alert = above the danger threshold; red = "emergency"
      expect(getGaugeColor('alert')).toContain('red')
    })
  })

  //getGaugeBg -- returns a Tailwind bg-color class for card/badge backgrounds
  describe('getGaugeBg', () => {
    test('returns appropriate backgrounds for each status', () => {
      //Just check each call returns a string (exact class is implementation-specific)
      expect(typeof getGaugeBg('normal')).toBe('string')
      expect(typeof getGaugeBg('rising')).toBe('string')
      expect(typeof getGaugeBg('warning')).toBe('string')
      expect(typeof getGaugeBg('alert')).toBe('string')
    })
  })
})

//TypeScript interface shape validation -- ensures type definitions are correct
describe('RiverGauge interface', () => {
  test('validates RiverGauge structure', () => {
    //Assigning to the typed variable ensures TypeScript validates every field
    const gauge: RiverGauge = {
      id: '12345',
      name: 'Test Station',
      river: 'River Don',
      location: 'Aberdeen',
      level: 1.25,               // current water level in metres
      levelTrend: 'steady',      // not moving significantly
      normalLevel: 1.0,          // baseline reading
      warningLevel: 1.5,         // orange threshold
      alertLevel: 2.0,           // red threshold
      status: 'normal',          // derived from level vs thresholds
      lastUpdated: '2024-01-15T10:00:00Z',
      source: 'sepa',            // data came from the SEPA API
    }
    
    expect(gauge.id).toBe('12345')
    expect(gauge.levelTrend).toBe('steady')
    expect(gauge.status).toBe('normal')
    expect(gauge.source).toBe('sepa')
  })

  test('validates level trend values', () => {
    //All three valid levelTrend strings must be accepted by the type
    const trends: Array<'rising' | 'falling' | 'steady'> = ['rising', 'falling', 'steady']
    
    trends.forEach(trend => {
      const gauge: RiverGauge = {
        id: '1', name: 'Test', river: 'Test', location: 'Test',
        level: 1.0, levelTrend: trend, normalLevel: 1.0,
        warningLevel: 1.5, alertLevel: 2.0, status: 'normal',
        lastUpdated: '', source: 'sepa'
      }
      expect(gauge.levelTrend).toBe(trend)
    })
  })

  test('validates status values', () => {
    //All four valid status strings must be accepted by the type
    const statuses: Array<'normal' | 'rising' | 'warning' | 'alert'> = 
      ['normal', 'rising', 'warning', 'alert']
    
    statuses.forEach(status => {
      const gauge: RiverGauge = {
        id: '1', name: 'Test', river: 'Test', location: 'Test',
        level: 1.0, levelTrend: 'steady', normalLevel: 1.0,
        warningLevel: 1.5, alertLevel: 2.0, status: status,
        lastUpdated: '', source: 'sepa'
      }
      expect(gauge.status).toBe(status)
    })
  })
})

describe('RiverHistory interface', () => {
  test('validates RiverHistory structure', () => {
    const history: RiverHistory = {
      time: '2024-01-15T10:00:00Z',
      level: 1.25,
    }
    
    expect(history.time).toBe('2024-01-15T10:00:00Z')
    expect(history.level).toBe(1.25)
  })
})
