"""
File: multi_location_weather.py

What this file does:
Fetches current weather for multiple regions concurrently using asyncio.
Builds a lat/lon batch request to Open-Meteo, parses the response into
a keyed dict, and caches results for the configured TTL. Used to populate
the FeatureStore when prediction requests come in from multiple regions.

How it connects:
- Called by ai-engine/app/core/feature_store.py for multi-region updates
- Region coordinates from ai-engine/registry/region_registry.py
- Results merged into per-hazard feature vectors by FeatureStore
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
_MAX_RETRIES = 8            # retries on HTTP 429 (was 5; 8 allows up to ~53min per chunk)
_BACKOFF_BASE = 15.0        # initial backoff seconds, doubles each retry
_CACHE_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "cache" / "multi_location_weather"

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
        for chunk_idx, (chunk_start, chunk_end) in enumerate(chunks):
            # Inter-chunk pause — lets the Open-Meteo rate-limit window (1 min)
            # reset between year-chunks so we never send bursts back-to-back.
            if chunk_idx > 0:
                await asyncio.sleep(90.0)
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

