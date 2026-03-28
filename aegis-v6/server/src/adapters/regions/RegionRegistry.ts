/**
 * adapters/regions/RegionRegistry.ts — Central region adapter registry
 *
 * Manages the lifecycle of region adapters. The ACTIVE_REGION env var
 * determines which adapter is the default. startup should fail clearly
 * if ACTIVE_REGION is set to an invalid value.
 *
 * Usage:
 *   import { regionRegistry } from './adapters/regions/RegionRegistry.js'
 *   const adapter = regionRegistry.getActiveRegion()
 *   const warnings = await adapter.getFloodWarnings()
 */

import type { RegionAdapter } from './RegionAdapter.interface.js'
import { ScotlandAdapter } from './ScotlandAdapter.js'
import { EnglandAdapter } from './EnglandAdapter.js'
import { GenericAdapter } from './GenericAdapter.js'
import { logger } from '../../services/logger.js'

class RegionRegistry {
  private adapters = new Map<string, RegionAdapter>()
  private activeRegionId: string | null = null

  /* Ensure built-in adapters are always available, even before explicit init. */
  private ensureBuiltIns(): void {
    if (!this.adapters.has('scotland')) this.registerRegion(new ScotlandAdapter())
    if (!this.adapters.has('england')) this.registerRegion(new EnglandAdapter())
    if (!this.adapters.has('default')) this.registerRegion(new GenericAdapter())
  }

   /**
   * Register a region adapter. Can be called at startup or dynamically.
   */
  registerRegion(adapter: RegionAdapter): void {
    this.adapters.set(adapter.regionId, adapter)
  }

   /**
   * Get an adapter by region ID. Returns undefined if not registered.
   */
  getRegion(regionId: string): RegionAdapter | undefined {
    return this.adapters.get(regionId)
  }

   /**
   * Get the active (default) region adapter.
   * Falls back to GenericAdapter if no region is configured.
   */
  getActiveRegion(): RegionAdapter {
    this.ensureBuiltIns()

    if (this.activeRegionId) {
      const adapter = this.adapters.get(this.activeRegionId)
      if (adapter) return adapter
    }
    // Fallback to 'default' (GenericAdapter)
    return this.adapters.get('default') || [...this.adapters.values()][0]
  }

   /**
   * Set the active region by ID.
   * @throws Error if the region ID is not registered
   */
  setActiveRegion(regionId: string): void {
    this.ensureBuiltIns()

    if (!this.adapters.has(regionId)) {
      throw new Error(
        `[RegionRegistry] Cannot set active region to '${regionId}' — not registered. ` +
        `Available: ${[...this.adapters.keys()].join(', ')}`,
      )
    }
    this.activeRegionId = regionId
  }

  /* List all registered region IDs */
  listRegions(): string[] {
    this.ensureBuiltIns()
    return [...this.adapters.keys()]
  }

  /* Get all registered adapters (for multi-region support) */
  getAllRegions(): RegionAdapter[] {
    this.ensureBuiltIns()
    return [...this.adapters.values()]
  }

  /* Check if a region ID is registered */
  hasRegion(regionId: string): boolean {
    this.ensureBuiltIns()
    return this.adapters.has(regionId)
  }
}

// Singleton instance

export const regionRegistry = new RegionRegistry()

 /**
 * Bootstrap the registry with built-in adapters and validate ACTIVE_REGION.
 * Call this once during server startup (index.ts).
 *
 * @throws Error if ACTIVE_REGION env var is set to an unrecognised value
 */
export function initRegionRegistry(): void {
  // Register built-in adapters
  regionRegistry.registerRegion(new ScotlandAdapter())
  regionRegistry.registerRegion(new EnglandAdapter())
  regionRegistry.registerRegion(new GenericAdapter())

  // Determine active region from env
  const envRegion = (
    process.env.ACTIVE_REGION ||
    process.env.AEGIS_REGION ||
    'scotland'
  ).toLowerCase()

  // Alias common names to registered IDs
  const aliases: Record<string, string> = {
    gb: 'scotland',
    uk: 'scotland',
    'united kingdom': 'scotland',
    global: 'default',
    generic: 'default',
    fallback: 'default',
  }

  const resolved = aliases[envRegion] || envRegion

  if (!regionRegistry.hasRegion(resolved)) {
    const available = regionRegistry.listRegions().join(', ')
    throw new Error(
      `[AEGIS] ACTIVE_REGION='${envRegion}' is not a registered region. ` +
      `Available regions: ${available}. ` +
      `Set ACTIVE_REGION to one of these values or add a new adapter.`,
    )
  }

  regionRegistry.setActiveRegion(resolved)
  logger.info({ region: resolved, name: regionRegistry.getActiveRegion().getMetadata().name }, '[RegionRegistry] Active region set')
}

export type { RegionAdapter }
