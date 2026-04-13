"""
Module: region_registry.py

Region_registry AI engine module.
"""

from __future__ import annotations

from dataclasses import dataclass

@dataclass(frozen=True)
class RegionConfig:
    """
    Immutable configuration for a monitoring jurisdiction.
    All region-specific values live here and ONLY here.
    No region names, thresholds, or API URLs should exist elsewhere.
    """

    region_id: str
    display_name: str
    jurisdiction: str
    country: str
    bbox: tuple[float, float, float, float]
    flood_api_base: str
    gauge_api_url: str
    alert_api_url: str
    watch_geojson_url: str
    warning_geojson_url: str
    heatwave_threshold_c: float
    bankfull_multiplier: float = 1.10
    timezone: str = "Europe/London"
    era5_grid_res: float = 0.10
    climate_zone: str = "temperate_oceanic"
    enabled: bool = True

REGION_REGISTRY: dict[str, RegionConfig] = {
    "scotland": RegionConfig(
        region_id="scotland",
        display_name="Scotland",
        jurisdiction="SEPA",
        country="Scotland",
        bbox=(54.6, -7.6, 60.9, -0.7),
        flood_api_base="https://www.sepa.org.uk/api",
        gauge_api_url="https://www.sepa.org.uk/api/Stations",
        alert_api_url="https://www.sepa.org.uk/api/1.0/alerts/",
        watch_geojson_url="https://www.sepa.org.uk/api/1.0/geojson/floodwatch",
        warning_geojson_url="https://www.sepa.org.uk/api/1.0/geojson/floodwarning",
        heatwave_threshold_c=23.0,
        enabled=True,
    ),
    "england": RegionConfig(
        region_id="england",
        display_name="England",
        jurisdiction="EA",
        country="England",
        bbox=(49.9, -5.7, 55.8, 1.8),
        flood_api_base="https://environment.data.gov.uk/flood-monitoring",
        gauge_api_url="https://environment.data.gov.uk/flood-monitoring/id/stations",
        alert_api_url="https://environment.data.gov.uk/flood-monitoring/id/floods",
        watch_geojson_url="https://environment.data.gov.uk/flood-monitoring/id/floodAreas.geojson",
        warning_geojson_url="https://environment.data.gov.uk/flood-monitoring/id/floodAreas.geojson",
        heatwave_threshold_c=25.0,
        enabled=False,
    ),
    "wales": RegionConfig(
        region_id="wales",
        display_name="Wales",
        jurisdiction="NRW",
        country="Wales",
        bbox=(51.3, -5.4, 53.5, -2.6),
        flood_api_base="https://flood-warning-information.service.gov.uk/api",
        gauge_api_url="https://environment.data.gov.uk/flood-monitoring/id/stations",
        alert_api_url="https://flood-warning-information.service.gov.uk/api/1.0/floods",
        watch_geojson_url="https://flood-warning-information.service.gov.uk/api/1.0/floods.geojson",
        warning_geojson_url="https://flood-warning-information.service.gov.uk/api/1.0/floods.geojson",
        heatwave_threshold_c=25.0,
        enabled=False,
    ),
    "northern_ireland": RegionConfig(
        region_id="northern_ireland",
        display_name="Northern Ireland",
        jurisdiction="NIEA",
        country="Northern Ireland",
        bbox=(54.0, -8.2, 55.4, -5.4),
        flood_api_base="https://www.nidirect.gov.uk",
        gauge_api_url="https://watermaps.shared.nisra.gov.uk",
        alert_api_url="https://www.nidirect.gov.uk/articles/river-levels-and-flood-alerts",
        watch_geojson_url="https://www.nidirect.gov.uk/articles/river-levels-and-flood-alerts",
        warning_geojson_url="https://www.nidirect.gov.uk/articles/river-levels-and-flood-alerts",
        heatwave_threshold_c=23.0,
        enabled=False,
    ),
}

def get_region(region_id: str) -> RegionConfig:
    if region_id not in REGION_REGISTRY:
        raise KeyError(
            f"Unknown region '{region_id}'. Valid options: {sorted(REGION_REGISTRY.keys())}"
        )
    return REGION_REGISTRY[region_id]

def get_enabled_regions() -> list[RegionConfig]:
    return [region for region in REGION_REGISTRY.values() if region.enabled]

def get_all_regions() -> list[RegionConfig]:
    return list(REGION_REGISTRY.values())
