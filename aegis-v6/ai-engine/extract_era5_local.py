#!/usr/bin/env python3
"""
Local ERA5 extraction from NSF NCAR S3 (nsf-ncar-era5, anonymous/public).

Runs 4 parallel workers, each processing one calendar month at a time.
Extracts all AEGIS training locations in one pass per variable file.
Saves incremental per-month checkpoints so progress is not lost on failure.
At the end, generates per-hazard cache CSV files ready for training.

Runtime estimate: ~6-10 hours on a typical UK home connection.
"""

from __future__ import annotations
import asyncio, concurrent.futures, hashlib, os, sys, time, warnings
from pathlib import Path

import boto3, s3fs, xarray as xr
import pandas as pd
import numpy as np
from botocore import UNSIGNED
from botocore.config import Config

warnings.filterwarnings("ignore")

# Paths
HERE       = Path(__file__).resolve().parent
CACHE_DIR  = HERE / "data" / "cache" / "multi_location_weather"
CHECKPOINT_DIR = HERE / "data" / "cache" / "era5_checkpoints"
CACHE_DIR.mkdir(parents=True, exist_ok=True)
CHECKPOINT_DIR.mkdir(parents=True, exist_ok=True)

ERA5_BUCKET  = "nsf-ncar-era5"
START_YEAR   = 2016
END_YEAR     = 2023
N_WORKERS    = 4   # parallel variable-file reads per month

# Location sets -- copied from multi_location_weather.py
UK_GRID = [
    {"id": "london",      "lat": 51.51, "lon": -0.13, "region": "se_england"},
    {"id": "cambridge",   "lat": 52.21, "lon":  0.12, "region": "se_england"},
    {"id": "southampton", "lat": 50.91, "lon": -1.40, "region": "s_england"},
    {"id": "bristol",     "lat": 51.45, "lon": -2.58, "region": "sw_england"},
    {"id": "cardiff",     "lat": 51.48, "lon": -3.18, "region": "wales"},
    {"id": "birmingham",  "lat": 52.49, "lon": -1.90, "region": "midlands"},
    {"id": "manchester",  "lat": 53.48, "lon": -2.24, "region": "nw_england"},
    {"id": "york",        "lat": 53.96, "lon": -1.08, "region": "ne_england"},
    {"id": "newcastle",   "lat": 54.98, "lon": -1.62, "region": "ne_england"},
    {"id": "edinburgh",   "lat": 55.95, "lon": -3.19, "region": "scotland"},
    {"id": "glasgow",     "lat": 55.86, "lon": -4.25, "region": "scotland"},
    {"id": "aberdeen",    "lat": 57.15, "lon": -2.09, "region": "scotland"},
    {"id": "inverness",   "lat": 57.48, "lon": -4.22, "region": "scotland"},
]
HEATWAVE_EXTRA = [
    {"id": "paris",      "lat": 48.87, "lon":  2.35, "region": "france"},
    {"id": "marseille",  "lat": 43.30, "lon":  5.37, "region": "s_france"},
    {"id": "madrid",     "lat": 40.42, "lon": -3.70, "region": "spain"},
    {"id": "seville",    "lat": 37.39, "lon": -5.99, "region": "s_spain"},
    {"id": "barcelona",  "lat": 41.38, "lon":  2.18, "region": "ne_spain"},
    {"id": "lisbon",     "lat": 38.72, "lon": -9.14, "region": "portugal"},
    {"id": "rome",       "lat": 41.90, "lon": 12.50, "region": "c_italy"},
    {"id": "milan",      "lat": 45.47, "lon":  9.19, "region": "n_italy"},
    {"id": "athens",     "lat": 37.98, "lon": 23.73, "region": "greece"},
    {"id": "berlin",     "lat": 52.52, "lon": 13.40, "region": "germany"},
    {"id": "munich",     "lat": 48.14, "lon": 11.58, "region": "s_germany"},
    {"id": "amsterdam",  "lat": 52.37, "lon":  4.90, "region": "netherlands"},
    {"id": "ankara",     "lat": 39.93, "lon": 32.86, "region": "turkey"},
    {"id": "istanbul",   "lat": 41.01, "lon": 28.98, "region": "turkey_w"},
]
WILDFIRE_LOCS = [
    {"id": "madrid",        "lat": 40.42, "lon": -3.70, "region": "spain"},
    {"id": "seville",       "lat": 37.39, "lon": -5.99, "region": "s_spain"},
    {"id": "lisbon",        "lat": 38.72, "lon": -9.14, "region": "portugal"},
    {"id": "porto",         "lat": 41.16, "lon": -8.63, "region": "n_portugal"},
    {"id": "marseille",     "lat": 43.30, "lon":  5.37, "region": "s_france"},
    {"id": "montpellier",   "lat": 43.61, "lon":  3.88, "region": "s_france"},
    {"id": "rome",          "lat": 41.90, "lon": 12.50, "region": "c_italy"},
    {"id": "palermo",       "lat": 38.12, "lon": 13.36, "region": "sicily"},
    {"id": "athens",        "lat": 37.98, "lon": 23.73, "region": "greece"},
    {"id": "thessaloniki",  "lat": 40.64, "lon": 22.94, "region": "n_greece"},
    {"id": "las_palmas",    "lat": 28.12, "lon":-15.43, "region": "canary_islands"},
    {"id": "edinburgh",     "lat": 55.95, "lon": -3.19, "region": "scotland"},
    {"id": "inverness",     "lat": 57.48, "lon": -4.22, "region": "scotland"},
    {"id": "casablanca",    "lat": 33.57, "lon": -7.59, "region": "morocco"},
]
LANDSLIDE_LOCS = [
    {"id": "edinburgh",    "lat": 55.95, "lon":  -3.19, "region": "scotland"},
    {"id": "glasgow",      "lat": 55.86, "lon":  -4.25, "region": "scotland"},
    {"id": "fort_william", "lat": 56.82, "lon":  -5.11, "region": "highland"},
    {"id": "bergen",       "lat": 60.39, "lon":   5.32, "region": "norway"},
    {"id": "trondheim",    "lat": 63.43, "lon":  10.39, "region": "norway"},
    {"id": "kathmandu",    "lat": 27.71, "lon":  85.31, "region": "nepal"},
    {"id": "pokhara",      "lat": 28.21, "lon":  83.99, "region": "nepal"},
    {"id": "shimla",       "lat": 31.10, "lon":  77.17, "region": "n_india"},
    {"id": "medellin",     "lat":  6.24, "lon": -75.57, "region": "colombia"},
    {"id": "bogota",       "lat":  4.71, "lon": -74.07, "region": "colombia"},
    {"id": "manila",       "lat": 14.60, "lon": 120.98, "region": "philippines"},
    {"id": "osaka",        "lat": 34.69, "lon": 135.50, "region": "japan"},
    {"id": "hiroshima",    "lat": 34.39, "lon": 132.45, "region": "japan"},
    {"id": "naples",       "lat": 40.85, "lon":  14.27, "region": "s_italy"},
]
DROUGHT_LOCS = [
    {"id": "madrid",        "lat": 40.42, "lon":  -3.70, "region": "spain"},
    {"id": "lisbon",        "lat": 38.72, "lon":  -9.14, "region": "portugal"},
    {"id": "rome",          "lat": 41.90, "lon":  12.50, "region": "italy"},
    {"id": "athens",        "lat": 37.98, "lon":  23.73, "region": "greece"},
    {"id": "tunis",         "lat": 36.82, "lon":  10.17, "region": "n_africa"},
    {"id": "niamey",        "lat": 13.51, "lon":   2.12, "region": "sahel"},
    {"id": "dakar",         "lat": 14.69, "lon": -17.44, "region": "w_sahel"},
    {"id": "nairobi",       "lat":  -1.29, "lon":  36.82, "region": "e_africa"},
    {"id": "addis_ababa",   "lat":   9.03, "lon":  38.74, "region": "ethiopia"},
    {"id": "mogadishu",     "lat":   2.05, "lon":  45.34, "region": "somalia"},
    {"id": "harare",        "lat": -17.83, "lon":  31.05, "region": "zimbabwe"},
    {"id": "cape_town",     "lat": -33.93, "lon":  18.42, "region": "s_africa"},
    {"id": "tehran",        "lat": 35.69, "lon":  51.39, "region": "iran"},
    {"id": "baghdad",       "lat": 33.34, "lon":  44.40, "region": "iraq"},
    {"id": "karachi",       "lat": 24.86, "lon":  67.01, "region": "pakistan"},
    {"id": "new_delhi",     "lat": 28.64, "lon":  77.22, "region": "india"},
    {"id": "adelaide",      "lat": -34.92, "lon": 138.60, "region": "s_australia"},
    {"id": "perth",         "lat": -31.95, "lon": 115.86, "region": "w_australia"},
    {"id": "alice_springs", "lat": -23.70, "lon": 133.88, "region": "c_australia"},
    {"id": "fortaleza",     "lat":  -3.72, "lon": -38.54, "region": "ne_brazil"},
    {"id": "lima",          "lat": -12.04, "lon": -77.04, "region": "peru"},
    {"id": "phoenix",       "lat": 33.45, "lon": -112.07, "region": "sw_usa"},
    {"id": "denver",        "lat": 39.74, "lon": -104.98, "region": "great_plains"},
    {"id": "guatemala_city","lat": 14.64, "lon":  -90.51, "region": "c_america"},
]
STORM_LOCS = [
    {"id": "miami",        "lat": 25.77, "lon":  -80.19, "region": "florida"},
    {"id": "houston",      "lat": 29.76, "lon":  -95.37, "region": "gulf_coast"},
    {"id": "new_orleans",  "lat": 29.95, "lon":  -90.07, "region": "gulf_coast"},
    {"id": "san_juan_pr",  "lat": 18.47, "lon":  -66.12, "region": "caribbean"},
    {"id": "havana",       "lat": 23.13, "lon":  -82.38, "region": "caribbean"},
    {"id": "manila",       "lat": 14.60, "lon":  120.98, "region": "philippines"},
    {"id": "taipei",       "lat": 25.05, "lon":  121.56, "region": "taiwan"},
    {"id": "tokyo",        "lat": 35.69, "lon":  139.69, "region": "japan"},
    {"id": "okinawa",      "lat": 26.21, "lon":  127.68, "region": "japan"},
    {"id": "hong_kong",    "lat": 22.32, "lon":  114.17, "region": "china_coast"},
    {"id": "shanghai",     "lat": 31.23, "lon":  121.47, "region": "china_coast"},
    {"id": "acapulco",     "lat": 16.85, "lon":  -99.92, "region": "mx_pacific"},
    {"id": "honolulu",     "lat": 21.31, "lon": -157.86, "region": "hawaii"},
    {"id": "dhaka",        "lat": 23.72, "lon":   90.41, "region": "bangladesh"},
    {"id": "kolkata",      "lat": 22.57, "lon":   88.36, "region": "bay_bengal"},
    {"id": "chennai",      "lat": 13.08, "lon":   80.27, "region": "se_india"},
    {"id": "mumbai",       "lat": 19.08, "lon":   72.88, "region": "arabian_sea"},
    {"id": "karachi_s",    "lat": 24.86, "lon":   67.01, "region": "arabian_sea"},
    {"id": "reunion",      "lat": -21.12, "lon":  55.54, "region": "sw_indian"},
    {"id": "madagascar",   "lat": -18.91, "lon":  47.54, "region": "sw_indian"},
    {"id": "mozambique",   "lat": -25.97, "lon":  32.57, "region": "sw_indian"},
    {"id": "brisbane",     "lat": -27.47, "lon": 153.02, "region": "australia"},
    {"id": "townsville",   "lat": -19.26, "lon": 146.82, "region": "ne_australia"},
    {"id": "suva",         "lat": -18.14, "lon": 178.44, "region": "fiji"},
    {"id": "london",       "lat": 51.51, "lon":  -0.13, "region": "se_england"},
    {"id": "edinburgh",    "lat": 55.95, "lon":  -3.19, "region": "scotland"},
    {"id": "dublin",       "lat": 53.33, "lon":  -6.25, "region": "ireland"},
    {"id": "amsterdam",    "lat": 52.37, "lon":   4.90, "region": "netherlands"},
]
OUTAGE_LOCS = [
    {"id": "london",       "lat": 51.51, "lon":  -0.13, "region": "se_england"},
    {"id": "cardiff",      "lat": 51.48, "lon":  -3.18, "region": "wales"},
    {"id": "manchester",   "lat": 53.48, "lon":  -2.24, "region": "nw_england"},
    {"id": "newcastle",    "lat": 54.98, "lon":  -1.62, "region": "ne_england"},
    {"id": "edinburgh",    "lat": 55.95, "lon":  -3.19, "region": "scotland"},
    {"id": "inverness",    "lat": 57.48, "lon":  -4.22, "region": "highland"},
    {"id": "belfast",      "lat": 54.60, "lon":  -5.93, "region": "n_ireland"},
    {"id": "dublin",       "lat": 53.33, "lon":  -6.25, "region": "ireland"},
    {"id": "new_york",     "lat": 40.71, "lon":  -74.01, "region": "northeast_us"},
    {"id": "boston",       "lat": 42.36, "lon":  -71.06, "region": "northeast_us"},
    {"id": "miami",        "lat": 25.77, "lon":  -80.19, "region": "florida"},
    {"id": "houston",      "lat": 29.76, "lon":  -95.37, "region": "texas"},
    {"id": "dallas",       "lat": 32.78, "lon":  -96.80, "region": "texas"},
    {"id": "chicago",      "lat": 41.88, "lon":  -87.63, "region": "midwest"},
    {"id": "los_angeles",  "lat": 34.05, "lon": -118.24, "region": "california"},
    {"id": "seattle",      "lat": 47.61, "lon": -122.33, "region": "pacific_nw"},
    {"id": "sydney",       "lat": -33.87, "lon": 151.21, "region": "nsw"},
    {"id": "brisbane",     "lat": -27.47, "lon": 153.02, "region": "qld"},
    {"id": "perth",        "lat": -31.95, "lon": 115.86, "region": "wa"},
    {"id": "adelaide",     "lat": -34.92, "lon": 138.60, "region": "sa"},
]
WATER_LOCS = [
    {"id": "london",       "lat": 51.51, "lon":  -0.13, "region": "se_england"},
    {"id": "bristol",      "lat": 51.45, "lon":  -2.58, "region": "sw_england"},
    {"id": "manchester",   "lat": 53.48, "lon":  -2.24, "region": "nw_england"},
    {"id": "edinburgh",    "lat": 55.95, "lon":  -3.19, "region": "scotland"},
    {"id": "paris",        "lat": 48.87, "lon":   2.35, "region": "france"},
    {"id": "berlin",       "lat": 52.52, "lon":  13.40, "region": "germany"},
    {"id": "rome",         "lat": 41.90, "lon":  12.50, "region": "italy"},
    {"id": "madrid",       "lat": 40.42, "lon":  -3.70, "region": "spain"},
    {"id": "lisbon",       "lat": 38.72, "lon":  -9.14, "region": "portugal"},
    {"id": "amman",        "lat": 31.95, "lon":  35.93, "region": "jordan"},
    {"id": "baghdad",      "lat": 33.34, "lon":  44.40, "region": "iraq"},
    {"id": "cape_town",    "lat": -33.93, "lon":  18.42, "region": "s_africa"},
    {"id": "nairobi",      "lat":  -1.29, "lon":  36.82, "region": "e_africa"},
    {"id": "harare",       "lat": -17.83, "lon":  31.05, "region": "zimbabwe"},
    {"id": "sao_paulo",    "lat": -23.55, "lon": -46.63, "region": "se_brazil"},
    {"id": "lima",         "lat": -12.04, "lon": -77.04, "region": "peru"},
    {"id": "phoenix",      "lat": 33.45, "lon": -112.07, "region": "sw_usa"},
    {"id": "los_angeles",  "lat": 34.05, "lon": -118.24, "region": "california"},
    {"id": "new_orleans",  "lat": 29.95, "lon":  -90.07, "region": "gulf_coast"},
    {"id": "adelaide",     "lat": -34.92, "lon": 138.60, "region": "s_australia"},
    {"id": "perth",        "lat": -31.95, "lon": 115.86, "region": "w_australia"},
    {"id": "sydney",       "lat": -33.87, "lon": 151.21, "region": "nsw"},
]
SAFETY_LOCS = [
    {"id": "london",       "lat": 51.51, "lon":  -0.13, "region": "se_england"},
    {"id": "cambridge",    "lat": 52.21, "lon":   0.12, "region": "se_england"},
    {"id": "bristol",      "lat": 51.45, "lon":  -2.58, "region": "sw_england"},
    {"id": "cardiff",      "lat": 51.48, "lon":  -3.18, "region": "wales"},
    {"id": "birmingham",   "lat": 52.49, "lon":  -1.90, "region": "midlands"},
    {"id": "manchester",   "lat": 53.48, "lon":  -2.24, "region": "nw_england"},
    {"id": "york",         "lat": 53.96, "lon":  -1.08, "region": "ne_england"},
    {"id": "newcastle",    "lat": 54.98, "lon":  -1.62, "region": "ne_england"},
    {"id": "edinburgh",    "lat": 55.95, "lon":  -3.19, "region": "scotland"},
    {"id": "glasgow",      "lat": 55.86, "lon":  -4.25, "region": "scotland"},
    {"id": "aberdeen",     "lat": 57.15, "lon":  -2.09, "region": "scotland"},
    {"id": "new_york",     "lat": 40.71, "lon":  -74.01, "region": "northeast_us"},
    {"id": "chicago",      "lat": 41.88, "lon":  -87.63, "region": "midwest"},
    {"id": "houston",      "lat": 29.76, "lon":  -95.37, "region": "texas"},
    {"id": "los_angeles",  "lat": 34.05, "lon": -118.24, "region": "california"},
    {"id": "phoenix",      "lat": 33.45, "lon": -112.07, "region": "sw_usa"},
    {"id": "miami",        "lat": 25.77, "lon":  -80.19, "region": "florida"},
    {"id": "seattle",      "lat": 47.61, "lon": -122.33, "region": "pacific_nw"},
    {"id": "denver",       "lat": 39.74, "lon": -104.98, "region": "mountain_west"},
    {"id": "minneapolis",  "lat": 44.98, "lon":  -93.27, "region": "upper_midwest"},
    {"id": "boston",       "lat": 42.36, "lon":  -71.06, "region": "new_england"},
    {"id": "atlanta",      "lat": 33.75, "lon":  -84.39, "region": "se_usa"},
]
INFRA_LOCS = UK_GRID + [
    {"id": "paris",        "lat": 48.87, "lon":  2.35, "region": "france"},
    {"id": "berlin",       "lat": 52.52, "lon": 13.40, "region": "germany"},
    {"id": "new_york",     "lat": 40.71, "lon":-74.01, "region": "northeast_us"},
    {"id": "chicago",      "lat": 41.88, "lon":-87.63, "region": "midwest"},
    {"id": "tokyo",        "lat": 35.69, "lon":139.69, "region": "japan"},
    {"id": "sydney",       "lat":-33.87, "lon":151.21, "region": "nsw"},
]
ENV_LOCS = UK_GRID + [
    {"id": "beijing",      "lat": 39.91, "lon": 116.39, "region": "n_china"},
    {"id": "delhi",        "lat": 28.64, "lon":  77.22, "region": "india"},
    {"id": "los_angeles",  "lat": 34.05, "lon":-118.24, "region": "california"},
    {"id": "cairo",        "lat": 30.05, "lon":  31.24, "region": "egypt"},
    {"id": "moscow",       "lat": 55.75, "lon":  37.62, "region": "russia"},
    {"id": "istanbul",     "lat": 41.01, "lon":  28.98, "region": "turkey_w"},
]

GLOBAL_HEATWAVE = UK_GRID + HEATWAVE_EXTRA

HAZARD_SETS: dict[str, list[dict]] = {
    "flood":           UK_GRID,
    "heatwave":        GLOBAL_HEATWAVE,
    "wildfire":        WILDFIRE_LOCS,
    "landslide":       LANDSLIDE_LOCS,
    "drought":         DROUGHT_LOCS,
    "severe_storm":    STORM_LOCS,
    "power_outage":    OUTAGE_LOCS,
    "water_supply":    WATER_LOCS,
    "public_safety":   SAFETY_LOCS,
    "infrastructure":  INFRA_LOCS,
    "environmental":   ENV_LOCS,
}

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


def _dedup_locs(locs_list):
    seen = {}
    for locs in locs_list:
        for loc in locs:
            key = (round(loc["lat"], 2), round(loc["lon"], 2))
            if key not in seen:
                seen[key] = loc
    return list(seen.values())


ALL_LOCS = _dedup_locs(HAZARD_SETS.values())

# S3 client (anonymous)
_fs = s3fs.S3FileSystem(anon=True)
_s3 = boto3.client("s3", region_name="us-east-1", config=Config(signature_version=UNSIGNED))


def list_prefix(prefix: str) -> list[str]:
    """List all keys under a prefix (handles up to 1000 objects)."""
    resp = _s3.list_objects_v2(Bucket=ERA5_BUCKET, Prefix=prefix)
    return [o["Key"] for o in resp.get("Contents", [])]


def list_var_files(month_prefix: str, var_key: str) -> list[str]:
    """List S3 keys for a given variable in a month directory.

    The full key looks like:
    e5.oper.an.sfc/202001/e5.oper.an.sfc.128_167_2t.ll025sc.2020010100_2020013123.nc
    So we list the month directory and filter by var_key substring.
    """
    all_keys = list_prefix(month_prefix)
    return sorted(k for k in all_keys if var_key in k)


def stream_extract(key: str, nc_var: str, lats, lons_360) -> tuple[np.ndarray, pd.DatetimeIndex] | None:
    """Open ERA5 NetCDF via S3 streaming, extract points, return (arr, timestamps)."""
    try:
        with _fs.open(f"{ERA5_BUCKET}/{key}", "rb") as f:
            ds = xr.open_dataset(f, engine="h5netcdf")
            la = xr.DataArray(lats, dims="points")
            lo = xr.DataArray(lons_360, dims="points")
            pts = ds[nc_var].sel(latitude=la, longitude=lo, method="nearest")
            arr = pts.values.astype(np.float32)
            for tc in ("time", "valid_time"):
                if tc in ds.coords:
                    ts = pd.DatetimeIndex(ds[tc].values)
                    break
            else:
                raise ValueError("No time coord")
            ds.close()
        return arr, ts
    except Exception as e:
        print(f"  WARN stream_extract {key}: {e}", flush=True)
        return None


def deaccumulate(arr: np.ndarray, ts: pd.DatetimeIndex) -> np.ndarray:
    """Convert ERA5 accumulated forecast values to per-hour totals."""
    out = np.zeros_like(arr)
    hours = ts.hour
    for i in range(len(ts)):
        if i == 0 or hours[i] in (0, 6, 12, 18):
            out[i] = np.maximum(arr[i], 0)
        else:
            delta = arr[i] - arr[i - 1]
            out[i] = np.maximum(delta, 0)
    return out


# Per-month extraction
ANAL_VARS = {
    "128_167_2t":    ("VAR_2T",    "temperature_2m"),
    "128_168_2d":    ("VAR_2D",    "dewpoint_2m"),
    "128_165_10u":   ("VAR_10U",   "_wind_u"),
    "128_166_10v":   ("VAR_10V",   "_wind_v"),
    "128_151_msl":   ("MSL",       "pressure_msl"),
    "128_164_tcc":   ("TCC",       "cloud_cover"),
    "128_139_stl1":  ("STL1",      "soil_temperature_0_to_7cm"),
    "128_039_swvl1": ("SWVL1",     "soil_moisture_0_to_7cm"),
    "128_040_swvl2": ("SWVL2",     "soil_moisture_7_to_28cm"),
    "128_141_sd":    ("SD",        "snow_depth"),
    "128_134_sp":    ("SP",        "surface_pressure"),
}
ACCUMU_VARS = {
    "128_142_lsp":   ("LSP",  "precip_ls"),
    "128_143_cp":    ("CP",   "precip_conv"),
    "128_144_sf":    ("SF",   "snowfall"),
    "128_169_ssrd":  ("SSRD", "shortwave_radiation"),
}
MINMAX_VARS = {
    "128_049_10fg":  ("VAR_10FG", "wind_gusts_10m"),
}


def _fetch_one_var(args):
    """Worker function: fetch one variable file and return (col_name, arr, ts, is_accum)."""
    prefix, var_key, nc_name, col_name, is_accum = args
    keys = list_var_files(prefix, var_key)
    if not keys:
        return col_name, None, None, is_accum
    lats     = [loc["lat"]       for loc in ALL_LOCS]
    lons_360 = [loc["lon"] % 360 for loc in ALL_LOCS]

    # Multiple files (accumu/minmax have two 15-day files per month)
    all_arrs, all_ts = [], []
    for k in sorted(keys):
        result = stream_extract(k, nc_name, lats, lons_360)
        if result:
            arr, ts = result
            all_arrs.append(arr)
            all_ts.append(ts)

    if not all_arrs:
        return col_name, None, None, is_accum

    arr = np.concatenate(all_arrs, axis=0) if len(all_arrs) > 1 else all_arrs[0]
    ts  = all_ts[0].append(all_ts[1]) if len(all_ts) > 1 else all_ts[0]

    if is_accum:
        arr = np.stack(
            [deaccumulate(arr[:, i], ts) for i in range(arr.shape[1])],
            axis=1,
        )
    return col_name, arr, ts, is_accum


def extract_month(year: int, month: int) -> pd.DataFrame | None:
    ym = f"{year}{month:02d}"
    checkpoint = CHECKPOINT_DIR / f"era5_{ym}.csv"
    if checkpoint.exists():
        print(f"  Checkpoint hit: {ym}", flush=True)
        return pd.read_csv(checkpoint, parse_dates=["timestamp"])

    print(f"  Extracting {ym} ...", flush=True)
    t0 = time.time()

    anal_prefix   = f"e5.oper.an.sfc/{ym}/"
    accumu_prefix = f"e5.oper.fc.sfc.accumu/{ym}/"
    minmax_prefix = f"e5.oper.fc.sfc.minmax/{ym}/"

    jobs = []
    for vk, (nc, col) in ANAL_VARS.items():
        jobs.append((anal_prefix, vk, nc, col, False))
    for vk, (nc, col) in ACCUMU_VARS.items():
        jobs.append((accumu_prefix, vk, nc, col, True))
    for vk, (nc, col) in MINMAX_VARS.items():
        jobs.append((minmax_prefix, vk, nc, col, False))

    col_data: dict[str, tuple[np.ndarray, pd.DatetimeIndex]] = {}
    ref_ts: pd.DatetimeIndex | None = None

    with concurrent.futures.ThreadPoolExecutor(max_workers=N_WORKERS) as pool:
        futures = {pool.submit(_fetch_one_var, j): j for j in jobs}
        for fut in concurrent.futures.as_completed(futures):
            col_name, arr, ts, is_accum = fut.result()
            if arr is not None:
                col_data[col_name] = (arr, ts)
                if not is_accum and ref_ts is None:
                    ref_ts = ts

    if ref_ts is None:
        print(f"  ERROR: no data for {ym}", flush=True)
        return None

    # Align all columns to ref_ts
    n_locs = len(ALL_LOCS)
    lats   = [loc["lat"]                                          for loc in ALL_LOCS]
    lons   = [loc["lon"] if loc["lon"] <= 180 else loc["lon"]-360 for loc in ALL_LOCS]
    ids    = [loc["id"]                                            for loc in ALL_LOCS]
    regs   = [loc.get("region", "")                               for loc in ALL_LOCS]

    n_hours = len(ref_ts)
    frames = []
    for i in range(n_locs):
        row: dict = {
            "timestamp":  ref_ts,
            "station_id": ids[i],
            "region":     regs[i],
            "latitude":   lats[i],
            "longitude":  lons[i],
        }
        for col, (arr, ts) in col_data.items():
            if arr.shape[1] > i:
                if len(ts) == n_hours:
                    row[col] = arr[:, i]
                else:
                    # Align via index join
                    ts_idx = pd.Series(range(len(ts)), index=ts)
                    aligned = np.full(n_hours, np.nan, dtype=np.float32)
                    for ti, t in enumerate(ref_ts):
                        si = ts_idx.get(t)
                        if si is not None:
                            aligned[ti] = arr[si, i]
                    row[col] = aligned
        frames.append(pd.DataFrame(row))

    df = pd.concat(frames, ignore_index=True)
    df = _apply_conversions(df)

    df.to_csv(checkpoint, index=False)
    print(f"  {ym} done in {time.time()-t0:.0f}s ({len(df):,} rows)", flush=True)
    return df


def _apply_conversions(df: pd.DataFrame) -> pd.DataFrame:
    for c in ("temperature_2m", "dewpoint_2m", "soil_temperature_0_to_7cm"):
        if c in df.columns:
            df[c] = df[c] - 273.15
    for c in ("pressure_msl", "surface_pressure"):
        if c in df.columns:
            df[c] = df[c] / 100.0
    for c in ("precip_ls", "precip_conv", "snowfall"):
        if c in df.columns:
            df[c] = (df[c] * 1000.0).clip(lower=0.0)
    if "precip_ls" in df.columns and "precip_conv" in df.columns:
        df["precipitation"] = df["precip_ls"].fillna(0) + df["precip_conv"].fillna(0)
        df.drop(columns=["precip_ls", "precip_conv"], inplace=True)
    elif "precip_ls" in df.columns:
        df.rename(columns={"precip_ls": "precipitation"}, inplace=True)
    elif "precip_conv" in df.columns:
        df.rename(columns={"precip_conv": "precipitation"}, inplace=True)
    if "cloud_cover" in df.columns:
        df["cloud_cover"] = (df["cloud_cover"] * 100.0).clip(0, 100)
    if "shortwave_radiation" in df.columns:
        df["shortwave_radiation"] = (df["shortwave_radiation"] / 3600.0).clip(lower=0.0)
    if "_wind_u" in df.columns and "_wind_v" in df.columns:
        df["wind_speed_10m"] = np.sqrt(df["_wind_u"]**2 + df["_wind_v"]**2)
        df.drop(columns=["_wind_u", "_wind_v"], inplace=True)
    if "temperature_2m" in df.columns and "dewpoint_2m" in df.columns:
        T  = df["temperature_2m"]
        Td = df["dewpoint_2m"]
        df["relative_humidity_2m"] = (
            100.0 * np.exp(17.625*Td/(243.04+Td)) / np.exp(17.625*T/(243.04+T))
        ).clip(0, 100)
    if "temperature_2m" in df.columns and "relative_humidity_2m" in df.columns:
        T  = df["temperature_2m"]
        RH = df["relative_humidity_2m"]
        e  = (RH/100.0) * 6.105 * np.exp(17.27*T/(237.7+T))
        df["apparent_temperature"] = T + 0.33*e - 4.0
    return df


def generate_hazard_caches(all_months: list[pd.DataFrame]) -> None:
    """Merge monthly data and write per-hazard cache CSVs."""
    print("\nGenerating per-hazard cache files ...", flush=True)
    df_all = pd.concat(all_months, ignore_index=True)
    df_all["timestamp"] = pd.to_datetime(df_all["timestamp"], errors="coerce")
    df_all = df_all.dropna(subset=["timestamp"]).sort_values("timestamp").reset_index(drop=True)

    for hazard, locs in HAZARD_SETS.items():
        loc_ids = sorted(l["id"] for l in locs)
        cache_key = hashlib.md5(
            f"om|{loc_ids}|2016-01-01|2023-12-31|{EXTENDED_HOURLY_VARS}".encode()
        ).hexdigest()[:12]
        cache_path = CACHE_DIR / f"weather_{cache_key}.csv"

        loc_id_set = {l["id"] for l in locs}
        df_h = df_all[df_all["station_id"].isin(loc_id_set)].copy()
        df_h.to_csv(cache_path, index=False)
        print(f"  {hazard:25s} -> {cache_path.name}  ({len(df_h):,} rows)", flush=True)

    print("Cache generation complete.", flush=True)


def main():
    print(f"=== AEGIS ERA5 Local Extraction ===")
    print(f"Unique locations : {len(ALL_LOCS)}")
    print(f"Years            : {START_YEAR}-{END_YEAR}")
    print(f"Parallel workers : {N_WORKERS}")
    print(f"Checkpoint dir   : {CHECKPOINT_DIR}")
    print()

    total = (END_YEAR - START_YEAR + 1) * 12
    all_months: list[pd.DataFrame] = []
    done = 0
    t_total = time.time()

    for year in range(START_YEAR, END_YEAR + 1):
        for month in range(1, 13):
            done += 1
            print(f"[{done}/{total}] {year}-{month:02d}", flush=True)
            df = extract_month(year, month)
            if df is not None:
                all_months.append(df)

            elapsed = time.time() - t_total
            eta = (elapsed / done) * (total - done) if done > 0 else 0
            print(f"  Progress: {done}/{total} | elapsed={elapsed/3600:.1f}h | ETA={eta/3600:.1f}h",
                  flush=True)

    generate_hazard_caches(all_months)
    print(f"\nAll done in {(time.time()-t_total)/3600:.1f}h")


if __name__ == "__main__":
    main()
