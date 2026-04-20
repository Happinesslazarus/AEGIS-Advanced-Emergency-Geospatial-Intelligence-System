#!/usr/bin/env python3
"""
AEGIS AI Engine -- Data Setup Helper
Run this script once before the first training run.  It:

  1. Auto-downloads everything that does not require registration (IBTrACS,
     Stats19, NHTSA FARS, SPEI, EIA OE-417).
  2. Checks for datasets that require free registration and prints the exact
     URL and file path you need to use.
  3. Verifies your FIRMS_MAP_KEY environment variable for wildfire labels.

Usage:
    cd aegis-v6/ai-engine
    python setup_data.py              # check + download auto-downloadable data
    python setup_data.py --download   # same, but forces re-download of all files

After running this script, run training:
    python app/training/train_all.py --start-date 2015-01-01 --end-date 2025-12-31
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

# Ensure app imports resolve
_AI_ROOT = Path(__file__).resolve().parent
if str(_AI_ROOT) not in sys.path:
    sys.path.insert(0, str(_AI_ROOT))

try:
    from loguru import logger
except ImportError:
    import logging
    logger = logging.getLogger("setup_data")
    logging.basicConfig(level=logging.INFO)

# Load .env so FIRMS_MAP_KEY etc. are visible without manual export
try:
    from dotenv import load_dotenv
    load_dotenv(_AI_ROOT / ".env", override=False)
except ImportError:
    pass


# Status tracking

_OK      = "  [OK]      "
_READY   = "  [READY]   "
_MISSING = "  [MISSING] "
_ACTION  = "  [ACTION]  "
_INFO    = "  [INFO]    "


def _section(title: str) -> None:
    print(f"\n{'='*60}")
    print(f"  {title}")
    print('='*60)


# 1.  Auto-downloadable datasets

def setup_spei(force: bool = False) -> bool:
    """CSIC SPEI Global v2.9 -- drought labels (no registration required)."""
    _section("SPEI -- Drought labels (CSIC, CRU TS4 observed)")
    try:
        from app.training.data_fetch_spei import download_spei_dataset, spei_is_available
        for scale in (3, 12):
            if spei_is_available(scale) and not force:
                nc = _AI_ROOT / "data" / "spei" / f"spei{scale:02d}.nc"
                sz = nc.stat().st_size // 1_000_000
                print(f"{_OK}spei{scale:02d}.nc present ({sz} MB)")
            else:
                print(f"{_INFO}Downloading SPEI-{scale} (~150 MB) ...")
                result = download_spei_dataset(scale_months=scale, force=force)
                if result:
                    print(f"{_OK}spei{scale:02d}.nc downloaded")
                else:
                    print(f"{_MISSING}spei{scale:02d}.nc download failed -- see instructions above")
                    return False
        return True
    except Exception as exc:
        print(f"{_MISSING}SPEI setup error: {exc}")
        return False


def setup_ibtracs(force: bool = False) -> bool:
    """IBTrACS global storm tracks -- severe storm labels (no registration required)."""
    _section("IBTrACS -- Storm labels (NCEI/WMO, per-basin CSVs)")
    try:
        from app.training.data_fetch_ibtracs import download_ibtracs_basin
        basins = ["NA", "WP", "EP", "NI", "SI", "SP"]
        ok = True
        for basin in basins:
            result = download_ibtracs_basin(basin=basin, force=force)
            if result:
                sz = Path(result).stat().st_size // 1_000_000
                print(f"{_OK}IBTrACS {basin}: {sz} MB")
            else:
                print(f"{_MISSING}IBTrACS {basin} download failed")
                ok = False
        return ok
    except Exception as exc:
        print(f"{_MISSING}IBTrACS setup error: {exc}")
        return False


def setup_stats19(force: bool = False) -> bool:
    """UK DfT Stats19 road accident CSVs -- public safety labels (no registration)."""
    _section("Stats19 -- Public safety labels (UK DfT, 2015-2023)")
    try:
        from app.training.data_fetch_road_accidents import (
            download_stats19, road_accidents_available,
        )
        if road_accidents_available() and not force:
            print(f"{_OK}Stats19 files already present")
            return True
        print(f"{_INFO}Downloading Stats19 CSVs for 2015-2023 (~5 MB/year) ...")
        paths = download_stats19(years=range(2015, 2024), force=force)
        print(f"{_OK}{len(paths)} Stats19 files downloaded")
        return len(paths) > 0
    except Exception as exc:
        print(f"{_MISSING}Stats19 setup error: {exc}")
        return False


def setup_nhtsa_fars(force: bool = False) -> bool:
    """US NHTSA FARS fatal accident data -- public safety labels (no registration)."""
    _section("NHTSA FARS -- Public safety labels (US, 2015-2022)")
    try:
        from app.training.data_fetch_road_accidents import (
            download_nhtsa_fars, road_accidents_available,
        )
        print(f"{_INFO}Downloading NHTSA FARS ZIPs for 2015-2022 (~20-40 MB/year) ...")
        paths = download_nhtsa_fars(years=range(2015, 2023), force=force)
        print(f"{_OK}{len(paths)} FARS files downloaded")
        return len(paths) > 0
    except Exception as exc:
        print(f"{_MISSING}NHTSA FARS setup error: {exc}")
        return False


def setup_eia_oe417(force: bool = False) -> bool:
    """EIA OE-417 power disturbance reports -- power outage labels (no registration)."""
    _section("EIA OE-417 -- Power outage labels (US EIA, 2015-2024)")
    try:
        from app.training.data_fetch_outages import download_eia_oe417, outages_available
        outages_available()  # logs UK embedded status
        print(f"{_INFO}Downloading EIA OE-417 Excel files for 2015-2024 ...")
        paths = download_eia_oe417(years=range(2015, 2025), force=force)
        print(f"{_OK}{len(paths)} EIA OE-417 files downloaded")
        if len(paths) < 5:
            print(f"{_INFO}UK storm outage records are embedded -- US coverage is optional")
        return True  # UK records always present
    except Exception as exc:
        print(f"{_MISSING}EIA OE-417 setup error: {exc}")
        return False


def setup_grdc_catalogue(force: bool = False) -> bool:
    """GRDC station catalogue -- water supply labels (free registration required)."""
    _section("GRDC -- Water supply labels (WMO gauge network)")
    try:
        from app.training.data_fetch_grdc import (
            download_grdc_station_list, water_supply_data_available,
        )
        water_supply_data_available()  # logs embedded event status

        cat = _AI_ROOT / "data" / "grdc" / "grdc_stations_catalogue.csv"
        if cat.exists() and not force:
            print(f"{_OK}GRDC station catalogue present")
        else:
            print(f"{_INFO}Attempting GRDC catalogue download (requires no registration) ...")
            result = download_grdc_station_list(force=force)
            if result:
                print(f"{_OK}GRDC catalogue downloaded: {result}")
            else:
                print(f"{_INFO}GRDC catalogue unavailable -- station data needs manual download")

        print(f"{_INFO}Static water disruption events are always embedded (Cape Town,")
        print(f"       UK 2018/2022, São Paulo, Lake Mead, etc.) -- GRDC adds precision.")
        print(f"{_ACTION}For GRDC gauge data: register FREE at https://grdc.bafg.de")
        print(f"       then: python -c \"from app.training.data_fetch_grdc import")
        print(f"       download_grdc_station; download_grdc_station(6122100)\"")
        return True  # Static events always available
    except Exception as exc:
        print(f"{_MISSING}GRDC setup error: {exc}")
        return False


# 2.  Registration-required datasets

def check_firms_key() -> bool:
    """NASA FIRMS MAP_KEY -- wildfire labels."""
    _section("NASA FIRMS -- Wildfire labels (satellite active fire pixels)")
    key = os.environ.get("FIRMS_MAP_KEY", "")
    if key:
        print(f"{_OK}FIRMS_MAP_KEY is set ({key[:8]}...)")
        print(f"{_INFO}Wildfire will use VIIRS/MODIS satellite labels (LeakageSeverity.NONE)")
        return True
    else:
        print(f"{_MISSING}FIRMS_MAP_KEY environment variable is NOT set")
        print(f"{_ACTION}Register FREE at: https://firms.modaps.eosdis.nasa.gov/api/map_key/")
        print(f"       Then set: export FIRMS_MAP_KEY=your_key_here")
        print(f"       Without this, wildfire falls back to FWI threshold proxy labels")
        print(f"       (data_validity='proxy', LeakageSeverity.LOW) -- still trainable")
        print(f"       but not at maximum scientific quality.")
        return False


def check_emdat() -> bool:
    """EM-DAT global disaster catalog -- infrastructure damage labels."""
    _section("EM-DAT -- Infrastructure damage labels (CRED)")
    emdat_path = _AI_ROOT / "data" / "emdat" / "emdat_export.xlsx"
    if emdat_path.exists():
        sz = emdat_path.stat().st_size // 1_000_000
        print(f"{_OK}emdat_export.xlsx present ({sz} MB)")
        return True
    else:
        print(f"{_MISSING}emdat_export.xlsx NOT found at:")
        print(f"       {emdat_path}")
        print(f"{_ACTION}Register FREE at: https://public.emdat.be")
        print(f"       (requires institutional/academic affiliation)")
        print(f"       After registration:")
        print(f"       1. Log in -> Data -> Select 'All disasters'")
        print(f"       2. Download as Excel format")
        print(f"       3. Save to: {emdat_path}")
        print(f"       Without this, infrastructure_damage pipeline will raise")
        print(f"       RuntimeError and be marked NOT_TRAINABLE.")
        return False


# 3.  Summary and training instructions

def print_summary(results: dict[str, bool]) -> None:
    _section("SETUP SUMMARY")
    trainable = []
    not_ready = []
    for name, ok in results.items():
        if ok:
            print(f"{_OK}{name}")
            trainable.append(name)
        else:
            print(f"{_MISSING}{name}")
            not_ready.append(name)

    _section("NEXT STEPS")
    if not not_ready:
        print("  All datasets ready.  Run training:")
        print()
        print("    cd aegis-v6/ai-engine")
        print("    python app/training/train_all.py \\")
        print("      --start-date 2015-01-01 --end-date 2025-12-31")
        print()
        print("  For a quick test run (2 years, faster):")
        print("    python app/training/train_all.py --fast")
    else:
        print(f"  {len(not_ready)} dataset(s) need attention (see [ACTION] items above).")
        print(f"  {len(trainable)} dataset(s) are ready.")
        print()
        print("  You can still train -- pipelines with missing optional data")
        print("  will use embedded fallbacks where available:")
        print("    - power_outage:    UK storm records always embedded")
        print("    - water_supply:    static crisis events always embedded")
        print("    - wildfire:        falls back to FWI proxy (still trains)")
        print()
        print("  infrastructure_damage requires EM-DAT -- will be NOT_TRAINABLE")
        print("  until emdat_export.xlsx is placed in data/emdat/.")
        print()
        print("  When ready, run:")
        print("    python app/training/train_all.py --start-date 2015-01-01 --end-date 2025-12-31")


# Main

def main() -> None:
    parser = argparse.ArgumentParser(
        description="AEGIS AI Engine -- Data Setup Helper"
    )
    parser.add_argument(
        "--download", action="store_true",
        help="Force re-download of all auto-downloadable files"
    )
    parser.add_argument(
        "--skip-ibtracs", action="store_true",
        help="Skip IBTrACS download (6 files, ~100 MB total)"
    )
    parser.add_argument(
        "--skip-fars", action="store_true",
        help="Skip NHTSA FARS download (slow, ~30 MB/year)"
    )
    args = parser.parse_args()
    force = args.download

    print("\nAEGIS AI Engine -- Data Setup")
    print("This script downloads all freely available training data and")
    print("guides you through datasets that require free registration.\n")

    results: dict[str, bool] = {}

    # Auto-downloadable
    results["SPEI drought labels"]          = setup_spei(force)
    if not args.skip_ibtracs:
        results["IBTrACS storm labels"]     = setup_ibtracs(force)
    else:
        print(f"\n{_INFO}IBTrACS download skipped (--skip-ibtracs)")
    results["Stats19 public safety labels"] = setup_stats19(force)
    if not args.skip_fars:
        results["NHTSA FARS public safety"] = setup_nhtsa_fars(force)
    else:
        print(f"\n{_INFO}NHTSA FARS download skipped (--skip-fars)")
    results["EIA OE-417 outage labels"]     = setup_eia_oe417(force)
    results["GRDC water supply labels"]     = setup_grdc_catalogue(force)

    # Registration-required
    results["NASA FIRMS wildfire key"]      = check_firms_key()
    results["EM-DAT infrastructure labels"] = check_emdat()

    print_summary(results)


if __name__ == "__main__":
    main()
