/**
 * Same-origin proxy for map tile providers (OSM, Carto, ESRI, OpenTopo).
 * The frontend fetches tiles from our server instead of directly from
 * third-party CDNs, avoiding ad-blocker interference and mixed-content
 * issues.
 *
 * - Mounted at /api/map-tiles in index.ts
 * - Called by the Leaflet map components in the frontend
 * - No authentication (tiles are public, high-traffic)
 * - Rate limiting is skipped for this route (handled by tile providers)
 * */
import { Router, type Request, type Response, NextFunction } from 'express'
import { AppError } from '../utils/AppError.js'

const router = Router()

type ProviderKey = 'osm' | 'carto' | 'esri' | 'topo'

const PROVIDER_URLS: Record<ProviderKey, (z: string, x: string, y: string) => string> = {
  osm: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
  carto: (z, x, y) => `https://a.basemaps.cartocdn.com/rastertiles/voyager/${z}/${x}/${y}.png`,
  esri: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
  topo: (z, x, y) => `https://a.tile.opentopomap.org/${z}/${x}/${y}.png`,
}

function isValidNumberSegment(value: string): boolean {
  return /^\d+$/.test(value)
}

router.get('/:provider/:z/:x/:y', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const provider = String(req.params.provider || '').toLowerCase() as ProviderKey
    const z = String(req.params.z || '')
    const x = String(req.params.x || '')
    const yRaw = String(req.params.y || '')
    const y = yRaw.replace(/\.(png|jpg|jpeg|webp)$/i, '')

    if (!PROVIDER_URLS[provider]) {
      throw AppError.badRequest('Unknown map tile provider')
    }

    if (![z, x, y].every(isValidNumberSegment)) {
      throw AppError.badRequest('Invalid tile coordinates')
    }

    const tileUrl = PROVIDER_URLS[provider](z, x, y)
    const upstream = await fetch(tileUrl, {
      headers: {
        'User-Agent': 'AEGIS-MapProxy/1.0',
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(8000),
    })

    if (!upstream.ok) {
      res.status(upstream.status).json({ error: `Tile upstream returned ${upstream.status}` })
      return
    }

    const contentType = upstream.headers.get('content-type') || 'image/png'
    const cacheControl = upstream.headers.get('cache-control') || 'public, max-age=600'
    const bytes = Buffer.from(await upstream.arrayBuffer())

    res.setHeader('Content-Type', contentType)
    res.setHeader('Cache-Control', cacheControl)
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.status(200).send(bytes)
  } catch {
    res.status(502).json({ error: 'Unable to load map tile via proxy' })
  }
})

export default router
