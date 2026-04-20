/**
 * Use audio alerts test suite (automated tests for this feature).
 *
 * Glossary:
 *   Web Speech Synthesis API  = browser API that converts text to spoken audio
 *                               via the OS's text-to-speech engine.
 *   vi.fn()                   = creates a mock (spy) function that records calls
 *                               and returns configurable values.
 *   vi.stubGlobal()           = replaces a global variable (window.X) for the
 *                               duration of the test file.
 *   vi.clearAllMocks()        = resets call-counts and return values of all
 *                               mocks so test results are independent.
 *   renderHook()              = mounts a React hook in a minimal test component
 *                               and returns result.current for assertions.
 *   act()                     = flushes React state updates so assertions run
 *                               against the post-update state.
 *   Object.defineProperty()   = replaces a browser API (localStorage,
 *                               speechSynthesis) that doesn't exist in the
 *                               Node.js test environment.
 *   expect.stringContaining() = a partial-match matcher; passes if the actual
 *                               string contains the given substring.
 *
 * How it connects:
 * - Run by the test runner (Vitest or Jest) */

import { describe, test, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

//Mock localStorage: Node.js (where Vitest runs) has no real localStorage,
//so we create a plain object backed store and wrap it in the same interface.
const mockLocalStorage: Record<string, string> = {}
const localStorageMock = {
  getItem: vi.fn((key: string) => mockLocalStorage[key] || null),
  setItem: vi.fn((key: string, value: string) => { mockLocalStorage[key] = value }),
  removeItem: vi.fn((key: string) => { delete mockLocalStorage[key] }),
  clear: vi.fn(() => { Object.keys(mockLocalStorage).forEach(k => delete mockLocalStorage[k]) }),
}
Object.defineProperty(global, 'localStorage', { value: localStorageMock })

//Mock speechSynthesis: the Web Speech API doesn't exist in Node.js.
//We stub every method so the hook can call them without crashing.
const mockSpeechSynthesis = {
  getVoices: vi.fn((): SpeechSynthesisVoice[] => []),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  speak: vi.fn(),
  cancel: vi.fn(),
  speaking: false,
}
Object.defineProperty(global, 'speechSynthesis', { value: mockSpeechSynthesis })

//Mock SpeechSynthesisUtterance: the class the hook constructs before calling
//speechSynthesis.speak().  We stub it as a vi.fn() constructor so new
//SpeechSynthesisUtterance('...') returns an object with the expected shape.
vi.stubGlobal('SpeechSynthesisUtterance', vi.fn().mockImplementation(() => ({
  text: '',
  voice: null,
  volume: 1,
  rate: 1,
  pitch: 1,
  onstart: null,
  onend: null,
  onerror: null,
})))

import { useAudioAlerts, type AudioAlertSettings } from '../hooks/useAudioAlerts'

describe('useAudioAlerts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorageMock.clear()
    mockSpeechSynthesis.getVoices.mockReturnValue([])
  })

  describe('initialization', () => {
    test('initializes with default settings', () => {
      const { result } = renderHook(() => useAudioAlerts())
      
      expect(result.current.settings.enabled).toBe(true)
      expect(result.current.settings.volume).toBe(0.8)
      expect(result.current.settings.rate).toBe(1.0)
      expect(result.current.settings.pitch).toBe(1.0)
      expect(result.current.settings.voice).toBe('default')
      expect(result.current.settings.autoPlayCritical).toBe(true)
      expect(result.current.settings.autoPlayWarning).toBe(false)
    })

    test('merges user settings with defaults', () => {
      const { result } = renderHook(() => useAudioAlerts({
        volume: 0.5,
        autoPlayWarning: true,
      }))
      
      expect(result.current.settings.volume).toBe(0.5)
      expect(result.current.settings.autoPlayWarning).toBe(true)
      //Other defaults preserved
      expect(result.current.settings.enabled).toBe(true)
      expect(result.current.settings.rate).toBe(1.0)
    })

    test('loads settings from localStorage', () => {
      const storedSettings = { volume: 0.3, rate: 1.5 }
      localStorageMock.getItem.mockReturnValue(JSON.stringify(storedSettings))
      
      const { result } = renderHook(() => useAudioAlerts())
      
      expect(result.current.settings.volume).toBe(0.3)
      expect(result.current.settings.rate).toBe(1.5)
    })
  })

  describe('browser support', () => {
    test('detects speech synthesis support', () => {
      const { result } = renderHook(() => useAudioAlerts())
      
      expect(result.current.supported).toBe(true)
    })
  })

  describe('settings updates', () => {
    test('updateSettings modifies settings', () => {
      const { result } = renderHook(() => useAudioAlerts())
      
      act(() => {
        result.current.updateSettings({ volume: 0.4 })
      })
      
      expect(result.current.settings.volume).toBe(0.4)
    })

    test('persists settings to localStorage', () => {
      const { result } = renderHook(() => useAudioAlerts())
      
      act(() => {
        result.current.updateSettings({ volume: 0.6 })
      })
      
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'aegis-audio-settings',
        expect.stringContaining('"volume":0.6')
      )
    })
  })

  describe('speaking state', () => {
    test('initially not speaking', () => {
      const { result } = renderHook(() => useAudioAlerts())
      
      expect(result.current.speaking).toBe(false)
    })
  })

  describe('voice selection', () => {
    test('provides list of available voices', () => {
      const mockVoices = [
        { name: 'English UK', lang: 'en-GB' },
        { name: 'English US', lang: 'en-US' },
      ] as SpeechSynthesisVoice[]
      mockSpeechSynthesis.getVoices.mockReturnValue(mockVoices)
      
      const { result } = renderHook(() => useAudioAlerts())
      
      expect(result.current.voices).toEqual(mockVoices)
    })
  })
})

describe('AudioAlertSettings interface', () => {
  test('validates complete settings structure', () => {
    const settings: AudioAlertSettings = {
      enabled: true,
      volume: 0.8,
      rate: 1.0,
      pitch: 1.0,
      voice: 'default',
      autoPlayCritical: true,
      autoPlayWarning: false,
    }
    
    expect(settings.enabled).toBe(true)
    expect(settings.volume).toBeGreaterThanOrEqual(0)
    expect(settings.volume).toBeLessThanOrEqual(1)
    expect(settings.rate).toBeGreaterThanOrEqual(0.5)
    expect(settings.rate).toBeLessThanOrEqual(2)
  })
})
