 /*
 * dataRoutes.ts - Alerts, activity log, AI metrics, weather, and flood zone APIs
 * Combines several data endpoints into one router:
 *   GET/POST /api/alerts              - Manage emergency alerts
 *   GET      /api/activity            - Audit trail of operator actions
 *   GET      /api/ai/models           - AI model performance metrics
 *   GET      /api/weather/:lat/:lng   - Proxy to OpenWeatherMap API
 *   GET      /api/flood-check         - PostGIS point-in-polygon flood zone check
 *   GET      /api/sepa/gauges/:loc    - SEPA river gauge data proxy
  */

import { Router, Request, Response, NextFunction } from 'express'
import pool from '../models/db.js'
import { adminOnly, authMiddleware, operatorOnly, AuthRequest, verifyToken } from '../middleware/auth.js'
import { FloodDataClient } from '../utils/FloodDataClient.js'
import * as notificationService from '../services/notificationService.js'
import { devLog } from '../utils/logger.js'
import { getActiveCityRegion } from '../config/regions/index.js'
import { alertBroadcastsTotal, alertDeliveryTotal, alertDeliveryLatency } from '../services/metrics.js'
import { AppError } from '../utils/AppError.js'
import { validate, paginationSchema } from '../middleware/validate.js'
import { remember, buildCacheKey, cacheInvalidatePattern, cacheDel, CACHE_TTL, type CacheResponseMeta } from '../services/cacheService.js'
import { logger } from '../services/logger.js'

const router = Router()
const floodDataClient = new FloodDataClient()
const activeRegion = getActiveCityRegion()
const defaultLat = activeRegion.centre.lat
const defaultLng = activeRegion.centre.lng

 /*
 * ALERTS ENDPOINTS
  */

 /*
 * GET /api/alerts
 * Returns all active alerts, newest first.
  */
router.get('/alerts', validate({ query: paginationSchema }), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { page, limit } = (req as any).validatedQuery as { page: number; limit: number }
    const offset = (page - 1) * limit
    const key = buildCacheKey('alerts', [activeRegion.id, 'active-list', `p${page}`, `l${limit}`])
    const { data, meta } = await remember(key, CACHE_TTL.ALERT_LIST, async () => {
      const countResult = await pool.query(
        `SELECT COUNT(*) FROM alerts WHERE is_active = true`
      )
      const total = parseInt(countResult.rows[0].count)
      const result = await pool.query(
        `SELECT id, title, message, severity, alert_type, location_text,
                ST_Y(coordinates::geometry) as lat, ST_X(coordinates::geometry) as lng,
                radius_km, is_active, expires_at, created_at
         FROM alerts WHERE is_active = true ORDER BY created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      )
      return {
        data: result.rows.map(a => ({
          id: a.id, title: a.title, message: a.message,
          severity: a.severity, type: a.alert_type,
          location: a.location_text,
          coordinates: a.lat ? [parseFloat(a.lat), parseFloat(a.lng)] : null,
          radiusKm: a.radius_km, expiresAt: a.expires_at,
          createdAt: a.created_at,
        })),
        total,
        page,
        limit,
      }
    })
    if (meta.stale) res.set('X-Cache-Stale', 'true')
    res.json(data)
  } catch (err) {
    next(err)
  }
})

 /*
 * POST /api/alerts
 * Create a new alert (admin only).
  */
router.post('/alerts', authMiddleware, operatorOnly, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { title, message, severity, alertType, locationText, lat, lng, radiusKm, expiresAt, channels } = req.body

    if (!title || !message || !severity) {
      throw AppError.badRequest('Title, message, and severity are required.')
    }

    const hasCoords = lat != null && lng != null
    const coordsSql = hasCoords
      ? 'ST_SetSRID(ST_Point($6::float8, $7::float8), 4326)'
      : 'NULL'

    const result = await pool.query(
      `INSERT INTO alerts (title, message, severity, alert_type, location_text, coordinates, radius_km, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, ${coordsSql}, $8, $9, $10)
       RETURNING id, created_at`,
      [
        title, message, severity, alertType || 'general', locationText || '',
        hasCoords ? parseFloat(lng as string) : null, hasCoords ? parseFloat(lat as string) : null,
        radiusKm || 10.0, expiresAt || null, req.user!.id
      ]
    )

    // Log the alert creation
    await pool.query(
      `INSERT INTO activity_log (action, action_type, operator_id, operator_name)
       VALUES ($1, $2, $3, $4)`,
      [`Sent alert: ${title}`, 'alert', req.user!.id, req.user!.displayName]
    )

    const alertId = result.rows[0].id
    const targetChannels = sanitizeChannels(channels)
    const recipients = await getSubscribersForChannels(targetChannels, severity)
    const deliveryResults = await dispatchAlertDeliveries(alertId, title, message, targetChannels, recipients)
    alertBroadcastsTotal.inc()

    // Invalidate cached alert and flood-data listings so consumers see the new alert immediately
    cacheInvalidatePattern('aegis:v1:alerts:*').catch(() => {})
    cacheInvalidatePattern('aegis:v1:flood_data:*').catch(() => {})
    cacheInvalidatePattern('aegis:v1:news:*').catch(() => {})

    res.status(201).json({
      id: alertId,
      createdAt: result.rows[0].created_at,
      channels: targetChannels,
      delivery: {
        attempted: deliveryResults.length,
        sent: deliveryResults.filter(d => d.status === 'sent' || d.status === 'delivered').length,
        failed: deliveryResults.filter(d => d.status === 'failed').length,
        results: deliveryResults
      }
    })
  } catch (err) {
    next(err)
  }
})

 /*
 * ACTIVITY LOG ENDPOINTS
  */

 /*
 * GET /api/activity
 * Returns the last 100 activity log entries (admin only).
  */
router.get('/activity', authMiddleware, adminOnly, validate({ query: paginationSchema }), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { page, limit } = (req as any).validatedQuery as { page: number; limit: number }
    const offset = (page - 1) * limit

    const countResult = await pool.query(`SELECT COUNT(*) FROM activity_log`)
    const total = parseInt(countResult.rows[0].count)

    const result = await pool.query(
      `SELECT id, action, action_type, report_id, operator_name, metadata, created_at
       FROM activity_log ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    )
    res.json({
      data: result.rows.map(a => ({
        id: a.id, action: a.action, type: a.action_type,
        reportId: a.report_id, operator: a.operator_name,
        metadata: a.metadata, timestamp: a.created_at,
      })),
      total,
      page,
      limit,
    })
  } catch (err) {
    next(err)
  }
})

 /*
 * POST /api/activity
 * Record a new activity entry (admin only).
  */
router.post('/activity', authMiddleware, operatorOnly, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { action, actionType, reportId } = req.body
    await pool.query(
      `INSERT INTO activity_log (action, action_type, report_id, operator_id, operator_name)
       VALUES ($1, $2, $3, $4, $5)`,
      [action, actionType || 'export', reportId || null, req.user!.id, req.user!.displayName]
    )
    res.status(201).json({ success: true })
  } catch (err) {
    next(err)
  }
})

 /*
 * AI MODEL METRICS — MOVED to aiRoutes.ts (Phase 5 Governance)
 * GET /api/ai/models now served by aiRoutes with live AI engine data
  */

 /*
 * WEATHER API PROXY
  */

 /*
 * GET /api/weather/:lat/:lng
 * Proxies requests to OpenWeatherMap API.
 * Requires WEATHER_API_KEY to be set in .env
 * Returns current weather + 24h forecast.
  */
router.get('/weather/:lat/:lng', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { lat, lng } = req.params
    const apiKey = process.env.WEATHER_API_KEY
    const key = buildCacheKey('weather', [activeRegion.id, 'forecast'], { lat, lng })

    const { data: result, meta } = await remember(key, CACHE_TTL.WEATHER, async () => {
      // Primary: Open-Meteo (no API key required)
      const openMeteoRes = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,rain,weather_code,cloud_cover,pressure_msl,wind_speed_10m,visibility&hourly=temperature_2m,rain,wind_speed_10m,weather_code&forecast_days=2&timezone=UTC`
      )

      if (openMeteoRes.ok) {
        const data = await openMeteoRes.json()
        const current = data.current || {}
        const hourly = data.hourly || {}

        const forecast = Array.isArray(hourly.time)
          ? hourly.time
              .slice(0, 24)
              .filter((_: unknown, idx: number) => idx % 3 === 0)
              .slice(0, 8)
              .map((time: string, idx: number) => ({
                time,
                temp: Math.round(hourly.temperature_2m?.[idx * 3] ?? 0),
                rainfall: hourly.rain?.[idx * 3] ?? 0,
                windSpeed: Math.round(hourly.wind_speed_10m?.[idx * 3] ?? 0),
                description: typeof hourly.weather_code?.[idx * 3] === 'number' ? `WMO ${hourly.weather_code[idx * 3]}` : 'Unknown',
              }))
          : []

        return {
          source: 'live' as const,
          current: {
            temp: Math.round(current.temperature_2m ?? 0),
            feelsLike: Math.round(current.apparent_temperature ?? current.temperature_2m ?? 0),
            humidity: current.relative_humidity_2m ?? 0,
            pressure: Math.round(current.pressure_msl ?? 0),
            windSpeed: Math.round(current.wind_speed_10m ?? 0),
            description: typeof current.weather_code === 'number' ? `WMO ${current.weather_code}` : 'Unknown',
            icon: '03d',
            rainfall1h: current.rain ?? current.precipitation ?? 0,
            rainfall3h: (current.rain ?? current.precipitation ?? 0) * 3,
            clouds: current.cloud_cover ?? 0,
          },
          forecast,
        }
      }

      // Secondary: OpenWeatherMap (optional, requires key)
      if (!apiKey) {
        throw new Error('Live weather provider unavailable. Configure WEATHER_API_KEY for fallback provider.')
      }

      const [currentRes, forecastRes] = await Promise.all([
        fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&appid=${apiKey}&units=metric`),
        fetch(`https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lng}&appid=${apiKey}&units=metric&cnt=8`),
      ])

      if (!currentRes.ok) {
        throw new Error(`OpenWeatherMap error: HTTP ${currentRes.status}`)
      }

      const current = await currentRes.json()
      const forecast = forecastRes.ok ? await forecastRes.json() : { list: [] }

      return {
        source: 'live' as const,
        current: {
          temp: Math.round(current.main.temp),
          feelsLike: Math.round(current.main.feels_like),
          humidity: current.main.humidity,
          pressure: current.main.pressure,
          windSpeed: Math.round(current.wind.speed * 3.6),
          description: current.weather[0].description,
          icon: current.weather[0].icon,
          rainfall1h: current.rain?.['1h'] || 0,
          rainfall3h: current.rain?.['3h'] || 0,
          clouds: current.clouds.all,
        },
        forecast: forecast.list.map((f: any) => ({
          time: new Date(f.dt * 1000).toISOString(),
          temp: Math.round(f.main.temp),
          rainfall: f.rain?.['3h'] || 0,
          windSpeed: Math.round(f.wind.speed * 3.6),
          description: f.weather[0].description,
        })),
      }
    }, { staleOnError: true, provider: 'openmeteo+owm' })

    if (meta.stale) res.set('X-Cache-Stale', 'true')
    res.json(result)
  } catch (err: any) {
    logger.error({ err }, '[Weather] API error')
    res.status(502).json({ error: 'Failed to fetch live weather data.' })
  }
})

 /*
 * GET /api/weather/current
 * Returns current weather for the default region centre (falls through to
 * Open-Meteo free API — no key required).  Clients that don't have a user
 * location yet (ClimateRiskDashboard, PublicSafetyMode) call this route.
 * Active region centre used as the default; override with ?lat=X&lng=Y.
  */
router.get('/weather/current', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const lat = String(req.query.lat || defaultLat)
  const lng = String(req.query.lng || defaultLng)
  const key = buildCacheKey('weather', [activeRegion.id, 'current'], { lat, lng })
  try {
    const { data: result, meta } = await remember(key, CACHE_TTL.WEATHER, async () => {
      const openMeteoRes = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,rain,weather_code,cloud_cover,pressure_msl,wind_speed_10m,visibility&hourly=temperature_2m,rain,wind_speed_10m,weather_code&forecast_days=2&timezone=UTC`,
        { signal: AbortSignal.timeout(10_000) }
      )
      if (!openMeteoRes.ok) throw new Error(`Open-Meteo HTTP ${openMeteoRes.status}`)
      const data = await openMeteoRes.json()
      const current = data.current || {}
      const hourly = data.hourly || {}
      return {
        temperature: current.temperature_2m ?? null,
        feelsLike: current.apparent_temperature ?? null,
        humidity: current.relative_humidity_2m ?? null,
        precipitation: current.precipitation ?? 0,
        rain: current.rain ?? 0,
        windSpeed: current.wind_speed_10m ?? null,
        cloudCover: current.cloud_cover ?? null,
        pressure: current.pressure_msl ?? null,
        visibility: current.visibility ?? null,
        description: typeof current.weather_code === 'number' ? `WMO ${current.weather_code}` : 'Unknown',
        forecast: (hourly.time || []).slice(0, 8).map((t: string, idx: number) => ({
          time: t,
          temperature: hourly.temperature_2m?.[idx] ?? null,
          rain: hourly.rain?.[idx] ?? 0,
          windSpeed: hourly.wind_speed_10m?.[idx] ?? null,
          description: typeof hourly.weather_code?.[idx] === 'number' ? `WMO ${hourly.weather_code[idx]}` : 'Unknown',
        })),
      }
    }, { staleOnError: true, provider: 'openmeteo' })

    if (meta.stale) res.set('X-Cache-Stale', 'true')
    res.json(result)
  } catch (err: any) {
    logger.warn({ err }, '[Weather/current] Open-Meteo failed')
    res.status(503).json({ error: 'Weather data temporarily unavailable.' })
  }
})

 /*
 * FLOOD ZONE SPATIAL CHECK
  */

 /*
 * GET /api/flood-check?lat=X&lng=Y
 * Checks if a coordinate point falls inside any SEPA flood zone polygon.
 * Uses PostGIS ST_Contains for spatial containment query.
 * Returns list of matching zones with their risk levels.
 * This is the plug-and-play endpoint for QGIS-imported flood data.
  */
router.get('/flood-check', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { lat, lng } = req.query
    if (!lat || !lng) {
      throw AppError.badRequest('lat and lng are required.')
    }
    const parsedLat = parseFloat(lat as string)
    const parsedLng = parseFloat(lng as string)
    const key = buildCacheKey('flood', [activeRegion.id, 'zone-check'], { lat: parsedLat, lng: parsedLng })

    const { data: result, meta } = await remember(key, CACHE_TTL.FLOOD_ZONES, async () => {
      const dbResult = await pool.query(
        `SELECT zone_name, flood_type, probability, return_period
         FROM flood_zones
         WHERE ST_Contains(geometry, ST_SetSRID(ST_MakePoint($2, $1), 4326))
         ORDER BY CASE probability WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`,
        [parsedLat, parsedLng]
      )
      const zones = dbResult.rows
      const highestRisk = zones.length > 0 ? zones[0].probability : null
      return {
        inZone: zones.length > 0,
        zones: zones.map(z => ({
          name: z.zone_name, type: z.flood_type,
          probability: z.probability, returnPeriod: z.return_period,
        })),
        highestRisk,
        confidenceBoost: highestRisk === 'high' ? 25 : highestRisk === 'medium' ? 15 : highestRisk === 'low' ? 8 : 0,
      }
    })

    if (meta.stale) res.set('X-Cache-Stale', 'true')
    res.json(result)
  } catch (err) {
    next(err)
  }
})

 /*
 * REGION-AWARE FLOOD DATA ROUTES (SEPA/EA/NRW/NIEA)
  */

router.get('/flood-data/enabled-regions', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    res.json({ regions: floodDataClient.getEnabledRegions() })
  } catch (err) {
    next(err)
  }
})

router.get('/flood-data/areas', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const region = typeof req.query.region === 'string' ? req.query.region : undefined
    const key = buildCacheKey('flood', [region || activeRegion.id, 'areas'])
    const { data: areas, meta } = await remember(key, CACHE_TTL.FLOOD_DATA, async () => {
      return floodDataClient.getFloodAreas(region)
    }, { staleOnError: true, provider: 'ea-sepa' })
    if (meta.stale) res.set('X-Cache-Stale', 'true')
    res.json(areas)
  } catch (err: any) {
    logger.error({ err }, '[FloodData] areas error')
    res.status(502).json({
      type: 'FeatureCollection',
      features: [],
      sepa_status: 'unavailable',
    })
  }
})

router.get('/flood-data/stations', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const region = typeof req.query.region === 'string' ? req.query.region : undefined
    const lat = typeof req.query.lat === 'string' ? parseFloat(req.query.lat) : undefined
    const lng = typeof req.query.lng === 'string' ? parseFloat(req.query.lng) : undefined
    const dist = typeof req.query.dist === 'string' ? parseInt(req.query.dist, 10) : 50
    const key = buildCacheKey('flood', [region || activeRegion.id, 'stations'], { lat, lng, dist })
    const { data: stations, meta } = await remember(key, CACHE_TTL.FLOOD_DATA, async () => {
      return floodDataClient.getStations(region, lat, lng, dist)
    }, { staleOnError: true, provider: 'ea-sepa' })
    if (meta.stale) res.set('X-Cache-Stale', 'true')
    res.json(stations)
  } catch (err: any) {
    logger.error({ err }, '[FloodData] stations error')
    res.status(502).json({ type: 'FeatureCollection', features: [], sepa_status: 'unavailable' })
  }
})

router.get('/flood-data/stations/:stationId/readings', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const stationId = req.params.stationId
    const region = typeof req.query.region === 'string' ? req.query.region : undefined
    const hoursRaw = typeof req.query.hours === 'string' ? parseInt(req.query.hours, 10) : 24
    const hours = Number.isFinite(hoursRaw) ? Math.max(1, Math.min(168, hoursRaw)) : 24
    const key = buildCacheKey('flood', [region || activeRegion.id, 'station-readings', stationId], { hours })

    const { data: readings, meta } = await remember(key, CACHE_TTL.RIVER_LEVELS, async () => {
      return floodDataClient.getStationReadings(stationId, region, hours)
    }, { staleOnError: true, provider: 'ea-sepa' })
    if (meta.stale) res.set('X-Cache-Stale', 'true')
    res.json(readings)
  } catch (err: any) {
    logger.error({ err }, '[FloodData] station readings error')
    res.status(502).json({ error: 'Failed to fetch station readings.' })
  }
})

router.get('/flood-data/active-alerts', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const region = typeof req.query.region === 'string' ? req.query.region : undefined
    const key = buildCacheKey('flood', [region || activeRegion.id, 'active-alerts'])
    const { data: alerts, meta } = await remember(key, CACHE_TTL.FLOOD_WARNINGS, async () => {
      return floodDataClient.getActiveAlerts(region)
    }, { staleOnError: true, provider: 'ea-sepa' })
    if (meta.stale) res.set('X-Cache-Stale', 'true')
    res.json(alerts)
  } catch (err: any) {
    logger.error({ err }, '[FloodData] active alerts error')
    res.status(502).json({ type: 'FeatureCollection', features: [], sepa_status: 'unavailable' })
  }
})

router.get('/flood-data/risk-overlay', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const requestedRegion = typeof req.query.region === 'string' ? req.query.region : 'scotland'

  try {
    const region = typeof req.query.region === 'string' ? req.query.region : undefined
    const key = buildCacheKey('flood', [region || activeRegion.id, 'risk-overlay'])
    const { data: overlay, meta } = await remember(key, CACHE_TTL.FLOOD_DATA, async () => {
      return floodDataClient.getRiskOverlay(region)
    }, { staleOnError: true, provider: 'ea-sepa' })
    if (meta.stale) res.set('X-Cache-Stale', 'true')
    res.json(overlay)
  } catch (err: any) {
    logger.error({ err }, '[FloodData] risk-overlay error')
    res.status(502).json({
      region: requestedRegion,
      sepa_status: 'unavailable',
      cached_at: null,
      areas: { type: 'FeatureCollection', features: [] },
      stations: { type: 'FeatureCollection', features: [] },
      alerts: { type: 'FeatureCollection', features: [] },
    })
  }
})

router.get('/news', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const aegisRegion = (process.env.AEGIS_REGION || '').toLowerCase()
    const key = buildCacheKey('news', [aegisRegion || 'global', 'rss-feeds'])
    const forceRefresh = _req.query.fresh === 'true'

    if (forceRefresh) {
      try { await cacheDel(key) } catch { /* ok */ }
    }

    const { data: result, meta } = await remember(key, CACHE_TTL.NEWS, async () => {
    const isScotland = aegisRegion === 'scotland' || aegisRegion === 'aberdeen' || aegisRegion === 'edinburgh' || aegisRegion === 'glasgow'
    const isUK = isScotland || aegisRegion === 'england' || aegisRegion === 'wales' || aegisRegion === 'uk' || aegisRegion === 'northern-ireland'

    // Global feeds — always included (verified reliable, CORS-free server-fetch)
    const feeds: { source: string; url: string }[] = [
      { source: 'GDACS',                           url: 'https://www.gdacs.org/xml/rss.xml' },
      { source: 'ReliefWeb',                       url: 'https://reliefweb.int/headlines/rss.xml' },
      { source: 'The Guardian Natural Disasters',  url: 'https://www.theguardian.com/world/natural-disasters/rss' },
      { source: 'The Guardian Environment',        url: 'https://www.theguardian.com/environment/rss' },
      { source: 'The Guardian World',              url: 'https://www.theguardian.com/world/rss' },
      { source: 'The Guardian Global Development', url: 'https://www.theguardian.com/global-development/rss' },
      { source: 'The Guardian Science',            url: 'https://www.theguardian.com/science/rss' },
      { source: 'BBC World News',                  url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
      { source: 'USGS Earthquakes',                url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_month.atom' },
      { source: 'UN Humanitarian',                 url: 'https://news.un.org/feed/subscribe/en/news/topic/humanitarian-aid/feed/rss.xml' },
    ]

    // Regional feeds — appended when deployment region matches
    if (isUK) {
      feeds.push(
        { source: 'BBC UK',            url: 'https://feeds.bbci.co.uk/news/uk/rss.xml' },
        { source: 'Met Office',        url: 'https://www.metoffice.gov.uk/binaries/content/gallery/metofficegovuk/rss/news.xml' },
        { source: 'UK Government',     url: 'https://www.gov.uk/search/news-and-communications.atom' },
        { source: 'UK Environment Agency', url: 'https://environmentagency.blog.gov.uk/feed/' },
      )
    }
    if (isScotland) {
      feeds.push(
        { source: 'BBC Scotland',        url: 'https://feeds.bbci.co.uk/news/scotland/rss.xml' },
        { source: 'SEPA',                url: 'https://www.sepa.org.uk/media/rss/news/' },
        { source: 'Scottish Government', url: 'https://www.gov.scot/feed/' },
        { source: 'The Guardian Scotland', url: 'https://www.theguardian.com/uk/scotland/rss' },
      )
    }

    // Allow deployers to inject extra regional feeds via env var (comma-separated JSON-encoded array)
    const extraFeeds = process.env.AEGIS_NEWS_FEEDS
    if (extraFeeds) {
      try {
        const parsed = JSON.parse(extraFeeds) as { source: string; url: string }[]
        if (Array.isArray(parsed)) feeds.push(...parsed)
      } catch { /* ignore malformed config */ }
    }

    // Disaster relevance keywords for scoring
    const DISASTER_KEYWORDS = [
      'flood', 'flooding', 'tsunami', 'earthquake', 'hurricane', 'tornado',
      'wildfire', 'bushfire', 'storm', 'severe', 'warning', 'alert', 'emergency',
      'evacuation', 'evacuate', 'drought', 'heatwave', 'heat wave', 'landslide',
      'avalanche', 'blizzard', 'cyclone', 'disaster', 'sepa', 'river level',
      'climate', 'extreme weather', 'rainfall', 'power outage', 'disruption',
      'amber warning', 'red warning', 'met office warning', 'environment agency',
      'rescue', 'recovery', 'relief', 'aid', 'calamity', 'hazard', 'risk',
    ]

    const disasterScore = (title: string, source: string): number => {
      const text = `${title} ${source}`.toLowerCase()
      return DISASTER_KEYWORDS.reduce((score, kw) => score + (text.includes(kw) ? 1 : 0), 0)
    }

    const allItems: Array<{ title: string; source: string; time: string; url: string; type: 'alert' | 'warning' | 'community' | 'info' | 'tech' | 'disaster'; publishedAt: string; disasterScore: number }> = []

    // Fetch all feeds in parallel — max response time = single feed timeout (6s), not N × 6s
    await Promise.allSettled(feeds.map(async (feed) => {
      try {
        const response = await fetch(feed.url, { headers: { 'User-Agent': 'AEGIS/6.0' }, signal: AbortSignal.timeout(6000) })
        if (!response.ok) return
        const xml = await response.text()
        const items = parseRssItems(xml, feed.source)
        // allItems is shared; push is synchronous so race is safe here
        allItems.push(...items.map(item => ({ ...item, disasterScore: disasterScore(item.title, item.source) })))
      } catch {
        // Timeout or network error — skip this feed silently
      }
    }))

    // Deduplicate by URL before sorting
    const seenUrls = new Set<string>()
    const unique = allItems.filter(item => {
      if (!item.url || item.url === '#' || seenUrls.has(item.url)) return false
      seenUrls.add(item.url)
      return true
    })

    const sorted = unique
      .sort((a, b) => {
        // Disaster-relevant items first, then by date
        const scoreDiff = b.disasterScore - a.disasterScore
        if (scoreDiff !== 0) return scoreDiff
        return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
      })
      .map(({ publishedAt, disasterScore: _ds, ...rest }) => rest)

    return {
      items: sorted,
      fetched_at: new Date().toISOString(),
      total: sorted.length,
    }
    }, { staleOnError: true, provider: 'rss-feeds' })

    if (meta.stale) res.set('X-Cache-Stale', 'true')

    // Pagination: allow clients to page through the full item list
    const page = Math.max(1, parseInt(_req.query.page as string) || 1)
    const pageSize = Math.min(100, Math.max(5, parseInt(_req.query.pageSize as string) || 30))
    const allItems = result.items || []
    const totalItems = allItems.length
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
    const offset = (page - 1) * pageSize
    const pagedItems = allItems.slice(offset, offset + pageSize)

    res.json({
      items: pagedItems,
      fetched_at: result.fetched_at,
      total: totalItems,
      page,
      pageSize,
      totalPages,
    })
  } catch (err) {
    next(err)
  }
})

function sanitizeChannels(channels: unknown): string[] {
  const allowed = new Set(['web', 'email', 'sms', 'telegram', 'whatsapp'])
  if (!Array.isArray(channels)) return ['web']
  const normalized = channels
    .map(ch => String(ch).toLowerCase().trim())
    .map(ch => ch === 'webpush' ? 'web' : ch)
    .filter(ch => allowed.has(ch))
  return normalized.length > 0 ? Array.from(new Set(normalized)) : ['web']
}

async function getSubscribersForChannels(channels: string[], severity: string): Promise<any[]> {
  try {
    const queryChannels = Array.from(new Set(channels))

    const query = `
      SELECT id, email, phone, telegram_id, whatsapp, channels, severity_filter, verified
      FROM alert_subscriptions
      WHERE verified = true
        AND ($1 = ANY(severity_filter) OR cardinality(severity_filter) = 0)
        AND channels && $2::text[]
    `
    const result = await pool.query(query, [severity, queryChannels])
    return result.rows
  } catch (err: any) {
    logger.warn({ err }, '[Alerts] alert_subscriptions query failed (table may not exist)')
    return []
  }
}

async function dispatchAlertDeliveries(
  alertId: string,
  title: string,
  message: string,
  channels: string[],
  subscribers: any[]
): Promise<Array<{ channel: string; recipient: string; status: string; error?: string }>> {
  const results: Array<{ channel: string; recipient: string; status: string; error?: string }> = []

  const severityLevel: 'critical' | 'warning' | 'info' =
    severityFromText(title, message)

  const alertPayload: notificationService.Alert = {
    id: alertId,
    type: 'general',
    severity: severityLevel,
    title,
    message,
    area: 'AEGIS Coverage Area',
  }

  let webPushSubs: { rows: any[] } = { rows: [] }
  if (channels.includes('web')) {
    try {
      // subscription_data is JSONB containing the full PushSubscription object
      // with nested keys: { endpoint, keys: { p256dh, auth } }
      webPushSubs = await pool.query(
        `SELECT endpoint, p256dh, auth
         FROM push_subscriptions
         WHERE active = true
           AND endpoint IS NOT NULL
           AND p256dh IS NOT NULL
           AND auth IS NOT NULL`
      )
    } catch (e: any) {
      logger.warn({ err: e }, '[Alerts] push_subscriptions query failed (table may not exist)')
    }
  }

  for (const subscriber of subscribers) {
    for (const channel of channels) {
      if (channel === 'web') {
        continue
      }
      const recipient = getRecipientForChannel(subscriber, channel)
      if (!recipient) continue

      let status = 'failed'
      let error: string | undefined
      let providerId: string | null = null

      try {
        if (channel === 'email') {
          const delivery = await notificationService.sendEmailAlert(recipient, alertPayload)
          status = delivery.success ? 'sent' : 'failed'
          providerId = delivery.messageId || null
          if (!delivery.success) error = delivery.error || 'email_delivery_failed'
        } else if (channel === 'sms') {
          const delivery = await notificationService.sendSMSAlert(recipient, alertPayload)
          status = delivery.success ? 'sent' : 'failed'
          providerId = delivery.messageId || null
          if (!delivery.success) error = delivery.error || 'sms_delivery_failed'
        } else if (channel === 'telegram') {
          const delivery = await notificationService.sendTelegramAlert(recipient, alertPayload)
          status = delivery.success ? 'sent' : 'failed'
          providerId = delivery.messageId || null
          if (!delivery.success) error = delivery.error || 'telegram_delivery_failed'
        } else if (channel === 'whatsapp') {
          const delivery = await notificationService.sendWhatsAppAlert(recipient, alertPayload)
          status = delivery.success ? 'sent' : 'failed'
          providerId = delivery.messageId || null
          if (!delivery.success) error = delivery.error || 'whatsapp_delivery_failed'
        }

        const sentAt = (status === 'sent' || status === 'delivered') ? new Date() : null
        const deliveredAt = status === 'delivered' ? new Date() : null

        await pool.query(
          `INSERT INTO alert_delivery_log (alert_id, channel, recipient, provider_id, status, error_message, sent_at, delivered_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [alertId, channel, recipient || 'web-subscriber', providerId, status, error || null, sentAt, deliveredAt]
        )
      } catch (err: any) {
        status = 'failed'
        error = err?.message || 'delivery_error'
        await pool.query(
          `INSERT INTO alert_delivery_log (alert_id, channel, recipient, status, error_message)
           VALUES ($1, $2, $3, 'failed', $4)`,
          [alertId, channel, recipient || 'web-subscriber', error]
        )
      }

      results.push({ channel, recipient: recipient || 'web-subscriber', status, error })
      alertDeliveryTotal.inc({ channel, status })
    }
  }

  // Process web push subscriptions
  for (const sub of webPushSubs.rows) {
    let status = 'failed'
    let error: string | undefined
    try {
      const delivery = await notificationService.sendWebPushAlert(
        {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth,
          },
        } as any,
        alertPayload
      )
      status = delivery.success ? 'sent' : 'failed'
      error = delivery.success ? undefined : (delivery.error || 'web_push_failed')

      const sentAt = (status === 'sent' || status === 'delivered') ? new Date() : null
      const deliveredAt = status === 'delivered' ? new Date() : null

      await pool.query(
        `INSERT INTO alert_delivery_log (alert_id, channel, recipient, provider_id, status, error_message, sent_at, delivered_at)
         VALUES ($1, 'web', $2, $3, $4, $5, $6, $7)`,
        [alertId, sub.endpoint, delivery.messageId || null, status, error || null, sentAt, deliveredAt]
      )
    } catch (err: any) {
      error = err?.message || 'web_push_error'
      await pool.query(
        `INSERT INTO alert_delivery_log (alert_id, channel, recipient, status, error_message)
         VALUES ($1, 'web', $2, 'failed', $3)`,
        [alertId, sub.endpoint, error]
      )
    }
    results.push({ channel: 'web', recipient: sub.endpoint, status, error })
    alertDeliveryTotal.inc({ channel: 'web', status })
  }

  return results
}

function getRecipientForChannel(subscriber: any, channel: string): string {
  if (channel === 'email') return subscriber.email
  if (channel === 'sms') return subscriber.phone
  if (channel === 'telegram') return subscriber.telegram_id
  if (channel === 'whatsapp') return subscriber.whatsapp
  return `sub:${subscriber.id}`
}

function severityFromText(title: string, message: string): 'critical' | 'warning' | 'info' {
  const text = `${title} ${message}`.toLowerCase()
  if (text.includes('critical') || text.includes('urgent') || text.includes('evacuate') || text.includes('danger')) {
    return 'critical'
  }
  if (text.includes('warning') || text.includes('watch') || text.includes('risk') || text.includes('flood')) {
    return 'warning'
  }
  return 'info'
}

function parseRssItems(xml: string, source: string): Array<{ title: string; source: string; time: string; url: string; type: 'alert' | 'warning' | 'community' | 'info' | 'tech' | 'disaster'; publishedAt: string }> {
  // Support both RSS <item> and Atom <entry> elements
  const isAtom = xml.includes('<feed') && xml.includes('<entry')
  const tagName = isAtom ? 'entry' : 'item'
  const itemRegex = new RegExp(`<${tagName}[\\s\\S]*?<\\/${tagName}>`, 'gi')
  const chunks = xml.match(itemRegex) || []
  return chunks.slice(0, 20).map(chunk => {
    const title = decodeXml(readTag(chunk, 'title') || `${source} update`)
    const linkTag = readTag(chunk, 'link')
    const linkHref = chunk.match(/<link[^>]+href="([^"]+)"/i)?.[1] || ''
    const link = decodeXml(linkTag || linkHref || '#')
    const pubDateRaw = decodeXml(
      readTag(chunk, 'pubDate') ||
      readTag(chunk, 'updated') ||
      readTag(chunk, 'published') ||
      readTag(chunk, 'dc:date') ||
      new Date().toUTCString()
    )
    const pubDate = new Date(pubDateRaw)
    const now = Date.now()
    const minutes = Math.max(0, Math.floor((now - pubDate.getTime()) / 60000))
    const time = minutes < 60 ? `${minutes} min ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ago` : `${Math.floor(minutes / 1440)}d ago`
    const text = title.toLowerCase()
    // Disaster sources always get 'disaster' type regardless of title
    const isDisasterSource = ['gdacs', 'usgs', 'copernicus', 'reliefweb', 'fema'].some(s => source.toLowerCase().includes(s))
    const type: 'alert' | 'warning' | 'community' | 'info' | 'tech' | 'disaster' =
      isDisasterSource || text.includes('earthquake') || text.includes('tsunami') || text.includes('volcano') ||
        text.includes('eruption') || text.includes('landslide') || text.includes('avalanche') ||
        text.includes('cyclone') || text.includes('disaster') || text.includes('calamity') ||
        text.includes('wildfire') || text.includes('bushfire') || text.includes('hurricane') ||
        text.includes('typhoon') || text.includes('magnitude') ? 'disaster' :
      text.includes('alert') || text.includes('severe') || text.includes('emergency') ? 'alert' :
      text.includes('warning') || text.includes('flood') || text.includes('storm') ? 'warning' :
      text.includes('community') || text.includes('volunteer') || text.includes('help') ? 'community' :
      text.includes('ai') || text.includes('technology') || text.includes('digital') ? 'tech' :
      'info'

    return {
      title,
      source,
      time,
      url: link,
      type,
      publishedAt: Number.isFinite(pubDate.getTime()) ? pubDate.toISOString() : new Date().toISOString(),
    }
  })
}

function readTag(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return match ? match[1].trim() : null
}

function decodeXml(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

 /*
 * WEB PUSH NOTIFICATION ENDPOINTS
  */

 /*
 * GET /api/notifications/status
 * Returns notification service configuration status and VAPID public key
  */
router.get('/notifications/status', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || ''
    res.json({
      email: {
        enabled: !!process.env.SENDGRID_API_KEY || !!process.env.SMTP_HOST,
        configured: !!process.env.SENDGRID_API_KEY || (!!process.env.SMTP_HOST && !!process.env.SMTP_USER),
      },
      sms: {
        enabled: !!process.env.TWILIO_ACCOUNT_SID,
        configured: !!process.env.TWILIO_ACCOUNT_SID && !!process.env.TWILIO_AUTH_TOKEN,
      },
      telegram: {
        enabled: !!process.env.TELEGRAM_BOT_TOKEN,
        configured: !!process.env.TELEGRAM_BOT_TOKEN,
      },
      whatsapp: {
        enabled: !!process.env.TWILIO_ACCOUNT_SID,
        configured: !!process.env.TWILIO_ACCOUNT_SID && !!process.env.TWILIO_AUTH_TOKEN,
      },
      web: {
        enabled: !!vapidPublicKey,
        configured: !!vapidPublicKey,
        publicKey: vapidPublicKey || undefined,
      },
    })
  } catch (err) {
    next(err)
  }
})

 /*
 * POST /api/notifications/subscribe
 * Save browser push subscription for authenticated user or guest
 * Stores endpoint, p256dh, and auth in push_subscriptions table
  */
router.post('/notifications/subscribe', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { subscription } = req.body

    // Derive user_id from auth token if present (never trust body)
    let userId: number | null = null
    const authHeader = req.headers.authorization
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const decoded = verifyToken<any>(authHeader.slice(7))
        userId = decoded.userId || decoded.id || null
      } catch { /* anonymous subscription */ }
    }

    if (!subscription || !subscription.endpoint) {
      throw AppError.badRequest('Missing subscription endpoint.')
    }

    // Validate p256dh and auth are present (required by Web Push Protocol)
    if (!subscription.keys?.p256dh || !subscription.keys?.auth) {
      throw AppError.badRequest('Missing subscription keys (p256dh and auth are required).')
    }

    // Try to insert into existing table (with flexible schema handling)
    try {
      await pool.query(
        `INSERT INTO push_subscriptions (endpoint, p256dh, auth, subscription_data)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, subscription_data = EXCLUDED.subscription_data`,
        [subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, JSON.stringify(subscription)]
      )
    } catch (err: any) {
      if (err.message?.includes('does not exist')) {
        // Table doesn't exist, create it with minimal schema
        devLog('[Subscriptions] Creating push_subscriptions table with minimal schema...')
        await pool.query(`
          CREATE TABLE IF NOT EXISTS push_subscriptions (
            id SERIAL PRIMARY KEY,
            endpoint TEXT UNIQUE NOT NULL,
            p256dh TEXT,
            auth TEXT,
            subscription_data JSONB,
            is_active BOOLEAN NOT NULL DEFAULT true,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `)
        // Retry the insert
        await pool.query(
          `INSERT INTO push_subscriptions (endpoint, p256dh, auth, subscription_data)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, subscription_data = EXCLUDED.subscription_data`,
          [subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, JSON.stringify(subscription)]
        )
      } else {
        throw err
      }
    }

    if (process.env.NODE_ENV !== 'production') {
      devLog(`[Push] Subscription saved: ${subscription.endpoint.substring(0, 50)}...`)
    }
    res.status(201).json({
      success: true,
      message: 'Subscription saved successfully',
    })
  } catch (err) {
    next(err)
  }
})

 /*
 * POST /api/notifications/unsubscribe
 * Remove browser push subscription
  */
router.post('/notifications/unsubscribe', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { endpoint } = req.body

    if (!endpoint) {
      throw AppError.badRequest('Missing endpoint.')
    }

    await pool.query(
      `DELETE FROM push_subscriptions WHERE endpoint = $1`,
      [endpoint]
    )

    res.json({
      success: true,
      message: 'Subscription removed successfully',
    })
  } catch (err) {
    next(err)
  }
})

export default router
