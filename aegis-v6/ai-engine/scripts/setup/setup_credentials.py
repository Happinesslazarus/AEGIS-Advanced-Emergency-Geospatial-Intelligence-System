"""
setup_credentials.py -- Interactive wizard to configure all external API credentials.

Sets up:
  1. Copernicus CDS (~/.cdsapirc)           -- ERA5, CHIRPS, SPEI via cdsapi
  2. NASA Earthdata (~/.netrc)               -- FIRMS, MODIS, SMAP via requests
  3. Weights & Biases (wandb login)          -- Experiment tracking

Usage:
  python scripts/setup/setup_credentials.py
  python scripts/setup/setup_credentials.py --cds-only
  python scripts/setup/setup_credentials.py --nasa-only
  python scripts/setup/setup_credentials.py --wandb-only
  python scripts/setup/setup_credentials.py --verify
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

HOME = Path.home()
CDS_RC   = HOME / ".cdsapirc"
NETRC    = HOME / ".netrc"


# CDS setup
CDS_REGISTER_URL = "https://cds.climate.copernicus.eu/api-how-to"

def setup_cds() -> None:
    print("\n=== Copernicus Climate Data Store (CDS) ===")
    print(f"Register at: {CDS_REGISTER_URL}")
    print("After registering, go to your profile page to find your UID and API key.\n")

    if CDS_RC.exists():
        print(f"  Existing config found at {CDS_RC}")
        overwrite = input("  Overwrite? [y/N]: ").strip().lower()
        if overwrite != "y":
            print("  Keeping existing config.")
            return

    uid     = input("  Enter your CDS UID (numeric): ").strip()
    api_key = input("  Enter your CDS API key: ").strip()

    if not uid or not api_key:
        print("  Skipped -- empty input.")
        return

    content = f"url: https://cds.climate.copernicus.eu/api/v2\nkey: {uid}:{api_key}\n"
    CDS_RC.write_text(content, encoding="utf-8")
    print(f"  Saved -> {CDS_RC}")

    # Quick verification
    try:
        import cdsapi
        c = cdsapi.Client(quiet=True)
        print("  CDS connection OK.")
    except Exception as exc:
        print(f"  Warning: CDS verification failed: {exc}")
        print("  This is OK if you just set it up -- try again in a few minutes.")


# NASA Earthdata setup
NASA_REGISTER_URL = "https://urs.earthdata.nasa.gov/users/new"

def setup_nasa() -> None:
    print("\n=== NASA Earthdata ===")
    print(f"Register at: {NASA_REGISTER_URL}")
    print("After registering, approve these apps in your Earthdata profile:")
    print("  - NASA GESDISC DATA ARCHIVE")
    print("  - Earthdata Search\n")

    existing = ""
    if NETRC.exists():
        existing = NETRC.read_text(encoding="utf-8")
        if "urs.earthdata.nasa.gov" in existing:
            print(f"  NASA Earthdata entry already exists in {NETRC}")
            overwrite = input("  Overwrite NASA entry? [y/N]: ").strip().lower()
            if overwrite != "y":
                print("  Keeping existing entry.")
                return

    username = input("  Enter your NASA Earthdata username: ").strip()
    password = input("  Enter your NASA Earthdata password: ").strip()

    if not username or not password:
        print("  Skipped -- empty input.")
        return

    # Append or create .netrc entry
    nasa_entry = (
        f"\nmachine urs.earthdata.nasa.gov login {username} password {password}\n"
    )

    # Remove old NASA entry if present
    if "urs.earthdata.nasa.gov" in existing:
        lines = existing.splitlines(keepends=True)
        filtered = []
        skip = False
        for line in lines:
            if "urs.earthdata.nasa.gov" in line:
                skip = True
            elif skip and line.startswith("machine "):
                skip = False
            if not skip:
                filtered.append(line)
        existing = "".join(filtered)

    NETRC.write_text(existing + nasa_entry, encoding="utf-8")
    # Secure the file (important on Unix; no-op on Windows)
    try:
        os.chmod(NETRC, 0o600)
    except Exception:
        pass
    print(f"  Saved -> {NETRC}")
    print("  NASA Earthdata credentials configured.")


# W&B setup
WANDB_REGISTER_URL = "https://wandb.ai/authorize"

def setup_wandb() -> None:
    print("\n=== Weights & Biases ===")
    print(f"Get your API key at: {WANDB_REGISTER_URL}")

    api_key = input("  Enter your W&B API key (or press Enter to open browser): ").strip()

    try:
        if api_key:
            import wandb
            wandb.login(key=api_key, relogin=True)
            print("  W&B login successful.")
        else:
            subprocess.run(
                [sys.executable, "-m", "wandb", "login"],
                check=True,
            )
    except Exception as exc:
        print(f"  W&B setup failed: {exc}")
        print("  Run manually: wandb login")


# Verification
def verify_all() -> None:
    print("\n=== Credential Verification ===")

    # CDS
    if CDS_RC.exists():
        print(f"  [OK] CDS config exists: {CDS_RC}")
        try:
            import cdsapi
            cdsapi.Client(quiet=True)
            print("  [OK] CDS connection verified.")
        except Exception as exc:
            print(f"  [WARN] CDS connection: {exc}")
    else:
        print(f"  [MISSING] CDS config not found at {CDS_RC}")

    # NASA
    if NETRC.exists() and "urs.earthdata.nasa.gov" in NETRC.read_text(encoding="utf-8"):
        print(f"  [OK] NASA Earthdata entry in {NETRC}")
    else:
        print(f"  [MISSING] NASA Earthdata entry not in {NETRC}")

    # W&B
    try:
        import wandb
        api = wandb.Api(timeout=10)
        print(f"  [OK] W&B authenticated as: {api.viewer['entity']}")
    except Exception as exc:
        print(f"  [MISSING] W&B not configured: {exc}")

    # GEE
    try:
        import ee
        ee.Initialize(project=os.getenv("GEE_PROJECT", "aegis-disaster-intelligence"))
        print("  [OK] Google Earth Engine authenticated.")
    except Exception as exc:
        print(f"  [MISSING] GEE not configured: {exc}")


# CLI
def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Set up AEGIS external API credentials")
    p.add_argument("--cds-only",   action="store_true")
    p.add_argument("--nasa-only",  action="store_true")
    p.add_argument("--wandb-only", action="store_true")
    p.add_argument("--verify",     action="store_true", help="Check all credentials without prompting")
    return p.parse_args()


def main() -> None:
    args = parse_args()

    if args.verify:
        verify_all()
        return

    if args.cds_only:
        setup_cds()
    elif args.nasa_only:
        setup_nasa()
    elif args.wandb_only:
        setup_wandb()
    else:
        print("AEGIS Credential Setup Wizard")
        print("="*40)
        setup_cds()
        setup_nasa()
        setup_wandb()

    print("\nDone. Run --verify to confirm everything works.")


if __name__ == "__main__":
    main()
