"""
AEGIS AI Engine -- UK/Scotland Regional Data Provider

Unified provider for Scottish and English hydrological, meteorological,
and air-quality data.  Connects to real UK government APIs:

- SEPA KiWIS time-series (river level / flow)
- SEPA rainfall API
- SEPA flood-data archive
- Environment Agency hydrology & flood-monitoring APIs
- EA recorded-flood-outlines dataset
- NRFA gauged daily river flow
- DEFRA UK-AIR air-quality feeds

All HTTP calls are async (aiohttp), rate-limited, and cached to parquet
via the base-class helpers.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any, Optional

import aiohttp
import pandas as pd
from loguru import logger

from data.providers.base import RateLimiter, RegionalDataProvider

# API base URLs

SEPA_KIWIS_BASE = "https://timeseries.sepa.org.uk/KiWIS/KiWIS"
SEPA_RAINFALL_BASE = "https://www2.sepa.org.uk/rainfall/api"
SEPA_FLOOD_DATA_BASE = "https://www2.sepa.org.uk/FloodData"

EA_HYDROLOGY_BASE = "https://environment.data.gov.uk/hydrology"
EA_FLOOD_MONITORING_BASE = "https://environment.data.gov.uk/flood-monitoring"
EA_FLOOD_OUTLINES_BASE = (
    "https://environment.data.gov.uk/dataset/recorded-flood-outlines"
)

NRFA_BASE = "https://nrfaapps.ceh.ac.uk/nrfa/ws"

DEFRA_AQ_BASE = "https://uk-air.defra.gov.uk/aq/data"

# Default stations -- ~30 key gauges across Scotland and England

DEFAULT_STATIONS: dict[str, dict[str, Any]] = {
    # Scotland (SEPA)
    "234253": {
        "name": "Perth (Tay)",
        "river": "River Tay",
        "lat": 56.3950,
        "lon": -3.4308,
        "catchment_km2": 4587.0,
        "type": "level_flow",
        "elevation_m": 5.0,
    },
    "234219": {
        "name": "Ballathie (Tay)",
        "river": "River Tay",
        "lat": 56.4840,
        "lon": -3.4060,
        "catchment_km2": 4990.0,
        "type": "level_flow",
        "elevation_m": 18.0,
    },
    "234201": {
        "name": "Dalgety Bay (Forth)",
        "river": "Firth of Forth",
        "lat": 56.0330,
        "lon": -3.3540,
        "catchment_km2": 1036.0,
        "type": "level",
        "elevation_m": 0.0,
    },
    "234220": {
        "name": "Craigforth (Forth)",
        "river": "River Forth",
        "lat": 56.1270,
        "lon": -3.9580,
        "catchment_km2": 1036.0,
        "type": "level_flow",
        "elevation_m": 5.0,
    },
    "234254": {
        "name": "Daldowie (Clyde)",
        "river": "River Clyde",
        "lat": 55.8270,
        "lon": -4.1050,
        "catchment_km2": 1903.0,
        "type": "level_flow",
        "elevation_m": 8.0,
    },
    "234250": {
        "name": "Glasgow (Clyde)",
        "river": "River Clyde",
        "lat": 55.8580,
        "lon": -4.2590,
        "catchment_km2": 1903.0,
        "type": "level",
        "elevation_m": 2.0,
    },
    "234204": {
        "name": "Park (Dee)",
        "river": "River Dee",
        "lat": 57.0770,
        "lon": -2.5250,
        "catchment_km2": 1844.0,
        "type": "level_flow",
        "elevation_m": 22.0,
    },
    "234207": {
        "name": "Boat of Garten (Spey)",
        "river": "River Spey",
        "lat": 57.2530,
        "lon": -3.7310,
        "catchment_km2": 1268.0,
        "type": "level_flow",
        "elevation_m": 218.0,
    },
    "234208": {
        "name": "Aberlour (Spey)",
        "river": "River Spey",
        "lat": 57.4670,
        "lon": -3.2270,
        "catchment_km2": 2640.0,
        "type": "level_flow",
        "elevation_m": 100.0,
    },
    "234255": {
        "name": "Norham (Tweed)",
        "river": "River Tweed",
        "lat": 55.6430,
        "lon": -2.1510,
        "catchment_km2": 4390.0,
        "type": "level_flow",
        "elevation_m": 9.0,
    },
    "234210": {
        "name": "Jedburgh (Jed Water)",
        "river": "Jed Water",
        "lat": 55.4780,
        "lon": -2.5500,
        "catchment_km2": 139.0,
        "type": "level",
        "elevation_m": 72.0,
    },
    "234215": {
        "name": "Dumfries (Nith)",
        "river": "River Nith",
        "lat": 55.0700,
        "lon": -3.6120,
        "catchment_km2": 799.0,
        "type": "level_flow",
        "elevation_m": 9.0,
    },
    "234240": {
        "name": "Inverness (Ness)",
        "river": "River Ness",
        "lat": 57.4760,
        "lon": -4.2370,
        "catchment_km2": 1792.0,
        "type": "level_flow",
        "elevation_m": 3.0,
    },
    "234245": {
        "name": "Ayr (River Ayr)",
        "river": "River Ayr",
        "lat": 55.4620,
        "lon": -4.6270,
        "catchment_km2": 574.0,
        "type": "level_flow",
        "elevation_m": 5.0,
    },
    "234260": {
        "name": "Fort William (Lochy)",
        "river": "River Lochy",
        "lat": 56.8150,
        "lon": -5.1100,
        "catchment_km2": 1257.0,
        "type": "level",
        "elevation_m": 3.0,
    },
    # England / Wales (Environment Agency)
    "E60301": {
        "name": "Teddington (Thames)",
        "river": "River Thames",
        "lat": 51.4310,
        "lon": -0.3210,
        "catchment_km2": 9948.0,
        "type": "level_flow",
        "elevation_m": 5.0,
    },
    "E21750": {
        "name": "York (Ouse)",
        "river": "River Ouse",
        "lat": 53.9590,
        "lon": -1.0850,
        "catchment_km2": 3315.0,
        "type": "level_flow",
        "elevation_m": 5.0,
    },
    "E21301": {
        "name": "Skelton (Ouse)",
        "river": "River Ouse",
        "lat": 54.0130,
        "lon": -1.1120,
        "catchment_km2": 3315.0,
        "type": "level_flow",
        "elevation_m": 8.0,
    },
    "E40003": {
        "name": "Hereford (Wye)",
        "river": "River Wye",
        "lat": 52.0560,
        "lon": -2.7130,
        "catchment_km2": 4010.0,
        "type": "level_flow",
        "elevation_m": 44.0,
    },
    "E22001": {
        "name": "Shardlow (Trent)",
        "river": "River Trent",
        "lat": 52.8550,
        "lon": -1.3600,
        "catchment_km2": 7486.0,
        "type": "level_flow",
        "elevation_m": 30.0,
    },
    "E27009": {
        "name": "Carlisle (Eden)",
        "river": "River Eden",
        "lat": 54.9000,
        "lon": -2.9360,
        "catchment_km2": 2286.5,
        "type": "level_flow",
        "elevation_m": 14.0,
    },
    "E27071": {
        "name": "Appleby (Eden)",
        "river": "River Eden",
        "lat": 54.5830,
        "lon": -2.4870,
        "catchment_km2": 616.4,
        "type": "level_flow",
        "elevation_m": 104.0,
    },
    "E72004": {
        "name": "Bewdley (Severn)",
        "river": "River Severn",
        "lat": 52.3780,
        "lon": -2.3220,
        "catchment_km2": 4325.0,
        "type": "level_flow",
        "elevation_m": 14.0,
    },
    "E28009": {
        "name": "Durham (Wear)",
        "river": "River Wear",
        "lat": 54.7740,
        "lon": -1.5760,
        "catchment_km2": 657.8,
        "type": "level_flow",
        "elevation_m": 32.0,
    },
    "E28003": {
        "name": "Chester-le-Street (Wear)",
        "river": "River Wear",
        "lat": 54.8530,
        "lon": -1.5730,
        "catchment_km2": 1008.3,
        "type": "level_flow",
        "elevation_m": 12.0,
    },
    "E76005": {
        "name": "Buildwas (Severn)",
        "river": "River Severn",
        "lat": 52.6320,
        "lon": -2.5390,
        "catchment_km2": 8580.0,
        "type": "level_flow",
        "elevation_m": 31.0,
    },
    "E46003": {
        "name": "St Denys (Itchen)",
        "river": "River Itchen",
        "lat": 50.9180,
        "lon": -1.3850,
        "catchment_km2": 360.0,
        "type": "level_flow",
        "elevation_m": 2.0,
    },
    "E73010": {
        "name": "Llanfair (Vyrnwy)",
        "river": "River Vyrnwy",
        "lat": 52.7640,
        "lon": -3.1460,
        "catchment_km2": 778.0,
        "type": "level_flow",
        "elevation_m": 64.0,
    },
    "E55002": {
        "name": "Exeter (Exe)",
        "river": "River Exe",
        "lat": 50.7230,
        "lon": -3.5260,
        "catchment_km2": 600.9,
        "type": "level_flow",
        "elevation_m": 7.0,
    },
    "E34001": {
        "name": "Isley Walton (Soar)",
        "river": "River Soar",
        "lat": 52.8110,
        "lon": -1.3600,
        "catchment_km2": 1390.0,
        "type": "level_flow",
        "elevation_m": 29.0,
    },
}

# Timeout for individual HTTP requests (seconds)
_HTTP_TIMEOUT = aiohttp.ClientTimeout(total=60)

# Provider implementation

class UKScotlandProvider(RegionalDataProvider):
    """Unified UK/Scotland data provider using SEPA, EA, NRFA, and DEFRA APIs.

    Covers Scotland (SEPA) and England/Wales (EA) with a single interface
    matching the ``RegionalDataProvider`` contract.
    """

    def __init__(self, *, refresh: bool = False) -> None:
        super().__init__(region_id="uk-default", country_code="GB", refresh=refresh)

        # Per-source rate limiters
        self._sepa_limiter = RateLimiter(max_requests=10, period_seconds=1.0)
        self._ea_limiter = RateLimiter(max_requests=10, period_seconds=1.0)
        self._nrfa_limiter = RateLimiter(max_requests=5, period_seconds=1.0)
        self._defra_limiter = RateLimiter(max_requests=5, period_seconds=1.0)

    # Internal HTTP helpers

    async def _get_json(
        self,
        session: aiohttp.ClientSession,
        url: str,
        *,
        params: Optional[dict[str, str]] = None,
        rate_limiter: Optional[RateLimiter] = None,
    ) -> Any:
        """Issue a GET request and return parsed JSON."""
        if rate_limiter:
            await rate_limiter.acquire()
        async with session.get(url, params=params, timeout=_HTTP_TIMEOUT) as resp:
            resp.raise_for_status()
            return await resp.json(content_type=None)

    async def _get_text(
        self,
        session: aiohttp.ClientSession,
        url: str,
        *,
        params: Optional[dict[str, str]] = None,
        rate_limiter: Optional[RateLimiter] = None,
    ) -> str:
        """Issue a GET request and return raw text."""
        if rate_limiter:
            await rate_limiter.acquire()
        async with session.get(url, params=params, timeout=_HTTP_TIMEOUT) as resp:
            resp.raise_for_status()
            return await resp.text()

    # Weather (Open-Meteo historical archive -- free, no key required)

    async def get_historical_weather(
        self, lat: float, lon: float, start_date: str, end_date: str
    ) -> pd.DataFrame:
        """Hourly weather observations via Open-Meteo historical archive.

        Returns columns:
            timestamp, temperature_2m, relative_humidity_2m, pressure_msl,
            wind_speed_10m, wind_gusts_10m, precipitation, cloud_cover, visibility
        """
        cache_key = self._cache_key("weather", str(lat), str(lon), start_date, end_date)

        async def _fetch() -> pd.DataFrame:
            url = "https://archive-api.open-meteo.com/v1/archive"
            params = {
                "latitude": str(lat),
                "longitude": str(lon),
                "start_date": start_date,
                "end_date": end_date,
                "hourly": (
                    "temperature_2m,relative_humidity_2m,pressure_msl,"
                    "wind_speed_10m,wind_gusts_10m,precipitation,"
                    "cloud_cover,visibility"
                ),
                "timezone": "UTC",
            }
            async with aiohttp.ClientSession() as session:
                data = await self._get_json(session, url, params=params)

            hourly = data.get("hourly", {})
            times = hourly.get("time", [])
            if not times:
                logger.warning(
                    "Open-Meteo returned no hourly data for ({}, {}) "
                    "{} to {}".format(lat, lon, start_date, end_date)
                )
                return pd.DataFrame(
                    columns=[
                        "timestamp", "temperature_2m", "relative_humidity_2m",
                        "pressure_msl", "wind_speed_10m", "wind_gusts_10m",
                        "precipitation", "cloud_cover", "visibility",
                    ]
                )

            df = pd.DataFrame(
                {
                    "timestamp": pd.to_datetime(times, utc=True),
                    "temperature_2m": hourly.get("temperature_2m", [None] * len(times)),
                    "relative_humidity_2m": hourly.get("relative_humidity_2m", [None] * len(times)),
                    "pressure_msl": hourly.get("pressure_msl", [None] * len(times)),
                    "wind_speed_10m": hourly.get("wind_speed_10m", [None] * len(times)),
                    "wind_gusts_10m": hourly.get("wind_gusts_10m", [None] * len(times)),
                    "precipitation": hourly.get("precipitation", [None] * len(times)),
                    "cloud_cover": hourly.get("cloud_cover", [None] * len(times)),
                    "visibility": hourly.get("visibility", [None] * len(times)),
                }
            )
            return df

        return await self._fetch_or_cache("weather", cache_key, _fetch)

    # Hydrology -- river levels / flow

    async def get_river_levels(
        self, station_ids: list[str], start_date: str, end_date: str
    ) -> pd.DataFrame:
        """River level and flow readings from SEPA KiWIS and EA Hydrology APIs.

        Returns columns: timestamp, station_id, level_m, flow_m3s
        """
        cache_key = self._cache_key(
            "river_levels", ",".join(sorted(station_ids)), start_date, end_date
        )

        async def _fetch() -> pd.DataFrame:
            frames: list[pd.DataFrame] = []

            async with aiohttp.ClientSession() as session:
                sepa_ids = [s for s in station_ids if not s.startswith("E")]
                ea_ids = [s for s in station_ids if s.startswith("E")]

                # SEPA KiWIS
                for sid in sepa_ids:
                    try:
                        df = await self._fetch_sepa_levels(session, sid, start_date, end_date)
                        if not df.empty:
                            frames.append(df)
                    except Exception as exc:
                        logger.warning(
                            "SEPA level fetch failed for station {}: {}", sid, exc
                        )

                # Environment Agency
                for sid in ea_ids:
                    try:
                        df = await self._fetch_ea_levels(session, sid, start_date, end_date)
                        if not df.empty:
                            frames.append(df)
                    except Exception as exc:
                        logger.warning(
                            "EA level fetch failed for station {}: {}", sid, exc
                        )

            if not frames:
                logger.warning(
                    "No river-level data returned for stations {} ({} - {})",
                    station_ids, start_date, end_date,
                )
                return pd.DataFrame(
                    columns=["timestamp", "station_id", "level_m", "flow_m3s"]
                )
            return pd.concat(frames, ignore_index=True)

        return await self._fetch_or_cache(
            "river_levels", cache_key, _fetch
        )

    async def _fetch_sepa_levels(
        self,
        session: aiohttp.ClientSession,
        station_id: str,
        start_date: str,
        end_date: str,
    ) -> pd.DataFrame:
        """Fetch level/flow time-series from SEPA KiWIS for one station."""
        params = {
            "service": "kisters",
            "type": "queryServices",
            "request": "getTimeseriesValues",
            "datasource": "0",
            "format": "json",
            "ts_id": station_id,
            "from": start_date,
            "to": end_date,
            "metadata": "true",
            "returnfields": "Timestamp,Value",
        }
        data = await self._get_json(
            session, SEPA_KIWIS_BASE, params=params,
            rate_limiter=self._sepa_limiter,
        )

        # KiWIS returns a list of time-series objects
        ts_list = data if isinstance(data, list) else [data]
        rows: list[dict[str, Any]] = []
        for ts_obj in ts_list:
            ts_data = ts_obj.get("data", []) if isinstance(ts_obj, dict) else []
            for point in ts_data:
                if len(point) < 2 or point[1] is None:
                    continue
                rows.append(
                    {
                        "timestamp": pd.to_datetime(point[0], utc=True),
                        "station_id": station_id,
                        "level_m": float(point[1]),
                        "flow_m3s": None,
                    }
                )

        if not rows:
            logger.warning(
                "SEPA KiWIS returned no data for station {} ({} - {})",
                station_id, start_date, end_date,
            )
            return pd.DataFrame(
                columns=["timestamp", "station_id", "level_m", "flow_m3s"]
            )

        return pd.DataFrame(rows)

    async def _fetch_ea_levels(
        self,
        session: aiohttp.ClientSession,
        station_id: str,
        start_date: str,
        end_date: str,
    ) -> pd.DataFrame:
        """Fetch readings from EA Hydrology API for one station."""
        url = f"{EA_HYDROLOGY_BASE}/id/measures"
        params = {
            "station.stationReference": station_id,
        }
        measures_data = await self._get_json(
            session, url, params=params, rate_limiter=self._ea_limiter,
        )
        items = measures_data.get("items", [])
        if not items:
            logger.warning("EA Hydrology: no measures found for station {}", station_id)
            return pd.DataFrame(
                columns=["timestamp", "station_id", "level_m", "flow_m3s"]
            )

        rows: list[dict[str, Any]] = []

        for measure in items:
            measure_id = measure.get("@id", "")
            parameter = measure.get("parameterName", "").lower()

            # Fetch readings for this measure
            readings_url = f"{measure_id}/readings"
            readings_params = {
                "mineq-date": start_date,
                "maxeq-date": end_date,
                "_sorted": "",
                "_limit": "10000",
            }
            try:
                readings_data = await self._get_json(
                    session, readings_url, params=readings_params,
                    rate_limiter=self._ea_limiter,
                )
            except Exception as exc:
                logger.warning(
                    "EA readings fetch failed for measure {}: {}", measure_id, exc
                )
                continue

            for reading in readings_data.get("items", []):
                dt_str = reading.get("dateTime")
                value = reading.get("value")
                if dt_str is None or value is None:
                    continue
                try:
                    value = float(value)
                except (TypeError, ValueError):
                    continue

                row: dict[str, Any] = {
                    "timestamp": pd.to_datetime(dt_str, utc=True),
                    "station_id": station_id,
                    "level_m": value if "level" in parameter else None,
                    "flow_m3s": value if "flow" in parameter else None,
                }
                rows.append(row)

        if not rows:
            logger.warning(
                "EA returned no readings for station {} ({} - {})",
                station_id, start_date, end_date,
            )
            return pd.DataFrame(
                columns=["timestamp", "station_id", "level_m", "flow_m3s"]
            )

        df = pd.DataFrame(rows)
        # Merge level and flow readings that share a timestamp
        if len(df) > 1:
            df = (
                df.groupby(["timestamp", "station_id"], as_index=False)
                .agg({"level_m": "first", "flow_m3s": "first"})
            )
        return df

    # Flood events

    async def get_flood_events(
        self, start_date: str, end_date: str
    ) -> pd.DataFrame:
        """Historical flood events from SEPA flood data and EA recorded flood outlines.

        Returns columns:
            event_id, start_date, end_date, latitude, longitude,
            severity, source, affected_area_km2
        """
        cache_key = self._cache_key("flood_events", start_date, end_date)

        async def _fetch() -> pd.DataFrame:
            frames: list[pd.DataFrame] = []

            async with aiohttp.ClientSession() as session:
                # SEPA Flood Data
                try:
                    sepa_df = await self._fetch_sepa_flood_events(
                        session, start_date, end_date
                    )
                    if not sepa_df.empty:
                        frames.append(sepa_df)
                except Exception as exc:
                    logger.warning("SEPA flood-event fetch failed: {}", exc)

                # EA Recorded Flood Outlines
                try:
                    ea_df = await self._fetch_ea_flood_outlines(
                        session, start_date, end_date
                    )
                    if not ea_df.empty:
                        frames.append(ea_df)
                except Exception as exc:
                    logger.warning("EA flood-outline fetch failed: {}", exc)

            if not frames:
                logger.warning(
                    "No flood events returned for {} to {}", start_date, end_date
                )
                return pd.DataFrame(
                    columns=[
                        "event_id", "start_date", "end_date", "latitude",
                        "longitude", "severity", "source", "affected_area_km2",
                    ]
                )
            return pd.concat(frames, ignore_index=True)

        return await self._fetch_or_cache("flood_events", cache_key, _fetch)

    async def _fetch_sepa_flood_events(
        self,
        session: aiohttp.ClientSession,
        start_date: str,
        end_date: str,
    ) -> pd.DataFrame:
        """Attempt to fetch SEPA flood data from their public endpoint.

        SEPA publishes flood event data as JSON at /api/flooding/.
        If the direct endpoint is unavailable, falls back to the station
        alerts approach.
        """
        # Try the SEPA floodData API (undocumented JSON endpoint)
        url = f"{SEPA_FLOOD_DATA_BASE}/api/flooding/"
        try:
            data = await self._get_json(
                session, url, rate_limiter=self._sepa_limiter,
            )
        except Exception:
            # Fallback: query SEPA flood warnings
            url_fallback = f"{SEPA_FLOOD_DATA_BASE}/api/floodwarnings/"
            try:
                data = await self._get_json(
                    session, url_fallback, rate_limiter=self._sepa_limiter,
                )
            except Exception as inner_exc:
                logger.warning(
                    "Both SEPA flood endpoints unavailable: {}", inner_exc
                )
                return pd.DataFrame()

        records = data if isinstance(data, list) else data.get("items", data.get("features", []))

        rows: list[dict[str, Any]] = []
        for i, record in enumerate(records):
            props = record.get("properties", record) if isinstance(record, dict) else {}
            raw_start = props.get("start_date") or props.get("issuedDate") or props.get("date") or start_date
            raw_end = props.get("end_date") or props.get("expiryDate") or end_date
            lat = props.get("latitude") or props.get("lat")
            lon = props.get("longitude") or props.get("lon") or props.get("long")

            # Extract from geometry if present
            geom = record.get("geometry", {}) if isinstance(record, dict) else {}
            if lat is None and geom.get("coordinates"):
                coords = geom["coordinates"]
                if isinstance(coords[0], (int, float)):
                    lon, lat = coords[0], coords[1]
                elif isinstance(coords[0], list) and isinstance(coords[0][0], (int, float)):
                    lon, lat = coords[0][0], coords[0][1]

            if lat is None or lon is None:
                continue

            severity_raw = (
                props.get("severity")
                or props.get("severityLevel")
                or props.get("severity_level")
                or "unknown"
            )
            rows.append(
                {
                    "event_id": props.get("id", f"sepa-flood-{i}"),
                    "start_date": str(raw_start),
                    "end_date": str(raw_end),
                    "latitude": float(lat),
                    "longitude": float(lon),
                    "severity": str(severity_raw),
                    "source": "SEPA",
                    "affected_area_km2": float(props.get("area_km2", 0.0)),
                }
            )

        return pd.DataFrame(rows) if rows else pd.DataFrame()

    async def _fetch_ea_flood_outlines(
        self,
        session: aiohttp.ClientSession,
        start_date: str,
        end_date: str,
    ) -> pd.DataFrame:
        """Fetch EA recorded-flood-outlines via the flood-monitoring API.

        Falls back to the flood-monitoring /id/floods endpoint with
        date filtering for recent events.
        """
        url = f"{EA_FLOOD_MONITORING_BASE}/id/floods"
        params: dict[str, str] = {
            "min-severity": "1",
            "_limit": "500",
        }
        data = await self._get_json(
            session, url, params=params, rate_limiter=self._ea_limiter,
        )

        items = data.get("items", [])
        rows: list[dict[str, Any]] = []

        for i, item in enumerate(items):
            area = item.get("floodArea", {})
            lat = area.get("lat")
            lon = area.get("long")
            if lat is None or lon is None:
                continue

            severity_raw = item.get("severityLevel", item.get("severity", "unknown"))
            if isinstance(severity_raw, dict):
                severity_raw = severity_raw.get("label", "unknown")

            time_raised = item.get("timeRaised", start_date)
            time_severity_changed = item.get("timeSeverityChanged", end_date)

            rows.append(
                {
                    "event_id": item.get("floodAreaID", f"ea-flood-{i}"),
                    "start_date": str(time_raised),
                    "end_date": str(time_severity_changed),
                    "latitude": float(lat),
                    "longitude": float(lon),
                    "severity": str(severity_raw),
                    "source": "EA",
                    "affected_area_km2": float(area.get("area_km2", 0.0)),
                }
            )

        return pd.DataFrame(rows) if rows else pd.DataFrame()

    # Rainfall

    async def get_rainfall(
        self, station_ids: list[str], start_date: str, end_date: str
    ) -> pd.DataFrame:
        """Rainfall data from SEPA rainfall API and EA flood-monitoring.

        Returns columns: timestamp, station_id, rainfall_mm
        """
        cache_key = self._cache_key(
            "rainfall", ",".join(sorted(station_ids)), start_date, end_date
        )

        async def _fetch() -> pd.DataFrame:
            frames: list[pd.DataFrame] = []

            async with aiohttp.ClientSession() as session:
                sepa_ids = [s for s in station_ids if not s.startswith("E")]
                ea_ids = [s for s in station_ids if s.startswith("E")]

                for sid in sepa_ids:
                    try:
                        df = await self._fetch_sepa_rainfall(
                            session, sid, start_date, end_date
                        )
                        if not df.empty:
                            frames.append(df)
                    except Exception as exc:
                        logger.warning(
                            "SEPA rainfall fetch failed for station {}: {}", sid, exc
                        )

                for sid in ea_ids:
                    try:
                        df = await self._fetch_ea_rainfall(
                            session, sid, start_date, end_date
                        )
                        if not df.empty:
                            frames.append(df)
                    except Exception as exc:
                        logger.warning(
                            "EA rainfall fetch failed for station {}: {}", sid, exc
                        )

            if not frames:
                logger.warning(
                    "No rainfall data returned for stations {} ({} - {})",
                    station_ids, start_date, end_date,
                )
                return pd.DataFrame(
                    columns=["timestamp", "station_id", "rainfall_mm"]
                )
            return pd.concat(frames, ignore_index=True)

        return await self._fetch_or_cache("rainfall", cache_key, _fetch)

    async def _fetch_sepa_rainfall(
        self,
        session: aiohttp.ClientSession,
        station_id: str,
        start_date: str,
        end_date: str,
    ) -> pd.DataFrame:
        """Fetch hourly rainfall from SEPA Rainfall API."""
        # SEPA rainfall API: /api/Hourly/{station_id}?all=true
        # or with date range: /api/Hourly/{station_id}?start={}&end={}
        url = f"{SEPA_RAINFALL_BASE}/Hourly/{station_id}"
        params = {
            "start": start_date,
            "end": end_date,
        }

        try:
            data = await self._get_json(
                session, url, params=params, rate_limiter=self._sepa_limiter,
            )
        except aiohttp.ClientResponseError:
            # Try daily endpoint as fallback
            url = f"{SEPA_RAINFALL_BASE}/Daily/{station_id}"
            data = await self._get_json(
                session, url, params=params, rate_limiter=self._sepa_limiter,
            )

        records = data if isinstance(data, list) else data.get("items", [])
        rows: list[dict[str, Any]] = []
        for rec in records:
            ts_raw = rec.get("Timestamp") or rec.get("timestamp") or rec.get("dateTime")
            value = rec.get("Value") or rec.get("value") or rec.get("rainfall")
            if ts_raw is None or value is None:
                continue
            try:
                rows.append(
                    {
                        "timestamp": pd.to_datetime(ts_raw, utc=True),
                        "station_id": station_id,
                        "rainfall_mm": float(value),
                    }
                )
            except (TypeError, ValueError):
                continue

        if not rows:
            logger.warning(
                "SEPA rainfall returned no data for station {} ({} - {})",
                station_id, start_date, end_date,
            )
        return pd.DataFrame(rows) if rows else pd.DataFrame(
            columns=["timestamp", "station_id", "rainfall_mm"]
        )

    async def _fetch_ea_rainfall(
        self,
        session: aiohttp.ClientSession,
        station_id: str,
        start_date: str,
        end_date: str,
    ) -> pd.DataFrame:
        """Fetch rainfall readings from EA flood-monitoring API."""
        url = f"{EA_FLOOD_MONITORING_BASE}/id/stations/{station_id}/readings"
        params = {
            "parameter": "rainfall",
            "mineq-date": start_date,
            "maxeq-date": end_date,
            "_sorted": "",
            "_limit": "10000",
        }
        data = await self._get_json(
            session, url, params=params, rate_limiter=self._ea_limiter,
        )

        items = data.get("items", [])
        rows: list[dict[str, Any]] = []
        for reading in items:
            dt_str = reading.get("dateTime")
            value = reading.get("value")
            if dt_str is None or value is None:
                continue
            try:
                rows.append(
                    {
                        "timestamp": pd.to_datetime(dt_str, utc=True),
                        "station_id": station_id,
                        "rainfall_mm": float(value),
                    }
                )
            except (TypeError, ValueError):
                continue

        if not rows:
            logger.warning(
                "EA rainfall returned no data for station {} ({} - {})",
                station_id, start_date, end_date,
            )
        return pd.DataFrame(rows) if rows else pd.DataFrame(
            columns=["timestamp", "station_id", "rainfall_mm"]
        )

    # Station metadata

    async def get_station_metadata(self) -> pd.DataFrame:
        """Station catalogue combining DEFAULT_STATIONS with live SEPA/EA lookups.

        Returns columns:
            station_id, station_name, latitude, longitude, river_name,
            catchment_area_km2, station_type, elevation_m
        """
        cache_key = self._cache_key("station_metadata", "all")

        async def _fetch() -> pd.DataFrame:
            rows: list[dict[str, Any]] = []

            # Populate from the built-in DEFAULT_STATIONS dict
            for sid, meta in DEFAULT_STATIONS.items():
                rows.append(
                    {
                        "station_id": sid,
                        "station_name": meta["name"],
                        "latitude": meta["lat"],
                        "longitude": meta["lon"],
                        "river_name": meta["river"],
                        "catchment_area_km2": meta["catchment_km2"],
                        "station_type": meta["type"],
                        "elevation_m": meta["elevation_m"],
                    }
                )

            # Augment with live SEPA station list
            try:
                async with aiohttp.ClientSession() as session:
                    params = {
                        "service": "kisters",
                        "type": "queryServices",
                        "request": "getStationList",
                        "datasource": "0",
                        "format": "json",
                        "returnfields": (
                            "station_no,station_name,station_latitude,"
                            "station_longitude,river_name,catchment_size,"
                            "station_elevation"
                        ),
                    }
                    data = await self._get_json(
                        session, SEPA_KIWIS_BASE, params=params,
                        rate_limiter=self._sepa_limiter,
                    )
                    # KiWIS returns list-of-lists with headers as first row
                    if isinstance(data, list) and len(data) > 1:
                        headers = data[0] if isinstance(data[0], list) else []
                        for record in data[1:]:
                            if not isinstance(record, list) or len(record) < 5:
                                continue
                            sid_raw = str(record[0])
                            if sid_raw in {r["station_id"] for r in rows}:
                                continue
                            try:
                                rows.append(
                                    {
                                        "station_id": sid_raw,
                                        "station_name": str(record[1]) if len(record) > 1 else sid_raw,
                                        "latitude": float(record[2]) if len(record) > 2 and record[2] else 0.0,
                                        "longitude": float(record[3]) if len(record) > 3 and record[3] else 0.0,
                                        "river_name": str(record[4]) if len(record) > 4 and record[4] else "",
                                        "catchment_area_km2": (
                                            float(record[5]) if len(record) > 5 and record[5] else 0.0
                                        ),
                                        "station_type": "level",
                                        "elevation_m": (
                                            float(record[6]) if len(record) > 6 and record[6] else 0.0
                                        ),
                                    }
                                )
                            except (ValueError, TypeError):
                                continue
            except Exception as exc:
                logger.warning("Live SEPA station-list fetch failed: {}", exc)

            # Augment with live EA station list
            try:
                async with aiohttp.ClientSession() as session:
                    url = f"{EA_FLOOD_MONITORING_BASE}/id/stations"
                    params_ea = {"_limit": "500", "type": "Level"}
                    data = await self._get_json(
                        session, url, params=params_ea,
                        rate_limiter=self._ea_limiter,
                    )
                    existing_ids = {r["station_id"] for r in rows}
                    for station in data.get("items", []):
                        sid_raw = station.get("stationReference")
                        if not sid_raw or sid_raw in existing_ids:
                            continue
                        lat = station.get("lat")
                        lon = station.get("long")
                        if lat is None or lon is None:
                            continue
                        rows.append(
                            {
                                "station_id": str(sid_raw),
                                "station_name": str(
                                    station.get("label", station.get("name", sid_raw))
                                ),
                                "latitude": float(lat),
                                "longitude": float(lon),
                                "river_name": str(station.get("riverName", "")),
                                "catchment_area_km2": float(
                                    station.get("catchmentArea", 0.0) or 0.0
                                ),
                                "station_type": "level",
                                "elevation_m": 0.0,
                            }
                        )
            except Exception as exc:
                logger.warning("Live EA station-list fetch failed: {}", exc)

            if not rows:
                logger.warning("Station metadata: no stations available at all")
                return pd.DataFrame(
                    columns=[
                        "station_id", "station_name", "latitude", "longitude",
                        "river_name", "catchment_area_km2", "station_type",
                        "elevation_m",
                    ]
                )

            return pd.DataFrame(rows)

        return await self._fetch_or_cache("station_metadata", cache_key, _fetch)

    # Air quality

    async def get_air_quality(
        self, lat: float, lon: float, start_date: str, end_date: str
    ) -> pd.DataFrame:
        """Air-quality observations from DEFRA UK-AIR / Open-Meteo AQ API.

        Returns columns: timestamp, pm2_5, pm10, no2, o3, so2, aqi

        Primary source: DEFRA UK-AIR site-specific data feed.
        Fallback: Open-Meteo Air Quality API (free, no key required).
        """
        cache_key = self._cache_key("air_quality", str(lat), str(lon), start_date, end_date)

        async def _fetch() -> pd.DataFrame:
            # Try DEFRA UK-AIR first
            try:
                df = await self._fetch_defra_air_quality(lat, lon, start_date, end_date)
                if not df.empty:
                    return df
            except Exception as exc:
                logger.warning("DEFRA air-quality fetch failed: {}", exc)

            # Fallback: Open-Meteo Air Quality API
            return await self._fetch_open_meteo_air_quality(lat, lon, start_date, end_date)

        return await self._fetch_or_cache("air_quality", cache_key, _fetch)

    async def _fetch_defra_air_quality(
        self,
        lat: float,
        lon: float,
        start_date: str,
        end_date: str,
    ) -> pd.DataFrame:
        """Try to fetch air quality from DEFRA UK-AIR data feeds.

        DEFRA publishes hourly AQ data via their data selector.  The API
        is CSV-based and requires a specific site code.  We find the
        nearest site and download its hourly feed.
        """
        async with aiohttp.ClientSession() as session:
            # Get list of monitoring sites
            sites_url = f"{DEFRA_AQ_BASE}/networks/site-info"
            params = {"format": "json"}
            try:
                data = await self._get_json(
                    session, sites_url, params=params,
                    rate_limiter=self._defra_limiter,
                )
            except Exception:
                # DEFRA site listing may not have JSON; fallback immediately
                return pd.DataFrame()

            # Find nearest site by Euclidean distance (good enough for UK scale)
            sites = data if isinstance(data, list) else data.get("items", data.get("sites", []))
            best_site = None
            best_dist = float("inf")
            for site in sites:
                s_lat = site.get("latitude") or site.get("lat")
                s_lon = site.get("longitude") or site.get("lon") or site.get("long")
                if s_lat is None or s_lon is None:
                    continue
                dist = (float(s_lat) - lat) ** 2 + (float(s_lon) - lon) ** 2
                if dist < best_dist:
                    best_dist = dist
                    best_site = site

            if best_site is None:
                return pd.DataFrame()

            site_code = best_site.get("site_id") or best_site.get("code") or best_site.get("id")
            if not site_code:
                return pd.DataFrame()

            # Fetch hourly data for the site
            data_url = f"{DEFRA_AQ_BASE}/data/site/{site_code}"
            data_params = {
                "start": start_date,
                "end": end_date,
                "format": "json",
            }
            try:
                aq_data = await self._get_json(
                    session, data_url, params=data_params,
                    rate_limiter=self._defra_limiter,
                )
            except Exception:
                return pd.DataFrame()

            records = aq_data if isinstance(aq_data, list) else aq_data.get("items", [])
            rows: list[dict[str, Any]] = []
            for rec in records:
                ts = rec.get("timestamp") or rec.get("dateTime") or rec.get("date")
                if ts is None:
                    continue
                rows.append(
                    {
                        "timestamp": pd.to_datetime(ts, utc=True),
                        "pm2_5": _safe_float(rec.get("pm2_5") or rec.get("PM2.5")),
                        "pm10": _safe_float(rec.get("pm10") or rec.get("PM10")),
                        "no2": _safe_float(rec.get("no2") or rec.get("NO2")),
                        "o3": _safe_float(rec.get("o3") or rec.get("O3")),
                        "so2": _safe_float(rec.get("so2") or rec.get("SO2")),
                        "aqi": _safe_float(rec.get("aqi") or rec.get("AQI") or rec.get("daqi")),
                    }
                )

            return pd.DataFrame(rows) if rows else pd.DataFrame()

    async def _fetch_open_meteo_air_quality(
        self,
        lat: float,
        lon: float,
        start_date: str,
        end_date: str,
    ) -> pd.DataFrame:
        """Fallback: Open-Meteo Air Quality API (free, no key)."""
        url = "https://air-quality-api.open-meteo.com/v1/air-quality"
        params = {
            "latitude": str(lat),
            "longitude": str(lon),
            "start_date": start_date,
            "end_date": end_date,
            "hourly": "pm2_5,pm10,nitrogen_dioxide,ozone,sulphur_dioxide,european_aqi",
            "timezone": "UTC",
        }
        async with aiohttp.ClientSession() as session:
            data = await self._get_json(session, url, params=params)

        hourly = data.get("hourly", {})
        times = hourly.get("time", [])
        if not times:
            logger.warning(
                "Open-Meteo AQ returned no data for ({}, {}) {} to {}",
                lat, lon, start_date, end_date,
            )
            return pd.DataFrame(
                columns=["timestamp", "pm2_5", "pm10", "no2", "o3", "so2", "aqi"]
            )

        n = len(times)
        df = pd.DataFrame(
            {
                "timestamp": pd.to_datetime(times, utc=True),
                "pm2_5": hourly.get("pm2_5", [None] * n),
                "pm10": hourly.get("pm10", [None] * n),
                "no2": hourly.get("nitrogen_dioxide", [None] * n),
                "o3": hourly.get("ozone", [None] * n),
                "so2": hourly.get("sulphur_dioxide", [None] * n),
                "aqi": hourly.get("european_aqi", [None] * n),
            }
        )
        return df

# Helpers

def _safe_float(val: Any) -> Optional[float]:
    """Convert a value to float, returning None on failure."""
    if val is None:
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None
