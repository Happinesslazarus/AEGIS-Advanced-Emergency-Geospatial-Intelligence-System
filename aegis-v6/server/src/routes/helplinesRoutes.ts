/**
 * Emergency helpline directory API. Accepts an ISO 3166-1 alpha-2 country
 * code (e.g. GB, US, AU) and returns a list of relevant crisis support
 * organisations and phone numbers, sourced live from findahelpline.com and
 * cached in-memory for one hour per country. Rate-limited to 60 req/min.
 *
 * - Mounted at /api/helplines in server/src/index.ts
 * - Used by the citizen SOS panel and the public safety map overlay
 */
import { Router, Request, Response } from 'express'
import rateLimit from 'express-rate-limit'

const router = Router()

const helplinesLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Too many helpline requests. Please try again shortly.' },
  standardHeaders: true,
  legacyHeaders: false,
})

//In-memory cache per country code -- TTL 1 hour
interface CacheEntry { data: HelplineOrg[]; ts: number }
const cache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 60 * 60 * 1000

export interface HelplineOrg {
  name: string
  phone: string
  url: string
  hours: string
  topics: string[]
  slug: string
}

//Only allow clean ISO 3166-1 alpha-2 codes and GB sub-national codes (e.g. GB-ENG)
const VALID_CC = /^[A-Z]{2}(-[A-Z]{2,3})?$/

async function fetchFromFindAHelpline(countryCode: string): Promise<HelplineOrg[]> {
  //findahelpline.com uses lowercase 2-letter ISO codes, with GB sub-regions like gb-eng
  const cc = countryCode.toLowerCase().replace('_', '-')
  const url = `https://findahelpline.com/countries/${cc}`

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'AEGIS Emergency Platform/6.9 (humanitarian crisis support tool)',
      'Accept': 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(9000),
  })

  if (!res.ok) return []

  const html = await res.text()

  //Extract the embedded Next.js SSR page data
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)
  if (!match?.[1]) return []

  let nextData: any
  try {
    nextData = JSON.parse(match[1])
  } catch {
    return []
  }

  const hits: any[] =
    nextData?.pageProps?.serverState?.initialResults?.Organization_production?.results?.[0]?.hits

  if (!Array.isArray(hits)) return []

  return hits
    .filter((h: any) => h.name && (h.phone_number || h.sms_number || h.chat_url || h.url))
    .slice(0, 15)
    .map((h: any) => ({
      name: h.name as string,
      phone: (h.phone_number || (h.sms_number ? `SMS ${h.sms_number}` : '') || '').trim(),
      url: (h.url || `https://findahelpline.com/organizations/${h.slug}`) as string,
      hours: h.always_open ? '24/7' : 'See website',
      topics: (Array.isArray(h.topics) ? h.topics.slice(0, 4) : []) as string[],
      slug: (h.slug || '') as string,
    }))
}

//GET /api/helplines?country=GB
router.get('/', helplinesLimiter, async (req: Request, res: Response): Promise<void> => {
  const country = ((req.query.country as string) || '').trim().toUpperCase()

  if (!country || !VALID_CC.test(country)) {
    res.fail('Invalid country code. Use ISO 3166-1 alpha-2 (e.g. GB, US, AU).', 400)
    return
  }

  const cached = cache.get(country)
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    res.setHeader('X-Cache', 'HIT')
    res.json({ data: cached.data, source: 'findahelpline.com', country })
    return
  }

  try {
    const data = await fetchFromFindAHelpline(country)
    cache.set(country, { data, ts: Date.now() })
    res.setHeader('X-Cache', 'MISS')
    res.json({ data, source: 'findahelpline.com', country })
  } catch {
    //Return empty -- client falls back to hardcoded data gracefully
    res.json({ data: [], source: 'findahelpline.com', country })
  }
})

export default router
