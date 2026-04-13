"""
File: train_water_supply_disruption_real.py

Trains the water supply disruption risk-prediction model using independent
event records from two sources:

  1. GRDC (Global Runoff Data Centre) measured river discharge:
     Q10 low-flow labels (10th percentile of gauge record) for drought mode,
     Q90 high-flow labels for flood-turbidity mode.  Station gauge data is
     independent of ERA5 — measured by national hydrological agencies.
     Registration required: https://grdc.bafg.de

  2. Curated static water supply disruption events (embedded):
     20+ documented WHO/EA/USBR/ANA water supply disruption events from
     5 continents (2015–2023).  These are service restriction or crisis events
     from official water authority reports — not meteorological thresholds.

Label independence:
  GRDC discharge = observed river telemetry (not ERA5 reanalysis)
  Static events = official water authority declarations (not ERA5)
  Features = ERA5 meteorological variables from Open-Meteo
  → LeakageSeverity.NONE

How it connects:
- Extends ai-engine/app/training/base_real_pipeline.py
- Labels from data_fetch_grdc.py (GRDC + static events)
- Features from multi_location_weather.py (GLOBAL_WATER_LOCATIONS, 22 sites)
- Saves to model_registry/water_supply_disruption/ via ModelRegistry
- Loaded at inference time by ai-engine/app/hazards/water_supply_disruption.py
"""

from __future__ import annotations

import pandas as pd
from loguru import logger

from app.training.base_real_pipeline import (
    BaseRealPipeline, HazardConfig, parse_training_args, run_pipeline,
)
from app.training.multi_location_weather import (
    fetch_multi_location_weather, build_per_station_features,
    GLOBAL_WATER_LOCATIONS, EXTENDED_HOURLY_VARS,
)
from app.training.data_fetch_grdc import (
    build_water_label_df, water_supply_data_available,
)


class WaterSupplyDisruptionRealPipeline(BaseRealPipeline):

    HAZARD_CONFIG = HazardConfig(
        hazard_type="water_supply_disruption",
        task_type="forecast",
        lead_hours=24,
        region_scope="GLOBAL",
        label_source=(
            "GRDC (Global Runoff Data Centre, WMO) measured daily discharge: "
            "Q10 low-flow (drought) and Q90 high-flow (turbidity/contamination) "
            "labels at 22 key gauges globally.  "
            "Curated static water supply disruption events (2015–2023): "
            "WHO/EA/USBR/ANA/BOM documented water crises and restrictions from "
            "Cape Town Day Zero, Jordan water crisis, São Paulo Cantareira, "
            "Lake Mead shortage, UK 2018/2022 droughts, and more. "
            "All labels are independent of ERA5 reanalysis."
        ),
        data_validity="independent",
        label_provenance={
            "category": "observed_gauge_and_event_record",
            "source": (
                "GRDC daily discharge CSV files from national hydrological agencies "
                "(USGS, EA, BfG, NWIS) via WMO Global Runoff Data Centre. "
                "Static events: WHO/PAHO water emergency bulletins, Environment Agency "
                "Drought Exceptional Circumstance declarations, US Bureau of Reclamation "
                "shortage declarations, ANA Brazil drought reports, BOM Australia."
            ),
            "description": (
                "GRDC mode: station-day is POSITIVE when discharge <= Q10 "
                "(drought/low-supply) or >= Q90 (flood-turbidity risk), broadcast "
                "to all hours.  "
                "Static events: all hours within a documented water supply disruption "
                "period within 200 km of a training station are labelled POSITIVE. "
                "22 global sites span UK, W. Europe, Middle East, Africa, S. America, "
                "N. America, and Australia."
            ),
            "limitations": (
                "GRDC station download requires free registration. "
                "Static events are curated to documented disruptions — minor local "
                "disruptions not reaching national news are absent. "
                "Q10/Q90 thresholds use station-specific long-term climatology "
                "which requires multi-decade GRDC records."
            ),
            "peer_reviewed_basis": (
                "GRDC: Fekete B.M. et al. (2012), WMO-No. 168 Hydrological Aspects. "
                "WHO Emergency Water Supply Guidelines. "
                "USBR Colorado River Operations Plan."
            ),
        },
        min_total_samples=500,
        min_positive_samples=20,
        min_stations=3,
        promotion_min_roc_auc=0.68,
    )

    _WATER_LAST_STATIC = "2023-05-31"

    def _effective_dates(self) -> tuple[str, str]:
        """Clamp to static event coverage (same logic as build_labels uses)."""
        eff_end = min(self.end_date, self._WATER_LAST_STATIC)
        if eff_end < self.start_date:
            return "2020-01-01", self._WATER_LAST_STATIC
        return self.start_date, eff_end

    async def fetch_raw_data(self) -> dict[str, pd.DataFrame]:
        """Fetch ERA5 weather features from global water disruption grid.

        Uses same effective date range as labels to ensure merge succeeds.
        """
        eff_start, eff_end = self._effective_dates()
        weather = await fetch_multi_location_weather(
            locations=GLOBAL_WATER_LOCATIONS,
            start_date=eff_start,
            end_date=eff_end,
            hourly_vars=EXTENDED_HOURLY_VARS,
        )
        return {"weather": weather}

    def build_labels(self, raw_data: dict[str, pd.DataFrame]) -> pd.DataFrame:
        """Build water supply disruption labels from GRDC + static events."""
        weather = raw_data.get("weather", pd.DataFrame())
        if weather.empty:
            raise RuntimeError("No weather data — cannot build water supply labels")

        water_supply_data_available()  # logs data availability status

        # Clamp to static event coverage (same as fetch_raw_data)
        eff_start, eff_end = self._effective_dates()
        if eff_start != self.start_date or eff_end != self.end_date:
            logger.info(
                f"Water supply: effective window {eff_start}–{eff_end} "
                f"(static events cover through {self._WATER_LAST_STATIC})"
            )

        labels = build_water_label_df(
            station_locations=GLOBAL_WATER_LOCATIONS,
            start_date=eff_start,
            end_date=eff_end,
            radius_km=200.0,
            mode="combined",
        )

        # Supplement with EM-DAT drought/flood events if label count is thin
        if labels.empty or labels["label"].sum() < 50:
            from app.training.data_fetch_emdat import build_emdat_label_df
            for hazard_type in ("drought", "flood"):
                emdat_supp = build_emdat_label_df(
                    hazard_type=hazard_type,
                    station_locations=GLOBAL_WATER_LOCATIONS,
                    start_date=eff_start,
                    end_date=eff_end,
                    radius_km=300.0,
                )
                if not emdat_supp.empty and emdat_supp["label"].sum() > 0:
                    labels = pd.concat([labels, emdat_supp], ignore_index=True) if not labels.empty else emdat_supp
                    logger.info(f"  EM-DAT {hazard_type} supplement: +{int(emdat_supp['label'].sum())} positives")

        if labels.empty:
            raise RuntimeError(
                "Water supply label builder returned empty result even after EM-DAT supplement.  "
                f"Effective window: {eff_start}–{eff_end}.  "
                "For GRDC gauge data: from app.training.data_fetch_grdc import "
                "download_grdc_station; download_grdc_station(6122100)"
            )

        n_pos = int(labels["label"].sum())
        n_neg = len(labels) - n_pos
        logger.info(
            f"  Water supply labels: {n_pos:,} positive, {n_neg:,} negative "
            f"across {labels['station_id'].nunique()} stations"
        )
        return labels

    def build_features(self, raw_data: dict[str, pd.DataFrame]) -> pd.DataFrame:
        """Build per-station features with soil moisture and ET."""
        weather = raw_data.get("weather", pd.DataFrame())
        if weather.empty:
            raise RuntimeError("No weather data — cannot build features")
        return build_per_station_features(
            weather,
            self.feature_engineer,
            extra_passthrough_cols=[
                "soil_moisture_0_to_7cm",
                "soil_moisture_7_to_28cm",
                "et0_fao_evapotranspiration",
                "soil_temperature_0_to_7cm",
            ],
        )

    def hazard_feature_columns(self) -> list[str]:
        """Feature columns for water supply disruption 24h-ahead forecasting.

        Labels from GRDC gauge discharge and static crisis events — all ERA5
        features are legitimate (no shared data source).
        """
        return [
            # Precipitation deficit (drought) / surplus (flood-turbidity)
            "rainfall_24h", "rainfall_48h", "rainfall_72h",
            "rainfall_7d", "antecedent_rainfall_7d",
            "antecedent_rainfall_14d", "antecedent_rainfall_30d",
            "days_since_significant_rain",
            # Evapotranspiration (water demand from catchment)
            "et0_fao_evapotranspiration",
            # Soil moisture (antecedent catchment state)
            "soil_moisture_0_to_7cm", "soil_moisture_7_to_28cm",
            # Temperature (drives ET and freeze/thaw)
            "temperature_2m", "temperature_anomaly",
            # Freezing (pipe bursts, infrastructure freeze)
            "freeze_thaw_cycles",
            # Wind (secondary — evaporation driver)
            "wind_speed_10m",
            # Temporal
            "season_sin", "season_cos", "month",
        ]


def main():
    args = parse_training_args("water_supply_disruption")
    result = run_pipeline(WaterSupplyDisruptionRealPipeline, args)
    if result.get("status") == "success":
        logger.success(f"Water supply disruption training complete: {result['version']}")
    else:
        logger.error(f"Water supply disruption training failed: {result.get('error', 'unknown')}")


if __name__ == "__main__":
    main()
