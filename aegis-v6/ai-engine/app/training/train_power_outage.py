"""
Trains the power outage risk-prediction model on synthetic/augmented data.
Uses BaseHazardPipeline for the training loop. Useful as a quick
bootstrap when real-world labelled data is unavailable.

- Extends ai-engine/app/training/base_hazard_pipeline.py
- Synthetic feature generation via data_loaders.py and data_ingestion.py
- Saves to model_registry/power_outage/ via ModelRegistry
- Loaded at inference time by ai-engine/app/hazards/power_outage.py
"""

from __future__ import annotations

import argparse
import math

import numpy as np
import pandas as pd
from loguru import logger

from .base_hazard_pipeline import BaseHazardPipeline
from .data_fetch_open_meteo import fetch_grid_sample

class PowerOutagePipeline(BaseHazardPipeline):
    HAZARD_NAME = "power_outage"
    MODEL_TYPE_LABEL = "heuristic_model"
    FEATURES = [
        "wind_speed",
        "wind_gust",
        "temperature",
        "ice_risk",
        "rainfall_intensity",
        "infrastructure_age_proxy",
        "season_sin",
        "season_cos",
    ]
    DATA_SOURCES = ["open-meteo"]
    LABEL_STRATEGY = (
        "Heuristic proxy: outage=1 when extreme wind (>25 m/s) OR "
        "ice conditions (temp < -2°C AND precipitation > 0.5 mm/h) OR "
        "combined wind+rain stress. Synthetic infrastructure age proxy. "
        "No real outage event data used -- HEURISTIC MODEL."
    )
    KNOWN_LIMITATIONS = (
        "No real power outage records. Infrastructure age is a random proxy. "
        "Grid-specific factors (line type, vegetation proximity, age) are "
        "not captured. Model cannot account for grid resilience differences."
    )

    def ingest_data(self) -> pd.DataFrame:
        return fetch_grid_sample(
            bbox=self.region.bbox,
            start_date=self.region.default_start,
            end_date=self.region.default_end,
            n_points=25,
            hourly_vars=[
                "temperature_2m",
                "relative_humidity_2m",
                "wind_speed_10m",
                "wind_gusts_10m",
                "precipitation",
            ],
            seed=self.RANDOM_SEED,
        )

    def engineer_features(self, raw: pd.DataFrame) -> pd.DataFrame:
        df = raw.copy()
        df.rename(columns={
            "wind_speed_10m": "wind_speed",
            "wind_gusts_10m": "wind_gust",
            "temperature_2m": "temperature",
        }, inplace=True)

        # Ice risk: binary when temperature < -2°C
        df["ice_risk"] = (df["temperature"] < -2.0).astype(float)

        # Rainfall intensity (direct hourly precipitation)
        df["rainfall_intensity"] = df["precipitation"].fillna(0)

        # Infrastructure age proxy: derived from REAL elevation via Open-Elevation API
        # Higher elevation = older, more remote infrastructure (longer lines, harder maintenance)
 # Mapping: elevation_m / 10 -> capped at 60 years
        import aiohttp

        ELEVATION_URL = "https://api.open-elevation.com/api/v1/lookup"

        async def _get_infra_age(locs):
            age_map = {}
            async with aiohttp.ClientSession() as session:
                for lid in locs:
                    loc_rows = df.loc[df["location_id"] == lid]
                    lat = loc_rows["latitude"].iloc[0]
                    lon = loc_rows["longitude"].iloc[0]
                    try:
                        async with session.get(
                            ELEVATION_URL,
                            params={"locations": f"{lat},{lon}"},
                            timeout=aiohttp.ClientTimeout(total=10),
                        ) as resp:
                            if resp.status == 200:
                                data = await resp.json(content_type=None)
                                elev = float(data["results"][0]["elevation"])
                                # Low areas = newer urban infra; high = older rural
                                age = min(60.0, max(5.0, elev / 10.0))
                                age_map[lid] = age
                                continue
                    except Exception:
                        pass
                    age_map[lid] = None
            return age_map

        import asyncio as _aio
        try:
            loop = _aio.get_running_loop()
        except RuntimeError:
            loop = None

        loc_ids = df["location_id"].unique()
        if loop and loop.is_running():
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as pool:
                age_map = pool.submit(lambda: _aio.run(_get_infra_age(loc_ids))).result()
        else:
            age_map = _aio.run(_get_infra_age(loc_ids))

        failed = [lid for lid, v in age_map.items() if v is None]
        if len(failed) == len(loc_ids):
            raise ValueError(
                "TRAINING ABORTED: Open-Elevation API unreachable for ALL locations. "
                "Cannot derive infrastructure age proxy from elevation. Check network connectivity."
            )
        if failed:
            valid = [v for v in age_map.values() if v is not None]
            median_age = sorted(valid)[len(valid) // 2]
            for lid in failed:
                age_map[lid] = median_age
            logger.warning(f"Open-Elevation failed for {len(failed)}/{len(loc_ids)} locations, using median age={median_age:.1f}")

        df["infrastructure_age_proxy"] = df["location_id"].map(age_map)

        # Season
        month = df.index.month if hasattr(df.index, "month") else pd.to_datetime(df.index).month
        df["season_sin"] = np.sin(2 * math.pi * month / 12)
        df["season_cos"] = np.cos(2 * math.pi * month / 12)

        return df

    def generate_labels(self, df: pd.DataFrame) -> pd.Series:
        """
        Heuristic: outage=1 when extreme wind OR icing conditions.
        """
        wind_extreme = df["wind_speed"] > 25.0
        icing = (df["temperature"] < -2.0) & (df["rainfall_intensity"] > 0.5)
        wind_rain_combo = (df["wind_speed"] > 18.0) & (df["rainfall_intensity"] > 5.0)
        labels = (wind_extreme | icing | wind_rain_combo).astype(int)
        logger.info(f"Label distribution: {labels.value_counts().to_dict()}")
        return labels

def main():
    parser = argparse.ArgumentParser(description="Train power-outage hazard model")
    parser.add_argument("--region", default="global")
    args = parser.parse_args()

    pipeline = PowerOutagePipeline(region_id=args.region)
    result = pipeline.run()
    logger.success(f"Done: {result}")

if __name__ == "__main__":
    main()
