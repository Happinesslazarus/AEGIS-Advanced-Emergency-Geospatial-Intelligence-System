"""
AEGIS AI Engine — Landslide Real-Data Training

Train landslide risk scoring model using REAL data:
  - SEPA/EA rainfall gauge data (antecedent and event rainfall)
  - Open-Meteo historical weather observations (temperature for freeze-thaw)

Task type: RISK_SCORING
  No lead time — assesses current landslide susceptibility from recent rainfall
  and ground-condition proxies.
  Lead time: 0 hours.

Label provenance: engineering_standard
  Positive = BGS-published rainfall trigger thresholds for susceptible slopes:
             rainfall_24h > 50 mm OR rainfall_72h > 100 mm
             (applied near slopes > 15° where slope data is available).
  Negative = neither threshold met in the observation window.

IMPORTANT — label honesty:
  These labels are threshold-based susceptibility triggers derived from
  BGS-published engineering guidelines, NOT confirmed landslide incident
  records.  Many triggered thresholds will not result in actual landslides,
  and some landslides occur below these thresholds on particularly
  susceptible geology.

Usage:
    python -m app.training.train_landslide_real --region uk-default --start-date 2015-01-01 --end-date 2025-12-31
"""

from __future__ import annotations

import pandas as pd
import numpy as np
from loguru import logger

from app.training.base_real_pipeline import (
    BaseRealPipeline, HazardConfig, parse_training_args, run_pipeline,
)

class LandslideRealPipeline(BaseRealPipeline):

    HAZARD_CONFIG = HazardConfig(
        hazard_type="landslide",
        task_type="risk_scoring",
        lead_hours=0,
        label_provenance={
            "category": "engineering_standard",
            "source": "BGS-published rainfall trigger thresholds for susceptible slopes (24h > 50mm OR 72h > 100mm)",
            "description": (
                "Labels derived from British Geological Survey published "
                "rainfall trigger thresholds applied to observed rainfall data. "
                "Positive = 24-hour rainfall > 50 mm OR 72-hour rainfall > 100 mm "
                "at the station. Negative = neither threshold met."
            ),
            "limitations": (
                "Threshold-based susceptibility triggers, not confirmed "
                "landslide incident records. Many threshold exceedances will "
                "not result in actual landslides. Slope angle and geology are "
                "not incorporated at the station level — all stations are "
                "treated as potentially susceptible."
            ),
            "peer_reviewed_basis": "BGS GeoReport OR/22/032 — Rainfall thresholds for landslide triggering in the UK",
        },
        min_total_samples=500,
        min_positive_samples=15,
        min_stations=3,
        promotion_min_roc_auc=0.70,
    )

    async def fetch_raw_data(self) -> dict[str, pd.DataFrame]:
        """Fetch landslide-relevant raw data from provider."""
        stations_df = await self.provider.get_station_metadata()
        station_ids = stations_df["station_id"].tolist()[:50]

        rainfall = await self.provider.get_rainfall(
            station_ids=station_ids,
            start_date=self.start_date, end_date=self.end_date,
        )
        weather = await self.provider.get_historical_weather(
            lat=56.0, lon=-3.5,  # Central Scotland
            start_date=self.start_date, end_date=self.end_date,
        )

        return {
            "weather": weather,
            "rainfall": rainfall,
            "stations": stations_df,
        }

    def build_labels(self, raw_data: dict[str, pd.DataFrame]) -> pd.DataFrame:
        """Build landslide risk labels from BGS rainfall trigger thresholds.

        Criteria:
          - 24-hour cumulative rainfall > 50 mm, OR
          - 72-hour cumulative rainfall > 100 mm.
        """
        rainfall = raw_data.get("rainfall", pd.DataFrame())
        if rainfall.empty:
            raise RuntimeError("No rainfall data — cannot build landslide labels")

        rainfall = rainfall.copy()
        rainfall["timestamp"] = pd.to_datetime(rainfall["timestamp"])
        rainfall["timestamp"] = rainfall["timestamp"].dt.floor("h")

        # Resolve rainfall value column
        rain_col = next(
            (c for c in ["value", "rainfall_mm", "rainfall", "precipitation"]
             if c in rainfall.columns),
            None,
        )
        if rain_col is None:
            raise RuntimeError(f"No rainfall value column found. Columns: {list(rainfall.columns)}")

        rainfall = rainfall.sort_values(["station_id", "timestamp"])

        labels_list = []
        for station_id, grp in rainfall.groupby("station_id"):
            grp = grp.set_index("timestamp").sort_index()
            rain_vals = grp[rain_col]

            # Rolling sums
            rain_24h = rain_vals.rolling("24h", min_periods=1).sum()
            rain_72h = rain_vals.rolling("72h", min_periods=1).sum()

            label = ((rain_24h > 50.0) | (rain_72h > 100.0)).astype(int)

            station_labels = pd.DataFrame({
                "timestamp": grp.index,
                "station_id": station_id,
                "label": label.values,
            })
            labels_list.append(station_labels)

        if not labels_list:
            raise RuntimeError("No stations produced labels")

        labels = pd.concat(labels_list, ignore_index=True)
        labels = labels.drop_duplicates(subset=["timestamp", "station_id"])

        n_pos = labels["label"].sum()
        n_neg = len(labels) - n_pos
        logger.info(f"  Landslide risk labels: {n_pos} positive, {n_neg} negative")
        return labels

    def hazard_feature_columns(self) -> list[str]:
        """Feature columns for landslide risk scoring."""
        return [
            # Rainfall accumulation (multiple windows)
            "rainfall_1h", "rainfall_3h", "rainfall_6h", "rainfall_12h",
            "rainfall_24h", "rainfall_48h", "rainfall_72h", "rainfall_7d",
            # Antecedent rainfall (soil saturation proxy)
            "antecedent_rainfall_7d", "antecedent_rainfall_14d", "antecedent_rainfall_30d",
            "days_since_significant_rain",
            "rainfall_intensity_max_1h",
            # Weather features (freeze-thaw proxy)
            "temperature_2m", "pressure_msl", "wind_speed_10m",
            # Temporal
            "season_sin", "season_cos", "hour_sin", "hour_cos", "month",
        ]

def main():
    args = parse_training_args("landslide")
    result = run_pipeline(LandslideRealPipeline, args)
    if result.get("status") == "success":
        logger.success(f"Landslide training complete: {result['version']}")
    else:
        logger.error(f"Landslide training failed: {result.get('error', 'unknown')}")

if __name__ == "__main__":
    main()
