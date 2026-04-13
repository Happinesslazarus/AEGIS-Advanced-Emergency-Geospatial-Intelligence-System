"""
File: train_landslide.py

What this file does:
Trains the landslide risk-prediction model on synthetic/augmented data.
Uses BaseHazardPipeline for the training loop. Useful as a quick
bootstrap when real-world labelled data is unavailable.

How it connects:
- Extends ai-engine/app/training/base_hazard_pipeline.py
- Synthetic feature generation via data_loaders.py and data_ingestion.py
- Saves to model_registry/landslide/ via ModelRegistry
- Loaded at inference time by ai-engine/app/hazards/landslide.py
"""

from __future__ import annotations

import argparse
import math

import numpy as np
import pandas as pd
from loguru import logger

from .base_hazard_pipeline import BaseHazardPipeline
from .data_fetch_open_meteo import fetch_grid_sample

class LandslidePipeline(BaseHazardPipeline):
    HAZARD_NAME = "landslide"
    MODEL_TYPE_LABEL = "experimental"
    FEATURES = [
        "rainfall_7d",
        "rainfall_30d",
        "slope_proxy",
        "soil_moisture",
        "soil_saturation_proxy",
        "season_sin",
        "season_cos",
    ]
    DATA_SOURCES = ["open-meteo"]
    LABEL_STRATEGY = (
        "EXPERIMENTAL proxy: landslide_risk=1 when 7-day rainfall > 100 mm "
        "AND slope_proxy > 15 degrees AND soil_moisture > 0.35. "
        "No verified landslide event data available globally. "
        "This model is NOT production-grade."
    )
    KNOWN_LIMITATIONS = (
        "No real landslide occurrence labels. Slope is approximated from "
        "elevation differences between nearby grid points, not real SRTM DEM. "
        "Soil type and land cover are not available from Open-Meteo. "
        "Results should be treated as experimental indicators only."
    )

    def ingest_data(self) -> pd.DataFrame:
        return fetch_grid_sample(
            bbox=self.region.bbox,
            start_date=self.region.default_start,
            end_date=self.region.default_end,
            n_points=25,
            hourly_vars=[
                "temperature_2m",
                "precipitation",
                "soil_moisture_0_to_7cm",
                "surface_pressure",
            ],
            seed=self.RANDOM_SEED,
        )

    def engineer_features(self, raw: pd.DataFrame) -> pd.DataFrame:
        df = raw.copy()
        df.rename(columns={
            "soil_moisture_0_to_7cm": "soil_moisture",
        }, inplace=True)

        # Rolling rainfall
        df["rainfall_7d"] = (
            df.groupby("location_id")["precipitation"]
            .transform(lambda s: s.rolling(7 * 24, min_periods=1).sum())
        )
        df["rainfall_30d"] = (
            df.groupby("location_id")["precipitation"]
            .transform(lambda s: s.rolling(30 * 24, min_periods=1).sum())
        )

        # Real slope from Open-Elevation API (elevation difference between neighbors)
        import aiohttp

        ELEVATION_URL = "https://api.open-elevation.com/api/v1/lookup"

        async def _get_slopes(locs):
            """Query Open-Elevation for real slope at each location using 4-neighbor gradient."""
            slope_map = {}
            delta_deg = 0.005  # ~500m offset for gradient calc
            async with aiohttp.ClientSession() as session:
                for lid in locs:
                    loc_rows = df.loc[df["location_id"] == lid]
                    lat = loc_rows["latitude"].iloc[0]
                    lon = loc_rows["longitude"].iloc[0]
                    points = [
                        {"latitude": lat, "longitude": lon},
                        {"latitude": lat + delta_deg, "longitude": lon},
                        {"latitude": lat - delta_deg, "longitude": lon},
                        {"latitude": lat, "longitude": lon + delta_deg},
                        {"latitude": lat, "longitude": lon - delta_deg},
                    ]
                    try:
                        async with session.post(
                            ELEVATION_URL,
                            json={"locations": points},
                            timeout=aiohttp.ClientTimeout(total=15),
                        ) as resp:
                            if resp.status == 200:
                                data = await resp.json(content_type=None)
                                elevs = [r["elevation"] for r in data["results"]]
                                # Slope ≈ max gradient (degrees)
                                import math as _m
                                dx = abs(elevs[3] - elevs[4]) / (2 * delta_deg * 111_000)
                                dy = abs(elevs[1] - elevs[2]) / (2 * delta_deg * 111_000)
                                slope_deg = _m.degrees(_m.atan(_m.sqrt(dx**2 + dy**2)))
                                slope_map[lid] = max(0.1, slope_deg)
                                continue
                    except Exception:
                        pass
                    slope_map[lid] = None
            return slope_map

        import asyncio as _aio
        try:
            loop = _aio.get_running_loop()
        except RuntimeError:
            loop = None

        loc_ids = df["location_id"].unique()
        if loop and loop.is_running():
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as pool:
                slope_map = pool.submit(lambda: _aio.run(_get_slopes(loc_ids))).result()
        else:
            slope_map = _aio.run(_get_slopes(loc_ids))

        failed = [lid for lid, v in slope_map.items() if v is None]
        if len(failed) == len(loc_ids):
            raise ValueError(
                "TRAINING ABORTED: Open-Elevation API unreachable for ALL locations. "
                "Cannot compute real slope values. Check network connectivity to api.open-elevation.com."
            )
        if failed:
            # Fill missing with median of successful lookups
            valid_slopes = [v for v in slope_map.values() if v is not None]
            median_slope = sorted(valid_slopes)[len(valid_slopes) // 2]
            for lid in failed:
                slope_map[lid] = median_slope
            logger.warning(f"Open-Elevation failed for {len(failed)}/{len(loc_ids)} locations, using median={median_slope:.1f}°")

        df["slope_proxy"] = df["location_id"].map(slope_map)

        # Soil saturation proxy (soil_moisture normalised to 0-1)
        sm_max = df["soil_moisture"].quantile(0.99) or 1.0
        df["soil_saturation_proxy"] = np.clip(df["soil_moisture"] / sm_max, 0, 1)

        # Season
        month = df.index.month if hasattr(df.index, "month") else pd.to_datetime(df.index).month
        df["season_sin"] = np.sin(2 * math.pi * month / 12)
        df["season_cos"] = np.cos(2 * math.pi * month / 12)

        return df

    def generate_labels(self, df: pd.DataFrame) -> pd.Series:
        """
        EXPERIMENTAL: 1 when heavy rain + steep slope + saturated soil.
        """
        labels = (
            (df["rainfall_7d"] > 100)
            & (df["slope_proxy"] > 15)
            & (df["soil_moisture"] > 0.35)
        ).astype(int)
        logger.info(f"Label distribution: {labels.value_counts().to_dict()}")
        return labels

def main():
    parser = argparse.ArgumentParser(description="Train landslide hazard model")
    parser.add_argument("--region", default="global")
    args = parser.parse_args()

    pipeline = LandslidePipeline(region_id=args.region)
    result = pipeline.run()
    logger.success(f"Done: {result}")

if __name__ == "__main__":
    main()
