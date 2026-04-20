"""
Generates weak (noisy) binary labels for the four AEGIS hazard types that
lack clean ground-truth datasets:

  - power_outage
  - water_supply_disruption
  - infrastructure_damage
  - public_safety_incident

Because no fine-grained UK spatial time-series exists for these hazards, we
use three complementary weak-supervision strategies and combine them:

  1. EM-DAT (CRED) -- international disaster database with country/county-level
     impact records; provides coarse temporal presence/absence.
  2. DesInventar Sendai -- UN Sendai Framework aligned event catalogue;
     stronger granularity than EM-DAT for some event types.
  3. GDELT -- Global Database of Events, Language, and Tone; extracts
     infrastructure/utility news events from global media, geolocated.

All four label columns are written to separate Parquet files AND to a single
combined file: data/labels/weak_labels.parquet

Glossary:
  weak label       = a label derived from an imperfect/indirect source rather
                     than direct first-hand observation; typically noisier
                     but still useful for training if modelled correctly
  EM-DAT (CRED)    = Emergency Events Database from the Centre for Research on
                     Epidemiology of Disasters; ~28,000 disaster events since 1900
  DesInventar      = local disaster-loss database covering 90+ countries,
                     aligned to the Sendai Framework for DRR reporting
  GDELT            = Global Database of Events Language and Tone; ingests ~300
                     news sources daily and codes every "event" with a CAMEO
                     event type, country, location, and timestamp
  CAMEO code       = Conflict and Mediation Event Observations codes; 203 = power
                     outage, 180 = infrastructure damage, etc.
  label noise      = the expected inaccuracy rate of weak labels; disclosed in
                     dissertation as a methodological limitation

  Input  <- data/processed/master_features_uk_2000_2024.parquet
  Input  <- data/raw/labels/emdat_uk.csv
  Input  <- data/raw/labels/desinventar_uk.csv
  Input  <- data/raw/labels/gdelt_uk.csv
  Output -> data/labels/weak_labels.parquet
         -> data/labels/power_outage_labels.parquet
         -> data/labels/water_supply_labels.parquet
         -> data/labels/infrastructure_labels.parquet
         -> data/labels/public_safety_labels.parquet

Download:
  EM-DAT  : https://public.emdat.be -> query UK events -> CSV export (free account)
  DesInventar: https://www.desinventar.net -> UK -> download CSV
  GDELT   : https://www.gdeltproject.org -> Master file list or BigQuery
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

try:
    import numpy  as np
    import pandas as pd
except ImportError as exc:
    sys.exit(f"Missing: {exc}\nRun: pip install pandas numpy pyarrow")

_AI_ROOT   = Path(__file__).resolve().parents[2]
_RAW_LDIR  = _AI_ROOT / "data" / "raw" / "labels"
_PROC_DIR  = _AI_ROOT / "data" / "processed"
_LABEL_DIR = _AI_ROOT / "data" / "labels"

# Maps each weak-label hazard to the EM-DAT disaster type keywords that
# most reliably proxy for its occurrence
EMDAT_KEYWORDS: dict[str, list[str]] = {
    "power_outage":             ["storm", "flood", "earthquake", "wildfire", "winter storm"],
    "water_supply_disruption":  ["flood", "drought", "storm", "landslide"],
    "infrastructure_damage":    ["storm", "flood", "earthquake", "landslide", "wildfire"],
    "public_safety_incident":   ["epidemic", "mass movement", "fog", "extreme temp", "wildfire"],
}

# GDELT CAMEO root event codes associated with each hazard type
GDELT_CAMEO_ROOTS: dict[str, list[str]] = {
    "power_outage":             ["203", "205"],
    "water_supply_disruption":  ["204", "206"],
    "infrastructure_damage":    ["180", "182"],
    "public_safety_incident":   ["020", "021", "022"],
}


# EM-DAT loading

def load_emdat(path: Path) -> pd.DataFrame:
    """Parse EM-DAT CSV into a normalised DataFrame."""
    if not path.exists():
        return pd.DataFrame()
    df = pd.read_csv(str(path), skiprows=6)   # EM-DAT has a 6-row header
    df.columns = df.columns.str.lower().str.replace(" ", "_")
    # Relevant columns: disaster_type, start_year, start_month, start_day
    df["event_date"] = pd.to_datetime(
        df[["start_year", "start_month", "start_day"]]
        .rename(columns={"start_year": "year", "start_month": "month", "start_day": "day"}),
        errors="coerce"
    )
    return df.dropna(subset=["event_date"])


# DesInventar loading

def load_desinventar(path: Path) -> pd.DataFrame:
    """Parse DesInventar CSV."""
    if not path.exists():
        return pd.DataFrame()
    df = pd.read_csv(str(path))
    df.columns = df.columns.str.lower().str.replace(" ", "_")
    date_col = next((c for c in df.columns if "date" in c), None)
    type_col = next((c for c in df.columns if "event" in c or "disast" in c), None)
    if date_col:
        df["event_date"] = pd.to_datetime(df[date_col], errors="coerce")
    if type_col:
        df["event_type"] = df[type_col].str.lower()
    return df.dropna(subset=["event_date"])


# GDELT loading

def load_gdelt(path: Path) -> pd.DataFrame:
    """
    Load a GDELT CSV subset.  GDELT columns (25 fields) -- we use:
      EventCode (column 27), EventGeo_Lat, EventGeo_Long, SQLDATE (col 1)
    """
    if not path.exists():
        return pd.DataFrame()
    df = pd.read_csv(str(path), sep="\t", header=None, low_memory=False)
    if df.shape[1] < 30:
        return pd.DataFrame()
    # Standard GDELT column indices
    df = df.rename(columns={
        0:  "sqldate",
        26: "event_code",
        53: "lat",
        54: "lon",
    })
    df["event_date"] = pd.to_datetime(df["sqldate"].astype(str), format="%Y%m%d", errors="coerce")
    return df.dropna(subset=["event_date", "lat", "lon"])


# Label builder per hazard

def build_labels_for_hazard(
    master: pd.DataFrame,
    hazard: str,
    emdat: pd.DataFrame,
    desinventar: pd.DataFrame,
    gdelt: pd.DataFrame,
) -> pd.Series:
    """
    Return a binary label Series for `hazard` based on weak supervision.

    Strategy:
      - A master row is labelled 1 if EM-DAT or DesInventar records a relevant
        event type in the UK in the same calendar month (no spatial precision --
        these are country-level records).
      - Additionally labelled 1 if GDELT records a matching CAMEO event within
        100 km and 7 days of the master row.
    """
    labels = pd.Series(0, index=master.index, dtype=int)
    master_dates = pd.to_datetime(master["date"])

    # EM-DAT monthly flag
    if not emdat.empty and "disaster_type" in emdat.columns:
        kws    = [k.lower() for k in EMDAT_KEYWORDS.get(hazard, [])]
        emdat_mask = emdat["disaster_type"].str.lower().apply(
            lambda t: any(k in str(t) for k in kws)
        )
        emdat_events = emdat[emdat_mask]["event_date"]
        # Build set of (year, month) tuples that have at least one event
        emdat_ym = set(zip(emdat_events.dt.year, emdat_events.dt.month))
        ym_match = master_dates.apply(lambda d: (d.year, d.month) in emdat_ym)
        labels |= ym_match.astype(int).values

    # DesInventar monthly flag
    if not desinventar.empty and "event_type" in desinventar.columns:
        kws = [k.lower() for k in EMDAT_KEYWORDS.get(hazard, [])]
        di_mask = desinventar["event_type"].apply(
            lambda t: any(k in str(t) for k in kws)
        )
        di_ym = set(zip(
            desinventar[di_mask]["event_date"].dt.year,
            desinventar[di_mask]["event_date"].dt.month,
        ))
        ym_match2 = master_dates.apply(lambda d: (d.year, d.month) in di_ym)
        labels |= ym_match2.astype(int).values

    # GDELT spatial-temporal proximity (vectorised event-driven)
    if not gdelt.empty and "event_code" in gdelt.columns:
        root_codes = GDELT_CAMEO_ROOTS.get(hazard, [])
        gdelt_h = gdelt[gdelt["event_code"].astype(str).apply(
            lambda c: any(c.startswith(rc) for rc in root_codes)
        )]
        if not gdelt_h.empty:
            # Iterate events (thousands) instead of master rows (millions)
            master_dates = pd.to_datetime(master["date"])
            for _, ev in gdelt_h.iterrows():
                window_start = ev["event_date"] - pd.Timedelta(days=7)
                window_end   = ev["event_date"] + pd.Timedelta(days=7)
                row_mask = (master_dates >= window_start) & (master_dates <= window_end)
                if not row_mask.any():
                    continue
                candidates = master.loc[row_mask]
                dlat = np.radians(candidates["lat"].astype(float) - float(ev["lat"]))
                dlon = np.radians(candidates["lon"].astype(float) - float(ev["lon"]))
                a = (np.sin(dlat / 2) ** 2
                     + np.cos(np.radians(float(ev["lat"])))
                     * np.cos(np.radians(candidates["lat"].astype(float)))
                     * np.sin(dlon / 2) ** 2)
                dist_km = 6371 * 2 * np.arctan2(np.sqrt(a), np.sqrt(1 - a))
                hit_idx = candidates.index[dist_km <= 100]
                labels.iloc[labels.index.get_indexer(hit_idx)] = 1

    return labels


# Orchestrator

def build_weak_labels(args: argparse.Namespace) -> None:
    _LABEL_DIR.mkdir(parents=True, exist_ok=True)

    print("[1/5] Loading master features ...")
    master = pd.read_parquet(str(args.master))
    print(f"  {len(master):,} rows")

    print("[2/5] Loading external sources ...")
    emdat       = load_emdat(_RAW_LDIR / "emdat_uk.csv")
    desinventar = load_desinventar(_RAW_LDIR / "desinventar_uk.csv")
    gdelt       = load_gdelt(_RAW_LDIR / "gdelt_uk.csv")
    print(f"  EM-DAT: {len(emdat)} rows | DesInventar: {len(desinventar)} rows | GDELT: {len(gdelt)} rows")

    hazards = [
        "power_outage",
        "water_supply_disruption",
        "infrastructure_damage",
        "public_safety_incident",
    ]

    combined = master[["lat", "lon", "date"]].copy()

    for hazard in hazards:
        print(f"[3-5/{hazard}] Building weak labels for {hazard} ...")
        col = f"{hazard}_label"
        labels = build_labels_for_hazard(master, hazard, emdat, desinventar, gdelt)
        combined[col] = labels.values

        # Also save individual hazard file for modular training
        per_hazard = master[["lat", "lon", "date"]].copy()
        per_hazard[col] = labels.values
        individual_path = _LABEL_DIR / f"{hazard}_labels.parquet"
        per_hazard.to_parquet(str(individual_path), index=False, compression="snappy")
        pos_rate = labels.mean() * 100
        print(f"  {hazard}: positive rate {pos_rate:.2f}%  -> {individual_path}")

    combined_path = args.output or (_LABEL_DIR / "weak_labels.parquet")
    combined.to_parquet(str(combined_path), index=False, compression="snappy")
    print(f"\n  Combined weak labels -> {combined_path}")
    print(
        "\n  NOTE: These are WEAK labels derived from coarse national/regional data.\n"
        "  Expect ~15-25% label noise.  Document this limitation in your dissertation.\n"
        "  Transparency > overconfidence: report confidence intervals on these models."
    )


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--master", type=Path, default=_PROC_DIR / "master_features_uk_2000_2024.parquet")
    p.add_argument("--output", type=Path, default=None)
    return p.parse_args()


if __name__ == "__main__":
    build_weak_labels(parse_args())
