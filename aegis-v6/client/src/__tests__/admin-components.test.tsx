/**
 * Tests for the <ActivityLog> admin component and its companion utilities:
 *   - ActivityLog component   -- renders a scrollable card of recent operator actions
 *   - useActivityLog() hook   -- subscribes to the shared activity list (pub/sub pattern)
 *   - addActivity()           -- appends a new entry to the shared log and notifies all hooks
 *
 * The ActivityLog is shown on the admin dashboard so supervisors can see what operators
 * (e.g. "Emergency Operator", "System Administrator") have done recently.
 *
 * Glossary:
 *   describe()          = groups related tests under a labelled block
 *   test()              = a single scenario with one expected outcome
 *   expect()            = assertion helper that checks a value
 *   vi.fn()             = creates a trackable mock function
 *   vi.mock()           = replaces a module with a lightweight fake
 *   vi.useFakeTimers()  = replaces Date / setTimeout with controllable fakes
 *   vi.setSystemTime()  = locks the fake clock to a specific date/time for deterministic output
 *   vi.useRealTimers()  = restores real clock after fake-timer tests
 *   render()            = mounts a React component into the jsdom (in-memory DOM)
 *   renderHook()        = mounts a React hook in isolation, returns {result, rerender, unmount}
 *   screen              = query helpers that search by role, text, label, etc.
 *   act()               = flushes React state updates and effects synchronously
 *   waitFor()           = retries an assertion until it passes or times out
 *   userEvent           = simulates realistic user interactions (type, click, tab)
 *   ActivityLog         = React component that renders the admin activity timeline card
 *   addActivity()       = module-level function that adds an entry to the shared log
 *   useActivityLog()    = React hook; returns [log, setLog] backed by a shared in-memory store
 *   ActivityEntry       = type {id, action, operator, timestamp, type, reportId?}
 *   type                = activity category: verify/flag/urgent/alert/deploy/login/print/export
 *   reportId            = optional reference to the report the activity relates to (e.g. 'RPT-001')
 * ACTIVITY_COLORS = map from activity type -> Tailwind CSS class string for icon colouring
 *   t: key => key       = i18n mock that returns raw translation keys (not translated strings)
 *   relative time       = "5m ago", "1h ago" etc. derived from the entry's timestamp
 *   pub/sub             = publish/subscribe pattern; addActivity publishes, all hook instances
 *                         subscribe and receive the same update simultaneously
 *   Set                 = JavaScript built-in that holds only unique values; used to check IDs are unique
 *   Date.now()          = milliseconds since Unix epoch; used to bracket timestamp validity
 *
 * - Run by the test runner (Vitest) with `vitest run` or `vitest watch`
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import {} from '@testing-library/user-event' // realistic user interaction simulation
import ActivityLog, { addActivity, useActivityLog, type ActivityEntry } from '../components/admin/ActivityLog'
import { renderHook } from '@testing-library/react'

//Module-level mocks

//i18n -- all translation calls return the raw key so assertions are language-independent
vi.mock('../utils/i18n', () => ({
  t: (key: string) => key,
  getLanguage: () => 'en',
}))

//useLanguage -- provides locale code; not critical to ActivityLog logic
vi.mock('../hooks/useLanguage', () => ({
  useLanguage: () => 'en',
}))

//ACTIVITY_COLORS -- maps activity type -> CSS class; mocked to avoid importing full token map
vi.mock('../utils/colorTokens', () => ({
  ACTIVITY_COLORS: {
    verify: 'text-green-600 bg-green-50',   // green for verification actions
    flag:   'text-amber-600 bg-amber-50',   // amber for flagged reports
    urgent: 'text-red-600 bg-red-50',       // red for urgent escalations
    alert:  'text-blue-600 bg-blue-50',     // blue for alerts sent
    deploy: 'text-purple-600 bg-purple-50', // purple for resource deployments
    login:  'text-gray-600 bg-gray-50',     // gray for login events
    print:  'text-cyan-600 bg-cyan-50',     // cyan for print actions
    export: 'text-teal-600 bg-teal-50',     // teal for data exports
  },
}))

//ActivityLog component -- rendering
describe('ActivityLog', () => {
  describe('rendering', () => {
    test('renders activity log title', () => {
      render(<ActivityLog />)
      //The card header uses the i18n key 'admin.activityLog.title' (returned raw by our mock)
      expect(screen.getByText('admin.activityLog.title')).toBeInTheDocument()
    })

    test('renders initial activity entries', () => {
      render(<ActivityLog />)
      //The component ships with default seed entries -- the login entry is always present
      expect(screen.getByText(/Logged in to AEGIS Admin/)).toBeInTheDocument()
    })

    test('renders multiple activity types', () => {
      render(<ActivityLog />)
      //Seed entries cover verify, alert, and flag activity types
      expect(screen.getByText(/Verified report/)).toBeInTheDocument()
      expect(screen.getByText(/Sent alert/)).toBeInTheDocument()
      expect(screen.getByText(/Flagged report/)).toBeInTheDocument()
    })

    test('displays operator names', () => {
      render(<ActivityLog />)
      //Seed entries include at least one entry per operator role
      expect(screen.getAllByText(/System Administrator/).length).toBeGreaterThan(0)
      expect(screen.getAllByText(/Emergency Operator/).length).toBeGreaterThan(0)
    })

    test('displays report IDs when present', () => {
      render(<ActivityLog />)
      //Report IDs appear alongside the action text (e.g. "Verified report RPT-001")
      expect(screen.getByText(/RPT-001/)).toBeInTheDocument()
      expect(screen.getByText(/RPT-003/)).toBeInTheDocument()
    })
  })

  //Activity icons
  describe('activity icons', () => {
    test('renders different icons for different activity types', () => {
      render(<ActivityLog />)
      //Each entry renders a circular icon container; the CSS classes identify it
      const iconContainers = document.querySelectorAll('.w-7.h-7.rounded-full')
      expect(iconContainers.length).toBeGreaterThan(0)
    })
  })

  //Styling
  describe('styling', () => {
    test('applies card styling', () => {
      const { container } = render(<ActivityLog />)
      //The outer wrapper uses the shared 'card' class for consistent admin panel look
      expect(container.querySelector('.card')).toBeInTheDocument()
    })

    test('has scrollable container for many entries', () => {
      const { container } = render(<ActivityLog />)
      //overflow-y-auto enables scrolling when there are more entries than visible height
      const scrollContainer = container.querySelector('.overflow-y-auto')
      expect(scrollContainer).toBeInTheDocument()
    })

    test('limits height with max-h class', () => {
      const { container } = render(<ActivityLog />)
 //max-h-96 caps the component at 384px (Tailwind spacing=96 -> 24rem)
      expect(container.querySelector('.max-h-96')).toBeInTheDocument()
    })
  })
})

//useActivityLog hook -- shared in-memory state
describe('useActivityLog hook', () => {
  test('returns initial log entries', () => {
    const { result } = renderHook(() => useActivityLog())
    const [log] = result.current // hook returns [entries, setEntries]

    expect(Array.isArray(log)).toBe(true)
    expect(log.length).toBeGreaterThan(0) // seeded with default entries
  })

  test('log entries have required properties', () => {
    const { result } = renderHook(() => useActivityLog())
    const [log] = result.current

    //Every ActivityEntry must carry all five required fields
    log.forEach((entry: ActivityEntry) => {
      expect(entry).toHaveProperty('id')        // unique identifier
      expect(entry).toHaveProperty('action')    // human-readable action description
      expect(entry).toHaveProperty('operator')  // who performed the action
      expect(entry).toHaveProperty('timestamp') // ISO date string when it occurred
      expect(entry).toHaveProperty('type')      // activity category (verify/flag/etc.)
    })
  })
})

//addActivity -- publish new entries and notify all hook subscribers
describe('addActivity', () => {
  test('adds new activity entry', async () => {
    const { result, rerender } = renderHook(() => useActivityLog())
    const initialCount = result.current[0].length

    act(() => {
      addActivity({
        action: 'Test action',
        operator: 'Test Operator',
        type: 'verify', // activity type -- determines icon and colour
      })
    })

    //waitFor retries the assertion until the hook reflects the new state
    await waitFor(() => {
      rerender()
      expect(result.current[0].length).toBe(initialCount + 1)
    })
  })

  test('new entries appear at the beginning', async () => {
    //The log is prepended (newest-first order) so index 0 = most recent entry
    const { result, rerender } = renderHook(() => useActivityLog())

    act(() => {
      addActivity({
        action: 'Newest action',
        operator: 'Test Operator',
        type: 'alert',
      })
    })

    await waitFor(() => {
      rerender()
      expect(result.current[0][0].action).toBe('Newest action') // top of list
    })
  })

  test('generates unique IDs', async () => {
    //IDs must not collide even when entries are added in rapid succession
    const { result, rerender } = renderHook(() => useActivityLog())

    act(() => {
      addActivity({ action: 'Action 1', operator: 'Operator', type: 'verify' })
    })

    await new Promise(resolve => setTimeout(resolve, 10)) // small real-time gap

    act(() => {
      addActivity({ action: 'Action 2', operator: 'Operator', type: 'flag' })
    })

    await waitFor(() => {
      rerender()
      const [log] = result.current
      const ids = log.map((e: ActivityEntry) => e.id)
      const uniqueIds = new Set(ids) // Set keeps only unique values
      expect(uniqueIds.size).toBe(ids.length) // every id is unique
    })
  })

  test('generates valid timestamps', async () => {
    //Timestamps must be in the range [before-add, after-add]
    const { result, rerender } = renderHook(() => useActivityLog())
    const beforeAdd = Date.now() // milliseconds since Unix epoch

    act(() => {
      addActivity({ action: 'Timestamped action', operator: 'Operator', type: 'login' })
    })

    await waitFor(() => {
      rerender()
      const newEntry = result.current[0].find((e: ActivityEntry) => e.action === 'Timestamped action')
      expect(newEntry).toBeDefined()
 const timestamp = new Date(newEntry!.timestamp).getTime() // parse ISO string -> ms
      expect(timestamp).toBeGreaterThanOrEqual(beforeAdd)  // not in the past
      expect(timestamp).toBeLessThanOrEqual(Date.now())    // not in the future
    })
  })

  test('supports optional reportId', async () => {
    //reportId links an activity entry back to a specific incident report
    const { result, rerender } = renderHook(() => useActivityLog())

    act(() => {
      addActivity({
        action: 'Report action',
        reportId: 'RPT-TEST-001', // optional -- only present for report-related actions
        operator: 'Operator',
        type: 'verify',
      })
    })

    await waitFor(() => {
      rerender()
      const entry = result.current[0].find((e: ActivityEntry) => e.reportId === 'RPT-TEST-001')
      expect(entry).toBeDefined()
    })
  })
})

//Time formatting -- relative timestamps shown in the UI
describe('ActivityLog time formatting', () => {
  beforeEach(() => {
    vi.useFakeTimers() // freeze the clock for predictable "X ago" output
    vi.setSystemTime(new Date('2026-04-05T12:00:00Z')) // fixed reference point
  })

  afterEach(() => {
    vi.useRealTimers() // restore real clock so other tests aren't affected
  })

  test('displays relative time for recent activities', () => {
    render(<ActivityLog />)
    //Seed entries have recent timestamps; the component renders them as
    // "5m ago" (time.mAgo i18n key) or "1h ago" (time.hAgo i18n key)
    const timeElements = screen.getAllByText(/time\.(m|h)Ago/) // regex matches both keys
    expect(timeElements.length).toBeGreaterThan(0)
  })
})

//Notification system -- pub/sub broadcast to multiple hook instances
describe('ActivityLog notification system', () => {
  test('multiple hooks receive updates', async () => {
    //Both hook instances share the same module-level store; addActivity notifies all
    const { result: result1 } = renderHook(() => useActivityLog())
    const { result: result2 } = renderHook(() => useActivityLog())

    const initialCount1 = result1.current[0].length
    const initialCount2 = result2.current[0].length

    act(() => {
      addActivity({
        action: 'Broadcast action',
        operator: 'Broadcaster',
 type: 'alert', // type: alert -> blue icon
      })
    })

    //Both subscribed hook instances should now have one extra entry
    await waitFor(() => {
      expect(result1.current[0].length).toBe(initialCount1 + 1)
      expect(result2.current[0].length).toBe(initialCount2 + 1)
    })
  })
})

//Accessibility
describe('ActivityLog accessibility', () => {
  test('has semantic heading structure', () => {
    render(<ActivityLog />)
    //The card title must be wrapped in an <h3> for correct heading hierarchy
    const heading = screen.getByRole('heading', { level: 3 })
    expect(heading).toBeInTheDocument()
  })
})

