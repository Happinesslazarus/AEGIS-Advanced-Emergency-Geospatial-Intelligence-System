/**
 * A fetch() wrapper that adds timeout support and SSRF protection.
 * Blocks requests to private/internal IP ranges by default to prevent
 * server-side request forgery attacks.
 *
 * - Used by services that call external APIs (weather, SEPA, AI engine)
 * - SSRF checks prevent attackers from using the server as a proxy
 *   to reach internal services
 * */

export interface FetchWithTimeoutOptions extends RequestInit {
  timeout?: number
  skipSsrfCheck?: boolean
}

const PRIVATE_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
  /^fd[0-9a-f]{2}:/i,
]

const BLOCKED_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '[::1]',
  '::1',
  'metadata.google.internal',
  '169.254.169.254',
])

export function isUrlSsrfSafe(rawUrl: string): { safe: boolean; reason?: string } {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return { safe: false, reason: 'Invalid URL format' }
  }

  const host = parsed.hostname.toLowerCase()

  if (BLOCKED_HOSTS.has(host)) {
    return { safe: false, reason: `Blocked host: ${host}` }
  }

  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(host)) {
      return { safe: false, reason: `Private/reserved IP: ${host}` }
    }
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { safe: false, reason: `Blocked protocol: ${parsed.protocol}` }
  }

  return { safe: true }
}

export async function fetchWithTimeout(
  url: string | URL,
  options: FetchWithTimeoutOptions = {}
): Promise<Response> {
  const { timeout = 15_000, skipSsrfCheck = false, ...fetchOptions } = options

  if (!skipSsrfCheck) {
    const ssrfCheck = isUrlSsrfSafe(String(url))
    if (!ssrfCheck.safe) {
      throw new Error(`SSRF blocked: ${ssrfCheck.reason}`)
    }
  }

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
