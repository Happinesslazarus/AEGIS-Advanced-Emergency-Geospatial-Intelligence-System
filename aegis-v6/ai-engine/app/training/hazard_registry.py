"""
Hazard Training Registry — config-driven ML pipeline factory.

Stores per-hazard metadata (HazardConfig, data sources, feature columns, label
logic) in a central dict.  ``make_pipeline(hazard_type)`` returns a concrete
subclass of BaseRealPipeline whose behaviour is entirely driven by the registry
entry, so adding a new hazard requires only a new registry entry rather than a
new 200-line class file.

Pattern:  HuggingFace AutoModel / scikit-learn Pipeline / MLflow FlavorBackend.

Currently registered: severe_storm, public_safety_incident.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Callable

import pandas as pd
from loguru import logger

from app.training.base_real_pipeline import BaseRealPipeline, HazardConfig
from app.training.multi_location_weather import (
    build_per_station_features,
    fetch_multi_location_weather,
    GLOBAL_SAFETY_LOCATIONS,
    GLOBAL_STORM_LOCATIONS,
    STANDARD_HOURLY_VARS,
    EXTENDED_HOURLY_VARS,
)
from app.training.data_fetch_ibtracs import build_ibtracs_label_df, ibtracs_is_available
from app.training.data_fetch_events import build_storm_label_df
from app.training.data_fetch_emdat import build_emdat_label_df
from app.training.data_fetch_road_accidents import (
    build_accident_label_df, road_accidents_available,
    download_stats19, download_nhtsa_fars,
)

if TYPE_CHECKING:
    pass

# UK/Ireland station IDs that receive the Named Storm supplement
_UK_IRELAND_IDS = {"london", "edinburgh", "dublin", "amsterdam"}


# ---------------------------------------------------------------------------
# Label-building functions (one per hazard, previously class methods)
# ---------------------------------------------------------------------------

def _severe_storm_labels(pipeline: BaseRealPipeline, raw_data: dict) -> pd.DataFrame:
    """IBTrACS (global primary) + Named Storms (UK/IE) + EM-DAT supplement."""
    weather = raw_data.get("weather", pd.DataFrame())
    if weather.empty:
        raise RuntimeError("No weather data -- cannot build storm labels")

    weather = weather.copy()
    weather["timestamp"] = pd.to_datetime(weather["timestamp"]).dt.floor("h")
    all_station_hours = weather[["timestamp", "station_id"]].drop_duplicates()

    ibtracs_labels = build_ibtracs_label_df(
        station_locations=GLOBAL_STORM_LOCATIONS,
        start_date=pipeline.start_date,
        end_date=pipeline.end_date,
        radius_km=500.0,
        min_wind_knots=34.0,
        lead_window_hours=12,
    )

    uk_locations = [loc for loc in GLOBAL_STORM_LOCATIONS if loc["id"] in _UK_IRELAND_IDS]
    named_labels = pd.DataFrame(columns=["timestamp", "station_id", "label"])
    if uk_locations:
        named_labels = build_storm_label_df(
            station_locations=uk_locations,
            start_date=pipeline.start_date,
            end_date=pipeline.end_date,
        )

    emdat_labels = build_emdat_label_df(
        hazard_type="severe_storm",
        station_locations=GLOBAL_STORM_LOCATIONS,
        start_date=pipeline.start_date,
        end_date=pipeline.end_date,
        radius_km=500.0,
    )

    all_frames = [df for df in [ibtracs_labels, named_labels, emdat_labels] if not df.empty]
    if not all_frames:
        all_station_hours["label"] = 0
        logger.warning("No storm label data found -- labels are all-zero")
        return all_station_hours[["timestamp", "station_id", "label"]]

    combined_positives = (
        pd.concat(all_frames, ignore_index=True)
        .query("label == 1")[["timestamp", "station_id"]]
        .assign(timestamp=lambda d: pd.to_datetime(d["timestamp"]).dt.floor("h"))
        .drop_duplicates()
    )

    labels = all_station_hours.merge(
        combined_positives.assign(event_label=1), on=["timestamp", "station_id"], how="left"
    )
    labels["label"] = labels["event_label"].fillna(0).astype(int)

    n_pos = int(labels["label"].sum())
    logger.info(
        f"  Storm labels (IBTrACS + Named + EM-DAT): {n_pos:,} positive, "
        f"{len(labels) - n_pos:,} negative across {labels['station_id'].nunique()} stations"
    )
    return labels[["timestamp", "station_id", "label"]]


def _public_safety_labels(pipeline: BaseRealPipeline, raw_data: dict) -> pd.DataFrame:
    """Stats19 (UK) + NHTSA FARS (US) adverse-weather road accident labels."""
    weather = raw_data.get("weather", pd.DataFrame())
    if weather.empty:
        raise RuntimeError("No weather data -- cannot build public safety labels")

    if not road_accidents_available():
        logger.info("No accident data found locally -- attempting download ...")
        start_year = int(pipeline.start_date[:4])
        end_year   = int(pipeline.end_date[:4])
        download_stats19(years=range(start_year, end_year + 1))
        download_nhtsa_fars(years=range(start_year, min(end_year + 1, 2024)))

    if not road_accidents_available():
        raise RuntimeError(
            "No accident data available.  "
            "Stats19: download from https://data.gov.uk/dataset/road-safety-data  "
            "  Save as: {ai-engine}/data/road_accidents/stats19/stats19_accidents_{year}.csv  "
            "FARS: download from https://www.nhtsa.gov/research-data/fatality-analysis-reporting-system-fars  "
            "  Extract ACCIDENT.CSV and save as: {ai-engine}/data/road_accidents/fars/fars_accidents_{year}.csv"
        )

    labels = build_accident_label_df(
        station_locations=GLOBAL_SAFETY_LOCATIONS,
        start_date=pipeline.start_date,
        end_date=pipeline.end_date,
        radius_km=50.0,
    )

    if labels.empty:
        raise RuntimeError(
            "Accident label builder returned empty result.  "
            "Ensure accident CSV files cover the training date range."
        )

    n_pos = int(labels["label"].sum())
    logger.info(
        f"  Public safety labels (road accidents): {n_pos:,} positive, "
        f"{len(labels) - n_pos:,} negative across {labels['station_id'].nunique()} stations"
    )
    return labels


# ---------------------------------------------------------------------------
# Registry entries
# ---------------------------------------------------------------------------

@dataclass
class HazardEntry:
    """All config and callable hooks required to run a hazard training pipeline."""
    config: HazardConfig
    locations: list
    hourly_vars: list
    label_fn: Callable[[BaseRealPipeline, dict], pd.DataFrame]
    feature_columns: list[str]
    extra_cols: list[str] = field(default_factory=list)
    fallback_count: int = 0   # 0 = no location fallback on empty weather


HAZARD_REGISTRY: dict[str, HazardEntry] = {

    "severe_storm": HazardEntry(
        config=HazardConfig(
            hazard_type="severe_storm",
            task_type="forecast",
            lead_hours=6,
            region_scope="GLOBAL",
            label_source=(
                "IBTrACS v04r00 (Knapp et al., 2010; WMO authoritative global tropical "
                "cyclone track archive): all named storms 2015-2023, WMO_WIND >= 34 knots, "
                "500 km spatial radius, 12 h lead window.  Supplements with Met Office / "
                "Met Éireann Named Storm archive for extratropical NW European storms. "
                "28 globally distributed locations across all 6 tropical cyclone basins. "
                "Source: NCEI -- https://www.ncei.noaa.gov/products/international-best-track-archive"
            ),
            data_validity="independent",
            label_provenance={
                "category": "authoritative_event_record",
                "source": (
                    "IBTrACS v04r00 per-basin CSV files (NA, WP, EP, NI, SI, SP) "
                    "from NCEI/WMO best-track archive.  "
                    "Supplement: Met Office / Met Éireann Named Storm Archive (2015-2025)."
                ),
                "description": (
                    "Primary IBTrACS labels: station-hour is POSITIVE when a WMO best-track "
                    "point with sustained wind >= 34 knots is within 500 km of the station "
                    "OR was within 500 km in the preceding 12 hours (lead window).  "
                    "Supplement: for UK/Ireland grid points, Named Storm hours are also "
                    "labelled POSITIVE (extratropical storms not in IBTrACS). "
                    "Labels are entirely independent of any ERA5 meteorological variable."
                ),
                "limitations": (
                    "IBTrACS captures tropical/subtropical cyclones only -- mid-latitude "
                    "winter storms are covered only by the Named Storm supplement for "
                    "UK/Ireland.  Track positions are 6-hourly; exact storm landfall timing "
                    "within a 6-hour window is not resolved.  Stations far from any "
                    "cyclone basin may have very low positive rates."
                ),
                "peer_reviewed_basis": (
                    "Knapp K.R. et al. (2010). 'The International Best Track Archive for "
                    "Climate Stewardship (IBTrACS).' Bull. Amer. Meteor. Soc., 91, 363-376. "
                    "doi:10.1175/2009BAMS2755.1"
                ),
            },
            min_total_samples=500,
            min_positive_samples=20,
            min_stations=3,
            promotion_min_roc_auc=0.70,
            fixed_test_date="2022-01-01",
        ),
        locations=GLOBAL_STORM_LOCATIONS,
        hourly_vars=STANDARD_HOURLY_VARS,
        label_fn=_severe_storm_labels,
        feature_columns=[
            "pressure_msl", "pressure_change_3h", "pressure_change_6h",
            "wind_speed_10m", "wind_gusts_10m",
            "temperature_2m", "relative_humidity_2m", "dewpoint_2m",
            "season_sin", "season_cos", "hour_sin", "hour_cos", "month",
        ],
    ),

    "public_safety_incident": HazardEntry(
        config=HazardConfig(
            hazard_type="public_safety_incident",
            task_type="forecast",
            lead_hours=3,
            region_scope="UK+US",
            label_source=(
                "UK DfT Stats19 Road Safety Data (2015-2023): police-reported road "
                "injury accidents with adverse weather condition codes (rain, snow, fog, "
                "high winds) -- ~130,000 adverse-weather accidents/year.  "
                "US NHTSA FARS Fatal Accident Reporting System (2015-2022): all US fatal "
                "accidents with adverse atmospheric condition codes.  "
                "Both are observed police/NHTSA records -- independent of ERA5 reanalysis.  "
                "Stats19 free: https://data.gov.uk/dataset/road-safety-data  "
                "FARS free: https://www.nhtsa.gov/research-data/fatality-analysis-reporting-system-fars"
            ),
            data_validity="independent",
            label_provenance={
                "category": "observed_incident_record",
                "source": (
                    "Stats19: DfT dft-road-casualty-statistics-accident-{year}.csv; "
                    "adverse weather codes {2,3,4,5,6,7,8} (raining, snowing, fog/mist, "
                    "fine+high winds, rain+high winds, snow+high winds, other adverse). "
                    "NHTSA FARS: ACCIDENT.CSV from annual ZIP; adverse atmo codes "
                    "{2,3,4,5,6,7,8,9,10,11,98} (blowing sand/snow, fog, freezing rain, "
                    "rain, severe crosswinds, sleet/hail, snow)."
                ),
                "description": (
                    "A station-day is POSITIVE when at least one adverse-weather accident "
                    "occurred within 80 km (Stats19) or 50 km (FARS) of the station on that day. "
                    "All hours in that day are labelled POSITIVE (consistent with daily reporting). "
                    "Labels are observed outcomes -- entirely independent of ERA5 features."
                ),
                "limitations": (
                    "Stats19 covers Great Britain only (not Northern Ireland). "
                    "FARS covers US fatal accidents only (excludes injury-only). "
                    "Daily resolution means exact accident hour is unknown within a 24 h window."
                ),
                "peer_reviewed_basis": (
                    "Brodsky H. & Hakkert A.S. (1988). 'Risk of a road accident in "
                    "rainy weather.' Accident Anal. Prev., 20(3), 161-176."
                ),
            },
            min_total_samples=500,
            min_positive_samples=20,
            min_stations=3,
            promotion_min_roc_auc=0.68,
            fixed_test_date="2022-01-01",
            allow_temporal_drift=True,
        ),
        locations=GLOBAL_SAFETY_LOCATIONS,
        hourly_vars=EXTENDED_HOURLY_VARS,
        label_fn=_public_safety_labels,
        feature_columns=[
            "temperature_2m", "dewpoint_2m",
            "consecutive_frost_days", "freeze_thaw_cycles",
            "rainfall_1h", "rainfall_3h", "rainfall_24h",
            "snowfall", "snow_depth",
            "visibility",
            "wind_speed_10m", "wind_gusts_10m",
            "relative_humidity_2m",
            "pressure_msl", "pressure_change_3h",
            "season_sin", "season_cos", "hour_sin", "hour_cos", "month",
        ],
        extra_cols=["snowfall", "snow_depth", "dewpoint_2m", "visibility"],
        fallback_count=6,
    ),
}


# ---------------------------------------------------------------------------
# Pipeline factory
# ---------------------------------------------------------------------------

def make_pipeline(hazard_type: str) -> type[BaseRealPipeline]:
    """Return a concrete BaseRealPipeline subclass driven entirely by the registry.

    Usage::

        SevereStormRealPipeline = make_pipeline("severe_storm")
        result = run_pipeline(SevereStormRealPipeline, args)

    Adding a new hazard requires only a new ``HazardEntry`` in ``HAZARD_REGISTRY``.
    """
    entry = HAZARD_REGISTRY[hazard_type]

    class _GenericPipeline(BaseRealPipeline):
        HAZARD_CONFIG = entry.config

        async def fetch_raw_data(self) -> dict[str, pd.DataFrame]:
            weather = await fetch_multi_location_weather(
                locations=entry.locations,
                start_date=self.start_date,
                end_date=self.end_date,
                hourly_vars=entry.hourly_vars,
            )
            if weather.empty and entry.fallback_count > 0:
                logger.warning(
                    f"Full {len(entry.locations)}-location weather fetch failed. "
                    f"Retrying with {entry.fallback_count} core locations."
                )
                await asyncio.sleep(30)
                weather = await fetch_multi_location_weather(
                    locations=entry.locations[: entry.fallback_count],
                    start_date=self.start_date,
                    end_date=self.end_date,
                    hourly_vars=entry.hourly_vars,
                )
            return {"weather": weather}

        def build_labels(self, raw_data: dict[str, pd.DataFrame]) -> pd.DataFrame:
            return entry.label_fn(self, raw_data)

        def build_features(self, raw_data: dict[str, pd.DataFrame]) -> pd.DataFrame:
            weather = raw_data.get("weather", pd.DataFrame())
            if weather.empty:
                raise RuntimeError(f"No weather data for {hazard_type}")
            return build_per_station_features(
                weather, self.feature_engineer,
                extra_passthrough_cols=entry.extra_cols,
            )

        def hazard_feature_columns(self) -> list[str]:
            return list(entry.feature_columns)

    _GenericPipeline.__name__ = (
        "".join(w.capitalize() for w in hazard_type.split("_")) + "RealPipeline"
    )
    _GenericPipeline.__qualname__ = _GenericPipeline.__name__
    return _GenericPipeline
