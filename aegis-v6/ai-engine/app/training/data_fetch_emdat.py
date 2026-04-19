"""
EM-DAT (Emergency Events Database) global disaster event catalog loader.

WHY EM-DAT
----------
EM-DAT is maintained by the Centre for Research on the Epidemiology of
Disasters (CRED, Université catholique de Louvain, Belgium) and contains
records of over 22,000 natural and technological disasters worldwide from
1900 to the present.  It is the primary authoritative global disaster
database for academic and policy research.

For AEGIS, EM-DAT provides independent event records that serve as training
labels for multiple hazards:
  - Flood events        → supplement train_flood_real.py
  - Storm events        → supplement train_severe_storm_real.py
  - Heat/drought events → supplement train_heatwave_real.py
  - Landslide events    → supplement train_landslide_real.py
  - Infrastructure damage events → enable train_infrastructure_damage_real.py

REFERENCE
---------
Guha-Sapir, D., Below, R. & Hoyois, Ph. (2015). EM-DAT: The CRED/OFDA
International Disaster Database. Université catholique de Louvain, Brussels.
Available at: https://www.emdat.be

ACCESS
------
EM-DAT requires a free registration at https://public.emdat.be/
After registration, download the full database as an Excel file (.xlsx) or CSV.

Two access modes:
  1. MANUAL EXPORT (recommended for reproducibility):
     - Register at https://public.emdat.be/
     - Download "Full data export" → emdat_public_YYYY_MM_DD.xlsx
     - Place at: {ai-engine}/data/emdat/emdat_export.xlsx  (or .csv)
     - Call: load_emdat_export()

  2. PUBLIC API (limited, requires API key from account):
     - Not yet stable for programmatic access — use manual export.

EM-DAT COLUMNS USED
-------------------
  Dis No       : unique disaster identifier
  Year, Month, Start Day, End Day
  Country      : affected country name
  ISO          : ISO 3166-1 alpha-3 country code
  Latitude, Longitude : event epicentre (not always available)
  Disaster Type, Disaster Subtype
  Total Deaths, Total Affected
  Continent, Region
"""

from __future__ import annotations

import calendar as _cal
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional
import math

import pandas as pd
from loguru import logger

_AI_ROOT  = Path(__file__).resolve().parent.parent.parent
_EMDAT_DIR = _AI_ROOT / "data" / "emdat"

# Map of EM-DAT Disaster Type → AEGIS hazard names
EMDAT_TYPE_MAP: dict[str, str] = {
    # Flood
    "Flood":                       "flood",
    "Flash flood":                  "flood",
    "Coastal flood":                "flood",
    "River flood":                  "flood",
    # Storm
    "Storm":                        "severe_storm",
    "Tropical cyclone":             "severe_storm",
    "Extra-tropical storm":         "severe_storm",
    "Convective storm":             "severe_storm",
    "Storm surge":                  "severe_storm",
    "Tornado":                      "severe_storm",
    # Extreme temperature
    "Heat wave":                    "heatwave",
    "Extreme temperature":          "heatwave",
    "Cold wave":                    "heatwave",
    # Drought
    "Drought":                      "drought",
    # Wildfire
    "Wildfire":                     "wildfire",
    "Forest fire":                  "wildfire",
    "Land fire (Brush, Bush, Pasture)": "wildfire",
    # Landslide
    "Landslide":                    "landslide",
    "Mudslide":                     "landslide",
    "Rockfall":                     "landslide",
    "Avalanche":                    "landslide",
    "Debris flow":                  "landslide",
    # Infrastructure / public safety (via EM-DAT "impact" filter)
    "Transport accident":           "infrastructure_damage",
    "Industrial accident":          "infrastructure_damage",
}

# ISO 3-letter country codes → list of region / station IDs
# This is used when EM-DAT events have no lat/lon (country-level only)
_COUNTRY_ISO_TO_REGION: dict[str, list[str]] = {
    # UK
    "GBR": ["london", "cambridge", "southampton", "bristol", "cardiff",
             "birmingham", "manchester", "york", "newcastle",
             "edinburgh", "glasgow", "aberdeen", "inverness"],
    # France
    "FRA": ["paris", "marseille", "bordeaux", "lyon", "strasbourg"],
    # Spain
    "ESP": ["madrid", "seville", "barcelona", "valencia", "bilbao"],
    # Portugal
    "PRT": ["lisbon", "porto"],
    # Italy
    "ITA": ["rome", "milan", "naples", "palermo"],
    # Greece
    "GRC": ["athens", "thessaloniki"],
    # Germany
    "DEU": ["berlin", "frankfurt", "munich", "hamburg"],
    # Netherlands
    "NLD": ["amsterdam"],
    # Turkey
    "TUR": ["istanbul", "ankara"],
    # US
    "USA": ["new_york", "los_angeles", "chicago", "houston", "miami",
            "new_orleans", "san_francisco", "dallas", "phoenix",
            "seattle", "denver", "boston"],
    # India
    "IND": ["mumbai", "delhi", "chennai", "kolkata", "hyderabad_in",
             "jodhpur", "shimla", "bangalore"],
    # Bangladesh
    "BGD": ["dhaka"],
    # Pakistan
    "PAK": ["karachi", "lahore", "islamabad"],
    # Nepal
    "NPL": ["kathmandu", "pokhara"],
    # Japan
    "JPN": ["tokyo", "osaka", "hiroshima", "nagoya"],
    # Philippines
    "PHL": ["manila", "cebu"],
    # Australia
    "AUS": ["sydney", "melbourne", "brisbane", "perth", "darwin",
             "cairns", "alice_springs"],
    # Brazil
    "BRA": ["sao_paulo", "rio_de_janeiro", "fortaleza", "recife",
             "manaus", "porto_alegre"],
    # Colombia
    "COL": ["bogota", "medellin"],
    # Morocco
    "MAR": ["casablanca", "marrakech"],
    # Ethiopia
    "ETH": ["addis_ababa"],
    # Kenya
    "KEN": ["nairobi"],
    # Nigeria
    "NGA": ["lagos", "abuja"],
    # South Africa
    "ZAF": ["cape_town", "johannesburg", "durban"],
    # China
    "CHN": ["beijing", "shanghai", "hong_kong", "guangzhou", "chengdu"],
    # Indonesia
    "IDN": ["jakarta", "surabaya", "medan"],
    # Thailand
    "THA": ["bangkok", "chiang_mai"],
    # Vietnam
    "VNM": ["hanoi", "ho_chi_minh"],
    # Myanmar
    "MMR": ["yangon"],
    # Iran
    "IRN": ["tehran"],
    # Iraq
    "IRQ": ["baghdad"],
    # Mozambique
    "MOZ": ["maputo"],
    # Madagascar
    "MDG": ["antananarivo"],
    # Iran
    "SAU": ["riyadh", "jeddah"],
    # Argentina
    "ARG": ["buenos_aires", "mendoza"],
    # Mexico
    "MEX": ["mexico_city", "guadalajara", "monterrey", "acapulco"],
    # Sudan
    "SDN": ["khartoum"],
    # Kazakhstan
    "KAZ": ["almaty", "astana"],
    # Uzbekistan
    "UZB": ["tashkent"],
    # Niger
    "NER": ["niamey"],
    # Norway
    "NOR": ["oslo", "bergen", "trondheim"],
    # Sweden
    "SWE": ["stockholm"],
    # Poland
    "POL": ["warsaw"],
    # New Zealand
    "NZL": ["auckland", "wellington"],
}


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def _find_emdat_file() -> Optional[Path]:
    """Search for an EM-DAT export file in the standard directory."""
    _EMDAT_DIR.mkdir(parents=True, exist_ok=True)
    for pattern in ("*.xlsx", "*.xls", "*.csv"):
        matches = list(_EMDAT_DIR.glob(pattern))
        if matches:
            # Use the most recently modified file
            return sorted(matches, key=lambda p: p.stat().st_mtime)[-1]
    return None


def load_emdat_export(file_path: Optional[Path] = None) -> pd.DataFrame:
    """Load an EM-DAT database export file.

    Parameters
    ----------
    file_path : optional path to the export file.  If None, auto-searches
                {ai-engine}/data/emdat/ for any .xlsx/.csv file.

    Returns
    -------
    pd.DataFrame with normalised column names, or empty DataFrame on failure.
    """
    if file_path is None:
        file_path = _find_emdat_file()

    if file_path is None:
        logger.warning(
            "EM-DAT export not found.  To use EM-DAT labels:\n"
            "  1. Register at https://public.emdat.be/\n"
            "  2. Download 'Full data export' as Excel (.xlsx)\n"
            f"  3. Place the file in: {_EMDAT_DIR}\n"
            "  EM-DAT is free for research purposes."
        )
        return pd.DataFrame()

    logger.info(f"Loading EM-DAT export: {file_path}")
    try:
        if file_path.suffix.lower() in (".xlsx", ".xls"):
            df = pd.read_excel(file_path, dtype=str, engine="openpyxl")
        else:
            df = pd.read_csv(file_path, dtype=str, low_memory=False)
    except Exception as exc:
        logger.error(f"Failed to read EM-DAT file {file_path}: {exc}")
        return pd.DataFrame()

    # Normalise column names (EM-DAT uses spaces and mixed case)
    df.columns = [c.strip().replace(" ", "_").lower() for c in df.columns]

    # Map alternative column names from different EM-DAT export versions.
    # IMPORTANT: date aliases must be resolved BEFORE numeric coercion below
    # because current EM-DAT exports use "start_year"/"start_month" instead
    # of the legacy "year"/"month" column names.
    col_aliases = {
        "disaster_type": ["disaster_type", "type", "hazard"],
        "disaster_subtype": ["disaster_subtype", "subtype"],
        "iso": ["iso", "iso3", "country_iso", "iso_code"],
        "country": ["country", "country_name"],
        "latitude": ["latitude", "lat", "event_latitude"],
        "longitude": ["longitude", "lon", "long", "event_longitude"],
        "total_deaths": ["total_deaths", "deaths", "total_deaths_adjusted"],
        # Date column aliases — current EM-DAT exports (2022+) use start_year/start_month
        "year":      ["year", "start_year", "event_year"],
        "month":     ["month", "start_month", "event_month"],
        "start_day": ["start_day", "event_start_day", "day"],
        "end_day":   ["end_day", "event_end_day"],
        "end_year":  ["end_year", "event_end_year"],
        "end_month": ["end_month", "event_end_month"],
    }
    for canonical, alternatives in col_aliases.items():
        if canonical not in df.columns:
            for alt in alternatives:
                if alt in df.columns:
                    df[canonical] = df[alt]
                    break

    # Normalise key date columns to numeric after alias resolution
    for col in ("year", "month", "start_day", "end_day", "end_year", "end_month"):
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    for canonical, alternatives in col_aliases.items():
        if canonical not in df.columns:
            for alt in alternatives:
                if alt in df.columns:
                    df[canonical] = df[alt]
                    break

    logger.info(
        f"  EM-DAT: {len(df):,} disaster records loaded "
        f"({df['disaster_type'].nunique() if 'disaster_type' in df.columns else '?'} types, "
        f"{df['year'].min():.0f}–{df['year'].max():.0f} years)"
        if "year" in df.columns else f"  EM-DAT: {len(df):,} records loaded"
    )
    return df


def filter_emdat_events(
    df: pd.DataFrame,
    hazard_type: str,
    start_year: int,
    end_year: int,
) -> pd.DataFrame:
    """Filter EM-DAT records to a specific AEGIS hazard and year range.

    Parameters
    ----------
    df          : full EM-DAT DataFrame from load_emdat_export()
    hazard_type : AEGIS hazard name (e.g. "flood", "severe_storm", "heatwave")
    start_year  : first year to include
    end_year    : last year to include (inclusive)

    Returns
    -------
    Filtered DataFrame, or empty DataFrame if no matching records.
    """
    if df.empty:
        return df

    # Find EM-DAT types matching this AEGIS hazard
    emdat_types = {
        emdat_t for emdat_t, aegis_h in EMDAT_TYPE_MAP.items()
        if aegis_h == hazard_type
    }

    if not emdat_types:
        logger.warning(f"No EM-DAT type mapping found for hazard '{hazard_type}'")
        return pd.DataFrame()

    if "disaster_type" not in df.columns:
        logger.error("EM-DAT DataFrame missing 'disaster_type' column")
        return pd.DataFrame()

    # Case-insensitive matching against disaster_type + disaster_subtype
    type_mask = df["disaster_type"].str.strip().isin(emdat_types)
    if "disaster_subtype" in df.columns:
        subtype_mask = df["disaster_subtype"].str.strip().isin(emdat_types)
        type_mask = type_mask | subtype_mask

    year_mask = (
        pd.to_numeric(df["year"], errors="coerce").between(start_year, end_year)
    ) if "year" in df.columns else pd.Series(True, index=df.index)

    filtered = df[type_mask & year_mask].copy()
    logger.info(
        f"  EM-DAT '{hazard_type}': {len(filtered):,} events "
        f"({start_year}–{end_year})"
    )
    return filtered


# ---------------------------------------------------------------------------
# Label builder
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


def build_emdat_label_df(
    hazard_type: str,
    station_locations: list[dict],
    start_date: str,
    end_date: str,
    radius_km: float = 300.0,
    min_deaths: int = 0,
    emdat_file: Optional[Path] = None,
    precursor_days: int = 0,
) -> pd.DataFrame:
    """Build hourly disaster labels from EM-DAT event records.

    Matching strategy (in priority order):
      1. If the event has lat/lon: haversine match within radius_km.
      2. If only country ISO is available: use _COUNTRY_ISO_TO_REGION lookup.

    Label window strategy (controlled by ``precursor_days``):

      precursor_days = 0 (default, backward-compatible):
        A station-day is positive if any matching EM-DAT event spans that day.
        Labels cover the FULL event duration (ev_start → ev_end).

      precursor_days > 0 (PhD-grade forecast label):
        Labels the ATMOSPHERIC PRECURSOR WINDOW rather than the event duration.
        Positive days = [ev_start - precursor_days, ev_start + 1].
        This teaches the model which weather conditions PRECEDE a disaster
        onset, which is the correct target for a forecast model (Alfieri et
        al., 2013 GloFAS; Smith et al., 2004).
        The full event duration (after ev_start+1) is EXCLUDED because mid-
        and late-event conditions (e.g. clearing skies on day 20 of a flood)
        are unrelated to the precursor atmospheric drivers — including them
        inverts the rainfall-risk signal and produces AUC < 0.5.

    Parameters
    ----------
    hazard_type       : AEGIS hazard name
    station_locations : list of {"id", "lat", "lon"} dicts
    start_date        : "YYYY-MM-DD"
    end_date          : "YYYY-MM-DD"
    radius_km         : match radius for events with coordinates (default 300km)
    min_deaths        : filter out events with fewer total deaths (default 0 = all)
    emdat_file        : path to EM-DAT export; auto-detected if None
    precursor_days    : if > 0, label only the N days before event onset (default 0)

    Returns
    -------
    pd.DataFrame with columns: timestamp (hourly), station_id, label (0/1)
    Empty DataFrame if EM-DAT is unavailable.
    """
    emdat_df = load_emdat_export(emdat_file)
    if emdat_df.empty:
        return pd.DataFrame(columns=["timestamp", "station_id", "label"])

    dt_start = datetime.strptime(start_date, "%Y-%m-%d")
    dt_end   = datetime.strptime(end_date,   "%Y-%m-%d")

    events = filter_emdat_events(
        emdat_df, hazard_type,
        start_year=dt_start.year,
        end_year=dt_end.year,
    )

    if events.empty:
        logger.warning(f"  EM-DAT: no '{hazard_type}' events found for {start_date}–{end_date}")
        return pd.DataFrame(columns=["timestamp", "station_id", "label"])

    if min_deaths > 0 and "total_deaths" in events.columns:
        deaths = pd.to_numeric(events["total_deaths"], errors="coerce").fillna(0)
        events = events[deaths >= min_deaths]

    # Build station lookup
    station_by_id = {loc["id"]: loc for loc in station_locations}

    # Accumulate positive (station_id, date) pairs
    positive_pairs: set[tuple] = set()

    import math

    def _safe_int(val, default: int) -> int:
        """Convert val to int, returning default if val is NaN, None, or invalid."""
        try:
            f = float(val)
            return default if (math.isnan(f) or math.isinf(f)) else int(f)
        except (TypeError, ValueError):
            return default

    for _, ev in events.iterrows():
        # Determine event date range (guard against NaN in EM-DAT optional columns)
        year  = _safe_int(ev.get("year"),      dt_start.year)
        month = _safe_int(ev.get("month"),     1)
        sday  = _safe_int(ev.get("start_day"), 1)
        # End date: use end_year/end_month if available, otherwise same as start
        end_year  = _safe_int(ev.get("end_year"),  year)
        end_month = _safe_int(ev.get("end_month"), month)
        eday      = _safe_int(ev.get("end_day"),   sday)

        try:
            ev_start = datetime(year, month, max(1, sday))
        except ValueError:
            ev_start = datetime(year, month, 1)
        try:
            eday_clamped = min(eday, _cal.monthrange(end_year, end_month)[1])
            ev_end = datetime(end_year, end_month, max(1, eday_clamped))
        except ValueError:
            ev_end = datetime(end_year, end_month, _cal.monthrange(end_year, end_month)[1])

        # Build the positive label window.
        # precursor_days > 0: label N days BEFORE onset + 1 day of onset.
        # precursor_days = 0: label the full event duration (backward-compat).
        if precursor_days > 0:
            window_start = ev_start - timedelta(days=precursor_days)
            window_end   = ev_start + timedelta(days=1)  # onset day only
        else:
            window_start = ev_start
            window_end   = ev_end

        # Clamp to training window
        window_start = max(window_start, dt_start)
        window_end   = min(window_end,   dt_end)
        if window_start > window_end:
            continue

        event_dates = [
            (window_start + timedelta(days=d)).date()
            for d in range((window_end - window_start).days + 1)
        ]

        # Determine matching stations
        matched_stations: list[str] = []

        ev_lat = pd.to_numeric(ev.get("latitude",  None), errors="coerce")
        ev_lon = pd.to_numeric(ev.get("longitude", None), errors="coerce")

        if pd.notna(ev_lat) and pd.notna(ev_lon):
            # Strategy 1: spatial proximity
            for loc in station_locations:
                if _haversine_km(float(ev_lat), float(ev_lon), loc["lat"], loc["lon"]) <= radius_km:
                    matched_stations.append(loc["id"])
        else:
            # Strategy 2: country ISO lookup
            iso = str(ev.get("iso", "") or "").strip().upper()
            matched_ids = _COUNTRY_ISO_TO_REGION.get(iso, [])
            matched_stations = [sid for sid in matched_ids if sid in station_by_id]

        for station_id in matched_stations:
            for d in event_dates:
                positive_pairs.add((station_id, d))

    if not positive_pairs:
        logger.warning(f"  EM-DAT: no spatial matches found for '{hazard_type}' events")
        return pd.DataFrame(columns=["timestamp", "station_id", "label"])

    # Build full hourly grid
    hourly_index = pd.date_range(dt_start, dt_end, freq="h")
    rows: list[pd.DataFrame] = []
    n_pos_total = 0

    for loc in station_locations:
        sid = loc["id"]
        labels = []
        for ts in hourly_index:
            labels.append(1 if (sid, ts.date()) in positive_pairs else 0)
        df = pd.DataFrame({
            "timestamp": hourly_index,
            "station_id": sid,
            "label": labels,
        })
        n_pos_total += sum(labels)
        rows.append(df)

    result = pd.concat(rows, ignore_index=True)
    n_neg = len(result) - n_pos_total
    logger.info(
        f"  EM-DAT '{hazard_type}' labels: {n_pos_total:,} positive, "
        f"{n_neg:,} negative ({n_pos_total/max(len(result),1)*100:.2f}% positive rate) "
        f"across {len(station_locations)} stations"
    )
    return result


def emdat_is_available() -> bool:
    """Return True if an EM-DAT export file is present."""
    return _find_emdat_file() is not None
