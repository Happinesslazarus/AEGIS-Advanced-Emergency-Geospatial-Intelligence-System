"""
Open-Meteo Historical Weather Data Fetcher.

Free, global, no API key required.
Docs: https://open-meteo.com/en/docs/historical-weather-api

Returns hourly data as a pandas DataFrame for any lat/lon and date range.
"""

from __future__ import annotations

import time
from datetime import date
from typing import Dict, List, Optional

import numpy as np
import pandas as pd
import requests
from loguru import logger

OPEN_METEO_ARCHIVE = "https://archive-api.open-meteo.com/v1/archive"

# Map of Open-Meteo hourly variable names
DEFAULT_HOURLY_VARS = [
    "temperature_2m",
    "relative_humidity_2m",
    "wind_speed_10m",
    "wind_gusts_10m",
    "precipitation",
    "pressure_msl",
    "surface_pressure",
    "cloud_cover",
    "soil_moisture_0_to_7cm",
    "et0_fao_evapotranspiration",
]

def fetch_open_meteo_history(
    latitude: float,
    longitude: float,
    start_date: str,
    end_date: str,
    hourly_vars: Optional[List[str]] = None,
    retry: int = 3,
) -> pd.DataFrame:
    """
    Fetch hourly historical weather from Open-Meteo Archive API.

    Returns a DataFrame indexed by datetime with one column per variable.
    Raises RuntimeError on sustained API failure.
    """
    hourly = hourly_vars or DEFAULT_HOURLY_VARS

    params = {
        "latitude": latitude,
        "longitude": longitude,
        "start_date": start_date,
        "end_date": end_date,
        "hourly": ",".join(hourly),
        "timezone": "UTC",
    }

    for attempt in range(1, retry + 1):
        try:
            resp = requests.get(OPEN_METEO_ARCHIVE, params=params, timeout=60)
            resp.raise_for_status()
            data = resp.json()
            if "hourly" not in data:
                raise ValueError(f"No hourly data in response: {list(data.keys())}")

            hourly_data = data["hourly"]
            df = pd.DataFrame(hourly_data)
            df["time"] = pd.to_datetime(df["time"])
            df.set_index("time", inplace=True)
            df.sort_index(inplace=True)
            logger.info(
                f"Open-Meteo: fetched {len(df)} hours for ({latitude}, {longitude}) "
                f"{start_date}→{end_date}"
            )
            return df
        except Exception as exc:
            logger.warning(f"Open-Meteo attempt {attempt}/{retry} failed: {exc}")
            if attempt < retry:
                time.sleep(2 ** attempt)

    raise RuntimeError(
        f"Open-Meteo fetch failed after {retry} attempts "
        f"for ({latitude}, {longitude}) {start_date}→{end_date}"
    )

def fetch_grid_sample(
    bbox: tuple[float, float, float, float],
    start_date: str,
    end_date: str,
    n_points: int = 20,
    hourly_vars: Optional[List[str]] = None,
    seed: int = 42,
) -> pd.DataFrame:
    """
    Sample n_points random locations within bbox and fetch weather for each.
    Returns a combined DataFrame with a 'location_id' column.
    """
    rng = np.random.RandomState(seed)
    lat_min, lon_min, lat_max, lon_max = bbox
    lats = rng.uniform(lat_min, lat_max, n_points)
    lons = rng.uniform(lon_min, lon_max, n_points)

    frames: List[pd.DataFrame] = []
    for i, (lat, lon) in enumerate(zip(lats, lons)):
        try:
            df = fetch_open_meteo_history(
                round(float(lat), 4),
                round(float(lon), 4),
                start_date,
                end_date,
                hourly_vars,
            )
            df["location_id"] = i
            df["latitude"] = round(float(lat), 4)
            df["longitude"] = round(float(lon), 4)
            frames.append(df)
            # Respect rate limit
            time.sleep(0.5)
        except RuntimeError:
            logger.warning(f"Skipping point ({lat:.4f}, {lon:.4f})")
            continue

    if not frames:
        raise RuntimeError("Could not fetch data for any grid point")

    combined = pd.concat(frames)
    logger.info(f"Grid sample: {len(frames)} locations, {len(combined)} total rows")
    return combined
