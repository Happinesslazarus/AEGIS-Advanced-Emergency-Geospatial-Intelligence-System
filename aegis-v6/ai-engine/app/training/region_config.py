"""
Defines per-region training configuration: which lat/lon bounding box to
use, which hazards are relevant (e.g. no drought training for coastal
regions), and the minimum positive-label count needed before training.

- Used by train_all.py and base_real_pipeline.py to scope training runs
- Region list must match ai-engine/registry/region_registry.py entries
- Server regions: server/src/routes/spatialRoutes.ts reads the same IDs
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional

@dataclass(frozen=True)
class TrainingRegion:
    """Immutable region definition for training pipelines."""

    region_id: str
    display_name: str
    # Bounding box: (lat_min, lon_min, lat_max, lon_max)
    bbox: tuple[float, float, float, float]
    # Default training date range
    default_start: str  # ISO date, e.g. "2020-01-01"
    default_end: str
    timezone: str = "UTC"
    climate_zone: str = "temperate"

    # Optional regional data enhancers (empty = use global only)
    enhancer_apis: tuple[str, ...] = ()

# Global presets

TRAINING_REGIONS: Dict[str, TrainingRegion] = {
    "global": TrainingRegion(
        region_id="global",
        display_name="Global (representative sample)",
        bbox=(-60.0, -180.0, 70.0, 180.0),
        default_start="2020-01-01",
        default_end="2025-12-31",
        climate_zone="mixed",
    ),
    "uk": TrainingRegion(
        region_id="uk",
        display_name="United Kingdom",
        bbox=(49.9, -8.0, 60.9, 2.0),
        default_start="2020-01-01",
        default_end="2025-12-31",
        timezone="Europe/London",
        climate_zone="temperate_oceanic",
        enhancer_apis=("sepa", "ea", "met_office"),
    ),
    "nigeria": TrainingRegion(
        region_id="nigeria",
        display_name="Nigeria",
        bbox=(4.0, 2.5, 14.0, 14.7),
        default_start="2020-01-01",
        default_end="2025-12-31",
        timezone="Africa/Lagos",
        climate_zone="tropical",
    ),
    "usa": TrainingRegion(
        region_id="usa",
        display_name="United States",
        bbox=(24.5, -125.0, 49.4, -66.9),
        default_start="2020-01-01",
        default_end="2025-12-31",
        timezone="America/New_York",
        climate_zone="mixed",
        enhancer_apis=("nws", "usgs"),
    ),
    "india": TrainingRegion(
        region_id="india",
        display_name="India",
        bbox=(6.5, 68.0, 35.5, 97.5),
        default_start="2020-01-01",
        default_end="2025-12-31",
        timezone="Asia/Kolkata",
        climate_zone="tropical_monsoon",
    ),
    "australia": TrainingRegion(
        region_id="australia",
        display_name="Australia",
        bbox=(-44.0, 112.0, -10.0, 154.0),
        default_start="2020-01-01",
        default_end="2025-12-31",
        timezone="Australia/Sydney",
        climate_zone="mixed",
        enhancer_apis=("bom",),
    ),
    "brazil": TrainingRegion(
        region_id="brazil",
        display_name="Brazil",
        bbox=(-33.8, -73.9, 5.3, -34.8),
        default_start="2020-01-01",
        default_end="2025-12-31",
        timezone="America/Sao_Paulo",
        climate_zone="tropical",
    ),
    "japan": TrainingRegion(
        region_id="japan",
        display_name="Japan",
        bbox=(24.0, 122.0, 46.0, 153.0),
        default_start="2020-01-01",
        default_end="2025-12-31",
        timezone="Asia/Tokyo",
        climate_zone="temperate_monsoon",
        enhancer_apis=("jma",),
    ),
}

def get_training_region(region_id: str) -> TrainingRegion:
    """Return region config; raises KeyError for unknown regions."""
    if region_id not in TRAINING_REGIONS:
        raise KeyError(
            f"Unknown region '{region_id}'. "
            f"Available: {sorted(TRAINING_REGIONS.keys())}"
        )
    return TRAINING_REGIONS[region_id]

def list_training_regions() -> List[str]:
    return sorted(TRAINING_REGIONS.keys())
