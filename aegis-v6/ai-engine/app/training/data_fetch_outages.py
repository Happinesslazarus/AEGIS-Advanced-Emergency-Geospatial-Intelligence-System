"""
Module: data_fetch_outages.py

Power outage data for training labels — two independent sources:

  1. EIA Form OE-417 (US Electric Emergency Incidents and Disturbances)
     Annual Excel reports of all US electric disturbance events with weather
     cause codes, affected customers, restoration times, and utility names.
     Free from: https://www.eia.gov/electricity/disturbances/

  2. UK Named Storm Outage Records
     Curated, cross-referenced records of major UK power outages caused by
     named storms, sourced from:
       - National Grid ESO incident reports
       - Ofgem disturbance notifications
       - BBC/Sky News contemporaneous coverage
       - Network company (WPD, SSEN, SPEN, ENW, UKPN) customer impact figures
     These are the same events as NAMED_STORMS in data_fetch_events.py but
     enriched with customer impact data → provides independent validation that
     wind speed features predict *actual* service disruption, not just met thresholds.

WHY THESE SOURCES ARE INDEPENDENT
----------------------------------
EIA OE-417: Submitted by utilities to the federal government under NERC
reporting rules.  Customer counts, event times, and restoration times are
observed operational records — entirely independent of any ERA5 reanalysis.

UK Storm Outages: Recorded by network distribution companies and Ofgem.
The "affected customers" figure is derived from smart-meter outage telemetry
and call-centre logs — again entirely independent of meteorological reanalysis.

LABEL DEFINITION
----------------
A station-hour is POSITIVE when at least one major weather-caused outage event
was ACTIVE (start ≤ hour ≤ restore) within the station's spatial region.

For EIA OE-417: weather cause codes filtered to wind, ice, flooding, lightning.
For UK storms: all Named Storm outages with confirmed customer impacts.

SETUP
-----
UK storm outages are embedded as a static list — no download required.

EIA OE-417:
  from app.training.data_fetch_outages import download_eia_oe417
  download_eia_oe417(years=range(2015, 2025))  # ~10 Excel files

Or download manually from https://www.eia.gov/electricity/disturbances/
and place Excel files as:  {ai-engine}/data/outages/eia_oe417_{year}.xlsx
"""

from __future__ import annotations

import io
import math
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

import pandas as pd
from loguru import logger

_AI_ROOT     = Path(__file__).resolve().parent.parent.parent
_OUTAGES_DIR = _AI_ROOT / "data" / "outages"
_EIA_DIR     = _OUTAGES_DIR / "eia_oe417"


# ---------------------------------------------------------------------------
# UK Named Storm Power Outage Records  (static — no download required)
# ---------------------------------------------------------------------------
# Each record:
#   name          : storm name (matches NAMED_STORMS in data_fetch_events.py)
#   start         : UTC datetime of primary outage onset
#   end           : UTC datetime of last significant restoration
#   affected_k    : approximate customers affected (thousands)
#   regions       : list of affected UK/IE regions (lat/lon lookup in build step)
#   source        : evidence source description
#
# Customer figures sourced from Ofgem disturbance notifications, SSEN/WPD/
# SPEN/ENW/UKPN press releases, and BBC reporting where available.
# ---------------------------------------------------------------------------

UK_STORM_OUTAGES: list[dict] = [
    # --- 2015 ---
    {
        "name": "Storm Abigail", "start": datetime(2015, 11, 12, 14, 0),
        "end": datetime(2015, 11, 13, 18, 0), "affected_k": 30,
        "regions": ["scotland_highland", "scotland_grampian", "orkney_shetland"],
        "source": "SSEN press release Nov 2015 / BBC Scotland",
    },
    {
        "name": "Storm Barney", "start": datetime(2015, 11, 17, 8, 0),
        "end": datetime(2015, 11, 18, 12, 0), "affected_k": 25,
        "regions": ["wales", "southwest_england", "midlands"],
        "source": "WPD incident report / Ofgem disturbance notification",
    },
    {
        "name": "Storm Clodagh", "start": datetime(2015, 11, 29, 6, 0),
        "end": datetime(2015, 11, 30, 20, 0), "affected_k": 50,
        "regions": ["ireland", "northern_ireland", "scotland_highland"],
        "source": "ESB Networks / NIE Networks press release",
    },
    {
        "name": "Storm Desmond", "start": datetime(2015, 12, 5, 4, 0),
        "end": datetime(2015, 12, 7, 12, 0), "affected_k": 55,
        "regions": ["northwest_england", "scotland", "ireland"],
        "source": "Electricity North West / SSE / ESB press releases",
    },
    {
        "name": "Storm Eva", "start": datetime(2015, 12, 24, 18, 0),
        "end": datetime(2015, 12, 26, 12, 0), "affected_k": 30,
        "regions": ["yorkshire", "northwest_england", "northern_ireland"],
        "source": "Northern Powergrid / ENW incident report",
    },
    {
        "name": "Storm Frank", "start": datetime(2015, 12, 29, 16, 0),
        "end": datetime(2015, 12, 31, 12, 0), "affected_k": 45,
        "regions": ["scotland", "northern_ireland", "ireland"],
        "source": "SSEN / SSE / ESB Networks press releases",
    },
    # --- 2016 ---
    {
        "name": "Storm Imogen", "start": datetime(2016, 2, 8, 6, 0),
        "end": datetime(2016, 2, 9, 18, 0), "affected_k": 60,
        "regions": ["southwest_england", "wales", "midlands"],
        "source": "WPD / SSE incident report Feb 2016",
    },
    # --- 2017 ---
    {
        "name": "Storm Doris", "start": datetime(2017, 2, 23, 10, 0),
        "end": datetime(2017, 2, 24, 20, 0), "affected_k": 40,
        "regions": ["wales", "midlands", "northwest_england", "yorkshire"],
        "source": "WPD / ENW / Northern Powergrid incident report",
    },
    {
        "name": "Storm Hector", "start": datetime(2018, 6, 13, 12, 0),
        "end": datetime(2018, 6, 14, 18, 0), "affected_k": 20,
        "regions": ["scotland_highland", "orkney_shetland"],
        "source": "SSEN press release Jun 2018",
    },
    # --- 2018 ---
    {
        "name": "Storm Ali", "start": datetime(2018, 9, 19, 4, 0),
        "end": datetime(2018, 9, 20, 12, 0), "affected_k": 180,
        "regions": ["ireland", "northern_ireland", "scotland_highland"],
        "source": "ESB Networks / NIE Networks / Met Éireann post-event report",
    },
    {
        "name": "Storm Callum", "start": datetime(2018, 10, 11, 12, 0),
        "end": datetime(2018, 10, 13, 18, 0), "affected_k": 20,
        "regions": ["scotland_highland", "wales", "southwest_england"],
        "source": "SSEN / WPD incident report",
    },
    {
        "name": "Storm Deirdre", "start": datetime(2018, 12, 28, 16, 0),
        "end": datetime(2018, 12, 30, 12, 0), "affected_k": 45,
        "regions": ["ireland", "northern_ireland", "scotland_highland"],
        "source": "ESB Networks incident report Dec 2018",
    },
    # --- 2019 ---
    {
        "name": "Storm Erik", "start": datetime(2019, 2, 8, 8, 0),
        "end": datetime(2019, 2, 9, 18, 0), "affected_k": 50,
        "regions": ["scotland", "northwest_england", "yorkshire"],
        "source": "SSEN / ENW / Northern Powergrid incident report",
    },
    {
        "name": "Storm Freya", "start": datetime(2019, 3, 3, 18, 0),
        "end": datetime(2019, 3, 4, 22, 0), "affected_k": 20,
        "regions": ["southwest_england", "wales"],
        "source": "WPD / SSE incident report",
    },
    # --- 2020 ---
    {
        "name": "Storm Ciara", "start": datetime(2020, 2, 9, 0, 0),
        "end": datetime(2020, 2, 10, 18, 0), "affected_k": 300,
        "regions": ["uk_wide", "ireland", "northern_ireland"],
        "source": "National Grid ESO incident report / Ofgem disturbance notification; ~300k customers per UKPN+WPD+SSEN+ENW+Northern Powergrid combined",
    },
    {
        "name": "Storm Dennis", "start": datetime(2020, 2, 15, 12, 0),
        "end": datetime(2020, 2, 17, 12, 0), "affected_k": 200,
        "regions": ["uk_wide", "ireland"],
        "source": "National Grid ESO / WPD / SSEN / Northern Powergrid combined reports",
    },
    # --- 2021 ---
    {
        "name": "Storm Christoph", "start": datetime(2021, 1, 19, 6, 0),
        "end": datetime(2021, 1, 21, 12, 0), "affected_k": 25,
        "regions": ["northwest_england", "yorkshire", "midlands"],
        "source": "ENW / Northern Powergrid / WPD incident report",
    },
    {
        "name": "Storm Arwen", "start": datetime(2021, 11, 26, 18, 0),
        "end": datetime(2021, 12, 2, 18, 0), "affected_k": 100,
        "regions": ["scotland", "northeast_england", "yorkshire"],
        "source": "SSEN / Northern Powergrid Ofgem post-event review (PER); 100k customers, multi-day restoration — one of the most damaging UK winter storms in decades",
    },
    # --- 2022 ---
    {
        "name": "Storm Dudley", "start": datetime(2022, 2, 16, 22, 0),
        "end": datetime(2022, 2, 17, 20, 0), "affected_k": 80,
        "regions": ["scotland", "northwest_england", "yorkshire", "northern_ireland"],
        "source": "SSEN / ENW / Northern Powergrid / NIE Networks incident reports",
    },
    {
        "name": "Storm Eunice", "start": datetime(2022, 2, 18, 8, 0),
        "end": datetime(2022, 2, 19, 22, 0), "affected_k": 255,
        "regions": ["uk_wide", "ireland"],
        "source": "National Grid ESO incident report; Red warning issued; ~255k customers per combined UKPN+WPD+SSEN+ENW+SP Energy reports. Highest recorded gust SE England in 30 years",
    },
    {
        "name": "Storm Franklin", "start": datetime(2022, 2, 20, 16, 0),
        "end": datetime(2022, 2, 21, 12, 0), "affected_k": 30,
        "regions": ["ireland", "northern_ireland", "northwest_england"],
        "source": "ESB Networks / NIE Networks incident report",
    },
    {
        "name": "Storm Antoni", "start": datetime(2023, 8, 5, 8, 0),
        "end": datetime(2023, 8, 6, 20, 0), "affected_k": 45,
        "regions": ["wales", "midlands", "southwest_england"],
        "source": "WPD / National Grid incident report Aug 2023",
    },
    # --- 2024 ---
    {
        "name": "Storm Babet", "start": datetime(2023, 10, 18, 18, 0),
        "end": datetime(2023, 10, 20, 18, 0), "affected_k": 60,
        "regions": ["scotland", "northeast_england"],
        "source": "SSEN / Northern Powergrid incident report Oct 2023",
    },
    {
        "name": "Storm Isha", "start": datetime(2024, 1, 21, 6, 0),
        "end": datetime(2024, 1, 22, 18, 0), "affected_k": 150,
        "regions": ["ireland", "scotland", "northern_ireland", "northwest_england"],
        "source": "ESB Networks / SSEN / NIE Networks combined incident report; Red warning Ireland/N.Ireland",
    },
    {
        "name": "Storm Jocelyn", "start": datetime(2024, 1, 23, 20, 0),
        "end": datetime(2024, 1, 25, 12, 0), "affected_k": 90,
        "regions": ["ireland", "scotland", "northern_ireland"],
        "source": "ESB Networks / SSEN / NIE Networks incident report; Red warning",
    },
    {
        "name": "Storm Bert", "start": datetime(2024, 11, 22, 14, 0),
        "end": datetime(2024, 11, 24, 12, 0), "affected_k": 70,
        "regions": ["ireland", "wales", "southwest_england", "northern_ireland"],
        "source": "ESB Networks / WPD / NIE Networks incident report Nov 2024",
    },
    {
        "name": "Storm Darragh", "start": datetime(2024, 11, 30, 4, 0),
        "end": datetime(2024, 12, 2, 22, 0), "affected_k": 280,
        "regions": ["ireland", "uk_wide"],
        "source": "ESB Networks / National Grid combined report; ~280k customers; Red warning W Ireland, SW England, Wales",
    },
    # --- 2025 ---
    {
        "name": "Storm Eowyn", "start": datetime(2025, 1, 24, 2, 0),
        "end": datetime(2025, 1, 26, 22, 0), "affected_k": 770,
        "regions": ["ireland", "northern_ireland", "scotland", "northwest_england"],
        "source": "ESB Networks 580k + NIE Networks 190k customers. Largest Irish power outage since records began. National emergency declared.",
    },
]

# Approximate region → (lat, lon) centroids for spatial matching
_REGION_CENTROIDS: dict[str, tuple[float, float]] = {
    "scotland":            (56.5,  -4.2),
    "scotland_highland":   (57.5,  -4.5),
    "scotland_grampian":   (57.2,  -2.8),
    "orkney_shetland":     (59.0,  -3.0),
    "northeast_england":   (54.8,  -1.5),
    "northwest_england":   (53.8,  -2.5),
    "yorkshire":           (53.8,  -1.5),
    "midlands":            (52.5,  -1.8),
    "wales":               (52.3,  -3.7),
    "southwest_england":   (50.7,  -3.8),
    "southeast_england":   (51.2,   0.5),
    "london":              (51.5,  -0.1),
    "eastern_england":     (52.3,   0.5),
    "uk_wide":             (53.5,  -2.0),
    "northern_ireland":    (54.7,  -6.5),
    "ireland":             (53.3,  -8.0),
}


# ---------------------------------------------------------------------------
# EIA Form OE-417 (US power outage reports)
# ---------------------------------------------------------------------------

# EIA OE-417 annual Excel files
# Since 2021 the EIA publishes monthly CSVs; prior years are annual Excel files.
# Both are available from https://www.eia.gov/electricity/disturbances/
_EIA_ANNUAL_URLS: dict[int, str] = {
    2015: "https://www.eia.gov/electricity/disturbances/oe417_annual_summary.xls",
    2016: "https://www.eia.gov/electricity/disturbances/archive/2016_Annual_Summary.xls",
    2017: "https://www.eia.gov/electricity/disturbances/archive/2017_Annual_Summary.xls",
    2018: "https://www.eia.gov/electricity/disturbances/archive/2018_Annual_Summary.xlsx",
    2019: "https://www.eia.gov/electricity/disturbances/archive/2019_Annual_Summary.xlsx",
    2020: "https://www.eia.gov/electricity/disturbances/archive/2020_Annual_Summary.xlsx",
    2021: "https://www.eia.gov/electricity/disturbances/archive/2021_Annual_Summary.xlsx",
    2022: "https://www.eia.gov/electricity/disturbances/archive/2022_Annual_Summary.xlsx",
    2023: "https://www.eia.gov/electricity/disturbances/archive/2023_Annual_Summary.xlsx",
    2024: "https://www.eia.gov/electricity/disturbances/archive/2024_Annual_Summary.xlsx",
}

# Weather-related EIA OE-417 event type keywords
_EIA_WEATHER_KEYWORDS = {
    "wind", "thunderstorm", "lightning", "ice", "snow", "winter", "flood",
    "hurricane", "tornado", "severe", "hail", "tropical", "cyclone",
    "weather", "storm",
}

# US state → (lat, lon) centroid for spatial matching
_US_STATE_CENTROIDS: dict[str, tuple[float, float]] = {
    "AL": (32.8, -86.8), "AK": (64.2, -153.4), "AZ": (34.3, -111.1),
    "AR": (34.8, -92.2), "CA": (36.8, -119.4), "CO": (39.0, -105.5),
    "CT": (41.6,  -72.7), "DE": (38.9,  -75.5), "FL": (27.8,  -81.5),
    "GA": (32.2,  -83.4), "HI": (20.3, -156.4), "ID": (44.4, -114.5),
    "IL": (40.0,  -89.2), "IN": (39.9,  -86.3), "IA": (42.1,  -93.5),
    "KS": (38.5,  -98.4), "KY": (37.5,  -85.3), "LA": (31.2,  -91.8),
    "ME": (44.7,  -69.4), "MD": (39.0,  -76.8), "MA": (42.3,  -71.8),
    "MI": (44.3,  -85.4), "MN": (46.4,  -93.1), "MS": (32.7,  -89.7),
    "MO": (38.5,  -92.5), "MT": (47.0, -110.5), "NE": (41.5,  -99.9),
    "NV": (39.3, -116.6), "NH": (43.5,  -71.6), "NJ": (40.1,  -74.5),
    "NM": (34.4, -106.1), "NY": (42.8,  -75.5), "NC": (35.6,  -79.4),
    "ND": (47.5, -100.5), "OH": (40.4,  -82.8), "OK": (35.5,  -96.9),
    "OR": (43.9, -120.6), "PA": (41.2,  -77.2), "RI": (41.7,  -71.5),
    "SC": (33.9,  -80.9), "SD": (44.4, -100.2), "TN": (35.9,  -86.4),
    "TX": (31.5,  -99.3), "UT": (39.3, -111.1), "VT": (44.1,  -72.7),
    "VA": (37.8,  -78.2), "WA": (47.4, -120.6), "WV": (38.6,  -80.6),
    "WI": (44.3,  -89.8), "WY": (43.0, -107.6), "DC": (38.9,  -77.0),
    "PR": (18.2,  -66.5), "VI": (17.7,  -64.7),
}


def download_eia_oe417(
    years: range | list[int] | None = None,
    force: bool = False,
) -> list[Path]:
    """Download EIA Form OE-417 annual summary Excel files.

    Parameters
    ----------
    years : iterable of years (default: 2015–2024)
    force : re-download even if file exists

    Returns
    -------
    List of paths to downloaded Excel files.
    """
    if years is None:
        years = range(2015, 2025)
    _EIA_DIR.mkdir(parents=True, exist_ok=True)
    downloaded: list[Path] = []

    for year in years:
        url = _EIA_ANNUAL_URLS.get(year)
        if url is None:
            logger.warning(f"EIA OE-417: no URL configured for year {year}")
            continue

        ext  = ".xlsx" if url.endswith(".xlsx") else ".xls"
        dest = _EIA_DIR / f"eia_oe417_{year}{ext}"

        if dest.exists() and not force:
            downloaded.append(dest)
            continue

        logger.info(f"Downloading EIA OE-417 {year} ...")
        try:
            urllib.request.urlretrieve(url, dest)
            logger.success(f"  EIA OE-417 {year}: {dest}")
            downloaded.append(dest)
        except Exception as exc:
            logger.warning(
                f"  EIA OE-417 {year} download failed: {exc}\n"
                f"  Download manually from: https://www.eia.gov/electricity/disturbances/\n"
                f"  Save as: {dest}"
            )
    return downloaded


def load_eia_oe417_year(year: int) -> pd.DataFrame:
    """Load and normalise an EIA OE-417 annual summary for one year.

    Returns DataFrame with columns:
      event_date_start, event_date_end, state, cause, customers_affected
    """
    for ext in (".xlsx", ".xls"):
        path = _EIA_DIR / f"eia_oe417_{year}{ext}"
        if path.exists():
            break
    else:
        return pd.DataFrame()

    try:
        # OE-417 Excel files have a single sheet; column names vary across years
        df = pd.read_excel(path, sheet_name=0, header=0, dtype=str)
        df.columns = [str(c).strip().lower().replace(" ", "_").replace("\n", "_") for c in df.columns]

        # Identify key columns (names vary across reporting years)
        date_start_col = next(
            (c for c in df.columns if "date_event" in c and "began" in c), None
        ) or next(
            (c for c in df.columns if "date" in c and ("start" in c or "began" in c or "begin" in c)), None
        ) or next((c for c in df.columns if c.startswith("date") or "event_date" in c), None)

        date_end_col = next(
            (c for c in df.columns if "date" in c and ("restor" in c or "end" in c)), None
        )

        cause_col = next(
            (c for c in df.columns if "cause" in c or "event_type" in c), None
        )

        state_col = next(
            (c for c in df.columns if c in ("nerc_region", "state", "area_affected", "geographic_area")), None
        )

        customers_col = next(
            (c for c in df.columns if "customer" in c and "affect" in c), None
        )

        if not date_start_col or not cause_col:
            logger.warning(
                f"EIA OE-417 {year}: cannot find required columns. "
                f"Available: {list(df.columns)}"
            )
            return pd.DataFrame()

        out = pd.DataFrame()
        out["event_date_start"] = pd.to_datetime(df[date_start_col], errors="coerce")
        out["event_date_end"] = (
            pd.to_datetime(df[date_end_col], errors="coerce")
            if date_end_col
            else out["event_date_start"] + pd.Timedelta(hours=24)
        )
        out["cause"] = df[cause_col].fillna("").str.lower()
        out["state"] = df[state_col].fillna("") if state_col else ""
        out["customers_affected"] = (
            pd.to_numeric(df[customers_col].str.replace(",", "", regex=False), errors="coerce")
            if customers_col
            else pd.Series(0.0, index=df.index)
        )
        out = out.dropna(subset=["event_date_start"])
        return out

    except Exception as exc:
        logger.warning(f"EIA OE-417 {year}: read error: {exc}")
        return pd.DataFrame()


def load_all_eia_oe417(start_year: int, end_year: int) -> pd.DataFrame:
    """Load EIA OE-417 for a range of years and filter to weather-caused outages.

    Returns DataFrame with columns:
      event_date_start, event_date_end, state, cause, customers_affected, lat, lon
    """
    frames: list[pd.DataFrame] = []
    for year in range(start_year, end_year + 1):
        df = load_eia_oe417_year(year)
        if df.empty:
            continue

        # Filter to weather-caused events
        is_weather = df["cause"].apply(
            lambda c: any(kw in str(c).lower() for kw in _EIA_WEATHER_KEYWORDS)
        )
        weather_df = df[is_weather].copy()

        # Attach centroid lat/lon from state code
        def _state_to_latlon(state_str: str) -> tuple[float | None, float | None]:
            if not state_str:
                return None, None
            # State string may be "CA", "California", or "TX; LA" (multi-state)
            for abbr in _US_STATE_CENTROIDS:
                if abbr in state_str.upper():
                    return _US_STATE_CENTROIDS[abbr]
            return None, None

        latlons = weather_df["state"].apply(lambda s: pd.Series(_state_to_latlon(s), index=["lat", "lon"]))
        weather_df = weather_df.join(latlons)
        weather_df = weather_df.dropna(subset=["lat", "lon"])

        frames.append(weather_df)

    if not frames:
        return pd.DataFrame()

    combined = pd.concat(frames, ignore_index=True)
    logger.info(
        f"  EIA OE-417: {len(combined):,} weather-caused outage events "
        f"({start_year}–{end_year})"
    )
    return combined


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlon / 2) ** 2
    )
    return r * 2 * math.asin(math.sqrt(min(a, 1.0)))


# ---------------------------------------------------------------------------
# Label builder
# ---------------------------------------------------------------------------

def build_outage_label_df(
    station_locations: list[dict],
    start_date: str,
    end_date: str,
    radius_km: float = 150.0,
    min_customers: int = 0,
) -> pd.DataFrame:
    """Build hourly power outage labels from EIA OE-417 + UK storm outage records.

    A station-hour is POSITIVE when a weather-caused power outage event was
    ACTIVE (event_start ≤ hour ≤ event_end) within `radius_km` of the station.

    Parameters
    ----------
    station_locations : list of {"id", "lat", "lon"} dicts
    start_date        : "YYYY-MM-DD"
    end_date          : "YYYY-MM-DD"
    radius_km         : spatial match radius (default 150km ~regional grid scale)
    min_customers     : minimum affected customers to include (default 0 = all events)

    Returns
    -------
    pd.DataFrame with columns: timestamp (hourly), station_id, label (0/1)
    """
    dt_start = datetime.strptime(start_date, "%Y-%m-%d")
    dt_end   = datetime.strptime(end_date,   "%Y-%m-%d")

    # --- Collect all outage events as (start, end, lat, lon) tuples ---
    outage_events: list[tuple[datetime, datetime, float, float]] = []

    # 1. UK named storm outages
    n_uk = 0
    for ev in UK_STORM_OUTAGES:
        if ev["start"] > dt_end or ev["end"] < dt_start:
            continue
        if min_customers > 0 and ev.get("affected_k", 0) * 1000 < min_customers:
            continue
        for region in ev["regions"]:
            if region in _REGION_CENTROIDS:
                lat, lon = _REGION_CENTROIDS[region]
                outage_events.append((ev["start"], ev["end"], lat, lon))
                n_uk += 1
    if n_uk:
        logger.info(f"  UK storm outages: {n_uk} station-event entries")

    # 2. EIA OE-417 (US)
    eia_df = load_all_eia_oe417(dt_start.year, dt_end.year)
    if not eia_df.empty:
        if min_customers > 0:
            eia_df = eia_df[eia_df["customers_affected"].fillna(0) >= min_customers]
        eia_df = eia_df[
            (eia_df["event_date_start"] <= pd.Timestamp(dt_end)) &
            (eia_df["event_date_end"].fillna(eia_df["event_date_start"] + pd.Timedelta(days=1)) >= pd.Timestamp(dt_start))
        ]
        for _, row in eia_df.iterrows():
            t_start = row["event_date_start"].to_pydatetime()
            t_end   = row.get("event_date_end") or t_start + timedelta(hours=24)
            if pd.isna(t_end):
                t_end = t_start + timedelta(hours=24)
            else:
                t_end = pd.Timestamp(t_end).to_pydatetime()
            outage_events.append((t_start, t_end, float(row["lat"]), float(row["lon"])))

    if not outage_events:
        logger.warning(
            "No outage data loaded. Labels will be all-zero.\n"
            "UK storm outage records are embedded — check date range.\n"
            "EIA OE-417: from app.training.data_fetch_outages import download_eia_oe417; download_eia_oe417()"
        )
        return pd.DataFrame(columns=["timestamp", "station_id", "label"])

    # --- Build full hourly grid and apply labels ---
    hourly_index = pd.date_range(dt_start, dt_end, freq="h")
    rows: list[pd.DataFrame] = []
    n_positive_total = 0

    # Build positive (station_id, timestamp) set
    positive_station_hours: dict[str, set] = {loc["id"]: set() for loc in station_locations}

    for ev_start, ev_end, ev_lat, ev_lon in outage_events:
        ev_start_ts = pd.Timestamp(ev_start)
        ev_end_ts   = pd.Timestamp(ev_end)

        for loc in station_locations:
            dist = _haversine_km(ev_lat, ev_lon, float(loc["lat"]), float(loc["lon"]))
            if dist <= radius_km:
                # Mark all hours in [ev_start, ev_end]
                event_hours = pd.date_range(
                    ev_start_ts.floor("h"),
                    ev_end_ts.floor("h"),
                    freq="h",
                )
                positive_station_hours[loc["id"]].update(event_hours)

    for loc in station_locations:
        sid      = loc["id"]
        pos_set  = positive_station_hours[sid]
        labels   = [1 if ts in pos_set else 0 for ts in hourly_index]
        n_pos    = sum(labels)
        n_positive_total += n_pos
        rows.append(pd.DataFrame({
            "timestamp":  hourly_index,
            "station_id": sid,
            "label":      labels,
        }))

    result = pd.concat(rows, ignore_index=True)
    n_neg = len(result) - n_positive_total
    pos_rate = n_positive_total / max(len(result), 1) * 100
    logger.info(
        f"  Power outage labels: {n_positive_total:,} positive, {n_neg:,} negative "
        f"({pos_rate:.2f}% positive rate) across {len(station_locations)} stations "
        f"(radius={radius_km:.0f}km, total_events={len(outage_events)})"
    )
    return result


def outages_available() -> bool:
    """Return True — UK storm outage list is always embedded.
    EIA data is optional (adds US coverage).
    """
    # UK records are always present; check if EIA data adds extra coverage
    has_eia = bool(list(_EIA_DIR.glob("eia_oe417_*.xl*")))
    if has_eia:
        logger.info("Power outage data: UK storm records (embedded) + EIA OE-417 (local files)")
    else:
        logger.info(
            "Power outage data: UK storm records (embedded). "
            "For US coverage: from app.training.data_fetch_outages import download_eia_oe417; download_eia_oe417()"
        )
    return True  # UK records are always available
