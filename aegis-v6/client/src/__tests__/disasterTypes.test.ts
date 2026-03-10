import { describe, test, expect } from 'vitest'
import { INCIDENT_CATEGORIES, DISASTER_SUBTYPES } from '../data/disasterTypes'

describe('Disaster Types Configuration', () => {
  test('has 6 incident categories', () => {
    expect(INCIDENT_CATEGORIES.length).toBe(6)
  })

  test('each category has required fields', () => {
    for (const cat of INCIDENT_CATEGORIES) {
      expect(cat.key).toBeTruthy()
      expect(cat.label).toBeTruthy()
      expect(cat.icon).toBeTruthy()
      expect(cat.color).toBeTruthy()
    }
  })

  test('natural_disaster has flood, severe_storm, heatwave, wildfire, landslide', () => {
    const natDisaster = DISASTER_SUBTYPES.natural_disaster
    const keys = natDisaster.map(s => s.key)
    expect(keys).toContain('flood')
    expect(keys).toContain('severe_storm')
    expect(keys).toContain('heatwave')
    expect(keys).toContain('wildfire')
    expect(keys).toContain('landslide')
  })

  test('all 10 core incident subtypes are marked as implemented', () => {
    const coreIds = [
      'flood', 'severe_storm', 'heatwave', 'wildfire', 'landslide',
      'power_outage', 'water_supply_disruption', 'infrastructure_damage',
      'public_safety_incident', 'environmental_hazard',
    ]
    const allSubtypes = Object.values(DISASTER_SUBTYPES).flat()
    for (const id of coreIds) {
      const found = allSubtypes.find(s => s.key === id)
      expect(found).toBeDefined()
      expect(found!.implemented).toBe(true)
    }
  })
})
