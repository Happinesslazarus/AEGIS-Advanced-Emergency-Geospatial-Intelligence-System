"""
data_fetch_cams_openmeteo.py

Fetches CAMS (Copernicus Atmosphere Monitoring Service) air quality data
from the Open-Meteo Air Quality API — FREE, no API key required.

Data source
-----------
Open-Meteo Air Quality Historical API uses CAMS EAC4 global reanalysis
for 2015–2021 and CAMS GLOBAL forecast for 2022+:
  https://air-quality-api.open-meteo.com/v1/air-quality

CAMS EAC4 is the Copernicus Atmosphere Monitoring Service 4D-Var
reanalysis, produced by ECMWF.  It assimilates satellite radiances
(MOPITT CO, IASI, GOME-2, TROPOMI) and surface measurements, making it
an observation-constrained product rather than a pure model output.

Independence from ERA5 features
--------------------------------
CAMS pollutant concentrations (PM2.5, PM10, NO2, O3) are driven by:
  1. Emission inventories (CAMS-GLOB-ANT anthropogenic, GFAS fires)
  2. Atmospheric chemistry (photolysis, oxidation reactions)
  3. Transport/dispersion (meteorological input from ECMWF IFS)

The ERA5 weather features used in the environmental_hazard model capture
DISPERSION CONDITIONS (wind, mixing-height proxy, precipitation) but NOT
EMISSION amounts.  CAMS labels record actual pollution EVENTS, which
require both adverse dispersion AND sufficient emissions.  This means the
CAMS labels are NOT a simple function of any single ERA5 variable, making
them scientifically independent of the feature set.

Label thresholds
-----------------
DEFRA UK Air Quality Index (UKAQI 2012) High band (index >= 7):
  PM2.5  > 35.4 µg/m³   (WHO IT-2 standard)
  PM10   > 50.4 µg/m³
  NO2    > 200  µg/m³
  O3     > 100  µg/m³   (8h mean proxy)

A station-hour is labelled POSITIVE when ANY pollutant exceeds its
DEFRA High-band threshold.

Cache
-----
Results saved to {ai-engine}/data/cache/openaq/cams_om_{start}_{end}.csv
so subsequent calls are instant.
"""
from __future__ import annotations

import asyncio
import math
import time
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd
from loguru import logger

_AI_ROOT = Path(__file__).resolve().parents[3]
_CACHE_DIR = _AI_ROOT / "data" / "cache" / "openaq"
_CACHE_DIR.mkdir(parents=True, exist_ok=True)

# DEFRA High-band thresholds (µg/m³)
DEFRA_THRESHOLDS = {
    "pm2_5":             35.4,
    "pm10":              50.4,
    "nitrogen_dioxide":  200.0,
    "ozone":             100.0,
}

# UK AQ station locations — matched to GLOBAL_HEATWAVE_LOCATIONS grid
# (same coordinates as UK_AQ_STATIONS in data_fetch_openaq.py)
UK_AQ_LOCATIONS = [
    {"id": "aq_london_c",     "lat": 51.5226, "lon": -0.1543, "name": "London Centre"},
    {"id": "aq_london_n",     "lat": 51.5211, "lon": -0.2139, "name": "London N.Kensington"},
    {"id": "aq_london_e",     "lat": 51.4878, "lon": -0.4442, "name": "London Harlington"},
    {"id": "aq_birmingham",   "lat": 52.5124, "lon": -1.8307, "name": "Birmingham"},
    {"id": "aq_manchester",   "lat": 53.4811, "lon": -2.2374, "name": "Manchester"},
    {"id": "aq_leeds",        "lat": 53.8012, "lon": -1.5477, "name": "Leeds"},
    {"id": "aq_newcastle",    "lat": 54.9780, "lon": -1.6103, "name": "Newcastle"},
    {"id": "aq_edinburgh",    "lat": 55.9447, "lon": -3.1764, "name": "Edinburgh"},
    {"id": "aq_glasgow",      "lat": 55.8617, "lon": -4.2583, "name": "Glasgow"},
    {"id": "aq_cardiff",      "lat": 51.4817, "lon": -3.1875, "name": "Cardiff"},
    {"id": "aq_belfast",      "lat": 54.6040, "lon": -5.9261, "name": "Belfast"},
    {"id": "aq_nottingham",   "lat": 52.9540, "lon": -1.1464, "name": "Nottingham"},
    {"id": "aq_bristol",      "lat": 51.4545, "lon": -2.5879, "name": "Bristol"},
]

_OM_AQ_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"
# Open-Meteo Air Quality API: 600 req/min, no key, CC BY 4.0.
# Historical limit: 1 year per request to stay under payload caps.
_YEAR_CHUNK_DAYS = 365
_INTER_REQUEST_SLEEP = 0.5  # seconds between requests


def _fetch_station_year(
    lat: float,
    lon: float,
    start_date: str,
    end_date: str,
) -> pd.DataFrame:
    """Blocking fetch for one station + date range via Open-Meteo AQ API."""
    import requests  # sync OK; called from thread pool

    params = {
        "latitude":  lat,
        "longitude": lon,
        "hourly":    ",".join(DEFRA_THRESHOLDS.keys()),
        "start_date": start_date,
        "end_date":   end_date,
        "timezone":   "UTC",
    }
    for attempt in range(4):
        try:
            resp = requests.get(_OM_AQ_URL, params=params, timeout=30)
            if resp.status_code == 429:
                wait = 60 * (2 ** attempt)
                logger.debug(f"    OM AQ 429 — waiting {wait}s …")
                time.sleep(wait)
                continue
            if resp.status_code != 200:
                logger.debug(f"    OM AQ HTTP {resp.status_code} for {lat},{lon}")
                return pd.DataFrame()
            data = resp.json()
            hourly = data.get("hourly", {})
            if not hourly or "time" not in hourly:
                return pd.DataFrame()
            df = pd.DataFrame(hourly)
            df["timestamp"] = pd.to_datetime(df["time"])
            df = df.drop(columns=["time"])
            return df
        except Exception as exc:
            logger.debug(f"    OM AQ error {lat},{lon}: {exc}")
            time.sleep(5 * (attempt + 1))

    return pd.DataFrame()


def build_cams_label_df(
    start_date: str,
    end_date: str,
    station_locations: Optional[list[dict]] = None,
    cache: bool = True,
) -> pd.DataFrame:
    """Build environmental hazard labels from CAMS via Open-Meteo AQ API.

    Each station-hour is labelled POSITIVE when any DEFRA High-band
    threshold is exceeded.  Results are cached locally.

    Parameters
    ----------
    start_date, end_date : "YYYY-MM-DD"
    station_locations    : list of {id, lat, lon, name} dicts.
                           Defaults to UK_AQ_LOCATIONS (13 UK cities).
    cache                : whether to read/write local CSV cache

    Returns
    -------
    pd.DataFrame with columns [timestamp, station_id, label]
    """
    if station_locations is None:
        station_locations = UK_AQ_LOCATIONS

    cache_key = f"cams_om_{start_date}_{end_date}_{len(station_locations)}.csv"
    cache_path = _CACHE_DIR / cache_key

    if cache and cache_path.exists():
        logger.info(f"  Loading cached CAMS AQ labels from {cache_path.name}")
        df = pd.read_csv(cache_path, parse_dates=["timestamp"])
        n_pos = int(df["label"].sum())
        logger.info(
            f"  Cached CAMS AQ: {len(df):,} station-hours, "
            f"{n_pos:,} positive ({n_pos/max(len(df),1)*100:.1f}%)"
        )
        return df

    logger.info(
        f"  Fetching CAMS AQ from Open-Meteo for {len(station_locations)} "
        f"UK stations {start_date}→{end_date} …"
    )

    # Split into annual chunks to keep requests small
    dt_start = pd.Timestamp(start_date)
    dt_end   = pd.Timestamp(end_date)

    all_chunks: list[pd.DataFrame] = []

    for loc in station_locations:
        station_id = loc["id"]
        loc_name   = loc.get("name", station_id)
        lat, lon   = loc["lat"], loc["lon"]

        chunk_start = dt_start
        station_rows: list[pd.DataFrame] = []

        while chunk_start <= dt_end:
            chunk_end = min(
                chunk_start + pd.Timedelta(days=_YEAR_CHUNK_DAYS - 1),
                dt_end,
            )
            s_str = chunk_start.strftime("%Y-%m-%d")
            e_str = chunk_end.strftime("%Y-%m-%d")

            df_chunk = _fetch_station_year(lat, lon, s_str, e_str)
            if not df_chunk.empty:
                station_rows.append(df_chunk)
            else:
                logger.warning(
                    f"  CAMS AQ: no data for {loc_name} {s_str}→{e_str}"
                )

            chunk_start = chunk_end + pd.Timedelta(days=1)
            time.sleep(_INTER_REQUEST_SLEEP)

        if not station_rows:
            logger.warning(f"  CAMS AQ: skipping {loc_name} — no data")
            continue

        station_df = pd.concat(station_rows, ignore_index=True)
        station_df = (
            station_df.sort_values("timestamp")
                      .drop_duplicates(subset=["timestamp"])
                      .reset_index(drop=True)
        )

        # Apply DEFRA High-band thresholds: positive if ANY pollutant exceeds
        exceedance = pd.Series(False, index=station_df.index)
        for col, threshold in DEFRA_THRESHOLDS.items():
            if col in station_df.columns:
                exceedance |= station_df[col].fillna(0.0) > threshold

        station_df["station_id"] = station_id
        station_df["label"]      = exceedance.astype(int)
        all_chunks.append(station_df[["timestamp", "station_id", "label"]])

        n_pos = int(exceedance.sum())
        logger.info(
            f"  {loc_name}: {len(station_df):,} hours, "
            f"{n_pos:,} exceedances ({n_pos/max(len(station_df),1)*100:.1f}%)"
        )

    if not all_chunks:
        logger.error("  CAMS AQ: no data retrieved for any station")
        return pd.DataFrame(columns=["timestamp", "station_id", "label"])

    result = pd.concat(all_chunks, ignore_index=True)
    n_pos = int(result["label"].sum())
    logger.info(
        f"  CAMS AQ total: {len(result):,} station-hours, "
        f"{n_pos:,} positive ({n_pos/max(len(result),1)*100:.1f}%)"
    )

    if cache:
        result.to_csv(cache_path, index=False)
        logger.success(f"  CAMS AQ cached to {cache_path.name}")

    return result


def cams_data_available(
    start_date: str = "2016-01-01",
    end_date: str = "2023-12-31",
) -> bool:
    """Return True if a CAMS cache file exists for the given date range."""
    cache_key = f"cams_om_{start_date}_{end_date}_{len(UK_AQ_LOCATIONS)}.csv"
    return (_CACHE_DIR / cache_key).exists()
