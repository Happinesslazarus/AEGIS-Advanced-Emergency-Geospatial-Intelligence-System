"""
Async HTTP client wrappers for all external data feeds: Open-Meteo for
weather (temperature, precipitation, wind, humidity), Open-Meteo flood API
for river discharge, and UK Environment Agency for gauge readings. Results
are cached in the FeatureStore to avoid re-fetching within the same
prediction cycle.

- Called by ai-engine/app/core/feature_store.py to populate live features
- Hazard predictors call FeatureStore which calls these providers internally
- Open-Meteo API: https://api.open-meteo.com (free, no key required)
- EA Flood API:   https://environment.data.gov.uk/flood-monitoring (free)

- ai-engine/app/core/feature_store.py  -- feature caching and engineering
- ai-engine/app/training/data_fetch_open_meteo.py -- historical data fetcher
"""

from __future__ import annotations

import asyncio
import math
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

import aiohttp
from loguru import logger

# Shared HTTP helper

async def _fetch_json(
    session: aiohttp.ClientSession,
    url: str,
    params: Optional[Dict[str, Any]] = None,
    timeout: int = 30,
) -> Optional[Any]:
    """GET JSON with retry (2 attempts, exponential backoff)."""
    for attempt in range(3):
        try:
            async with session.get(
                url,
                params=params,
                timeout=aiohttp.ClientTimeout(total=timeout),
            ) as resp:
                if resp.status == 200:
                    return await resp.json(content_type=None)
                logger.warning(f"[DataProvider] {url} ? HTTP {resp.status}")
        except (aiohttp.ClientError, asyncio.TimeoutError) as exc:
            logger.warning(f"[DataProvider] {url} attempt {attempt+1}: {exc}")
            if attempt < 2:
                await asyncio.sleep(2 ** attempt)
    return None

# 1.  SEPA River Gauges (Scotland)  -- FREE, no key required
#     https://timeseries.sepa.org.uk/KiWIS/KiWIS

SEPA_BASE = "https://timeseries.sepa.org.uk/KiWIS/KiWIS"

async def sepa_find_nearest_station(
    session: aiohttp.ClientSession,
    lat: float,
    lng: float,
    max_distance_km: float = 30.0,
) -> Optional[Dict[str, Any]]:
    """Find the nearest SEPA river gauge station to given coordinates."""
    data = await _fetch_json(session, SEPA_BASE, params={
        "service": "kisters",
        "type": "queryServices",
        "request": "getStationList",
        "datasource": 0,
        "format": "json",
        "returnfields": "station_no,station_name,station_latitude,station_longitude",
    })
    if not data or len(data) < 2:
        return None

    best, best_dist = None, max_distance_km
    for row in data[1:]:  # first row is header
        try:
            s_lat, s_lng = float(row[2]), float(row[3])
        except (ValueError, TypeError, IndexError):
            continue
        dist = _haversine(lat, lng, s_lat, s_lng)
        if dist < best_dist:
            best_dist = dist
            best = {
                "station_no": row[0],
                "station_name": row[1],
                "latitude": s_lat,
                "longitude": s_lng,
                "distance_km": round(dist, 2),
            }
    return best

async def sepa_get_latest_level(
    session: aiohttp.ClientSession,
    station_no: str,
) -> Optional[Dict[str, Any]]:
    """Get latest water level reading from a SEPA station."""
    # First get the time-series ID for water level
    ts_data = await _fetch_json(session, SEPA_BASE, params={
        "service": "kisters",
        "type": "queryServices",
        "request": "getTimeseriesList",
        "datasource": 0,
        "format": "json",
        "station_no": station_no,
        "parametertype_name": "Water Level",
        "ts_name": "15min.Cmd.O",
        "returnfields": "ts_id,station_name,parametertype_name,ts_unitname",
    })
    if not ts_data or len(ts_data) < 2:
        return None

    ts_id = ts_data[1][0]

    now = datetime.now(timezone.utc)
    start = (now - timedelta(hours=6)).strftime("%Y-%m-%dT%H:%M:%S")
    end = now.strftime("%Y-%m-%dT%H:%M:%S")

    readings = await _fetch_json(session, SEPA_BASE, params={
        "service": "kisters",
        "type": "queryServices",
        "request": "getTimeseriesValues",
        "datasource": 0,
        "format": "json",
        "ts_id": ts_id,
        "from": start,
        "to": end,
        "returnfields": "Timestamp,Value",
    })
    if not readings or not readings[0].get("data"):
        return None

    values = readings[0]["data"]
    if not values:
        return None

    latest = values[-1]
    return {
        "timestamp": latest[0],
        "level_m": float(latest[1]) if latest[1] is not None else None,
        "station_no": station_no,
        "ts_id": ts_id,
    }

async def sepa_get_river_data(
    session: aiohttp.ClientSession,
    lat: float,
    lng: float,
) -> Dict[str, Any]:
    """
    High-level: find nearest station + get latest reading.
    Returns feature-store-ready dict.
    """
    result: Dict[str, Any] = {"source": "sepa", "available": False}
    station = await sepa_find_nearest_station(session, lat, lng)
    if not station:
        return result

    reading = await sepa_get_latest_level(session, station["station_no"])
    if not reading or reading["level_m"] is None:
        result["station"] = station
        return result

    result.update({
        "available": True,
        "station": station,
        "river_level": reading["level_m"],
        "timestamp": reading["timestamp"],
    })
    return result

# 2.  UK Environment Agency -- Flood Monitoring API  -- FREE, no key
#     https://environment.data.gov.uk/flood-monitoring/doc/reference

EA_BASE = "https://environment.data.gov.uk/flood-monitoring"

async def ea_get_nearest_station(
    session: aiohttp.ClientSession,
    lat: float,
    lng: float,
    max_distance_km: float = 30.0,
) -> Optional[Dict[str, Any]]:
    """Find nearest EA flood monitoring station."""
    data = await _fetch_json(session, f"{EA_BASE}/id/stations", params={
        "lat": str(lat),
        "long": str(lng),
        "dist": str(min(max_distance_km, 50)),
        "_limit": "5",
    })
    if not data or not data.get("items"):
        return None

    items = data["items"]
    best, best_dist = None, max_distance_km
    for s in items:
        s_lat = s.get("lat")
        s_lng = s.get("long")
        if s_lat is None or s_lng is None:
            continue
        dist = _haversine(lat, lng, s_lat, s_lng)
        if dist < best_dist:
            best_dist = dist
            best = {
                "station_ref": s.get("stationReference"),
                "label": s.get("label"),
                "latitude": s_lat,
                "longitude": s_lng,
                "distance_km": round(dist, 2),
                "river_name": s.get("riverName", ""),
            }
    return best

async def ea_get_latest_reading(
    session: aiohttp.ClientSession,
    station_ref: str,
) -> Optional[Dict[str, Any]]:
    """Get latest water level reading from EA station."""
    data = await _fetch_json(
        session,
        f"{EA_BASE}/id/stations/{station_ref}/readings",
        params={"_sorted": "", "_limit": "1"},
    )
    if not data or not data.get("items"):
        return None
    item = data["items"][0]
    return {
        "timestamp": item.get("dateTime"),
        "level_m": item.get("value"),
        "station_ref": station_ref,
    }

async def ea_get_flood_warnings(
    session: aiohttp.ClientSession,
    lat: float,
    lng: float,
    radius_km: float = 50.0,
) -> List[Dict[str, Any]]:
    """Get active EA flood warnings near coordinates."""
    data = await _fetch_json(session, f"{EA_BASE}/id/floods", params={
        "lat": str(lat),
        "long": str(lng),
        "dist": str(min(radius_km, 100)),
    })
    if not data or not data.get("items"):
        return []
    warnings = []
    for item in data["items"][:10]:
        warnings.append({
            "severity": item.get("severityLevel"),
            "severity_label": item.get("severity"),
            "description": item.get("description"),
            "area": item.get("floodArea", {}).get("label", ""),
            "time_raised": item.get("timeRaised"),
        })
    return warnings

async def ea_get_river_data(
    session: aiohttp.ClientSession,
    lat: float,
    lng: float,
) -> Dict[str, Any]:
    """High-level: find nearest EA station + get latest reading."""
    result: Dict[str, Any] = {"source": "ea", "available": False}
    station = await ea_get_nearest_station(session, lat, lng)
    if not station:
        return result

    reading = await ea_get_latest_reading(session, station["station_ref"])
    if not reading or reading["level_m"] is None:
        result["station"] = station
        return result

    result.update({
        "available": True,
        "station": station,
        "river_level": float(reading["level_m"]),
        "timestamp": reading["timestamp"],
    })
    return result

# 3.  Open-Meteo Weather API  -- FREE, no key, unlimited
#     https://open-meteo.com/en/docs

OPENMETEO_CURRENT = "https://api.open-meteo.com/v1/forecast"
OPENMETEO_HISTORY = "https://archive-api.open-meteo.com/v1/archive"

async def openmeteo_get_current(
    session: aiohttp.ClientSession,
    lat: float,
    lng: float,
) -> Dict[str, Any]:
    """
    Get current weather + last 7 days rainfall from Open-Meteo.
    Returns feature-store-ready dict with: temperature, humidity, wind_speed,
    rainfall_1h, rainfall_24h, rainfall_7d, soil_moisture, etc.
    """
    result: Dict[str, Any] = {"source": "open-meteo", "available": False}

    # Current conditions + hourly forecast for last 24h + soil moisture
    data = await _fetch_json(session, OPENMETEO_CURRENT, params={
        "latitude": str(lat),
        "longitude": str(lng),
        "current": "temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,wind_direction_10m,weather_code,surface_pressure",
        "hourly": "precipitation,soil_moisture_0_to_7cm",
        "past_days": "7",
        "forecast_days": "1",
        "timezone": "UTC",
    })
    if not data or "current" not in data:
        return result

    current = data["current"]
    hourly = data.get("hourly", {})

    # Compute accumulated rainfall from hourly data
    precip_hourly = hourly.get("precipitation", [])
    soil_moisture_hourly = hourly.get("soil_moisture_0_to_7cm", [])

    # Filter out None values
    precip_values = [v for v in precip_hourly if v is not None]

    rainfall_1h = precip_values[-1] if precip_values else 0.0
    rainfall_6h = sum(precip_values[-6:]) if len(precip_values) >= 6 else sum(precip_values)
    rainfall_24h = sum(precip_values[-24:]) if len(precip_values) >= 24 else sum(precip_values)
    rainfall_7d = sum(precip_values)

    # Latest soil moisture reading
    soil_vals = [v for v in soil_moisture_hourly if v is not None]
    soil_moisture = soil_vals[-1] / 100.0 if soil_vals else 0.55  # Convert % ? fraction

    result.update({
        "available": True,
        "temperature": current.get("temperature_2m", 8.0),
        "humidity": (current.get("relative_humidity_2m", 80)) / 100.0,
        "wind_speed": current.get("wind_speed_10m", 5.0) / 3.6,  # km/h ? m/s
        "rainfall_1h": rainfall_1h,
        "rainfall_6h": rainfall_6h,
        "rainfall_24h": rainfall_24h,
        "rainfall_7d": rainfall_7d,
        "soil_moisture": soil_moisture,
        "surface_pressure": current.get("surface_pressure"),
        "weather_code": current.get("weather_code"),
    })
    return result

async def openmeteo_get_historical(
    session: aiohttp.ClientSession,
    lat: float,
    lng: float,
    days_back: int = 30,
) -> Dict[str, Any]:
    """Get historical weather data for 30-day rainfall accumulation."""
    now = datetime.now(timezone.utc)
    end = (now - timedelta(days=1)).strftime("%Y-%m-%d")
    start = (now - timedelta(days=days_back)).strftime("%Y-%m-%d")

    data = await _fetch_json(session, OPENMETEO_HISTORY, params={
        "latitude": str(lat),
        "longitude": str(lng),
        "start_date": start,
        "end_date": end,
        "daily": "precipitation_sum,et0_fao_evapotranspiration",
        "timezone": "UTC",
    })
    if not data or "daily" not in data:
        return {"available": False}

    daily = data["daily"]
    precip = [v for v in (daily.get("precipitation_sum") or []) if v is not None]
    eto = [v for v in (daily.get("et0_fao_evapotranspiration") or []) if v is not None]

    return {
        "available": True,
        "rainfall_30d": sum(precip),
        "evapotranspiration": sum(eto[-7:]) / max(len(eto[-7:]), 1),  # 7-day avg mm/day
    }

# 4.  NOAA ENSO Index -- FREE, no key
#     https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt

ENSO_URL = "https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt"

async def noaa_get_enso_index(session: aiohttp.ClientSession) -> float:
    """Fetch the latest Oceanic Ni--o Index (ONI) from NOAA."""
    try:
        async with session.get(ENSO_URL, timeout=aiohttp.ClientTimeout(total=15)) as resp:
            if resp.status != 200:
                return 0.0
            text = await resp.text()
            lines = [l.strip() for l in text.strip().splitlines() if l.strip() and not l.startswith("SEAS")]
            if not lines:
                return 0.0
            last_line = lines[-1].split()
            # Format: YEAR  SEAS  TOTAL  ANOMALY
            return float(last_line[-1])
    except Exception:
        return 0.0

# 5.  NASA FIRMS -- Active Fire Hotspots  -- FREE, key optional
#     https://firms.modaps.eosdis.nasa.gov/api/area/csv/

FIRMS_BASE = "https://firms.modaps.eosdis.nasa.gov/api/area/csv"

async def nasa_get_active_fires(
    session: aiohttp.ClientSession,
    lat: float,
    lng: float,
    radius_km: float = 50.0,
    api_key: str | None = None,
) -> List[Dict[str, Any]]:
    """Get active fire hotspots from NASA FIRMS."""
    key = api_key or os.environ.get("NASA_FIRMS_API_KEY")
    if not key:
        return []
    # FIRMS uses bounding box: west,south,east,north
    delta = radius_km / 111.0  # rough degree offset
    bbox = f"{lng - delta},{lat - delta},{lng + delta},{lat + delta}"
    url = f"{FIRMS_BASE}/{key}/VIIRS_SNPP_NRT/{bbox}/1"

    try:
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=30)) as resp:
            if resp.status != 200:
                return []
            text = await resp.text()
            lines = text.strip().splitlines()
            if len(lines) < 2:
                return []

            headers = lines[0].split(",")
            lat_idx = headers.index("latitude") if "latitude" in headers else 0
            lng_idx = headers.index("longitude") if "longitude" in headers else 1
            conf_idx = headers.index("confidence") if "confidence" in headers else -1
            brp_idx = headers.index("bright_ti4") if "bright_ti4" in headers else -1

            fires = []
            for line in lines[1:21]:  # limit to 20
                cols = line.split(",")
                fire: Dict[str, Any] = {
                    "latitude": float(cols[lat_idx]),
                    "longitude": float(cols[lng_idx]),
                }
                if conf_idx >= 0:
                    fire["confidence"] = cols[conf_idx]
                if brp_idx >= 0:
                    fire["brightness"] = float(cols[brp_idx])
                fires.append(fire)
            return fires
    except Exception:
        return []

# 6.  Open-Elevation API -- FREE, no key

ELEVATION_URL = "https://api.open-elevation.com/api/v1/lookup"

async def get_elevation(
    session: aiohttp.ClientSession,
    lat: float,
    lng: float,
) -> Optional[float]:
    """Get elevation from Open-Elevation API."""
    data = await _fetch_json(session, ELEVATION_URL, params={
        "locations": f"{lat},{lng}",
    })
    if data and data.get("results"):
        return float(data["results"][0].get("elevation", 0))
    return None

# 7.  MASTER AGGREGATOR -- Pulls all sources in parallel

async def fetch_live_features(
    lat: float,
    lng: float,
    region_id: str = "scotland",
    nasa_firms_key: str | None = None,
) -> Dict[str, Any]:
    """
    Fetch real data from ALL free providers in parallel.
    Returns a dict of feature_overrides ready for FeatureStore.get_all_features().
    Also returns raw provider responses for transparency/logging.
    """
    async with aiohttp.ClientSession() as session:
        # Fire all requests in parallel
        sepa_task = sepa_get_river_data(session, lat, lng)
        ea_task = ea_get_river_data(session, lat, lng)
        weather_task = openmeteo_get_current(session, lat, lng)
        history_task = openmeteo_get_historical(session, lat, lng, days_back=30)
        enso_task = noaa_get_enso_index(session)
        elevation_task = get_elevation(session, lat, lng)

        sepa, ea, weather, history, enso, elevation = await asyncio.gather(
            sepa_task, ea_task, weather_task, history_task, enso_task, elevation_task,
            return_exceptions=True,
        )

    # Safely extract values (exceptions become defaults)
    feature_overrides: Dict[str, float] = {}
    raw_sources: Dict[str, Any] = {}
    data_quality: Dict[str, str] = {}

    # River level: prefer SEPA for Scotland, EA for England
    if isinstance(sepa, dict) and sepa.get("available"):
        feature_overrides["river_level"] = sepa["river_level"]
        raw_sources["river"] = sepa
        data_quality["river_level"] = "live_sepa"
        logger.info(f"[LiveData] SEPA river level: {sepa['river_level']:.2f}m at {sepa['station']['station_name']}")
    elif isinstance(ea, dict) and ea.get("available"):
        feature_overrides["river_level"] = ea["river_level"]
        raw_sources["river"] = ea
        data_quality["river_level"] = "live_ea"
        logger.info(f"[LiveData] EA river level: {ea['river_level']:.2f}m at {ea['station']['label']}")

    # Weather data from Open-Meteo
    if isinstance(weather, dict) and weather.get("available"):
        feature_overrides.update({
            "temperature": weather["temperature"],
            "humidity": weather["humidity"],
            "wind_speed": weather["wind_speed"],
            "rainfall_1h": weather["rainfall_1h"],
            "rainfall_6h": weather["rainfall_6h"],
            "rainfall_24h": weather["rainfall_24h"],
            "rainfall_7d": weather["rainfall_7d"],
            "soil_moisture": weather["soil_moisture"],
        })
        raw_sources["weather"] = weather
        data_quality["weather"] = "live_open_meteo"
        logger.info(
            f"[LiveData] Open-Meteo: temp={weather['temperature']:.1f}--C, "
            f"rain_24h={weather['rainfall_24h']:.1f}mm, "
            f"soil_moisture={weather['soil_moisture']:.2f}"
        )

    # Historical rainfall
    if isinstance(history, dict) and history.get("available"):
        feature_overrides["rainfall_30d"] = history["rainfall_30d"]
        feature_overrides["evapotranspiration"] = history["evapotranspiration"]
        raw_sources["history"] = history
        data_quality["rainfall_30d"] = "live_open_meteo_archive"

    # ENSO
    if isinstance(enso, (int, float)):
        feature_overrides["enso_index"] = float(enso)
        data_quality["enso_index"] = "live_noaa"

    # Elevation
    if isinstance(elevation, (int, float)):
        feature_overrides["elevation"] = float(elevation)
        data_quality["elevation"] = "live_open_elevation"

    live_count = len(feature_overrides)
    total_features = 28
    logger.success(
        f"[LiveData] Fetched {live_count}/{total_features} features from live APIs "
        f"for ({lat:.4f}, {lng:.4f})"
    )

    return {
        "feature_overrides": feature_overrides,
        "raw_sources": raw_sources,
        "data_quality": data_quality,
        "live_feature_count": live_count,
        "total_feature_count": total_features,
    }

# Utility

def _haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Haversine distance in km."""
    R = 6371.0
    la1, la2, lo1, lo2 = map(math.radians, [lat1, lat2, lon1, lon2])
    dlat = la2 - la1
    dlon = lo2 - lo1
    a = math.sin(dlat / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin(dlon / 2) ** 2
    return R * 2 * math.asin(math.sqrt(a))

