"""
Package initialiser for the registry module (makes Python treat this directory as an importable package).
"""

from .region_registry import (
    REGION_REGISTRY,
    RegionConfig,
    get_all_regions,
    get_enabled_regions,
    get_region,
)
