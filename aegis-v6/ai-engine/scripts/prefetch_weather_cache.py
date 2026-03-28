#!/usr/bin/env python
"""Pre-fetch and cache multi-location weather data for all hazard model training.

Run this ONCE before training models to avoid repeated API calls and rate limits.
All training scripts will then use the cached CSV automatically.

Usage:
    python -m scripts.prefetch_weather_cache
"""
import asyncio
import sys
from pathlib import Path

# Ensure ai-engine root is on path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.training.multi_location_weather import fetch_multi_location_weather

async def main():
    print("Pre-fetching multi-location weather data (13 UK locations, 2015-2025)...")
    print("This may take 5-10 minutes due to API rate limits.")
    df = await fetch_multi_location_weather(
        start_date="2015-01-01",
        end_date="2025-12-31",
    )
    if df.empty:
        print("ERROR: No data fetched!")
        sys.exit(1)
    print(f"SUCCESS: {len(df):,} rows from {df['station_id'].nunique()} locations cached.")

if __name__ == "__main__":
    asyncio.run(main())
