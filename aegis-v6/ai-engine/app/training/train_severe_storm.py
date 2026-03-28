"""
train_severe_storm.py — Severe Storm Training Pipeline

Features: wind_speed, pressure_change_rate, temperature_gradient, humidity, season
Data:     Open-Meteo historical (global, free)
Labels:   Proxy thresholds (wind > 20 m/s OR pressure drop > 5 hPa/3h) → weakly_supervised
Model:    XGBoost classifier

Usage:
    python -m app.training.train_severe_storm --region=global
    python -m app.training.train_severe_storm --region=uk
    python -m app.training.train_severe_storm --region=nigeria
"""

from __future__ import annotations

import argparse
import math

import numpy as np
import pandas as pd
from loguru import logger

from .base_hazard_pipeline import BaseHazardPipeline
from .data_fetch_open_meteo import fetch_grid_sample

class SevereStormPipeline(BaseHazardPipeline):
    HAZARD_NAME = "severe_storm"
    MODEL_TYPE_LABEL = "weakly_supervised"
    FEATURES = [
        "wind_speed",
        "pressure_change_rate",
        "temperature_gradient",
        "humidity",
        "season_sin",
        "season_cos",
    ]
    DATA_SOURCES = ["open-meteo"]
    LABEL_STRATEGY = (
        "Proxy labels from weather thresholds: storm=1 when "
        "wind_speed > 20 m/s OR 3-hour pressure drop > 5 hPa. "
        "No verified storm observations used — WEAKLY SUPERVISED."
    )
    KNOWN_LIMITATIONS = (
        "Labels are derived from the same features used for prediction, "
        "which inflates apparent accuracy.  Model cannot detect storms "
        "driven by factors not captured in Open-Meteo surface variables."
    )

    # Pipeline hooks

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
                "pressure_msl",
                "surface_pressure",
            ],
            seed=self.RANDOM_SEED,
        )

    def engineer_features(self, raw: pd.DataFrame) -> pd.DataFrame:
        df = raw.copy()

        df.rename(columns={
            "wind_speed_10m": "wind_speed",
            "relative_humidity_2m": "humidity",
            "temperature_2m": "temperature",
            "pressure_msl": "pressure",
        }, inplace=True)

        # 3-hour pressure change rate (hPa / 3h)
        df["pressure_change_rate"] = df.groupby("location_id")["pressure"].diff(3).fillna(0)

        # 3-hour temperature gradient
        df["temperature_gradient"] = df.groupby("location_id")["temperature"].diff(3).fillna(0)

        # Seasonal encoding (month-of-year → sin/cos)
        month = df.index.month if hasattr(df.index, "month") else pd.to_datetime(df.index).month
        df["season_sin"] = np.sin(2 * math.pi * month / 12)
        df["season_cos"] = np.cos(2 * math.pi * month / 12)

        return df

    def generate_labels(self, df: pd.DataFrame) -> pd.Series:
        """
        Label=1 (storm) when:
          - wind_speed > 20 m/s   OR
          - pressure_change_rate < -5 hPa/3h  (rapid drop)
        """
        wind_thresh = df["wind_speed"] > 20.0
        pressure_thresh = df["pressure_change_rate"] < -5.0
        labels = (wind_thresh | pressure_thresh).astype(int)
        logger.info(f"Label distribution: {labels.value_counts().to_dict()}")
        return labels

# CLI entry-point

def main():
    parser = argparse.ArgumentParser(description="Train severe-storm hazard model")
    parser.add_argument("--region", default="global", help="Region id (global, uk, nigeria, ...)")
    args = parser.parse_args()

    pipeline = SevereStormPipeline(region_id=args.region)
    result = pipeline.run()
    logger.success(f"Done: {result}")

if __name__ == "__main__":
    main()
