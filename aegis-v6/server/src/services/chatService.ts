/**
 * services/chatService.ts — LLM-powered chat with RAG and tool calling
 *
 * The AEGIS chatbot uses Retrieval-Augmented Generation (RAG) to answer
 * citizen questions with context from the knowledge base. It also has
 * access to "tools" — functions the LLM can invoke to look up real-time
 * data (weather, flood warnings, shelter locations, report status).
 *
 * Flow:
 *   1. Citizen sends message
 *   2. We embed the message and find relevant RAG documents
 *   3. We build a prompt with system instruction + RAG context + tools
 *   4. LLM generates a response (may include tool calls)
 *   5. If tool calls: execute them, inject results, re-call LLM
 *   6. Final response is returned and persisted
 *
 * Safety: All responses pass through a content filter that checks for
 * harmful advice before being sent to the citizen.
 */

import pool from '../models/db.js'
import { chatCompletion } from './llmRouter.js'
import { embedText } from './embeddingRouter.js'
import { classify } from './classifierRouter.js'
import { getActiveRegion } from '../config/regions.js'
import type { ChatCompletionRequest, ChatCompletionResponse, LLMTool } from '../types/index.js'
import crypto from 'crypto'
import { devLog } from '../utils/logger.js'

// ═══════════════════════════════════════════════════════════════════════════════
// §1  SYSTEM PROMPT
// ═══════════════════════════════════════════════════════════════════════════════

const region = getActiveRegion()

const SYSTEM_PROMPT = `You are AEGIS Assistant, an AI emergency guidance chatbot for the AEGIS disaster response platform deployed in ${region.name}.

Your role:
- Provide accurate emergency safety guidance
- Help citizens understand flood warnings and weather alerts
- Guide users on how to submit reports and use AEGIS features
- Provide information about nearby shelters and emergency contacts
- NEVER give medical diagnoses or legal advice
- ALWAYS recommend calling ${region.emergencyNumber} for life-threatening emergencies
- Be empathetic but factual — lives may depend on your accuracy
- If unsure, say so and direct to official sources (SEPA, Met Office, NHS)

Key facts about ${region.name}:
- Flood authority: ${region.floodAuthority}
- Emergency number: ${region.emergencyNumber}
- Rivers monitored: ${region.rivers.join(', ')}

When using data from tools, cite the source (e.g., "According to SEPA..." or "The latest Met Office data shows...").
Keep responses concise and actionable. Use bullet points for lists.`

// ═══════════════════════════════════════════════════════════════════════════════
// §1b  LIVE CONTEXT — real-time DB data injected into every prompt
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build a live situational snapshot from the database.
 * This is injected into the system prompt so the LLM has real-time awareness
 * without needing to call tools first.
 */
async function buildLiveContext(): Promise<string> {
  const parts: string[] = []
  const now = new Date().toISOString()

  // 1. Active alerts (last 24h, max 5)
  try {
    const { rows } = await pool.query(
      `SELECT title, severity, location_text, created_at
       FROM alerts
       WHERE is_active = true AND deleted_at IS NULL
         AND created_at > NOW() - INTERVAL '24 hours'
       ORDER BY CASE severity WHEN 'Critical' THEN 1 WHEN 'Warning' THEN 2 ELSE 3 END, created_at DESC
       LIMIT 5`,
    )
    if (rows.length > 0) {
      parts.push('ACTIVE ALERTS RIGHT NOW:')
      for (const r of rows) {
        parts.push(`  [${r.severity}] ${r.title} — ${r.location_text || 'Area-wide'} (${new Date(r.created_at).toLocaleString('en-GB')})`)
      }
    } else {
      parts.push('ACTIVE ALERTS: None currently active.')
    }
  } catch { parts.push('ACTIVE ALERTS: Data unavailable.') }

  // 2. Latest AI flood predictions (last 6h)
  try {
    const { rows } = await pool.query(
      `SELECT hazard_type, probability, confidence, region_name, created_at
       FROM predictions
       WHERE created_at > NOW() - INTERVAL '6 hours'
       ORDER BY probability DESC
       LIMIT 5`,
    )
    if (rows.length > 0) {
      parts.push('RECENT AI PREDICTIONS:')
      for (const r of rows) {
        const prob = typeof r.probability === 'number'
          ? (r.probability > 1 ? r.probability : (r.probability * 100)).toFixed(0)
          : '?'
        parts.push(`  ${r.hazard_type}: ${prob}% probability (confidence: ${((r.confidence || 0) * 100).toFixed(0)}%) — ${r.region_name || 'Unknown region'}`)
      }
    }
  } catch { /* predictions table may not exist */ }

  // 3. Latest river gauge levels (top 5 by recent reading)
  try {
    const { rows } = await pool.query(
      `SELECT station_name, water_level_m, normal_level_m, warning_level_m, recorded_at
       FROM river_levels
       WHERE recorded_at > NOW() - INTERVAL '2 hours'
       ORDER BY recorded_at DESC
       LIMIT 5`,
    )
    if (rows.length > 0) {
      parts.push('RIVER GAUGE LEVELS (latest):')
      for (const r of rows) {
        const level = parseFloat(r.water_level_m) || 0
        const warning = parseFloat(r.warning_level_m) || 999
        const status = level >= warning ? 'ABOVE WARNING' : level >= (parseFloat(r.normal_level_m) || 0) * 1.5 ? 'ELEVATED' : 'Normal'
        parts.push(`  ${r.station_name}: ${level.toFixed(2)}m [${status}] (${new Date(r.recorded_at).toLocaleTimeString('en-GB')})`)
      }
    }
  } catch { /* river_levels table may not exist */ }

  // 4. Recent weather observations
  try {
    const { rows } = await pool.query(
      `SELECT location_name, temperature_c, humidity_pct, wind_speed_ms, precipitation_mm, observed_at
       FROM weather_observations
       WHERE observed_at > NOW() - INTERVAL '3 hours'
       ORDER BY observed_at DESC
       LIMIT 3`,
    )
    if (rows.length > 0) {
      parts.push('WEATHER CONDITIONS:')
      for (const r of rows) {
        parts.push(`  ${r.location_name}: ${r.temperature_c}°C, Wind ${r.wind_speed_ms}m/s, Humidity ${r.humidity_pct}%, Rain ${r.precipitation_mm}mm`)
      }
    }
  } catch { /* weather_observations table may not exist */ }

  // 5. System threat level
  try {
    const { rows } = await pool.query(
      `SELECT threat_level, threat_score, assessment_summary, assessed_at
       FROM threat_assessments
       ORDER BY assessed_at DESC
       LIMIT 1`,
    )
    if (rows.length > 0 && rows[0].threat_level) {
      parts.push(`CURRENT THREAT LEVEL: ${rows[0].threat_level} (score: ${rows[0].threat_score || 'N/A'})`)
      if (rows[0].assessment_summary) {
        parts.push(`  Summary: ${rows[0].assessment_summary}`)
      }
    }
  } catch { /* threat_assessments table may not exist */ }

  if (parts.length === 0) return ''

  return '\n\n--- LIVE SITUATIONAL AWARENESS (as of ' + now + ') ---\n' +
    parts.join('\n') +
    '\n--- END SITUATIONAL AWARENESS ---\n' +
    'Use this data to provide informed, real-time responses. If a citizen asks about current conditions, reference this data directly.\n'
}

// ═══════════════════════════════════════════════════════════════════════════════
// §2  TOOLS (functions the LLM can call)
// ═══════════════════════════════════════════════════════════════════════════════

const AVAILABLE_TOOLS: LLMTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_active_alerts',
      description: 'Get currently active emergency alerts and flood warnings in the area',
      parameters: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['critical', 'warning', 'info', 'all'], description: 'Filter by severity' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Get current weather conditions and forecast',
      parameters: {
        type: 'object',
        properties: {
          location: { type: 'string', description: 'Location name (e.g., Aberdeen, Edinburgh)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_shelters',
      description: 'Find nearby emergency shelters with capacity and amenities',
      parameters: {
        type: 'object',
        properties: {
          lat: { type: 'number', description: 'Latitude' },
          lng: { type: 'number', description: 'Longitude' },
          radius_km: { type: 'number', description: 'Search radius in km (default 20)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_flood_risk',
      description: 'Check flood risk level for a specific location using PostGIS',
      parameters: {
        type: 'object',
        properties: {
          lat: { type: 'number', description: 'Latitude' },
          lng: { type: 'number', description: 'Longitude' },
        },
        required: ['lat', 'lng'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_wikipedia',
      description: 'Search Wikipedia for factual information about disasters, emergency procedures, geography, or any topic the citizen asks about',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query (e.g., "flood safety", "Aberdeen Scotland", "earthquake preparedness")' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_sepa_flood_alerts',
      description: 'Get live SEPA flood warning alerts for Scotland — current flood warnings and watch areas from the official SEPA RSS feed',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_met_office_warnings',
      description: 'Get current UK Met Office weather warnings (wind, rain, snow, fog, thunderstorm) — use when asked about weather warnings or forecasts',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'geocode_location',
      description: 'Convert a UK place name to coordinates. Use this when the citizen mentions a specific location to find flood risk or shelters nearby.',
      parameters: {
        type: 'object',
        properties: {
          place: { type: 'string', description: 'UK place name (e.g., "Bridge of Don, Aberdeen", "Riverside Drive")' },
        },
        required: ['place'],
      },
    },
  },
]

// ═══════════════════════════════════════════════════════════════════════════════
// §3  TOOL IMPLEMENTATIONS
// ═══════════════════════════════════════════════════════════════════════════════

async function executeToolCall(name: string, args: Record<string, unknown>): Promise<string> {
  try {
    switch (name) {
      case 'get_active_alerts': {
        const severity = args.severity as string || 'all'
        let query = `SELECT title, message, severity, location_text, created_at
                     FROM alerts WHERE is_active = true AND deleted_at IS NULL`
        const params: unknown[] = []

        if (severity !== 'all') {
          query += ` AND severity = $1`
          params.push(severity)
        }
        query += ` ORDER BY created_at DESC LIMIT 10`

        const { rows } = await pool.query(query, params)
        if (rows.length === 0) return 'No active alerts at this time.'
        return rows.map((r: any) =>
          `[${r.severity.toUpperCase()}] ${r.title} — ${r.location_text || 'Area-wide'} (${new Date(r.created_at).toLocaleDateString('en-GB')})`
        ).join('\n')
      }

      case 'get_weather': {
        const loc = args.location as string || region.name
        const apiKey = process.env.OPENWEATHER_API_KEY
        if (!apiKey) return 'Weather service unavailable — API key not configured.'

        const res = await fetch(
          `${region.weatherApi}/weather?q=${encodeURIComponent(loc)},GB&appid=${apiKey}&units=metric`,
        )
        if (!res.ok) return `Weather data unavailable for ${loc}.`
        const data = await res.json() as any
        return `Weather in ${loc}: ${data.weather?.[0]?.description || 'Unknown'}, ${Math.round(data.main?.temp)}°C, Wind: ${data.wind?.speed} m/s, Humidity: ${data.main?.humidity}%`
      }

      case 'find_shelters': {
        const lat = args.lat as number || region.center[0]
        const lng = args.lng as number || region.center[1]
        const radius = (args.radius_km as number || 20) * 1000

        const { rows } = await pool.query(
          `SELECT name, address, capacity, current_occupancy, shelter_type, amenities, phone,
                  ST_Distance(coordinates::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) / 1000 as distance_km
           FROM shelters
           WHERE is_active = true
             AND ST_DWithin(coordinates::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
           ORDER BY distance_km
           LIMIT 5`,
          [lng, lat, radius],
        )

        if (rows.length === 0) return 'No shelters found in the search area.'
        return rows.map((r: any) =>
          `📍 ${r.name} (${r.distance_km.toFixed(1)} km away)\n   Address: ${r.address}\n   Capacity: ${r.current_occupancy}/${r.capacity} | Type: ${r.shelter_type}\n   Amenities: ${r.amenities.join(', ')}\n   Phone: ${r.phone || 'N/A'}`
        ).join('\n\n')
      }

      case 'get_flood_risk': {
        const lat = args.lat as number
        const lng = args.lng as number

        const { rows } = await pool.query(
          `SELECT zone_name, flood_type, probability
           FROM flood_zones
           WHERE ST_Contains(geometry, ST_SetSRID(ST_MakePoint($1, $2), 4326))
           ORDER BY probability DESC`,
          [lng, lat],
        )

        if (rows.length === 0) return 'This location is not within any mapped flood zone.'
        return rows.map((r: any) =>
          `Flood zone: ${r.zone_name || 'Unnamed'} — Type: ${r.flood_type}, Probability: ${r.probability}`
        ).join('\n')
      }

      case 'search_wikipedia': {
        const query = args.query as string
        if (!query) return 'No search query provided.'

        const searchUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query.trim().replace(/ /g, '_'))}`
        const res = await fetch(searchUrl, {
          headers: { 'User-Agent': 'AEGIS-DisasterResponse/1.0 (aegis.gov.uk)' },
        })

        if (res.status === 404) {
          // Try search API fallback
          const searchRes = await fetch(
            `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=1&format=json`,
            { headers: { 'User-Agent': 'AEGIS-DisasterResponse/1.0 (aegis.gov.uk)' } },
          )
          if (!searchRes.ok) return `No Wikipedia article found for "${query}".`
          const searchData = await searchRes.json() as any
          const title = searchData.query?.search?.[0]?.title
          if (!title) return `No Wikipedia article found for "${query}".`

          const retryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`
          const retryRes = await fetch(retryUrl, { headers: { 'User-Agent': 'AEGIS-DisasterResponse/1.0' } })
          if (!retryRes.ok) return `No Wikipedia article found for "${query}".`
          const retryData = await retryRes.json() as any
          return `📖 **${retryData.title}** (Wikipedia)\n\n${retryData.extract || 'No summary available.'}\n\n_Source: en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}_`
        }

        if (!res.ok) return `Wikipedia search failed for "${query}".`
        const data = await res.json() as any
        return `📖 **${data.title}** (Wikipedia)\n\n${data.extract || 'No summary available.'}\n\n_Source: ${data.content_urls?.desktop?.page || 'en.wikipedia.org'}_`
      }

      case 'get_sepa_flood_alerts': {
        // Parse SEPA flood warnings RSS feed
        const rssRes = await fetch('https://www.sepa.org.uk/rss/current-flood-warnings.rss', {
          headers: { 'User-Agent': 'AEGIS-DisasterResponse/1.0' },
          signal: AbortSignal.timeout(6000),
        })
        if (!rssRes.ok) return 'SEPA flood alert feed is temporarily unavailable. Check sepa.org.uk/environment/water/flooding/ for current warnings.'

        const rssText = await rssRes.text()
        // Extract items from RSS XML
        const items = [...rssText.matchAll(/<item>([\s\S]*?)<\/item>/g)]
        if (items.length === 0) return 'No current SEPA flood warnings are in effect for Scotland.'

        const warnings = items.slice(0, 5).map(m => {
          const title = (m[1].match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || m[1].match(/<title>(.*?)<\/title>/))?.[1] || 'Unknown'
          const desc = (m[1].match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) || m[1].match(/<description>(.*?)<\/description>/))?.[1] || ''
          return `⚠️ ${title.replace(/<[^>]+>/g, '').trim()}${desc ? ` — ${desc.replace(/<[^>]+>/g, '').slice(0, 100).trim()}` : ''}`
        })

        return `**Live SEPA Flood Warnings** (${new Date().toLocaleDateString('en-GB')}):\n\n${warnings.join('\n')}\n\n_Source: SEPA — sepa.org.uk_`
      }

      case 'get_met_office_warnings': {
        // Met Office DataHub weather warnings
        const moRes = await fetch(
          'https://api-proxy.metoffice.gov.uk/map-material/weather/maps/warnings',
          {
            headers: {
              'User-Agent': 'AEGIS-DisasterResponse/1.0',
              Accept: 'application/json',
            },
            signal: AbortSignal.timeout(6000),
          }
        )

        if (!moRes.ok) {
          // Fallback to Met Office RSS
          const rssRes = await fetch('https://www.metoffice.gov.uk/public/data/PWSCache/WarningsRSS/Region/UK', {
            headers: { 'User-Agent': 'AEGIS-DisasterResponse/1.0' },
            signal: AbortSignal.timeout(5000),
          }).catch(() => null)

          if (!rssRes?.ok) return 'Met Office warnings unavailable. Check metoffice.gov.uk/weather/warnings-and-advice for current warnings.'

          const rssText = await rssRes.text()
          const items = [...rssText.matchAll(/<item>([\s\S]*?)<\/item>/g)]
          if (items.length === 0) return 'No current Met Office weather warnings for the UK.'
          const warnings = items.slice(0, 4).map(m => {
            const title = (m[1].match(/<title>(.*?)<\/title>/))?.[1] || 'Warning'
            return `⚠️ ${title.replace(/<!\[CDATA\[|\]\]>/g, '').trim()}`
          })
          return `**Met Office Warnings:**\n\n${warnings.join('\n')}\n\n_Source: Met Office — metoffice.gov.uk_`
        }

        const moData = await moRes.json() as any
        const features = moData?.features || moData?.warnings || []
        if (!features.length) return 'No current Met Office weather warnings in effect.'

        const warnings = features.slice(0, 5).map((f: any) => {
          const props = f.properties || f
          return `⚠️ ${props.type || 'Warning'} — ${props.description || props.headline || 'See metoffice.gov.uk for details'}`
        })
        return `**Met Office Weather Warnings:**\n\n${warnings.join('\n')}\n\n_Source: Met Office DataHub_`
      }

      case 'geocode_location': {
        const place = args.place as string
        if (!place) return 'No location provided.'

        // Use Nominatim (OpenStreetMap) — free, no key needed
        const nomRes = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(place)}&format=json&limit=1&countrycodes=gb`,
          {
            headers: { 'User-Agent': 'AEGIS-DisasterResponse/1.0 (aegis.gov.uk)' },
            signal: AbortSignal.timeout(5000),
          }
        )
        if (!nomRes.ok) return `Could not geocode "${place}".`

        const nomData = await nomRes.json() as any[]
        if (!nomData.length) return `Could not find "${place}" in the UK. Try a more specific name.`

        const loc = nomData[0]
        const lat = parseFloat(loc.lat)
        const lng = parseFloat(loc.lon)
        return `📍 **${loc.display_name}**\nCoordinates: ${lat.toFixed(4)}, ${lng.toFixed(4)}\nType: ${loc.type || 'location'}\n\n_Use these coordinates to check flood risk or find nearby shelters._`
      }

      default:
        return `Tool '${name}' is not available.`
    }
  } catch (err: any) {
    console.error(`[Chat] Tool ${name} failed: ${err.message}`)
    return `Unable to retrieve data (${name}). Please try again.`
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §4  RAG — Retrieve relevant knowledge base documents
// ═══════════════════════════════════════════════════════════════════════════════

async function retrieveRAGContext(query: string, limit = 3): Promise<string> {
  try {
    // Phase 1: Try vector similarity search using real embeddings + cosine_similarity()
    try {
      const embedding = await embedText(query)
      if (embedding && embedding.length > 0) {
        const pgArray = `{${embedding.join(',')}}`

        const { rows } = await pool.query(
          `SELECT title, content, source,
            cosine_similarity(embedding_vector, $1::double precision[]) as similarity
           FROM rag_documents
           WHERE embedding_vector IS NOT NULL
             AND array_length(embedding_vector, 1) = $2
           ORDER BY cosine_similarity(embedding_vector, $1::double precision[]) DESC
           LIMIT $3`,
          [pgArray, embedding.length, limit],
        )

        if (rows.length > 0) {
          devLog(`[Chat RAG] Vector search returned ${rows.length} docs (top similarity: ${rows[0].similarity?.toFixed(3)})`)
          return '\n\n--- RELEVANT KNOWLEDGE BASE ---\n' +
            rows.map((r: any) => `[${r.source}] ${r.title}:\n${r.content}`).join('\n\n') +
            '\n--- END KNOWLEDGE BASE ---\n'
        }
      }
    } catch (embErr: any) {
      console.warn(`[Chat RAG] Embedding unavailable: ${embErr.message} — falling through to text search`)
    }

    // Phase 2: Full-text search fallback
    const { rows } = await pool.query(
      `SELECT title, content, source
       FROM rag_documents
       WHERE to_tsvector('english', content) @@ plainto_tsquery('english', $1)
       LIMIT $2`,
      [query, limit],
    )
    if (rows.length > 0) {
      devLog(`[Chat RAG] Full-text search returned ${rows.length} docs`)
      return '\n\n--- RELEVANT KNOWLEDGE BASE ---\n' +
        rows.map((r: any) => `[${r.source}] ${r.title}:\n${r.content}`).join('\n\n') +
        '\n--- END KNOWLEDGE BASE ---\n'
    }

    return ''
  } catch (err: any) {
    console.warn(`[Chat] RAG retrieval error: ${err.message}`)
    return ''
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §5  RESPONSE CACHE
// ═══════════════════════════════════════════════════════════════════════════════

function hashQuery(text: string): string {
  return crypto.createHash('sha256').update(text.toLowerCase().trim()).digest('hex')
}

async function getCachedResponse(queryHash: string): Promise<string | null> {
  try {
    const { rows } = await pool.query(
      `UPDATE response_cache SET hit_count = hit_count + 1
       WHERE query_hash = $1 AND expires_at > now()
       RETURNING response_text`,
      [queryHash],
    )
    return rows.length > 0 ? rows[0].response_text : null
  } catch {
    return null
  }
}

async function cacheResponse(queryHash: string, queryText: string, response: string, model: string): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO response_cache (query_hash, query_text, response_text, model_used, ttl_seconds, expires_at)
       VALUES ($1, $2, $3, $4, 3600, now() + INTERVAL '1 hour')
       ON CONFLICT (query_hash) DO UPDATE SET
         response_text = $3, model_used = $4, hit_count = 0,
         expires_at = now() + INTERVAL '1 hour'`,
      [queryHash, queryText, response, model],
    )
  } catch (err: any) {
    console.warn(`[Chat] Cache write failed: ${err.message}`)
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §6  SAFETY FILTER
// ═══════════════════════════════════════════════════════════════════════════════

const UNSAFE_PATTERNS = [
  /\b(kill|suicide|self.?harm|overdose)\b/i,
  /\bhow to (make|build|create) (a )?(bomb|weapon|explosive)/i,
  /\billegal (drug|substance)/i,
]

function checkSafety(text: string): string[] {
  const flags: string[] = []
  for (const pattern of UNSAFE_PATTERNS) {
    if (pattern.test(text)) {
      flags.push(pattern.source)
    }
  }
  return flags
}

// ═══════════════════════════════════════════════════════════════════════════════
// §6b  LOCAL KEYWORD FALLBACK (when no LLM providers are configured)
// ═══════════════════════════════════════════════════════════════════════════════

const LOCAL_RESPONSES: Array<{ patterns: RegExp[]; response: string }> = [
  {
    patterns: [/flood/i, /water\s*level/i, /river\s*(level|rise|burst)/i],
    response: `**Flood Safety Guidance:**\n\n• Move to higher ground immediately if water is rising\n• Do NOT walk or drive through flood water — 15cm can knock you over, 60cm can float a car\n• Call **${region.emergencyNumber}** if in immediate danger\n• Turn off gas, electricity, and water at the mains if safe\n• Move valuables and medicines upstairs\n• Check SEPA flood warnings: https://www.sepa.org.uk/environment/water/flooding/\n\n_This is an automated safety response. For real-time AI assistance, configure LLM API keys._`,
  },
  {
    patterns: [/earthquake|quake|tremor|seismic/i],
    response: `**Earthquake Safety:**\n\n• **DROP, COVER, HOLD ON** — get under sturdy furniture\n• Stay away from windows, mirrors, and heavy objects\n• If outdoors, move to an open area away from buildings\n• After shaking stops: check for injuries, expect aftershocks\n• Do NOT use elevators\n• Call **${region.emergencyNumber}** if injured or trapped`,
  },
  {
    patterns: [/fire|wildfire|blaze|smoke/i],
    response: `**Fire Safety:**\n\n• Get out, stay out, call **${region.emergencyNumber}**\n• Crawl low under smoke — cleaner air is near the floor\n• Feel doors before opening — if hot, use another route\n• Close doors behind you to slow the fire\n• Never go back inside a burning building\n• Meet at your pre-arranged assembly point`,
  },
  {
    patterns: [/storm|wind|hurricane|tornado|lightning|thunder/i],
    response: `**Storm Safety:**\n\n• Stay indoors away from windows\n• Unplug electrical appliances\n• Avoid using landline phones during lightning\n• If outdoors: avoid trees, metal fences, and high ground\n• Check Met Office warnings: https://www.metoffice.gov.uk/weather/warnings-and-advice\n• Secure loose outdoor items (bins, furniture, trampolines)`,
  },
  {
    patterns: [/shelter|evacuat|refuge|safe\s*place/i],
    response: `**Emergency Shelters:**\n\nI can help you find nearby shelters. Use the AEGIS map to see shelter locations marked with 🏠 icons.\n\nGeneral guidance:\n• Follow official evacuation routes\n• Bring medications, ID, phone charger, warm clothing\n• Register at the shelter so rescuers know you're safe\n• If you need immediate shelter, call **${region.emergencyNumber}**`,
  },
  {
    patterns: [/first\s*aid|injur|bleed|cpr|unconscious/i],
    response: `**First Aid Basics (call ${region.emergencyNumber} for serious injuries):**\n\n• **Bleeding:** Apply firm pressure with a clean cloth\n• **Burns:** Cool under running water for 20 minutes\n• **Unconscious/breathing:** Place in recovery position\n• **Not breathing:** Start CPR (30 compressions, 2 breaths)\n• **Do NOT** move someone with suspected spinal injury\n\n_This is general guidance, not medical advice._`,
  },
  {
    patterns: [/report|submit|incident/i],
    response: `**Submitting a Report:**\n\n1. Go to the AEGIS dashboard\n2. Click "Submit Report" or the + button\n3. Describe the emergency — include location and severity\n4. Attach photos if safe to do so\n5. Your report will be automatically classified by AI and routed to responders\n\nReports are processed in real time and appear on the live map.`,
  },
  {
    patterns: [/help|hello|hi|hey|what can you/i],
    response: `Hello! I'm the AEGIS Emergency Assistant. I can help with:\n\n• 🌊 **Flood safety** and river warnings\n• 🔥 **Fire safety** guidance\n• ⛈️ **Storm preparedness**\n• 🏠 **Emergency shelters** near you\n• 🩹 **First aid** basics\n• 📋 **Report submission** help\n• 🌍 **Earthquake** and other hazard guidance\n\nWhat do you need help with?`,
  },
]

function generateLocalFallback(message: string): string {
  const lower = message.toLowerCase()
  for (const entry of LOCAL_RESPONSES) {
    if (entry.patterns.some(p => p.test(lower))) {
      return entry.response
    }
  }
  return `I understand your concern. Here's what you can do:\n\n• For **life-threatening emergencies**, call **${region.emergencyNumber}** immediately\n• Check the **AEGIS map** for real-time alerts and shelter locations\n• Use the **report system** to notify emergency services of incidents\n• Visit **SEPA** (sepa.org.uk) or **Met Office** (metoffice.gov.uk) for official warnings\n\nI'm currently running in offline mode with limited capabilities. For full AI-powered assistance, the system administrator needs to configure LLM API keys.`
}

// ═══════════════════════════════════════════════════════════════════════════════
// §6c  SPECIALIST AGENT ROUTING (Features #35-37)
// ═══════════════════════════════════════════════════════════════════════════════

type AgentType = 'crisis_responder' | 'trauma_support' | 'preparedness_coach'

interface AgentProfile {
  name: string
  systemAddendum: string
  temperature: number
}

const AGENTS: Record<AgentType, AgentProfile> = {
  crisis_responder: {
    name: 'CrisisResponder',
    systemAddendum: `\n\nYou are now in CRISIS MODE. The citizen appears to be in an active emergency.
- Prioritise IMMEDIATE SAFETY actions
- Give step-by-step evacuation guidance
- Provide exact emergency numbers
- Keep responses SHORT and CLEAR — they may be reading on a phone in bad conditions
- Ask: Are you in immediate danger? Is anyone injured? Can you move to higher ground?`,
    temperature: 0.3,
  },
  trauma_support: {
    name: 'TraumaSupport',
    systemAddendum: `\n\nThe citizen appears to be distressed or traumatised.
- Use warm, empathetic language
- Validate their feelings: "It's completely natural to feel this way"
- Provide mental health resources: NHS 24 (111), Samaritans (116 123), CALM (0800 585858)
- Gently guide them toward practical next steps
- Do NOT minimise their experience
- If they express suicidal ideation, provide crisis numbers IMMEDIATELY`,
    temperature: 0.7,
  },
  preparedness_coach: {
    name: 'PreparednessCoach',
    systemAddendum: `\n\nThe citizen is asking about emergency preparedness and planning.
- Provide detailed, actionable preparation checklists
- Reference UK-specific resources (SEPA, Met Office, Ready Scotland)
- Include practical items: emergency kit contents, evacuation routes, communication plans
- Be thorough but avoid overwhelming — break into manageable steps
- Suggest local council resources and community flood groups`,
    temperature: 0.6,
  },
}

/**
 * Route a message to the appropriate specialist agent based on
 * emotion classification and intent keywords.
 */
async function routeToAgent(message: string): Promise<{ agent: AgentType; confidence: number; emotion: string }> {
  let emotion = 'neutral'
  let emotionConfidence = 0

  // Try HuggingFace emotion classification
  try {
    const emotionResult = await classify({
      text: message,
      task: 'sentiment', // Uses the sentiment classifier for emotion proxy
    })
    emotion = emotionResult.label?.toLowerCase() || 'neutral'
    emotionConfidence = emotionResult.score || 0
  } catch {
    // Emotion classification unavailable — use keyword fallback
  }

  const lower = message.toLowerCase()

  // Crisis indicators (active emergency)
  const crisisKeywords = ['help me', 'trapped', 'drowning', 'water rising', 'can\'t move',
    'emergency', 'danger', 'dying', 'save', 'rescue', 'flooding now', 'stuck', 'injured']
  const crisisScore = crisisKeywords.filter(k => lower.includes(k)).length

  // Trauma indicators (emotional distress)
  const traumaKeywords = ['scared', 'terrified', 'panic', 'anxiety', 'lost everything',
    'can\'t sleep', 'nightmare', 'worried', 'stress', 'afraid', 'upset', 'cry', 'crying']
  const traumaScore = traumaKeywords.filter(k => lower.includes(k)).length

  // Preparedness indicators (planning)
  const prepKeywords = ['prepare', 'plan', 'kit', 'checklist', 'before flood',
    'what should i', 'how to prepare', 'insurance', 'sandbag', 'flood barrier', 'prevent']
  const prepScore = prepKeywords.filter(k => lower.includes(k)).length

  // Combine keyword scores with emotion classification
  if (crisisScore >= 2 || (emotion === 'negative' && crisisScore >= 1 && emotionConfidence > 0.7)) {
    return { agent: 'crisis_responder', confidence: Math.min(0.95, 0.5 + crisisScore * 0.15), emotion }
  }

  if (traumaScore >= 2 || (emotion === 'negative' && emotionConfidence > 0.8 && crisisScore === 0)) {
    return { agent: 'trauma_support', confidence: Math.min(0.9, 0.4 + traumaScore * 0.15), emotion }
  }

  if (prepScore >= 1) {
    return { agent: 'preparedness_coach', confidence: Math.min(0.85, 0.4 + prepScore * 0.2), emotion }
  }

  // Default: preparedness coach (safest general agent)
  return { agent: 'preparedness_coach', confidence: 0.4, emotion }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §7  PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Process a chat message through the full pipeline:
 * cache check → RAG retrieval → LLM completion → tool execution → safety filter → persist
 */
export async function processChat(req: ChatCompletionRequest): Promise<ChatCompletionResponse> {
  const queryHash = hashQuery(req.message)

  // Check cache first
  const cached = await getCachedResponse(queryHash)
  if (cached) {
    return {
      sessionId: req.sessionId || '',
      reply: cached,
      model: 'cache',
      tokensUsed: 0,
      toolsUsed: [],
      sources: [],
      safetyFlags: [],
    }
  }

  // Get or create session
  let sessionId = req.sessionId
  if (sessionId) {
    // Check if session exists; if not, create it with the provided ID
    const existing = await pool.query(`SELECT id FROM chat_sessions WHERE id = $1`, [sessionId])
    if (existing.rows.length === 0) {
      await pool.query(
        `INSERT INTO chat_sessions (id, citizen_id, operator_id, title, model_used)
         VALUES ($1, $2, $3, $4, 'pending')`,
        [sessionId, req.citizenId || null, req.operatorId || null, req.message.slice(0, 100)],
      )
    }
  } else {
    const result = await pool.query(
      `INSERT INTO chat_sessions (citizen_id, operator_id, title, model_used)
       VALUES ($1, $2, $3, 'pending')
       RETURNING id`,
      [req.citizenId || null, req.operatorId || null, req.message.slice(0, 100)],
    )
    sessionId = result.rows[0].id
  }

  // Persist user message
  await pool.query(
    `INSERT INTO chat_messages (session_id, role, content) VALUES ($1, 'user', $2)`,
    [sessionId, req.message],
  )

  // Retrieve RAG context
  const ragContext = await retrieveRAGContext(req.message)

  // Build live situational context from DB
  const liveContext = await buildLiveContext()

  // Auto-detect language from message (HuggingFace language classifier)
  let detectedLanguage = 'en'
  let languageInstruction = ''
  try {
    const langResult = await classify({ text: req.message, task: 'language' })
    if (langResult.label && langResult.score > 0.7 && langResult.label !== 'en') {
      detectedLanguage = langResult.label
      languageInstruction = `\n\nIMPORTANT: The user is writing in language code "${langResult.label}". Respond in that same language unless they ask you to switch.`
    }
  } catch {
    // Language detection failure is non-critical — continue in English
  }

  // Route to specialist agent based on emotion/intent
  const routing = await routeToAgent(req.message)
  const agent = AGENTS[routing.agent]

  // Load conversation history (last 10 messages)
  const { rows: history } = await pool.query(
    `SELECT role, content FROM chat_messages
     WHERE session_id = $1
     ORDER BY created_at ASC
     LIMIT 20`,
    [sessionId],
  )

  // Build messages array with specialist agent context + live situational data
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: SYSTEM_PROMPT + agent.systemAddendum + languageInstruction + liveContext + ragContext },
    ...history.map((h: any) => ({
      role: h.role as 'user' | 'assistant',
      content: h.content,
    })),
  ]

  // Call LLM — NO silent fallback. If no API keys configured, propagate the error.
  let response: { content: string; model: string; tokensUsed: number; latencyMs: number }
  try {
    response = await chatCompletion({
      messages,
      maxTokens: 1024,
      temperature: agent.temperature,
    })
  } catch (llmErr: any) {
    // Propagate a clear, actionable error — do NOT silently fall back to heuristic
    console.error(`[Chat] LLM ERROR: ${llmErr.message}`)

    const errorReply =
      `⚠️ **AI Engine Unavailable**\n\n` +
      `The AEGIS chatbot requires a configured LLM provider to function.\n\n` +
      `**Required:** Set at least one of these in your \`.env\` file:\n` +
      `- \`GEMINI_API_KEY\` — Google Gemini Flash (free tier)\n` +
      `- \`GROQ_API_KEY\` — Groq Llama 3.1 (free tier)\n` +
      `- \`OPENROUTER_API_KEY\` — OpenRouter free models\n` +
      `- \`HF_API_KEY\` — HuggingFace Inference\n\n` +
      `**Error:** ${llmErr.message}\n\n` +
      `For life-threatening emergencies, call **999** (UK) immediately.`

    await pool.query(
      `INSERT INTO chat_messages (session_id, role, content, model_used, tokens_used, latency_ms)
       VALUES ($1, 'assistant', $2, 'error-no-llm', 0, 0)`,
      [sessionId, errorReply],
    )

    return {
      sessionId: sessionId!,
      reply: errorReply,
      model: 'error-no-llm',
      tokensUsed: 0,
      toolsUsed: [],
      sources: [],
      safetyFlags: ['llm_unavailable'],
    }
  }

  const toolsUsed: string[] = []
  let finalReply = response.content

  // Handle tool calls if the LLM requests them
  // (Note: tool calling support varies by provider; this handles providers
  // that embed tool-call instructions in the text)
  const toolCallPattern = /\[TOOL_CALL: (\w+)\((.*?)\)\]/g
  let match: RegExpExecArray | null
  while ((match = toolCallPattern.exec(finalReply)) !== null) {
    const [fullMatch, toolName, argsStr] = match
    try {
      const args = JSON.parse(argsStr || '{}')
      const result = await executeToolCall(toolName, args)
      finalReply = finalReply.replace(fullMatch, result)
      toolsUsed.push(toolName)
    } catch {
      finalReply = finalReply.replace(fullMatch, '[Tool unavailable]')
    }
  }

  // Safety check
  const safetyFlags = checkSafety(finalReply)
  if (safetyFlags.length > 0) {
    finalReply = 'I understand you may be in distress. Please contact emergency services immediately:\n' +
      `📞 ${region.emergencyNumber} (Emergency)\n` +
      '📞 116 123 (Samaritans - 24/7)\n' +
      '📞 111 (NHS 24 - Scotland)\n\n' +
      'You are not alone. Help is available.'
  }

  // Persist assistant message
  await pool.query(
    `INSERT INTO chat_messages (session_id, role, content, model_used, tokens_used, latency_ms)
     VALUES ($1, 'assistant', $2, $3, $4, $5)`,
    [sessionId, finalReply, response.model, response.tokensUsed, response.latencyMs],
  )

  // Update session stats
  await pool.query(
    `UPDATE chat_sessions
     SET total_tokens = total_tokens + $1, model_used = $2, updated_at = now()
     WHERE id = $3`,
    [response.tokensUsed, response.model, sessionId],
  )

  // Cache the response (only if no tools were used — tool results change)
  if (toolsUsed.length === 0 && safetyFlags.length === 0) {
    await cacheResponse(queryHash, req.message, finalReply, response.model)
  }

  // Extract source citations from RAG context
  const sources: Array<{ title: string; relevance: number }> = []
  if (ragContext) {
    const sourcePattern = /\[([^\]]+)\] ([^:]+):/g
    let sourceMatch: RegExpExecArray | null
    while ((sourceMatch = sourcePattern.exec(ragContext)) !== null) {
      sources.push({ title: `${sourceMatch[2]} (${sourceMatch[1]})`, relevance: 0.8 })
    }
  }

  return {
    sessionId: sessionId!,
    reply: finalReply,
    model: response.model,
    tokensUsed: response.tokensUsed,
    toolsUsed,
    sources,
    safetyFlags,
    confidence: routing.confidence,
    agent: agent.name,
    emotion: routing.emotion,
  }
}

/**
 * Get chat history for a session.
 */
export async function getChatHistory(sessionId: string): Promise<Array<{ role: string; content: string; createdAt: string }>> {
  const { rows } = await pool.query(
    `SELECT role, content, created_at FROM chat_messages
     WHERE session_id = $1
     ORDER BY created_at ASC`,
    [sessionId],
  )
  return rows.map((r: any) => ({
    role: r.role,
    content: r.content,
    createdAt: r.created_at,
  }))
}

/**
 * List chat sessions for a citizen or operator.
 */
export async function listSessions(
  userId: string, userType: 'citizen' | 'operator',
): Promise<Array<{ id: string; title: string; status: string; createdAt: string }>> {
  const field = userType === 'citizen' ? 'citizen_id' : 'operator_id'
  const { rows } = await pool.query(
    `SELECT id, title, status, created_at
     FROM chat_sessions
     WHERE ${field} = $1
     ORDER BY updated_at DESC
     LIMIT 50`,
    [userId],
  )
  return rows.map((r: any) => ({
    id: r.id,
    title: r.title || 'Untitled',
    status: r.status,
    createdAt: r.created_at,
  }))
}
