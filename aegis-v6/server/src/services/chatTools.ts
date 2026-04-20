/**
 * Tool schemas (AVAILABLE_TOOLS, ADMIN_TOOLS) and all tool call implementations.
 *
 * executeToolCall() dispatches to the correct handler by tool name.
 * executeImageAnalysis() handles vision inference via multiple backends.
 * executeCompositeToolCalls() runs multiple tools in parallel.
 */
import pool from '../models/db.js'
import { logger } from './logger.js'
import { devLog } from '../utils/logger.js'
import { fetchWithTimeout } from '../utils/fetchWithTimeout.js'
import type { LLMTool } from '../types/index.js'
import { region, regionAdapter, llmCtx, regionMeta } from './chatConstants.js'

export const AVAILABLE_TOOLS: LLMTool[] = [
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
      name: 'get_flood_alerts',
      description: `Get live flood warning alerts for ${regionMeta.name} -- current flood warnings and watch areas from ${llmCtx.floodAuthority}`,
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_weather_warnings',
      description: `Get current ${llmCtx.weatherAuthority} weather warnings (wind, rain, snow, fog, thunderstorm) -- use when asked about weather warnings or forecasts`,
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'geocode_location',
      description: `Convert a place name to coordinates. Use this when the citizen mentions a specific location to find flood risk or shelters nearby.`,
      parameters: {
        type: 'object',
        properties: {
          place: { type: 'string', description: `Place name (e.g., ${llmCtx.exampleLocations.slice(0, 2).map(l => `"${l}"`).join(', ') || '"City centre"'})` },
        },
        required: ['place'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_evacuation_routes',
      description: 'Get evacuation routes from a location. Returns recommended routes, estimated travel times, and current road conditions.',
      parameters: {
        type: 'object',
        properties: {
          lat: { type: 'number', description: 'Latitude of origin' },
          lng: { type: 'number', description: 'Longitude of origin' },
          hazard_type: { type: 'string', description: 'Type of hazard to evacuate from (flood, wildfire, etc.)' },
        },
        required: ['lat', 'lng'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_nearby_hospitals',
      description: 'Find nearest hospitals and medical facilities with their current status and capacity.',
      parameters: {
        type: 'object',
        properties: {
          lat: { type: 'number', description: 'Latitude' },
          lng: { type: 'number', description: 'Longitude' },
          radius_km: { type: 'number', description: 'Search radius in km (default 30)' },
        },
        required: ['lat', 'lng'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_incident_clusters',
      description: 'Get clusters of related incidents in an area to identify hotspots and patterns.',
      parameters: {
        type: 'object',
        properties: {
          incident_type: { type: 'string', description: 'Filter by incident type (flood, fire, storm, etc.) or "all"' },
          hours: { type: 'number', description: 'Look back period in hours (default 24)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_report_status',
      description: 'Check the status of an incident report previously submitted by the citizen. Returns current status, priority, and any operator notes.',
      parameters: {
        type: 'object',
        properties: {
          report_id: { type: 'string', description: 'The report/incident ID (e.g., "INC-12345")' },
        },
        required: ['report_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_infrastructure_status',
      description: 'Check status of local infrastructure -- roads, bridges, power grid, water supply in an area.',
      parameters: {
        type: 'object',
        properties: {
          area: { type: 'string', description: 'Area or road name to check' },
          infrastructure_type: { type: 'string', enum: ['roads', 'bridges', 'power', 'water', 'all'], description: 'Type of infrastructure to check' },
        },
        required: ['area'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_historical_comparison',
      description: 'Compare current conditions with historical events to provide context (e.g., "Is this flood worse than January 2024?").',
      parameters: {
        type: 'object',
        properties: {
          hazard_type: { type: 'string', description: 'Type of hazard to compare (flood, storm, etc.)' },
          location: { type: 'string', description: 'Location for historical comparison' },
        },
        required: ['hazard_type'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web for real-time information about current events, disasters, news, weather conditions, emergency updates, or any topic. Use this when the citizen asks about something happening RIGHT NOW that may not be in the knowledge base.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query (e.g., "current flooding UK March 2026", "earthquake today")' },
          num_results: { type: 'number', description: 'Number of results to return (default 5, max 10)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'analyze_image',
      description: 'Analyze an uploaded image using AI vision. Citizens can upload photos of ANY disaster situation -- flooding, structural damage, wildfire smoke, storm damage, injuries, road conditions, water contamination, landslides, fallen trees, chemical spills, or any safety concern. The AI will describe what it sees and provide relevant safety guidance.',
      parameters: {
        type: 'object',
        properties: {
          image_url: { type: 'string', description: 'URL or path of the uploaded image to analyze' },
          context: { type: 'string', description: 'Optional context from the citizen about what the photo shows (e.g., "my street", "the river near my house")' },
        },
        required: ['image_url'],
      },
    },
  },
]


export const ADMIN_SYSTEM_ADDENDUM = `

## OPERATOR MODE -- Advanced Command & Control Intelligence

You are now operating in **ADMIN/OPERATOR MODE**. The user is an authenticated emergency management operator with elevated privileges. Adjust your behaviour:

/**
* *OPERATOR-SPECIFIC CAPABILITIES:
- Provide tactical incident analysis and pattern recognition across all active incidents
- Generate situation reports (SITREPs) summarising current operational status
- Recommend resource deployment decisions based on current data
- Analyse incident trends and predict resource needs with time-horizon projections
- Provide inter-agency coordination advice using ICS/NIMS frameworks
- Summarise citizen sentiment and community impact with actionable insights
- Perform comparative analysis: current situation vs historical events
- Generate decision matrices for complex multi-incident scenarios
- Identify cascading failure risks (e.g., flood ? power outage ? medical equipment failure)
- Provide shift handover briefings with critical context

/**
* *RESPONSE CALIBRATION FOR OPERATORS:
- Use professional emergency management terminology (ICS/NIMS where applicable)
- Be more technical and data-driven -- operators can handle raw statistics
- Include decision support: "Based on X incidents in Y hours, consider Z"
- Reference specific report IDs, alert IDs, and coordinate data when available
- When multiple incidents are active, provide prioritisation recommendations using METHANE format
- Proactively suggest resource reallocation when patterns indicate shifting risk
- Include confidence levels on predictions: "High confidence (>80%): surge expected in 6h"
- When presenting options, use structured decision matrices with pros/cons/risk scores
- Provide early warning indicators: "Watch for: X, Y, Z -- these preceded the 2024 incident"

/**
* *OPERATIONAL INTELLIGENCE FRAMEWORK:
For every operational question, provide:
1. **Current State** -- What is happening right now (data-driven, with specific numbers)
2. **Trend Analysis** -- Is the situation improving (?), stable (?), or worsening (?)? Rate of change?
3. **Prediction** -- What will happen in 2h, 6h, 12h based on current trajectory
4. **Recommendation** -- Specific actionable recommendation with rationale and alternatives
5. **Risk Assessment** -- What could go wrong if no action is taken. Cascading risks.
6. **Resource Calculus** -- What resources are needed vs available. Gap analysis.
7. **Precedent** -- Has this situation occurred before? What worked/failed?

/**
* *MULTI-INCIDENT CORRELATION:
When multiple incidents are active:
- Identify causal chains and interconnected risks
- Prioritise by life safety > property protection > environmental
- Suggest unified command structure when incidents overlap
- Flag resource conflicts between simultaneous operations

/**
* *SITREP GENERATION FORMAT (when using generate_sitrep tool):
METHANE format for major incidents:
- M: Major incident declared (yes/no)
- E: Exact location (grid reference, postcode, landmark)
- T: Type of incident (flood/fire/storm/multi-hazard)
- H: Hazards present and potential
- A: Access routes (open/blocked/restricted)
- N: Number of casualties (confirmed, estimated, unaccounted)
- E: Emergency services on scene (police/fire/ambulance/coastguard)

/**
* *OPERATOR TOOLS:
You have access to additional tools for incident management:
- get_incident_summary: Overview of all active incidents by type and severity
- get_resource_status: Current deployment of personnel, vehicles, and supplies
- get_citizen_sentiment: Aggregate sentiment from recent citizen reports and messages
- generate_sitrep: Create a formatted situation report for the current operational period
- get_ai_predictions: View AI hazard predictions and confidence levels
- get_performance_metrics: System performance and platform health metrics
- get_operator_activity: Recent operator actions and decisions for context

/**
* *PROACTIVE OPERATOR SUPPORT:
Don't just answer -- anticipate what the operator needs next:
- After a SITREP request ? offer resource reallocation analysis
- After viewing incidents ? suggest correlation patterns
- After resource check ? flag upcoming capacity issues
- After sentiment analysis ? recommend communication strategy
- At shift change times ? offer comprehensive handover briefing
`

export const ADMIN_TOOLS: LLMTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_incident_summary',
      description: 'Get a summary of all active incidents grouped by type, severity, and status for operational overview',
      parameters: {
        type: 'object',
        properties: {
          hours: { type: 'number', description: 'Look-back period in hours (default 24)' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'all'], description: 'Filter by severity' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_resource_status',
      description: 'Get current resource deployment status -- personnel, vehicles, shelters, and supply levels',
      parameters: {
        type: 'object',
        properties: {
          resource_type: { type: 'string', enum: ['personnel', 'vehicles', 'shelters', 'supplies', 'all'], description: 'Type of resource to check' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_citizen_sentiment',
      description: 'Aggregate citizen sentiment from recent reports, messages, and community chat to gauge community mood and concerns',
      parameters: {
        type: 'object',
        properties: {
          hours: { type: 'number', description: 'Look-back period in hours (default 12)' },
          area: { type: 'string', description: 'Specific area to analyse sentiment for' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_sitrep',
      description: 'Generate a formatted Situation Report (SITREP) covering active incidents, resources, weather, and recommendations',
      parameters: {
        type: 'object',
        properties: {
          period_hours: { type: 'number', description: 'Reporting period in hours (default 12)' },
          format: { type: 'string', enum: ['brief', 'full', 'methane'], description: 'Brief (1 paragraph), full (structured sections), or METHANE format' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_ai_predictions',
      description: 'View AI hazard predictions with confidence levels, trends, and time horizons for proactive decision-making',
      parameters: {
        type: 'object',
        properties: {
          hazard_type: { type: 'string', enum: ['flood', 'storm', 'fire', 'heatwave', 'all'], description: 'Filter by hazard type' },
          hours_ahead: { type: 'number', description: 'Prediction horizon in hours (default 24)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_performance_metrics',
      description: 'System performance and health metrics -- response times, active users, model performance, error rates',
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: ['system', 'ai_models', 'user_activity', 'all'], description: 'Metrics category' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_operator_activity',
      description: 'Recent operator actions, decisions, and chat sessions for shift handover context and coordination',
      parameters: {
        type: 'object',
        properties: {
          hours: { type: 'number', description: 'Look-back period in hours (default 8)' },
        },
        required: [],
      },
    },
  },
]


export async function executeToolCall(name: string, args: Record<string, unknown>): Promise<string> {
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
          `[${r.severity.toUpperCase()}] ${r.title} -- ${r.location_text || 'Area-wide'} (${new Date(r.created_at).toLocaleDateString('en-GB')})`
        ).join('\n')
      }

      case 'get_weather': {
        const loc = args.location as string || regionMeta.name
        const apiKey = process.env.OPENWEATHER_API_KEY
        if (!apiKey) return 'Weather service unavailable -- API key not configured.'

        const countryParam = regionMeta.countryCode ? `,${regionMeta.countryCode}` : ''
        const res = await fetchWithTimeout(
          `${region.weatherApi}/weather?q=${encodeURIComponent(loc)}${countryParam}&appid=${apiKey}&units=${regionMeta.units}`,
          { timeout: 15_000 },
        )
        if (!res.ok) return `Weather data unavailable for ${loc}.`
        const data = await res.json() as any
        return `Weather in ${loc}: ${data.weather?.[0]?.description || 'Unknown'}, ${Math.round(data.main?.temp)}--C, Wind: ${data.wind?.speed} m/s, Humidity: ${data.main?.humidity}%`
      }

      case 'find_shelters': {
        const lat = args.lat as number || regionMeta.centre.lat
        const lng = args.lng as number || regionMeta.centre.lng
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
          `?? ${r.name} (${r.distance_km.toFixed(1)} km away)\n   Address: ${r.address}\n   Capacity: ${r.current_occupancy}/${r.capacity} | Type: ${r.shelter_type}\n   Amenities: ${r.amenities.join(', ')}\n   Phone: ${r.phone || 'N/A'}`
        ).join('\n\n')
      }

      case 'get_flood_risk': {
        const lat = args.lat as number || args.latitude as number
        const lng = args.lng as number || args.longitude as number

        let result = ''

        //1. Check flood_zones (spatial containment)
        try {
          const { rows } = await pool.query(
            `SELECT zone_name, flood_type, probability
             FROM flood_zones
             WHERE ST_Contains(geometry, ST_SetSRID(ST_MakePoint($1, $2), 4326))
             ORDER BY probability DESC`,
            [lng, lat],
          )
          if (rows.length > 0) {
            result += 'Flood Zones at this location:\n'
            for (const r of rows) {
              result += `-- ${r.zone_name || 'Unnamed zone'} -- Type: ${r.flood_type}, Probability: ${r.probability}\n`
            }
          }
        } catch { /* flood_zones table may not exist */ }

        //2. Check active flood predictions
        try {
          const predictions = await pool.query(`
            SELECT area, probability, time_to_flood, severity, confidence, data_sources
            FROM flood_predictions
            WHERE (valid_until > NOW() OR expires_at > NOW())
            ORDER BY probability DESC
            LIMIT 3
          `)
          if (predictions.rows.length > 0) {
            result += '\nActive Flood Predictions:\n'
            for (const p of predictions.rows) {
              result += `-- ${p.area}: ${(p.probability * 100).toFixed(0)}% probability, severity: ${p.severity}${p.time_to_flood ? ', time: ' + p.time_to_flood : ''}, confidence: ${p.confidence}%\n`
            }
          }
        } catch { /* flood_predictions table may not exist */ }

        //3. Check zone risk scores
        try {
          const zones = await pool.query(`
            SELECT zone_name, hazard_type, risk_score, confidence, contributing_factors
            FROM zone_risk_scores
            WHERE expires_at > NOW()
            ORDER BY risk_score DESC
            LIMIT 3
          `)
          if (zones.rows.length > 0) {
            result += '\nZone Risk Levels:\n'
            for (const z of zones.rows) {
              result += `-- ${z.zone_name}: risk score ${z.risk_score}/100 (${z.hazard_type})${z.contributing_factors ? ' -- factors: ' + z.contributing_factors : ''}\n`
            }
          }
        } catch { /* zone_risk_scores table may not exist */ }

        return result || 'No active flood predictions or risk data available for your area. Check your local flood authority for official warnings.'
      }

      case 'search_wikipedia': {
        const query = args.query as string
        if (!query) return 'No search query provided.'

        const searchUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query.trim().replace(/ /g, '_'))}`
        const res = await fetchWithTimeout(searchUrl, {
          timeout: 15_000,
          headers: { 'User-Agent': 'AEGIS-DisasterResponse/1.0' },
        })

        if (res.status === 404) {
          //Try search API fallback
          const searchRes = await fetchWithTimeout(
            `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=1&format=json`,
            { timeout: 15_000, headers: { 'User-Agent': 'AEGIS-DisasterResponse/1.0' } },
          )
          if (!searchRes.ok) return `No Wikipedia article found for "${query}".`
          const searchData = await searchRes.json() as any
          const title = searchData.query?.search?.[0]?.title
          if (!title) return `No Wikipedia article found for "${query}".`

          const retryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`
          const retryRes = await fetchWithTimeout(retryUrl, { timeout: 15_000, headers: { 'User-Agent': 'AEGIS-DisasterResponse/1.0' } })
          if (!retryRes.ok) return `No Wikipedia article found for "${query}".`
          const retryData = await retryRes.json() as any
          return `?? **${retryData.title}** (Wikipedia)\n\n${retryData.extract || 'No summary available.'}\n\n_Source: en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}_`
        }

        if (!res.ok) return `Wikipedia search failed for "${query}".`
        const data = await res.json() as any
        return `?? **${data.title}** (Wikipedia)\n\n${data.extract || 'No summary available.'}\n\n_Source: ${data.content_urls?.desktop?.page || 'en.wikipedia.org'}_`
      }

      case 'get_flood_alerts':
      case 'get_sepa_flood_alerts': {
        //Use the region adapter to fetch flood warnings.
        //Falls back to RSS if the adapter returns nothing.
        const floodAuthority = llmCtx.floodAuthority
        const floodAuthorityWebsite = llmCtx.floodAuthorityUrl

        try {
          const adapterWarnings = await regionAdapter.getFloodWarnings()
          if (adapterWarnings.length > 0) {
            const lines = adapterWarnings.slice(0, 5).map(w =>
              `?? [${w.severity.toUpperCase()}] ${w.title}${w.area ? ` -- ${w.area}` : ''}`
            )
            return `**Live Flood Warnings from ${floodAuthority}** (${new Date().toLocaleDateString()}):\n\n${lines.join('\n')}\n\n_Source: ${floodAuthority}_`
          }
        } catch { /* fall through to RSS fallback */ }

        //RSS fallback via env vars
        const floodRssUrl = process.env.AEGIS_FLOOD_RSS_URL || regionAdapter.getIngestionEndpoints().flood_rss || ''
        if (!floodRssUrl) return `No current flood warnings from ${floodAuthority}. ${floodAuthorityWebsite ? `Check ${floodAuthorityWebsite} for updates.` : ''}`

        const rssRes = await fetchWithTimeout(floodRssUrl, {
          timeout: 15_000,
          headers: { 'User-Agent': 'AEGIS-DisasterResponse/1.0' },
        })
        if (!rssRes.ok) return `${floodAuthority} flood alert feed is temporarily unavailable.${floodAuthorityWebsite ? ` Check ${floodAuthorityWebsite} for current warnings.` : ''}`

        const rssText = await rssRes.text()
        const items = [...rssText.matchAll(/<item>([\s\S]*?)<\/item>/g)]
        if (items.length === 0) return `No current flood warnings are in effect from ${floodAuthority}.`

        const warnings = items.slice(0, 5).map(m => {
          const title = (m[1].match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || m[1].match(/<title>(.*?)<\/title>/))?.[1] || 'Unknown'
          const desc = (m[1].match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) || m[1].match(/<description>(.*?)<\/description>/))?.[1] || ''
          return `?? ${title.replace(/<[^>]+>/g, '').trim()}${desc ? ` -- ${desc.replace(/<[^>]+>/g, '').slice(0, 100).trim()}` : ''}`
        })

        return `**Live Flood Warnings from ${floodAuthority}** (${new Date().toLocaleDateString()}):\n\n${warnings.join('\n')}\n\n_Source: ${floodAuthority}_`
      }

      case 'get_weather_warnings':
      case 'get_met_office_warnings': {
        //Weather warnings from the region adapter's configured authority.
        const weatherAuthority = llmCtx.weatherAuthority
        const endpoints = regionAdapter.getIngestionEndpoints()
        const weatherWarningsUrl = process.env.AEGIS_WEATHER_WARNINGS_URL || endpoints.weather_warnings_rss || ''
        const weatherWarningsApi = endpoints.weather_warnings_api || ''
        const metOfficeApiKey = process.env.MET_OFFICE_API_KEY || ''

        //If a custom weather warnings URL is configured use it directly as RSS
        if (weatherWarningsUrl) {
          const rssRes = await fetchWithTimeout(weatherWarningsUrl, {
            timeout: 15_000,
            headers: { 'User-Agent': 'AEGIS-DisasterResponse/1.0' },
          }).catch(() => null)
          if (!rssRes?.ok) return `${weatherAuthority} weather warnings are temporarily unavailable.`
          const rssText = await rssRes.text()
          const items = [...rssText.matchAll(/<item>([\s\S]*?)<\/item>/g)]
          if (items.length === 0) return `No current weather warnings from ${weatherAuthority}.`
          const warnings = items.slice(0, 5).map(m => {
            const title = (m[1].match(/<title>(.*?)<\/title>/))?.[1] || 'Warning'
            return `?? ${title.replace(/<!\[CDATA\[|\]\]>/g, '').trim()}`
          })
          return `**${weatherAuthority} Warnings:**\n\n${warnings.join('\n')}\n\n_Source: ${weatherAuthority}_`
        }

        //API endpoint from region config
        if (!weatherWarningsApi) return `${weatherAuthority} weather warnings are not configured for this region.`
        const moRes = await fetchWithTimeout(
          weatherWarningsApi,
          {
            timeout: 15_000,
            headers: {
              'User-Agent': 'AEGIS-DisasterResponse/1.0',
              Accept: 'application/json',
              ...(metOfficeApiKey ? { apikey: metOfficeApiKey } : {}),
            },
          }
        )

        if (!moRes.ok) {
          const rssRes = await fetchWithTimeout(weatherWarningsUrl || endpoints.weather_warnings_rss || '', {
            timeout: 15_000,
            headers: { 'User-Agent': 'AEGIS-DisasterResponse/1.0' },
          }).catch(() => null)

          if (!rssRes?.ok) return 'Weather warnings service unavailable. Check your local meteorological authority for current warnings.'

          const rssText = await rssRes.text()
          const items = [...rssText.matchAll(/<item>([\s\S]*?)<\/item>/g)]
          if (items.length === 0) return 'No current weather warnings in effect.'
          const warnings = items.slice(0, 4).map(m => {
            const title = (m[1].match(/<title>(.*?)<\/title>/))?.[1] || 'Warning'
            return `?? ${title.replace(/<!\[CDATA\[|\]\]>/g, '').trim()}`
          })
          return `**Weather Warnings:**\n\n${warnings.join('\n')}\n\n_Source: ${weatherAuthority}_`
        }

        const moData = await moRes.json() as any
        const features = moData?.features || moData?.warnings || []
        if (!features.length) return 'No current weather warnings in effect.'

        const warnings = features.slice(0, 5).map((f: any) => {
          const props = f.properties || f
          return `?? ${props.type || 'Warning'} -- ${props.description || props.headline || 'Check your local meteorological authority for details'}`
        })
        return `**Weather Warnings:**\n\n${warnings.join('\n')}\n\n_Source: ${weatherAuthority}_`
      }

      case 'geocode_location': {
        const place = args.place as string
        if (!place) return 'No location provided.'

        const countryFilter = regionMeta.countryCode ? `&countrycodes=${regionMeta.countryCode.toLowerCase()}` : ''
        const nomRes = await fetchWithTimeout(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(place)}&format=json&limit=1${countryFilter}`,
          {
            timeout: 15_000,
            headers: { 'User-Agent': 'AEGIS-DisasterResponse/1.0' },
          }
        )
        if (!nomRes.ok) return `Could not geocode "${place}".`

        const nomData = await nomRes.json() as any[]
        if (!nomData.length) return `Could not find "${place}". Try a more specific name.`

        const loc = nomData[0]
        const lat = parseFloat(loc.lat)
        const lng = parseFloat(loc.lon)
        return `?? **${loc.display_name}**\nCoordinates: ${lat.toFixed(4)}, ${lng.toFixed(4)}\nType: ${loc.type || 'location'}\n\n_Use these coordinates to check flood risk or find nearby shelters._`
      }

      case 'get_evacuation_routes': {
        const lat = args.lat as number
        const lng = args.lng as number
        const hazardType = args.hazard_type as string || 'general'

        //Query evacuation routes from the DB if available
        try {
          const { rows } = await pool.query(
            `SELECT route_name, description, distance_km, estimated_time_min,
                    road_status, destination_name
             FROM evacuation_routes
             WHERE ST_DWithin(
               origin_point::geography,
               ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
               50000
             )
             AND (hazard_type = $3 OR hazard_type = 'general')
             AND is_active = true
             ORDER BY distance_km ASC
             LIMIT 5`,
            [lng, lat, hazardType],
          )
          if (rows.length > 0) {
            return rows.map((r: any) =>
              `??? **${r.route_name}** ? ${r.destination_name}\n   Distance: ${r.distance_km} km | ETA: ${r.estimated_time_min} min\n   Road status: ${r.road_status || 'Unknown'}\n   ${r.description || ''}`
            ).join('\n\n')
          }
        } catch { /* evacuation_routes table may not exist */ }

        //Find nearest shelters and compute real driving routes via OSRM
        try {
          const { rows: shelters } = await pool.query(
            `SELECT name, address,
                    ST_X(coordinates::geometry) AS shelter_lng,
                    ST_Y(coordinates::geometry) AS shelter_lat,
                    ST_Distance(coordinates::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) / 1000 as distance_km
             FROM shelters
             WHERE is_active = true
             ORDER BY distance_km ASC
             LIMIT 3`,
            [lng, lat],
          )
          if (shelters.length > 0) {
            //Query OSRM for real driving routes to each shelter
            const routeResults: string[] = []
            for (const shelter of shelters) {
              try {
                const osrmRes = await fetchWithTimeout(
                  `https://router.project-osrm.org/route/v1/driving/${lng},${lat};${shelter.shelter_lng},${shelter.shelter_lat}?overview=false&steps=true&alternatives=false`,
                  { timeout: 10_000, headers: { 'User-Agent': 'AEGIS-DisasterResponse/1.0' } },
                )
                if (osrmRes.ok) {
                  const osrmData = await osrmRes.json() as any
                  const route = osrmData.routes?.[0]
                  if (route) {
                    const distKm = (route.distance / 1000).toFixed(1)
                    const durationMin = Math.ceil(route.duration / 60)
                    //Extract key turn-by-turn instructions
                    const steps = route.legs?.[0]?.steps || []
                    const keySteps = steps
                      .filter((s: any) => s.maneuver?.type !== 'depart' && s.maneuver?.type !== 'arrive' && s.distance > 200)
                      .slice(0, 4)
                      .map((s: any) => `    ? ${s.maneuver?.modifier || ''} on ${s.name || 'unnamed road'} (${(s.distance / 1000).toFixed(1)} km)`.trim())
                    routeResults.push(
                      `??? **Route to ${shelter.name}** (${shelter.address})\n` +
                      `   Driving: ${distKm} km | ~${durationMin} min\n` +
                      `   Straight-line: ${shelter.distance_km.toFixed(1)} km\n` +
                      (keySteps.length > 0 ? `   Key directions:\n${keySteps.join('\n')}\n` : '')
                    )
                    continue
                  }
                }
              } catch { /* OSRM failed for this shelter -- use fallback below */ }
              //Fallback for this shelter if OSRM fails
              routeResults.push(
                `?? **${shelter.name}** -- ${shelter.address} (${shelter.distance_km.toFixed(1)} km straight-line)`
              )
            }
            return `**Evacuation Routes from your location** (${hazardType}):\n\n` +
              routeResults.join('\n\n') +
              `\n\n?? Evacuation advice for ${hazardType}: ${hazardType === 'flood' ? 'Move to higher ground. NEVER drive through floodwater.' : hazardType === 'wildfire' ? 'Drive perpendicular to wind direction. Close all windows.' : 'Follow official direction signs and avoid the hazard zone.'}`
          }
        } catch { /* shelters + OSRM fallback */ }

        return `No evacuation route data available for this location. For immediate evacuation guidance, call ${regionMeta.emergencyNumber}. General advice: move to higher ground for floods, move perpendicular to wind direction for wildfires.`
      }

      case 'get_nearby_hospitals': {
        const lat = args.lat as number
        const lng = args.lng as number
        const radiusM = ((args.radius_km as number) || 30) * 1000

        //Try DB first
        try {
          const { rows } = await pool.query(
            `SELECT name, address, phone, facility_type, emergency_dept,
                    ST_Distance(coordinates::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) / 1000 as distance_km
             FROM medical_facilities
             WHERE is_active = true
               AND ST_DWithin(coordinates::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
             ORDER BY distance_km ASC
             LIMIT 5`,
            [lng, lat, radiusM],
          )
          if (rows.length > 0) {
            return rows.map((r: any) =>
              `?? **${r.name}** (${r.distance_km.toFixed(1)} km)\n   Address: ${r.address}\n   Phone: ${r.phone || 'N/A'}\n   Type: ${r.facility_type || 'Hospital'}${r.emergency_dept ? ' | A&E available' : ''}`
            ).join('\n\n')
          }
        } catch { /* medical_facilities table may not exist */ }

        //Fallback to Nominatim/OSM search
        try {
          const osmRes = await fetchWithTimeout(
            `https://nominatim.openstreetmap.org/search?q=hospital&format=json&limit=3&viewbox=${lng - 0.3},${lat + 0.3},${lng + 0.3},${lat - 0.3}&bounded=1`,
            { timeout: 15_000, headers: { 'User-Agent': 'AEGIS-DisasterResponse/1.0' } },
          )
          if (osmRes.ok) {
            const results = await osmRes.json() as any[]
            if (results.length > 0) {
              return results.map((r: any) =>
                `?? **${r.display_name.split(',')[0]}**\n   Location: ${r.display_name}\n   Coordinates: ${parseFloat(r.lat).toFixed(4)}, ${parseFloat(r.lon).toFixed(4)}`
              ).join('\n\n')
            }
          }
        } catch { /* OSM fallback */ }

        return `No hospital data available for this area. For medical emergencies, call ${regionMeta.emergencyNumber} immediately.`
      }

      case 'get_incident_clusters': {
        const incidentType = args.incident_type as string || 'all'
        const hours = args.hours as number || 24

        let query = `SELECT incident_type, severity, location_text,
                            ST_X(location::geometry) AS lng, ST_Y(location::geometry) AS lat,
                            created_at, status
                     FROM incidents
                     WHERE created_at > NOW() - INTERVAL '1 hour' * $1
                       AND status != 'resolved'`
        const params: unknown[] = [hours]

        if (incidentType !== 'all') {
          query += ` AND incident_type = $2`
          params.push(incidentType)
        }
        query += ` ORDER BY created_at DESC LIMIT 20`

        try {
          const { rows } = await pool.query(query, params)
          if (rows.length === 0) return `No active incident clusters in the last ${hours} hours.`

          //Group by type
          const grouped: Record<string, any[]> = {}
          for (const r of rows) {
            const type = r.incident_type || 'unknown'
            if (!grouped[type]) grouped[type] = []
            grouped[type].push(r)
          }

          const lines: string[] = [`**Active Incident Clusters (last ${hours}h):**\n`]
          for (const [type, incidents] of Object.entries(grouped)) {
            lines.push(`**${type.toUpperCase()}** (${incidents.length} incidents):`)
            for (const inc of incidents.slice(0, 5)) {
              lines.push(`  -- [${inc.severity || 'Unknown'}] ${inc.location_text || 'Location unknown'} -- ${inc.status} (${new Date(inc.created_at).toLocaleTimeString('en-GB')})`)
            }
          }
          return lines.join('\n')
        } catch {
          return `Incident cluster data unavailable. The incidents table may not contain the expected columns.`
        }
      }

      case 'get_report_status': {
        const reportId = args.report_id as string
        if (!reportId) return 'No report ID provided. Ask the citizen for their incident report number.'
        try {
          const { rows } = await pool.query(
            `SELECT i.id, i.title, i.status, i.severity, i.incident_type, i.location_text,
                    i.created_at, i.updated_at, i.ai_priority_score,
                    u.full_name AS operator_name
             FROM incidents i
             LEFT JOIN users u ON u.id = i.assigned_to
             WHERE i.id::text = $1 OR i.title ILIKE $2
             LIMIT 1`,
            [reportId.replace(/\D/g, ''), `%${reportId}%`],
          )
          if (rows.length === 0) return `No report found matching "${reportId}". The citizen may need to check their report ID.`
          const r = rows[0]
          return `?? **Report #${r.id}** -- ${r.title || 'Untitled'}\n` +
            `Status: **${r.status}** | Severity: ${r.severity} | Type: ${r.incident_type}\n` +
            `Location: ${r.location_text || 'Not specified'}\n` +
            `Submitted: ${new Date(r.created_at).toLocaleDateString('en-GB')}\n` +
            `Last updated: ${new Date(r.updated_at).toLocaleDateString('en-GB')}\n` +
            `${r.operator_name ? `Assigned to: ${r.operator_name}` : 'Not yet assigned to an operator'}\n` +
            `${r.ai_priority_score ? `AI Priority Score: ${r.ai_priority_score}/100` : ''}`
        } catch {
          return `Unable to look up report status. The system may be experiencing issues.`
        }
      }

      case 'check_infrastructure_status': {
        const area = args.area as string
        const infraType = args.infrastructure_type as string || 'all'
        try {
          let query = `SELECT incident_type, title, severity, location_text, status, created_at
                       FROM incidents
                       WHERE status != 'resolved'
                         AND created_at > NOW() - INTERVAL '48 hours'
                         AND location_text ILIKE $1`
          const params: unknown[] = [`%${area}%`]

          if (infraType !== 'all') {
            const typeMap: Record<string, string[]> = {
              roads: ['road', 'traffic', 'closure', 'blocked'],
              bridges: ['bridge', 'structural'],
              power: ['power', 'electricity', 'outage', 'grid'],
              water: ['water', 'pipe', 'contamination', 'supply'],
            }
            const keywords = typeMap[infraType] || [infraType]
            query += ` AND (${keywords.map((_, i) => `(title ILIKE $${i + 2} OR incident_type ILIKE $${i + 2})`).join(' OR ')})`
            params.push(...keywords.map(k => `%${k}%`))
          }
          query += ` ORDER BY created_at DESC LIMIT 10`

          const { rows } = await pool.query(query, params)
          if (rows.length === 0) return `No reported infrastructure issues in ${area}. This area appears clear.`
          return `**Infrastructure Status -- ${area}:**\n\n` +
            rows.map((r: any) =>
              `?? [${r.severity}] ${r.title} -- ${r.status} (${new Date(r.created_at).toLocaleDateString('en-GB')})`
            ).join('\n')
        } catch {
          return `Infrastructure status data unavailable for ${area}.`
        }
      }

      case 'get_historical_comparison': {
        const hazardType = args.hazard_type as string || 'flood'
        const location = args.location as string || regionMeta.name
        try {
          const { rows } = await pool.query(
            `SELECT title, severity, location_text, created_at, incident_type,
                    COUNT(*) OVER () AS total_historical
             FROM incidents
             WHERE incident_type ILIKE $1
               AND created_at > NOW() - INTERVAL '2 years'
             ORDER BY created_at DESC
             LIMIT 10`,
            [`%${hazardType}%`],
          )
          if (rows.length === 0) {
            return `No historical ${hazardType} events found in the database for comparison. The system may not have data older than a few months.`
          }

          //Get current active count
          const { rows: currentRows } = await pool.query(
            `SELECT COUNT(*) AS active_count FROM incidents
             WHERE incident_type ILIKE $1 AND status != 'resolved'
               AND created_at > NOW() - INTERVAL '48 hours'`,
            [`%${hazardType}%`],
          )
          const activeCount = parseInt(currentRows[0]?.active_count) || 0
          const historicalAvg = rows.length > 0 ? Math.ceil(parseInt(rows[0].total_historical) / 24) : 0

          return `**Historical ${hazardType} Comparison -- ${location}:**\n\n` +
            `Currently active: ${activeCount} ${hazardType} incidents\n` +
            `Historical average: ~${historicalAvg} incidents per month (past 2 years)\n` +
            `${activeCount > historicalAvg * 2 ? '?? Current activity is SIGNIFICANTLY ABOVE average' : activeCount > historicalAvg ? '? Current activity is above average' : '? Current activity is within normal range'}\n\n` +
            `Recent historical events:\n` +
            rows.slice(0, 5).map((r: any) =>
              `-- ${new Date(r.created_at).toLocaleDateString('en-GB')} -- [${r.severity}] ${r.title} (${r.location_text || 'Area-wide'})`
            ).join('\n')
        } catch {
          return `Historical comparison data unavailable.`
        }
      }

      //ADMIN TOOLS

      case 'get_incident_summary': {
        const hours = args.hours as number || 24
        const severity = args.severity as string || 'all'
        try {
          let query = `SELECT incident_type, severity, status, COUNT(*) AS cnt
                       FROM incidents
                       WHERE created_at > NOW() - INTERVAL '${Math.min(hours, 168)} hours'`
          const params: unknown[] = []
          if (severity !== 'all') {
            query += ` AND severity = $1`
            params.push(severity)
          }
          query += ` GROUP BY incident_type, severity, status ORDER BY cnt DESC`

          const { rows } = await pool.query(query, params)
          if (rows.length === 0) return `No incidents found in the last ${hours} hours.`

          const total = rows.reduce((sum: number, r: any) => sum + parseInt(r.cnt), 0)
          const byType: Record<string, number> = {}
          const bySeverity: Record<string, number> = {}
          const byStatus: Record<string, number> = {}
          for (const r of rows) {
            byType[r.incident_type] = (byType[r.incident_type] || 0) + parseInt(r.cnt)
            bySeverity[r.severity] = (bySeverity[r.severity] || 0) + parseInt(r.cnt)
            byStatus[r.status] = (byStatus[r.status] || 0) + parseInt(r.cnt)
          }

          return `**Incident Summary (last ${hours}h):**\n` +
            `Total: ${total} incidents\n\n` +
            `**By Type:** ${Object.entries(byType).map(([k, v]) => `${k}: ${v}`).join(', ')}\n` +
            `**By Severity:** ${Object.entries(bySeverity).map(([k, v]) => `${k}: ${v}`).join(', ')}\n` +
            `**By Status:** ${Object.entries(byStatus).map(([k, v]) => `${k}: ${v}`).join(', ')}`
        } catch {
          return 'Incident summary data unavailable.'
        }
      }

      case 'get_resource_status': {
        const resourceType = args.resource_type as string || 'all'
        const parts: string[] = ['**Resource Status:**\n']

        if (resourceType === 'all' || resourceType === 'shelters') {
          try {
            const { rows } = await pool.query(
              `SELECT COUNT(*) AS total, SUM(capacity) AS cap, SUM(current_occupancy) AS occ
               FROM shelters WHERE is_active = true`,
            )
            if (rows[0]) {
              const cap = parseInt(rows[0].cap) || 0
              const occ = parseInt(rows[0].occ) || 0
              parts.push(`?? Shelters: ${rows[0].total} active | Capacity: ${cap} | Occupied: ${occ} | Available: ${cap - occ}`)
            }
          } catch { parts.push('?? Shelter data unavailable') }
        }

        if (resourceType === 'all' || resourceType === 'personnel') {
          try {
            const { rows } = await pool.query(
              `SELECT status, COUNT(*) AS cnt FROM resource_deployments
               WHERE resource_type = 'personnel' AND created_at > NOW() - INTERVAL '24 hours'
               GROUP BY status`,
            )
            const deployed = rows.find((r: any) => r.status === 'deployed')
            const available = rows.find((r: any) => r.status === 'available')
            parts.push(`?? Personnel: ${deployed?.cnt || 0} deployed | ${available?.cnt || 0} available`)
          } catch { parts.push('?? Personnel data unavailable') }
        }

        if (resourceType === 'all' || resourceType === 'vehicles') {
          try {
            const { rows } = await pool.query(
              `SELECT status, COUNT(*) AS cnt FROM resource_deployments
               WHERE resource_type = 'vehicle' AND created_at > NOW() - INTERVAL '24 hours'
               GROUP BY status`,
            )
            const deployed = rows.find((r: any) => r.status === 'deployed')
            const available = rows.find((r: any) => r.status === 'available')
            parts.push(`?? Vehicles: ${deployed?.cnt || 0} deployed | ${available?.cnt || 0} available`)
          } catch { parts.push('?? Vehicle data unavailable') }
        }

        return parts.join('\n')
      }

      case 'get_citizen_sentiment': {
        const hours = args.hours as number || 12
        try {
          const { rows } = await pool.query(
            `SELECT
               COUNT(*) AS total_messages,
               COUNT(*) FILTER (WHERE sentiment_label ILIKE '%positive%' OR sentiment_label = 'LABEL_1') AS positive,
               COUNT(*) FILTER (WHERE sentiment_label ILIKE '%negative%' OR sentiment_label = 'LABEL_0') AS negative,
               COUNT(*) FILTER (WHERE sentiment_label ILIKE '%neutral%' OR sentiment_label IS NULL) AS neutral_count
             FROM incidents
             WHERE created_at > NOW() - INTERVAL '${Math.min(hours, 168)} hours'`,
          )
          const r = rows[0]
          const total = parseInt(r.total_messages) || 0
          const pos = parseInt(r.positive) || 0
          const neg = parseInt(r.negative) || 0

          //Get top concerns from recent incident descriptions
          const { rows: concerns } = await pool.query(
            `SELECT incident_type, COUNT(*) AS cnt
             FROM incidents WHERE created_at > NOW() - INTERVAL '${Math.min(hours, 168)} hours'
             GROUP BY incident_type ORDER BY cnt DESC LIMIT 5`,
          )

          return `**Citizen Sentiment (last ${hours}h):**\n` +
            `Total reports: ${total}\n` +
            `Positive: ${pos} | Negative: ${neg} | Neutral: ${total - pos - neg}\n` +
            `Sentiment ratio: ${total > 0 ? ((neg / total) * 100).toFixed(0) : 0}% negative\n\n` +
            `**Top Concerns:** ${concerns.map((c: any) => `${c.incident_type} (${c.cnt})`).join(', ') || 'No data'}`
        } catch {
          return 'Citizen sentiment data unavailable.'
        }
      }

      case 'generate_sitrep': {
        const periodHours = args.period_hours as number || 12
        const format = args.format as string || 'full'
        const parts: string[] = []

        try {
          //Active incidents
          const { rows: incidents } = await pool.query(
            `SELECT incident_type, severity, COUNT(*) AS cnt
             FROM incidents WHERE status != 'resolved'
               AND created_at > NOW() - INTERVAL '${Math.min(periodHours, 168)} hours'
             GROUP BY incident_type, severity ORDER BY cnt DESC`,
          )

          //Active alerts
          const { rows: alerts } = await pool.query(
            `SELECT severity, COUNT(*) AS cnt FROM alerts
             WHERE is_active = true AND deleted_at IS NULL GROUP BY severity`,
          )

          //Shelter capacity
          const { rows: shelters } = await pool.query(
            `SELECT COUNT(*) AS total, SUM(capacity) AS cap, SUM(current_occupancy) AS occ
             FROM shelters WHERE is_active = true`,
          )

          if (format === 'brief') {
            const totalInc = incidents.reduce((s: number, r: any) => s + parseInt(r.cnt), 0)
            const totalAlerts = alerts.reduce((s: number, r: any) => s + parseInt(r.cnt), 0)
            return `SITREP (${periodHours}h): ${totalInc} active incidents, ${totalAlerts} alerts. ` +
              `Shelter availability: ${(parseInt(shelters[0]?.cap) || 0) - (parseInt(shelters[0]?.occ) || 0)} spaces. ` +
              `Top incident type: ${incidents[0]?.incident_type || 'None'}.`
          }

          parts.push(`# SITUATION REPORT -- ${new Date().toLocaleString('en-GB')}`)
          parts.push(`**Reporting Period:** Last ${periodHours} hours\n`)

          parts.push(`## Active Incidents`)
          if (incidents.length > 0) {
            for (const r of incidents) {
              parts.push(`- ${r.incident_type} [${r.severity}]: ${r.cnt} active`)
            }
          } else {
            parts.push('- No active incidents')
          }

          parts.push(`\n## Active Alerts`)
          if (alerts.length > 0) {
            for (const r of alerts) {
              parts.push(`- ${r.severity}: ${r.cnt}`)
            }
          } else {
            parts.push('- No active alerts')
          }

          parts.push(`\n## Resource Status`)
          const cap = parseInt(shelters[0]?.cap) || 0
          const occ = parseInt(shelters[0]?.occ) || 0
          parts.push(`- Shelters: ${shelters[0]?.total || 0} active | ${cap - occ}/${cap} spaces available`)

          return parts.join('\n')
        } catch {
          return 'Unable to generate SITREP -- data sources unavailable.'
        }
      }

      //NEW ADMIN TOOLS (Advanced Intelligence)

      case 'get_ai_predictions': {
        const hours = args.hours as number || 24
        const hazardType = args.hazard_type as string || 'all'
        try {
          //Get recent AI predictions from the prediction pipeline
          let query = `SELECT hazard_type, predicted_severity, confidence, region_id, predicted_at, description
                       FROM ai_predictions
                       WHERE predicted_at > NOW() - INTERVAL '${Math.min(hours, 168)} hours'`
          const params: unknown[] = []
          if (hazardType !== 'all') {
            query += ` AND hazard_type ILIKE $1`
            params.push(`%${hazardType}%`)
          }
          query += ` ORDER BY confidence DESC, predicted_at DESC LIMIT 15`

          const { rows } = await pool.query(query, params)
          if (rows.length === 0) {
            //Fallback: derive predictions from incident trends
            const { rows: trends } = await pool.query(
              `SELECT incident_type, severity, COUNT(*) AS cnt,
                      MAX(created_at) AS latest
               FROM incidents
               WHERE created_at > NOW() - INTERVAL '${Math.min(hours * 2, 336)} hours'
               GROUP BY incident_type, severity
               ORDER BY cnt DESC LIMIT 10`,
            )
            if (trends.length === 0) return `No AI predictions or detectable trends in the last ${hours} hours.`

            const trendLines = trends.map((t: any) =>
              `-- **${t.incident_type}** [${t.severity}]: ${t.cnt} incidents trending -- latest: ${new Date(t.latest).toLocaleString('en-GB')}`
            )
            return `**AI Trend Analysis (last ${hours}h):**\n\n` +
              `No ML predictions available. Trend-based analysis:\n\n` +
              trendLines.join('\n') +
              `\n\n_Recommendation: Monitor ${trends[0]?.incident_type} closely -- highest frequency._`
          }

          const predLines = rows.map((r: any) =>
            `-- **${r.hazard_type}** [${r.predicted_severity}] -- Region: ${r.region_id || 'N/A'} | ` +
            `Confidence: ${(r.confidence * 100).toFixed(0)}% | ` +
            `${r.description || 'No description'}`
          )

          const highConfidence = rows.filter((r: any) => r.confidence >= 0.75)
          const criticalPreds = rows.filter((r: any) => r.predicted_severity === 'critical')

          return `**AI Hazard Predictions (last ${hours}h):**\n\n` +
            predLines.join('\n') +
            `\n\n**Summary:** ${rows.length} predictions | ` +
            `${highConfidence.length} high-confidence (>75%) | ` +
            `${criticalPreds.length} critical severity` +
            (criticalPreds.length > 0 ? `\n\n?? **ATTENTION:** ${criticalPreds.length} critical-severity predictions require immediate review.` : '')
        } catch {
          return 'AI prediction data unavailable. Check if the prediction pipeline is running.'
        }
      }

      case 'get_performance_metrics': {
        try {
          //Gather system performance metrics
          const [incidentResp, chatMetrics, systemHealth] = await Promise.all([
            pool.query(
              `SELECT
                 COUNT(*) AS total_24h,
                 AVG(EXTRACT(EPOCH FROM (updated_at - created_at))) AS avg_response_sec,
                 COUNT(*) FILTER (WHERE status = 'resolved') AS resolved,
                 COUNT(*) FILTER (WHERE severity = 'critical' AND status != 'resolved') AS critical_open
               FROM incidents
               WHERE created_at > NOW() - INTERVAL '24 hours'`,
            ),
            pool.query(
              `SELECT
                 COUNT(*) AS total_sessions,
                 COUNT(DISTINCT citizen_id) FILTER (WHERE citizen_id IS NOT NULL) AS unique_citizens,
                 COUNT(DISTINCT operator_id) FILTER (WHERE operator_id IS NOT NULL) AS unique_operators,
                 AVG(total_tokens) AS avg_tokens
               FROM chat_sessions
               WHERE created_at > NOW() - INTERVAL '24 hours'`,
            ),
            pool.query(
              `SELECT COUNT(*) AS active_alerts FROM alerts WHERE is_active = true AND deleted_at IS NULL`,
            ),
          ])

          const inc = incidentResp.rows[0]
          const chat = chatMetrics.rows[0]
          const health = systemHealth.rows[0]
          const avgRespMin = inc.avg_response_sec ? (parseFloat(inc.avg_response_sec) / 60).toFixed(1) : 'N/A'
          const resolutionRate = inc.total_24h > 0 ? ((parseInt(inc.resolved) / parseInt(inc.total_24h)) * 100).toFixed(0) : 'N/A'

          return `**System Performance Metrics (24h):**\n\n` +
            `## Incident Response\n` +
            `-- Total incidents: ${inc.total_24h}\n` +
            `-- Avg response time: ${avgRespMin} minutes\n` +
            `-- Resolution rate: ${resolutionRate}%\n` +
            `-- Critical unresolved: ${inc.critical_open}\n\n` +
            `## AI Chat System\n` +
            `-- Chat sessions: ${chat.total_sessions}\n` +
            `-- Unique citizens: ${chat.unique_citizens}\n` +
            `-- Unique operators: ${chat.unique_operators}\n` +
            `-- Avg tokens per session: ${chat.avg_tokens ? parseInt(chat.avg_tokens) : 'N/A'}\n\n` +
            `## System Health\n` +
            `-- Active alerts: ${health.active_alerts}\n` +
            `-- Status: ${parseInt(inc.critical_open) > 5 ? '?? HIGH LOAD' : parseInt(inc.critical_open) > 0 ? '?? ELEVATED' : '?? NORMAL'}`
        } catch {
          return 'Performance metrics unavailable.'
        }
      }

      case 'get_operator_activity': {
        const shiftHours = args.shift_hours as number || 8
        try {
          const { rows: sessions } = await pool.query(
            `SELECT
               cs.operator_id,
               COUNT(*) AS session_count,
               SUM(cs.total_tokens) AS total_tokens,
               MAX(cs.created_at) AS last_active,
               cs.session_summary
             FROM chat_sessions cs
             WHERE cs.operator_id IS NOT NULL
               AND cs.created_at > NOW() - INTERVAL '${Math.min(shiftHours, 48)} hours'
             GROUP BY cs.operator_id, cs.session_summary
             ORDER BY last_active DESC
             LIMIT 20`,
          )

          if (sessions.length === 0) return `No operator activity in the last ${shiftHours} hours.`

          //Aggregate by operator
          const byOperator = new Map<string, { sessions: number; tokens: number; lastActive: Date; summaries: string[] }>()
          for (const s of sessions) {
            const opId = s.operator_id
            const existing = byOperator.get(opId) || { sessions: 0, tokens: 0, lastActive: new Date(0), summaries: [] }
            existing.sessions += parseInt(s.session_count)
            existing.tokens += parseInt(s.total_tokens) || 0
            if (new Date(s.last_active) > existing.lastActive) existing.lastActive = new Date(s.last_active)
            if (s.session_summary) existing.summaries.push(s.session_summary)
            byOperator.set(opId, existing)
          }

          const lines = [...byOperator.entries()].map(([opId, data]) => {
            const lastActiveStr = data.lastActive.toLocaleString('en-GB')
            const summary = data.summaries.length > 0 ? `\n    Last topic: ${data.summaries[0].slice(0, 100)}` : ''
            return `-- Operator ${opId.slice(0, 8)}... -- ${data.sessions} sessions | ${data.tokens} tokens | Last active: ${lastActiveStr}${summary}`
          })

          return `**Operator Activity (last ${shiftHours}h):**\n\n` +
            `Operators active: ${byOperator.size}\n\n` +
            lines.join('\n') +
            `\n\n_Use this for shift handover context and workload distribution._`
        } catch {
          return 'Operator activity data unavailable.'
        }
      }

      case 'web_search': {
        const query = args.query as string
        const numResults = (args.num_results as number) || 5
        if (!query) return 'Please specify a search query.'
        return await executeWebSearch(query, numResults)
      }

      case 'analyze_image': {
        const imageUrl = args.image_url as string
        const context = args.context as string | undefined
        if (!imageUrl) return 'Please provide an image URL or path to analyze.'
        return await executeImageAnalysis(imageUrl, context)
      }

      default:
        return `Tool '${name}' is not available.`
    }
  } catch (err: any) {
    logger.error({ err, toolName: name }, '[Chat] Tool execution failed')
    return `Unable to retrieve data (${name}). Please try again.`
  }
}

//Web Search Implementation
export async function executeWebSearch(query: string, numResults = 5): Promise<string> {
  const maxResults = Math.min(numResults, 10)

  //Strategy 1: DuckDuckGo Instant Answer API (no key required)
  try {
    const encoded = encodeURIComponent(query)
    const ddgRes = await fetchWithTimeout(
      `https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1&skip_disambig=1`,
      { headers: { 'User-Agent': 'AEGIS-DisasterResponse/1.0' }, timeout: 8000 },
    )
    const ddg = await ddgRes.json() as any
    const results: string[] = []

    if (ddg.AbstractText) {
      results.push(`**${ddg.Heading || 'Summary'}**: ${ddg.AbstractText} (Source: ${ddg.AbstractSource || 'DuckDuckGo'})`)
    }

    if (ddg.RelatedTopics && Array.isArray(ddg.RelatedTopics)) {
      for (const topic of ddg.RelatedTopics.slice(0, maxResults)) {
        if (topic.Text) {
          results.push(`- ${topic.Text}`)
        }
      }
    }

    if (results.length > 0) {
      return `Web search results for "${query}":\n\n${results.join('\n')}`
    }
  } catch (err: any) {
    devLog(`[WebSearch] DuckDuckGo failed: ${err.message}`)
  }

  //Strategy 2: Wikipedia search as reliable fallback
  try {
    const wikiEncoded = encodeURIComponent(query)
    const wikiRes = await fetchWithTimeout(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${wikiEncoded}`,
      { headers: { 'User-Agent': 'AEGIS-DisasterResponse/1.0' }, timeout: 6000 },
    )
    if (wikiRes.ok) {
      const wiki = await wikiRes.json() as any
      if (wiki.extract) {
        return `Web search result for "${query}":\n\n**${wiki.title}**: ${wiki.extract} (Source: Wikipedia)`
      }
    }
  } catch {
    //continue
  }

  //Strategy 3: Brave Search API (if key available)
  const braveKey = process.env.BRAVE_SEARCH_API_KEY
  if (braveKey) {
    try {
      const encoded = encodeURIComponent(query)
      const braveRes = await fetchWithTimeout(
        `https://api.search.brave.com/res/v1/web/search?q=${encoded}&count=${maxResults}`,
        {
          headers: {
            'Accept': 'application/json',
            'X-Subscription-Token': braveKey,
          },
          timeout: 8000,
        },
      )
      const braveData = await braveRes.json() as any
      if (braveData.web?.results?.length > 0) {
        const formatted = braveData.web.results
          .slice(0, maxResults)
          .map((r: any) => `- **${r.title}**: ${r.description} (${r.url})`)
          .join('\n')
        return `Web search results for "${query}":\n\n${formatted}`
      }
    } catch (err: any) {
      devLog(`[WebSearch] Brave failed: ${err.message}`)
    }
  }

  return `Web search for "${query}" returned no results. Try rephrasing the query or use the search_wikipedia tool for factual information.`
}

//Structured Vision Output Interface
export interface VisionStructuredOutput {
  disaster_type: string
  severity: 'critical' | 'high' | 'moderate' | 'low' | 'none'
  confidence: number             // 0-100
  scene_description: string
  objects_detected: string[]
  risk_factors: string[]
  recommended_actions: string[]
  reasoning_chain: string        // chain-of-thought
  raw_analysis: string           // full text analysis
  model_used: string
  processing_time_ms: number
}

//Parse the structured JSON suffix from vision responses
export function parseVisionStructuredOutput(rawText: string, modelUsed: string, elapsedMs: number): VisionStructuredOutput {
  const defaults: VisionStructuredOutput = {
    disaster_type: 'unknown',
    severity: 'moderate',
    confidence: 50,
    scene_description: '',
    objects_detected: [],
    risk_factors: [],
    recommended_actions: [],
    reasoning_chain: '',
    raw_analysis: rawText,
    model_used: modelUsed,
    processing_time_ms: elapsedMs,
  }

  //Try to extract JSON block from response
  const jsonMatch = rawText.match(/```json\s*([\s\S]*?)```/) || rawText.match(/\{[\s\S]*"disaster_type"[\s\S]*\}/)
  if (jsonMatch) {
    try {
      const jsonStr = jsonMatch[1] || jsonMatch[0]
      const parsed = JSON.parse(jsonStr)
      return {
        disaster_type: (parsed.disaster_type === 'none' ? 'safe' : parsed.disaster_type) || defaults.disaster_type,
        severity: (['critical', 'high', 'moderate', 'low', 'none'].includes(parsed.severity) ? parsed.severity : defaults.severity) as VisionStructuredOutput['severity'],
        confidence: Math.min(100, Math.max(0, parseInt(parsed.confidence, 10) || defaults.confidence)),
        scene_description: parsed.scene_description || '',
        objects_detected: Array.isArray(parsed.objects_detected) ? parsed.objects_detected : [],
        risk_factors: Array.isArray(parsed.risk_factors) ? parsed.risk_factors : [],
        recommended_actions: Array.isArray(parsed.recommended_actions) ? parsed.recommended_actions : [],
        reasoning_chain: parsed.reasoning_chain || '',
        raw_analysis: rawText,
        model_used: modelUsed,
        processing_time_ms: elapsedMs,
      }
    } catch {
      devLog(`[Vision] Failed to parse structured JSON from response`)
    }
  }

  //Fallback: heuristic extraction from unstructured text -- covers all 13 AEGIS types
  const lowerText = rawText.toLowerCase()
  const disasterKeywords: Record<string, string[]> = {
    flood: ['flood', 'flooding', 'submerged', 'water level', 'inundation', 'waterlogged', 'flash flood', 'storm surge', 'pluvial', 'fluvial', 'rising water'],
    severe_storm: ['storm', 'hurricane', 'cyclone', 'tornado', 'wind damage', 'hail', 'lightning', 'funnel cloud', 'uprooted tree', 'gale', 'typhoon', 'thunderstorm'],
    heatwave: ['heatwave', 'heat wave', 'extreme heat', 'heat stress', 'heat shimmer', 'buckled road', 'melted asphalt', 'sun kink', 'heat island'],
    wildfire: ['wildfire', 'fire', 'flames', 'burning', 'smoke', 'blaze', 'ember', 'charred', 'scorched', 'crown fire', 'surface fire', 'ground fire'],
    landslide: ['landslide', 'mudslide', 'debris flow', 'slope failure', 'erosion', 'rockfall', 'mudflow', 'scarp', 'tension crack'],
    drought: ['drought', 'arid', 'dried', 'desiccated', 'parched', 'cracked earth', 'water shortage', 'dried lake', 'crop failure'],
    power_outage: ['power outage', 'downed power line', 'blackout', 'transformer', 'utility pole', 'power failure', 'electrical fire', 'grid failure', 'snapped pole'],
    water_supply_disruption: ['water supply', 'pipe burst', 'water main', 'boil water', 'water contamination', 'water tower', 'broken pipe', 'water disruption'],
    infrastructure_damage: ['infrastructure damage', 'building collapse', 'bridge damage', 'sinkhole', 'road damage', 'structural failure', 'pancake collapse', 'pavement heaving'],
    public_safety_incident: ['public safety', 'emergency vehicle', 'cordon', 'mass casualty', 'evacuation', 'lockdown', 'triage', 'crowd dispersing'],
    environmental_hazard: ['chemical spill', 'hazmat', 'toxic', 'contamination', 'gas leak', 'oil sheen', 'pollution', 'hazardous material', 'algal bloom', 'fish kill'],
    earthquake: ['earthquake', 'seismic', 'rubble', 'collapsed', 'fissure', 'tremor', 'liquefaction', 'aftershock', 'shear crack', 'sand boil'],
    volcanic: ['volcanic', 'lava', 'eruption', 'ash cloud', 'pyroclastic', 'lahar', 'fumarole', 'ash fall', 'magma'],
    safe: ['no hazard', 'no danger', 'safe', 'clear', 'normal conditions', 'no disaster', 'intact', 'undamaged'],
  }
  let bestType = 'unknown'
  let bestScore = 0
  for (const [type, keywords] of Object.entries(disasterKeywords)) {
    const matches = keywords.filter(k => lowerText.includes(k)).length
    if (matches > bestScore) { bestScore = matches; bestType = type }
  }

  const severityKeywords: Record<string, string[]> = {
    critical: ['critical', 'life-threatening', 'imminent danger', 'evacuate immediately', 'extreme'],
    high: ['high risk', 'dangerous', 'significant damage', 'major', 'severe'],
    moderate: ['moderate', 'caution', 'some damage', 'potential risk'],
    low: ['low risk', 'minor', 'minimal', 'slight'],
    none: ['no risk', 'no hazard', 'safe', 'clear'],
  }
  let severityGuess: VisionStructuredOutput['severity'] = 'moderate'
  for (const [sev, keywords] of Object.entries(severityKeywords)) {
    if (keywords.some(k => lowerText.includes(k))) { severityGuess = sev as VisionStructuredOutput['severity']; break }
  }

  //Extract confidence from text mentions like "90% confidence" or "high confidence"
  const confMatch = rawText.match(/(\d{1,3})%?\s*confidence/i)
  const confidence = confMatch ? Math.min(100, parseInt(confMatch[1], 10)) : (bestScore > 2 ? 75 : 50)

  return { ...defaults, disaster_type: bestType, severity: severityGuess, confidence, model_used: modelUsed, processing_time_ms: elapsedMs }
}

//In-session image memory for temporal comparison
export const sessionImageMemory = new Map<string, Array<{ timestamp: number; imageUrl: string; analysis: VisionStructuredOutput }>>()

export function storeImageAnalysis(sessionId: string, imageUrl: string, analysis: VisionStructuredOutput) {
  if (!sessionImageMemory.has(sessionId)) sessionImageMemory.set(sessionId, [])
  const history = sessionImageMemory.get(sessionId)!
  history.push({ timestamp: Date.now(), imageUrl, analysis })
  //Keep last 10 images per session
  if (history.length > 10) history.shift()
}

export function buildImageMemoryContext(sessionId: string, currentAnalysis: VisionStructuredOutput): string {
  const history = sessionImageMemory.get(sessionId)
  if (!history || history.length <= 1) return ''

  const previous = history.slice(0, -1) // all except current
  const comparisons: string[] = []
  for (const prev of previous) {
    const timeDiff = Math.round((Date.now() - prev.timestamp) / 60000)
    const timeStr = timeDiff < 60 ? `${timeDiff} minutes ago` : `${Math.round(timeDiff / 60)} hours ago`
    comparisons.push(
      `- ${timeStr}: Detected ${prev.analysis.disaster_type} (severity: ${prev.analysis.severity}, confidence: ${prev.analysis.confidence}%). ` +
      `Objects: ${prev.analysis.objects_detected.slice(0, 5).join(', ') || 'N/A'}.`
    )
  }

  let trendNote = ''
  const lastPrev = previous[previous.length - 1]
  if (lastPrev) {
    if (lastPrev.analysis.disaster_type === currentAnalysis.disaster_type) {
      const severityRank = { none: 0, low: 1, moderate: 2, high: 3, critical: 4 }
      const prevRank = severityRank[lastPrev.analysis.severity] || 0
      const currRank = severityRank[currentAnalysis.severity] || 0
      if (currRank > prevRank) trendNote = `\n?? TREND: Situation appears to be ESCALATING (severity increased from ${lastPrev.analysis.severity} to ${currentAnalysis.severity}).`
      else if (currRank < prevRank) trendNote = `\n? TREND: Situation appears to be IMPROVING (severity decreased from ${lastPrev.analysis.severity} to ${currentAnalysis.severity}).`
      else trendNote = `\nTREND: Situation severity UNCHANGED (${currentAnalysis.severity}).`
    } else {
      trendNote = `\n? NOTE: Different disaster type detected compared to previous image (was: ${lastPrev.analysis.disaster_type}, now: ${currentAnalysis.disaster_type}).`
    }
  }

  return `\n\n[IMAGE COMPARISON -- TEMPORAL CONTEXT]\nPrevious image analyses in this session:\n${comparisons.join('\n')}${trendNote}\n\nUse this temporal context to inform your response -- note any changes or escalation.`
}

//Image Analysis (Vision) Implementation
export async function executeImageAnalysis(imageUrl: string, context?: string, sessionId?: string): Promise<string> {
  const startTime = Date.now()
  const contextNote = context ? `\n\nADDITIONAL CONTEXT FROM CITIZEN: "${context}"` : ''
  const visionPrompt = `You are a senior disaster assessment specialist with expertise across ALL hazard types. Analyze this image using chain-of-thought reasoning.

## CHAIN-OF-THOUGHT PROCESS (follow each step BEFORE concluding)

**Step 1 -- OBSERVE:** List EVERY visible element: terrain, structures, vegetation, sky, water, people, vehicles, smoke, debris, utility infrastructure, road surfaces, weather conditions. Note colors, textures, lighting, time of day.
**Step 2 -- MEASURE:** Using reference objects (door -- 2m, car -- 4.5m long, person -- 1.7m, curb -- 15cm, fire hydrant -- 60cm, mailbox -- 100cm, traffic light -- 250cm), estimate distances, depths, areas, visibility ranges.
**Step 3 -- CLASSIFY:** Based on observations, identify the PRIMARY disaster type from AEGIS categories:
  flood | severe_storm | heatwave | wildfire | landslide | drought | power_outage | water_supply_disruption | infrastructure_damage | public_safety_incident | environmental_hazard | earthquake | volcanic | safe
**Step 4 -- REASON:** Explain WHY you classified it this way. What evidence supports your conclusion? What alternative interpretations did you consider and reject?
**Step 5 -- ASSESS:** Rate severity and immediate risks based on evidence, not assumption.

## DOMAIN REFERENCE -- Use these expert scales for precise assessment

### FLOOD (type: "flood")
- Water color ? contamination: clear = rain runoff, brown = soil/sewage, black = chemical/oil, green = algae/stagnant
- Depth by reference: ankle <15cm, knee 30-45cm, waist 75-100cm, chest >100cm -- fast flow + knee-deep = lethal
- Submerged landmarks: fire hydrant -- 60cm, mailbox -- 100cm, traffic light pole -- 250cm
- Subtypes: fluvial (river banks breached), pluvial (drains overwhelmed, urban), coastal (storm surge, salt residue), flash (narrow channel, rapid rise), groundwater (no visible source, seepage)
- Severity: low = puddles/minor ponding, moderate = ankle-knee, high = knee-waist with flow, critical = chest+ or fast-moving

### SEVERE STORM (type: "severe_storm")
- Wind clues: swaying trees = 40-60 km/h, horizontal rain = 80+, structural damage = 120+ km/h
- Saffir-Simpson: Cat 1-2 = branches/signs down; Cat 3 = trees uprooted, roof decking exposed; Cat 4-5 = total roof loss, wall collapse
- Tornado indicators: narrow damage path, twisted metal, vehicles displaced, debris lofted, funnel cloud
- Hail markers: pockmarked vehicles/roofs, leaf stripping, dent diameter -- hailstone size
- Lightning damage: spiral bark stripping on trees, scorch marks, electrical fire origin

### HEATWAVE (type: "heatwave")
- Visual: heat shimmer/mirage on roads, buckled/melted asphalt, dried-out vegetation, empty public spaces daytime
- Infrastructure stress: rail deformation (sun kink), sagging power lines, road surface melting/bleeding tar
- Urban heat island: black rooftops, concrete surfaces, no green canopy, parked car density
- Human indicators: people seeking shade, overcrowded cooling stations, outdoor workers resting
- Severity: moderate = 35-39--C indicators, high = 40-44--C, critical = 45--C+ or prolonged multi-day

### WILDFIRE (type: "wildfire")
- NWCG fire type ladder: ground fire (duff/roots, smoldering) = low; surface fire (grass/shrubs, <1.2m flame) = moderate; crown fire (canopy-to-canopy, ember shower) = critical; spot fire (embers ahead of front)
- Smoke color: white = moisture/new fuel, gray = mixed, black = petroleum/structures burning
- Defensible space: 30m clearance = survivable; fire at structure contact = structural loss imminent
- Post-fire: scorched earth (black/grey), standing dead trees (snags), ash coverage, debris flow risk from denuded slopes

### LANDSLIDE (type: "landslide")
- Rotational: curved scarp, intact tilted blocks, ponded water at toe
- Translational: planar surface, debris sheet, stripped vegetation
- Debris flow: water-saturated, channelized, muddy, high-velocity
- Rockfall: boulders on road, impact craters, shattered fragments
- Imminent secondary risk: tension cracks upslope, leaning trees/poles, bulging ground, seepage from slope face

### DROUGHT (type: "drought")
- Vegetation: brown/yellow grassland (should be green), wilting crops, leaf curl, tree die-off
- Water bodies: receded shorelines (exposed bed), dried reservoir/lake, cracked mud flats
- Soil: deep polygonal cracks (desiccation), dust clouds, bare earth where cover expected
- Agriculture: failed crop rows, empty irrigation channels, livestock at diminished water
- Severity: moderate = visibly dry, high = crop failure visible, critical = water bodies empty

### POWER OUTAGE (type: "power_outage")
- Causes visible: downed power lines, snapped utility poles, transformer explosion/fire, fallen trees on lines
- Impact: dark buildings at night (no lights), darkened traffic signals, emergency generators visible
- Safety hazards: live wires on ground (arcing), water near electrical equipment, damaged switchgear
- Cascade indicators: multiple blocks dark, traffic chaos from signal failure
- Differentiate from normal night: check street lights, signal status, window lighting patterns

### WATER SUPPLY DISRUPTION (type: "water_supply_disruption")
- Pipe burst: geyser/fountain from ground, flooded street from broken main, exposed/broken piping
- Contamination: discolored water in puddles (chemical sheen, unusual color), dead fish/wildlife near source
- Distribution: empty store shelves (bottled water), tanker trucks, distribution points
- Infrastructure: collapsed water tower, cracked reservoir, flooded pump station
- Differentiate from flood: water supply = pressurized water from infrastructure failure, not natural rising water

### INFRASTRUCTURE DAMAGE (type: "infrastructure_damage")
- ATC-20 rapid assessment: Green tag = cosmetic cracks <3mm; Yellow tag = cracks 3-10mm, partial non-structural collapse; Red tag = diagonal shear cracks, structural collapse, tilting, pancaked floors
- Roads: potholes, sinkholes, pavement heaving, road washout, bridge deck separation
- Bridges: displaced bearings, pier scour, deck cracking, abutment failure
- Collapse types: progressive (cascading floors), pancake (floors stacked), lean/tilt, partial
- Sinkhole: circular depression, collapsed pavement, concentric cracks, vehicles/structures tilted inward

### PUBLIC SAFETY INCIDENT (type: "public_safety_incident")
- Scene indicators: emergency vehicle presence (police, ambulance), cordon tape, crowds running/dispersing
- Aftermath: broken glass, debris field, abandoned personal belongings, overturned objects
- Response: armed response vehicles, helicopter overhead, locked-down buildings, triage areas
- NOTE: Do NOT identify individuals, weapons, or specific threats -- focus on scene-level assessment only

### ENVIRONMENTAL HAZARD (type: "environmental_hazard")
- Chemical spill: discolored liquid on ground/water, hazmat placards, dead vegetation in spill path, foam/bubbles
- Air quality: visible smog/haze (brown = NO2, gray = particulates), industrial stack emissions, gas clouds (green = chlorine, orange = nitric acid)
- Water contamination: iridescent oil sheen, algal bloom (bright green), fish kill, foam on surface
- Hazmat response: decontamination tents, suited responders, air monitoring equipment, exclusion zones
- Soil: stained ground, dead patches in healthy vegetation, leaking drums/containers

### EARTHQUAKE (type: "earthquake")
- Structural: diagonal shear cracks = seismic failure, pancaked floors = soft-story collapse, tilted structures on flat ground = liquefaction
- Liquefaction: sand boils (small sand volcanoes), ground subsidence, tilted buildings with no structural cracks
- Aftershock risk: partially collapsed walls, hanging debris, precariously balanced elements
- Tsunami (post-earthquake coastal): inland water surge, debris line, boats displaced inland, watermark on buildings
- Surface: linear ground fissures, offset roads/fences, step faults

### VOLCANIC (type: "volcanic")
- Active eruption: lava flows (orange/red), pyroclastic flow (fast-moving grey cloud), ash column (dark vertical plume), lava fountaining
- Ashfall: grey coating on surfaces, collapsed roofs under ash weight, reduced visibility, vehicles coated
- Lahar (volcanic mudflow): grey mud engulfing valleys/towns, destroyed bridges, channelized debris
- Gas hazard: blue haze (SO2), dead vegetation in gas path, steaming vents/fumaroles
- Post-eruption: barren grey terrain, ghost forests (standing dead trees), crater lake

### ADVERSARIAL AWARENESS -- DO NOT misclassify these
- Sunset/sunrise ? wildfire (check for actual flames, smoke source, fuel)
- Construction/demolition ? earthquake (check for machinery, orderly process, workers)
- Swimming pool/fountain ? flood (check for containment, normal infrastructure)
- Fog/mist ? smoke (check for smell indicators in context, color, source point)
- Autumn leaves ? fire (check for actual combustion, heat distortion)
- Road construction ? infrastructure damage (check for equipment, signage, workers)

## FEW-SHOT EXAMPLES (calibrate your analysis to these)

**Example A -- Wildfire:** Orange/red flames consuming hillside vegetation, thick dark smoke rising, ember shower visible, dry brown landscape. ? disaster_type: "wildfire", severity: "critical", confidence: 95, reasoning: "Active crown fire with ember generation, black smoke indicates structural fuel involvement"

**Example B -- Urban Flooding:** Brown water covering street to car-door height, debris floating, buildings partially submerged to first floor. ? disaster_type: "flood", severity: "high", confidence: 90, reasoning: "Water depth 60-80cm (car reference), brown color indicates soil/sewage contamination, active flow from debris movement"

**Example C -- Earthquake Damage:** Collapsed concrete building, rubble pile, diagonal cracks in standing walls, dust cloud, tilted utility poles. ? disaster_type: "earthquake", severity: "critical", confidence: 85, reasoning: "Diagonal shear cracks in remaining walls = seismic failure pattern, no fire or water present to explain collapse"

**Example D -- Safe Scene:** Clear sky, intact buildings, normal traffic, green vegetation, no visible damage or hazard. ? disaster_type: "safe", severity: "none", confidence: 90, reasoning: "No indicators of any disaster type across all 13 AEGIS categories"

**Example E -- Power Outage:** Snapped utility poles, downed power lines across road, darkened traffic signals, fallen tree on transformer. ? disaster_type: "power_outage", severity: "high", confidence: 88, reasoning: "Downed lines with visible damage to transformer, multiple poles affected suggesting widespread outage"

**Example F -- Environmental Hazard:** Iridescent oil sheen on river surface, dead fish visible on bank, industrial facility in background, hazmat vehicle present. ? disaster_type: "environmental_hazard", severity: "high", confidence: 87, reasoning: "Oil sheen pattern + fish kill indicates active contamination, industrial source identified"

**Example G -- Severe Storm:** Uprooted trees across road, roof sections torn off houses, horizontal rain, dark sky with rotation. ? disaster_type: "severe_storm", severity: "critical", confidence: 92, reasoning: "Uprooted mature trees indicate wind >120 km/h, roof decking exposed = Cat 3+ wind damage"

**Example H -- Drought:** Polygonal cracked mud flat where lake should be, dead brown vegetation, exposed boat dock on dry land. ? disaster_type: "drought", severity: "high", confidence: 85, reasoning: "Desiccation cracks + exposed infrastructure normally submerged indicates severe water deficit"${contextNote}

## YOUR ANALYSIS

First, provide your detailed analysis following the 5-step chain-of-thought above, referencing the DOMAIN REFERENCE scales where applicable.
Then, provide your IMMEDIATE SAFETY ACTIONS (top 3-5 specific actions for this situation).
Then, provide PROFESSIONAL RECOMMENDATIONS (services to contact, evacuation routes, what NOT to do).

Finally, output a structured JSON block at the END of your response:

\`\`\`json
{
  "disaster_type": "flood|severe_storm|heatwave|wildfire|landslide|drought|power_outage|water_supply_disruption|infrastructure_damage|public_safety_incident|environmental_hazard|earthquake|volcanic|safe|unknown",
  "severity": "critical|high|moderate|low|none",
  "confidence": 85,
  "scene_description": "One-sentence summary of what you see",
  "objects_detected": ["object1", "object2"],
  "risk_factors": ["risk1", "risk2"],
  "recommended_actions": ["action1", "action2"],
  "reasoning_chain": "Brief summary of your Step 4 reasoning"
}
\`\`\`

CRITICAL: Be SPECIFIC to what you see. If the image is unclear, lower your confidence. If NO hazard is visible, say so -- never manufacture danger. Use the ADVERSARIAL AWARENESS section to avoid common misclassifications.`

  //Strategy 0: CLIP zero-shot classification via AI Engine (fastest, ~37ms GPU)
  //Returns structured classification without needing an LLM vision model
  let clipResult: { disaster_type?: string; confidence?: number; severity?: string; probabilities?: Record<string, number> } | null = null
  try {
    const { aiClient } = await import('./aiClient.js')
    const aiAvailable = await aiClient.isAvailable().catch(() => false)
    if (aiAvailable) {
      //Read image file for CLIP classification
      const fs = await import('fs')
      const path = await import('path')
      let imageBuffer: Buffer | null = null

      if (imageUrl.startsWith('/uploads/') || imageUrl.startsWith('uploads/')) {
        const fullPath = path.join(process.cwd(), imageUrl.startsWith('/') ? imageUrl.slice(1) : imageUrl)
        if (fs.existsSync(fullPath)) {
          imageBuffer = fs.readFileSync(fullPath)
        }
      } else if (imageUrl.startsWith('http')) {
        const imgRes = await fetchWithTimeout(imageUrl, { timeout: 10000 })
        const arrayBuf = await imgRes.arrayBuffer()
        imageBuffer = Buffer.from(arrayBuf)
      }

      if (imageBuffer) {
        const result = await aiClient.classifyImage(imageBuffer, path.basename(imageUrl))
        if (result && !result.error && result.disaster_type) {
          clipResult = {
            disaster_type: result.disaster_type,
            confidence: Math.round((result.confidence || 0) * 100),
            severity: result.risk_level,
            probabilities: result.probabilities,
          }
          devLog(`[Vision] CLIP classified: ${result.disaster_type} (${(result.confidence * 100).toFixed(0)}%) in ${result.processing_time_ms}ms`)
        }
      }
    }
  } catch (err: any) {
    devLog(`[Vision] CLIP classification skipped: ${err.message}`)
  }

  //Strategy 1: Gemini Vision (free tier, supports images natively)
  const geminiKey = process.env.GEMINI_API_KEY
  if (geminiKey) {
    try {
      //If it's a local file path, read and base64-encode it
      let imageData: { inlineData?: { mimeType: string; data: string }; fileUri?: string } | undefined
      if (imageUrl.startsWith('/uploads/') || imageUrl.startsWith('uploads/')) {
        const fs = await import('fs')
        const path = await import('path')
        const fullPath = path.join(process.cwd(), imageUrl.startsWith('/') ? imageUrl.slice(1) : imageUrl)
        if (fs.existsSync(fullPath)) {
          const fileBuffer = fs.readFileSync(fullPath)
          const base64 = fileBuffer.toString('base64')
          const ext = path.extname(fullPath).toLowerCase()
          const mimeMap: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.jfif': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' }
          imageData = { inlineData: { mimeType: mimeMap[ext] || 'image/jpeg', data: base64 } }
        }
      } else if (imageUrl.startsWith('http')) {
        //Fetch remote image and convert to base64
        const imgRes = await fetchWithTimeout(imageUrl, { timeout: 10000 })
        const arrayBuf = await imgRes.arrayBuffer()
        const base64 = Buffer.from(arrayBuf).toString('base64')
        const contentType = imgRes.headers.get('content-type') || 'image/jpeg'
        imageData = { inlineData: { mimeType: contentType, data: base64 } }
      }

      if (imageData) {
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`
        devLog(`[Vision] Calling Gemini Vision API (image size: ${imageData.inlineData?.data?.length || 0} base64 chars)`)
        const geminiRes = await fetchWithTimeout(
          geminiUrl,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{
                parts: [
                  { text: visionPrompt },
                  imageData,
                ],
              }],
              generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
            }),
            timeout: 30000,
          },
        )
        const geminiData = await geminiRes.json() as any
        if (!geminiRes.ok) {
          devLog(`[Vision] Gemini API error: ${geminiRes.status} -- ${JSON.stringify(geminiData?.error?.message || geminiData).slice(0, 300)}`)
        } else {
          const analysis = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text
          if (analysis && analysis.length > 50) {
            const elapsedMs = Date.now() - startTime
            devLog(`[Vision] Gemini analyzed image successfully (${analysis.length} chars, ${elapsedMs}ms)`)
            const structured = parseVisionStructuredOutput(analysis, 'Gemini Vision AI', elapsedMs)
            if (sessionId) storeImageAnalysis(sessionId, imageUrl, structured)
            const confidenceBadge = structured.confidence >= 80 ? '??' : structured.confidence >= 50 ? '??' : '??'
            return `?? **Image Analysis** (Gemini Vision AI) -- ${confidenceBadge} ${structured.confidence}% confidence\n**Detected:** ${structured.disaster_type.toUpperCase()} | **Severity:** ${structured.severity.toUpperCase()}\n\n${analysis}`
          } else {
            devLog(`[Vision] Gemini returned empty/short analysis: ${JSON.stringify(geminiData?.candidates?.[0]).slice(0, 200)}`)
          }
        }
      } else {
        devLog(`[Vision] Could not load image data for: ${imageUrl}`)
      }
    } catch (err: any) {
      devLog(`[Vision] Gemini vision failed: ${err.message}`)
    }
  }

  //Strategy 2: Ollama with a vision-capable model (llava, bakllava, etc.)
  const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
  const visionModelHint = process.env.OLLAMA_VISION_MODEL || 'llava'
  const triageModelHint = process.env.OLLAMA_VISION_TRIAGE_MODEL || ''
  try {
    devLog(`[Vision] Checking Ollama at ${ollamaUrl} for vision model matching '${visionModelHint}'`)
    //Check if model exists -- use the actual model name from tags (e.g. 'llava:7b' not just 'llava')
    const tagRes = await fetchWithTimeout(`${ollamaUrl}/api/tags`, { timeout: 5000 })
    const tags = await tagRes.json() as any
    const foundModel = tags?.models?.find((m: any) => m.name.includes(visionModelHint))
    const visionModel = foundModel?.name || visionModelHint
    const foundTriage = triageModelHint ? tags?.models?.find((m: any) => m.name.includes(triageModelHint)) : null
    const triageModel = foundTriage?.name || ''
    devLog(`[Vision] Ollama models: ${tags?.models?.map((m: any) => m.name).join(', ') || 'none'}, deep: ${foundModel?.name || 'NONE'}, triage: ${foundTriage?.name || 'NONE'}`)

    if (foundModel) {
      let base64 = ''
      if (imageUrl.startsWith('/uploads/') || imageUrl.startsWith('uploads/')) {
        const fs = await import('fs')
        const path = await import('path')
        const fullPath = path.join(process.cwd(), imageUrl.startsWith('/') ? imageUrl.slice(1) : imageUrl)
        if (fs.existsSync(fullPath)) {
          base64 = fs.readFileSync(fullPath).toString('base64')
        }
      } else if (imageUrl.startsWith('http')) {
        try {
          const imgRes = await fetchWithTimeout(imageUrl, { timeout: 15000 })
          const arrayBuf = await imgRes.arrayBuffer()
          base64 = Buffer.from(arrayBuf).toString('base64')
        } catch (err: any) {
          devLog(`[Vision] Failed to fetch remote image for Ollama: ${err.message}`)
        }
      }
      if (base64) {
        //Consolidated 7-category taxonomy -- single pass, temp 0.2
        //earthquake merged into structural_damage, heatwave merged into drought
        //gemma3:4b peaks at 40.5% with minimal prompt -- less is more for 4B models
        const ollamaPrompt = `Classify this image into exactly ONE category. Choose from: wildfire, flood, storm, landslide, drought, structural_damage, safe.

Reply with a JSON block only:
\`\`\`json
{"disaster_type": "<category>", "severity": "critical|high|moderate|low|none", "confidence": 0-100, "scene_description": "one sentence"}
\`\`\`${contextNote}`

        const callOllamaVision = async (model: string, prompt: string, label: string) => {
          devLog(`[Vision] Calling Ollama ${model} (${label}) with ${base64.length} base64 chars`)
          try {
            const res = await fetchWithTimeout(
              `${ollamaUrl}/api/generate`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  model,
                  prompt,
                  images: [base64],
                  stream: false,
                  options: { temperature: 0.2, num_predict: 2048 },
                }),
                timeout: 120000,
              },
            )
            if (!res.ok) {
              const errText = await res.text().catch(() => 'no body')
              devLog(`[Vision] Ollama ${model} (${label}) returned HTTP ${res.status}: ${errText.slice(0, 200)}`)
              return null
            }
            const data = await res.json() as any
            if (!data?.response) {
              devLog(`[Vision] Ollama ${model} (${label}) response missing 'response' field`)
              return null
            }
            return data.response as string
          } catch (err: any) {
            devLog(`[Vision] Ollama ${model} (${label}) call failed: ${err.message}`)
            return null
          }
        }

        let finalResponse: string | null = null
        let finalModelUsed = visionModel

        //Single-pass classification
        finalResponse = await callOllamaVision(visionModel, ollamaPrompt, 'primary')

        if (finalResponse) {
          const elapsedMs = Date.now() - startTime
          devLog(`[Vision] Ollama ${finalModelUsed} analyzed image successfully (${elapsedMs}ms)`)
          const structured = parseVisionStructuredOutput(finalResponse, `Ollama ${finalModelUsed}`, elapsedMs)
          if (sessionId) storeImageAnalysis(sessionId, imageUrl, structured)
          const confidenceBadge = structured.confidence >= 80 ? '??' : structured.confidence >= 50 ? '??' : '??'
          return `?? **Image Analysis** (${finalModelUsed}) -- ${confidenceBadge} ${structured.confidence}% confidence\n**Detected:** ${structured.disaster_type.toUpperCase()} | **Severity:** ${structured.severity.toUpperCase()}\n\n${finalResponse}`
        }
      }
    }
  } catch (err: any) {
    devLog(`[Vision] Ollama vision failed: ${err.message}`)
  }

  //Strategy 3: OpenRouter Vision -- PARALLEL race across free models for speed
  const openrouterKey = process.env.OPENROUTER_API_KEY
  if (openrouterKey) {
    const visionModels = [
      'nvidia/nemotron-nano-12b-v2-vl:free',
      'google/gemma-3-27b-it:free',
      'mistralai/mistral-small-3.1-24b-instruct:free',
      'google/gemma-3-12b-it:free',
      'google/gemma-3-4b-it:free',
    ]

    //Prepare base64 image data once (shared across all parallel calls)
    let base64Data = ''
    let mimeType = 'image/jpeg'
    if (imageUrl.startsWith('/uploads/') || imageUrl.startsWith('uploads/')) {
      const fs = await import('fs')
      const path = await import('path')
      const fullPath = path.join(process.cwd(), imageUrl.startsWith('/') ? imageUrl.slice(1) : imageUrl)
      if (fs.existsSync(fullPath)) {
        base64Data = fs.readFileSync(fullPath).toString('base64')
        const ext = path.extname(fullPath).toLowerCase()
        if (ext === '.png') mimeType = 'image/png'
        else if (ext === '.webp') mimeType = 'image/webp'
        else if (ext === '.gif') mimeType = 'image/gif'
      }
    } else if (imageUrl.startsWith('http')) {
      try {
        const imgRes = await fetchWithTimeout(imageUrl, { timeout: 15000 })
        const arrayBuf = await imgRes.arrayBuffer()
        base64Data = Buffer.from(arrayBuf).toString('base64')
        mimeType = imgRes.headers.get('content-type') || 'image/jpeg'
        devLog(`[Vision] Fetched remote image for OpenRouter (${base64Data.length} base64 chars)`)
      } catch (err: any) {
        devLog(`[Vision] Failed to fetch remote image for OpenRouter: ${err.message}`)
      }
    }

    if (base64Data) {
      //Fire ALL models in parallel, take the first valid response
      devLog(`[Vision] Racing ${visionModels.length} OpenRouter models in parallel`)
      const racePromises = visionModels.map(async (orModel) => {
        try {
          const orRes = await fetchWithTimeout(
            'https://openrouter.ai/api/v1/chat/completions',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${openrouterKey}`,
              },
              body: JSON.stringify({
                model: orModel,
                messages: [{
                  role: 'user',
                  content: [
                    { type: 'text', text: visionPrompt },
                    { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Data}` } },
                  ],
                }],
                temperature: 0.2,
                max_tokens: 2048,
              }),
              timeout: 60000,
            },
          )
          const orData = await orRes.json() as any
          if (!orRes.ok) {
            throw new Error(`${orRes.status}: ${orData?.error?.message || 'Unknown error'}`)
          }
          const analysis = orData?.choices?.[0]?.message?.content
          if (!analysis || analysis.length <= 50) {
            throw new Error('Response too short')
          }
          devLog(`[Vision] OpenRouter ${orModel} succeeded (${analysis.length} chars)`)
          return { analysis, model: orModel }
        } catch (err: any) {
          devLog(`[Vision] OpenRouter ${orModel} failed: ${err.message}`)
          throw err // re-throw so Promise.any skips it
        }
      })

      try {
        const winner = await Promise.any(racePromises)
        const elapsedMs = Date.now() - startTime
        const modelLabel = winner.model.split('/')[1]?.split(':')[0] || 'Vision AI'
        const structured = parseVisionStructuredOutput(winner.analysis, modelLabel, elapsedMs)
        if (sessionId) storeImageAnalysis(sessionId, imageUrl, structured)

        const confidenceBadge = structured.confidence >= 80 ? '??' : structured.confidence >= 50 ? '??' : '??'
        return `?? **Image Analysis** (${modelLabel}) -- ${confidenceBadge} ${structured.confidence}% confidence\n**Detected:** ${structured.disaster_type.toUpperCase()} | **Severity:** ${structured.severity.toUpperCase()}\n\n${winner.analysis}`
      } catch {
        devLog(`[Vision] All ${visionModels.length} OpenRouter models failed`)
      }
    }
  }

  devLog(`[Vision] ALL vision backends failed for image: ${imageUrl}`)
  return '__VISION_UNAVAILABLE__'
}

 /*
 * Execute composite tool calls -- multiple tools in a single turn.
 * Accepts a list of tool call descriptors and runs them concurrently,
 * returning a combined summary of all results.
  */
export async function executeCompositeToolCalls(
  calls: Array<{ name: string; args: Record<string, unknown> }>,
): Promise<{ results: Array<{ tool: string; result: string }>; summary: string }> {
  const results = await Promise.all(
    calls.map(async (call) => {
      const result = await executeToolCall(call.name, call.args)
      return { tool: call.name, result }
    }),
  )

  //Build a condensed summary for each result
  const summaryParts = results.map(({ tool, result }) => {
    //Summarize verbose results to keep context window manageable
    const condensed = result.length > 500
      ? result.slice(0, 480) + '... [truncated -- full data retrieved]'
      : result
    return `[${tool}]: ${condensed}`
  })

  return {
    results,
    summary: summaryParts.join('\n\n'),
  }
}

