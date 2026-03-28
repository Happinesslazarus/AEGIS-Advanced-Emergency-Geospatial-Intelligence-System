"""
AEGIS AI Engine — Open-Meteo Global Fallback Provider

A RegionalDataProvider that works anywhere in the world using free, open APIs:
- Open-Meteo Archive API  (historical weather)
- Open-Meteo Flood API    (GloFAS river discharge)
- Open-Meteo Air Quality  (global AQ)
- OpenAQ v2               (AQ fallback)

This is the baseline provider for any region that lacks a dedicated
country-specific provider.  All data is modelled/reanalysis — not from
physical gauge stations.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta
from typing import Any, Optional

import aiohttp
import pandas as pd
from loguru import logger

from data.providers.base import RateLimiter, RegionalDataProvider

# API base URLs
_ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
_FLOOD_URL = "https://flood-api.open-meteo.com/v1/flood"
_AQ_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"
_OPENAQ_URL = "https://api.openaq.org/v2/measurements"

# Hourly weather variables requested from Open-Meteo archive
_WEATHER_HOURLY = (
    "temperature_2m,"
    "relative_humidity_2m,"
    "pressure_msl,"
    "wind_speed_10m,"
    "wind_gusts_10m,"
    "precipitation,"
    "cloud_cover,"
    "visibility"
)

# Air-quality variables requested from Open-Meteo AQ API
_AQ_HOURLY = "pm2_5,pm10,nitrogen_dioxide,ozone,sulphur_dioxide,european_aqi"

# Maximum window per Open-Meteo archive request (1 year keeps responses fast)
_MAX_CHUNK_DAYS = 365

# Grid spacing (degrees) used to synthesise station metadata
_GRID_STEP_DEG = 0.25
_GRID_RADIUS_DEG = 0.5  # +-0.5 deg around requested lat/lon

class OpenMeteoProvider(RegionalDataProvider):
    """Global fallback data provider backed by Open-Meteo free APIs.

    Parameters
    region_id : str
        Unique region identifier, e.g. ``"global-nairobi"``.
    country_code : str
        ISO 3166-1 alpha-2 country code.  Defaults to ``"XX"`` (unknown).
    refresh : bool
        If True, bypass the parquet cache and re-fetch from APIs.
    """

    def __init__(
        self,
        region_id: str,
        country_code: str = "XX",
        *,
        refresh: bool = False,
    ) -> None:
        super().__init__(region_id, country_code, refresh=refresh)
        self._om_limiter = RateLimiter(max_requests=100, period_seconds=60)
        self._oaq_limiter = RateLimiter(max_requests=100, period_seconds=60)

    # Weather

    async def get_historical_weather(
        self, lat: float, lon: float, start_date: str, end_date: str
    ) -> pd.DataFrame:
        """Fetch hourly weather from Open-Meteo archive API.

        Automatically chunks the request into <=1-year windows to stay
        within free-tier limits.

        Returns
        pd.DataFrame
            Columns: timestamp, temperature_2m, relative_humidity_2m,
            pressure_msl, wind_speed_10m, wind_gusts_10m, precipitation,
            cloud_cover, visibility
        """
        cache_key = self._cache_key("weather", str(lat), str(lon), start_date, end_date)

        async def _fetch() -> pd.DataFrame:
            chunks = _date_chunks(start_date, end_date, _MAX_CHUNK_DAYS)
            frames: list[pd.DataFrame] = []
            for chunk_start, chunk_end in chunks:
                params = {
                    "latitude": lat,
                    "longitude": lon,
                    "start_date": chunk_start,
                    "end_date": chunk_end,
                    "hourly": _WEATHER_HOURLY,
                }
                data = await self._get_json(_ARCHIVE_URL, params, self._om_limiter)
                hourly = data.get("hourly", {})
                if not hourly or "time" not in hourly:
                    logger.warning(
                        f"Open-Meteo archive returned no hourly data for "
                        f"{chunk_start}..{chunk_end} at ({lat}, {lon})"
                    )
                    continue
                df = pd.DataFrame(
                    {
                        "timestamp": pd.to_datetime(hourly["time"]),
                        "temperature_2m": hourly.get("temperature_2m"),
                        "relative_humidity_2m": hourly.get("relative_humidity_2m"),
                        "pressure_msl": hourly.get("pressure_msl"),
                        "wind_speed_10m": hourly.get("wind_speed_10m"),
                        "wind_gusts_10m": hourly.get("wind_gusts_10m"),
                        "precipitation": hourly.get("precipitation"),
                        "cloud_cover": hourly.get("cloud_cover"),
                        "visibility": hourly.get("visibility"),
                    }
                )
                frames.append(df)

            if not frames:
                return _empty_weather_df()
            result = pd.concat(frames, ignore_index=True)
            logger.info(
                f"Open-Meteo archive: {len(result)} hourly rows for ({lat}, {lon})"
            )
            return result

        return await self._fetch_or_cache(
            "weather", cache_key, _fetch, rate_limiter=self._om_limiter
        )

    # Hydrology — river levels

    async def get_river_levels(
        self, station_ids: list[str], start_date: str, end_date: str
    ) -> pd.DataFrame:
        """Fetch modelled river discharge from Open-Meteo Flood (GloFAS) API.

        Open-Meteo provides *forecast* river discharge rather than observed
        gauge readings.  We convert discharge to a rough level estimate
        using a simplified Manning-equation proxy.

        .. warning::
            The returned ``level_m`` values are rough model estimates,
            **not** physical gauge observations.

        Parameters
        station_ids : list[str]
            Each ID is expected in ``"lat_lon"`` format (e.g. ``"51.5_-0.1"``).
        """
        logger.warning(
            "OpenMeteoProvider.get_river_levels: returning MODELLED river "
            "discharge from GloFAS, not physical gauge observations."
        )
        cache_key = self._cache_key(
            "river", ",".join(sorted(station_ids)), start_date, end_date
        )

        async def _fetch() -> pd.DataFrame:
            frames: list[pd.DataFrame] = []
            for sid in station_ids:
                lat, lon = _parse_lat_lon_id(sid)
                if lat is None:
                    logger.warning(f"Skipping invalid station_id '{sid}' — expected 'lat_lon' format")
                    continue
                params = {
                    "latitude": lat,
                    "longitude": lon,
                    "daily": "river_discharge",
                    "start_date": start_date,
                    "end_date": end_date,
                }
                try:
                    data = await self._get_json(_FLOOD_URL, params, self._om_limiter)
                except Exception as exc:
                    logger.error(f"Flood API failed for station {sid}: {exc}")
                    continue
                daily = data.get("daily", {})
                if not daily or "time" not in daily:
                    continue
                discharge = daily.get("river_discharge", [])
                df = pd.DataFrame(
                    {
                        "timestamp": pd.to_datetime(daily["time"]),
                        "station_id": sid,
                        "flow_m3s": discharge,
                        "level_m": [_discharge_to_level(q) for q in discharge],
                    }
                )
                frames.append(df)

            if not frames:
                return _empty_river_df()
            return pd.concat(frames, ignore_index=True)

        return await self._fetch_or_cache(
            "river", cache_key, _fetch, rate_limiter=self._om_limiter
        )

    # Hydrology — flood events

    async def get_flood_events(
        self, start_date: str, end_date: str
    ) -> pd.DataFrame:
        """Return an empty flood-events DataFrame.

        Open-Meteo does not provide a ground-truth flood event archive.
        Training pipelines consuming this provider must handle the empty
        result gracefully (e.g. by using only weather/discharge features
        with synthetic labels, or by skipping flood-event-dependent steps).
        """
        logger.warning(
            "OpenMeteoProvider.get_flood_events: Open-Meteo has no flood "
            "event archive.  Returning empty DataFrame.  Training scripts "
            "must handle this (e.g. synthetic labels from discharge thresholds)."
        )
        return pd.DataFrame(
            columns=[
                "event_id",
                "start_date",
                "end_date",
                "latitude",
                "longitude",
                "severity",
                "source",
                "affected_area_km2",
            ]
        )

    # Rainfall

    async def get_rainfall(
        self, station_ids: list[str], start_date: str, end_date: str
    ) -> pd.DataFrame:
        """Extract per-station rainfall from the Open-Meteo archive API.

        Each ``station_id`` is expected in ``"lat_lon"`` format.  The
        precipitation column from the hourly archive response is returned
        as ``rainfall_mm``.
        """
        cache_key = self._cache_key(
            "rainfall", ",".join(sorted(station_ids)), start_date, end_date
        )

        async def _fetch() -> pd.DataFrame:
            frames: list[pd.DataFrame] = []
            for sid in station_ids:
                lat, lon = _parse_lat_lon_id(sid)
                if lat is None:
                    logger.warning(f"Skipping invalid station_id '{sid}'")
                    continue
                chunks = _date_chunks(start_date, end_date, _MAX_CHUNK_DAYS)
                sid_frames: list[pd.DataFrame] = []
                for chunk_start, chunk_end in chunks:
                    params = {
                        "latitude": lat,
                        "longitude": lon,
                        "start_date": chunk_start,
                        "end_date": chunk_end,
                        "hourly": "precipitation",
                    }
                    try:
                        data = await self._get_json(
                            _ARCHIVE_URL, params, self._om_limiter
                        )
                    except Exception as exc:
                        logger.error(
                            f"Rainfall fetch failed for {sid} "
                            f"({chunk_start}..{chunk_end}): {exc}"
                        )
                        continue
                    hourly = data.get("hourly", {})
                    if not hourly or "time" not in hourly:
                        continue
                    df = pd.DataFrame(
                        {
                            "timestamp": pd.to_datetime(hourly["time"]),
                            "station_id": sid,
                            "rainfall_mm": hourly.get("precipitation"),
                        }
                    )
                    sid_frames.append(df)
                if sid_frames:
                    frames.append(pd.concat(sid_frames, ignore_index=True))

            if not frames:
                return pd.DataFrame(columns=["timestamp", "station_id", "rainfall_mm"])
            return pd.concat(frames, ignore_index=True)

        return await self._fetch_or_cache(
            "rainfall", cache_key, _fetch, rate_limiter=self._om_limiter
        )

    # Station metadata

    async def get_station_metadata(self) -> pd.DataFrame:
        """Generate synthetic grid-point station entries.

        Open-Meteo is grid-based and does not have physical stations.
        This method generates a grid of points around the region centre
        (derived from ``region_id``) to satisfy the interface contract.

        .. note::
            These are **grid points**, not physical station locations.
            Set the centre by calling :pymethod:`set_centre` before this
            method, or provide a ``region_id`` in ``"prefix-lat_lon"``
            format (e.g. ``"global-51.5_-0.1"``).
        """
        logger.info(
            "OpenMeteoProvider.get_station_metadata: generating synthetic "
            "grid-point entries (Open-Meteo is grid-based, not station-based)."
        )

        centre_lat, centre_lon = self._infer_centre()
        rows: list[dict[str, Any]] = []
        idx = 0
        lat = centre_lat - _GRID_RADIUS_DEG
        while lat <= centre_lat + _GRID_RADIUS_DEG + 1e-9:
            lon = centre_lon - _GRID_RADIUS_DEG
            while lon <= centre_lon + _GRID_RADIUS_DEG + 1e-9:
                sid = f"{round(lat, 4)}_{round(lon, 4)}"
                rows.append(
                    {
                        "station_id": sid,
                        "station_name": f"grid-{idx:03d}",
                        "latitude": round(lat, 4),
                        "longitude": round(lon, 4),
                        "river_name": "unknown",
                        "catchment_area_km2": None,
                        "station_type": "grid_point",
                        "elevation_m": None,
                    }
                )
                idx += 1
                lon += _GRID_STEP_DEG
            lat += _GRID_STEP_DEG
        return pd.DataFrame(rows)

    # Air quality

    async def get_air_quality(
        self, lat: float, lon: float, start_date: str, end_date: str
    ) -> pd.DataFrame:
        """Fetch air quality data, trying Open-Meteo AQ first, then OpenAQ.

        Returns
        pd.DataFrame
            Columns: timestamp, pm2_5, pm10, no2, o3, so2, aqi
        """
        cache_key = self._cache_key("aq", str(lat), str(lon), start_date, end_date)

        async def _fetch() -> pd.DataFrame:
            # attempt 1: Open-Meteo Air Quality
            try:
                df = await self._fetch_om_air_quality(lat, lon, start_date, end_date)
                if df is not None and not df.empty:
                    logger.info(
                        f"Open-Meteo AQ: {len(df)} rows for ({lat}, {lon})"
                    )
                    return df
            except Exception as exc:
                logger.warning(f"Open-Meteo AQ failed, trying OpenAQ: {exc}")

            # attempt 2: OpenAQ v2
            try:
                df = await self._fetch_openaq(lat, lon, start_date, end_date)
                if df is not None and not df.empty:
                    logger.info(f"OpenAQ: {len(df)} rows for ({lat}, {lon})")
                    return df
            except Exception as exc:
                logger.warning(f"OpenAQ also failed: {exc}")

            logger.error(
                f"No air quality data available for ({lat}, {lon}) "
                f"from {start_date} to {end_date}"
            )
            return _empty_aq_df()

        return await self._fetch_or_cache(
            "air_quality", cache_key, _fetch, rate_limiter=self._om_limiter
        )

    # Internal helpers

    async def _get_json(
        self, url: str, params: dict[str, Any], limiter: RateLimiter
    ) -> dict[str, Any]:
        """Perform a GET request, respecting rate limits."""
        await limiter.acquire()
        async with aiohttp.ClientSession() as session:
            async with session.get(url, params=params, timeout=aiohttp.ClientTimeout(total=30)) as resp:
                if resp.status != 200:
                    text = await resp.text()
                    raise RuntimeError(
                        f"HTTP {resp.status} from {url}: {text[:300]}"
                    )
                return await resp.json()

    async def _fetch_om_air_quality(
        self, lat: float, lon: float, start_date: str, end_date: str
    ) -> pd.DataFrame:
        """Fetch from Open-Meteo Air Quality API."""
        chunks = _date_chunks(start_date, end_date, _MAX_CHUNK_DAYS)
        frames: list[pd.DataFrame] = []
        for chunk_start, chunk_end in chunks:
            params = {
                "latitude": lat,
                "longitude": lon,
                "start_date": chunk_start,
                "end_date": chunk_end,
                "hourly": _AQ_HOURLY,
            }
            data = await self._get_json(_AQ_URL, params, self._om_limiter)
            hourly = data.get("hourly", {})
            if not hourly or "time" not in hourly:
                continue
            df = pd.DataFrame(
                {
                    "timestamp": pd.to_datetime(hourly["time"]),
                    "pm2_5": hourly.get("pm2_5"),
                    "pm10": hourly.get("pm10"),
                    "no2": hourly.get("nitrogen_dioxide"),
                    "o3": hourly.get("ozone"),
                    "so2": hourly.get("sulphur_dioxide"),
                    "aqi": hourly.get("european_aqi"),
                }
            )
            frames.append(df)
        if not frames:
            return _empty_aq_df()
        return pd.concat(frames, ignore_index=True)

    async def _fetch_openaq(
        self, lat: float, lon: float, start_date: str, end_date: str
    ) -> pd.DataFrame:
        """Fallback: fetch air quality from OpenAQ v2 measurements API."""
        # OpenAQ queries by coordinates + radius
        params: dict[str, Any] = {
            "coordinates": f"{lat},{lon}",
            "radius": 25000,  # 25 km
            "date_from": start_date,
            "date_to": end_date,
            "limit": 10000,
            "parameter": "pm25,pm10,no2,o3,so2",
        }
        data = await self._get_json(_OPENAQ_URL, params, self._oaq_limiter)
        results = data.get("results", [])
        if not results:
            return _empty_aq_df()

        # Pivot from long format to wide
        records: list[dict[str, Any]] = []
        for r in results:
            records.append(
                {
                    "timestamp": r.get("date", {}).get("utc"),
                    "parameter": r.get("parameter"),
                    "value": r.get("value"),
                }
            )
        long_df = pd.DataFrame(records)
        if long_df.empty:
            return _empty_aq_df()
        long_df["timestamp"] = pd.to_datetime(long_df["timestamp"])

        # Map OpenAQ parameter names to our columns
        param_map = {
            "pm25": "pm2_5",
            "pm10": "pm10",
            "no2": "no2",
            "o3": "o3",
            "so2": "so2",
        }
        long_df["parameter"] = long_df["parameter"].map(param_map)
        long_df = long_df.dropna(subset=["parameter"])
        wide = long_df.pivot_table(
            index="timestamp", columns="parameter", values="value", aggfunc="mean"
        ).reset_index()

        # Ensure all expected columns exist
        for col in ("pm2_5", "pm10", "no2", "o3", "so2"):
            if col not in wide.columns:
                wide[col] = None
        wide["aqi"] = None  # OpenAQ doesn't provide a composite AQI
        return wide[["timestamp", "pm2_5", "pm10", "no2", "o3", "so2", "aqi"]]

    def _infer_centre(self) -> tuple[float, float]:
        """Best-effort extraction of centre lat/lon from ``region_id``.

        Supports formats like ``"global-51.5_-0.1"`` or ``"ng-lagos"``.
        Falls back to (0.0, 0.0) with a warning.
        """
        # Try splitting off the last segment after '-' as "lat_lon"
        parts = self.region_id.rsplit("-", 1)
        if len(parts) == 2:
            lat, lon = _parse_lat_lon_id(parts[1])
            if lat is not None:
                return lat, lon
        logger.warning(
            f"Cannot infer centre from region_id '{self.region_id}', "
            "defaulting to (0.0, 0.0).  Provide a region_id in "
            "'prefix-lat_lon' format for better results."
        )
        return 0.0, 0.0

# Module-level helper functions

def _date_chunks(
    start: str, end: str, max_days: int
) -> list[tuple[str, str]]:
    """Split a date range into windows of at most ``max_days``."""
    fmt = "%Y-%m-%d"
    s = datetime.strptime(start, fmt)
    e = datetime.strptime(end, fmt)
    chunks: list[tuple[str, str]] = []
    while s <= e:
        chunk_end = min(s + timedelta(days=max_days - 1), e)
        chunks.append((s.strftime(fmt), chunk_end.strftime(fmt)))
        s = chunk_end + timedelta(days=1)
    return chunks

def _parse_lat_lon_id(sid: str) -> tuple[Optional[float], Optional[float]]:
    """Parse ``"lat_lon"`` string into (lat, lon) floats.

    Returns ``(None, None)`` on failure.
    """
    parts = sid.split("_")
    if len(parts) != 2:
        return None, None
    try:
        return float(parts[0]), float(parts[1])
    except ValueError:
        return None, None

def _discharge_to_level(q: Optional[float]) -> Optional[float]:
    """Rough discharge-to-level estimate using a power-law proxy.

    Uses a simplified Manning-equation-inspired relation:
        level ≈ 0.3 * Q^0.4

    This is a very rough approximation — real stage-discharge curves
    are site-specific.  Useful only as a relative indicator.
    """
    if q is None or math.isnan(q) or q < 0:
        return None
    return round(0.3 * (q ** 0.4), 3)

def _empty_weather_df() -> pd.DataFrame:
    return pd.DataFrame(
        columns=[
            "timestamp",
            "temperature_2m",
            "relative_humidity_2m",
            "pressure_msl",
            "wind_speed_10m",
            "wind_gusts_10m",
            "precipitation",
            "cloud_cover",
            "visibility",
        ]
    )

def _empty_river_df() -> pd.DataFrame:
    return pd.DataFrame(
        columns=["timestamp", "station_id", "level_m", "flow_m3s"]
    )

def _empty_aq_df() -> pd.DataFrame:
    return pd.DataFrame(
        columns=["timestamp", "pm2_5", "pm10", "no2", "o3", "so2", "aqi"]
    )
