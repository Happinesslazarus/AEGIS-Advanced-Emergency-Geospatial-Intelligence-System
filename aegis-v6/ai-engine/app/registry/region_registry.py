"""Backward-compatible re-export for regional registry.

Canonical source of truth is `registry.region_registry`.
This shim keeps existing imports working without duplication.
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
