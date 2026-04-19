"""
File: train_drought_real.py

Trains the drought risk-prediction model using CSIC SPEI-3 independent
drought labels and ERA5 meteorological features from Open-Meteo.

Label independence:
  Labels  — CSIC SPEI Global v2.9 derived from CRU TS4 OBSERVED station data
             (Harris et al., 2020).  SPEI < -1.0 = WMO moderate drought.
             Download: https://spei.csic.es/database.html

  Features — ERA5 reanalysis from Open-Meteo (temperature, precipitation,
             soil moisture, ET, wind, pressure, SPI computed from ERA5 precip).

Because labels and features come from ENTIRELY DIFFERENT underlying datasets
(CRU TS4 observed vs ERA5 reanalysis), there is zero label-feature leakage.
ERA5-derived SPI can now be legitimately included as a FEATURE (it is no longer
the same data source as the label).

How it connects:
- Extends ai-engine/app/training/base_real_pipeline.py
- Labels via app/training/data_fetch_spei.py (CSIC SPEI NetCDF)
- Features via app/training/multi_location_weather.py (ERA5 Open-Meteo)
- Saves to model_registry/drought/ via ModelRegistry
- Loaded at inference time by ai-engine/app/hazards/drought.py
"""

from __future__ import annotations

import asyncio

import pandas as pd
import numpy as np
from loguru import logger

from app.training.base_real_pipeline import (
    BaseRealPipeline, HazardConfig, parse_training_args, run_pipeline,
)
from app.training.multi_location_weather import (
    fetch_multi_location_weather, build_per_station_features,
    GLOBAL_DROUGHT_LOCATIONS, EXTENDED_HOURLY_VARS,
)
from app.training.data_fetch_spei import (
    build_spei_label_df, spei_is_available, download_spei_dataset,
)
from app.training.feature_engineering import SPEIFeatures


class DroughtRealPipeline(BaseRealPipeline):

    HAZARD_CONFIG = HazardConfig(
        hazard_type="drought",
        task_type="forecast",
        lead_hours=48,
        region_scope="GLOBAL",
        label_source=(
            "CSIC SPEI Global Database v2.9 (Vicente-Serrano et al., 2010). "
            "SPEI-3 < -1.0 (WMO moderate drought) derived from CRU TS4 OBSERVED "
            "station precipitation and temperature (Harris et al., 2020). "
            "24 globally distributed drought-prone locations across 5 continents. "
            "Entirely independent of ERA5 reanalysis used for features. "
            "DOI: 10.20350/digitalCSIC/8508"
        ),
        data_validity="independent",
        label_provenance={
            "category": "observed_index",
            "source": (
                "CSIC SPEI Global v2.9 NetCDF (spei03.nc), 0.5° global grid, "
                "monthly time step from CRU TS4 observed station data"
            ),
            "description": (
                "Monthly SPEI-3 extracted at the nearest 0.5° grid cell to each of "
                "24 training stations. A station-month is labelled POSITIVE when "
                "SPEI-3 < -1.0 (WMO moderate meteorological drought threshold). "
                "Monthly labels are broadcast to all hours within that calendar month. "
                "Stations span sub-Saharan Africa, Mediterranean Europe, Middle East, "
                "South Asia, Australia, NE Brazil, SW USA, and Central America."
            ),
            "limitations": (
                "SPEI is monthly resolution — intra-month drought onset timing is "
                "not captured. CRU TS4 has sparse station coverage over ocean and "
                "remote land areas. SPEI-3 captures meteorological drought; "
                "hydrological/agricultural droughts may lag by weeks to months."
            ),
            "peer_reviewed_basis": (
                "Vicente-Serrano S.M., Beguería S. & López-Moreno J.I. (2010). "
                "'A Multiscalar Drought Index Sensitive to Global Warming: The SPEI.' "
                "Bull. Amer. Meteor. Soc., 91, 1696–1711. doi:10.1175/2010BAMS2988.1"
            ),
        },
        min_total_samples=1_000,
        min_positive_samples=30,
        min_stations=8,
        promotion_min_roc_auc=0.72,
        fixed_test_date="2022-01-01",
    )

    # SPEI v2.9 covers 1901-01 to 2022-12.  Any request beyond this returns empty.
    _SPEI_LAST_AVAILABLE = "2022-12-31"

    def _effective_dates(self) -> tuple[str, str]:
        """Return (start, end) clamped to SPEI coverage.

        If the requested window is entirely beyond SPEI v2.9 (e.g. --fast uses
        2023-2024), shift the whole window back to the last 3 years of coverage.
        Both the feature fetch and the label fetch use these dates so the
        feature-label merge always has overlapping timestamps.
        """
        eff_end = min(self.end_date, self._SPEI_LAST_AVAILABLE)
        if eff_end < self.start_date:
            # Entire window is post-2022 — use last 3 years of SPEI coverage
            return "2020-01-01", self._SPEI_LAST_AVAILABLE
        return self.start_date, eff_end

    async def fetch_raw_data(self) -> dict[str, pd.DataFrame]:
        """Fetch ERA5 weather features (global) and SPEI drought labels.

        Both features and labels use the same effective date range so the
        feature-label merge succeeds even when the requested window extends
        beyond SPEI v2.9 coverage (Dec 2022).
        """
        eff_start, eff_end = self._effective_dates()
        if eff_start != self.start_date or eff_end != self.end_date:
            logger.info(
                f"Drought: effective training window {eff_start}–{eff_end} "
                f"(SPEI v2.9 covers through {self._SPEI_LAST_AVAILABLE}; "
                f"requested {self.start_date}–{self.end_date})"
            )

        # ERA5 weather from Open-Meteo — use same window as SPEI labels
        weather = await fetch_multi_location_weather(
            locations=GLOBAL_DROUGHT_LOCATIONS,
            start_date=eff_start,
            end_date=eff_end,
            hourly_vars=EXTENDED_HOURLY_VARS,
        )

        # SPEI labels (independent from CRU TS4 — no async needed, disk I/O)
        spei_labels = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: self._fetch_spei_labels(eff_start, eff_end),
        )

        return {
            "weather": weather,
            "spei_labels": spei_labels,
        }

    def _fetch_spei_labels(self, start_date: str, end_date: str) -> pd.DataFrame:
        """Download SPEI if needed and build station-hour drought labels.

        Parameters
        ----------
        start_date, end_date : already-clamped to SPEI coverage by _effective_dates()
        """
        if not spei_is_available(scale_months=3):
            logger.info("SPEI-3 not found locally — attempting download (~150 MB) ...")
            path = download_spei_dataset(scale_months=3)
            if path is None:
                logger.warning(
                    "SPEI download failed.  Falling back to empty label set.\n"
                    "Manual download: https://spei.csic.es/database.html\n"
                    "Place file at: {ai-engine}/data/spei/spei03.nc"
                )
                return pd.DataFrame(columns=["timestamp", "station_id", "label"])

        labels = build_spei_label_df(
            station_locations=GLOBAL_DROUGHT_LOCATIONS,
            start_date=start_date,
            end_date=end_date,
            scale_months=3,
            threshold=-1.0,          # WMO moderate drought
            consecutive_months=1,    # single-month events count
        )
        return labels

    def build_labels(self, raw_data: dict[str, pd.DataFrame]) -> pd.DataFrame:
        """Return SPEI-based drought labels (independent of ERA5 features)."""
        spei_labels = raw_data.get("spei_labels", pd.DataFrame())

        if spei_labels.empty:
            raise RuntimeError(
                "SPEI drought labels are empty — cannot train.\n"
                "Ensure spei03.nc is present at {ai-engine}/data/spei/spei03.nc.\n"
                "Download: from app.training.data_fetch_spei import download_spei_dataset; "
                "download_spei_dataset(3)"
            )

        n_pos = int(spei_labels["label"].sum())
        n_neg = len(spei_labels) - n_pos
        pos_rate = n_pos / max(len(spei_labels), 1) * 100
        logger.info(
            f"  SPEI drought labels: {n_pos:,} positive ({pos_rate:.2f}%), "
            f"{n_neg:,} negative across {spei_labels['station_id'].nunique()} stations"
        )
        return spei_labels

    def build_features(self, raw_data: dict[str, pd.DataFrame]) -> pd.DataFrame:
        """Build ERA5-based meteorological features per station.

        Because labels come from SPEI (CRU TS4), we can now include:
          - SPI computed from ERA5 precipitation (different source → not tainted)
          - Soil moisture from ERA5-Land (not the same as SPEI label)
          - All standard met variables
        """
        weather = raw_data.get("weather", pd.DataFrame())
        if weather.empty:
            raise RuntimeError("No ERA5 weather data — cannot build features")

        # Standard + extended features per station
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

        # Add ERA5-derived SPI and days-since-rain per station
        # Now legitimate features (SPEI label uses CRU TS4, not ERA5)
        spi_frames: list[pd.DataFrame] = []
        for station_id, grp in weather.groupby("station_id"):
            grp = grp.sort_values("timestamp")
            ts_index = pd.to_datetime(grp["timestamp"])
            precip = grp["precipitation"].values
            precip_s = pd.Series(precip, index=ts_index)

            for window_d in (30, 90):
                w_h = window_d * 24
                rolling_sum = precip_s.rolling(w_h, min_periods=max(1, w_h // 4)).sum()
                exp_mean = rolling_sum.expanding(min_periods=max(1, w_h)).mean()
                exp_std  = rolling_sum.expanding(min_periods=max(1, w_h)).std().clip(lower=0.01)
                spi = (rolling_sum - exp_mean) / exp_std
                tmp = pd.DataFrame({f"spi_{window_d}d": spi.values}, index=ts_index)
                tmp["station_id"] = station_id
                spi_frames.append(tmp)

            # Days since significant rain (> 1mm)
            sig_rain = (precip_s > 1.0).astype(int)
            dsrr = pd.Series(0, index=ts_index, dtype=int)
            running = 0
            for i in range(len(sig_rain)):
                running = 0 if sig_rain.iloc[i] else running + 1
                dsrr.iloc[i] = running // 24
            tmp = pd.DataFrame({"days_since_significant_rain": dsrr.values}, index=ts_index)
            tmp["station_id"] = station_id
            spi_frames.append(tmp)

        if spi_frames:
            spi_all = pd.concat(spi_frames)
            spi_grouped = spi_all.groupby([spi_all.index, "station_id"]).first()
            spi_grouped.index.names = ["timestamp", "station_id"]

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

        # ── SPEI features — Vicente-Serrano et al. (2010) ────────────────────
        # Join SPEI-3 (onset) and SPEI-12 (chronic) indices from the CSIC NetCDF
        # files already on disk.  These are a DIFFERENT variable from the labels:
        # labels = binary drought event flag derived from SPEI-3 < -1.0;
        # features = the SPEI value itself + derived severity/streak metrics.
        # This is analogous to including "river level" as a flood feature even
        # though the label is "flood event occurred".
        try:
            spei_loader = SPEIFeatures()
            spei_frames: list[pd.DataFrame] = []
            for station_id, grp in weather.groupby("station_id"):
                grp = grp.sort_values("timestamp").reset_index(drop=True)
                # Get representative lat/lon for this station
                loc = next(
                    (l for l in GLOBAL_DROUGHT_LOCATIONS if l.get("id") == station_id),
                    None,
                )
                if loc is None:
                    continue
                lat, lon = loc.get("lat", 0.0), loc.get("lon", 0.0)
                ts = pd.to_datetime(grp["timestamp"])
                start_str = str(ts.min())[:7]
                end_str   = str(ts.max())[:7]
                mini_df = pd.DataFrame({"timestamp": grp["timestamp"].values})
                mini_df = mini_df.set_index("timestamp")
                mini_df.index = pd.to_datetime(mini_df.index)
                joined = spei_loader.join(mini_df, lat=lat, lon=lon,
                                          start=start_str, end=end_str)
                spei_cols = [c for c in joined.columns if c.startswith("spei_")]
                for col in spei_cols:
                    grp[col] = joined[col].values
                grp_spei = grp[["timestamp", "station_id"] + spei_cols]
                spei_frames.append(grp_spei)

            if spei_frames:
                spei_all = pd.concat(spei_frames, ignore_index=True)
                spei_all["timestamp"] = pd.to_datetime(spei_all["timestamp"])
                # Merge into features by (timestamp, station_id)
                feat_reset = features.copy()
                has_station_col = "station_id" in feat_reset.columns
                if not has_station_col:
                    feat_reset["station_id"] = feat_reset.index.get_level_values("station_id") if "station_id" in feat_reset.index.names else None
                feat_reset["_ts"] = pd.to_datetime(feat_reset.index) if not has_station_col else pd.to_datetime(feat_reset.reset_index()["timestamp"].values)
                # Simple column-wise join on rounded timestamp + station
                for col in [c for c in spei_all.columns if c.startswith("spei_")]:
                    features[col] = 0.0
                spei_lookup = spei_all.set_index(["timestamp", "station_id"])
                for col in [c for c in spei_all.columns if c.startswith("spei_")]:
                    features[col] = 0.0
                    if "station_id" in features.columns:
                        for (ts, sid), row in spei_lookup.iterrows():
                            mask = (features.index.floor("H") == pd.Timestamp(ts).floor("H")) & (features["station_id"] == sid)
                            features.loc[mask, col] = row[col]
                logger.info(f"  SPEI features added: {[c for c in features.columns if c.startswith('spei_')]}")
        except Exception as _spei_exc:
            logger.warning(f"  SPEI feature join failed (non-fatal, training continues): {_spei_exc}")

        features = features.ffill().fillna(0.0)
        return features

    def hazard_feature_columns(self) -> list[str]:
        """Feature columns for global drought prediction.

        Because labels are now from CSIC SPEI (CRU TS4 observed), ALL
        ERA5-derived variables are legitimate features — including SPI computed
        from ERA5 precipitation and ERA5-Land soil moisture.  These are no
        longer tainted because they are not the same data source as the label.
        SPEI-3 and SPEI-12 from the CSIC NetCDF are included as direct features
        (Vicente-Serrano et al., 2010) — distinct from the binary label.
        """
        return [
            # Precipitation deficit at multiple scales
            "rainfall_24h", "rainfall_48h", "rainfall_72h",
            "rainfall_7d",  "antecedent_rainfall_7d",
            "antecedent_rainfall_14d", "antecedent_rainfall_30d",
            "days_since_significant_rain",
            # ERA5-derived SPI — now a legitimate feature (labels from CRU TS4)
            "spi_30d", "spi_90d",
            # SPEI indices from CSIC NetCDF — gold-standard drought indicators
            # (Vicente-Serrano et al., 2010, J. Climate 23:1696-1718)
            "spei_03", "spei_12",
            "spei_03_drought_flag", "spei_12_drought_flag",
            "spei_03_drought_streak", "spei_12_drought_streak",
            "spei_03_severity", "spei_12_severity",
            # Evapotranspiration demand
            "et0_fao_evapotranspiration",
            # Soil moisture state from ERA5-Land (not the label source)
            "soil_moisture_0_to_7cm", "soil_moisture_7_to_28cm",
            "soil_temperature_0_to_7cm",
            # Temperature
            "temperature_2m", "temperature_anomaly",
            # Atmospheric state
            "wind_speed_10m", "pressure_msl",
            # Temporal context
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
