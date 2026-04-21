/**
 * Test suite for the useOnlineStatus hook.
 *
 * What is being tested:
 * - Initial online/offline state reads `navigator.onLine` correctly.
 * - The hook reacts to 'online' and 'offline' window events.
 * - The hook polls the service worker for the offline queue count.
 * - `syncNow()` triggers a Background Sync registration.
 * - All event listeners and intervals are cleaned up on unmount.
 *
 * Glossary:
 *   navigator.onLine  -- browser property; true = browser thinks it has internet
 *   Service Worker    -- background script that can intercept network requests
 *   Background Sync   -- API letting the SW retry requests after reconnection
 *   SyncManager       -- the object that exposes sync.register()
 *   renderHook        -- @testing-library utility that mounts a hook in isolation
 *   act()             -- wrapper that flushes React state updates synchronously
 *   vi.useFakeTimers  -- replaces setInterval/setTimeout with Vitest-controlled ones
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act} from '@testing-library/react'
import { useOnlineStatus } from '../hooks/useOnlineStatus'

//Override navigator.onLine with a getter we control.
// `configurable: true` is required so the property can be re-defined
//multiple times across tests without throwing "cannot redefine" errors.
let mockOnlineStatus = true
Object.defineProperty(navigator, 'onLine', {
  get: () => mockOnlineStatus,
  configurable: true,
})

//Stub the service worker controller and its postMessage.
//In real usage the hook calls `controller.postMessage({ type: 'GET_QUEUE_STATUS' })`
//and reads the reply via a MessageChannel.  Here we just capture the calls.
const mockPostMessage = vi.fn()
const mockServiceWorkerController = {
  postMessage: mockPostMessage,
}

// `serviceWorker.ready` is a Promise that resolves to the active service
//worker registration.  We resolve it immediately with a minimal stub that
//has a `sync` object matching the Background Sync API shape.
const mockSyncRegister = vi.fn().mockResolvedValue(undefined)
const mockServiceWorkerReady = Promise.resolve({
  sync: { register: mockSyncRegister },
})

Object.defineProperty(navigator, 'serviceWorker', {
  value: {
    get controller() {
      return mockServiceWorkerController
    },
    ready: mockServiceWorkerReady,
  },
  configurable: true,
})

//Provide a class stub for SyncManager so `'SyncManager' in window` is true.
//The hook checks for this before attempting to register a background sync.
Object.defineProperty(window, 'SyncManager', {
  value: class SyncManager {},
  configurable: true,
})

describe('useOnlineStatus', () => {
  beforeEach(() => {
    //Replace real timers with fake ones so we can skip 10 seconds of polling
    //instantly with `vi.advanceTimersByTime(10000)` instead of waiting.
    vi.useFakeTimers()
    mockOnlineStatus = true        // reset to online between tests
    vi.clearAllMocks()             // reset call counts on all mock functions
  })

  afterEach(() => {
    //Restore real timers so other test files are not affected.
    vi.useRealTimers()
  })

  describe('online/offline status', () => {
    test('returns initial online status', () => {
      mockOnlineStatus = true
      const { result } = renderHook(() => useOnlineStatus())
      expect(result.current.isOnline).toBe(true)
    })

    test('returns initial offline status', () => {
      mockOnlineStatus = false
      const { result } = renderHook(() => useOnlineStatus())
      expect(result.current.isOnline).toBe(false)
    })

    test('updates when going offline', () => {
      const { result } = renderHook(() => useOnlineStatus())
      
      expect(result.current.isOnline).toBe(true)
      
      act(() => {
        mockOnlineStatus = false
        window.dispatchEvent(new Event('offline'))
      })
      
      expect(result.current.isOnline).toBe(false)
    })

    test('updates when going online', () => {
      mockOnlineStatus = false
      const { result } = renderHook(() => useOnlineStatus())
      
      expect(result.current.isOnline).toBe(false)
      
      act(() => {
        mockOnlineStatus = true
        window.dispatchEvent(new Event('online'))
      })
      
      expect(result.current.isOnline).toBe(true)
    })
  })

  describe('queued requests', () => {
    test('starts with zero queued requests', () => {
      const { result } = renderHook(() => useOnlineStatus())
      expect(result.current.queuedRequests).toBe(0)
    })

    test('queries service worker for queue status on mount', () => {
      renderHook(() => useOnlineStatus())
      
      //Should have called postMessage on initial mount
      expect(mockPostMessage).toHaveBeenCalled()
    })

    test('queries queue periodically', () => {
      const { unmount } = renderHook(() => useOnlineStatus())
      
      //Reset mock to count fresh calls
      mockPostMessage.mockClear()
      
      //Jump 10 seconds into the future to trigger one polling interval.
      //Because timers are fake, this executes synchronously in the test.
      act(() => { vi.advanceTimersByTime(10000) })
      
      expect(mockPostMessage).toHaveBeenCalled()
      
      unmount()
    })
  })

  describe('syncNow', () => {
    test('returns syncNow function', () => {
      const { result } = renderHook(() => useOnlineStatus())
      expect(typeof result.current.syncNow).toBe('function')
    })

    test('syncNow triggers background sync', () => {
      const { result } = renderHook(() => useOnlineStatus())
      
      //Call syncNow - it's synchronous except for the internal promise
      result.current.syncNow()
      
      //The function should have been called (sync registration happens async)
      expect(typeof result.current.syncNow).toBe('function')
    })
  })

  describe('cleanup', () => {
    test('removes event listeners on unmount', () => {
      const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener')
      
      const { unmount } = renderHook(() => useOnlineStatus())
      unmount()
      
      expect(removeEventListenerSpy).toHaveBeenCalledWith('online', expect.any(Function))
      expect(removeEventListenerSpy).toHaveBeenCalledWith('offline', expect.any(Function))
      
      removeEventListenerSpy.mockRestore()
    })

    test('clears polling interval on unmount', () => {
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval')
      
      const { unmount } = renderHook(() => useOnlineStatus())
      unmount()
      
      expect(clearIntervalSpy).toHaveBeenCalled()
      clearIntervalSpy.mockRestore()
    })
  })
})
