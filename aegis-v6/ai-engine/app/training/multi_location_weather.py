"""
Fetches current weather for multiple regions concurrently using asyncio.
Builds a lat/lon batch request to Open-Meteo, parses the response into
a keyed dict, and caches results for the configured TTL. Used to populate
the FeatureStore when prediction requests come in from multiple regions.

- Called by ai-engine/app/core/feature_store.py for multi-region updates
- Region coordinates from ai-engine/registry/region_registry.py
- Results merged into per-hazard feature vectors by FeatureStore
"""

from __future__ import annotations

import asyncio
import hashlib
import tempfile
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
from loguru import logger

try:
    import cdsapi  # type: ignore
    import xarray as xr  # type: ignore
    _CDS_AVAILABLE = True
except ImportError:
    _CDS_AVAILABLE = False
    logger.warning("cdsapi/xarray not installed — ERA5 fetcher disabled")

_CACHE_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "cache" / "multi_location_weather"
_CACHE_DIR.mkdir(parents=True, exist_ok=True)

# Per-location-year parquet cache — persists across ALL training runs regardless
# of batch parameters (location list, date range, var set changes).
# Each file: {loc_id}_{year}_{vars_hash8}.parquet
_PER_LOC_CACHE_DIR = _CACHE_DIR / "per_loc_year"
_PER_LOC_CACHE_DIR.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# Open-Meteo archive configuration (primary training data source)
# ---------------------------------------------------------------------------
_OM_MAX_CONCURRENT   = 1     # strictly sequential — avoids 429 cascades
_OM_INTER_REQ_SLEEP  = 3.0   # ~0.33 req/sec — comfortable free-tier margin
_OM_RETRY_429_SLEEP  = 180   # 3 min initial back-off after a 429 (was 60s)
_OM_MAX_RETRIES      = 2     # fewer retries — 2×3min = 6min max wait per chunk (was 4×60+...)

# Global 429 cooldown: when a 429 is received, ALL coroutines pause until this
# asyncio.Event is set.  This prevents a thundering-herd of concurrent retries
# all hammering the same rate-limited endpoint simultaneously.
_OM_GLOBAL_COOLDOWN_EVENT: asyncio.Event | None = None
_OM_GLOBAL_COOLDOWN_UNTIL: float = 0.0  # epoch seconds

# ---------------------------------------------------------------------------
# ERA5 / CDS configuration  (kept for optional override / reference)
# ---------------------------------------------------------------------------
_CDS_DATASET = "reanalysis-era5-single-levels"
_ERA5_MAX_CONCURRENT = 2        # parallel CDS requests (server-side queue limits)
_ERA5_INTER_REQUEST_SLEEP = 1.0 # seconds between launching requests

# ERA5 variables to request (CDS long names)
_ERA5_VARIABLES = [
    "2m_temperature",
    "2m_dewpoint_temperature",
    "10m_u_component_of_wind",
    "10m_v_component_of_wind",
    "10m_wind_gust_since_previous_post_processing",
    "mean_sea_level_pressure",
    "surface_pressure",
    "total_precipitation",
    "total_snowfall",
    "snow_depth",
    "total_cloud_cover",
    "surface_solar_radiation_downwards",
    "soil_temperature_level_1",
    "volumetric_soil_water_layer_1",
    "volumetric_soil_water_layer_2",
]

# ERA5 NetCDF short-name → our standard column name
_ERA5_COL_MAP: dict[str, str] = {
    "t2m":   "temperature_2m",           # K
    "d2m":   "dewpoint_2m",              # K
    "u10":   "_wind_u",                  # m/s (component)
    "v10":   "_wind_v",                  # m/s (component)
    "i10fg": "wind_gusts_10m",           # m/s (GRIB short name)
    "fg10":  "wind_gusts_10m",           # m/s (NetCDF short name — CDS v2 API)
    "msl":   "pressure_msl",             # Pa → hPa
    "sp":    "surface_pressure",         # Pa → hPa
    "tp":    "precipitation",            # m → mm
    "sf":    "snowfall",                 # m → mm
    "sd":    "snow_depth",               # m (keep as-is)
    "tcc":   "cloud_cover",              # fraction → %
    "ssrd":  "shortwave_radiation",      # J/m² → W/m²
    "stl1":  "soil_temperature_0_to_7cm", # K → °C
    "swvl1": "soil_moisture_0_to_7cm",   # m³/m³ (keep as-is)
    "swvl2": "soil_moisture_7_to_28cm",  # m³/m³ (keep as-is)
}

# Fallback Open-Meteo (for recent/live data or if CDS unavailable)
import aiohttp  # noqa: E402 — kept for live-prediction fallback
_ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
_MAX_CHUNK_DAYS = 365

# UK grid — 13 locations spanning SE England (dry/warm) to N Scotland
#
# heatwave_tmax: region-specific Met Office heatwave Tmax threshold (°C)
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

# ---------------------------------------------------------------------------
# Multi-region heatwave locations
#
# UK alone produces ~0.15% positive heatwave labels — too rare for a valid
# chronological split.  Adding Mediterranean and Central European locations
# increases class balance to ~3–5% while keeping the physical label definition
# (WMO consecutive-day threshold) identical.
#
# heatwave_tmax: threshold appropriate for each region's climate normal.
# Sources: national meteorological service heatwave definitions where available;
# otherwise 95th-percentile Tmax for the location from ERA5 climatology.
# ---------------------------------------------------------------------------
GLOBAL_HEATWAVE_LOCATIONS: list[dict] = UK_GRID_LOCATIONS + [
    # France — canicule-level heat, 2003 / 2019 / 2022 well-documented
    {"id": "paris",      "lat": 48.87, "lon":  2.35, "region": "france",      "heatwave_tmax": 32.0},
    {"id": "marseille",  "lat": 43.30, "lon":  5.37, "region": "s_france",    "heatwave_tmax": 35.0},
    # Spain — highest heatwave frequency in western Europe
    {"id": "madrid",     "lat": 40.42, "lon": -3.70, "region": "spain",       "heatwave_tmax": 38.0},
    {"id": "seville",    "lat": 37.39, "lon": -5.99, "region": "s_spain",     "heatwave_tmax": 40.0},
    {"id": "barcelona",  "lat": 41.38, "lon":  2.18, "region": "ne_spain",    "heatwave_tmax": 34.0},
    # Portugal
    {"id": "lisbon",     "lat": 38.72, "lon": -9.14, "region": "portugal",    "heatwave_tmax": 36.0},
    # Italy
    {"id": "rome",       "lat": 41.90, "lon": 12.50, "region": "c_italy",     "heatwave_tmax": 36.0},
    {"id": "milan",      "lat": 45.47, "lon":  9.19, "region": "n_italy",     "heatwave_tmax": 34.0},
    # Greece — extreme summer temperatures, well-documented events
    {"id": "athens",     "lat": 37.98, "lon": 23.73, "region": "greece",      "heatwave_tmax": 38.0},
    # Germany / Central Europe
    {"id": "berlin",     "lat": 52.52, "lon": 13.40, "region": "germany",     "heatwave_tmax": 30.0},
    {"id": "munich",     "lat": 48.14, "lon": 11.58, "region": "s_germany",   "heatwave_tmax": 30.0},
    # Netherlands
    {"id": "amsterdam",  "lat": 52.37, "lon":  4.90, "region": "netherlands", "heatwave_tmax": 27.0},
    # Turkey — very high positive rate, balances class imbalance
    {"id": "ankara",     "lat": 39.93, "lon": 32.86, "region": "turkey",      "heatwave_tmax": 36.0},
    {"id": "istanbul",   "lat": 41.01, "lon": 28.98, "region": "turkey_w",    "heatwave_tmax": 33.0},
]

# ---------------------------------------------------------------------------
# Global wildfire training locations
#
# UK has < 5 FWI-30 events per year — far too few for a valid split.
# Mediterranean Europe, the Iberian Peninsula, and the Canary Islands have
# historically high fire frequency from ERA5 reanalysis.  The model learns
# raw meteorological fire-risk signatures without FWI indices in the feature
# set; the multi-region scope ensures enough positives in every split.
# ---------------------------------------------------------------------------
GLOBAL_WILDFIRE_LOCATIONS: list[dict] = [
    # Iberian Peninsula — highest European wildfire frequency
    {"id": "madrid",          "lat": 40.42, "lon": -3.70, "region": "spain"},
    {"id": "seville",         "lat": 37.39, "lon": -5.99, "region": "s_spain"},
    {"id": "lisbon",          "lat": 38.72, "lon": -9.14, "region": "portugal"},
    {"id": "porto",           "lat": 41.16, "lon": -8.63, "region": "n_portugal"},
    # Southern France
    {"id": "marseille",       "lat": 43.30, "lon":  5.37, "region": "s_france"},
    {"id": "montpellier",     "lat": 43.61, "lon":  3.88, "region": "s_france"},
    # Italy
    {"id": "rome",            "lat": 41.90, "lon": 12.50, "region": "c_italy"},
    {"id": "palermo",         "lat": 38.12, "lon": 13.36, "region": "sicily"},
    # Greece
    {"id": "athens",          "lat": 37.98, "lon": 23.73, "region": "greece"},
    {"id": "thessaloniki",    "lat": 40.64, "lon": 22.94, "region": "n_greece"},
    # Canary Islands — fires year-round due to drought and trade winds
    {"id": "las_palmas",      "lat": 28.12, "lon":-15.43, "region": "canary_islands"},
    # Scotland — low fire frequency but representative of UK
    {"id": "edinburgh",       "lat": 55.95, "lon": -3.19, "region": "scotland"},
    {"id": "inverness",       "lat": 57.48, "lon": -4.22, "region": "scotland"},
    # Morocco (N Africa) — adjacent to European fire climate
    {"id": "casablanca",      "lat": 33.57, "lon": -7.59, "region": "morocco"},
]

# ---------------------------------------------------------------------------
# Global landslide training locations
#
# UK has too few recorded landslide events for a valid split.  Including
# high-susceptibility regions (Himalayas, Andes foothills, SE Asia) from the
# NASA Global Landslide Catalog (GLC) provides enough positive samples.
# All locations are within Open-Meteo ERA5 coverage.
# ---------------------------------------------------------------------------
GLOBAL_LANDSLIDE_LOCATIONS: list[dict] = [
    # UK (base)
    {"id": "edinburgh",   "lat": 55.95, "lon":  -3.19, "region": "scotland"},
    {"id": "glasgow",     "lat": 55.86, "lon":  -4.25, "region": "scotland"},
    {"id": "fort_william","lat": 56.82, "lon":  -5.11, "region": "highland"},
    # Norway — high-frequency debris flow and quick-clay slides
    {"id": "bergen",      "lat": 60.39, "lon":   5.32, "region": "norway"},
    {"id": "trondheim",   "lat": 63.43, "lon":  10.39, "region": "norway"},
    # Nepal foothills — highest global landslide frequency (NASA GLC)
    {"id": "kathmandu",   "lat": 27.71, "lon":  85.31, "region": "nepal"},
    {"id": "pokhara",     "lat": 28.21, "lon":  83.99, "region": "nepal"},
    # Northern India (Himachal Pradesh / Uttarakhand) — monsoon-triggered slides
    {"id": "shimla",      "lat": 31.10, "lon":  77.17, "region": "n_india"},
    # Colombia — Andes foothills, high GLC event density
    {"id": "medellin",    "lat":  6.24, "lon": -75.57, "region": "colombia"},
    {"id": "bogota",      "lat":  4.71, "lon": -74.07, "region": "colombia"},
    # Philippines — typhoon-triggered landslides, high GLC density
    {"id": "manila",      "lat": 14.60, "lon": 120.98, "region": "philippines"},
    # Japan — well-documented debris flow database
    {"id": "osaka",       "lat": 34.69, "lon": 135.50, "region": "japan"},
    {"id": "hiroshima",   "lat": 34.39, "lon": 132.45, "region": "japan"},
    # Italy (Apennines) — well-documented historical events
    {"id": "naples",      "lat": 40.85, "lon":  14.27, "region": "s_italy"},
]

# ---------------------------------------------------------------------------
# Global drought training locations
#
# Drought labels come from CSIC SPEI-3 (CRU TS4 observed, independent of ERA5).
# Sites are chosen to cover major drought-prone land regions: Sahel, Horn of
# Africa, Australian interior, Mediterranean basin, Central America, SW USA,
# NE Brazil, and South/Central Asia.  At least one site per major climate zone
# prone to multi-month precipitation deficit events recorded in SPEI/EM-DAT.
# ---------------------------------------------------------------------------
GLOBAL_DROUGHT_LOCATIONS: list[dict] = [
    # Mediterranean / Southern Europe
    {"id": "madrid",       "lat": 40.42, "lon":  -3.70, "region": "spain"},
    {"id": "lisbon",       "lat": 38.72, "lon":  -9.14, "region": "portugal"},
    {"id": "rome",         "lat": 41.90, "lon":  12.50, "region": "italy"},
    {"id": "athens",       "lat": 37.98, "lon":  23.73, "region": "greece"},
    # Northern Africa / Sahel
    {"id": "tunis",        "lat": 36.82, "lon":   10.17, "region": "n_africa"},
    {"id": "niamey",       "lat": 13.51, "lon":    2.12, "region": "sahel"},
    {"id": "dakar",        "lat": 14.69, "lon":  -17.44, "region": "w_sahel"},
    # Horn of Africa — highest drought disaster frequency globally
    {"id": "nairobi",      "lat":  -1.29, "lon":  36.82, "region": "e_africa"},
    {"id": "addis_ababa",  "lat":   9.03, "lon":  38.74, "region": "ethiopia"},
    {"id": "mogadishu",    "lat":   2.05, "lon":  45.34, "region": "somalia"},
    # Southern Africa
    {"id": "harare",       "lat": -17.83, "lon":  31.05, "region": "zimbabwe"},
    {"id": "cape_town",    "lat": -33.93, "lon":  18.42, "region": "s_africa"},
    # Middle East
    {"id": "tehran",       "lat": 35.69, "lon":  51.39, "region": "iran"},
    {"id": "baghdad",      "lat": 33.34, "lon":  44.40, "region": "iraq"},
    # Central / South Asia
    {"id": "karachi",      "lat": 24.86, "lon":  67.01, "region": "pakistan"},
    {"id": "new_delhi",    "lat": 28.64, "lon":  77.22, "region": "india"},
    # Australia — Murray-Darling Basin droughts
    {"id": "adelaide",     "lat": -34.92, "lon": 138.60, "region": "s_australia"},
    {"id": "perth",        "lat": -31.95, "lon": 115.86, "region": "w_australia"},
    {"id": "alice_springs","lat": -23.70, "lon": 133.88, "region": "c_australia"},
    # South America — NE Brazil, Andean dry valleys
    {"id": "fortaleza",    "lat":  -3.72, "lon": -38.54, "region": "ne_brazil"},
    {"id": "lima",         "lat": -12.04, "lon": -77.04, "region": "peru"},
    # North America — SW USA, Great Plains
    {"id": "phoenix",      "lat": 33.45, "lon": -112.07, "region": "sw_usa"},
    {"id": "denver",       "lat": 39.74, "lon": -104.98, "region": "great_plains"},
    # Central America
    {"id": "guatemala_city","lat": 14.64, "lon":  -90.51, "region": "c_america"},
]

# ---------------------------------------------------------------------------
# Global severe storm / tropical cyclone training locations
#
# Storm labels come from IBTrACS global track archive (WMO authoritative).
# Sites cover all six active tropical cyclone basins: North Atlantic, Western
# North Pacific, Eastern North Pacific, North Indian (Bay of Bengal + Arabian
# Sea), South Indian, and South Pacific.  Extratropical storm regions (NW
# Europe, Southern Ocean) are also represented using the Named Storm archive.
# ---------------------------------------------------------------------------
GLOBAL_STORM_LOCATIONS: list[dict] = [
    # North Atlantic basin — US Gulf/East Coast, Caribbean
    {"id": "miami",        "lat": 25.77, "lon":  -80.19, "region": "florida"},
    {"id": "houston",      "lat": 29.76, "lon":  -95.37, "region": "gulf_coast"},
    {"id": "new_orleans",  "lat": 29.95, "lon":  -90.07, "region": "gulf_coast"},
    {"id": "san_juan_pr",  "lat": 18.47, "lon":  -66.12, "region": "caribbean"},
    {"id": "havana",       "lat": 23.13, "lon":  -82.38, "region": "caribbean"},
    # Western North Pacific — most active basin globally
    {"id": "manila",       "lat": 14.60, "lon":  120.98, "region": "philippines"},
    {"id": "taipei",       "lat": 25.05, "lon":  121.56, "region": "taiwan"},
    {"id": "tokyo",        "lat": 35.69, "lon":  139.69, "region": "japan"},
    {"id": "okinawa",      "lat": 26.21, "lon":  127.68, "region": "japan"},
    {"id": "hong_kong",    "lat": 22.32, "lon":  114.17, "region": "china_coast"},
    {"id": "shanghai",     "lat": 31.23, "lon":  121.47, "region": "china_coast"},
    # Eastern North Pacific — Pacific coast Mexico + Hawaii
    {"id": "acapulco",     "lat": 16.85, "lon":  -99.92, "region": "mx_pacific"},
    {"id": "honolulu",     "lat": 21.31, "lon": -157.86, "region": "hawaii"},
    # North Indian — Bay of Bengal (deadliest)
    {"id": "dhaka",        "lat": 23.72, "lon":   90.41, "region": "bangladesh"},
    {"id": "kolkata",      "lat": 22.57, "lon":   88.36, "region": "bay_bengal"},
    {"id": "chennai",      "lat": 13.08, "lon":   80.27, "region": "se_india"},
    # Arabian Sea
    {"id": "mumbai",       "lat": 19.08, "lon":   72.88, "region": "arabian_sea"},
    {"id": "karachi_s",    "lat": 24.86, "lon":   67.01, "region": "arabian_sea"},
    # South Indian Ocean
    {"id": "reunion",      "lat": -21.12, "lon":  55.54, "region": "sw_indian"},
    {"id": "madagascar",   "lat": -18.91, "lon":  47.54, "region": "sw_indian"},
    {"id": "mozambique",   "lat": -25.97, "lon":  32.57, "region": "sw_indian"},
    # South Pacific
    {"id": "brisbane",     "lat": -27.47, "lon": 153.02, "region": "australia"},
    {"id": "townsville",   "lat": -19.26, "lon": 146.82, "region": "ne_australia"},
    {"id": "suva",         "lat":  -18.14, "lon": 178.44, "region": "fiji"},
    # NW European extratropical storms (from Named Storm archive)
    {"id": "london",       "lat": 51.51, "lon":  -0.13, "region": "se_england"},
    {"id": "edinburgh",    "lat": 55.95, "lon":  -3.19, "region": "scotland"},
    {"id": "dublin",       "lat": 53.33, "lon":  -6.25, "region": "ireland"},
    {"id": "amsterdam",    "lat": 52.37, "lon":   4.90, "region": "netherlands"},
]

# ---------------------------------------------------------------------------
# Global power outage training locations
#
# Outage labels come from EIA OE-417 (US) + embedded UK named storm outage
# records.  Sites cover major English-speaking electricity markets with
# available independent outage reporting.
# ---------------------------------------------------------------------------
GLOBAL_OUTAGE_LOCATIONS: list[dict] = [
    # United Kingdom (Named Storm outage records)
    {"id": "london",       "lat": 51.51, "lon":  -0.13, "region": "se_england"},
    {"id": "cardiff",      "lat": 51.48, "lon":  -3.18, "region": "wales"},
    {"id": "manchester",   "lat": 53.48, "lon":  -2.24, "region": "nw_england"},
    {"id": "newcastle",    "lat": 54.98, "lon":  -1.62, "region": "ne_england"},
    {"id": "edinburgh",    "lat": 55.95, "lon":  -3.19, "region": "scotland"},
    {"id": "inverness",    "lat": 57.48, "lon":  -4.22, "region": "highland"},
    {"id": "belfast",      "lat": 54.60, "lon":  -5.93, "region": "n_ireland"},
    {"id": "dublin",       "lat": 53.33, "lon":  -6.25, "region": "ireland"},
    # United States (EIA OE-417)
    {"id": "new_york",     "lat": 40.71, "lon":  -74.01, "region": "northeast_us"},
    {"id": "boston",       "lat": 42.36, "lon":  -71.06, "region": "northeast_us"},
    {"id": "miami",        "lat": 25.77, "lon":  -80.19, "region": "florida"},
    {"id": "houston",      "lat": 29.76, "lon":  -95.37, "region": "texas"},
    {"id": "dallas",       "lat": 32.78, "lon":  -96.80, "region": "texas"},
    {"id": "chicago",      "lat": 41.88, "lon":  -87.63, "region": "midwest"},
    {"id": "los_angeles",  "lat": 34.05, "lon": -118.24, "region": "california"},
    {"id": "seattle",      "lat": 47.61, "lon": -122.33, "region": "pacific_nw"},
    # Australia (Bureau of Meteorology wind events → grid operator records)
    {"id": "sydney",       "lat": -33.87, "lon": 151.21, "region": "nsw"},
    {"id": "brisbane",     "lat": -27.47, "lon": 153.02, "region": "qld"},
    {"id": "perth",        "lat": -31.95, "lon": 115.86, "region": "wa"},
    {"id": "adelaide",     "lat": -34.92, "lon": 138.60, "region": "sa"},
]

# ---------------------------------------------------------------------------
# Global water supply disruption training locations
#
# Labels come from GRDC gauge-based Q10 low-flow events + embedded WHO/EA/
# USBR water supply disruption event records.  Sites chosen to overlap with
# GRDC station coverage and documented events in WATER_SUPPLY_DISRUPTION_EVENTS.
# ---------------------------------------------------------------------------
GLOBAL_WATER_LOCATIONS: list[dict] = [
    # United Kingdom
    {"id": "london",       "lat": 51.51, "lon":  -0.13, "region": "se_england"},
    {"id": "bristol",      "lat": 51.45, "lon":  -2.58, "region": "sw_england"},
    {"id": "manchester",   "lat": 53.48, "lon":  -2.24, "region": "nw_england"},
    {"id": "edinburgh",    "lat": 55.95, "lon":  -3.19, "region": "scotland"},
    # Western Europe
    {"id": "paris",        "lat": 48.87, "lon":   2.35, "region": "france"},
    {"id": "berlin",       "lat": 52.52, "lon":  13.40, "region": "germany"},
    {"id": "rome",         "lat": 41.90, "lon":  12.50, "region": "italy"},
    {"id": "madrid",       "lat": 40.42, "lon":  -3.70, "region": "spain"},
    {"id": "lisbon",       "lat": 38.72, "lon":  -9.14, "region": "portugal"},
    # Middle East
    {"id": "amman",        "lat": 31.95, "lon":  35.93, "region": "jordan"},
    {"id": "baghdad",      "lat": 33.34, "lon":  44.40, "region": "iraq"},
    # Africa
    {"id": "cape_town",    "lat": -33.93, "lon":  18.42, "region": "s_africa"},
    {"id": "nairobi",      "lat":  -1.29, "lon":  36.82, "region": "e_africa"},
    {"id": "harare",       "lat": -17.83, "lon":  31.05, "region": "zimbabwe"},
    # South America
    {"id": "sao_paulo",    "lat": -23.55, "lon": -46.63, "region": "se_brazil"},
    {"id": "lima",         "lat": -12.04, "lon": -77.04, "region": "peru"},
    # North America
    {"id": "phoenix",      "lat": 33.45, "lon": -112.07, "region": "sw_usa"},
    {"id": "los_angeles",  "lat": 34.05, "lon": -118.24, "region": "california"},
    {"id": "new_orleans",  "lat": 29.95, "lon":  -90.07, "region": "gulf_coast"},
    # Australia
    {"id": "adelaide",     "lat": -34.92, "lon": 138.60, "region": "s_australia"},
    {"id": "perth",        "lat": -31.95, "lon": 115.86, "region": "w_australia"},
    {"id": "sydney",       "lat": -33.87, "lon": 151.21, "region": "nsw"},
]

# ---------------------------------------------------------------------------
# Global public safety training locations
#
# Labels come from Stats19 (UK DfT) adverse-weather road accidents and NHTSA
# FARS (US) adverse atmospheric condition fatalities.  Sites cover Great
# Britain (Stats19 catchment) and contiguous US states (FARS catchment).
# Radius of 80km per station gives ~county-level granularity.
# ---------------------------------------------------------------------------
GLOBAL_SAFETY_LOCATIONS: list[dict] = [
    # Great Britain — Stats19 catchment
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
    # United States — NHTSA FARS catchment (regional centroids)
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

def _process_era5_ds(ds: "xr.Dataset", lat: float, lon: float) -> "pd.DataFrame":
    """Select nearest grid cell, apply unit conversions, and derive secondary variables."""
    # Select nearest grid cell to the requested point
    sel_kwargs: dict = {}
    if "latitude" in ds.dims:
        sel_kwargs["latitude"] = lat
    if "longitude" in ds.dims:
        sel_kwargs["longitude"] = lon
    if sel_kwargs:
        ds = ds.sel(**sel_kwargs, method="nearest")

    df: pd.DataFrame = ds.to_dataframe().reset_index()
    ds.close()

    # Normalise timestamp column (ERA5 uses 'valid_time' in newer files)
    for tc in ("valid_time", "time"):
        if tc in df.columns:
            df = df.rename(columns={tc: "timestamp"})
            break

    # Rename ERA5 short names → our standard column names
    df = df.rename(columns=_ERA5_COL_MAP)

    # --- Unit conversions ---
    for col in ("temperature_2m", "dewpoint_2m", "soil_temperature_0_to_7cm"):
        if col in df.columns:
            df[col] = df[col] - 273.15                  # K → °C

    for col in ("pressure_msl", "surface_pressure"):
        if col in df.columns:
            df[col] = df[col] / 100.0                   # Pa → hPa

    if "precipitation" in df.columns:
        df["precipitation"] = (df["precipitation"] * 1000.0).clip(lower=0.0)  # m → mm

    if "snowfall" in df.columns:
        df["snowfall"] = (df["snowfall"] * 1000.0).clip(lower=0.0)  # m → mm

    if "cloud_cover" in df.columns:
        df["cloud_cover"] = (df["cloud_cover"] * 100.0).clip(0.0, 100.0)  # fraction → %

    if "shortwave_radiation" in df.columns:
        df["shortwave_radiation"] = (df["shortwave_radiation"] / 3600.0).clip(lower=0.0)  # J/m² → W/m²

    # --- Derived variables ---
    if "_wind_u" in df.columns and "_wind_v" in df.columns:
        df["wind_speed_10m"] = np.sqrt(df["_wind_u"] ** 2 + df["_wind_v"] ** 2)
        df["wind_direction_10m"] = (
            np.degrees(np.arctan2(-df["_wind_u"], -df["_wind_v"])) % 360
        )
        df.drop(columns=["_wind_u", "_wind_v"], inplace=True)

    # Relative humidity from T and Td (Magnus formula, ±0.4% accurate)
    if "temperature_2m" in df.columns and "dewpoint_2m" in df.columns:
        T  = df["temperature_2m"]
        Td = df["dewpoint_2m"]
        df["relative_humidity_2m"] = (
            100.0
            * np.exp(17.625 * Td / (243.04 + Td))
            / np.exp(17.625 * T  / (243.04 + T))
        ).clip(0.0, 100.0)

    # Apparent temperature (Steadman simplified)
    if "temperature_2m" in df.columns and "relative_humidity_2m" in df.columns:
        T  = df["temperature_2m"]
        RH = df["relative_humidity_2m"]
        e  = (RH / 100.0) * 6.105 * np.exp(17.27 * T / (237.7 + T))
        df["apparent_temperature"] = T + 0.33 * e - 4.0

    # Drop ERA5 coordinate/metadata columns that aren't features
    _drop = {"latitude", "longitude", "number", "step", "surface",
              "level", "expver", "edition", "class", "stream", "type"}
    df.drop(columns=[c for c in df.columns if c in _drop], inplace=True, errors="ignore")

    return df


def _fetch_era5_location_year(
    lat: float,
    lon: float,
    year: int,
    loc_id: str,
) -> pd.DataFrame | None:
    """Download one year of ERA5 for a single point.  Runs in a thread pool.

    Fetches one calendar month at a time to stay within the CDS free-tier
    request-size limit (~120,000 fields per request).  Each monthly request
    is 15 vars × 31 days × 24 hours × 4 grid cells ≈ 44,640 fields.
    The 12 monthly DataFrames are concatenated before returning.
    """
    buf = 0.4  # degrees — ensures ≥ 1 ERA5 grid cell on each side
    area = [lat + buf, lon - buf, lat - buf, lon + buf]  # N W S E
    days  = [f"{d:02d}" for d in range(1, 32)]
    times = [f"{h:02d}:00" for h in range(24)]

    client = cdsapi.Client(quiet=True)
    monthly_frames: list[pd.DataFrame] = []

    for month in range(1, 13):
        month_str = f"{month:02d}"
        tmp_path = None
        try:
            with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as tmp:
                tmp_path = tmp.name

            logger.info(f"    ERA5 → {loc_id} {year}-{month_str} (queuing CDS…)")
            client.retrieve(
                _CDS_DATASET,
                {
                    "product_type": "reanalysis",
                    "variable": _ERA5_VARIABLES,
                    "year": str(year),
                    "month": month_str,
                    "day": days,
                    "time": times,
                    "area": area,
                    "format": "netcdf",
                },
                tmp_path,
            )

            # CDS v2 API wraps NetCDF(s) in a zip archive.
            # ERA5 splits instant vars (t2m, wind…) and accumulated vars (tp, sf…)
            # into separate nc files — extract all and merge on timestamp.
            if zipfile.is_zipfile(tmp_path):
                nc_paths_extracted: list[str] = []
                with zipfile.ZipFile(tmp_path, "r") as zf:
                    nc_names = [n for n in zf.namelist() if n.endswith(".nc")]
                    if not nc_names:
                        raise RuntimeError(f"No .nc file inside zip for {loc_id} {year}-{month_str}")
                    for i, nc_name in enumerate(nc_names):
                        extracted = tmp_path.replace(".zip", f"_{i}.nc")
                        with zf.open(nc_name) as src, open(extracted, "wb") as dst:
                            dst.write(src.read())
                        nc_paths_extracted.append(extracted)

                frames_from_zip: list[pd.DataFrame] = []
                for nc_p in nc_paths_extracted:
                    ds = xr.open_dataset(nc_p, engine="netcdf4")
                    frames_from_zip.append(_process_era5_ds(ds, lat, lon))
                    Path(nc_p).unlink(missing_ok=True)

                # Merge instant + accum DataFrames on timestamp (outer join keeps all hours)
                if len(frames_from_zip) == 1:
                    df_month = frames_from_zip[0]
                else:
                    df_month = frames_from_zip[0]
                    for extra_df in frames_from_zip[1:]:
                        # Only merge columns that aren't already present
                        new_cols = [c for c in extra_df.columns if c not in df_month.columns]
                        if "timestamp" in extra_df.columns and new_cols:
                            df_month = df_month.merge(
                                extra_df[["timestamp"] + new_cols],
                                on="timestamp", how="outer",
                            )
            else:
                ds = xr.open_dataset(tmp_path, engine="netcdf4")
                df_month = _process_era5_ds(ds, lat, lon)

            monthly_frames.append(df_month)

        except Exception as exc:
            logger.warning(f"    ERA5 fetch failed — {loc_id} {year}-{month_str}: {exc}")
        finally:
            if tmp_path:
                Path(tmp_path).unlink(missing_ok=True)

    if not monthly_frames:
        logger.warning(f"    ERA5: no months retrieved for {loc_id} {year}")
        return None

    return pd.concat(monthly_frames, ignore_index=True)


def _per_loc_cache_path(loc_id: str, year: int, hourly_vars: str) -> Path:
    """Return per-(location, year) parquet cache path."""
    vars_hash = hashlib.md5(hourly_vars.encode()).hexdigest()[:8]
    return _PER_LOC_CACHE_DIR / f"{loc_id}_{year}_{vars_hash}.parquet"


async def _fetch_om_location_year(
    session: "aiohttp.ClientSession",
    loc: dict,
    year: int,
    hourly_vars: str,
) -> pd.DataFrame | None:
    """Fetch one calendar year of Open-Meteo archive data for a single location.

    Checks a per-(location, year) parquet cache before making any network
    request — this means previously-fetched data is reused across ALL training
    runs even when the overall batch parameters (date range, location list)
    change.  A 429 from the server triggers a global cooldown that pauses ALL
    pending requests for 3 minutes, avoiding thundering-herd re-retries on the
    same rate-limited endpoint.
    """
    import time as _time
    global _OM_GLOBAL_COOLDOWN_EVENT, _OM_GLOBAL_COOLDOWN_UNTIL

    # --- Per-location-year disk cache check ---
    cache_path = _per_loc_cache_path(loc["id"], year, hourly_vars)
    if cache_path.exists():
        try:
            df = pd.read_parquet(cache_path)
            logger.debug(f"    ✓ cache hit: {loc['id']} {year}")
            return df
        except Exception:
            cache_path.unlink(missing_ok=True)  # corrupted — re-fetch

    # --- Global cooldown: wait if a recent 429 hit ---
    if _OM_GLOBAL_COOLDOWN_UNTIL > _time.monotonic():
        remaining = _OM_GLOBAL_COOLDOWN_UNTIL - _time.monotonic()
        logger.info(f"    Waiting {remaining:.0f}s (global 429 cooldown) for {loc['id']} {year}")
        await asyncio.sleep(max(0.0, remaining))

    start = f"{year}-01-01"
    end   = f"{year}-12-31"
    params = {
        "latitude":   loc["lat"],
        "longitude":  loc["lon"],
        "start_date": start,
        "end_date":   end,
        "hourly":     hourly_vars,
        "timezone":   "UTC",
    }

    for attempt in range(_OM_MAX_RETRIES):
        try:
            async with session.get(
                _ARCHIVE_URL, params=params,
                timeout=aiohttp.ClientTimeout(total=120),
            ) as resp:
                if resp.status == 429:
                    # Set global cooldown so ALL other pending requests pause too
                    cooldown = _OM_RETRY_429_SLEEP * (2 ** attempt)
                    _OM_GLOBAL_COOLDOWN_UNTIL = _time.monotonic() + cooldown
                    logger.warning(
                        f"    Open-Meteo 429 for {loc['id']} {year} — "
                        f"global cooldown {cooldown}s (attempt {attempt+1}/{_OM_MAX_RETRIES})"
                    )
                    await asyncio.sleep(cooldown)
                    continue
                resp.raise_for_status()
                data = await resp.json()
        except asyncio.TimeoutError:
            logger.warning(f"    Open-Meteo timeout for {loc['id']} {year} (attempt {attempt+1})")
            await asyncio.sleep(15 * (attempt + 1))
            continue
        except Exception as exc:
            if attempt < _OM_MAX_RETRIES - 1:
                await asyncio.sleep(15)
                continue
            logger.warning(f"    Open-Meteo failed for {loc['id']} {year}: {exc}")
            return None

        hourly = data.get("hourly", {})
        if not hourly or "time" not in hourly:
            logger.warning(f"    Open-Meteo: empty response for {loc['id']} {year}")
            return None

        df = pd.DataFrame(hourly)
        df = df.rename(columns={"time": "timestamp"})
        df["timestamp"] = pd.to_datetime(df["timestamp"], utc=False)

        # Write per-location-year cache
        try:
            df.to_parquet(cache_path, index=False)
        except Exception as exc:
            logger.debug(f"    Per-loc cache write failed for {loc['id']} {year}: {exc}")

        return df

    logger.warning(f"    Open-Meteo: exhausted retries for {loc['id']} {year}")
    return None


async def fetch_multi_location_weather(
    locations: list[dict] | None = None,
    start_date: str = "2015-01-01",
    end_date: str = "2025-12-31",
    hourly_vars: str | None = None,
) -> pd.DataFrame:
    """Fetch hourly historical weather for multiple locations via Open-Meteo archive.

    Uses the Open-Meteo ERA5-backed archive API (archive-api.open-meteo.com)
    with conservative rate limiting (≤2 concurrent, 0.35s inter-request sleep,
    exponential back-off on 429) to reliably stay within the free-tier limits.

    One request is made per (location, calendar year), so for 27 locations ×
    8 years = 216 requests.  At 2 concurrent with ~2s average response time,
    the total fetch time is roughly 216 / 2 × 2s ≈ 4 minutes.

    Parameters
    ----------
    locations : list[dict], optional
        Dicts with keys ``id``, ``lat``, ``lon``, ``region``.
        Defaults to UK_GRID_LOCATIONS.
    start_date, end_date : str
        Date range ``YYYY-MM-DD``.
    hourly_vars : str, optional
        Comma-separated Open-Meteo hourly variable names.
        Defaults to EXTENDED_HOURLY_VARS.
    """
    if locations is None:
        locations = UK_GRID_LOCATIONS
    if hourly_vars is None:
        hourly_vars = EXTENDED_HOURLY_VARS

    # --- Disk cache ---
    cache_key = hashlib.md5(
        f"om|{sorted(l['id'] for l in locations)}|{start_date}|{end_date}|{hourly_vars}".encode()
    ).hexdigest()[:12]
    cache_path = _CACHE_DIR / f"weather_{cache_key}.csv"

    if cache_path.exists():
        logger.info(f"  Cache hit: {cache_path.name}")
        cached = pd.read_csv(cache_path, parse_dates=["timestamp"])
        logger.info(f"  Cached: {len(cached):,} rows / {cached['station_id'].nunique()} stations")
        return cached

    start_year = int(start_date[:4])
    end_year   = int(end_date[:4])
    years      = list(range(start_year, end_year + 1))
    n_jobs     = len(locations) * len(years)

    logger.info(
        f"  Open-Meteo: {len(locations)} locations × {len(years)} years "
        f"= {n_jobs} requests (≤{_OM_MAX_CONCURRENT} concurrent)"
    )

    semaphore  = asyncio.Semaphore(_OM_MAX_CONCURRENT)
    all_frames: list[pd.DataFrame] = []

    async def fetch_one(loc: dict, year: int) -> None:
        async with semaphore:
            await asyncio.sleep(_OM_INTER_REQ_SLEEP)
            df = await _fetch_om_location_year(session, loc, year, hourly_vars)
            if df is not None and not df.empty:
                df["station_id"] = loc["id"]
                df["region"]     = loc.get("region", "unknown")
                df["latitude"]   = loc["lat"]
                df["longitude"]  = loc["lon"]
                all_frames.append(df)
                logger.info(f"    ✓ {loc['id']} {year} — {len(df):,} rows")

    connector = aiohttp.TCPConnector(limit=_OM_MAX_CONCURRENT)
    async with aiohttp.ClientSession(connector=connector) as session:
        tasks = [fetch_one(loc, yr) for loc in locations for yr in years]
        await asyncio.gather(*tasks)

    if not all_frames:
        logger.error("Open-Meteo fetch returned no data for any location.")
        return pd.DataFrame()

    result = pd.concat(all_frames, ignore_index=True)

    result["timestamp"] = pd.to_datetime(result["timestamp"], errors="coerce")
    result = result.dropna(subset=["timestamp"])
    mask = (
        (result["timestamp"] >= pd.Timestamp(start_date))
        & (result["timestamp"] <= pd.Timestamp(end_date) + pd.Timedelta(days=1))
    )
    result = result[mask].sort_values("timestamp").reset_index(drop=True)

    logger.info(
        f"  Fetch complete: {len(result):,} rows from {result['station_id'].nunique()} stations"
    )

    try:
        result.to_csv(cache_path, index=False)
        logger.info(f"  Cached → {cache_path.name}")
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

        # Rainfall rolling-window features — built from Open-Meteo `precipitation` column.
        # compute_rainfall_features() needs a `rainfall_mm` column; we map precipitation→rainfall_mm.
        precip_col = next(
            (c for c in ["precipitation", "precipitation_sum", "rain"] if c in grp.columns),
            None,
        )
        if precip_col is not None:
            rain_input = grp[["timestamp"]].copy()
            rain_input["station_id"] = station_id
            rain_input["rainfall_mm"] = grp[precip_col].clip(lower=0.0).fillna(0.0)
            try:
                rf = feature_engineer.compute_rainfall_features(rain_input)
                # rf is indexed by (timestamp, station_id) — drop station_id level, align
                rf_flat = rf.reset_index()
                rf_flat = rf_flat.drop(columns=["station_id"], errors="ignore")
                rf_flat = rf_flat.set_index("timestamp")
                # Merge into combined (which has DatetimeIndex)
                rf_aligned = rf_flat.reindex(combined.index)
                for col in rf_aligned.columns:
                    if col not in combined.columns:
                        combined[col] = rf_aligned[col].values
                # Log on first station only to avoid log spam
                if len(station_frames) == 0:
                    non_zero = (rf_aligned.get("rainfall_1h", pd.Series([0])) > 0).sum()
                    logger.debug(
                        f"Rainfall features: {len(rf_aligned.columns)} cols, "
                        f"{non_zero}/{len(rf_aligned)} non-zero rainfall_1h rows"
                    )
            except Exception as rf_err:
                logger.warning(f"compute_rainfall_features failed for {station_id}: {rf_err}")
        else:
            logger.warning(
                f"No precipitation column found for station {station_id} — "
                "rainfall_* features will be absent. Tag: partial_features."
            )

        # FAO-56 Penman-Monteith ET0 — derived from ERA5 variables so the feature
        # is always physically correct regardless of whether Open-Meteo provided it.
        # If Open-Meteo already supplied et0_fao_evapotranspiration it is used directly;
        # otherwise we compute it from T, RH, wind, radiation, and pressure.
        if "et0_fao_evapotranspiration" not in combined.columns or (
            combined["et0_fao_evapotranspiration"].abs().max() < 1e-9
        ):
            try:
                T   = grp["temperature_2m"].values.astype(np.float64)
                RH  = grp.get("relative_humidity_2m", pd.Series(np.full(len(grp), 60.0))).values.astype(np.float64)
                u10 = grp.get("wind_speed_10m", pd.Series(np.full(len(grp), 2.0))).values.astype(np.float64)
                Rs  = grp.get("shortwave_radiation", pd.Series(np.zeros(len(grp)))).values.astype(np.float64)
                # Pressure → kPa.  ERA5 cache stores pressure in hPa (÷100 from Pa).
                # Open-Meteo also returns hPa. Detect unit by magnitude:
                #   Pa:  ~100000  (mean > 2000)
                #   hPa: ~1013    (mean 900–1100)
                #   kPa: ~101.3   (mean < 200)
                if "surface_pressure" in grp.columns:
                    _p_raw = grp["surface_pressure"].values.astype(np.float64)
                elif "pressure_msl" in grp.columns:
                    _p_raw = grp["pressure_msl"].values.astype(np.float64)
                else:
                    _p_raw = np.full(len(grp), 101300.0)  # default Pa
                _pmean = float(np.nanmean(_p_raw))
                if _pmean > 2000:        # Pa → kPa
                    P = _p_raw / 1000.0
                elif _pmean > 200:       # hPa → kPa
                    P = _p_raw / 10.0
                else:                    # already kPa
                    P = _p_raw
                P = np.clip(P, 60.0, 110.0)  # physically valid range (kPa)

                RH  = np.clip(RH, 1.0, 100.0)
                u10 = np.maximum(u10, 0.0)
                Rs  = np.maximum(Rs, 0.0)

                # Wind speed at 2 m from 10 m (FAO-56 log-profile correction)
                u2 = u10 * (4.87 / np.log(67.8 * 10.0 - 5.42))  # ≈ 0.748 * u10

                # Saturation vapour pressure (kPa) at temperature T
                es = 0.6108 * np.exp(17.27 * T / (T + 237.3))
                # Actual vapour pressure from relative humidity
                ea = es * RH / 100.0

                # Slope of saturation vapour pressure curve (kPa/°C)
                delta = 4098.0 * es / (T + 237.3) ** 2

                # Psychrometric constant (kPa/°C): γ = 0.000665 × P (FAO-56 eq. 8)
                gamma = 0.000665 * P

                # Net shortwave radiation: Rns = (1 − 0.23) × Rs [MJ/m²/h]
                Rs_mj = Rs * 0.0036   # W/m² × 3600 s/h × 1e-6 MJ/J → MJ/m²/h
                Rns = 0.77 * Rs_mj

                # Net long-wave radiation (FAO-56 eq. 39, simplified for hourly)
                sigma_h = 2.042e-10   # Stefan-Boltzmann constant MJ/K⁴/m²/h
                T_K = T + 273.16
                ea_safe = np.maximum(ea, 0.001)
                Rnl = sigma_h * T_K ** 4 * (0.34 - 0.14 * np.sqrt(ea_safe))
                # Cloud correction: Rs_so (clear-sky) ≈ (0.75 + 2e-5 × 0) × Ra
                # Simplified: clamp Rnl to reasonable range
                Rnl = np.clip(Rnl, 0.0, 0.5)

                # Net radiation
                Rn = Rns - Rnl

                # Soil heat flux G (FAO-56 eq. 45–46): day=0.1·Rn, night=0.5·Rn
                G = np.where(Rs > 0, 0.1 * Rn, 0.5 * Rn)

                # ET0 (mm/h) — FAO-56 Penman-Monteith (hourly form, eq. 53)
                T_safe = T + 273.0
                numerator   = (0.408 * delta * (Rn - G)
                               + gamma * (37.0 / T_safe) * u2 * (es - ea))
                denominator = delta + gamma * (1.0 + 0.34 * u2)
                et0 = np.where(denominator > 1e-9, numerator / denominator, 0.0)
                et0 = np.maximum(et0, 0.0)   # ET0 is non-negative

                combined["et0_fao_evapotranspiration"] = et0
            except Exception as _et0_err:
                logger.warning(f"ET0 computation failed for {station_id}: {_et0_err}")

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

