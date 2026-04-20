/**
 * Tests for the disasterTypes data module -- a static configuration file that
 * defines all supported disaster/incident category names, icons, and colours,
 * plus the sub-types (specific events) nested under each category.
 *
 * Glossary:
 *   describe()              = groups related tests under a labelled block
 *   test()                  = a single scenario with one expected outcome
 *   expect()                = makes an assertion about a value
 *   INCIDENT_CATEGORIES     = array of top-level category objects (natural disasters,
 *                             infrastructure failures, public safety incidents, etc.)
 *                             each with: key (string ID), label (display name),
 *                             icon (icon name string), color (CSS colour string)
 *   DISASTER_SUBTYPES       = object keyed by category key; each value is an array of
 *                             subtype objects with: key (string ID), label (display name),
 *                             implemented:boolean (whether the AI model supports it)
 *   toBeTruthy()            = passes if value is not null/undefined/empty/0/false
 *   toBeDefined()           = passes if value is not undefined
 *   .flat()                 = flattens one level of nested arrays; here converts the
 *                             object of arrays into a single flat array of all subtypes
 *   natural_disaster        = category key for weather and environmental events
 *                             (flood, storm, heatwave, wildfire, landslide)
 *   implemented             = flag on each subtype; true means the AI engine can
 *                             classify and handle that specific event type
 *
 * - Run by the test runner (Vitest) with `vitest run` or `vitest watch`
 */

import { describe, test, expect } from 'vitest'
import { INCIDENT_CATEGORIES, DISASTER_SUBTYPES } from '../data/disasterTypes'

describe('Disaster Types Configuration', () => {
  test('has 6 incident categories', () => {
    //The data file must define exactly 6 top-level categories (natural disaster,
    //infrastructure, public safety, etc.); this validates that none were accidentally removed
    expect(INCIDENT_CATEGORIES.length).toBe(6)
  })

  test('each category has required fields', () => {
    //Every category must have all four UI fields populated so icons and labels render correctly
    for (const cat of INCIDENT_CATEGORIES) {
      expect(cat.key).toBeTruthy()   // string ID used in API requests and route params
      expect(cat.label).toBeTruthy() // human-readable display name shown in the UI
      expect(cat.icon).toBeTruthy()  // icon name used to look up the correct SVG icon
      expect(cat.color).toBeTruthy() // CSS colour for category-specific badge/pill styling
    }
  })

  test('natural_disaster has flood, severe_storm, heatwave, wildfire, landslide', () => {
    //The five main natural disaster subtypes must exist; Scotland experiences all of these
    const natDisaster = DISASTER_SUBTYPES.natural_disaster
    const keys = natDisaster.map(s => s.key) // extract just the ID strings for .toContain checks
    expect(keys).toContain('flood')
    expect(keys).toContain('severe_storm')
    expect(keys).toContain('heatwave')
    expect(keys).toContain('wildfire')
    expect(keys).toContain('landslide')
  })

  test('all 11 core incident subtypes are marked as implemented', () => {
    //The AI engine's incident classifier must support all 11 core types;
    //implemented:false is only set for planned-but-not-ready types
    const coreIds = [
      'flood', 'severe_storm', 'heatwave', 'wildfire', 'landslide',   // natural disasters
      'power_outage', 'water_supply_disruption', 'infrastructure_damage', // infrastructure
      'public_safety_incident', 'environmental_hazard', 'drought',      // other categories
    ]
    const allSubtypes = Object.values(DISASTER_SUBTYPES).flat() // flatten into one list
    for (const id of coreIds) {
      const found = allSubtypes.find(s => s.key === id)
      expect(found).toBeDefined()            // subtype must exist in the data file
      expect(found!.implemented).toBe(true)  // and must be flagged as implemented
    }
  })
})
