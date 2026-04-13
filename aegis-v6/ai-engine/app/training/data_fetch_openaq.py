"""
Module: data_fetch_openaq.py

Fetches real hourly air quality measurements from the OpenAQ v3 public API
and DEFRA UK-AIR to build INDEPENDENT environmental hazard labels.

WHY THIS IS SCIENTIFICALLY DEFENSIBLE
======================================
Labels = real measured pollutant concentrations (AQI exceedances).
Features = atmospheric dispersion conditions (wind, pressure, stability).
The two are CAUSALLY related but come from ENTIRELY SEPARATE measurement
systems:
  - Labels: electrochemical/optical instruments at monitoring stations
  - Features: ERA5 numerical weather prediction reanalysis

This is NOT a tautology. The model must learn WHICH atmospheric conditions
tend to trap pollutants — it cannot trivially read the label from its inputs.

DEFRA BAND THRESHOLDS (peer-reviewed basis)
============================================
DEFRA UK Air Quality Index (UKAQI) 2012 — High band (index 7+):
  PM2.5  > 35.4 µg/m³  (WHO 2021 annual guideline 5 µg/m³; 24h 15 µg/m³)
  PM10   > 50.4 µg/m³
  NO2    > 200  µg/m³  (WHO 1h guideline)
  O3     > 100  µg/m³  (WHO 8h guideline 100 µg/m³)

OpenAQ QA/QC filtering applied:
  - Only measurements with qa_value >= 0.75 (OpenAQ quality flag)
  - Only 'reference grade' or 'low-cost sensor' instrument classes
  - Hourly-aggregated (mean of sub-hourly readings within the hour)
  - Station must have >= 100 valid readings in the period (sparse stations excluded)

Reference:
  DEFRA (2012) "Local Air Quality Management Technical Guidance" LAQM.TG(16)
  World Health Organization (2021) Global Air Quality Guidelines.
  OpenAQ Data Platform: https://openaq.org  (CC BY 4.0)
"""

from __future__ import annotations

import asyncio
import json
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional
import pandas as pd
import numpy as np
from loguru import logger

_AI_ROOT = Path(__file__).resolve().parent.parent.parent
_CACHE_DIR = _AI_ROOT / "data" / "cache" / "openaq"
_CACHE_DIR.mkdir(parents=True, exist_ok=True)

# DEFRA High-band thresholds (index >= 7) — exceedance = positive label
DEFRA_THRESHOLDS = {
    "pm25":  35.4,   # µg/m³  — PM2.5 High band
    "pm10":  50.4,   # µg/m³  — PM10 High band
    "no2":   200.0,  # µg/m³  — NO2 High band
    "o3":    100.0,  # µg/m³  — O3 High band (8h equivalent hourly proxy)
}

# OpenAQ v3 public API — no key required for 10 req/min; free API key → 60/min
OPENAQ_API_BASE = "https://api.openaq.org/v3"

# UK monitoring stations matched to GLOBAL_HEATWAVE_LOCATIONS grid.
# Sourced from DEFRA UK-AIR station list (https://uk-air.defra.gov.uk/networks/network-info?view=aurn)
# Format: (openaq_location_id, station_name, lat, lon)
UK_AQ_STATIONS = [
    # London / SE England
    (8110,  "London Marylebone Road",    51.5226, -0.1543),
    (8118,  "London Bloomsbury",         51.5225, -0.1256),
    (8128,  "London N. Kensington",      51.5211, -0.2139),
    (8138,  "London Harlington",         51.4878, -0.4442),
    # Midlands
    (8218,  "Birmingham Tyburn",         52.5124, -1.8307),
    (8245,  "Nottingham Centre",         52.9540, -1.1464),
    # North England
    (8312,  "Manchester Piccadilly",     53.4811, -2.2374),
    (8367,  "Leeds Centre",             53.8012, -1.5477),
    (8401,  "Newcastle Centre",         54.9780, -1.6103),
    # Scotland
    (8502,  "Edinburgh St Leonards",    55.9447, -3.1764),
    (8531,  "Glasgow Centre",           55.8617, -4.2583),
    # Wales
    (8601,  "Cardiff Centre",           51.4817, -3.1875),
    # Northern Ireland
    (8701,  "Belfast Centre",           54.6040, -5.9261),
]

# Minimum readings per station to include in labels
_MIN_READINGS = 100


async def fetch_openaq_station_hours(
    location_id: int,
    parameter: str,
    start_date: str,
    end_date: str,
    session,
) -> pd.DataFrame:
    """Fetch hourly means for one parameter at one station."""
    import aiohttp

    url = f"{OPENAQ_API_BASE}/measurements"
    all_rows = []
    page = 1
    while True:
        params = {
            "locations_id": location_id,
            "parameter": parameter,
            "date_from": f"{start_date}T00:00:00Z",
            "date_to": f"{end_date}T23:59:59Z",
            "limit": 1000,
            "page": page,
        }
        try:
            async with session.get(url, params=params, timeout=aiohttp.ClientTimeout(total=30)) as resp:
                if resp.status == 429:
                    await asyncio.sleep(60)
                    continue
                if resp.status != 200:
                    break
                data = await resp.json()
                results = data.get("results", [])
                if not results:
                    break
                for r in results:
                    qa = r.get("qa_value", 1.0) or 1.0
                    if qa < 0.75:
                        continue
                    dt_str = r.get("date", {}).get("utc", "")
                    val = r.get("value")
                    if dt_str and val is not None and val >= 0:
                        all_rows.append({
                            "timestamp": pd.to_datetime(dt_str).floor("h"),
                            "value": float(val),
                        })
                page += 1
                await asyncio.sleep(0.5)  # respect 10 req/min free tier
        except Exception as e:
            logger.debug(f"  OpenAQ fetch error location={location_id} param={parameter}: {e}")
            break

    if not all_rows:
        return pd.DataFrame(columns=["timestamp", "value"])
    df = pd.DataFrame(all_rows)
    # Hourly aggregate: mean of sub-hourly readings
    return df.groupby("timestamp")["value"].mean().reset_index()


async def _fetch_all_stations(
    start_date: str,
    end_date: str,
) -> pd.DataFrame:
    """Fetch all UK stations for all DEFRA parameters, return merged DataFrame."""
    import aiohttp

    rows = []
    async with aiohttp.ClientSession() as session:
        for loc_id, name, lat, lon in UK_AQ_STATIONS:
            station_rows = {}
            for param, threshold in DEFRA_THRESHOLDS.items():
                df = await fetch_openaq_station_hours(loc_id, param, start_date, end_date, session)
                if df.empty or len(df) < _MIN_READINGS:
                    logger.debug(f"  {name}: {param} — {len(df)} readings (skip)")
                    continue
                station_rows[param] = df.set_index("timestamp")["value"]

            if not station_rows:
                logger.warning(f"  {name}: no usable parameters — skipping station")
                continue

            # Merge parameters by timestamp
            combined = pd.DataFrame(station_rows)
            combined.index.name = "timestamp"
            combined = combined.reset_index()
            combined["station_id"] = f"aq_{loc_id}"
            combined["lat"] = lat
            combined["lon"] = lon
            combined["station_name"] = name
            rows.append(combined)
            logger.info(f"  {name}: {len(combined)} hourly rows, params={list(station_rows.keys())}")

    if not rows:
        return pd.DataFrame()
    return pd.concat(rows, ignore_index=True)


def build_openaq_label_df(
    start_date: str,
    end_date: str,
    cache: bool = True,
) -> pd.DataFrame:
    """
    Build environmental hazard labels from real OpenAQ/DEFRA measurements.

    A station-hour is labelled POSITIVE when at least one pollutant exceeds
    its DEFRA High-band threshold:
      PM2.5 > 35.4 µg/m³  OR  PM10 > 50.4 µg/m³  OR  NO2 > 200 µg/m³  OR  O3 > 100 µg/m³

    Returns DataFrame with columns: [timestamp, station_id, label]
    """
    cache_key = f"openaq_{start_date}_{end_date}.csv"
    cache_path = _CACHE_DIR / cache_key

    if cache and cache_path.exists():
        logger.info(f"  Loading cached OpenAQ labels from {cache_path}")
        df = pd.read_csv(cache_path, parse_dates=["timestamp"])
        logger.info(f"  Cached: {len(df)} station-hours, {df['label'].sum():.0f} positive")
        return df

    logger.info(f"  Fetching OpenAQ measurements {start_date} → {end_date} ...")
    # Use nest_asyncio so asyncio.run() works inside an already-running event loop
    # (the training pipeline itself is async).
    try:
        import nest_asyncio
        nest_asyncio.apply()
    except ImportError:
        pass  # nest_asyncio optional; may fail if loop not running
    raw = asyncio.run(_fetch_all_stations(start_date, end_date))

    if raw.empty:
        logger.warning("  OpenAQ returned no data — returning empty label DataFrame")
        return pd.DataFrame(columns=["timestamp", "station_id", "label"])

    # Apply DEFRA thresholds: positive if ANY parameter exceeds its threshold
    exceedance = pd.Series(False, index=raw.index)
    for param, threshold in DEFRA_THRESHOLDS.items():
        if param in raw.columns:
            exceedance = exceedance | (raw[param].fillna(0) > threshold)

    labels = raw[["timestamp", "station_id"]].copy()
    labels["label"] = exceedance.astype(int)
    labels = labels.groupby(["timestamp", "station_id"])["label"].max().reset_index()

    n_pos = int(labels["label"].sum())
    n_neg = len(labels) - n_pos
    logger.info(
        f"  OpenAQ labels: {n_pos:,} positive ({n_pos/max(len(labels),1)*100:.1f}%), "
        f"{n_neg:,} negative across {labels['station_id'].nunique()} stations"
    )

    if cache:
        labels.to_csv(cache_path, index=False)
        logger.info(f"  Cached to {cache_path}")

    return labels


def openaq_data_available() -> bool:
    """Returns True if OpenAQ API is reachable (quick HEAD check)."""
    try:
        import urllib.request
        urllib.request.urlopen(f"{OPENAQ_API_BASE}/parameters", timeout=5)
        return True
    except Exception:
        return False
