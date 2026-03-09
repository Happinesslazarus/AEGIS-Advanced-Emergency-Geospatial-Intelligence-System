/**
 * adapters/riverData/SEPAAdapter.ts — Scottish Environment Protection Agency adapter
 *
 * Fetches live river level data from the SEPA KiWIS time-series API.
 * This is a public API requiring no authentication key.
 *
 * API: https://timeseries.sepa.org.uk/KiWIS/KiWIS
 * Documentation: https://timeseries.sepa.org.uk/KiWIS/KiWIS?service=kisters&type=queryServices&request=getrequestinfo
 */

import type { RiverDataAdapter, RiverReading, RiverHistory } from './RiverDataAdapter.js'

const SEPA_BASE = process.env.SEPA_API_BASE || 'https://timeseries.sepa.org.uk/KiWIS/KiWIS'
const TIMEOUT_MS = 15_000

export class SEPAAdapter implements RiverDataAdapter {
  readonly name = 'SEPA'

  isAvailable(): boolean {
    // SEPA is publicly available — no API key needed
    return true
  }

  async fetchCurrentLevel(stationId: string, stationName?: string, riverName?: string): Promise<RiverReading | null> {
    try {
      // Get latest time-series value for the station
      const url = new URL(SEPA_BASE)
      url.searchParams.set('service', 'kisters')
      url.searchParams.set('type', 'queryServices')
      url.searchParams.set('request', 'getTimeseriesValues')
      url.searchParams.set('datasource', '0')
      url.searchParams.set('format', 'json')
      url.searchParams.set('station_id', stationId)
      url.searchParams.set('ts_name', 'Water Level')
      url.searchParams.set('period', 'PT1H')    // last 1 hour
      url.searchParams.set('returnfields', 'Timestamp,Value')

      const res = await fetch(url.toString(), {
        headers: { 'User-Agent': 'AEGIS-RiverMonitor/1.0' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })

      if (!res.ok) {
        console.warn(`[SEPA] HTTP ${res.status} for station ${stationId}`)
        return null
      }

      const data = await res.json()
      const series = Array.isArray(data) ? data[0] : data
      const values = series?.data || series?.values || []

      if (!values.length) {
        console.warn(`[SEPA] No data for station ${stationId}`)
        return null
      }

      // Get the most recent reading (last element)
      const latest = values[values.length - 1]
      const timestamp = Array.isArray(latest) ? latest[0] : latest?.Timestamp || latest?.timestamp
      const level = Array.isArray(latest) ? parseFloat(latest[1]) : parseFloat(latest?.Value || latest?.value)

      if (isNaN(level)) return null

      // Try to get flow if available
      let flowCumecs: number | null = null
      try {
        const flowUrl = new URL(SEPA_BASE)
        flowUrl.searchParams.set('service', 'kisters')
        flowUrl.searchParams.set('type', 'queryServices')
        flowUrl.searchParams.set('request', 'getTimeseriesValues')
        flowUrl.searchParams.set('datasource', '0')
        flowUrl.searchParams.set('format', 'json')
        flowUrl.searchParams.set('station_id', stationId)
        flowUrl.searchParams.set('ts_name', 'Flow')
        flowUrl.searchParams.set('period', 'PT1H')

        const flowRes = await fetch(flowUrl.toString(), {
          headers: { 'User-Agent': 'AEGIS-RiverMonitor/1.0' },
          signal: AbortSignal.timeout(10_000),
        })

        if (flowRes.ok) {
          const flowData = await flowRes.json()
          const flowSeries = Array.isArray(flowData) ? flowData[0] : flowData
          const flowValues = flowSeries?.data || flowSeries?.values || []
          if (flowValues.length) {
            const lastFlow = flowValues[flowValues.length - 1]
            const fv = Array.isArray(lastFlow) ? parseFloat(lastFlow[1]) : parseFloat(lastFlow?.Value || lastFlow?.value)
            if (!isNaN(fv)) flowCumecs = fv
          }
        }
      } catch {
        // Flow data is optional — continue without it
      }

      return {
        stationId,
        stationName: stationName || `SEPA Station ${stationId}`,
        riverName: riverName || 'Unknown River',
        levelMetres: level,
        flowCumecs,
        timestamp: timestamp ? new Date(timestamp).toISOString() : new Date().toISOString(),
        dataSource: 'SEPA',
        rawResponse: typeof data === 'object' ? { sepa: data } : {},
      }
    } catch (err: any) {
      console.error(`[SEPA] Failed to fetch station ${stationId}: ${err.message}`)
      return null
    }
  }

  async fetchHistory(stationId: string, hours = 24): Promise<RiverHistory | null> {
    try {
      const url = new URL(SEPA_BASE)
      url.searchParams.set('service', 'kisters')
      url.searchParams.set('type', 'queryServices')
      url.searchParams.set('request', 'getTimeseriesValues')
      url.searchParams.set('datasource', '0')
      url.searchParams.set('format', 'json')
      url.searchParams.set('station_id', stationId)
      url.searchParams.set('ts_name', 'Water Level')
      url.searchParams.set('period', `PT${hours}H`)
      url.searchParams.set('returnfields', 'Timestamp,Value')

      const res = await fetch(url.toString(), {
        headers: { 'User-Agent': 'AEGIS-RiverMonitor/1.0' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })

      if (!res.ok) return null

      const data = await res.json()
      const series = Array.isArray(data) ? data[0] : data
      const values = series?.data || series?.values || []

      const readings = values
        .map((v: any) => {
          const ts = Array.isArray(v) ? v[0] : v?.Timestamp || v?.timestamp
          const lv = Array.isArray(v) ? parseFloat(v[1]) : parseFloat(v?.Value || v?.value)
          if (isNaN(lv) || !ts) return null
          return { timestamp: new Date(ts).toISOString(), levelMetres: lv }
        })
        .filter(Boolean) as Array<{ timestamp: string; levelMetres: number }>

      return { stationId, readings }
    } catch (err: any) {
      console.error(`[SEPA] History fetch failed for ${stationId}: ${err.message}`)
      return null
    }
  }

  async fetchMultiple(stationIds: string[]): Promise<RiverReading[]> {
    const results = await Promise.allSettled(
      stationIds.map(id => this.fetchCurrentLevel(id)),
    )
    return results
      .filter((r): r is PromiseFulfilledResult<RiverReading | null> => r.status === 'fulfilled')
      .map(r => r.value)
      .filter((r): r is RiverReading => r !== null)
  }
}
