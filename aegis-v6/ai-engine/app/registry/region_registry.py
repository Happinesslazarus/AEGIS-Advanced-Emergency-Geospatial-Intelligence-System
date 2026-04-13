"""
File: region_registry.py  (app/registry re-export shim)

What this file does:
Re-exports REGION_REGISTRY, RegionConfig, and helper functions from the
top-level registry/ package so that app/ modules can import region data
without going outside the app/ tree. Also exposes is_region_enabled() as
a convenience check.

How it connects:
- Source data in ai-engine/registry/region_registry.py
- Used by hazard predictors to validate region_id before predicting
- Region list drives the multi-location weather fetcher in training/
"""

from registry.region_registry import (
    REGION_REGISTRY,
    RegionConfig,
    get_all_regions,
    get_enabled_regions,
    get_region,
)

def is_region_enabled(region_id: str) -> bool:
    return get_region(region_id).enabled
