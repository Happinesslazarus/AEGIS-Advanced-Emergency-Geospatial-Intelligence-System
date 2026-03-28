"""
AEGIS AI Engine — Heatwave Real-Data Training (Multi-Location)

Train heatwave prediction model using REAL data from 13 UK grid locations:
  - Open-Meteo historical weather (temperature, humidity, dewpoint,
    apparent temperature) via ERA5 reanalysis

Previous version used a single Central Scotland point where Tmax rarely
exceeds 25°C.  This version fetches from 13 locations including SE England
(regularly 30°C+ in summer) with region-specific Met Office thresholds.

Task type: FORECAST
  Features use pre-event observations to predict heatwave onset.
  Lead time: 24 hours.

Label provenance: operational_threshold
  Positive = UK Met Office regional heatwave definition:
             Region-specific Tmax threshold (25–28°C by county) AND
             Tmin > 15°C for 3 or more consecutive days.
  Negative = criteria not met at that location.

  Regional Tmax thresholds (approximated from Met Office county-level):
    Scotland:       25°C
    N England:      25–26°C
    Midlands/Wales: 26–27°C
    SE/S England:   27–28°C

IMPORTANT — label honesty:
  Thresholds applied to ERA5 reanalysis temperatures, not station obs.
  ERA5 may smooth urban heat island effects.  Not official Met Office
  heatwave declarations.

Usage:
    python -m app.training.train_heatwave_real --region uk-default --start-date 2015-01-01 --end-date 2025-12-31
"""

from __future__ import annotations

import pandas as pd
import numpy as np
from loguru import logger

from app.training.base_real_pipeline import (
    BaseRealPipeline, HazardConfig, parse_training_args, run_pipeline,
)
from app.training.multi_location_weather import (
    fetch_multi_location_weather, build_per_station_features,
    UK_GRID_LOCATIONS, EXTENDED_HOURLY_VARS,
)

# Universal Tmin threshold for UK Met Office heatwave definition
_HEATWAVE_TMIN = 15.0

class HeatwaveRealPipeline(BaseRealPipeline):

    HAZARD_CONFIG = HazardConfig(
        hazard_type="heatwave",
        task_type="forecast",
        lead_hours=24,
        label_provenance={
            "category": "operational_threshold",
            "source": (
                "UK Met Office regional heatwave thresholds applied to "
                "Open-Meteo ERA5 reanalysis temperatures across 13 UK locations"
            ),
            "description": (
                "Labels derived by applying UK Met Office operational heatwave "
                "definitions to ERA5 temperature data at 13 UK grid points. "
                "Region-specific Tmax thresholds (Scotland 25°C to SE England "
                "28°C) with universal Tmin > 15°C for 3+ consecutive days. "
                "SE England provides most positive examples; Scotland fewest."
            ),
            "limitations": (
                "Applied Met Office definition to ERA5 reanalysis, not "
                "station-observed temperatures. ERA5 may smooth urban heat "
                "island effects. Only 13 grid points — not spatially "
                "continuous. Night-time temperatures in rural areas may "
                "differ from urban stations used by Met Office."
            ),
            "peer_reviewed_basis": (
                "UK Met Office National Severe Weather Warning Service "
                "heatwave criteria (county-level temperature thresholds)"
            ),
        },
        min_total_samples=500,
        min_positive_samples=10,  # Heatwaves are rare even with multi-location
        min_stations=1,
        promotion_min_roc_auc=0.70,
    )

    async def fetch_raw_data(self) -> dict[str, pd.DataFrame]:
        """Fetch weather from 13 UK grid locations."""
        weather = await fetch_multi_location_weather(
            locations=UK_GRID_LOCATIONS,
            start_date=self.start_date,
            end_date=self.end_date,
            hourly_vars=EXTENDED_HOURLY_VARS,
        )
        return {"weather": weather}

    def build_labels(self, raw_data: dict[str, pd.DataFrame]) -> pd.DataFrame:
        """Build heatwave labels using regional Met Office thresholds.

        Each location has its own Tmax threshold from UK_GRID_LOCATIONS.
        Tmin is universal at 15°C.  3+ consecutive days required.
        """
        weather = raw_data.get("weather", pd.DataFrame())
        if weather.empty:
            raise RuntimeError("No weather data — cannot build heatwave labels")

        weather = weather.copy()
        weather["timestamp"] = pd.to_datetime(weather["timestamp"])
        weather["date"] = weather["timestamp"].dt.date

        # Region-specific Tmax thresholds
        tmax_thresholds = {
            loc["id"]: loc.get("heatwave_tmax", 25.0)
            for loc in UK_GRID_LOCATIONS
        }

        temp_col = (
            "temperature_2m" if "temperature_2m" in weather.columns
            else "temperature"
        )

        all_labels: list[pd.DataFrame] = []

        for station_id, grp in weather.groupby("station_id"):
            grp = grp.sort_values("timestamp")
            tmax_threshold = tmax_thresholds.get(station_id, 25.0)

            # Daily Tmax and Tmin
            daily = (
                grp.groupby("date")
                .agg(tmax=(temp_col, "max"), tmin=(temp_col, "min"))
                .reset_index()
                .sort_values("date")
            )

            # Per-day threshold check
            daily["hot_day"] = (
                (daily["tmax"] > tmax_threshold) & (daily["tmin"] > _HEATWAVE_TMIN)
            ).astype(int)

            # Count consecutive hot days
            flags = daily["hot_day"].values
            consecutive = np.zeros(len(flags), dtype=int)
            running = 0
            for i, f in enumerate(flags):
                running = running + 1 if f == 1 else 0
                consecutive[i] = running

            # Mark heatwave: any day that is part of a 3+ day run
            daily["label"] = 0
            for i in range(len(daily)):
                if consecutive[i] >= 3:
                    for j in range(i - consecutive[i] + 1, i + 1):
                        if 0 <= j < len(daily):
                            daily.iloc[j, daily.columns.get_loc("label")] = 1

            # Map daily labels to hourly timestamps
            date_label_map = dict(zip(daily["date"], daily["label"]))
            hourly = grp[["timestamp"]].copy()
            hourly["timestamp"] = hourly["timestamp"].dt.floor("h")
            hourly = hourly.drop_duplicates()
            hourly["station_id"] = station_id
            hourly["date"] = hourly["timestamp"].dt.date
            hourly["label"] = (
                hourly["date"].map(date_label_map).fillna(0).astype(int)
            )
            all_labels.append(hourly[["timestamp", "station_id", "label"]])

        labels = pd.concat(all_labels, ignore_index=True)
        n_pos = int(labels["label"].sum())
        n_neg = len(labels) - n_pos
        logger.info(
            f"  Heatwave labels: {n_pos:,} positive, {n_neg:,} negative "
            f"across {labels['station_id'].nunique()} stations"
        )
        return labels

    def build_features(self, raw_data: dict[str, pd.DataFrame]) -> pd.DataFrame:
        """Build features per station with heat-related extended variables."""
        weather = raw_data.get("weather", pd.DataFrame())
        if weather.empty:
            raise RuntimeError("No weather data — cannot build features")

        return build_per_station_features(
            weather,
            self.feature_engineer,
            extra_passthrough_cols=[
                "apparent_temperature",
                "dewpoint_2m",
                "et0_fao_evapotranspiration",
            ],
        )

    def hazard_feature_columns(self) -> list[str]:
        """Feature columns for heatwave prediction."""
        return [
            # Temperature features
            "temperature_2m", "apparent_temperature", "dewpoint_2m",
            "heat_index", "temperature_anomaly",
            "consecutive_hot_days",
            # Humidity
            "relative_humidity_2m",
            # Wind / pressure
            "wind_speed_10m", "pressure_msl",
            "pressure_change_3h", "pressure_change_6h",
            # Evapotranspiration (radiation proxy)
            "et0_fao_evapotranspiration",
            # Temporal
            "season_sin", "season_cos", "hour_sin", "hour_cos", "month",
        ]

def main():
    args = parse_training_args("heatwave")
    result = run_pipeline(HeatwaveRealPipeline, args)
    if result.get("status") == "success":
        logger.success(f"Heatwave training complete: {result['version']}")
    else:
        logger.error(f"Heatwave training failed: {result.get('error', 'unknown')}")

if __name__ == "__main__":
    main()
