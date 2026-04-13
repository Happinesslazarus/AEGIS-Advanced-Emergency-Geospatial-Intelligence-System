"""
File: train_environmental_hazard.py

What this file does:
Trains the environmental hazard risk-prediction model on synthetic/augmented data.
Uses BaseHazardPipeline for the training loop. Useful as a quick
bootstrap when real-world labelled data is unavailable.

How it connects:
- Extends ai-engine/app/training/base_hazard_pipeline.py
- Synthetic feature generation via data_loaders.py and data_ingestion.py
- Saves to model_registry/environmental_hazard/ via ModelRegistry
- Loaded at inference time by ai-engine/app/hazards/environmental_hazard.py
"""

from __future__ import annotations

import argparse
import math

import numpy as np
import pandas as pd
from loguru import logger

from .base_hazard_pipeline import BaseHazardPipeline
from .data_fetch_open_meteo import fetch_grid_sample

class EnvironmentalHazardPipeline(BaseHazardPipeline):
    HAZARD_NAME = "environmental_hazard"
    MODEL_TYPE_LABEL = "weakly_supervised"
    FEATURES = [
        "aqi_proxy",
        "wind_speed",
        "temperature",
        "temperature_inversion_risk",
        "humidity",
        "dispersion_factor",
        "season_sin",
        "season_cos",
    ]
    DATA_SOURCES = ["open-meteo", "openaq (optional)"]
    LABEL_STRATEGY = (
        "AQI-proxy classification: hazard=1 when aqi_proxy > 100 "
        "(moderate-to-unhealthy threshold on US EPA scale). "
        "AQI proxy is derived from meteorological dispersion conditions "
        "when real AQI data (OpenAQ) is not available. "
        "WEAKLY SUPERVISED — proxy AQI, not measured."
    )
    KNOWN_LIMITATIONS = (
        "Without real AQI measurements, the proxy is based solely on "
        "meteorological conditions favourable to pollution trapping "
        "(low wind, temperature inversions, high humidity). "
        "Actual emission sources (industrial, traffic) are not modelled. "
        "Results are indicative, not measured."
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
                "surface_pressure",
                "cloud_cover",
            ],
            seed=self.RANDOM_SEED,
        )

    def engineer_features(self, raw: pd.DataFrame) -> pd.DataFrame:
        df = raw.copy()
        df.rename(columns={
            "temperature_2m": "temperature",
            "relative_humidity_2m": "humidity",
            "wind_speed_10m": "wind_speed",
            "surface_pressure": "pressure",
        }, inplace=True)

        # Temperature inversion risk: surface warming while upper layers cool
        # Proxy: when temperature drops sharply (3h gradient negative) AND low wind
        temp_gradient = df.groupby("location_id")["temperature"].diff(3).fillna(0)
        df["temperature_inversion_risk"] = np.clip(
            (-temp_gradient / 5) * (1 - df["wind_speed"] / 15), 0, 1
        )

        # Atmospheric dispersion factor (low = bad for air quality)
        # Low wind + high humidity + inversion = poor dispersion
        wind_disp = np.clip(df["wind_speed"] / 10, 0, 1)
        hum_trap = np.clip(df["humidity"] / 100, 0, 1)
        df["dispersion_factor"] = np.clip(
            1 - (0.5 * (1 - wind_disp) + 0.3 * hum_trap + 0.2 * df["temperature_inversion_risk"]),
            0, 1
        )

        # AQI proxy: poor dispersion → high proxy AQI
        # Scale 0-300 (EPA ranges: 0-50 good, 51-100 moderate, 101-150 USG, 151-200 unhealthy)
        df["aqi_proxy"] = np.clip(
            300 * (1 - df["dispersion_factor"]) ** 1.5,
            0, 300
        )

        # Season
        month = df.index.month if hasattr(df.index, "month") else pd.to_datetime(df.index).month
        df["season_sin"] = np.sin(2 * math.pi * month / 12)
        df["season_cos"] = np.cos(2 * math.pi * month / 12)

        return df

    def generate_labels(self, df: pd.DataFrame) -> pd.Series:
        """AQI-proxy > 100 (Unhealthy for Sensitive Groups) → hazard=1."""
        labels = (df["aqi_proxy"] > 100).astype(int)
        logger.info(f"Label distribution: {labels.value_counts().to_dict()}")
        return labels

def main():
    parser = argparse.ArgumentParser(description="Train environmental-hazard model")
    parser.add_argument("--region", default="global")
    args = parser.parse_args()

    pipeline = EnvironmentalHazardPipeline(region_id=args.region)
    result = pipeline.run()
    logger.success(f"Done: {result}")

if __name__ == "__main__":
    main()
