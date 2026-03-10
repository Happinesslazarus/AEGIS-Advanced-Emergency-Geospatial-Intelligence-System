import { listIncidentTypes, getIncidentType, upsertIncidentType } from '../config/incidentTypes'

describe('Incident Registry', () => {
  test('lists all 10 incident types', () => {
    const types = listIncidentTypes()
    expect(types.length).toBeGreaterThanOrEqual(10)
  })

  test('retrieves flood incident type', () => {
    const flood = getIncidentType('flood')
    expect(flood).toBeDefined()
    expect(flood!.name).toBe('Flood')
    expect(flood!.enabled).toBe(true)
  })

  test('retrieves all 10 core types by id', () => {
    const ids = [
      'flood', 'severe_storm', 'heatwave', 'wildfire', 'landslide',
      'power_outage', 'water_supply_disruption', 'infrastructure_damage',
      'public_safety_incident', 'environmental_hazard',
    ]
    for (const id of ids) {
      const t = getIncidentType(id)
      expect(t).toBeDefined()
      expect(t!.id).toBe(id)
    }
  })

  test('each type has required fields', () => {
    const types = listIncidentTypes()
    for (const t of types) {
      expect(t.id).toBeTruthy()
      expect(t.name).toBeTruthy()
      expect(t.category).toBeTruthy()
      expect(t.severityLevels).toHaveLength(4)
      expect(t.alertThresholds).toBeDefined()
      expect(t.alertThresholds.advisory).toBeDefined()
      expect(t.alertThresholds.warning).toBeDefined()
      expect(t.alertThresholds.critical).toBeDefined()
    }
  })

  test('upsert creates new type', () => {
    const newType = upsertIncidentType('test_hazard', { name: 'Test Hazard' })
    expect(newType.id).toBe('test_hazard')
    expect(newType.name).toBe('Test Hazard')
    // Clean up - this stays in memory only for this test run
  })
})
