"""
Trains the heatwave risk-prediction model using real-world historical data from
Open-Meteo and formally declared heatwave episode records from national
meteorological services across Europe.

Label source (INDEPENDENT — no leakage)
-----------------------------------------
Labels are derived from the static OFFICIAL_HEATWAVES list in
data_fetch_events.py, which catalogs formally declared heatwave episodes from:

  - UK: Met Office Heat-Health Alert (HHA) Level 3+ activations
  - France: Météo-France vigilance canicule orange/rouge declarations
  - Spain: AEMET aviso naranja/rojo por calor
  - Italy: National Heat Health Warning System (HHWS) Level 3 alerts
  - Greece: HNMS extreme heat advisories
  - Germany, Portugal: respective national service declarations

These are authoritative public health declarations, not threshold rules applied
to the same ERA5 data used as features.  The label is determined by whether a
national meteorological authority formally declared a heat emergency at a
geographic location.  This completely decouples labels from features.

Because labels are independent event records, ALL temperature-related
features can be retained as legitimate predictors:
  - temperature_2m       — physical predictor of heatwave persistence
  - apparent_temperature — heat stress proxy
  - consecutive_hot_days — reinstated: no longer a label constructor

Multi-region training (UK + Mediterranean + Central Europe)
------------------------------------------------------------
The OFFICIAL_HEATWAVES dataset provides events from 8 countries and ~2019–2025.
Multi-region training via GLOBAL_HEATWAVE_LOCATIONS (27 stations) ensures
that all three chronological splits contain positive examples.

Seasonal-stratified split
--------------------------
The _chronological_split() override is retained as a belt-and-suspenders
safeguard, ensuring positive samples are proportionally distributed across
train / val / test folds even when declaration events cluster in summer.

Forecast horizon
-----------------
task_type = "forecast", lead_hours = 24: the model predicts whether a declared
heatwave will be active 24 hours ahead.  Features at T predict declarations
at T+24h.

Fallback behaviour
-------------------
If the training window contains no declared heatwave episodes, the pipeline
logs a warning.  The validator's min_positive_samples check will block
training rather than producing a degenerate all-negative model.

- Extends ai-engine/app/training/base_real_pipeline.py
- Fetches weather via multi_location_weather.py (GLOBAL_HEATWAVE_LOCATIONS)
- Labels from data_fetch_events.OFFICIAL_HEATWAVES (static, no API call)
- Saves to model_registry/heatwave/ via ModelRegistry
- Loaded at inference time by ai-engine/app/hazards/heatwave.py
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from loguru import logger

from app.training.base_real_pipeline import (
    BaseRealPipeline, HazardConfig, parse_training_args, run_pipeline,
)
from app.training.multi_location_weather import (
    fetch_multi_location_weather, build_per_station_features,
    GLOBAL_HEATWAVE_LOCATIONS, EXTENDED_HOURLY_VARS,
)
from app.training.data_fetch_events import build_heatwave_label_df


class HeatwaveRealPipeline(BaseRealPipeline):

    HAZARD_CONFIG = HazardConfig(
        hazard_type="heatwave",
        task_type="forecast",
        lead_hours=24,
        region_scope="MULTI-REGION",
        label_source=(
            "Formally declared heatwave episodes from national meteorological "
            "services: Met Office HHA Level 3+ (UK), Météo-France canicule "
            "orange/rouge, AEMET aviso rojo (Spain), HHWS Level 3 (Italy), "
            "HNMS extreme heat advisories (Greece), DWD (Germany), IPMA "
            "(Portugal).  Static table in data_fetch_events.OFFICIAL_HEATWAVES "
            "(30+ episodes, 2019–2025).  Labels are authoritative declarations "
            "from public health / meteorological bodies — independent of any "
            "ERA5 feature variable."
        ),
        data_validity="independent",
        label_provenance={
            "category": "authoritative_event_record",
            "source": (
                "Met Office HHA Level 3+, Météo-France vigilance canicule rouge/"
                "orange, AEMET avisos naranja/rojo, Italian HHWS Level 3 alerts, "
                "HNMS Greece extreme heat advisories.  "
                "Static table in data_fetch_events.OFFICIAL_HEATWAVES (2019–2025)."
            ),
            "description": (
                "Positive labels: any hour within a formally declared heatwave "
                "episode at a station covered by that declaration's geographic "
                "scope.  Declarations represent national meteorological service "
                "judgements that health-threatening heat conditions are present — "
                "they incorporate Tmax, Tmin, duration, humidity, and health "
                "impacts; they are not a single ERA5 threshold. "
                "Features at T predict heatwave declaration status at T+24h."
            ),
            "limitations": (
                "Declaration archive begins 2019 in most countries.  Training "
                "windows before 2019 will produce sparse positives, relying on "
                "the UK Met Office regional records which have earlier availability "
                "but less structured archiving.  Some declarations in the static "
                "table may not perfectly align with ERA5 grid-point conditions "
                "(urban heat island, coastal effects).  The static list requires "
                "annual updates to add new season episodes."
            ),
            "peer_reviewed_basis": (
                "Met Office HHA national framework; WHO/WMO guidance on heat "
                "health warning systems; Kovats & Jendritzky (2006) heatwave "
                "declarations review"
            ),
        },
        min_total_samples=500,
        min_positive_samples=20,
        min_stations=3,
        promotion_min_roc_auc=0.70,
        fixed_test_date="2022-01-01",
    )

    async def fetch_raw_data(self) -> dict[str, pd.DataFrame]:
        """Fetch weather from 27 multi-region locations."""
        weather = await fetch_multi_location_weather(
            locations=GLOBAL_HEATWAVE_LOCATIONS,
            start_date=self.start_date,
            end_date=self.end_date,
            hourly_vars=EXTENDED_HOURLY_VARS,
        )
        return {"weather": weather}

    def build_labels(self, raw_data: dict[str, pd.DataFrame]) -> pd.DataFrame:
        """Build labels from officially declared heatwave episodes.

        Each episode in OFFICIAL_HEATWAVES has a list of affected station IDs
        from GLOBAL_HEATWAVE_LOCATIONS.  Hours within any declaration window
        for a matching station get label=1.  All other hours are label=0.

        The base pipeline shifts label timestamps by lead_hours=24 so that
        features at T align with heatwave presence at T+24h.
        """
        weather = raw_data.get("weather", pd.DataFrame())
        if weather.empty:
            raise RuntimeError("No weather data — cannot build heatwave labels")

        weather = weather.copy()
        weather["timestamp"] = pd.to_datetime(weather["timestamp"]).dt.floor("h")
        all_stations = weather[["timestamp", "station_id"]].drop_duplicates()

        # Fetch positive labels from the official declaration table
        positive_labels = build_heatwave_label_df(
            station_locations=GLOBAL_HEATWAVE_LOCATIONS,
            start_date=self.start_date,
            end_date=self.end_date,
        )

        if positive_labels.empty:
            all_stations["label"] = 0
            n_pos = 0
        else:
            positive_labels["timestamp"] = pd.to_datetime(
                positive_labels["timestamp"]
            ).dt.floor("h")
            labels = all_stations.merge(
                positive_labels.assign(event_label=1)[
                    ["timestamp", "station_id", "event_label"]
                ],
                on=["timestamp", "station_id"],
                how="left",
            )
            labels["label"] = labels["event_label"].fillna(0).astype(int)
            all_stations = labels[["timestamp", "station_id", "label"]]
            n_pos = int(all_stations["label"].sum())

        n_neg = len(all_stations) - n_pos
        pos_rate = n_pos / max(len(all_stations), 1) * 100
        logger.info(
            f"  Heatwave labels (declared episodes): {n_pos:,} positive, "
            f"{n_neg:,} negative ({pos_rate:.2f}% positive rate) "
            f"across {all_stations['station_id'].nunique()} stations"
        )
        return all_stations[["timestamp", "station_id", "label"]]

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
        """Feature columns for heatwave 24h-ahead prediction.

        Because labels are independent official declarations (not threshold
        rules applied to ERA5 temperature), all temperature-related features
        are now legitimate predictors.

        consecutive_hot_days has been REINSTATED: with independent labels,
        it represents genuine observed heat persistence that provides
        predictive power beyond a single temperature reading.  It is no
        longer a label constructor — declarations are made by meteorological
        service forecasters using additional factors beyond the raw count.
        """
        return [
            # Temperature — primary physical predictor
            "temperature_2m",
            "apparent_temperature",
            "dewpoint_2m",
            "heat_index",
            "temperature_anomaly",
            # Heat persistence — reinstated as legitimate predictor
            "consecutive_hot_days",
            # Atmospheric moisture
            "relative_humidity_2m",
            # Synoptic pressure pattern — blocking highs sustain heat episodes
            "pressure_msl",
            "pressure_change_3h",
            "pressure_change_6h",
            # Evapotranspiration proxy (radiation / energy balance)
            "et0_fao_evapotranspiration",
            # Temporal context
            "season_sin", "season_cos", "hour_sin", "hour_cos", "month",
        ]

    def _chronological_split(self, X, y, timestamps) -> dict:
        """Seasonal-stratified chronological split for heatwave.

        Retained as a safeguard: even with multi-region training and
        independent labels, heatwave declarations cluster in summer months.
        This split ensures proportional representation of positive samples
        across all three folds by adjusting fold boundaries to the chronological
        positions of positive examples.

        Temporal ordering within each fold is preserved — this is NOT random
        stratified sampling.
        """
        n = len(y)
        if timestamps is None or n < 3:
            return super()._chronological_split(X, y, timestamps)

        pos_idx = np.where(y == 1)[0]
        if len(pos_idx) == 0:
            return super()._chronological_split(X, y, timestamps)

        n_pos = len(pos_idx)
        train_pos_end = int(n_pos * 0.70)
        val_pos_end = int(n_pos * 0.85)

        test_start = (
            int(pos_idx[val_pos_end]) if val_pos_end < n_pos else int(n * 0.85)
        )
        val_start = (
            int(pos_idx[train_pos_end]) if train_pos_end < n_pos else int(n * 0.70)
        )

        val_start = max(int(n * 0.50), min(val_start, int(n * 0.80)))
        test_start = max(val_start + 1, min(test_start, int(n * 0.90)))

        logger.info(
            f"  Seasonal split: train [0:{val_start}] "
            f"val [{val_start}:{test_start}] "
            f"test [{test_start}:{n}] "
            f"(pos in train={int(y[:val_start].sum())}, "
            f"val={int(y[val_start:test_start].sum())}, "
            f"test={int(y[test_start:].sum())})"
        )

        return {
            "train": (X[:val_start], y[:val_start]),
            "val": (X[val_start:test_start], y[val_start:test_start]),
            "test": (X[test_start:], y[test_start:]),
        }


def main():
    args = parse_training_args("heatwave")
    result = run_pipeline(HeatwaveRealPipeline, args)
    if result.get("status") == "success":
        logger.success(f"Heatwave training complete: {result['version']}")
    else:
        logger.error(f"Heatwave training failed: {result.get('error', 'unknown')}")


if __name__ == "__main__":
    main()
