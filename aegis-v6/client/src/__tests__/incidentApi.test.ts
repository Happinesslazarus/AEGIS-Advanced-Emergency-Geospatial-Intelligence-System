/**
 * Tests for the incidentApi utility module, which provides typed async functions
 * that call the AEGIS server's incident endpoints.  Also validates the TypeScript
 * interface shapes (IncidentRegistryEntry, IncidentPrediction, IncidentAlert, etc.)
 * at compile time via type-annotated variables.
 *
 * AEGIS incident system overview:
 *   The server exposes a versioned REST API at /api/v1/incidents/.
 *   Each incident type (flood, fire, earthquake...) has its own sub-routes:
 *     /api/v1/incidents/registry         -- list all registered incident types
 *     /api/v1/incidents/all/dashboard    -- aggregated counts across all types
 *     /api/v1/incidents/<type>/active    -- live reports for one type
 *     /api/v1/incidents/<type>/predictions -- ML-generated risk forecasts
 *     /api/v1/incidents/<type>/alerts    -- official alerts (SEPA, Met Office, etc.)
 *     /api/v1/incidents/<type>/map       -- GeoJSON markers for the map layer
 *     /api/v1/incidents/<type>/history   -- historical data (last N days)
 *     /api/v1/incidents/<type>/report    -- citizen report submission (POST)
 *     /api/v1/incidents/flood/threat     -- curent flood threat level
 *     /api/v1/incidents/flood/evacuation-route -- suggested evacuation path
 *
 * Glossary:
 *   global.fetch            = replaced with a vi.fn() mock so tests never make real HTTP calls
 *   vi.fn()                 = creates a trackable function with controllable return values
 *   vi.mock()               = replaces a module before imports run
 *   vi.stubEnv()            = sets an environment variable for the duration of the test run
 *   mockFetch.mockResolvedValue() = makes the mock return a resolved Promise with the given value
 *   mockFetch.mockRejectedValue() = makes the mock return a rejected Promise (simulates error)
 *   vi.clearAllMocks()      = resets call counts / implementations before each test
 *   expect.stringContaining() = partial URL match -- URL structure not exact
 *   expect.objectContaining() = partial object match -- extra keys are allowed
 *   ok: true/false          = fetch Response property; false means HTTP 4xx/5xx
 *   Bearer token            = Authorization: Bearer <jwt> header appended to all requests
 *   getToken()              = returns the stored staff JWT
 *   VITE_API_BASE_URL       = Vite environment variable for the backend base URL
 *   IncidentRegistryEntry   = type for one row in the incident registry (id, name, aiTier, etc.)
 *   IncidentPrediction      = ML forecast: incidentType, severity, probability, location, validFrom/To
 *   IncidentAlert           = official warning: id, incidentType, severity, title, message, issuedAt
 *   IncidentMapMarker       = a pin on the map: lat/lng, severity, source (report|sensor|prediction|alert)
 *   IncidentMapData         = one layer of map markers for a single incident type
 *   IncidentDashboardSummary = aggregated counts (totalAlerts, totalPredictions) + per-type breakdown
 *   aiTier                  = level of AI used: 'ml' (trained model), 'statistical', 'rule_based'
 *   operationalStatus       = 'fully_operational' | 'degraded' | 'offline'
 *   confidence              = 0-1 probability that the prediction is accurate
 *   confidenceSource        = who calculated the confidence ('ml_model' | 'statistical' | 'rule_based')
 *   severity                = 'low' | 'medium' | 'high' | 'critical'
 *   region                  = geographic filter string, e.g. 'scotland', 'edinburgh'
 *
 * How it connects:
 * - Run by the test runner (Vitest) with `vitest run` or `vitest watch`
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

//Mock setup -- must come before imports so hoisting takes effect

//Replace the global fetch with a mock so no real HTTP requests are made
const mockFetch = vi.fn()
global.fetch = mockFetch

//api module: getToken returns a dummy staff JWT
vi.mock('../utils/api', () => ({
  getToken: vi.fn(() => 'test-token-123'),
}))

//Set the base URL environment variable that incidentApi reads from import.meta.env
vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3000')

//Import after mocking so the mocked versions are resolved at module init time
import {
  apiGetIncidentRegistry,
  apiGetIncidentDashboard,
  apiGetAllIncidentPredictions,
  apiGetAllIncidentAlerts,
  apiGetAllIncidentMapData,
  apiGetIncidentActive,
  apiGetIncidentPredictions,
  apiGetIncidentAlerts,
  apiGetIncidentMapData,
  apiGetIncidentHistory,
  apiSubmitIncidentReport,
  apiGetFloodThreat,
  apiGetFloodEvacuationRoute,
  type IncidentRegistryEntry,
  type IncidentPrediction,
  type IncidentAlert,
  type IncidentMapMarker,
  type IncidentMapData,
  type IncidentDashboardSummary,
} from '../utils/incidentApi'

//incidentApi function tests
describe('incidentApi', () => {
  beforeEach(() => {
    vi.clearAllMocks() // reset call counts and mock implementations
    mockFetch.mockReset() // clear any pending resolved/rejected values
  })

  afterEach(() => {
    vi.restoreAllMocks() // undo any spy wrappers added during the test
  })

  //apiGetIncidentRegistry -- fetch the list of supported incident types
  describe('apiGetIncidentRegistry', () => {
    test('fetches registry successfully', async () => {
      //Mock a valid server response with one flood module
      const mockRegistry = {
        modules: [
          {
            id: 'flood',
            name: 'Flood Monitoring',
            category: 'natural',
            icon: '🌊',
            color: '#0077be',
            operationalStatus: 'fully_operational',
            aiTier: 'ml', // machine-learning-based predictions
          },
        ],
      }
      
      mockFetch.mockResolvedValue({
        ok: true,                                   // HTTP 200
        json: () => Promise.resolve(mockRegistry),
      })
      
      const result = await apiGetIncidentRegistry()
      
      //Verify the function builds the correct URL with /registry suffix
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/incidents/registry'),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-token-123', // JWT appended to every request
          }),
        })
      )
      expect(result.modules).toHaveLength(1)
      expect(result.modules[0].name).toBe('Flood Monitoring')
    })

    test('handles network error', async () => {
      //Simulate complete network failure (DNS error, no internet, etc.)
      mockFetch.mockRejectedValue(new Error('Network error'))
      
      //incidentApi wraps the error in a user-friendly message
      await expect(apiGetIncidentRegistry()).rejects.toThrow('Cannot connect to incident API.')
    })

    test('handles non-ok response', async () => {
      //Simulate a 500 Internal Server Error from the backend
      mockFetch.mockResolvedValue({
        ok: false,          // HTTP 5xx
        status: 500,
        json: () => Promise.resolve({ error: 'Internal server error' }),
      })
      
      await expect(apiGetIncidentRegistry()).rejects.toThrow('Internal server error')
    })
  })

  //apiGetIncidentDashboard -- aggregated summary across all incident types
  describe('apiGetIncidentDashboard', () => {
    //Reusable mock response shape matching IncidentDashboardSummary
    const mockDashboard: IncidentDashboardSummary = {
      region: 'scotland',
      generatedAt: '2024-01-15T10:00:00Z',
      incidents: [
        {
          id: 'flood',
          name: 'Flood',
          icon: '🌊',
          color: '#0077be',
          status: 'active',
          aiTier: 'ml',
          activePredictions: 5,
          activeAlerts: 2,
          activeReports: 10,
        },
      ],
      totalAlerts: 2,
      totalPredictions: 5,
    }

    test('fetches dashboard without region filter', async () => {
      //When no region arg is passed, URL should not include ?region
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockDashboard),
      })
      
      const result = await apiGetIncidentDashboard()
      
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/incidents/all/dashboard'),
        expect.anything()
      )
      expect(result.totalAlerts).toBe(2)
    })

    test('fetches dashboard with region filter', async () => {
      //Passing 'scotland' adds ?region=scotland to the query string
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockDashboard),
      })
      
      await apiGetIncidentDashboard('scotland')
      
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('region=scotland'), // query param appended
        expect.anything()
      )
    })
  })

  //apiGetAllIncidentPredictions -- ML forecasts for all incident types combined
  describe('apiGetAllIncidentPredictions', () => {
    test('fetches all predictions', async () => {
      const mockPredictions = {
        predictions: [
          {
            incidentType: 'flood',
            severity: 'high',
            probability: 0.85,        // 85% chance the predicted event occurs
            location: { lat: 55.95, lng: -3.19, name: 'Edinburgh' },
            validFrom: '2024-01-15T00:00:00Z',
            validTo: '2024-01-16T00:00:00Z',
            confidence: 0.9,          // 90% confidence in the probability estimate
            confidenceSource: 'ml_model',
          },
        ],
        count: 1,
        region: 'scotland',
      }
      
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockPredictions),
      })
      
      const result = await apiGetAllIncidentPredictions()
      
      expect(result.predictions).toHaveLength(1)
      expect(result.predictions[0].probability).toBe(0.85)
    })
  })

  //apiGetAllIncidentAlerts -- official warnings from SEPA / Met Office etc.
  describe('apiGetAllIncidentAlerts', () => {
    test('fetches all alerts', async () => {
      const mockAlerts = {
        alerts: [
          {
            id: 'alert-1',
            incidentType: 'flood',
            severity: 'high',
            title: 'Flood Warning',
            message: 'River levels rising',
            issuedAt: '2024-01-15T10:00:00Z',
            source: 'SEPA',        // Scottish Environment Protection Agency
            acknowledged: false,   // not yet reviewed by an operator
          },
        ],
        count: 1,
        region: 'scotland',
      }
      
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockAlerts),
      })
      
      const result = await apiGetAllIncidentAlerts()
      
      expect(result.alerts).toHaveLength(1)
      expect(result.alerts[0].title).toBe('Flood Warning')
    })
  })

  //apiGetAllIncidentMapData -- GeoJSON pins for all incident types
  describe('apiGetAllIncidentMapData', () => {
    test('fetches map data for all incidents', async () => {
      const mockMapData = {
        layers: [
          {
            incidentType: 'flood',
            markers: [
              {
                id: 'marker-1',
                incidentType: 'flood',
                lat: 55.95,  // degrees North
                lng: -3.19,  // degrees East (negative = West)
                severity: 'high',
                title: 'Flooding reported',
                timestamp: '2024-01-15T10:00:00Z',
                source: 'report', // citizen report (not sensor or ML prediction)
              },
            ],
          },
        ],
        region: 'scotland',
      }
      
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockMapData),
      })
      
      const result = await apiGetAllIncidentMapData()
      
      expect(result.layers).toHaveLength(1)
      expect(result.layers[0].markers[0].lat).toBe(55.95)
    })
  })

  //apiGetIncidentActive -- live citizen/sensor reports for a single type
  describe('apiGetIncidentActive', () => {
    test('fetches active incidents for type', async () => {
      //URL should include /<type>/active
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ reports: [{ id: '1' }] }),
      })
      
      const result = await apiGetIncidentActive('flood')
      
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/flood/active'),
        expect.anything()
      )
      expect(result.reports).toHaveLength(1)
    })

    test('includes region parameter when provided', async () => {
      //Regional filter scopes results to one geographic area
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ reports: [] }),
      })
      
      await apiGetIncidentActive('flood', 'edinburgh')
      
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('region=edinburgh'),
        expect.anything()
      )
    })
  })

  //apiGetIncidentPredictions -- ML forecasts for a specific incident type
  describe('apiGetIncidentPredictions', () => {
    test('fetches predictions for specific type', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ predictions: [] }),
      })
      
      await apiGetIncidentPredictions('flood', 'scotland')
      
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/flood/predictions'),
        expect.anything()
      )
    })
  })

  //apiGetIncidentAlerts -- official alerts for a specific incident type
  describe('apiGetIncidentAlerts', () => {
    test('fetches alerts for specific type', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ alerts: [] }),
      })
      
      await apiGetIncidentAlerts('flood')
      
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/flood/alerts'),
        expect.anything()
      )
    })
  })

  //apiGetIncidentMapData -- map markers for a single incident type
  describe('apiGetIncidentMapData', () => {
    test('fetches map data for specific type', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          incidentType: 'flood',
          markers: [],
        }),
      })
      
      const result = await apiGetIncidentMapData('flood')
      
      expect(result.incidentType).toBe('flood')
    })
  })

  //apiGetIncidentHistory -- historical trend data for charts
  describe('apiGetIncidentHistory', () => {
    test('fetches history with default days', async () => {
      //Default window is 30 days; added as ?days=30 query param
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ history: [] }),
      })
      
      await apiGetIncidentHistory('flood')
      
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('days=30'), // default window
        expect.anything()
      )
    })

    test('fetches history with custom days', async () => {
      //Caller can narrow the window to 7 days for a weekly view
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ history: [] }),
      })
      
      await apiGetIncidentHistory('flood', 7)
      
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('days=7'),
        expect.anything()
      )
    })
  })

  //apiSubmitIncidentReport -- citizen posts a new incident report (POST)
  describe('apiSubmitIncidentReport', () => {
    test('submits report with POST', async () => {
      //The report body is serialised as JSON and sent as POST body (not query string)
      const reportData = {
        lat: 55.95,
        lng: -3.19,
        severity: 'high',
        description: 'Flooding on main street',
        reporter_name: 'John Doe',
      }
      
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ report: { id: 'report-1' } }),
      })
      
      const result = await apiSubmitIncidentReport('flood', reportData)
      
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/flood/report'),
        expect.objectContaining({
          method: 'POST',                       // state-changing request uses POST
          body: JSON.stringify(reportData),     // serialised JSON body
        })
      )
      expect(result.report.id).toBe('report-1')
    })
  })

  //apiGetFloodThreat -- current threat level for the flood module
  describe('apiGetFloodThreat', () => {
    test('fetches flood threat level', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ level: 'moderate', details: {} }),
      })
      
      const result = await apiGetFloodThreat()
      
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/flood/threat'),
        expect.anything()
      )
      expect(result.level).toBe('moderate')
    })
  })

  //apiGetFloodEvacuationRoute -- suggested evacuation path from a given position
  describe('apiGetFloodEvacuationRoute', () => {
    test('fetches evacuation route', async () => {
      //loc params (lat/lng) plus severity are all sent as query string parameters
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ route: [], safeZones: [] }),
      })
      
      await apiGetFloodEvacuationRoute(55.95, -3.19, 'high')
      
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('lat=55.95'),
        expect.anything()
      )
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('lng=-3.19'),
        expect.anything()
      )
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('severity=high'),
        expect.anything()
      )
    })
  })
})

//TypeScript interface shape validation
//Values are assigned to typed variables -- TypeScript compiler enforces shapes
describe('Type interfaces', () => {
  describe('IncidentRegistryEntry', () => {
    test('validates full structure', () => {
      //If any required field is missing or wrong type, TypeScript compilation fails
      const entry: IncidentRegistryEntry = {
        id: 'flood',
        name: 'Flood Monitoring',
        category: 'natural',
        icon: '🌊',
        color: '#0077be',
        description: 'Monitor and predict flood events',
        operationalStatus: 'fully_operational',
        aiTier: 'ml',
        supportedRegions: ['scotland', 'england'],
        enabledRegions: ['scotland'],
        dataSources: ['sepa', 'met_office'],
        version: '1.0.0',
      }
      
      expect(entry.operationalStatus).toBe('fully_operational')
      expect(entry.aiTier).toBe('ml')
    })
  })

  describe('IncidentPrediction', () => {
    test('validates severity levels', () => {
      //Each severity string is a valid union member; TypeScript would reject anything else
      const severities: Array<'low' | 'medium' | 'high' | 'critical'> = 
        ['low', 'medium', 'high', 'critical']
      
      severities.forEach(severity => {
        const prediction: IncidentPrediction = {
          incidentType: 'flood',
          severity,
          probability: 0.8,
          location: { lat: 55.95, lng: -3.19 },
          validFrom: '2024-01-15T00:00:00Z',
          validTo: '2024-01-16T00:00:00Z',
          confidence: 0.9,
          confidenceSource: 'ml_model',
        }
        expect(prediction.severity).toBe(severity)
      })
    })

    test('validates confidence sources', () => {
      //confidenceSource must be one of three allowed strings
      const sources: Array<'ml_model' | 'statistical' | 'rule_based'> = 
        ['ml_model', 'statistical', 'rule_based']
      
      sources.forEach(source => {
        const prediction: IncidentPrediction = {
          incidentType: 'flood',
          severity: 'high',
          probability: 0.8,
          location: { lat: 55.95, lng: -3.19 },
          validFrom: '2024-01-15T00:00:00Z',
          validTo: '2024-01-16T00:00:00Z',
          confidence: 0.9,
          confidenceSource: source,
        }
        expect(prediction.confidenceSource).toBe(source)
      })
    })
  })

  describe('IncidentAlert', () => {
    test('validates alert structure', () => {
      const alert: IncidentAlert = {
        id: 'alert-123',
        incidentType: 'flood',
        severity: 'high',
        title: 'Flood Warning',
        message: 'River levels are rising rapidly',
        location: { lat: 55.95, lng: -3.19, name: 'Edinburgh' },
        issuedAt: '2024-01-15T10:00:00Z',
        expiresAt: '2024-01-16T10:00:00Z', // optional; absent means no expiry
        source: 'SEPA',
        acknowledged: false, // false = not yet reviewed by an operator
      }
      
      expect(alert.acknowledged).toBe(false)
      expect(alert.location?.name).toBe('Edinburgh') // optional chaining (?.) -- location may be absent
    })
  })

  describe('IncidentMapMarker', () => {
    test('validates marker structure', () => {
      const marker: IncidentMapMarker = {
        id: 'marker-1',
        incidentType: 'flood',
        lat: 55.95,
        lng: -3.19,
        severity: 'high',
        title: 'Flooding reported',
        timestamp: '2024-01-15T10:00:00Z',
        source: 'report', // citizen-submitted report (vs 'sensor'/'prediction'/'alert')
      }
      
      expect(marker.source).toBe('report')
      //Union check: source must be one of the four allowed strings
      expect(['report', 'sensor', 'prediction', 'alert']).toContain(marker.source)
    })
  })
})
