# AEGIS Spatial Intelligence — Guide

This document explains the two spatial-intelligence subsystems added in the
ML v2 upgrade: **satellite flood mapping** (Sentinel-1 SAR) and **spatial
analytics** (isochrones, population exposure, emergency facilities).

---

## Architecture overview

```
Incident created / updated
         │
         ├──► satellite_flood_extent.py  (SAR mapping)
         │         ↓
         │    uploads/flood_extents/<incident_id>.geojson
         │         ↓
         │    flood_extents table  (PostGIS)
         │
         └──► spatial_analytics.py  (isochrones + population)
                   ├── Overpass API → nearest hospitals / fire / police
                   ├── WorldPop raster → population exposed
                   └── ORS / circle fallback → drive-time isochrones
                              ↓
                         isochrone_cache table  (PostGIS)
                         population_exposure_cache table
```

---

## 1. Satellite flood mapping

**Module:** `app/services/satellite_flood_extent.py`

### How it works

1. Downloads the two most recent Sentinel-1 GRD scenes that intersect the
   incident bounding box from Copernicus Open Access Hub.
2. Reads SAR backscatter (VV or VH polarisation) from both scenes.
3. Computes backscatter change: `Δσ₀ = σ₀_before – σ₀_after (dB)`
4. Threshold: pixels where `Δσ₀ > 3 dB` are classified as flooded
   (water attenuates backscatter strongly relative to dry land).
5. Applies morphological opening (kernel=3, iterations=2) to remove noise.
6. Vectorises the binary raster to GeoJSON polygons via `rasterio.features.shapes`.
7. Estimates population in the flooded polygon via WorldPop raster.

### Offline / CI mode

When `SENTINEL_USER` / `SENTINEL_PASS` are not set, the service generates a
**synthetic circular flood polygon** around the incident coordinates.  This
allows AEGIS to run fully offline and integration tests to pass without
Copernicus credentials.

### Configuration

| Environment variable | Default | Effect |
|---|---|---|
| `SENTINEL_USER` | — | Copernicus Hub username |
| `SENTINEL_PASS` | — | Copernicus Hub password |
| `WORLDPOP_PATH` | `data/worldpop/gbr_ppp_2020_100m_Aggregated.tif` | Population raster |
| `SAR_THRESHOLD_DB` | `3.0` | Backscatter change threshold (dB) |

### Running standalone

```python
import asyncio
from app.services.satellite_flood_extent import satellite_flood_service

result = asyncio.run(satellite_flood_service.map_extent(
    bbox      = (-1.15, 53.95, -1.05, 54.05),   # York area
    event_date= "2015-12-27",
    incident_id="test-001"
))
print(result["area_km2"], result["population_estimate"])
```

### Output schema

```json
{
  "incident_id":         "abc123",
  "geojson":             { "type": "FeatureCollection", "features": [ … ] },
  "area_km2":            18.4,
  "population_estimate": 12500,
  "method":              "sar_sentinel1",
  "source_scene":        "S1A_IW_GRDH_…",
  "event_date":          "2015-12-27"
}
```

### Validation

Run the benchmark script to compare synthetic extents against 8 historic
UK flood events with published flood area and population figures:

```bash
python scripts/evaluation/spatial_benchmark.py
# → reports/spatial_benchmark.csv
# → reports/spatial_benchmark_summary.md
```

Expected IoU > 0.35 on historic events (synthetic method is approximate;
real SAR achieves 0.70–0.85 IoU against EA gauge surveys).

---

## 2. Spatial analytics

**Module:** `app/services/spatial_analytics.py`

Three sub-functions called by `SpatialAnalyticsService.analyse()`:

### 2a. Nearest facilities

Uses the **OpenStreetMap Overpass API** (`https://overpass-api.de/api/interpreter`)
to find hospitals, fire stations, police stations, and coastguard stations
within a 50 km radius of the incident.

Output: list of `{ name, facility_type, lat, lon, distance_km }` sorted by distance.

### 2b. Population exposure

Counts the WorldPop 100m pixel population sum within the incident's isochrone
polygon (or bounding box if no polygon is available).

Requires the WorldPop GeoTIFF at `WORLDPOP_PATH` (see `data/README.md`).

### 2c. Isochrones

Drive-time polygons around the incident location at 5, 10, 20, and 30 minutes.

**Primary:** OpenRouteService API (`https://api.openrouteservice.org/v2/isochrones/`)
— requires `ORS_API_KEY` environment variable.

**Fallback:** Circular approximation using `shapely.Point.buffer()` scaled by
30 km/h road speed (no API key required, always available).

Results are cached in the `isochrone_cache` PostgreSQL table for 24 hours.

### Running standalone

```python
import asyncio
from app.services.spatial_analytics import spatial_analytics_service

result = asyncio.run(spatial_analytics_service.analyse(
    incident_id="test-001",
    lat=51.5074,
    lon=-0.1278,
    geojson=None   # optional flood extent polygon for population estimate
))
print(result["facilities"])
print(result["population_exposed"])
```

### Output schema

```json
{
  "incident_id":        "test-001",
  "facilities": [
    { "name": "Royal London Hospital", "facility_type": "hospital",
      "lat": 51.518, "lon": -0.059, "distance_km": 4.2 }
  ],
  "population_exposed":  250000,
  "isochrone_geojson":  { "type": "FeatureCollection", "features": [ … ] },
  "isochrone_provider": "ors",
  "cached":             false
}
```

### Configuration

| Variable | Default | Effect |
|---|---|---|
| `ORS_API_KEY` | — | Enables ORS isochrones; falls back to circle if absent |
| `WORLDPOP_PATH` | `data/worldpop/gbr_ppp_2020_100m_Aggregated.tif` | Population raster |
| `OVERPASS_URL` | `https://overpass-api.de/api/interpreter` | Overpass API endpoint |
| `ISOCHRONE_CACHE_TTL_HOURS` | `24` | Cache expiry for isochrone_cache table |

---

## 3. Database tables

Both services write to tables created by
[server/sql/migration_vision_spatial.sql](../../server/sql/migration_vision_spatial.sql).

Run the migration once before starting the AI engine:

```bash
psql $DATABASE_URL -f server/sql/migration_vision_spatial.sql
```

---

## 4. Hardware / performance

| Operation | Typical latency |
|---|---|
| Overpass facility query (online) | 200–800 ms |
| Overpass facility query (London, many results) | up to 3 s |
| ORS isochrone API | 100–500 ms |
| Circle isochrone fallback | <5 ms |
| WorldPop population raster read | 50–200 ms |
| SAR flood mapping (full Sentinel-1 scene) | 30–120 s |
| SAR synthetic fallback | <10 ms |

All I/O operations run in `asyncio.get_event_loop().run_in_executor()` to keep
the FastAPI event loop non-blocking.

---

## 5. Data dependencies

| Data | Where to get it | Where to place it |
|---|---|---|
| WorldPop UK 100m GeoTIFF | [worldpop.org](https://www.worldpop.org/geodata/summary?id=24777) | `data/worldpop/gbr_ppp_2020_100m_Aggregated.tif` |
| Sentinel-1 GRD products | ESA Copernicus (free account) | Downloaded automatically to `data/sentinel/` |
| pgRouting road network | osm2pgrouting from UK OSM extract | `road_network` table in PostgreSQL (optional) |

---

## 6. Extending the pipeline

### Add a new facility type

In `spatial_analytics.py`, update the `FACILITY_TYPES` dict:

```python
FACILITY_TYPES = {
    "hospital":    'amenity="hospital"',
    "fire":        'amenity="fire_station"',
    "police":      'amenity="police"',
    "coastguard":  'emergency="coast_guard"',
    "lifeboat":    'emergency="lifeboat_station"',   # ← new
}
```

### Use a higher-resolution population raster

Replace the WorldPop path in your `.env`:
```
WORLDPOP_PATH=/data/worldpop/gbr_ppp_2020_1km_Aggregated.tif
```

Any GeoTIFF with matching CRS (EPSG:4326) and a single population band works.

### Upgrade to real SAR processing

The current SAR implementation uses threshold-based change detection which
is fast but not model-based.  For higher accuracy:

1. Install `esa-snappy` (ESA SNAP Python API)
2. Replace `_blocking_map_extent()` in `satellite_flood_extent.py` with a
   SNAP graph processing call that applies:
   - Thermal noise removal
   - Radiometric calibration (σ₀)
   - Terrain correction (Range-Doppler)
   - Speckle filtering (Lee, 5×5 window)
3. The change detection and vectorisation steps remain the same.
