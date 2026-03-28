"""
AEGIS AI Engine — Drought Real-Data Training (Multi-Location)

Train drought prediction model using REAL data from 13 UK grid locations:
  - Open-Meteo historical weather (temperature, precipitation, soil moisture,
    evapotranspiration) via ERA5 reanalysis — all 13 UK grid points
  - SEPA river level gauge readings (Scotland only, for Q95 low-flow)
  - Derived SPI (Standardized Precipitation Index) from precipitation

Previous version used a single Central Scotland point where droughts are
exceptionally rare.  This version fetches from 13 locations including
SE England (the UK's driest region), providing ~13× more training data
and genuine drought signal.

Task type: FORECAST
  Features use pre-event observations to predict drought onset.
  Lead time: 24 hours.

Label provenance: composite_threshold
  Positive = at least one of:
    (a) SPI-90d < -1.0 (moderate meteorological drought per WMO definition), OR
    (b) Soil moisture below station's 10th percentile for 14+ consecutive days, OR
    (c) River flow below Q95 for 14+ consecutive days (Scotland gauges only)
  Negative = none of the above conditions met.

IMPORTANT — label honesty:
  SPI is computed from ERA5 reanalysis precipitation, not rain-gauge obs.
  Soil moisture is ERA5-Land modelled, not measured.
  River Q95 is physical SEPA gauge data (Scotland only).
  Labels represent meteorological/hydrological drought conditions, NOT
  official drought declarations.

Usage:
    python -m app.training.train_drought_real --region uk-default --start-date 2015-01-01 --end-date 2025-12-31
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

class DroughtRealPipeline(BaseRealPipeline):

    HAZARD_CONFIG = HazardConfig(
        hazard_type="drought",
        task_type="forecast",
        lead_hours=24,
        label_provenance={
            "category": "composite_threshold",
            "source": (
                "WMO SPI drought classification applied to Open-Meteo ERA5 "
                "precipitation reanalysis across 13 UK locations, plus "
                "ERA5-Land soil-moisture deficit, plus SEPA Q95 low-flow "
                "metrics for Scottish gauges"
            ),
            "description": (
                "Labels derived from three independent drought indicators across "
                "13 UK grid points (SE England through N Scotland). "
                "Positive = SPI-90d < -1.0 (WMO moderate meteorological drought), OR "
                "soil moisture below station 10th percentile for 14+ consecutive "
                "days, OR river flow below Q95 for 14+ consecutive days "
                "(Scotland gauges only). "
                "Negative = none of the above."
            ),
            "limitations": (
                "SPI is computed from ERA5 reanalysis precipitation, not rain "
                "gauges. Soil moisture is ERA5-Land modelled, not measured. "
                "River Q95 only available for SEPA-gauged Scottish stations. "
                "Agricultural and groundwater droughts may not be captured. "
                "13 point locations — not a continuous spatial field."
            ),
            "peer_reviewed_basis": (
                "WMO Guidelines on Meteorological and Hydrological Aspects of "
                "Siting and Operation of Stations (SPI classification), "
                "SEPA drought monitoring framework"
            ),
        },
        min_total_samples=500,
        min_positive_samples=20,
        min_stations=5,
        promotion_min_roc_auc=0.70,
    )

    async def fetch_raw_data(self) -> dict[str, pd.DataFrame]:
        """Fetch drought-relevant data from 13 UK locations + SEPA gauges."""
        # Multi-location weather (extended vars including soil moisture)
        weather = await fetch_multi_location_weather(
            locations=UK_GRID_LOCATIONS,
            start_date=self.start_date,
            end_date=self.end_date,
            hourly_vars=EXTENDED_HOURLY_VARS,
        )

        # Scottish river gauges (for Q95 low-flow component)
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
                f"SEPA river/rainfall data unavailable: {exc} — "
                f"using weather-only drought labels"
            )

        return {
            "weather": weather,
            "river": river,
            "rainfall": rainfall,
            "stations": stations_df,
        }

    def build_labels(self, raw_data: dict[str, pd.DataFrame]) -> pd.DataFrame:
        """Build drought labels from SPI + soil moisture + Q95 low-flow.

        Three independent indicators — any one triggers a positive label.
        """
        weather = raw_data.get("weather", pd.DataFrame())
        river = raw_data.get("river", pd.DataFrame())

        if weather.empty:
            raise RuntimeError("No weather data — cannot build drought labels")

        weather = weather.copy()
        weather["timestamp"] = pd.to_datetime(weather["timestamp"])
        weather["date"] = weather["timestamp"].dt.date

        all_labels: list[pd.DataFrame] = []

        for station_id, grp in weather.groupby("station_id"):
            grp = grp.sort_values("timestamp").copy()

            # Indicator 1: SPI-90d < -1.0 (WMO moderate drought)
            daily_precip = (
                grp.groupby("date")["precipitation"]
                .sum()
                .reset_index()
                .rename(columns={"precipitation": "daily_precip"})
                .sort_values("date")
            )
            # Rolling 90-day precipitation total
            daily_precip["precip_90d"] = (
                daily_precip["daily_precip"]
                .rolling(90, min_periods=30)
                .sum()
            )
            # SPI ≈ z-score of rolling total vs its expanding climatology
            expanding_mean = daily_precip["precip_90d"].expanding(min_periods=90).mean()
            expanding_std = daily_precip["precip_90d"].expanding(min_periods=90).std()
            daily_precip["spi_90d"] = (
                (daily_precip["precip_90d"] - expanding_mean)
                / expanding_std.clip(lower=0.01)
            )
            daily_precip["spi_drought"] = (
                daily_precip["spi_90d"] < -1.0
            ).astype(int)

            # Indicator 2: Soil moisture below 10th pct for 14+ days
            sm_col = None
            for col in ("soil_moisture_0_to_7cm", "soil_moisture_7_to_28cm"):
                if col in grp.columns and grp[col].notna().sum() > 100:
                    sm_col = col
                    break

            daily_sm_drought = pd.Series(
                0, index=range(len(daily_precip)), dtype=int
            )
            if sm_col is not None:
                daily_sm = (
                    grp.groupby("date")[sm_col]
                    .mean()
                    .reset_index()
                    .rename(columns={sm_col: "soil_moisture"})
                    .sort_values("date")
                )
                p10 = daily_sm["soil_moisture"].quantile(0.10)
                daily_sm["below_p10"] = (
                    daily_sm["soil_moisture"] < p10
                ).astype(int)
                # Consecutive days below P10
                counts = np.zeros(len(daily_sm), dtype=int)
                running = 0
                for i, flag in enumerate(daily_sm["below_p10"].values):
                    running = running + 1 if flag else 0
                    counts[i] = running
                daily_sm["sm_drought"] = (counts >= 14).astype(int)
                # Align to daily_precip by date
                sm_map = dict(zip(daily_sm["date"], daily_sm["sm_drought"]))
                daily_sm_drought = (
                    daily_precip["date"].map(sm_map).fillna(0).astype(int)
                )

            # Combined label for this station
            daily_precip["label"] = (
                (daily_precip["spi_drought"].values == 1)
                | (daily_sm_drought.values == 1)
            ).astype(int)

            # Map daily labels to hourly timestamps
            date_label_map = dict(
                zip(daily_precip["date"], daily_precip["label"])
            )
            hourly = grp[["timestamp", "station_id"]].copy()
            hourly["timestamp"] = hourly["timestamp"].dt.floor("h")
            hourly = hourly.drop_duplicates(subset=["timestamp", "station_id"])
            hourly["date"] = hourly["timestamp"].dt.date
            hourly["label"] = (
                hourly["date"].map(date_label_map).fillna(0).astype(int)
            )
            all_labels.append(hourly[["timestamp", "station_id", "label"]])

        # Indicator 3: River Q95 low-flow (Scotland only)
        if not river.empty:
            q95_labels = self._build_q95_labels(river)
            all_labels.append(q95_labels)

        if not all_labels:
            raise RuntimeError("No label data produced")

        labels = pd.concat(all_labels, ignore_index=True)
        # Any indicator triggers positive
        labels = (
            labels.groupby(["timestamp", "station_id"])["label"]
            .max()
            .reset_index()
        )
        n_pos = int(labels["label"].sum())
        n_neg = len(labels) - n_pos
        logger.info(
            f"  Drought labels: {n_pos:,} positive, {n_neg:,} negative "
            f"across {labels['station_id'].nunique()} stations"
        )
        return labels

    def _build_q95_labels(self, river: pd.DataFrame) -> pd.DataFrame:
        """Build Q95 low-flow labels from river gauge data."""
        river = river.copy()
        river["timestamp"] = pd.to_datetime(river["timestamp"])
        river["date"] = river["timestamp"].dt.date

        daily_flow = (
            river.groupby(["station_id", "date"])["level_m"]
            .mean()
            .reset_index()
            .rename(columns={"level_m": "daily_mean_flow"})
        )
        q95 = (
            daily_flow.groupby("station_id")["daily_mean_flow"]
            .quantile(0.05)
            .rename("q95")
        )
        daily_flow = daily_flow.merge(q95, on="station_id")
        daily_flow["below_q95"] = (
            daily_flow["daily_mean_flow"] < daily_flow["q95"]
        ).astype(int)

        daily_flow = daily_flow.sort_values(["station_id", "date"])
        consecutive = []
        for _sid, grp in daily_flow.groupby("station_id"):
            flags = grp["below_q95"].values
            counts = np.zeros(len(flags), dtype=int)
            running = 0
            for i, f in enumerate(flags):
                running = running + 1 if f else 0
                counts[i] = running
            consecutive.append(counts)
        daily_flow["consecutive_below_q95"] = np.concatenate(consecutive)
        daily_flow["label"] = (
            daily_flow["consecutive_below_q95"] >= 14
        ).astype(int)

        river_hourly = river[["timestamp", "station_id"]].drop_duplicates()
        river_hourly["timestamp"] = river_hourly["timestamp"].dt.floor("h")
        river_hourly = river_hourly.drop_duplicates()
        river_hourly["date"] = river_hourly["timestamp"].dt.date

        labels = river_hourly.merge(
            daily_flow[["station_id", "date", "label"]],
            on=["station_id", "date"],
            how="left",
        )
        labels["label"] = labels["label"].fillna(0).astype(int)
        return labels[["timestamp", "station_id", "label"]]

    def build_features(self, raw_data: dict[str, pd.DataFrame]) -> pd.DataFrame:
        """Build features per station with extended drought-specific variables."""
        weather = raw_data.get("weather", pd.DataFrame())
        river = raw_data.get("river", pd.DataFrame())

        if weather.empty:
            raise RuntimeError("No weather data — cannot build features")

        # Per-station standard + extended features
        features = build_per_station_features(
            weather,
            self.feature_engineer,
            extra_passthrough_cols=[
                "soil_moisture_0_to_7cm",
                "soil_moisture_7_to_28cm",
                "et0_fao_evapotranspiration",
                "soil_temperature_0_to_7cm",
            ],
        )

        # Add SPI and days-since-rain per station
        spi_frames: list[pd.DataFrame] = []
        for station_id, grp in weather.groupby("station_id"):
            grp = grp.sort_values("timestamp")
            ts_index = pd.to_datetime(grp["timestamp"])
            precip = grp["precipitation"].values

            precip_s = pd.Series(precip, index=ts_index)

            # SPI at 30-day and 90-day windows
            for window_d in (30, 90):
                w_h = window_d * 24
                rolling_sum = precip_s.rolling(w_h, min_periods=max(1, w_h // 4)).sum()
                exp_mean = rolling_sum.expanding(min_periods=max(1, w_h)).mean()
                exp_std = rolling_sum.expanding(min_periods=max(1, w_h)).std().clip(lower=0.01)
                spi = (rolling_sum - exp_mean) / exp_std
                feat_name = f"spi_{window_d}d"
                if not spi_frames or feat_name not in spi_frames[-1].columns:
                    pass  # Will add below
                tmp = pd.DataFrame({feat_name: spi}, index=ts_index)
                tmp["station_id"] = station_id
                spi_frames.append(tmp)

            # Days since significant rain (> 1mm)
            sig_rain = (precip_s > 1.0).astype(int)
            days_since = pd.Series(0, index=ts_index, dtype=int)
            running = 0
            for i in range(len(sig_rain)):
                running = 0 if sig_rain.iloc[i] else running + 1
                days_since.iloc[i] = running // 24
            tmp = pd.DataFrame(
                {"days_since_significant_rain": days_since}, index=ts_index
            )
            tmp["station_id"] = station_id
            spi_frames.append(tmp)

        if spi_frames:
            # Merge SPI features into main features by (timestamp, station_id)
            spi_all = pd.concat(spi_frames)
            spi_grouped = spi_all.groupby([spi_all.index, "station_id"]).first()
            spi_grouped.index.names = ["timestamp", "station_id"]

            # Convert main features to same multi-index for join
            feat_idx = features.copy()
            feat_idx["_ts"] = feat_idx.index
            feat_idx = feat_idx.set_index(["_ts", "station_id"])
            feat_idx.index.names = ["timestamp", "station_id"]

            for col in spi_grouped.columns:
                if col not in feat_idx.columns:
                    feat_idx[col] = spi_grouped[col]

            feat_idx = feat_idx.reset_index(level="station_id")
            feat_idx.index.name = "timestamp"
            features = feat_idx

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
        """Feature columns for drought prediction."""
        return [
            # SPI drought indicators (new — derived from precipitation)
            "spi_30d", "spi_90d",
            "days_since_significant_rain",
            # Soil moisture (new — from Open-Meteo ERA5-Land)
            "soil_moisture_0_to_7cm", "soil_moisture_7_to_28cm",
            "et0_fao_evapotranspiration",
            # River / flow features (where available)
            "level_current", "level_min_24h", "level_percentile",
            "level_anomaly", "flow_current",
            "rate_of_rise_6h",
            # Rainfall deficit features
            "rainfall_24h", "rainfall_48h", "rainfall_72h", "rainfall_7d",
            "antecedent_rainfall_7d", "antecedent_rainfall_14d",
            "antecedent_rainfall_30d",
            # Weather
            "temperature_2m", "temperature_anomaly",
            "wind_speed_10m", "pressure_msl",
            # Temporal
            "season_sin", "season_cos", "month",
        ]

def main():
    args = parse_training_args("drought")
    result = run_pipeline(DroughtRealPipeline, args)
    if result.get("status") == "success":
        logger.success(f"Drought training complete: {result['version']}")
    else:
        logger.error(f"Drought training failed: {result.get('error', 'unknown')}")

if __name__ == "__main__":
    main()
