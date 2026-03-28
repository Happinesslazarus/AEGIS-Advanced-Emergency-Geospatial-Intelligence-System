"""
AEGIS AI Engine — Public Safety Incident Real-Data Training (Multi-Location)

Train public safety incident risk model using REAL data from 13 UK locations:
  - Open-Meteo historical weather (temperature, wind, precipitation, snow,
    visibility) via ERA5 reanalysis
  - SEPA/EA river level gauge readings (Scotland)

Previous version used a single Central Scotland point.  This version
fetches from 13 UK grid locations for more weather diversity — ice events
in N England, fog in river valleys, wind storms across all regions, and
heavy snowfall in upland areas.

Task type: RISK_SCORING
  Features use concurrent observations (lead_hours=0).
  Model scores conditions likely to create public safety hazards.

Label provenance: operational_threshold
  Positive = operational public safety thresholds (any one sufficient):
    - Ice risk (temp < 0°C AND precipitation > 0 AND wind < 5 m/s), OR
    - Fog/low visibility (visibility < 200m for 2+ consecutive hours), OR
    - Flood risk (river level > 90th percentile), OR
    - Severe wind (gusts > 70 km/h), OR
    - Heavy snowfall (> 2cm accumulation in 6h)
  Negative = conditions outside all thresholds

Usage:
    python -m app.training.train_public_safety_incident_real --region uk-default --start-date 2015-01-01 --end-date 2025-12-31
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

class PublicSafetyIncidentRealPipeline(BaseRealPipeline):

    HAZARD_CONFIG = HazardConfig(
        hazard_type="public_safety_incident",
        task_type="risk_scoring",
        lead_hours=0,
        label_provenance={
            "category": "operational_threshold",
            "source": (
                "Public safety weather thresholds (Transport Scotland, Police "
                "Scotland, Met Office) applied to Open-Meteo ERA5 reanalysis "
                "across 13 UK locations"
            ),
            "description": (
                "Labels derived from operational public safety thresholds "
                "across 13 UK grid points. "
                "Positive = ice risk (temp < 0°C AND precipitation > 0 AND "
                "wind < 5 m/s — still air allows ice formation), OR "
                "fog/low visibility (visibility < 200m for 2+ hours), OR "
                "flood risk (river level > 90th percentile), OR "
                "severe wind (gusts > 70 km/h), OR "
                "heavy snowfall (> 2cm in 6h). "
                "Negative = conditions outside all thresholds."
            ),
            "limitations": (
                "Threshold-based risk indicators, not actual reported incidents. "
                "Real public safety events depend on population density, road "
                "usage, and local infrastructure. Visibility data is ERA5 "
                "reanalysis and may not match surface-level conditions. "
                "Snow accumulation from ERA5 may differ from ground observations."
            ),
            "peer_reviewed_basis": (
                "Transport Scotland winter operations, Police Scotland severe "
                "weather protocols, Met Office NSWWS criteria"
            ),
        },
        min_total_samples=500,
        min_positive_samples=20,
        min_stations=5,
        promotion_min_roc_auc=0.70,
    )

    async def fetch_raw_data(self) -> dict[str, pd.DataFrame]:
        """Fetch weather from 13 UK locations + SEPA river levels."""
        weather = await fetch_multi_location_weather(
            locations=UK_GRID_LOCATIONS,
            start_date=self.start_date,
            end_date=self.end_date,
            hourly_vars=EXTENDED_HOURLY_VARS,
        )

        # Scottish river gauges
        river = pd.DataFrame()
        stations_df = pd.DataFrame()
        try:
            stations_df = await self.provider.get_station_metadata()
            station_ids = stations_df["station_id"].tolist()[:50]
            river = await self.provider.get_river_levels(
                station_ids=station_ids,
                start_date=self.start_date, end_date=self.end_date,
            )
        except Exception as exc:
            logger.warning(
                f"SEPA river data unavailable: {exc} — "
                f"using weather-only labels"
            )

        return {
            "weather": weather,
            "river": river,
            "stations": stations_df,
        }

    def build_labels(self, raw_data: dict[str, pd.DataFrame]) -> pd.DataFrame:
        """Build public safety incident labels from operational thresholds."""
        weather = raw_data.get("weather", pd.DataFrame())
        river = raw_data.get("river", pd.DataFrame())

        if weather.empty:
            raise RuntimeError(
                "No weather data — cannot build public safety labels"
            )

        weather = weather.copy()
        weather["timestamp"] = pd.to_datetime(weather["timestamp"])
        weather["timestamp"] = weather["timestamp"].dt.floor("h")

        all_labels: list[pd.DataFrame] = []

        for station_id, grp in weather.groupby("station_id"):
            grp = grp.sort_values("timestamp").copy()

            # Resolve column names
            temp_col = _find_col(grp, "temperature_2m", "temperature")
            wind_col = _find_col(grp, "wind_speed_10m", "windspeed_10m")
            gust_col = _find_col(grp, "wind_gusts_10m", "windgusts_10m_max")
            precip_col = _find_col(grp, "precipitation", "precipitation_sum")
            vis_col = _find_col(grp, "visibility", "visibility_m")

            # Condition 1: Ice risk
            ice_label = pd.Series(False, index=grp.index)
            if temp_col and precip_col and wind_col:
                ice_label = (
                    (grp[temp_col] < 0.0)
                    & (grp[precip_col] > 0.0)
                    & (grp[wind_col] < 5.0)
                )

            # Condition 2: Fog (visibility < 200m, 2+ hours)
            fog_label = pd.Series(False, index=grp.index)
            if vis_col:
                low_vis = (grp[vis_col] < 200.0).astype(int)
                fog_streak = low_vis.rolling(2, min_periods=2).sum()
                fog_label = fog_streak >= 2

            # Condition 3: Severe wind (gusts > 70 km/h)
            wind_label = pd.Series(False, index=grp.index)
            if gust_col:
                wind_label = grp[gust_col] > 70.0

            # Condition 4: Heavy snowfall (> 2cm in 6h)
            snow_label = pd.Series(False, index=grp.index)
            if "snowfall" in grp.columns and grp["snowfall"].notna().sum() > 100:
                snow_6h = grp["snowfall"].rolling(6, min_periods=1).sum()
                snow_label = snow_6h > 2.0

            # Combine all conditions
            combined_label = (
                ice_label | fog_label | wind_label | snow_label
            ).astype(int)

            station_labels = grp[["timestamp"]].copy()
            station_labels["station_id"] = station_id
            station_labels["label"] = combined_label.values
            all_labels.append(
                station_labels[["timestamp", "station_id", "label"]]
            )

        # Flood risk from river gauges (Scotland only)
        if not river.empty:
            river_c = river.copy()
            river_c["timestamp"] = pd.to_datetime(
                river_c["timestamp"]
            ).dt.floor("h")
            station_p90 = river_c.groupby("station_id")["level_m"].quantile(0.90)
            river_c = river_c.merge(station_p90.rename("p90"), on="station_id")
            river_c["above_p90"] = river_c["level_m"] > river_c["p90"]

            flood_labels = river_c.loc[river_c["above_p90"]].copy()
            if not flood_labels.empty:
                flood_labels["label"] = 1
                flood_labels = flood_labels[["timestamp", "station_id", "label"]]
                all_labels.append(flood_labels)

        if not all_labels:
            raise RuntimeError("No label data produced")

        labels = pd.concat(all_labels, ignore_index=True)
        labels = (
            labels.groupby(["timestamp", "station_id"])["label"]
            .max()
            .reset_index()
        )
        n_pos = int(labels["label"].sum())
        n_neg = len(labels) - n_pos
        logger.info(
            f"  Public safety labels: {n_pos:,} positive, {n_neg:,} negative "
            f"across {labels['station_id'].nunique()} stations"
        )
        return labels

    def build_features(self, raw_data: dict[str, pd.DataFrame]) -> pd.DataFrame:
        """Build features per station with snow and visibility variables."""
        weather = raw_data.get("weather", pd.DataFrame())
        river = raw_data.get("river", pd.DataFrame())

        if weather.empty:
            raise RuntimeError("No weather data — cannot build features")

        features = build_per_station_features(
            weather,
            self.feature_engineer,
            extra_passthrough_cols=[
                "snowfall", "snow_depth",
                "dewpoint_2m",
            ],
        )

        # Add river features if available
        if not river.empty:
            try:
                rv = self.feature_engineer.compute_river_features(river)
                features = features.join(rv, how="left", rsuffix="_rv")
                dup_cols = [c for c in features.columns if c.endswith("_rv")]
                features.drop(columns=dup_cols, inplace=True)
            except Exception as exc:
                logger.warning(f"River feature computation failed: {exc}")

        features = features.ffill().fillna(0.0)
        return features

    def hazard_feature_columns(self) -> list[str]:
        """Feature columns for public safety incident risk scoring."""
        return [
            # Temperature / ice features
            "temperature_2m", "wind_chill_index",
            "consecutive_frost_days", "freeze_thaw_cycles_48h",
            # Wind
            "wind_speed_10m", "wind_gusts_10m",
            # Precipitation / snow
            "rainfall_1h", "rainfall_3h",
            "snowfall", "snow_depth",
            # Visibility / fog
            "visibility", "dewpoint_2m",
            # Humidity (fog correlation)
            "relative_humidity_2m",
            # River features (flood risk)
            "level_current", "level_percentile", "level_anomaly",
            # Pressure (storm indicator)
            "pressure_msl", "pressure_change_3h",
            # Temporal
            "season_sin", "season_cos", "hour_sin", "hour_cos", "month",
        ]

def _find_col(df: pd.DataFrame, *candidates: str) -> str | None:
    """Return the first column name that exists in df."""
    for col in candidates:
        if col in df.columns:
            return col
    return None

def main():
    args = parse_training_args("public_safety_incident")
    result = run_pipeline(PublicSafetyIncidentRealPipeline, args)
    if result.get("status") == "success":
        logger.success(
            f"Public safety incident training complete: {result['version']}"
        )
    else:
        logger.error(
            f"Public safety incident training failed: "
            f"{result.get('error', 'unknown')}"
        )

if __name__ == "__main__":
    main()
