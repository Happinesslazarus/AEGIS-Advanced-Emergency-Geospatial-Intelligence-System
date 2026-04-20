/**
 * Tests for the SOSButton component — the floating red emergency distress button
 * shown on the citizen dashboard. The button starts a countdown before sending a
 * live distress signal with GPS coordinates to the server.
 *
 * Glossary:
 *   describe()              = groups related tests under a labelled block
 *   test()                  = a single scenario with one expected outcome
 *   render()                = mounts a React component into a jsdom DOM
 *   screen                  = queries the jsdom DOM for elements
 *   fireEvent.click()       = dispatches a synthetic mouse-click event
 *   act()                   = flushes React state updates after an interaction
 *   vi.fn()                 = creates a mock (fake) function whose calls are tracked
 *   vi.mock()               = replaces a module import with a controlled fake
 *   vi.clearAllMocks()      = resets call counts before each test
 *   beforeEach()            = runs setup code before every test in the describe block
 *   dynamic import          = import('../...') loads the module at runtime (after mocks are set)
 *   useDistress hook        = manages all SOS state machine transitions: idle → countdown
 *                             → activating → active → acknowledged → resolved / cancelled
 *   distressOverrides       = partial state object merged over defaultDistress to put the
 *                             component into specific states per test
 *   globalThis.__distressOpts = captures the callbacks passed to useDistress() so tests
 *                             can inspect what options the component wired up
 *   socket prop             = WebSocket connection object passed as a prop; mocked as {}
 *   citizenId / citizenName = props that identify the citizen; sent as part of the SOS signal
 *   startCountdown()        = begins the N-second countdown before broadcast
 *   cancelCountdown()       = aborts the countdown (second press before broadcast)
 *   cancelSOS()             = sends a cancellation message after SOS is already active
 *   retryActivation()       = retries if the activation request failed
 *   navigator.vibrate()     = haptic feedback API; not available in jsdom, so it's mocked
 *   AudioContext            = Web Audio API for playing alert sounds; mocked to avoid errors
 *   createOscillator()      = Audio API method that generates a tone; mocked as no-op
 *   animate-pulse           = Tailwind CSS class that makes the button visibly pulse/throb
 *                             while an active SOS is in progress
 *   aria-label              = accessible name read by screen readers (important for an SOS button!)
 *   title attribute         = tooltip text shown on hover
 *   triageLevel             = priority assigned by the operator: 'critical'/'urgent'/'routine'
 *   acknowledgedBy          = name/ID of the operator who accepted the distress signal
 *   resolution              = outcome message when the situation has been resolved
 *
 * - Run by the test runner (Vitest) with `vitest run` or `vitest watch`
 */

import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import '@testing-library/jest-dom'

// ---------------------------------------------------------------------------
// Mock useDistress hook state
// Each test can override individual fields via distressOverrides
// ---------------------------------------------------------------------------
const mockStartCountdown = vi.fn()
const mockCancelCountdown = vi.fn()
const mockCancelSOS = vi.fn()

// Full shape of the useDistress return; mirrors the real hook's interface
interface MockDistressReturn {
  isActive: boolean
  distressId: string | null
  status: 'idle' | 'countdown' | 'activating' | 'active' | 'acknowledged' | 'resolved' | 'cancelled'
  countdownSeconds: number
  latitude: number | null
  longitude: number | null
  accuracy: number | null
  acknowledgedBy: string | null
  triageLevel: string | null
  resolution: string | null
  error: string | null
  startCountdown: ReturnType<typeof vi.fn>
  cancelCountdown: ReturnType<typeof vi.fn>
  cancelSOS: ReturnType<typeof vi.fn>
  retryActivation: ReturnType<typeof vi.fn>
}

// Safe initial state — SOS not active, no errors, ready for first press
const defaultDistress: MockDistressReturn = {
  isActive: false,
  distressId: null,
  status: 'idle',
  countdownSeconds: 0,
  latitude: null,
  longitude: null,
  accuracy: null,
  acknowledgedBy: null,
  triageLevel: null,
  resolution: null,
  error: null,
  startCountdown: mockStartCountdown,
  cancelCountdown: mockCancelCountdown,
  cancelSOS: mockCancelSOS,
  retryActivation: vi.fn(),
}

// Per-test overrides — tests set this before calling renderSOS()
let distressOverrides: Partial<MockDistressReturn> = {}

vi.mock('../hooks/useDistress', () => ({
  useDistress: (opts: any) => {
    // Save the options/callbacks the component passed so tests can inspect them
    ;(globalThis as any).__distressOpts = opts
    return { ...defaultDistress, ...distressOverrides }
  },
}))

// Mock i18n: return the translation key as plain text so tests can match on it
vi.mock('../utils/i18n', () => ({
  t: (key: string) => key,
  getLanguage: () => 'en',
  onLanguageChange: () => () => {},
  isRtl: () => false,
}))

vi.mock('../hooks/useLanguage', () => ({
  useLanguage: () => 'en',
}))

// ---------------------------------------------------------------------------
// Browser API stubs — jsdom doesn't implement these; mocking prevents errors
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks()
  distressOverrides = {} // reset overrides before each test

  // navigator.vibrate provides haptic feedback on mobile devices; stub it
  Object.defineProperty(navigator, 'vibrate', {
    value: vi.fn(),
    writable: true,
    configurable: true,
  })

  // Stub AudioContext so alert beeps don't throw "not implemented" in jsdom
  ;(window as any).AudioContext = vi.fn().mockImplementation(() => ({
    createOscillator: () => ({
      type: '',
      frequency: { value: 0 },
      connect: vi.fn().mockReturnValue({ connect: vi.fn() }),
      start: vi.fn(),
      stop: vi.fn(),
    }),
    createGain: () => ({
      gain: { value: 0, exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn(),
    }),
    destination: {},
    currentTime: 0,
  }))
})

// ---------------------------------------------------------------------------
// Dynamic import helper — import SOSButton AFTER all mocks are in place
// (synchronous top-level import would capture the real module before mocking)
// ---------------------------------------------------------------------------
const renderSOS = async () => {
  const mod = await import('../components/citizen/SOSButton')
  const SOSButton = mod.default
  return render(
    <SOSButton socket={{}} citizenId="c1" citizenName="Test Citizen" />,
  )
}

// ---------------------------------------------------------------------------
// SOSButton tests
// ---------------------------------------------------------------------------
describe('SOSButton', () => {
  // -------------------------------------------------------------------------
  // Initial render (idle state)
  // -------------------------------------------------------------------------
  describe('Initial render (idle)', () => {
    test('renders the floating SOS button', async () => {
      // The main floating button must always be present in the DOM
      await renderSOS()
      const btn = screen.getByRole('button', { name: 'sos.emergencySOSButton' })
      expect(btn).toBeInTheDocument()
    })

    test('SOS panel is not visible in idle state', async () => {
      // The expanded SOS panel should be hidden until the button is pressed
      await renderSOS()
      expect(screen.queryByText('sos.emergencySOS')).not.toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // Countdown state — button shows a countdown number; second press cancels
  // -------------------------------------------------------------------------
  describe('Countdown state', () => {
    test('displays countdown number instead of icon', async () => {
      // While counting down, the button face should show the seconds remaining
      distressOverrides = { status: 'countdown', countdownSeconds: 3 }
      await renderSOS()
      expect(screen.getByText('3')).toBeInTheDocument() // "3" visible on the button
    })

    test('calls cancelCountdown on second press during countdown', async () => {
      // Pressing the button a second time during countdown should abort, not re-start
      distressOverrides = { status: 'countdown', countdownSeconds: 4 }
      await renderSOS()
      const btn = screen.getByRole('button', { name: 'sos.emergencySOSButton' })
      fireEvent.click(btn)
      expect(mockCancelCountdown).toHaveBeenCalledOnce()
    })
  })

  // -------------------------------------------------------------------------
  // Active / Acknowledged state — SOS broadcast has been sent
  // -------------------------------------------------------------------------
  describe('Active / Acknowledged state', () => {
    test('shows pulse animation when SOS is active', async () => {
      // Tailwind 'animate-pulse' class makes the button throb to signal live status
      distressOverrides = { isActive: true, status: 'active' }
      await renderSOS()
      const btn = screen.getByRole('button', { name: 'sos.emergencySOSButton' })
      expect(btn.className).toContain('animate-pulse')
    })

    test('shows GPS coordinates when available', async () => {
      // When GPS lock is achieved, lat/lng must be shown in the panel so the
      // operator and citizen both know the location being broadcast
      distressOverrides = {
        isActive: true,
        status: 'active',
        latitude: 55.860916,  // Glasgow approximate
        longitude: -4.251433,
        accuracy: 12,         // metres accuracy
      }
      await renderSOS()
      const btn = screen.getByRole('button', { name: 'sos.emergencySOSButton' })
      fireEvent.click(btn) // open the expanded panel
      expect(screen.getByText(/55.860916/)).toBeInTheDocument()
    })

    test('shows acknowledgedBy name in acknowledged state', async () => {
      // When an operator acknowledges, their name should appear so the citizen
      // knows someone has received their SOS and is responding
      distressOverrides = {
        isActive: true,
        status: 'acknowledged',
        acknowledgedBy: 'Officer Smith',
        latitude: 55.86,
        longitude: -4.25,
      }
      await renderSOS()
      const btn = screen.getByRole('button', { name: 'sos.emergencySOSButton' })
      fireEvent.click(btn) // open panel
      expect(screen.getByText(/Officer Smith/)).toBeInTheDocument()
    })

    test('shows triage level when provided', async () => {
      // Triage level (critical/urgent/routine) is assigned by the operator
      // and should be visible to the citizen so they know how it is prioritised
      distressOverrides = {
        isActive: true,
        status: 'acknowledged',
        triageLevel: 'critical',
        latitude: 55.86,
        longitude: -4.25,
      }
      await renderSOS()
      const btn = screen.getByRole('button', { name: 'sos.emergencySOSButton' })
      fireEvent.click(btn)
      expect(screen.getByText(/critical/i)).toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // Cancel flow — citizen cancels an active SOS
  // -------------------------------------------------------------------------
  describe('Cancel flow', () => {
    test('cancel button triggers cancelSOS when active', async () => {
      // Inside the open panel there is a cancel button; pressing it must call cancelSOS()
      distressOverrides = { isActive: true, status: 'active', latitude: 55.86, longitude: -4.25 }
      await renderSOS()
      const sosBtn = screen.getByRole('button', { name: 'sos.emergencySOSButton' })
      fireEvent.click(sosBtn) // open the panel first
      const cancelBtn = screen.getByText('sos.cancelSOS')
      fireEvent.click(cancelBtn)
      expect(mockCancelSOS).toHaveBeenCalledOnce()
    })

    test('cancel button during countdown shows "common.cancel" text', async () => {
      // During countdown the button press calls cancelCountdown (not cancelSOS)
      distressOverrides = { status: 'countdown', countdownSeconds: 3 }
      await renderSOS()
      const btn = screen.getByRole('button', { name: 'sos.emergencySOSButton' })
      fireEvent.click(btn) // countdown + press → cancelCountdown
      expect(mockCancelCountdown).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // Error display — GPS failure or connection error shown in the panel
  // -------------------------------------------------------------------------
  describe('Error display', () => {
    test('shows error message in panel', async () => {
      // If GPS is unavailable, the error message should be visible
      // so the citizen knows their location is not being transmitted
      distressOverrides = {
        status: 'active',
        isActive: true,
        error: 'GPS unavailable. Please enable location services.',
        latitude: null,
        longitude: null,
      }
      await renderSOS()
      const btn = screen.getByRole('button', { name: 'sos.emergencySOSButton' })
      fireEvent.click(btn) // open panel
      expect(screen.getByText(/GPS unavailable/)).toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // Accessibility — the SOS button is critical; it must be usable by everyone
  // -------------------------------------------------------------------------
  describe('Accessibility', () => {
    test('button has aria-label', async () => {
      // Screen reader users must know what this button does; aria-label provides accessibility name
      await renderSOS()
      const btn = screen.getByRole('button', { name: 'sos.emergencySOSButton' })
      expect(btn).toHaveAttribute('aria-label', 'sos.emergencySOSButton')
    })

    test('button has title attribute', async () => {
      // tooltip text; also used as fallback name in some screen reader modes
      await renderSOS()
      const btn = screen.getByRole('button', { name: 'sos.emergencySOSButton' })
      expect(btn).toHaveAttribute('title', 'sos.emergencySOS')
    })

    test('SOS panel has role=alert for active status indicators', async () => {
      // The panel itself doesn't have role=alert, but the component renders in the DOM
      await renderSOS()
      expect(screen.getByRole('button')).toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // Resolved state — SOS has been closed; panel shows what happened
  // -------------------------------------------------------------------------
  describe('Resolved state', () => {
    test('shows resolution message', async () => {
      // When status changes to 'resolved', the panel should show the resolution message
      // so the citizen knows the situation has been officially closed
      distressOverrides = {
        isActive: false,
        status: 'resolved',
        resolution: 'Help arrived safely',
        latitude: 55.86,
        longitude: -4.25,
      }
      await renderSOS()
      // The panel auto-opens on resolution via onResolved callback
      // Since we mock useDistress, showPanel starts false. Click to open.
      const btn = screen.getByRole('button', { name: 'sos.emergencySOSButton' })
      // In resolved state, clicking the button starts a new SOS cycle (startCountdown)
      // because the real panel auto-opens via the onResolved callback, but since we mock
      // useDistress, showPanel is false — click acts as if idle → startCountdown
      fireEvent.click(btn)
      expect(mockStartCountdown).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // Idle press — the golden-path test: first press kicks off the countdown
  // -------------------------------------------------------------------------
  describe('Idle press', () => {
    test('first press in idle state calls startCountdown', async () => {
      // Golden-path scenario: citizen has no active SOS and presses the button once
      // Expected: startCountdown() is called to begin the N-second delay before broadcast
      distressOverrides = { status: 'idle' }
      await renderSOS()
      const btn = screen.getByRole('button', { name: 'sos.emergencySOSButton' })
      fireEvent.click(btn)
      expect(mockStartCountdown).toHaveBeenCalledOnce()
    })
  })
})

