/**
 * Use offline queue test suite (automated tests for this feature).
 *
 * Glossary:
 *   navigator.onLine          = browser property: true when the device has
 *                               network connectivity, false when offline.
 *   Service Worker            = background script (sw.js) that intercepts
 *                               network requests and can respond from cache.
 *   postMessage               = sends a message from the main page to the
 *                               service worker (or vice versa).
 *   TRIM_CACHES               = message type telling the SW to clean up
 *                               expired cache entries after reconnecting.
 *   waitFor()                 = retries the assertion until it passes or
 *                               times out (useful for async state updates).
 *   act()                     = flushes React state updates synchronously.
 *   window.dispatchEvent()    = simulates browser events (online/offline) by
 *                               firing them on the window object directly.
 *
 * How it connects:
 * - Run by the test runner (Vitest or Jest) */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useOfflineQueue } from '../hooks/useOfflineQueue'

// Mock navigator.onLine: a getter so we can change the returned value between
// tests by updating the module-level variable mockOnlineStatus.
let mockOnlineStatus = true
Object.defineProperty(navigator, 'onLine', {
  get: () => mockOnlineStatus,
  configurable: true,
})

// Mock service worker
const mockServiceWorkerController = {
  postMessage: vi.fn(),
}

const mockServiceWorkerListeners = new Map<string, EventListener>()

Object.defineProperty(navigator, 'serviceWorker', {
  value: {
    get controller() {
      return mockServiceWorkerController
    },
    addEventListener: (type: string, listener: EventListener) => {
      mockServiceWorkerListeners.set(type, listener)
    },
    removeEventListener: (type: string) => {
      mockServiceWorkerListeners.delete(type)
    },
  },
  configurable: true,
})

describe('useOfflineQueue', () => {
  beforeEach(() => {
    mockOnlineStatus = true
    vi.clearAllMocks()
    mockServiceWorkerListeners.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('online/offline status', () => {
    test('returns initial online status', () => {
      mockOnlineStatus = true
      const { result } = renderHook(() => useOfflineQueue())
      expect(result.current.isOnline).toBe(true)
    })

    test('returns initial offline status', () => {
      mockOnlineStatus = false
      const { result } = renderHook(() => useOfflineQueue())
      expect(result.current.isOnline).toBe(false)
    })

    test('updates status when going offline', () => {
      const { result } = renderHook(() => useOfflineQueue())
      
      expect(result.current.isOnline).toBe(true)
      
      act(() => {
        mockOnlineStatus = false
        window.dispatchEvent(new Event('offline'))
      })
      
      expect(result.current.isOnline).toBe(false)
    })

    test('updates status when going online', () => {
      mockOnlineStatus = false
      const { result } = renderHook(() => useOfflineQueue())
      
      expect(result.current.isOnline).toBe(false)
      
      act(() => {
        mockOnlineStatus = true
        window.dispatchEvent(new Event('online'))
      })
      
      expect(result.current.isOnline).toBe(true)
    })

    test('sends TRIM_CACHES message when going online', () => {
      mockOnlineStatus = false
      renderHook(() => useOfflineQueue())
      
      act(() => {
        mockOnlineStatus = true
        window.dispatchEvent(new Event('online'))
      })
      
      expect(mockServiceWorkerController.postMessage).toHaveBeenCalledWith({
        type: 'TRIM_CACHES',
      })
    })
  })

  describe('queue management', () => {
    test('starts with empty queue', () => {
      const { result } = renderHook(() => useOfflineQueue())
      expect(result.current.queueCount).toBe(0)
      expect(result.current.queue).toEqual([])
    })

    test('enqueue adds item to queue', async () => {
      const { result } = renderHook(() => useOfflineQueue())
      
      await act(async () => {
        await result.current.enqueue(
          '/api/reports',
          'POST',
          JSON.stringify({ title: 'Test' }),
          { 'Content-Type': 'application/json' }
        )
      })
      
      expect(result.current.queueCount).toBe(1)
      expect(result.current.queue[0]).toMatchObject({
        url: '/api/reports',
        method: 'POST',
        body: JSON.stringify({ title: 'Test' }),
        headers: { 'Content-Type': 'application/json' },
      })
    })

    test('enqueue uses default Content-Type header', async () => {
      const { result } = renderHook(() => useOfflineQueue())
      
      await act(async () => {
        await result.current.enqueue('/api/test', 'POST', '{}')
      })
      
      expect(result.current.queue[0].headers).toEqual({
        'Content-Type': 'application/json',
      })
    })

    test('enqueue sends message to service worker', async () => {
      const { result } = renderHook(() => useOfflineQueue())
      
      await act(async () => {
        await result.current.enqueue('/api/test', 'POST', '{"data": true}')
      })
      
      expect(mockServiceWorkerController.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'QUEUE_REQUEST',
          url: '/api/test',
          method: 'POST',
          body: '{"data": true}',
        })
      )
    })

    test('clearQueue empties the queue', async () => {
      const { result } = renderHook(() => useOfflineQueue())
      
      await act(async () => {
        await result.current.enqueue('/api/1', 'POST', '{}')
        await result.current.enqueue('/api/2', 'POST', '{}')
      })
      
      expect(result.current.queueCount).toBe(2)
      
      act(() => {
        result.current.clearQueue()
      })
      
      expect(result.current.queueCount).toBe(0)
      expect(result.current.queue).toEqual([])
    })
  })

  describe('replayAll', () => {
    beforeEach(() => {
      vi.spyOn(global, 'fetch')
    })

    test('replays all queued requests', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
      })

      const { result } = renderHook(() => useOfflineQueue())
      
      await act(async () => {
        await result.current.enqueue('/api/1', 'POST', '{"id":1}')
        await result.current.enqueue('/api/2', 'POST', '{"id":2}')
      })
      
      let replayResult: { success: number; failed: number }
      await act(async () => {
        replayResult = await result.current.replayAll()
      })
      
      expect(replayResult!).toEqual({ success: 2, failed: 0 })
      expect(global.fetch).toHaveBeenCalledTimes(2)
    })

    test('handles failed requests', async () => {
      (global.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({ ok: false })

      const { result } = renderHook(() => useOfflineQueue())
      
      await act(async () => {
        await result.current.enqueue('/api/1', 'POST', '{}')
        await result.current.enqueue('/api/2', 'POST', '{}')
      })
      
      let replayResult: { success: number; failed: number }
      await act(async () => {
        replayResult = await result.current.replayAll()
      })
      
      expect(replayResult!).toEqual({ success: 1, failed: 1 })
    })

    test('handles network errors', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'))

      const { result } = renderHook(() => useOfflineQueue())
      
      await act(async () => {
        await result.current.enqueue('/api/1', 'POST', '{}')
      })
      
      let replayResult: { success: number; failed: number }
      await act(async () => {
        replayResult = await result.current.replayAll()
      })
      
      expect(replayResult!).toEqual({ success: 0, failed: 1 })
    })

    test('sends correct request options', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true })

      const { result } = renderHook(() => useOfflineQueue())
      
      await act(async () => {
        await result.current.enqueue(
          '/api/test',
          'PUT',
          '{"updated":true}',
          { 'Content-Type': 'application/json', 'Authorization': 'Bearer token' }
        )
      })
      
      await act(async () => {
        await result.current.replayAll()
      })
      
      expect(global.fetch).toHaveBeenCalledWith('/api/test', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer token' },
        body: '{"updated":true}',
      })
    })
  })

  describe('service worker messages', () => {
    test('handles SYNC_SUCCESS message', async () => {
      const { result } = renderHook(() => useOfflineQueue())
      
      await act(async () => {
        await result.current.enqueue('/api/1', 'POST', '{}')
        await result.current.enqueue('/api/2', 'POST', '{}')
      })
      
      // Set IDs on queue items for matching
      result.current.queue[0].id = 1
      result.current.queue[1].id = 2
      
      // Simulate service worker SYNC_SUCCESS message
      const messageHandler = mockServiceWorkerListeners.get('message')
      if (messageHandler) {
        act(() => {
          messageHandler(new MessageEvent('message', {
            data: { type: 'SYNC_SUCCESS', id: 1 },
          }))
        })
      }
      
      await waitFor(() => {
        expect(result.current.queue.some(item => item.id === 1)).toBe(false)
      })
    })

    test('handles QUEUE_STATUS message', () => {
      const { result } = renderHook(() => useOfflineQueue())
      
      const queueItems = [
        { id: 1, url: '/api/1', method: 'POST', body: '{}', headers: {}, timestamp: Date.now() },
        { id: 2, url: '/api/2', method: 'POST', body: '{}', headers: {}, timestamp: Date.now() },
      ]
      
      const messageHandler = mockServiceWorkerListeners.get('message')
      if (messageHandler) {
        act(() => {
          messageHandler(new MessageEvent('message', {
            data: { type: 'QUEUE_STATUS', items: queueItems },
          }))
        })
      }
      
      expect(result.current.queue).toEqual(queueItems)
      expect(result.current.queueCount).toBe(2)
    })

    test('requests queue status on mount', () => {
      renderHook(() => useOfflineQueue())
      
      expect(mockServiceWorkerController.postMessage).toHaveBeenCalledWith({
        type: 'GET_QUEUE_STATUS',
      })
    })
  })

  describe('cleanup', () => {
    test('removes event listeners on unmount', () => {
      const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener')
      
      const { unmount } = renderHook(() => useOfflineQueue())
      unmount()
      
      expect(removeEventListenerSpy).toHaveBeenCalledWith('online', expect.any(Function))
      expect(removeEventListenerSpy).toHaveBeenCalledWith('offline', expect.any(Function))
      
      removeEventListenerSpy.mockRestore()
    })
  })
})
