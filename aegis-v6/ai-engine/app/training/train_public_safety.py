"""
File: train_public_safety.py

What this file does:
Trains the public safety risk-prediction model on synthetic/augmented data.
Uses BaseHazardPipeline for the training loop. Useful as a quick
bootstrap when real-world labelled data is unavailable.

How it connects:
- Extends ai-engine/app/training/base_hazard_pipeline.py
- Synthetic feature generation via data_loaders.py and data_ingestion.py
- Saves to model_registry/public_safety_incident/ via ModelRegistry
- Loaded at inference time by ai-engine/app/hazards/public_safety_incident.py
"""

from __future__ import annotations

import argparse
import math

import numpy as np
import pandas as pd
from loguru import logger

from .base_hazard_pipeline import BaseHazardPipeline
from .data_fetch_open_meteo import fetch_grid_sample

class PublicSafetyPipeline(BaseHazardPipeline):
    HAZARD_NAME = "public_safety"
    MODEL_TYPE_LABEL = "experimental"
    FEATURES = [
        "temperature",
        "wind_speed",
        "precipitation",
        "heat_stress",
        "weather_discomfort",
        "hour_sin",
        "hour_cos",
        "is_weekend",
        "crowd_proxy",
    ]
    DATA_SOURCES = ["open-meteo"]
    LABEL_STRATEGY = (
        "EXPERIMENTAL weak heuristic: incident_risk=1 when heat_stress > 0.7 "
        "AND crowd_proxy > 0.5, OR extreme weather_discomfort > 0.8. "
        "No real public safety incident data available."
    )
    KNOWN_LIMITATIONS = (
        "No real incident reports used. Crowd estimates are time-of-day / "
        "weekend proxies only. Does not account for events, gatherings, "
        "or real crowd density data. Very experimental."
    )

    def ingest_data(self) -> pd.DataFrame:
        return fetch_grid_sample(
            bbox=self.region.bbox,
            start_date=self.region.default_start,
            end_date=self.region.default_end,
            n_points=20,
            hourly_vars=[
                "temperature_2m",
                "relative_humidity_2m",
                "wind_speed_10m",
                "precipitation",
            ],
            seed=self.RANDOM_SEED,
        )

    def engineer_features(self, raw: pd.DataFrame) -> pd.DataFrame:
        df = raw.copy()
        df.rename(columns={
            "temperature_2m": "temperature",
            "relative_humidity_2m": "humidity",
            "wind_speed_10m": "wind_speed",
        }, inplace=True)

        # Time features
        ts = df.index if hasattr(df.index, "hour") else pd.to_datetime(df.index)
        df["hour_sin"] = np.sin(2 * math.pi * ts.hour / 24)
        df["hour_cos"] = np.cos(2 * math.pi * ts.hour / 24)
        df["is_weekend"] = ts.dayofweek.isin([5, 6]).astype(float)

        # Heat stress index (simplified)
        df["heat_stress"] = np.clip(
            (df["temperature"] - 20) / 20 * (df["humidity"] / 100),
            0, 1
        )

        # Weather discomfort (cold, rain, wind)
        cold_factor = np.clip((5 - df["temperature"]) / 20, 0, 1)
        rain_factor = np.clip(df["precipitation"] / 10, 0, 1)
        wind_factor = np.clip(df["wind_speed"] / 25, 0, 1)
        df["weather_discomfort"] = 0.4 * cold_factor + 0.3 * rain_factor + 0.3 * wind_factor

        # Crowd proxy: higher in evenings / weekends
        evening = ((ts.hour >= 17) & (ts.hour <= 22)).astype(float) * 0.6
        weekend_bonus = df["is_weekend"] * 0.3
        df["crowd_proxy"] = np.clip(evening + weekend_bonus + 0.1, 0, 1)

        return df

    def generate_labels(self, df: pd.DataFrame) -> pd.Series:
        """EXPERIMENTAL: heat stress + crowds OR extreme weather discomfort."""
        heat_crowd = (df["heat_stress"] > 0.7) & (df["crowd_proxy"] > 0.5)
        bad_weather = df["weather_discomfort"] > 0.8
        labels = (heat_crowd | bad_weather).astype(int)
        logger.info(f"Label distribution: {labels.value_counts().to_dict()}")
        return labels

def main():
    parser = argparse.ArgumentParser(description="Train public-safety hazard model")
    parser.add_argument("--region", default="global")
    args = parser.parse_args()

    pipeline = PublicSafetyPipeline(region_id=args.region)
    result = pipeline.run()
    logger.success(f"Done: {result}")

if __name__ == "__main__":
    main()
