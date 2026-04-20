"""
Unit tests for the SpatialAnalyticsService -- validates:
  - Haversine distance computation
  - Evacuation corridor generation (bearing, compass, travel time)
  - Polygon area estimation
  - Bearing-to-compass conversion
"""

import sys
import math
from pathlib import Path

import pytest

AI_ROOT = Path(__file__).resolve().parent.parent
if str(AI_ROOT) not in sys.path:
    sys.path.insert(0, str(AI_ROOT))


# Haversine


class TestHaversine:
    """Haversine great-circle distance."""

    def test_same_point_is_zero(self):
        from app.services.spatial_analytics import _haversine_m
        assert _haversine_m(51.5, -0.1, 51.5, -0.1) == 0.0

    def test_london_to_edinburgh(self):
        """London <-> Edinburgh ≈ 534 km (within ±5 km)."""
        from app.services.spatial_analytics import _haversine_m
        d = _haversine_m(51.5074, -0.1278, 55.9533, -3.1883)
        assert 529_000 < d < 539_000, f"Expected ~534 km, got {d/1000:.1f} km"

    def test_short_distance_accuracy(self):
        """Two points ~111 m apart (0.001° lat at equator)."""
        from app.services.spatial_analytics import _haversine_m
        d = _haversine_m(0.0, 0.0, 0.001, 0.0)
        assert 100 < d < 120, f"Expected ~111 m, got {d:.1f} m"

    def test_antipodal_points(self):
        """Opposite sides of Earth ≈ 20,000 km."""
        from app.services.spatial_analytics import _haversine_m
        d = _haversine_m(0, 0, 0, 180)
        assert 19_900_000 < d < 20_100_000


# Bearing to compass


class TestBearingToCompass:
    """8-point compass direction from bearing."""

    def test_north(self):
        from app.services.spatial_analytics import _bearing_to_compass
        assert _bearing_to_compass(0) == "N"
        assert _bearing_to_compass(10) == "N"
        assert _bearing_to_compass(350) == "N"

    def test_cardinal_directions(self):
        from app.services.spatial_analytics import _bearing_to_compass
        assert _bearing_to_compass(90) == "E"
        assert _bearing_to_compass(180) == "S"
        assert _bearing_to_compass(270) == "W"

    def test_intercardinal_directions(self):
        from app.services.spatial_analytics import _bearing_to_compass
        assert _bearing_to_compass(45) == "NE"
        assert _bearing_to_compass(135) == "SE"
        assert _bearing_to_compass(225) == "SW"
        assert _bearing_to_compass(315) == "NW"


# Evacuation corridors


class TestEvacuationCorridors:
    """Evacuation corridor computation."""

    def test_empty_facilities_returns_empty(self):
        from app.services.spatial_analytics import _compute_evacuation_corridors
        corridors = _compute_evacuation_corridors(51.5, -0.1, {}, None)
        assert corridors == []

    def test_returns_corridors_for_facilities(self):
        from app.services.spatial_analytics import _compute_evacuation_corridors
        facilities = {
            "hospital": [
                {"name": "Royal Infirmary", "lat": 51.51, "lon": -0.09, "distance_m": 1200},
                {"name": "City Hospital", "lat": 51.52, "lon": -0.08, "distance_m": 2500},
            ],
            "fire_station": [
                {"name": "Central Fire Station", "lat": 51.49, "lon": -0.11, "distance_m": 1800},
            ],
        }
        corridors = _compute_evacuation_corridors(51.5, -0.1, facilities, None)
        assert len(corridors) == 3
        # Each corridor should have required fields
        for c in corridors:
            assert "target_name" in c
            assert "bearing_deg" in c
            assert "compass" in c
            assert "distance_m" in c
            assert "est_travel_min" in c
            assert 0 <= c["bearing_deg"] < 360

    def test_corridors_sorted_by_distance(self):
        from app.services.spatial_analytics import _compute_evacuation_corridors
        facilities = {
            "hospital": [
                {"name": "Far Hospital", "lat": 52.0, "lon": 0.0, "distance_m": 50000},
                {"name": "Near Hospital", "lat": 51.501, "lon": -0.099, "distance_m": 200},
            ],
        }
        corridors = _compute_evacuation_corridors(51.5, -0.1, facilities, None)
        assert corridors[0]["distance_m"] < corridors[1]["distance_m"]

    def test_travel_time_calculation(self):
        """Travel time at 30 km/h: 3000 m -> 6.0 min."""
        from app.services.spatial_analytics import _compute_evacuation_corridors
        facilities = {
            "hospital": [
                {"name": "Test", "lat": 51.51, "lon": -0.1, "distance_m": 3000},
            ],
        }
        corridors = _compute_evacuation_corridors(51.5, -0.1, facilities, None)
        assert corridors[0]["est_travel_min"] == 6.0

    def test_max_10_corridors(self):
        """Should cap at 10 results."""
        from app.services.spatial_analytics import _compute_evacuation_corridors
        # 3 types × 3 each = 9, but verify cap logic with more
        facilities = {
            "hospital": [{"name": f"H{i}", "lat": 51.5 + i*0.01, "lon": -0.1, "distance_m": i*100} for i in range(5)],
            "fire_station": [{"name": f"F{i}", "lat": 51.5 + i*0.01, "lon": -0.1, "distance_m": i*100} for i in range(5)],
            "police": [{"name": f"P{i}", "lat": 51.5 + i*0.01, "lon": -0.1, "distance_m": i*100} for i in range(5)],
        }
        # Each type capped at 3 -> 9 max, but final cap is 10
        corridors = _compute_evacuation_corridors(51.5, -0.1, facilities, None)
        assert len(corridors) <= 10


# Polygon area


class TestPolygonArea:
    """GeoJSON polygon area estimation."""

    def test_empty_geojson(self):
        from app.services.spatial_analytics import _polygon_area_km2
        assert _polygon_area_km2({}) == 0.0

    def test_invalid_geojson(self):
        from app.services.spatial_analytics import _polygon_area_km2
        assert _polygon_area_km2({"features": []}) == 0.0
