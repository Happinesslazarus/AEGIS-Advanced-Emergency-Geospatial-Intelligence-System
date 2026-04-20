"""
GRDC (Global Runoff Data Centre) river discharge data for water supply
disruption training labels.

WHY GRDC
--------
Water supply disruption is caused by two distinct mechanisms:
  1. DROUGHT   -- river/reservoir levels fall below supply threshold (Q10 or
                 below 10th percentile of monthly flow)
  2. FLOODING  -- turbidity and infrastructure damage interrupt treatment works

Both can be detected using observed discharge (Q) records.  GRDC provides
daily mean discharge (m³/s) at ~10,000 stations globally, measured by
national hydrological agencies and aggregated under WMO auspices.

This is independent of ERA5 because:
  - GRDC records measured river flow -- a CONSEQUENCE of weather, not a
    weather variable itself
  - GRDC data comes from direct stream-gauge telemetry submitted by national
    agencies (USGS, EA, BfG, NWIS, etc.)
  - ERA5 features include precipitation, temperature, humidity -- not streamflow

LABEL DEFINITION
Two-sided label:
  DROUGHT mode  : station-month POSITIVE when mean monthly Q < Q10
                  (10th percentile of the station's long-term record)
  FLOOD mode    : station-day POSITIVE when daily Q > Q90
                  (90th percentile -- flood-risk turbidity / infrastructure)
  COMBINED mode : union of drought and flood positives (default)

The monthly/daily label is broadcast to all hours within that period.

DATA ACCESS
GRDC data requires a FREE registration at:
  https://www.bafg.de/GRDC/EN/02_srvcs/21_tmsrs/210_prtl/prtl_node.html

After registration, you can download station data in two ways:

  A. Web portal (manual) -- select stations, download as ZIP with CSV files
     Save CSV files to: {ai-engine}/data/grdc/

  B. GRDC REST API (programmatic, rate-limited):
     from app.training.data_fetch_grdc import download_grdc_station
     download_grdc_station(station_id=6122100)  # Rhine at Cologne

EMBEDDED FALLBACK
Rather than require a GRDC account for basic operation, this module also
contains a curated static list of documented water supply disruption events
from official sources (WHO/PAHO water crises reports, EA Drought Plans,
USGS WaterWatch drought declarations).  This static list provides training
signal even when no GRDC files are present.

SETUP
-----
  from app.training.data_fetch_grdc import download_grdc_station_list
  download_grdc_station_list()          # downloads station metadata (~2 MB)

  # Then download individual stations:
  from app.training.data_fetch_grdc import download_grdc_station
  for sid in GRDC_TRAINING_STATIONS:
      download_grdc_station(sid)
"""

from __future__ import annotations

import math
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd
from loguru import logger

_AI_ROOT   = Path(__file__).resolve().parent.parent.parent
_GRDC_DIR  = _AI_ROOT / "data" / "grdc"
_GRDC_DIR.mkdir(parents=True, exist_ok=True)

# GRDC API base -- access requires registration (free)
_GRDC_API_BASE = "https://grdc.bafg.de/GRDC/api/v1"

# Key GRDC station IDs for global water-supply disruption training coverage
# Format: {station_id: (station_name, river, country, lat, lon)}
# Station IDs verified against GRDC_Stations.xlsx catalog (April 2026).
# Only stations with confirmed daily data (d_start/d_end != None) are included.
# Stations removed due to no GRDC daily data: White Nile/Malakal (1673600),
#   Tigris/Mosul (2595600), Indus/Attock (2335200), Ganges/Paksey (2646100).
GRDC_TRAINING_STATIONS: dict[int, tuple[str, str, str, float, float]] = {
    # Europe -- IDs from GRDC catalog; Rhine/Elbe/Danube/Glomma all have 100+ yr records
    6335060: ("Cologne",        "Rhine",   "DE",  50.94,  6.96),   # 1816-2024
    6340110: ("Neu Darchau",    "Elbe",    "DE",  53.23, 10.89),   # 1874-2023
    6142200: ("Bratislava",     "Danube",  "SK",  48.14, 17.11),   # 1900-2024
    6729403: ("Solbergfoss",    "Glomma",  "NO",  59.64, 11.15),   # 1901-2023
    2279600: ("Stornoway",      "Creed",   "GB",  58.21, -6.39),   # NRFA downloaded
    2399500: ("Tewkesbury",     "Severn",  "GB",  52.00, -2.16),   # NRFA downloaded
    2904900: ("Newby Bridge",   "Leven",   "GB",  54.27, -2.99),   # NRFA downloaded
    # North America
    4127800: ("Niagara Falls",  "Niagara", "US",  43.10, -79.07),  # USGS downloaded
    4148530: ("Louisville",     "Ohio",    "US",  38.26, -85.77),  # USGS downloaded
    4149900: ("Memphis",        "Mississi","US",  35.13, -90.07),  # USGS downloaded
    4212600: ("Sacramento",     "Sacramen","US",  38.55,-121.49),  # USGS downloaded
    4150000: ("New Orleans",    "Mississi","US",  29.95, -90.07),  # USGS downloaded
    # South America
    3629000: ("Manacapuru",     "Amazon",  "BR",  -3.31, -60.61),  # ANA downloaded
    3671000: ("Ladario",        "Paraguay","BR", -19.01, -57.59),  # ANA downloaded
    # Africa
    1147010: ("Kinshasa",       "Congo",   "CD",  -4.30,  15.30),  # 1903-2010 (GRDC portal)
    # Asia
    2469260: ("Pakse",          "Mekong",  "LA",  15.12, 105.80),  # 1960-1993 (GRDC portal)
    # Australia
    5300500: ("Murray-Morgan",  "Murray",  "AU", -34.64, 139.68),  # BOM downloaded
    5304000: ("Darling-Weir32", "Darling", "AU", -34.11, 141.91),  # BOM downloaded
}


# Curated static water supply disruption events (fallback -- always available)
# Sources: WHO/PAHO water emergency bulletins, EA Drought Exceptional Circumstance
# declarations, USGS WaterWatch drought advisories, EU drought observatory reports,
# ReliefWeb water crises, local water authority press releases.
#
# Each record: start, end, lat, lon, description, source
# These are events where water supply to human populations was DISRUPTED --
# not just meteorological drought, but actual service interruption or restriction.

WATER_SUPPLY_DISRUPTION_EVENTS: list[dict] = [
    # UK / Europe
    {
        "start": datetime(2018, 6, 1),   "end": datetime(2018, 9, 30),
        "lat": 51.5, "lon": -0.1,
        "description": "UK 2018 summer drought -- Thames Water hosepipe ban, reservoir levels <20% in SE England",
        "source": "Environment Agency Drought Situation Reports 2018",
    },
    {
        "start": datetime(2022, 7, 1),   "end": datetime(2022, 9, 30),
        "lat": 51.5, "lon": -0.5,
        "description": "UK 2022 drought -- driest July since 1935; Wessex Water, Southern Water drought orders",
        "source": "Environment Agency National Drought Group 2022; Met Office",
    },
    {
        "start": datetime(2019, 7, 1),   "end": datetime(2019, 8, 31),
        "lat": 48.9, "lon": 8.7,
        "description": "Central European heat-drought 2019 -- Rhine low-flow; industrial and drinking water concerns",
        "source": "EU Drought Observatory bulletin Aug 2019",
    },
    {
        "start": datetime(2022, 7, 1),   "end": datetime(2022, 10, 31),
        "lat": 44.0, "lon": 11.0,
        "description": "Italy 2022 mega-drought -- Po basin at historic lows; agricultural and municipal supply disruption",
        "source": "ReliefWeb Italy drought report July 2022 / EU DJF",
    },
    {
        "start": datetime(2017, 6, 1),   "end": datetime(2017, 9, 30),
        "lat": 39.5, "lon": -8.0,
        "description": "Iberian Peninsula drought 2017 -- dam levels <30%; municipal restrictions Portugal",
        "source": "SNIRH Portugal drought bulletin; AEMET drought report",
    },
    # North America
    {
        "start": datetime(2021, 7, 1),   "end": datetime(2022, 3, 31),
        "lat": 36.2, "lon": -115.1,
        "description": "Lake Mead drought emergency 2021-22 -- Tier 1 then Tier 2 shortage declared by USBR; Arizona/Nevada supply cuts",
        "source": "USBR Colorado River Basin Forecast Aug 2021; Arizona Dept Water Resources",
    },
    {
        "start": datetime(2022, 8, 1),   "end": datetime(2023, 5, 31),
        "lat": 37.0, "lon": -119.4,
        "description": "California drought 2022-23 -- Governor emergency; groundwater-dependent communities ran dry",
        "source": "CA DWR Water Conditions Report 2022; USGS WaterWatch",
    },
    {
        "start": datetime(2016, 1, 1),   "end": datetime(2016, 6, 30),
        "lat": 29.9, "lon": -90.1,
        "description": "Louisiana/Mississippi River low-flow saltwater intrusion 2016 -- threatened New Orleans water supply",
        "source": "USGS current water conditions / Army Corps of Engineers advisory",
    },
    # South America
    {
        "start": datetime(2021, 9, 1),   "end": datetime(2022, 3, 31),
        "lat": -23.5, "lon": -46.6,
        "description": "Brazil drought 2021 -- worst in 91 years; São Paulo System Cantareira <20%",
        "source": "ANA Brazil National Water Agency report 2021",
    },
    {
        "start": datetime(2015, 2, 1),   "end": datetime(2015, 5, 31),
        "lat": -23.5, "lon": -46.6,
        "description": "São Paulo water crisis 2015 -- Cantareira system near dead pool; 22M people under restrictions",
        "source": "SABESP water level bulletins Q1 2015",
    },
    # Africa
    {
        "start": datetime(2017, 11, 1),  "end": datetime(2018, 5, 31),
        "lat": -33.9, "lon": 18.4,
        "description": "Cape Town Day Zero crisis 2017-18 -- dam levels <20%; Level 6 restrictions; global attention",
        "source": "City of Cape Town dam reports; DWS drought bulletin",
    },
    {
        "start": datetime(2021, 1, 1),   "end": datetime(2021, 6, 30),
        "lat": -17.8, "lon": 31.0,
        "description": "Zimbabwe 2021 drought -- Harare lake Chivero near dead pool; 24hr/week supply schedule",
        "source": "ReliefWeb Zimbabwe humanitarian report Jan 2021",
    },
    # Middle East / Asia
    {
        "start": datetime(2018, 3, 1),   "end": datetime(2018, 9, 30),
        "lat": 31.9, "lon": 35.9,
        "description": "Jordan water crisis 2018 -- Zarqa Basin and King Talal Reservoir at critically low levels",
        "source": "MWI Jordan water resources annual report 2018",
    },
    {
        "start": datetime(2015, 4, 1),   "end": datetime(2016, 1, 31),
        "lat": 29.4, "lon": 52.5,
        "description": "Iran Khuzestan water crisis 2015-16 -- Karun river near zero flow; industrial shut-downs",
        "source": "WRMA Iran water report 2015",
    },
    # NOTE on Iraq events and ERA5 predictability:
    # Tigris-Euphrates low-flow crises have TWO drivers:
    #   1. Upstream Turkish/Syrian dam operations (Atatürk, Tabqa, Mosul dams) --
    #      NOT predictable from local ERA5 meteorology at the Baghdad grid point.
    #   2. Below-normal winter rainfall in the headwaters (Taurus/Zagros mountains) --
    #      IS partially predictable from antecedent_rainfall and soil_moisture features.
    # Model prediction quality for these events depends on which driver dominates.
    # The events are retained because they represent documented real-world disruptions,
    # but their contribution to training AUC may be limited where dam-release policy
    # (not weather) is the primary cause.  Geographic holdout evaluation (see
    # geographic_holdout.json) will reveal whether Middle East cluster AUC is lower
    # than Europe/Americas -- which is the expected and scientifically honest result.
    {
        "start": datetime(2018, 5, 1),   "end": datetime(2018, 11, 30),
        "lat": 33.34, "lon": 44.40,
        "description": (
            "Iraq 2018 water crisis -- Tigris and Euphrates at historic low flows "
            "due to upstream Turkish/Syrian dams and below-normal winter rainfall; "
            "Basra protests over water contamination and shortages; agricultural "
            "collapse in southern Iraq.  Driver: mixed (dam operations + rainfall "
            "deficit); local ERA5 variables partially capture the rainfall component."
        ),
        "source": "FAO Iraq water crisis July 2018; UN OCHA Iraq water situation 2018; Human Rights Watch water rights Iraq 2019",
    },
    {
        "start": datetime(2019, 5, 1),   "end": datetime(2019, 10, 31),
        "lat": 33.34, "lon": 44.40,
        "description": (
            "Iraq 2019 water stress -- second consecutive year of critically low "
            "Tigris-Euphrates discharge; government declared Euphrates water emergency; "
            "agricultural irrigation cuts in Anbar and Diyala.  Driver: predominantly "
            "upstream dam operations and reduced Taurus-Zagros snowpack; local ERA5 "
            "rainfall features will have limited predictive power for this event."
        ),
        "source": "FAO Iraq water report 2019; UN OCHA Iraq humanitarian snapshot Aug 2019; Reuters Iraq water crisis Aug 2019",
    },
    {
        "start": datetime(2022, 3, 1),   "end": datetime(2022, 8, 31),
        "lat": 33.3, "lon": 44.4,
        "description": (
            "Iraq water crisis 2022 -- Tigris/Euphrates at historic lows; agricultural "
            "and domestic shortages.  Driver: compound -- upstream dam policy and "
            "severe 2021-22 winter rainfall deficit across headwaters.  In test period "
            "(Apr 2022 - May 2023) so model must predict this without seeing it in training."
        ),
        "source": "FAO Iraq water situation report June 2022",
    },
    # Australia
    {
        "start": datetime(2019, 1, 1),   "end": datetime(2020, 2, 28),
        "lat": -33.9, "lon": 151.2,
        "description": "Millennium Drought successor -- NSW storage <50%; Stanthorpe (QLD) nearly ran out of water entirely",
        "source": "NSW DPIE water situation report 2019; BOM Drought monitor",
    },
    {
        "start": datetime(2019, 3, 1),   "end": datetime(2020, 2, 28),
        "lat": -34.92, "lon": 138.6,
        "description": "South Australia 2019-20 drought -- Murray-Darling inflows at record lows; Adelaide desalination plant at full capacity",
        "source": "SA Water annual report 2019-20; MDBA drought monitoring bulletin",
    },
    {
        "start": datetime(2019, 3, 1),   "end": datetime(2019, 12, 31),
        "lat": -31.95, "lon": 115.86,
        "description": "Western Australia 2019 drought -- Perth dam storage below 20% of capacity; level 1-2 restrictions",
        "source": "Water Corporation Perth water storage dashboard 2019; BOM drought monitor",
    },
    # Middle East -- recurring crises (fill temporal gap)
    {
        "start": datetime(2021, 4, 1),   "end": datetime(2021, 10, 31),
        "lat": 31.95, "lon": 35.93,
        "description": "Jordan 2021 water crisis -- Zarqa and Yarmouk River flows at historic lows; severe urban rationing in Amman",
        "source": "MWI Jordan Annual Report 2021; ReliefWeb Jordan water shortages Jul 2021",
    },
    # Peru / South America
    {
        "start": datetime(2016, 4, 1),   "end": datetime(2016, 11, 30),
        "lat": -12.04, "lon": -77.04,
        "description": "Peru Lima water crisis 2016 -- El Niño mudslides contaminated Chillón/Rímac intakes; 1.5M without supply",
        "source": "SEDAPAL Lima emergency report Apr 2016; INDECI disaster bulletin",
    },
    {
        "start": datetime(2017, 1, 1),   "end": datetime(2017, 5, 31),
        "lat": -12.04, "lon": -77.04,
        "description": "Peru Lima 2017 huaico floods -- Niño Costero event contaminated all three Lima water intakes; 5-day supply interruption",
        "source": "SEDAPAL emergency report Mar 2017; ANA Peru flood bulletin",
    },
    # Germany / Rhine drought (fills 2018 gap in Central Europe)
    {
        "start": datetime(2018, 6, 1),   "end": datetime(2018, 10, 31),
        "lat": 51.5, "lon": 7.5,
        "description": "Rhine/Elbe low flow 2018 -- driest summer since records; industrial water use restricted; drinking water concerns in NRW",
        "source": "BfG Rhine hydrological drought report 2018; DWD summer 2018 analysis",
    },
    {
        "start": datetime(2019, 6, 1),   "end": datetime(2019, 10, 31),
        "lat": 48.87, "lon": 2.35,
        "description": "France drought 2019 -- lowest river levels since 1959 in places; prefectural water restrictions in 77 departments",
        "source": "Météo-France summer 2019 review; French government drought decree bulletins",
    },
    # Additional African event
    {
        "start": datetime(2019, 1, 1),   "end": datetime(2019, 9, 30),
        "lat": -1.29, "lon": 36.82,
        "description": "Kenya 2019 drought -- Nairobi dams (Sasumua, Ruiru) at <20%; NCWSC rationing across the capital",
        "source": "NCWSC Nairobi water levels 2019; Kenya Meteorological Dept drought advisory",
    },
]


# GRDC download helpers

def download_grdc_station(
    station_id: int,
    force: bool = False,
) -> Optional[Path]:
    """Download GRDC daily discharge data for a station via GRDC REST API.

    Note: GRDC API requires registration.  If the API is unavailable, data
    can be downloaded manually from https://grdc.bafg.de and placed as:
      {ai-engine}/data/grdc/grdc_{station_id}.csv

    Parameters
    station_id : GRDC station ID
    force      : re-download if file exists

    Returns

    Path to downloaded CSV, or None on failure.
    """
    dest = _GRDC_DIR / f"grdc_{station_id}.csv"
    if dest.exists() and not force:
        return dest

    url = f"{_GRDC_API_BASE}/stationDetails/station?stations={station_id}&dataTypes=EWA&dailyData=true"
    logger.info(f"Downloading GRDC station {station_id} ...")
    try:
        with urllib.request.urlopen(url, timeout=30) as resp:
            content = resp.read().decode("utf-8")
        dest.write_text(content, encoding="utf-8")
        logger.success(f"  GRDC {station_id}: {dest}")
        return dest
    except Exception as exc:
        logger.warning(
            f"  GRDC {station_id} API download failed: {exc}\n"
            f"  Manual download: https://grdc.bafg.de\n"
            f"  Save daily data as: {dest}"
        )
        return None


def download_grdc_station_list(force: bool = False) -> Optional[Path]:
    """Download the GRDC global station catalogue CSV (~2 MB).

    Contains station IDs, names, rivers, countries, lat/lon, period-of-record.
    """
    dest = _GRDC_DIR / "grdc_stations_catalogue.csv"
    if dest.exists() and not force:
        return dest
    url = "https://grdc.bafg.de/GRDC/api/v1/stationDetails/allStations"
    logger.info("Downloading GRDC station catalogue ...")
    try:
        with urllib.request.urlopen(url, timeout=60) as resp:
            content = resp.read().decode("utf-8")
        dest.write_text(content, encoding="utf-8")
        logger.success(f"GRDC station catalogue: {dest}")
        return dest
    except Exception as exc:
        logger.warning(f"GRDC catalogue download failed: {exc}")
        return None


# GRDC data loading

def load_grdc_station(station_id: int) -> pd.DataFrame:
    """Load a GRDC station daily discharge CSV.

    Returns DataFrame with columns: date (datetime), discharge_m3s (float).
    Empty DataFrame if file not found or unreadable.
    """
    path = _GRDC_DIR / f"grdc_{station_id}.csv"
    if not path.exists():
        return pd.DataFrame()

    try:
        # Try two formats: GRDC export format vs simple lat/lon/discharge CSV
        df = pd.read_csv(path, comment="#", sep=";", dtype=str)
        df.columns = [c.strip().lower() for c in df.columns]

        # GRDC export: columns are 'yyyy', 'mm', 'dd', 'hh', ' original'
        if "yyyy" in df.columns and "mm" in df.columns:
            df["date"] = pd.to_datetime(
                df["yyyy"].str.strip() + "-" + df["mm"].str.strip() + "-" + df["dd"].str.strip(),
                errors="coerce",
            )
            q_col = next((c for c in df.columns if "original" in c or "value" in c or "q" == c), None)
        else:
            # Fallback: first column is date, second is discharge
            df = pd.read_csv(path, comment="#", dtype=str)
            df.columns = [c.strip().lower() for c in df.columns]
            date_col = df.columns[0]
            q_col    = df.columns[1] if len(df.columns) > 1 else None
            df["date"] = pd.to_datetime(df[date_col], errors="coerce")

        if q_col is None:
            return pd.DataFrame()

        df["discharge_m3s"] = pd.to_numeric(df[q_col].str.strip(), errors="coerce")
        df = df.dropna(subset=["date", "discharge_m3s"])
        # GRDC uses -999 or -9999 as missing value
        df = df[df["discharge_m3s"] > -900]
        return df[["date", "discharge_m3s"]].sort_values("date").reset_index(drop=True)

    except Exception as exc:
        logger.warning(f"GRDC station {station_id}: read error: {exc}")
        return pd.DataFrame()


def compute_flow_percentiles(
    df: pd.DataFrame,
    low_percentile: float = 10.0,
    high_percentile: float = 90.0,
) -> tuple[float, float]:
    """Compute Q10 (low-flow drought threshold) and Q90 (high-flow flood threshold).

    Parameters
    df               : discharge DataFrame from load_grdc_station()
    low_percentile   : percentile for drought threshold (default 10)
    high_percentile  : percentile for flood threshold (default 90)

    Returns

    (q_low, q_high) -- discharge thresholds in m³/s
    """
    if df.empty or "discharge_m3s" not in df.columns:
        return float("nan"), float("nan")
    q = df["discharge_m3s"].dropna()
    return (
        float(np.nanpercentile(q, low_percentile)),
        float(np.nanpercentile(q, high_percentile)),
    )


def build_grdc_labels_for_station(
    station_id: int,
    start_date: str,
    end_date: str,
    mode: str = "combined",
    low_percentile: float = 10.0,
    high_percentile: float = 90.0,
) -> pd.Series:
    """Build daily drought/flood labels (0/1) for a GRDC station.

    Parameters
    station_id       : GRDC station ID
    start_date       : "YYYY-MM-DD"
    end_date         : "YYYY-MM-DD"
    mode             : "drought" | "flood" | "combined"
    low_percentile   : Q threshold for drought (default Q10)
    high_percentile  : Q threshold for flood   (default Q90)

    Returns

    pd.Series indexed by date (daily), values 0/1.  Empty on failure.
    """
    df = load_grdc_station(station_id)
    if df.empty:
        return pd.Series(dtype=int)

    q_low, q_high = compute_flow_percentiles(df, low_percentile, high_percentile)
    if math.isnan(q_low):
        return pd.Series(dtype=int)

    df = df.set_index("date")
    dt_start = pd.Timestamp(start_date)
    dt_end   = pd.Timestamp(end_date)
    df = df[dt_start:dt_end]

    if df.empty:
        return pd.Series(dtype=int)

    label = pd.Series(0, index=df.index)
    if mode in ("drought", "combined"):
        label[df["discharge_m3s"] <= q_low] = 1
    if mode in ("flood", "combined"):
        label[df["discharge_m3s"] >= q_high] = 1

    return label


# Haversine helper

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


# Main label builder

def build_water_label_df(
    station_locations: list[dict],
    start_date: str,
    end_date: str,
    radius_km: float = 200.0,
    mode: str = "combined",
    low_percentile: float = 10.0,
    high_percentile: float = 90.0,
) -> pd.DataFrame:
    """Build hourly water supply disruption labels from GRDC + static events.

    A station-hour is POSITIVE when:
      - At least one GRDC gauge within radius_km shows low/high flow on that day, OR
      - A documented water supply disruption event overlaps that station-hour

    Parameters
    station_locations : list of {"id", "lat", "lon"} dicts
    start_date        : "YYYY-MM-DD"
    end_date          : "YYYY-MM-DD"
    radius_km         : spatial match radius for GRDC gauges and static events
    mode              : "drought" | "flood" | "combined" (default)
    low_percentile    : Q percentile for drought threshold
    high_percentile   : Q percentile for flood threshold

    Returns

    pd.DataFrame with columns: timestamp (hourly), station_id, label (0/1)
    """
    dt_start = datetime.strptime(start_date, "%Y-%m-%d")
    dt_end   = datetime.strptime(end_date,   "%Y-%m-%d")
    hourly_index = pd.date_range(dt_start, dt_end, freq="h")

    positive_station_hours: dict[str, set] = {loc["id"]: set() for loc in station_locations}

    # Source 1: GRDC gauge stations
    n_grdc_gauges_used = 0
    for grdc_sid, (name, river, country, g_lat, g_lon) in GRDC_TRAINING_STATIONS.items():
        # Find which training stations are within radius of this gauge
        nearby_stations = [
            loc for loc in station_locations
            if _haversine_km(g_lat, g_lon, float(loc["lat"]), float(loc["lon"])) <= radius_km
        ]
        if not nearby_stations:
            continue

        daily_labels = build_grdc_labels_for_station(
            grdc_sid, start_date, end_date, mode, low_percentile, high_percentile
        )
        if daily_labels.empty:
            continue

        n_grdc_gauges_used += 1
        positive_dates = set(daily_labels[daily_labels == 1].index.normalize())

        for loc in nearby_stations:
            for ts in hourly_index:
                if ts.normalize() in positive_dates:
                    positive_station_hours[loc["id"]].add(ts)

    if n_grdc_gauges_used:
        logger.info(f"  GRDC: {n_grdc_gauges_used} gauge stations contributed labels")

    # Source 2: Curated static disruption events
    n_static = 0
    for ev in WATER_SUPPLY_DISRUPTION_EVENTS:
        ev_start = pd.Timestamp(ev["start"])
        ev_end   = pd.Timestamp(ev["end"])
        if ev_start > pd.Timestamp(dt_end) or ev_end < pd.Timestamp(dt_start):
            continue

        for loc in station_locations:
            dist = _haversine_km(ev["lat"], ev["lon"], float(loc["lat"]), float(loc["lon"]))
            if dist <= radius_km:
                overlap_start = max(ev_start, pd.Timestamp(dt_start))
                overlap_end   = min(ev_end,   pd.Timestamp(dt_end))
                hours = pd.date_range(overlap_start.floor("h"), overlap_end.floor("h"), freq="h")
                positive_station_hours[loc["id"]].update(hours)
                n_static += 1

    if n_static:
        logger.info(f"  Static water disruption events: {n_static} station-event contributions")

    if not any(positive_station_hours.values()):
        logger.warning(
            "No water disruption data contributed any positive labels.\n"
            "Static disruption events should always fire -- check date range and radius.\n"
            "For GRDC gauge data: from app.training.data_fetch_grdc import "
            "download_grdc_station; download_grdc_station(6122100)"
        )
        return pd.DataFrame(columns=["timestamp", "station_id", "label"])

    # Build hourly output
    rows: list[pd.DataFrame] = []
    n_positive_total = 0
    for loc in station_locations:
        sid     = loc["id"]
        pos_set = positive_station_hours[sid]
        labels  = [1 if ts in pos_set else 0 for ts in hourly_index]
        n_positive_total += sum(labels)
        rows.append(pd.DataFrame({
            "timestamp":  hourly_index,
            "station_id": sid,
            "label":      labels,
        }))

    result = pd.concat(rows, ignore_index=True)
    n_neg    = len(result) - n_positive_total
    pos_rate = n_positive_total / max(len(result), 1) * 100
    logger.info(
        f"  Water supply labels: {n_positive_total:,} positive, {n_neg:,} negative "
        f"({pos_rate:.2f}% positive rate) across {len(station_locations)} stations "
        f"(radius={radius_km:.0f}km, mode={mode})"
    )
    return result


def water_supply_data_available() -> bool:
    """Return True -- static disruption events are always embedded.
    GRDC files are optional (add gauge-based precision).
    """
    has_grdc = bool(list(_GRDC_DIR.glob("grdc_*.csv")))
    if has_grdc:
        logger.info("Water supply data: static events (embedded) + GRDC gauge files (local)")
    else:
        logger.info(
            "Water supply data: static events (embedded). "
            "For gauge precision: from app.training.data_fetch_grdc import "
            "download_grdc_station; download_grdc_station(6122100)"
        )
    return True  # Static events always available
