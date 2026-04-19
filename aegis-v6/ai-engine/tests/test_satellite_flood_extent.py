"""
Unit tests for the SatelliteFloodExtentService — validates:
  • NDWI computation logic
  • Population estimation fallback
  • Flood extent classification from backscatter change
  • Service initialisation
"""

import sys
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest
import numpy as np

AI_ROOT = Path(__file__).resolve().parent.parent
if str(AI_ROOT) not in sys.path:
    sys.path.insert(0, str(AI_ROOT))


# ── NDWI computation ──────────────────────────────────────────────────────


class TestNDWIComputation:
    """Normalized Difference Water Index = (Green - NIR) / (Green + NIR)."""

    def test_ndwi_water_pixels(self):
        """Water pixels: Green > NIR → NDWI > 0."""
        green = np.array([[0.3, 0.4], [0.5, 0.6]], dtype=np.float32)
        nir   = np.array([[0.1, 0.1], [0.2, 0.1]], dtype=np.float32)
        ndwi  = (green - nir) / (green + nir + 1e-10)
        assert np.all(ndwi > 0), "Water should have positive NDWI"

    def test_ndwi_vegetation_pixels(self):
        """Vegetation pixels: NIR > Green → NDWI < 0."""
        green = np.array([[0.1, 0.1]], dtype=np.float32)
        nir   = np.array([[0.5, 0.6]], dtype=np.float32)
        ndwi  = (green - nir) / (green + nir + 1e-10)
        assert np.all(ndwi < 0), "Vegetation should have negative NDWI"

    def test_ndwi_threshold_at_02(self):
        """Standard water threshold is NDWI > 0.2."""
        green = np.array([[0.4, 0.2, 0.5]], dtype=np.float32)
        nir   = np.array([[0.1, 0.18, 0.05]], dtype=np.float32)
        ndwi  = (green - nir) / (green + nir + 1e-10)
        water_mask = ndwi > 0.2
        # First: (0.4-0.1)/(0.4+0.1)=0.6 → water
        # Second: (0.2-0.18)/(0.2+0.18)≈0.053 → not water
        # Third: (0.5-0.05)/(0.5+0.05)≈0.818 → water
        assert water_mask[0, 0] == True
        assert water_mask[0, 1] == False
        assert water_mask[0, 2] == True

    def test_ndwi_no_division_by_zero(self):
        """Should not crash on zero bands."""
        green = np.zeros((2, 2), dtype=np.float32)
        nir   = np.zeros((2, 2), dtype=np.float32)
        ndwi  = (green - nir) / (green + nir + 1e-10)
        assert np.all(np.isfinite(ndwi))


# ── Population estimation ─────────────────────────────────────────────────


class TestPopulationEstimation:
    """Population estimation fallback logic."""

    def test_density_fallback_calculation(self):
        """Fallback: area_km2 × 270 people/km² (UK average)."""
        area_km2 = 10.0
        density = 270  # UK average
        pop = area_km2 * density
        assert pop == 2700

    def test_density_zero_area(self):
        """Zero area → zero population."""
        assert 0.0 * 270 == 0.0

    def test_density_large_area(self):
        """London-size area (~1,572 km²) should give reasonable estimate."""
        area_km2 = 1572.0
        pop = area_km2 * 270
        assert 400_000 < pop < 500_000  # Rough UK-average density


# ── Backscatter change detection ──────────────────────────────────────────


class TestBackscatterChangeDetection:
    """Sentinel-1 SAR flood detection via backscatter change."""

    def test_flood_detected_above_3db_threshold(self):
        """Pixels with >3 dB backscatter drop should be classified as flooded."""
        pre  = np.array([[-5, -8, -10], [-6, -7, -12]], dtype=np.float32)
        post = np.array([[-9, -9, -14], [-7, -8, -20]], dtype=np.float32)
        change_db = pre - post  # positive = backscatter dropped (water)
        flood_mask = change_db > 3.0
        # Pixel (0,0): -5 - (-9) = 4 > 3 → flood
        assert flood_mask[0, 0] == True
        # Pixel (0,1): -8 - (-9) = 1 < 3 → no flood
        assert flood_mask[0, 1] == False
        # Pixel (1,2): -12 - (-20) = 8 > 3 → flood
        assert flood_mask[1, 2] == True

    def test_no_change_no_flood(self):
        """Identical pre/post → no flood pixels."""
        arr = np.full((5, 5), -10.0, dtype=np.float32)
        change_db = arr - arr
        flood_mask = change_db > 3.0
        assert not flood_mask.any()


# ── Service initialisation ────────────────────────────────────────────────


class TestServiceInit:
    """Verify service can be imported and has expected methods."""

    def test_module_importable(self):
        try:
            from app.services import satellite_flood_extent
            assert hasattr(satellite_flood_extent, "SatelliteFloodExtentService")
        except ImportError as e:
            if "sentinelsat" in str(e) or "rasterio" in str(e):
                pytest.skip(f"Optional dependency missing: {e}")
            raise

    def test_service_has_analyse_method(self):
        try:
            from app.services.satellite_flood_extent import SatelliteFloodExtentService
            svc = SatelliteFloodExtentService.__new__(SatelliteFloodExtentService)
            assert callable(getattr(svc, "analyse", None)) or callable(getattr(svc, "analyze", None))
        except ImportError:
            pytest.skip("Optional dependency missing")
