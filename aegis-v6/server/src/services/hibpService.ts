/**
 * File: hibpService.ts
 *
 * Have I Been Pwned password checker — uses the HIBP Pwned Passwords API
 * with k-Anonymity (only sends the first 5 chars of the SHA-1 hash).
 * Caches results for 24 hours and gracefully degrades if HIBP is unavailable.
 *
 * How it connects:
 * - Called during password creation and password change flows
 * - Hits the HIBP API with a 5-char SHA-1 prefix (k-Anonymity)
 * - Returns breach count so the UI can warn the user
 *
 * Simple explanation:
 * Warns users if their chosen password has appeared in known data breaches.
 */

import crypto from 'crypto'

const HIBP_API_URL = 'https://api.pwnedpasswords.com/range'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

const pwnedCache = new Map<string, { count: number; expires: number }>()

export interface HIBPResult {
  isPwned: boolean
  count: number
  message?: string
}

/**
 * Check if a password has appeared in known data breaches
 * Uses k-Anonymity: Only sends first 5 chars of SHA-1 hash to HIBP API
 * 
 * @param password - Plain text password to check
 * @returns Promise<HIBPResult> - Whether password is pwned and breach count
 */
export async function checkPasswordBreached(password: string): Promise<HIBPResult> {
  try {
    const sha1Hash = crypto
      .createHash('sha1')
      .update(password)
      .digest('hex')
      .toUpperCase()
    
    const prefix = sha1Hash.substring(0, 5)
    const suffix = sha1Hash.substring(5)
    
    // Check cache first
    const cacheKey = prefix + suffix
    const cached = pwnedCache.get(cacheKey)
    if (cached && cached.expires > Date.now()) {
      return {
        isPwned: cached.count > 0,
        count: cached.count,
      }
    }
    
    // Query HIBP API with k-Anonymity (only send prefix)
    const response = await fetch(`${HIBP_API_URL}/${prefix}`, {
      headers: {
        'User-Agent': 'AEGIS-Emergency-Management-System',
        'Add-Padding': 'true', // Prevent response length analysis
      },
      signal: AbortSignal.timeout(5000),
    })
    
    if (!response.ok) {
      // Don't block registration if HIBP is down
      console.warn(`[HIBP] API returned ${response.status}`)
      return { isPwned: false, count: 0, message: 'HIBP check unavailable' }
    }
    
    const text = await response.text()
    const lines = text.split('\n')
    
    // Find matching suffix
    let breachCount = 0
    for (const line of lines) {
      const [hashSuffix, count] = line.split(':')
      if (hashSuffix.trim() === suffix) {
        breachCount = parseInt(count.trim(), 10)
        break
      }
    }
    
    // Cache result
    pwnedCache.set(cacheKey, {
      count: breachCount,
      expires: Date.now() + CACHE_TTL_MS,
    })
    
    // Clean old cache entries and enforce hard cap to prevent unbounded growth
    if (pwnedCache.size > 10000) {
      const now = Date.now()
      for (const [key, value] of pwnedCache) {
        if (value.expires < now) pwnedCache.delete(key)
      }
      // If still over limit after expiry sweep, evict oldest entries (FIFO)
      if (pwnedCache.size > 10000) {
        const excess = pwnedCache.size - 8000 // evict down to 8k for headroom
        let removed = 0
        for (const key of pwnedCache.keys()) {
          if (removed >= excess) break
          pwnedCache.delete(key)
          removed++
        }
      }
    }
    
    return {
      isPwned: breachCount > 0,
      count: breachCount,
      message: breachCount > 0 
        ? `This password has appeared in ${breachCount.toLocaleString()} data breaches`
        : undefined,
    }
  } catch (error: any) {
    console.error('[HIBP] Error checking password:', error.message)
    // Don't block on HIBP failures - graceful degradation
    return { isPwned: false, count: 0, message: 'HIBP check unavailable' }
  }
}

/**
 * Validate password against HIBP with configurable thresholds
 * Returns validation result with user-friendly messages
 */
export async function validatePasswordNotBreached(
  password: string,
  options: {
    blockThreshold?: number // Block if seen more than this many times (default: 0)
    warnThreshold?: number  // Warn if seen more than this many times (default: 0)
  } = {}
): Promise<{
  valid: boolean
  blocked: boolean
  warned: boolean
  message?: string
  breachCount: number
}> {
  const { blockThreshold = 0, warnThreshold = 0 } = options
  
  const result = await checkPasswordBreached(password)
  
  if (result.isPwned && result.count > blockThreshold) {
    return {
      valid: false,
      blocked: true,
      warned: false,
      message: `This password has been exposed in ${result.count.toLocaleString()} data breaches and cannot be used. Please choose a different password.`,
      breachCount: result.count,
    }
  }
  
  if (result.isPwned && result.count > warnThreshold) {
    return {
      valid: true,
      blocked: false,
      warned: true,
      message: `Warning: This password has appeared in ${result.count.toLocaleString()} data breaches. Consider using a stronger password.`,
      breachCount: result.count,
    }
  }
  
  return {
    valid: true,
    blocked: false,
    warned: false,
    breachCount: 0,
  }
}

/**
 * Get HIBP service stats for admin monitoring
 */
export function getHIBPStats(): {
  cacheSize: number
  cacheHitRate: string
} {
  return {
    cacheSize: pwnedCache.size,
    cacheHitRate: 'N/A', // Would need to track hits/misses for accurate rate
  }
}

export default {
  checkPasswordBreached,
  validatePasswordNotBreached,
  getHIBPStats,
}
