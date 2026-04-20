/**
 * Tests for the locationUtils helper functions: haversineKm (great-circle
 * distance), getDeviceLocation (browser GPS wrapper), reverseGeocode (lat/lng
 * -> human address), and forwardGeocode (text query -> lat/lng).
 *
 * Glossary:
 *   describe()              = groups related tests under a labelled block
 *   test()                  = a single scenario with one expected outcome
 *   expect()                = starts an assertion chain
 *   toBeCloseTo(n, digits)  = asserts a floating-point number equals n within
 *                             'digits' decimal places (avoids float precision issues)
 *   toBeGreaterThan()       = n > threshold
 *   toBeLessThan()          = n < threshold
 *   vi.fn()                 = creates a mock (fake) function whose calls are tracked
 *   vi.spyOn()              = wraps an existing function to observe/override calls
 *   vi.resetAllMocks()      = clears call history between tests
 *   vi.restoreAllMocks()    = fully removes spies, restoring original functions
 *   mockImplementation()    = defines what the mock does when called
 *   mockResolvedValueOnce() = makes a mock return a resolved Promise for one call
 *   mockRejectedValueOnce() = makes a mock return a rejected Promise for one call
 *   Object.defineProperty() = injects a fake navigator.geolocation into jsdom
 *   configurable: true      = required so the property can be redefined in future tests
 *   haversineKm()           = great-circle distance formula using the Haversine equation;
 *                             accounts for Earth's spherical shape; result in kilometres
 *   Haversine formula       = a = sin²(Δlat/2) + cos(lat1)-cos(lat2)-sin²(Δlng/2)
 *                             c = 2-atan2(√a, √(1−a));  d = R-c  where R=6371 km
 *   prime meridian          = longitude 0° running through Greenwich, London
 *   antipodal points        = two points on exactly opposite sides of the Earth;
 *                             max haversine distance ≈ half Earth's circumference ≈ 20,015 km
 *   Coordinates             = TypeScript type { lat: number; lng: number }
 *   getDeviceLocation()     = wraps navigator.geolocation.getCurrentPosition() in a Promise
 *   navigator.geolocation   = browser API for accessing device GPS; not available in jsdom
 *   enableHighAccuracy      = geolocation option: true = use GPS chip (more battery, more precise)
 *   maximumAge              = geolocation option: milliseconds a cached position is still valid
 *   reverseGeocode()        = sends lat/lng to Nominatim (OpenStreetMap geocoding service) and
 *                             returns a human-readable address
 *   Nominatim               = free, open-source geocoding service by OpenStreetMap
 *   display_name            = Nominatim's full comma-separated address string
 *   forwardGeocode()        = sends a text query to Nominatim and returns the best matching
 *                             lat/lng, label, and whether the result covers an area (isArea)
 *   isArea                  = true if the result is a city/country/region (has a bounding box
 *                             larger than a point); false if it is a specific address/building
 *   boundingbox             = [south, north, west, east] decimal-degree extents of a result area
 *   global.fetch            = the browser Fetch API; spied on here to avoid real HTTP requests
 *
 * How it connects:
 * - Run by the test runner (Vitest) with `vitest run` or `vitest watch`
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { haversineKm, getDeviceLocation, reverseGeocode, forwardGeocode } from '../utils/locationUtils'
import type { Coordinates } from '../utils/locationUtils'

//haversineKm -- great-circle distance between two lat/lng points
describe('haversineKm', () => {
  test('calculates zero distance for same point', () => {
    //Passing the same point twice should return exactly 0 (no rounding error expected)
    const point: Coordinates = { lat: 51.5074, lng: -0.1278 } // London
    expect(haversineKm(point, point)).toBe(0)
  })

  test('calculates distance between London and Paris', () => {
    const london: Coordinates = { lat: 51.5074, lng: -0.1278 }
    const paris: Coordinates = { lat: 48.8566, lng: 2.3522 }
    const distance = haversineKm(london, paris)
    //Verified against maps: London-Paris ≈ 343 km as-the-crow-flies
    expect(distance).toBeGreaterThan(340)
    expect(distance).toBeLessThan(350)
  })

  test('calculates distance between New York and Los Angeles', () => {
    const nyc: Coordinates = { lat: 40.7128, lng: -74.0060 }
    const la: Coordinates = { lat: 34.0522, lng: -118.2437 }
    const distance = haversineKm(nyc, la)
    //Verified against maps: NYC-LA ≈ 3,940 km as-the-crow-flies
    expect(distance).toBeGreaterThan(3900)
    expect(distance).toBeLessThan(4000)
  })

  test('calculates distance across prime meridian', () => {
    //Tests that lng sign changes (negative to positive) are handled correctly
    const pointA: Coordinates = { lat: 51.0, lng: -5.0 } // 5° west of Greenwich
    const pointB: Coordinates = { lat: 51.0, lng: 5.0 }  // 5° east of Greenwich
    const distance = haversineKm(pointA, pointB)
    //10° of longitude at 51° latitude ≈ 696 km
    expect(distance).toBeGreaterThan(650)
    expect(distance).toBeLessThan(750)
  })

  test('calculates distance across equator', () => {
    //Tests lat sign changes (north to south hemisphere)
    const north: Coordinates = { lat: 5.0, lng: 0.0 }
    const south: Coordinates = { lat: -5.0, lng: 0.0 }
    const distance = haversineKm(north, south)
    //10° of latitude at the equator ≈ 1,111 km (each degree ≈ 111.1 km)
    expect(distance).toBeGreaterThan(1100)
    expect(distance).toBeLessThan(1120)
  })

  test('is symmetric - order of points should not matter', () => {
    //Commutative property: distance(A, B) must equal distance(B, A)
    const london: Coordinates = { lat: 51.5074, lng: -0.1278 }
    const paris: Coordinates = { lat: 48.8566, lng: 2.3522 }
    //toBeCloseTo with 6 decimal places tolerates tiny floating-point rounding
    expect(haversineKm(london, paris)).toBeCloseTo(haversineKm(paris, london), 6)
  })

  test('handles extreme coordinates (near poles)', () => {
    //Make sure trig calculations don't break for very high latitudes
    const northPole: Coordinates = { lat: 89.0, lng: 0.0 }
    const alaska: Coordinates = { lat: 65.0, lng: -170.0 }
    const distance = haversineKm(northPole, alaska)
    expect(distance).toBeGreaterThan(2500)
    expect(distance).toBeLessThan(3500)
  })

  test('handles antipodal points (opposite sides of Earth)', () => {
    //The maximum possible haversine result is half Earth's circumference ≈ 20,015 km
    const pointA: Coordinates = { lat: 0.0, lng: 0.0 }
    const pointB: Coordinates = { lat: 0.0, lng: 180.0 } // exact antipode on equator
    const distance = haversineKm(pointA, pointB)
 //Half circumference of Earth (radius 6,371 km -> circumference 40,030 km -> half 20,015 km)
    expect(distance).toBeGreaterThan(19500)
    expect(distance).toBeLessThan(20500)
  })

  test('handles negative coordinates', () => {
    //Both points in southern hemisphere, eastern longitudes (Sydney to Auckland)
    const sydney: Coordinates = { lat: -33.8688, lng: 151.2093 }
    const auckland: Coordinates = { lat: -36.8485, lng: 174.7633 }
    const distance = haversineKm(sydney, auckland)
    //Verified: Sydney-Auckland ≈ 2,155 km
    expect(distance).toBeGreaterThan(2100)
    expect(distance).toBeLessThan(2200)
  })

  test('short distance calculation is accurate', () => {
    //Validate precision at sub-kilometre scale (important for local incident mapping)
    const pointA: Coordinates = { lat: 51.5074, lng: -0.1278 }
    const pointB: Coordinates = { lat: 51.5164, lng: -0.1278 } // ~1 km north (0.009° lat ≈ 1 km)
    const distance = haversineKm(pointA, pointB)
    expect(distance).toBeGreaterThan(0.9)
    expect(distance).toBeLessThan(1.1)
  })
})

//getDeviceLocation -- wraps the browser Geolocation API in a Promise
describe('getDeviceLocation', () => {
  //Fake geolocation object with the three standard methods
  const mockGeolocation = {
    getCurrentPosition: vi.fn(),
    watchPosition: vi.fn(),
    clearWatch: vi.fn(),
  }

  beforeEach(() => {
    vi.resetAllMocks() // clear call history before each test
    //Inject our fake geolocation into the jsdom navigator
    Object.defineProperty(navigator, 'geolocation', {
      value: mockGeolocation,
      writable: true,
      configurable: true, // configurable so the next test can redefine it
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('resolves with coordinates on success', async () => {
    //Simulate the browser calling our success callback with a position object
    mockGeolocation.getCurrentPosition.mockImplementation((success) => {
      success({
        coords: {
          latitude: 51.5074,
          longitude: -0.1278,
        },
      })
    })

    const result = await getDeviceLocation()
 //The function should transform {latitude, longitude} -> {lat, lng}
    expect(result).toEqual({ lat: 51.5074, lng: -0.1278 })
  })

  test('rejects with error on geolocation failure', async () => {
    //Simulate the browser calling the error callback (e.g. user denied permission)
    const error = { code: 1, message: 'User denied geolocation' }
    //code 1 = PERMISSION_DENIED; 2 = POSITION_UNAVAILABLE; 3 = TIMEOUT
    mockGeolocation.getCurrentPosition.mockImplementation((success, failure) => {
      failure(error) // trigger the rejection path
    })

    await expect(getDeviceLocation()).rejects.toEqual(error)
  })

  test('passes options to getCurrentPosition', async () => {
    //Callers can override defaults (e.g. disable high-accuracy for battery saving)
    mockGeolocation.getCurrentPosition.mockImplementation((success) => {
      success({ coords: { latitude: 0, longitude: 0 } })
    })

    const customOptions = { enableHighAccuracy: false, timeout: 5000, maximumAge: 0 }
    await getDeviceLocation(customOptions)

    //Verify the custom options were forwarded to the native API call
    expect(mockGeolocation.getCurrentPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      customOptions
    )
  })

  test('uses default options when none provided', async () => {
    //When no options are passed, the hook should use safe production defaults:
    //enableHighAccuracy:true = use GPS chip for best accuracy
    //timeout:10000           = give up after 10 seconds
    //maximumAge:180000       = accept a cached position up to 3 minutes old
    mockGeolocation.getCurrentPosition.mockImplementation((success) => {
      success({ coords: { latitude: 0, longitude: 0 } })
    })

    await getDeviceLocation()

    expect(mockGeolocation.getCurrentPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 180000 }
    )
  })

  test('rejects when geolocation object has no getCurrentPosition', async () => {
    //Edge case: navigator.geolocation exists but getCurrentPosition is missing
    // (some embedded browsers or restricted environments); must reject gracefully
    Object.defineProperty(navigator, 'geolocation', {
      value: {},  // object present but getCurrentPosition is undefined
      writable: true,
      configurable: true,
    })

    await expect(getDeviceLocation()).rejects.toBeDefined()
  })
})

//reverseGeocode -- converts lat/lng back to a human-readable address string
//Uses OpenStreetMap's Nominatim API (free, no API key required)
describe('reverseGeocode', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('returns location details on successful geocode', async () => {
    //Simulate a successful Nominatim JSON response for London coordinates
    const mockResponse = {
      display_name: 'London, Greater London, England, UK',
      address: {
        city: 'London',
        state: 'Greater London',  // 'state' in Nominatim maps to our 'region' field
        country: 'United Kingdom',
        country_code: 'gb',       // ISO 3166-1 alpha-2 lowercase; we uppercase it
      },
    }

    //Replace the real fetch with a mock that returns our Nominatim-shaped response
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    } as Response)

    const coords: Coordinates = { lat: 51.5074, lng: -0.1278 }
    const result = await reverseGeocode(coords)

    expect(result.displayName).toBe('London')          // city name used as short display name
    expect(result.city).toBe('London')
    expect(result.region).toBe('Greater London')       // state/county/region field
    expect(result.country).toBe('United Kingdom')
    expect(result.countryCode).toBe('GB')              // uppercased ISO code
  })

  test('returns coordinates string on fetch failure', async () => {
    //When Nominatim returns ok:false (4xx/5xx), fall back to "lat, lng" string
    //so the user always sees something meaningful rather than a blank field
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
    } as Response)

    const coords: Coordinates = { lat: 51.5074, lng: -0.1278 }
    const result = await reverseGeocode(coords)

    expect(result.displayName).toBe('51.5074, -0.1278') // graceful degradation
  })

  test('returns coordinates string on network error', async () => {
    //Network errors (offline/DNS failure) must also degrade gracefully
    vi.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('Network error'))

    const coords: Coordinates = { lat: 51.5074, lng: -0.1278 }
    const result = await reverseGeocode(coords)

    expect(result.displayName).toBe('51.5074, -0.1278')
  })

  test('handles town instead of city', async () => {
    //Nominatim uses 'town' for smaller settlements; reverseGeocode must check
    // 'city' first then fall back to 'town' to get a displayName
    const mockResponse = {
      display_name: 'Small Town, County, Country',
      address: {
        town: 'Small Town',   // note: 'town', not 'city'
        county: 'The County', // 'county' maps to 'region'
        country: 'The Country',
        country_code: 'xx',
      },
    }

    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    } as Response)

    const coords: Coordinates = { lat: 50.0, lng: -1.0 }
    const result = await reverseGeocode(coords)

    expect(result.displayName).toBe('Small Town') // falls back to 'town'
    expect(result.region).toBe('The County')
  })

  test('handles village/hamlet addresses', async () => {
    //Rural addresses may only have 'village' or 'hamlet' -- must still work
    const mockResponse = {
      display_name: 'Village Name, Region',
      address: {
        village: 'Village Name', // smallest settlement type in Nominatim
        region: 'The Region',
        country: 'Country',
      },
    }

    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    } as Response)

    const coords: Coordinates = { lat: 50.0, lng: -1.0 }
    const result = await reverseGeocode(coords)

    expect(result.displayName).toBe('Village Name')
    expect(result.region).toBe('The Region')
  })
})

//forwardGeocode -- converts a text query into lat/lng coordinates
//Returns the best Nominatim match, or null if nothing found / query is blank
describe('forwardGeocode', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('returns location on successful search', async () => {
    //Nominatim returns an array of results; we take the first (best) one
    //lat/lon are strings in the Nominatim response; forwardGeocode must parse them to numbers
    const mockResponse = [{
      lat: '51.5073219',
      lon: '-0.1276474',      // note: Nominatim uses 'lon' not 'lng'
      display_name: 'London, Greater London, England, UK',
      class: 'place',          // feature class (place = populated settlement)
      type: 'city',            // feature type within the class
      boundingbox: ['51.2867602', '51.6918741', '-0.5103751', '0.3340155'],
    }]

    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    } as Response)

    const result = await forwardGeocode('London')

    expect(result).not.toBeNull()
    expect(result!.lat).toBeCloseTo(51.5073219, 5)   // parsed from string to number
    expect(result!.lng).toBeCloseTo(-0.1276474, 5)
    expect(result!.label).toContain('London')
 expect(result!.isArea).toBe(true) // city has a bounding box -> it's an area, not a point
  })

  test('returns null for empty query', async () => {
    //Guard against empty string -- don't waste a network request
    const result = await forwardGeocode('')
    expect(result).toBeNull()
  })

  test('returns null for whitespace-only query', async () => {
    //Guard against whitespace-only input (e.g. user pressed spacebar then searched)
    const result = await forwardGeocode('   ')
    expect(result).toBeNull()
  })

  test('returns null when no results found', async () => {
    //Nominatim returns an empty array when no match exists -- must return null gracefully
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([]), // empty results array
    } as Response)

    const result = await forwardGeocode('xyznonexistent123')
    expect(result).toBeNull()
  })

  test('returns null on fetch failure', async () => {
    //HTTP error (4xx/5xx) -- return null rather than throw
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
    } as Response)

    const result = await forwardGeocode('London')
    expect(result).toBeNull()
  })

  test('returns null on network error', async () => {
    //Complete network failure (offline/DNS) -- return null rather than crash
    vi.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('Network error'))

    const result = await forwardGeocode('London')
    expect(result).toBeNull()
  })

  test('detects country as area type', async () => {
    //class:'boundary' type:'administrative' = a country / region in Nominatim;
    //these should always be flagged isArea=true because they cover a large geographic extent
    const mockResponse = [{
      lat: '55.378051',
      lon: '-3.435973',
      display_name: 'United Kingdom',
      class: 'boundary',
      type: 'administrative',
      boundingbox: ['49.674', '61.061', '-14.015517', '2.0919117'], // UK bounding box
    }]

    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    } as Response)

    const result = await forwardGeocode('United Kingdom')
    expect(result!.isArea).toBe(true)
  })

  test('detects specific address as non-area', async () => {
    //class:'building' type:'office' = a specific address; isArea should be false
    //because the user wants to pin-drop on this exact location, not zoom to a region
    const mockResponse = [{
      lat: '51.5007292',
      lon: '-0.1246254',
      display_name: '10 Downing Street, Westminster, London',
      class: 'building',
      type: 'office',
      boundingbox: ['51.5006', '51.5008', '-0.1247', '-0.1245'], // tiny bbox for a single building
    }]

    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    } as Response)

    const result = await forwardGeocode('10 Downing Street')
    expect(result!.isArea).toBe(false)
  })

  test('includes bounding box when available', async () => {
    //boundingbox is used by the map to auto-zoom to fit the result area;
    //it's an array of four numbers [south, north, west, east] in decimal degrees
    const mockResponse = [{
      lat: '51.5073',
      lon: '-0.1276',
      display_name: 'London, UK',
      class: 'place',
      type: 'city',
      boundingbox: ['51.2867', '51.6918', '-0.5103', '0.3340'], // parsed from strings to numbers
    }]

    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    } as Response)

    const result = await forwardGeocode('London')
    expect(result!.boundingbox).toBeDefined()
    expect(result!.boundingbox).toHaveLength(4)          // [south, north, west, east]
    expect(result!.boundingbox![0]).toBeCloseTo(51.2867, 2) // southern extent of London
  })
})
