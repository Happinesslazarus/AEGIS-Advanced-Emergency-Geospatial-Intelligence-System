"""
AEGIS AI Engine — Multi-Location Open-Meteo Weather Fetcher

Fetches extended hourly weather observations from the Open-Meteo Archive
API across a grid of UK locations.  Provides the geographic diversity
needed for rare-event hazard models (drought, heatwave, infrastructure
damage, public safety) that previously relied on a single Central
Scotland point.

All data is real — sourced from ERA5 reanalysis via Open-Meteo's free API.
No API key required.

Variables include standard surface weather plus extended soil/snow/radiation
fields not available from the default regional provider.

Usage (from training scripts):
    from app.training.multi_location_weather import (
        fetch_multi_location_weather, UK_GRID_LOCATIONS, EXTENDED_HOURLY_VARS,
    )
    weather_df = await fetch_multi_location_weather(
        start_date="2015-01-01", end_date="2025-12-31",
    )
"""

from __future__ import annotations

import asyncio
import hashlib
from datetime import datetime, timedelta
from pathlib import Path

import aiohttp
import pandas as pd
from loguru import logger

# Open-Meteo Archive API
_ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
_MAX_CHUNK_DAYS = 365
_REQUEST_DELAY = 3.0        # seconds between each API call (avoid 429)
_MAX_RETRIES = 5            # retries on HTTP 429
_BACKOFF_BASE = 15.0        # initial backoff seconds, doubles each retry
_CACHE_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "cache" / "multi_location_weather"

# UK grid — 13 locations spanning SE England (dry/warm) to N Scotland
#
# heatwave_tmax: region-specific Met Office heatwave Tmax threshold (—C)
UK_GRID_LOCATIONS: list[dict] = [
    # South / South-East England — driest and hottest UK region
    {"id": "london",      "lat": 51.51, "lon": -0.13, "region": "se_england",  "heatwave_tmax": 28.0},
    {"id": "cambridge",   "lat": 52.21, "lon":  0.12, "region": "se_england",  "heatwave_tmax": 27.0},
    {"id": "southampton", "lat": 50.91, "lon": -1.40, "region": "s_england",   "heatwave_tmax": 28.0},
    # South-West / Wales
    {"id": "bristol",     "lat": 51.45, "lon": -2.58, "region": "sw_england",  "heatwave_tmax": 27.0},
    {"id": "cardiff",     "lat": 51.48, "lon": -3.18, "region": "wales",       "heatwave_tmax": 26.0},
    # Midlands
    {"id": "birmingham",  "lat": 52.49, "lon": -1.90, "region": "midlands",    "heatwave_tmax": 27.0},
    # North-West / North-East England
    {"id": "manchester",  "lat": 53.48, "lon": -2.24, "region": "nw_england",  "heatwave_tmax": 26.0},
    {"id": "york",        "lat": 53.96, "lon": -1.08, "region": "ne_england",  "heatwave_tmax": 26.0},
    {"id": "newcastle",   "lat": 54.98, "lon": -1.62, "region": "ne_england",  "heatwave_tmax": 25.0},
    # Scotland
    {"id": "edinburgh",   "lat": 55.95, "lon": -3.19, "region": "scotland",    "heatwave_tmax": 25.0},
    {"id": "glasgow",     "lat": 55.86, "lon": -4.25, "region": "scotland",    "heatwave_tmax": 25.0},
    {"id": "aberdeen",    "lat": 57.15, "lon": -2.09, "region": "scotland",    "heatwave_tmax": 25.0},
    {"id": "inverness",   "lat": 57.48, "lon": -4.22, "region": "scotland",    "heatwave_tmax": 25.0},
]

# Variable presets
STANDARD_HOURLY_VARS = (
    "temperature_2m,relative_humidity_2m,dewpoint_2m,"
    "apparent_temperature,pressure_msl,"
    "wind_speed_10m,wind_gusts_10m,precipitation,"
    "cloud_cover,visibility"
)

EXTENDED_HOURLY_VARS = (
    "temperature_2m,relative_humidity_2m,dewpoint_2m,"
    "apparent_temperature,pressure_msl,"
    "wind_speed_10m,wind_gusts_10m,precipitation,"
    "cloud_cover,visibility,"
    "et0_fao_evapotranspiration,"
    "soil_moisture_0_to_7cm,soil_moisture_7_to_28cm,"
    "soil_temperature_0_to_7cm,"
    "snowfall,snow_depth"
)

# Public API

async def fetch_multi_location_weather(
    locations: list[dict] | None = None,
    start_date: str = "2015-01-01",
    end_date: str = "2025-12-31",
    hourly_vars: str | None = None,
) -> pd.DataFrame:
    """Fetch hourly weather from Open-Meteo Archive for multiple UK locations.

    Results are cached to disk so subsequent training runs (e.g. different
    hazard models) reuse the same data without hitting the API again.

    Parameters
    locations : list[dict], optional
        List of dicts with keys ``id``, ``lat``, ``lon``, ``region``.
        Defaults to :data:`UK_GRID_LOCATIONS` (13 UK grid points).
    start_date, end_date : str
        Date range in ``YYYY-MM-DD`` format.
    hourly_vars : str, optional
        Comma-separated Open-Meteo hourly variable names.
        Defaults to :data:`EXTENDED_HOURLY_VARS`.

    Returns
    pd.DataFrame
        Columns: ``timestamp, station_id, region, latitude, longitude``
        plus all requested hourly weather variables.
    """
    if locations is None:
        locations = UK_GRID_LOCATIONS
    if hourly_vars is None:
        hourly_vars = EXTENDED_HOURLY_VARS

    # Check disk cache
    cache_key = hashlib.md5(
        f"{sorted([l['id'] for l in locations])}|{start_date}|{end_date}|{hourly_vars}".encode()
    ).hexdigest()[:12]
    cache_path = _CACHE_DIR / f"weather_{cache_key}.csv"

    if cache_path.exists():
        logger.info(f"  Loading cached weather from {cache_path}")
        cached = pd.read_csv(cache_path, parse_dates=["timestamp"])
        logger.info(f"  Cached: {len(cached):,} rows from {cached['station_id'].nunique()} locations")
        return cached

    var_names = [v.strip() for v in hourly_vars.split(",") if v.strip()]
    all_frames: list[pd.DataFrame] = []

    # Build lat/lon arrays for batch request (all locations in one API call)
    lats = ",".join(str(loc["lat"]) for loc in locations)
    lons = ",".join(str(loc["lon"]) for loc in locations)
    chunks = _date_chunks(start_date, end_date)
    n_locs = len(locations)

    logger.info(
        f"  Batch-fetching {n_locs} locations — {len(chunks)} year-chunks "
        f"= {len(chunks)} API calls"
    )

    async with aiohttp.ClientSession(
        timeout=aiohttp.ClientTimeout(total=300)
    ) as session:
        for chunk_start, chunk_end in chunks:
            params = {
                "latitude": lats,
                "longitude": lons,
                "start_date": chunk_start,
                "end_date": chunk_end,
                "hourly": hourly_vars,
            }

            # Retry loop with exponential backoff for rate limits
            raw = None
            for attempt in range(_MAX_RETRIES + 1):
                try:
                    async with session.get(_ARCHIVE_URL, params=params) as resp:
                        if resp.status == 429:
                            wait = _BACKOFF_BASE * (2 ** attempt)
                            logger.warning(
                                f"  chunk {chunk_start}: HTTP 429 — "
                                f"backing off {wait:.0f}s (attempt {attempt+1}/{_MAX_RETRIES+1})"
                            )
                            await asyncio.sleep(wait)
                            continue
                        if resp.status != 200:
                            logger.warning(f"  chunk {chunk_start}: HTTP {resp.status}")
                            break
                        raw = await resp.json()
                        break
                except Exception as exc:
                    logger.warning(f"  chunk {chunk_start}: {exc}")
                    break

            if raw is None:
                await asyncio.sleep(_REQUEST_DELAY)
                continue

            # Parse batch response — returns a list for multiple locations
            results_list = raw if isinstance(raw, list) else [raw]

            for idx, loc_data in enumerate(results_list):
                if idx >= n_locs:
                    break
                loc = locations[idx]
                hourly = loc_data.get("hourly", {})
                if not hourly or "time" not in hourly:
                    continue

                df = pd.DataFrame({"timestamp": pd.to_datetime(hourly["time"])})
                for var in var_names:
                    if var in hourly:
                        df[var] = hourly[var]

                df["station_id"] = loc["id"]
                df["region"] = loc.get("region", "unknown")
                df["latitude"] = loc["lat"]
                df["longitude"] = loc["lon"]
                all_frames.append(df)

            logger.info(f"  chunk {chunk_start} ? {chunk_end}: OK ({len(results_list)} locations)")
            await asyncio.sleep(_REQUEST_DELAY)

    if not all_frames:
        return pd.DataFrame()

    result = pd.concat(all_frames, ignore_index=True)
    unique_stations = result["station_id"].nunique()
    logger.info(
        f"Multi-location weather: {len(result):,} total rows "
        f"from {unique_stations} locations"
    )

    # Save to disk cache
    try:
        _CACHE_DIR.mkdir(parents=True, exist_ok=True)
        result.to_csv(cache_path, index=False)
        logger.info(f"  Weather cached to {cache_path}")
    except Exception as exc:
        logger.warning(f"  Cache write failed: {exc}")

    return result

def build_per_station_features(
    weather: pd.DataFrame,
    feature_engineer: type,
    extra_passthrough_cols: list[str] | None = None,
) -> pd.DataFrame:
    """Compute weather + temporal features per station, avoiding rolling-window bleed.

    Calls ``FeatureEngineer.compute_weather_features`` and
    ``compute_temporal_features`` once per station, then concatenates.

    Parameters
    weather : pd.DataFrame
        Multi-station weather data with ``station_id`` column.
    feature_engineer : type
        The ``FeatureEngineer`` class (static methods).
    extra_passthrough_cols : list[str], optional
        Additional columns from *weather* to carry through to features
        (e.g. ``soil_moisture_0_to_7cm``).  These are preserved from the
        raw weather data after aligning to the feature-engineered index.

    Returns
    pd.DataFrame
        Indexed by timestamp, with ``station_id`` column and all feature
        columns.
    """
    if extra_passthrough_cols is None:
        extra_passthrough_cols = []

    station_frames: list[pd.DataFrame] = []

    for station_id, grp in weather.groupby("station_id"):
        grp = grp.sort_values("timestamp").reset_index(drop=True)

        # Standard features (returns timestamp-indexed DataFrame)
        wf = feature_engineer.compute_weather_features(grp)
        # Temporal features (returns integer-indexed DataFrame matching grp)
        tf = feature_engineer.compute_temporal_features(grp["timestamp"])

        # Align: reset wf to integer index, concat, then restore timestamp
        timestamps = wf.index  # DatetimeIndex
        wf_reset = wf.reset_index(drop=True)
        combined = pd.concat([wf_reset, tf], axis=1)
        combined.index = timestamps  # Restore timestamp index
        combined.index.name = "timestamp"  # Name it so reset_index() creates proper column
        combined["station_id"] = station_id

        # Pass through extended columns that FeatureEngineer doesn't know about
        grp_ts = grp.set_index(pd.to_datetime(grp["timestamp"])).sort_index()
        for col in extra_passthrough_cols:
            if col in grp_ts.columns and col not in combined.columns:
                # Align by position (both sorted by timestamp)
                vals = grp_ts[col].values
                if len(vals) == len(combined):
                    combined[col] = vals
                else:
                    # Fallback: reindex by timestamp
                    combined[col] = grp_ts[col].reindex(combined.index).values

        station_frames.append(combined)

    if not station_frames:
        return pd.DataFrame()

    features = pd.concat(station_frames)
    features = features.ffill().fillna(0.0)
    return features

# Internal helpers

def _date_chunks(start: str, end: str) -> list[tuple[str, str]]:
    """Split a date range into <= 1-year chunks for Open-Meteo API."""
    s = datetime.strptime(start, "%Y-%m-%d")
    e = datetime.strptime(end, "%Y-%m-%d")
    chunks: list[tuple[str, str]] = []
    while s < e:
        chunk_end = min(s + timedelta(days=_MAX_CHUNK_DAYS), e)
        chunks.append((s.strftime("%Y-%m-%d"), chunk_end.strftime("%Y-%m-%d")))
        s = chunk_end + timedelta(days=1)
    return chunks
