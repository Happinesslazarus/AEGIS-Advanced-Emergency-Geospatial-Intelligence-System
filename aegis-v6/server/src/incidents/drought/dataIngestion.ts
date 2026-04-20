/**
 * Extended drought conditions incident module (handles drought specific logic).
 *
 * - Part of the incident module system, registered via incidents/registry.ts
 * */

export interface DroughtIngestionResult {
  rainfall30dMm: number
  avgTempC: number
  maxTempC: number
  riverLevelNormal: boolean   // false = critically low
  droughtIndexScore: number   // 0 (no drought) — 100 (severe)
  dataSource: string
  fetchedAt: string
}

const UK_LAT = 57.15
const UK_LNG = -2.09
const UK_RAINFALL_30D_NORMAL = 100 // mm/month baseline

/**
 * Fetch 30-day precipitation and temperature from Open-Meteo.
 * Returns a normalised drought index score.
 */
export async function ingestDroughtData(
  latitude = UK_LAT,
  longitude = UK_LNG,
): Promise<DroughtIngestionResult> {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${latitude}&longitude=${longitude}` +
    `&daily=precipitation_sum,temperature_2m_max,temperature_2m_mean` +
    `&timezone=auto&forecast_days=1&past_days=30`

  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`Open-Meteo returned ${res.status}`)

  const data = await res.json()
  const precipSums: number[]  = data.daily?.precipitation_sum ?? []
  const maxTemps:   number[]  = data.daily?.temperature_2m_max ?? []
  const meanTemps:  number[]  = data.daily?.temperature_2m_mean ?? []

  const rainfall30d = precipSums.reduce((s, v) => s + (v ?? 0), 0)
  const avgTemp     = meanTemps.length ? meanTemps.reduce((s, v) => s + (v ?? 0), 0) / meanTemps.length : 12
  const maxTemp     = maxTemps.length  ? Math.max(...maxTemps)  : 15

  // SPI-inspired proxy: how far below normal is rainfall?
  const deficit     = Math.max(0, UK_RAINFALL_30D_NORMAL - rainfall30d)
  let droughtScore  = Math.min(100, (deficit / UK_RAINFALL_30D_NORMAL) * 80)
  // Temperature uplift: every 5—C above 15—C adds 5 points
  if (avgTemp > 15) droughtScore = Math.min(100, droughtScore + ((avgTemp - 15) / 5) * 5)

  return {
    rainfall30dMm:   Math.round(rainfall30d * 10) / 10,
    avgTempC:        Math.round(avgTemp * 10) / 10,
    maxTempC:        Math.round(maxTemp * 10) / 10,
    riverLevelNormal: rainfall30d > 40,  // basic proxy
    droughtIndexScore: Math.round(droughtScore),
    dataSource: 'open_meteo',
    fetchedAt: new Date().toISOString(),
  }
}

/**
 * Classify drought severity from ingestion result.
 */
export function classifyDroughtSeverity(result: DroughtIngestionResult): 'Low' | 'Medium' | 'High' | 'Critical' {
  const s = result.droughtIndexScore
  if (s >= 75) return 'Critical'
  if (s >= 55) return 'High'
  if (s >= 30) return 'Medium'
  return 'Low'
}
