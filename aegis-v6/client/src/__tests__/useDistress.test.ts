/**
 * Use distress test suite (automated tests for this feature).
 *
 * Glossary:
 *   navigator.geolocation     = browser API for requesting GPS coordinates.
 *   vi.useFakeTimers()        = replaces setInterval/setTimeout and Date.now()
 *                               with a fake clock we advance manually, so
 *                               5-second countdowns can be tested without
 *                               actually waiting 5 seconds.
 *   vi.advanceTimersByTime()  = moves the fake clock forward N milliseconds.
 *   Object.defineProperty()   = injects a mock navigator.geolocation into the
 *                               test environment (Node.js has no real GPS API).
 *   mockImplementation()      = configures what a vi.fn() mock returns/does
 *                               when it is called.
 *   configurable: true        = allows the property to be redefined between
 *                               tests (needed to reset mocks cleanly).
 *
 * - Run by the test runner (Vitest or Jest) */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDistress } from '../hooks/useDistress'

//Mock geolocation
const mockGeolocation = {
  getCurrentPosition: vi.fn(),
  watchPosition: vi.fn(),
  clearWatch: vi.fn(),
}

//Mock socket
const createMockSocket = () => ({
  emit: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
})

describe('useDistress', () => {
  let mockSocket: ReturnType<typeof createMockSocket>
  
  beforeEach(() => {
    //Fake timers allow tests to control the 5-second countdown without
    //real wait time.  Advance with vi.advanceTimersByTime(1000) etc.
    vi.useFakeTimers()
    mockSocket = createMockSocket()
    
    //Inject mock GPS into navigator.geolocation.
    //configurable: true lets us redefine the property in subsequent tests.
    Object.defineProperty(navigator, 'geolocation', {
      value: mockGeolocation,
      writable: true,
      configurable: true,
    })
    
    //Reset all mocks
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('returns correct initial state', () => {
    const { result } = renderHook(() => 
      useDistress({
        socket: mockSocket,
        citizenId: 'citizen-1',
        citizenName: 'Test User',
      })
    )

    //Hook spreads state into return value
    expect(result.current.isActive).toBe(false)
    expect(result.current.status).toBe('idle')
    expect(result.current.distressId).toBeNull()
    expect(result.current.countdownSeconds).toBe(0)
    expect(result.current.latitude).toBeNull()
    expect(result.current.longitude).toBeNull()
    expect(result.current.error).toBeNull()
  })

  test('returns control functions', () => {
    const { result } = renderHook(() => 
      useDistress({
        socket: mockSocket,
        citizenId: 'citizen-1',
        citizenName: 'Test User',
      })
    )

    expect(typeof result.current.startCountdown).toBe('function')
    expect(typeof result.current.cancelCountdown).toBe('function')
    expect(typeof result.current.cancelSOS).toBe('function')
    expect(typeof result.current.retryActivation).toBe('function')
  })

  test('startCountdown initiates 5-second countdown', () => {
    //Mock successful GPS position
    mockGeolocation.getCurrentPosition.mockImplementation((success) => {
      success({
        coords: {
          latitude: 51.5074,
          longitude: -0.1278,
          accuracy: 10,
        },
      })
    })

    const { result } = renderHook(() => 
      useDistress({
        socket: mockSocket,
        citizenId: 'citizen-1',
        citizenName: 'Test User',
      })
    )

    act(() => {
      result.current.startCountdown()
    })

    expect(result.current.status).toBe('countdown')
    expect(result.current.countdownSeconds).toBe(5)
    expect(mockGeolocation.getCurrentPosition).toHaveBeenCalled()
  })

  test('countdown decrements every second', () => {
    mockGeolocation.getCurrentPosition.mockImplementation((success) => {
      success({
        coords: { latitude: 51.5074, longitude: -0.1278, accuracy: 10 },
      })
    })

    const { result } = renderHook(() => 
      useDistress({
        socket: mockSocket,
        citizenId: 'citizen-1',
        citizenName: 'Test User',
      })
    )

    act(() => {
      result.current.startCountdown()
    })

    expect(result.current.countdownSeconds).toBe(5)

    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(result.current.countdownSeconds).toBe(4)

    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(result.current.countdownSeconds).toBe(3)
  })

  test('cancelCountdown stops countdown and resets state', () => {
    mockGeolocation.getCurrentPosition.mockImplementation((success) => {
      success({
        coords: { latitude: 51.5074, longitude: -0.1278, accuracy: 10 },
      })
    })

    const { result } = renderHook(() => 
      useDistress({
        socket: mockSocket,
        citizenId: 'citizen-1',
        citizenName: 'Test User',
      })
    )

    act(() => {
      result.current.startCountdown()
    })

    expect(result.current.status).toBe('countdown')

    act(() => {
      vi.advanceTimersByTime(2000)
    })

    act(() => {
      result.current.cancelCountdown()
    })

    expect(result.current.status).toBe('idle')
    expect(result.current.countdownSeconds).toBe(0)
  })

  test('SOS activates after countdown completes', () => {
    mockGeolocation.getCurrentPosition.mockImplementation((success) => {
      success({
        coords: { latitude: 51.5074, longitude: -0.1278, accuracy: 10 },
      })
    })
    
    //Mock successful activation
    mockSocket.emit.mockImplementation((event, data, callback) => {
      if (event === 'distress:activate' && callback) {
        callback({
          success: true,
          distress: { id: 'distress-123' },
        })
      }
    })

    mockGeolocation.watchPosition.mockReturnValue(1)

    const onActivated = vi.fn()
    const { result } = renderHook(() => 
      useDistress({
        socket: mockSocket,
        citizenId: 'citizen-1',
        citizenName: 'Test User',
        onActivated,
      })
    )

    act(() => {
      result.current.startCountdown()
    })

    //Advance through entire countdown
    act(() => {
      vi.advanceTimersByTime(5000)
    })

    expect(mockSocket.emit).toHaveBeenCalledWith(
      'distress:activate',
      expect.objectContaining({
        latitude: 51.5074,
        longitude: -0.1278,
      }),
      expect.any(Function)
    )

    expect(result.current.isActive).toBe(true)
    expect(result.current.status).toBe('active')
    expect(result.current.distressId).toBe('distress-123')
    expect(onActivated).toHaveBeenCalledWith('distress-123')
  })

  test('handles GPS error gracefully', () => {
    mockGeolocation.getCurrentPosition.mockImplementation((_, error) => {
      error({ code: 1, message: 'GPS denied' })
    })

    const { result } = renderHook(() => 
      useDistress({
        socket: mockSocket,
        citizenId: 'citizen-1',
        citizenName: 'Test User',
      })
    )

    act(() => {
      result.current.startCountdown()
    })

    expect(result.current.error).toBe('GPS unavailable. Please enable location services.')
  })

  test('handles activation failure', () => {
    mockGeolocation.getCurrentPosition.mockImplementation((success) => {
      success({
        coords: { latitude: 51.5074, longitude: -0.1278, accuracy: 10 },
      })
    })

    mockSocket.emit.mockImplementation((event, data, callback) => {
      if (event === 'distress:activate' && callback) {
        callback({
          success: false,
          error: 'Server error',
        })
      }
    })

    const { result } = renderHook(() => 
      useDistress({
        socket: mockSocket,
        citizenId: 'citizen-1',
        citizenName: 'Test User',
      })
    )

    act(() => {
      result.current.startCountdown()
    })

    act(() => {
      vi.advanceTimersByTime(5000)
    })

    expect(result.current.error).toBe('Server error')
    expect(result.current.status).toBe('idle')
  })

  test('handles no socket connection', () => {
    mockGeolocation.getCurrentPosition.mockImplementation((success) => {
      success({
        coords: { latitude: 51.5074, longitude: -0.1278, accuracy: 10 },
      })
    })

    const { result } = renderHook(() => 
      useDistress({
        socket: null,
        citizenId: 'citizen-1',
        citizenName: 'Test User',
      })
    )

    act(() => {
      result.current.startCountdown()
    })

    act(() => {
      vi.advanceTimersByTime(5000)
    })

    expect(result.current.error).toBe('No connection')
    expect(result.current.status).toBe('idle')
  })

  test('cancelSOS emits cancel event', () => {
    mockGeolocation.getCurrentPosition.mockImplementation((success) => {
      success({
        coords: { latitude: 51.5074, longitude: -0.1278, accuracy: 10 },
      })
    })
    mockGeolocation.watchPosition.mockReturnValue(1)

    mockSocket.emit.mockImplementation((event, data, callback) => {
      if (event === 'distress:activate' && callback) {
        callback({ success: true, distress: { id: 'distress-123' } })
      }
      if (event === 'distress:cancel' && callback) {
        callback({ success: true })
      }
    })

    const { result } = renderHook(() => 
      useDistress({
        socket: mockSocket,
        citizenId: 'citizen-1',
        citizenName: 'Test User',
      })
    )

    //Activate SOS
    act(() => {
      result.current.startCountdown()
    })
    act(() => {
      vi.advanceTimersByTime(5000)
    })

    expect(result.current.isActive).toBe(true)

    //Cancel SOS
    act(() => {
      result.current.cancelSOS()
    })

    expect(mockSocket.emit).toHaveBeenCalledWith(
      'distress:cancel',
      { distressId: 'distress-123' },
      expect.any(Function)
    )

    expect(result.current.status).toBe('cancelled')
    expect(result.current.isActive).toBe(false)
  })

  test('registers socket listeners for acknowledgement', () => {
    renderHook(() => 
      useDistress({
        socket: mockSocket,
        citizenId: 'citizen-1',
        citizenName: 'Test User',
      })
    )

    expect(mockSocket.on).toHaveBeenCalledWith('distress:acknowledged', expect.any(Function))
    expect(mockSocket.on).toHaveBeenCalledWith('distress:resolved', expect.any(Function))
  })

  test('retryActivation only works after error in idle state', () => {
    const { result } = renderHook(() => 
      useDistress({
        socket: mockSocket,
        citizenId: 'citizen-1',
        citizenName: 'Test User',
      })
    )

    //Should not do anything when not in error state
    act(() => {
      result.current.retryActivation()
    })

    expect(result.current.status).toBe('idle')
  })

  test('cleans up socket listeners on unmount', () => {
    const { unmount } = renderHook(() => 
      useDistress({
        socket: mockSocket,
        citizenId: 'citizen-1',
        citizenName: 'Test User',
      })
    )

    unmount()

    expect(mockSocket.off).toHaveBeenCalledWith('distress:acknowledged', expect.any(Function))
    expect(mockSocket.off).toHaveBeenCalledWith('distress:resolved', expect.any(Function))
  })
})

describe('useDistress GPS tracking', () => {
  let mockSocket: ReturnType<typeof createMockSocket>

  beforeEach(() => {
    vi.useFakeTimers()
    mockSocket = createMockSocket()
    Object.defineProperty(navigator, 'geolocation', {
      value: mockGeolocation,
      writable: true,
      configurable: true,
    })
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('starts GPS tracking after activation', () => {
    mockGeolocation.getCurrentPosition.mockImplementation((success) => {
      success({
        coords: { latitude: 51.5074, longitude: -0.1278, accuracy: 10 },
      })
    })
    mockGeolocation.watchPosition.mockReturnValue(1)

    mockSocket.emit.mockImplementation((event, data, callback) => {
      if (event === 'distress:activate' && callback) {
        callback({ success: true, distress: { id: 'distress-123' } })
      }
    })

    const { result } = renderHook(() => 
      useDistress({
        socket: mockSocket,
        citizenId: 'citizen-1',
        citizenName: 'Test User',
      })
    )

    act(() => {
      result.current.startCountdown()
    })
    act(() => {
      vi.advanceTimersByTime(5000)
    })

    expect(mockGeolocation.watchPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      expect.objectContaining({
        enableHighAccuracy: true,
      })
    )
  })

  test('emits location updates from GPS watch', () => {
    let watchCallback: ((pos: GeolocationPosition) => void) | null = null
    mockGeolocation.getCurrentPosition.mockImplementation((success) => {
      success({
        coords: { latitude: 51.5074, longitude: -0.1278, accuracy: 10 },
      })
    })
    mockGeolocation.watchPosition.mockImplementation((success) => {
      watchCallback = success
      return 1
    })

    mockSocket.emit.mockImplementation((event, data, callback) => {
      if (event === 'distress:activate' && callback) {
        callback({ success: true, distress: { id: 'distress-123' } })
      }
    })

    const { result } = renderHook(() => 
      useDistress({
        socket: mockSocket,
        citizenId: 'citizen-1',
        citizenName: 'Test User',
      })
    )

    act(() => {
      result.current.startCountdown()
    })
    act(() => {
      vi.advanceTimersByTime(5000)
    })

    //Simulate location update
    act(() => {
      const mockCoords = {
        latitude: 51.5080,
        longitude: -0.1280,
        accuracy: 5,
        heading: 90,
        speed: 2,
        altitude: null,
        altitudeAccuracy: null,
        toJSON() { return this }
      }
      watchCallback?.({
        coords: mockCoords,
        timestamp: Date.now(),
        toJSON() { return { coords: mockCoords, timestamp: this.timestamp } }
      } as GeolocationPosition)
    })

    expect(mockSocket.emit).toHaveBeenCalledWith(
      'distress:location_update',
      expect.objectContaining({
        distressId: 'distress-123',
        latitude: 51.5080,
        longitude: -0.1280,
        accuracy: 5,
        heading: 90,
        speed: 2,
      })
    )
  })
})
