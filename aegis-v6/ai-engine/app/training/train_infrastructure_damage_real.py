"""
AEGIS AI Engine — Infrastructure Damage Real-Data Training (Multi-Location)

Train infrastructure damage risk model using REAL data from 13 UK locations:
  - Open-Meteo historical weather (wind, rain, temp, snow, soil moisture)
  - SEPA/EA river level gauge readings (Scotland)
  - SEPA/EA rainfall gauge data

Previous version used a single Central Scotland point.  This version
fetches from 13 UK grid locations for ~13× more data and greater
weather diversity (storms, snow, freeze-thaw events).

Task type: RISK_SCORING
  Features use concurrent observations (lead_hours=0).
  Model scores conditions likely to cause infrastructure damage.

Label provenance: engineering_standard
  Positive = engineering-standard damage conditions (any one sufficient):
    - Flood inundation risk (river level > 95th percentile), OR
    - Wind loading (gusts > 80 km/h), OR
    - Ground movement (freeze-thaw cycles > 3 in 48h AND wet soil), OR
    - Extreme rainfall (24h > 60mm), OR
    - Heavy snowfall (> 5cm accumulation in 24h)
  Negative = conditions outside all thresholds

Usage:
    python -m app.training.train_infrastructure_damage_real --region uk-default --start-date 2015-01-01 --end-date 2025-12-31
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

class InfrastructureDamageRealPipeline(BaseRealPipeline):

    HAZARD_CONFIG = HazardConfig(
        hazard_type="infrastructure_damage",
        task_type="risk_scoring",
        lead_hours=0,
        label_provenance={
            "category": "engineering_standard",
            "source": (
                "Transport/infrastructure resilience guidance standards applied "
                "to Open-Meteo ERA5 reanalysis and SEPA gauge data across "
                "13 UK locations"
            ),
            "description": (
                "Labels derived from documented infrastructure failure conditions "
                "across 13 UK grid points. "
                "Positive = flood inundation risk (river level > 95th percentile), OR "
                "wind loading (gusts > 80 km/h), OR "
                "ground movement risk (freeze-thaw cycles > 3 in 48h AND "
                "soil moisture proxy > 80th percentile), OR "
                "extreme rainfall (24h accumulation > 60mm), OR "
                "heavy snowfall (24h accumulation > 5cm). "
                "Negative = conditions outside all thresholds."
            ),
            "limitations": (
                "Not actual incident-confirmed damage records. Derived from "
                "documented infrastructure failure conditions. Real damage depends "
                "on asset age, material, maintenance state, and local ground "
                "conditions which are not captured. Soil moisture is ERA5-Land "
                "modelled. Snow data is ERA5 reanalysis."
            ),
            "peer_reviewed_basis": (
                "Transport Scotland resilience guidance, Highways England design "
                "standards, CIRIA infrastructure flooding guidance"
            ),
        },
        min_total_samples=500,
        min_positive_samples=20,
        min_stations=5,
        promotion_min_roc_auc=0.70,
    )

    async def fetch_raw_data(self) -> dict[str, pd.DataFrame]:
        """Fetch weather from 13 UK locations + SEPA river/rainfall."""
        weather = await fetch_multi_location_weather(
            locations=UK_GRID_LOCATIONS,
            start_date=self.start_date,
            end_date=self.end_date,
            hourly_vars=EXTENDED_HOURLY_VARS,
        )

        # Scottish river gauges and rainfall
        river = pd.DataFrame()
        rainfall = pd.DataFrame()
        stations_df = pd.DataFrame()
        try:
            stations_df = await self.provider.get_station_metadata()
            station_ids = stations_df["station_id"].tolist()[:50]
            river = await self.provider.get_river_levels(
                station_ids=station_ids,
                start_date=self.start_date, end_date=self.end_date,
            )
            rainfall = await self.provider.get_rainfall(
                station_ids=station_ids,
                start_date=self.start_date, end_date=self.end_date,
            )
        except Exception as exc:
            logger.warning(
                f"SEPA river/rainfall unavailable: {exc} — "
                f"using weather-only labels"
            )

        return {
            "weather": weather,
            "river": river,
            "rainfall": rainfall,
            "stations": stations_df,
        }

    def build_labels(self, raw_data: dict[str, pd.DataFrame]) -> pd.DataFrame:
        """Build infrastructure damage labels from engineering thresholds."""
        weather = raw_data.get("weather", pd.DataFrame())
        river = raw_data.get("river", pd.DataFrame())
        rainfall = raw_data.get("rainfall", pd.DataFrame())

        if weather.empty:
            raise RuntimeError(
                "No weather data — cannot build infrastructure damage labels"
            )

        weather = weather.copy()
        weather["timestamp"] = pd.to_datetime(weather["timestamp"])
        weather["timestamp"] = weather["timestamp"].dt.floor("h")

        all_labels: list[pd.DataFrame] = []

        for station_id, grp in weather.groupby("station_id"):
            grp = grp.sort_values("timestamp").copy()

            # Condition 1: Wind loading (gusts > 80 km/h)
            gust_col = None
            for col in ("wind_gusts_10m", "windgusts_10m_max", "wind_gusts"):
                if col in grp.columns:
                    gust_col = col
                    break
            wind_label = pd.Series(False, index=grp.index)
            if gust_col:
                wind_label = grp[gust_col] > 80.0

            # Condition 2: Ground movement (freeze-thaw + wet soil)
            temp_col = None
            for col in ("temperature_2m", "temperature_2m_mean", "temperature"):
                if col in grp.columns:
                    temp_col = col
                    break

            ground_movement_label = pd.Series(False, index=grp.index)
            if temp_col:
                temp_series = grp[temp_col]
                above_zero = (temp_series > 0).astype(int)
                transitions = above_zero.diff().abs()
                ft_cycles_48h = transitions.rolling(48, min_periods=1).sum()

                # Soil moisture from ERA5-Land (preferred) or rainfall proxy
                soil_wet = pd.Series(False, index=grp.index)
                sm_col = None
                for col in ("soil_moisture_0_to_7cm", "soil_moisture_7_to_28cm"):
                    if col in grp.columns and grp[col].notna().sum() > 100:
                        sm_col = col
                        break
                if sm_col:
                    p80 = grp[sm_col].quantile(0.80)
                    soil_wet = grp[sm_col] > p80
                elif not rainfall.empty and "value" in rainfall.columns:
                    # Fallback: antecedent rainfall proxy
                    rainfall_c = rainfall.copy()
                    rainfall_c["timestamp"] = pd.to_datetime(
                        rainfall_c["timestamp"]
                    ).dt.floor("h")
                    rain_hourly = (
                        rainfall_c.groupby("timestamp")["value"]
                        .sum()
                        .reset_index()
                        .sort_values("timestamp")
                        .set_index("timestamp")
                    )
                    rain_14d = rain_hourly["value"].rolling(
                        "336h", min_periods=1
                    ).sum()
                    p80_rain = rain_14d.quantile(0.80)
                    wet_times = set(
                        rain_14d[rain_14d > p80_rain]
                        .index.strftime("%Y-%m-%d %H")
                    )
                    grp_times_str = grp["timestamp"].dt.strftime("%Y-%m-%d %H")
                    soil_wet = grp_times_str.isin(wet_times)

                ground_movement_label = (ft_cycles_48h > 3) & soil_wet

            # Condition 3: Extreme rainfall (24h > 60mm)
            extreme_rain_label = pd.Series(False, index=grp.index)
            if "precipitation" in grp.columns:
                precip_24h = (
                    grp["precipitation"].rolling(24, min_periods=1).sum()
                )
                extreme_rain_label = precip_24h > 60.0

            # Condition 4: Heavy snowfall (24h > 5cm)
            snow_label = pd.Series(False, index=grp.index)
            if "snowfall" in grp.columns and grp["snowfall"].notna().sum() > 100:
                snow_24h = grp["snowfall"].rolling(24, min_periods=1).sum()
                snow_label = snow_24h > 5.0

            # Combine all conditions
            combined_label = (
                wind_label | ground_movement_label
                | extreme_rain_label | snow_label
            ).astype(int)

            station_labels = grp[["timestamp"]].copy()
            station_labels["station_id"] = station_id
            station_labels["label"] = combined_label.values
            all_labels.append(
                station_labels[["timestamp", "station_id", "label"]]
            )

        # Flood inundation from river gauges (Scotland only)
        flood_inundation_times: set[str] = set()
        if not river.empty:
            river_c = river.copy()
            river_c["timestamp"] = pd.to_datetime(
                river_c["timestamp"]
            ).dt.floor("h")
            station_p95 = river_c.groupby("station_id")["level_m"].quantile(0.95)
            river_c = river_c.merge(station_p95.rename("p95"), on="station_id")
            river_c["above_p95"] = river_c["level_m"] > river_c["p95"]

            flood_labels = river_c.loc[river_c["above_p95"]].copy()
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
            f"  Infrastructure damage labels: {n_pos:,} positive, "
            f"{n_neg:,} negative across {labels['station_id'].nunique()} stations"
        )
        return labels

    def build_features(self, raw_data: dict[str, pd.DataFrame]) -> pd.DataFrame:
        """Build features per station with snow and soil moisture variables."""
        weather = raw_data.get("weather", pd.DataFrame())
        river = raw_data.get("river", pd.DataFrame())

        if weather.empty:
            raise RuntimeError("No weather data — cannot build features")

        features = build_per_station_features(
            weather,
            self.feature_engineer,
            extra_passthrough_cols=[
                "snowfall", "snow_depth",
                "soil_moisture_0_to_7cm",
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
        """Feature columns for infrastructure damage risk scoring."""
        return [
            # Wind features
            "wind_gusts_10m", "wind_speed_10m",
            # Pressure (storm indicator)
            "pressure_msl", "pressure_change_3h", "pressure_change_6h",
            # Temperature / ground movement
            "temperature_2m", "freeze_thaw_cycles_48h",
            # Rainfall features
            "rainfall_24h", "rainfall_48h", "rainfall_72h",
            "antecedent_rainfall_14d",
            # Snow features (new)
            "snowfall", "snow_depth",
            # River features (flood inundation)
            "level_current", "level_max_24h", "level_percentile",
            "level_anomaly",
            # Soil moisture (new — ERA5-Land)
            "soil_moisture_0_to_7cm",
            "antecedent_rainfall_30d",
            # Temporal
            "season_sin", "season_cos", "hour_sin", "hour_cos", "month",
        ]

def main():
    args = parse_training_args("infrastructure_damage")
    result = run_pipeline(InfrastructureDamageRealPipeline, args)
    if result.get("status") == "success":
        logger.success(
            f"Infrastructure damage training complete: {result['version']}"
        )
    else:
        logger.error(
            f"Infrastructure damage training failed: "
            f"{result.get('error', 'unknown')}"
        )

if __name__ == "__main__":
    main()
