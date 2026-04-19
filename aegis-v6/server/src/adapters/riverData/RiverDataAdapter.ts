/**
 * Module: RiverDataAdapter.ts
 *
 * River data adapter server module.
 *
 * - Used by services for external data fetching
 */

export interface RiverReading {
  stationId: string
  stationName: string
  riverName: string
  levelMetres: number | null
  flowCumecs: number | null
  timestamp: string
  dataSource: string
  rawResponse?: Record<string, unknown>
}

export interface RiverHistory {
  stationId: string
  readings: Array<{
    timestamp: string
    levelMetres: number
    flowCumecs?: number
  }>
}

export interface RiverDataAdapter {
  /* Human-readable name for this adapter */
  readonly name: string

  /* Whether this adapter is currently available (has required config) */
  isAvailable(): boolean

   /**
   * Fetch the current reading for a specific station.
   * Returns null if the station is not found or the fetch fails.
   */
  fetchCurrentLevel(stationId: string, stationName?: string, riverName?: string): Promise<RiverReading | null>

   /**
   * Fetch historical readings for a station over a time range.
   * @param hours Number of hours of history to retrieve (default 24)
   */
  fetchHistory(stationId: string, hours?: number): Promise<RiverHistory | null>

   /**
   * Fetch levels for multiple stations in one call where possible.
   */
  fetchMultiple(stationIds: string[]): Promise<RiverReading[]>
}
