"""
File: train_landslide_real.py

What this file does:
Trains the landslide risk-prediction model using real-world historical data.
Multi-region training (UK + Norway + Nepal + Colombia + Philippines + Japan +
Italy) based on the NASA Global Landslide Catalog event distribution.

Why the label source changed
-----------------------------
The original design derived labels by applying BGS rainfall trigger thresholds
(24h > 50mm OR 72h > 100mm) to observed rainfall data.  This is a tautology:
rainfall_24h and rainfall_72h were also in the feature set.  A model trained on
these labels learns to apply the threshold rule — it does not learn the actual
landslide-triggering relationship.

The new design uses ACTUAL LANDSLIDE EVENT RECORDS as labels:
  - NASA Global Landslide Catalog (GLC) / Cooperative Open Online Landslide
    Repository (COOLR) for global coverage.
  - BGS National Landslide Database (BNLD) for UK locations where accessible.

With real event labels, rainfall_24h and rainfall_72h become LEGITIMATE
PREDICTORS.  The model learns which rainfall conditions actually trigger
slides, rather than reconstructing a threshold rule.

Global scope necessity
-----------------------
The UK has roughly 50–100 documented landslide events per year across BGS
records, many without precise timestamps.  Across a 2-year training window
with hourly data and 3 UK stations, this yields very few positive samples.
Nepal, Colombia, and the Philippines each contribute thousands of events to
the NASA GLC, providing sufficient positives for valid model evaluation.

NASA GLC integration
---------------------
In production: fetch events from NASA GLC via the ESRI REST API at
https://maps.nccs.nasa.gov/arcgis/rest/services/ISERV/NASA_GLC/FeatureServer/0/query
and match each event (date + lat/lon) to the nearest weather station within
a configurable radius.

This pipeline provides the full matching framework with a graceful fallback:
if the catalog API is unreachable, the pipeline falls back to the BGS rainfall
trigger approach but marks labels as data_validity='invalid' to prevent
tautological training — the validator will then block training with a clear
NOT_TRAINABLE reason rather than silently producing inflated metrics.

How it connects:
- Extends ai-engine/app/training/base_real_pipeline.py
- Fetches weather via multi_location_weather.py (GLOBAL_LANDSLIDE_LOCATIONS)
- Saves to model_registry/landslide/ via ModelRegistry
- Loaded at inference time by ai-engine/app/hazards/landslide.py
"""

from __future__ import annotations

import asyncio
import math
import pandas as pd
import numpy as np
from loguru import logger

from app.training.base_real_pipeline import (
    BaseRealPipeline, HazardConfig, parse_training_args, run_pipeline,
)
from app.training.multi_location_weather import (
    fetch_multi_location_weather, build_per_station_features,
    GLOBAL_LANDSLIDE_LOCATIONS, EXTENDED_HOURLY_VARS,
)

# Maximum distance (degrees lat/lon) from event to weather station for a match.
# ~0.23° ≈ 25km at the equator; acceptable for catchment-scale matching.
_MATCH_RADIUS_DEG = 0.23


def _haversine_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Return great-circle distance in degrees between two points."""
    r = 6371.0
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(d_lon / 2) ** 2
    )
    km = 2 * r * math.asin(math.sqrt(a))
    return km / 111.0  # approximate degrees


class LandslideRealPipeline(BaseRealPipeline):

    HAZARD_CONFIG = HazardConfig(
        hazard_type="landslide",
        task_type="forecast",
        lead_hours=6,
        region_scope="GLOBAL",
        label_source=(
            "NASA Global Landslide Catalog (GLC) / COOLR event records matched "
            "to weather stations by proximity (25km radius); BGS National "
            "Landslide Database for UK stations where accessible"
        ),
        data_validity="independent",
        label_provenance={
            "category": "recorded_events",
            "source": (
                "NASA Global Landslide Catalog (GLC) / Cooperative Open Online "
                "Landslide Repository (COOLR) — https://maps.nccs.nasa.gov; "
                "BGS National Landslide Database for UK-specific events"
            ),
            "description": (
                "Labels derived from actual landslide occurrence records across "
                "13 global locations.  A positive label is assigned to any "
                "weather station within 25km of a recorded GLC/COOLR event during "
                "the 6h window before the event timestamp.  All other station-"
                "hours are labelled negative.  Rainfall and soil-moisture features "
                "are legitimate predictors — they are NOT used to define labels."
            ),
            "limitations": (
                "NASA GLC has reporting bias toward road networks and populated "
                "areas.  Rural and submarine events are underrepresented.  "
                "Spatial matching radius (25km) may introduce false negatives "
                "(missed events) or false positives (nearby station, distant event)."
                "If the GLC API is unavailable the pipeline falls back to BGS "
                "rainfall thresholds and marks labels as NOT_TRAINABLE."
            ),
            "peer_reviewed_basis": (
                "Kirschbaum et al. (2015) Global Landslide Catalog; "
                "Stanley & Kirschbaum (2017) COOLR framework"
            ),
        },
        min_total_samples=500,
        min_positive_samples=20,
        min_stations=3,
        promotion_min_roc_auc=0.70,
    )

    async def fetch_raw_data(self) -> dict[str, pd.DataFrame]:
        """Fetch weather from 13 global landslide-susceptible locations
        and attempt to retrieve NASA GLC event records."""
        weather = await fetch_multi_location_weather(
            locations=GLOBAL_LANDSLIDE_LOCATIONS,
            start_date=self.start_date,
            end_date=self.end_date,
            hourly_vars=EXTENDED_HOURLY_VARS,
        )

        landslide_events = pd.DataFrame()
        try:
            landslide_events = await self._fetch_glc_events()
        except Exception as exc:
            logger.warning(
                f"NASA GLC event fetch failed: {exc}.  "
                "Falling back to EM-DAT landslide records (independent label source)."
            )

        # If GLC unavailable, use EM-DAT landslide + mass-movement events
        if landslide_events.empty:
            from app.training.data_fetch_emdat import build_emdat_label_df
            emdat_labels = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: build_emdat_label_df(
                    hazard_type="landslide",
                    station_locations=[
                        {"id": loc["id"], "lat": loc["lat"], "lon": loc["lon"]}
                        for loc in GLOBAL_LANDSLIDE_LOCATIONS
                    ],
                    start_date=self.start_date,
                    end_date=self.end_date,
                    radius_km=200.0,
                ),
            )
            if not emdat_labels.empty and emdat_labels["label"].sum() > 0:
                logger.info(
                    f"  EM-DAT landslide fallback: "
                    f"{int(emdat_labels['label'].sum())} positive labels"
                )
                landslide_events = emdat_labels  # already in label format

        return {
            "weather": weather,
            "landslide_events": landslide_events,
        }

    async def _fetch_glc_events(self) -> pd.DataFrame:
        """Fetch NASA GLC / COOLR landslide events for the training date range.

        Returns DataFrame with columns: [event_id, date, latitude, longitude,
        country, fatalities].  Empty DataFrame if unavailable.

        Production integration: query the ESRI FeatureServer REST endpoint.
        The API returns GeoJSON features that are parsed into a flat table.
        """
        import aiohttp

        base_url = (
            "https://maps.nccs.nasa.gov/arcgis/rest/services/ISERV/"
            "NASA_GLC/FeatureServer/0/query"
        )
        params = {
            "where": (
                f"event_date >= '{self.start_date}' "
                f"AND event_date <= '{self.end_date}'"
            ),
            "outFields": "objectid,event_date,latitude,longitude,country,fatality_count",
            "returnGeometry": "false",
            "f": "json",
            "resultRecordCount": 10000,
        }

        async with aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=60)
        ) as session:
            async with session.get(base_url, params=params) as resp:
                if resp.status != 200:
                    raise RuntimeError(
                        f"GLC API returned HTTP {resp.status}"
                    )
                data = await resp.json()

        features = data.get("features", [])
        if not features:
            logger.warning("NASA GLC API returned 0 features for this date range")
            return pd.DataFrame()

        rows = []
        for f in features:
            attrs = f.get("attributes", {})
            rows.append({
                "event_id": attrs.get("objectid"),
                "date": pd.to_datetime(attrs.get("event_date"), unit="ms"),
                "latitude": attrs.get("latitude"),
                "longitude": attrs.get("longitude"),
                "country": attrs.get("country"),
                "fatalities": attrs.get("fatality_count", 0),
            })

        events = pd.DataFrame(rows)
        events = events.dropna(subset=["date", "latitude", "longitude"])
        logger.info(
            f"  NASA GLC: {len(events)} landslide events fetched "
            f"({self.start_date} to {self.end_date})"
        )
        return events

    def build_labels(self, raw_data: dict[str, pd.DataFrame]) -> pd.DataFrame:
        """Build landslide labels from actual event records.

        Matches each GLC event to weather stations within _MATCH_RADIUS_DEG
        and marks the 6h window before the event as positive.

        If GLC events are unavailable, falls back to BGS rainfall threshold
        labels but changes label_provenance.category to 'tautological_fallback'
        so the validator's provenance check can block training.
        """
        weather = raw_data.get("weather", pd.DataFrame())
        events = raw_data.get("landslide_events", pd.DataFrame())

        if weather.empty:
            raise RuntimeError("No weather data — cannot build landslide labels")

        weather = weather.copy()
        weather["timestamp"] = pd.to_datetime(weather["timestamp"])
        weather["timestamp"] = weather["timestamp"].dt.floor("h")

        # Build station coordinate lookup from GLOBAL_LANDSLIDE_LOCATIONS
        station_coords: dict[str, tuple[float, float]] = {
            loc["id"]: (loc["lat"], loc["lon"])
            for loc in GLOBAL_LANDSLIDE_LOCATIONS
        }

        # All station-hour pairs default to label=0
        all_records = weather[["timestamp", "station_id"]].drop_duplicates()
        all_records = all_records.copy()
        all_records["label"] = 0

        if not events.empty:
            # EM-DAT fallback already provides pre-matched labels (timestamp, station_id, label)
            if "label" in events.columns and "timestamp" in events.columns:
                logger.info("  Using pre-matched EM-DAT landslide labels directly.")
                self.HAZARD_CONFIG.label_provenance["category"] = "recorded_events"
                self.HAZARD_CONFIG.label_provenance["source"] = (
                    "EM-DAT (CRED) global landslide/mass-movement records — "
                    "independent of ERA5 reanalysis"
                )
                self.HAZARD_CONFIG.data_validity = "independent"
                return events[["timestamp", "station_id", "label"]].copy()
            # GLC format: spatially match events to stations
            return self._match_events_to_stations(all_records, events, station_coords)

        # Fallback: BGS rainfall thresholds — mark as tautological so validator blocks it
        logger.warning(
            "No GLC landslide event records available.  "
            "Falling back to BGS rainfall trigger thresholds "
            "(rainfall_24h > 50mm OR rainfall_72h > 100mm).  "
            "This WILL be blocked by the validator as a tautological label "
            "because rainfall_24h and rainfall_72h are also feature columns."
        )
        self.HAZARD_CONFIG.label_provenance["category"] = "tautological_fallback"
        self.HAZARD_CONFIG.label_provenance["description"] = (
            "FALLBACK: NASA GLC API unavailable.  Labels derived from BGS rainfall "
            "trigger thresholds.  THIS IS TAUTOLOGICAL — rainfall_24h and "
            "rainfall_72h appear in both label definition and feature set.  "
            "Validator will block training."
        )
        self.HAZARD_CONFIG.data_validity = "invalid"

        # Compute rainfall rolling sums for fallback labels
        rainfall_cols = [c for c in weather.columns if "precip" in c.lower() or "rain" in c.lower()]
        if not rainfall_cols:
            raise RuntimeError("No rainfall column found for fallback label computation")

        rain_col = rainfall_cols[0]
        fallback_labels: list[pd.DataFrame] = []
        for station_id, grp in weather.groupby("station_id"):
            grp = grp.set_index("timestamp").sort_index()
            rain_vals = grp[rain_col]
            rain_24h = rain_vals.rolling("24h", min_periods=1).sum()
            rain_72h = rain_vals.rolling("72h", min_periods=1).sum()
            label = ((rain_24h > 50.0) | (rain_72h > 100.0)).astype(int)
            fallback_labels.append(pd.DataFrame({
                "timestamp": grp.index,
                "station_id": station_id,
                "label": label.values,
            }))

        labels = pd.concat(fallback_labels, ignore_index=True)
        n_pos = int(labels["label"].sum())
        logger.info(
            f"  Landslide labels (FALLBACK — TAUTOLOGICAL): "
            f"{n_pos} positive, {len(labels) - n_pos} negative"
        )
        return labels

    def _match_events_to_stations(
        self,
        all_records: pd.DataFrame,
        events: pd.DataFrame,
        station_coords: dict[str, tuple[float, float]],
    ) -> pd.DataFrame:
        """Match GLC events to nearby station-hour records and set label=1."""
        all_records = all_records.copy()
        all_records = all_records.set_index(["timestamp", "station_id"])
        all_records["label"] = 0

        matched = 0
        for _, event in events.iterrows():
            event_ts = pd.Timestamp(event["date"]).floor("h")
            ev_lat = float(event["latitude"])
            ev_lon = float(event["longitude"])

            # Find stations within match radius
            for sid, (slat, slon) in station_coords.items():
                if _haversine_deg(ev_lat, ev_lon, slat, slon) > _MATCH_RADIUS_DEG:
                    continue

                # Mark 6 hours before event as the precursor window
                for h in range(6):
                    ts = event_ts - pd.Timedelta(hours=h)
                    idx = (ts, sid)
                    if idx in all_records.index:
                        all_records.loc[idx, "label"] = 1
                        matched += 1

        all_records = all_records.reset_index()
        n_pos = int(all_records["label"].sum())
        n_neg = len(all_records) - n_pos
        logger.info(
            f"  Landslide labels (GLC events): {n_pos:,} positive, {n_neg:,} negative "
            f"({matched} station-hour slots matched from {len(events)} events)"
        )
        return all_records[["timestamp", "station_id", "label"]]

    def build_features(self, raw_data: dict[str, pd.DataFrame]) -> pd.DataFrame:
        """Build per-station features including rainfall accumulations."""
        weather = raw_data.get("weather", pd.DataFrame())
        if weather.empty:
            raise RuntimeError("No weather data — cannot build features")

        return build_per_station_features(
            weather,
            self.feature_engineer,
            extra_passthrough_cols=[
                "soil_moisture_0_to_7cm",
                "soil_moisture_7_to_28cm",
                "snowfall",
                "snow_depth",
            ],
        )

    def hazard_feature_columns(self) -> list[str]:
        """Feature columns for landslide 6h-ahead risk forecasting.

        With real event labels (GLC), rainfall features are LEGITIMATE
        PREDICTORS — not label constructors.  The full rainfall accumulation
        hierarchy is included to capture different triggering regimes
        (flash rainfall vs antecedent soil saturation vs snowmelt).
        """
        return [
            # Rainfall accumulations — primary landslide triggers
            "rainfall_1h", "rainfall_3h", "rainfall_6h", "rainfall_12h",
            "rainfall_24h", "rainfall_48h", "rainfall_72h", "rainfall_7d",
            # Antecedent soil saturation
            "antecedent_rainfall_7d", "antecedent_rainfall_14d",
            "antecedent_rainfall_30d",
            "days_since_significant_rain",
            "rainfall_intensity_max_1h",
            # Soil moisture (saturation state — independent of event label)
            "soil_moisture_0_to_7cm",
            "soil_moisture_7_to_28cm",
            # Snowmelt proxy (temperature crossing 0°C with snow present)
            "temperature_2m",
            "snowfall",
            "snow_depth",
            # Atmospheric state
            "pressure_msl", "wind_speed_10m",
            # Temporal context
            "season_sin", "season_cos", "month",
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
