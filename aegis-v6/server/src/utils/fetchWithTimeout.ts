/**
 * fetchWithTimeout - A wrapper around fetch() that enforces a timeout.
 * Prevents external API calls from hanging indefinitely.
 *
 * Usage:
 *   import { fetchWithTimeout } from '../utils/fetchWithTimeout.js'
 *   const res = await fetchWithTimeout('https://api.example.com/data', { timeout: 15000 })
 */

export interface FetchWithTimeoutOptions extends RequestInit {
  /* Timeout in milliseconds. Defaults to 15000 (15 seconds). */
  timeout?: number
}

export async function fetchWithTimeout(
  url: string | URL,
  options: FetchWithTimeoutOptions = {}
): Promise<Response> {
  const { timeout = 15_000, ...fetchOptions } = options

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  // If the caller already provided a signal, chain them
  if (fetchOptions.signal) {
    const externalSignal = fetchOptions.signal
    externalSignal.addEventListener('abort', () => controller.abort())
  }

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    })
    return response
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error(`Request to ${String(url)} timed out after ${timeout}ms`)
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
  }
}
